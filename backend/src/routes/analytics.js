const express = require('express');
const { HttpError, parseId, STATUSES, PRIORITIES } = require('../utils');
const { getSetting } = require('../settings');
const { forbidImpersonation } = require('../middleware/auth');
const R = require('../reports');
const S = require('../reportSchedules');
const D = require('../dashboards');

const nowIso = () => new Date().toISOString();
const VISIBILITIES = ['private', 'groups', 'all'];
const MAX_NAME = 100;
const MAX_DESCRIPTION = 500;
const PERSON_COLS = `id, username, CASE WHEN hide_real_name = 1 THEN '' ELSE firstname END AS firstname,
  CASE WHEN hide_real_name = 1 THEN '' ELSE lastname END AS lastname, hide_real_name`;

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/** Écritures interdites pendant une prise de contrôle : les rapports et envois restent ceux de la personne. */
function noImpersonationOnWrite(req, res, next) {
  if (req.method === 'GET') return next();
  return forbidImpersonation(req, res, next);
}

/**
 * Analyses : rapports, envois programmés et tableaux de bord.
 * Dans l'application, tout est calculé avec les droits de la personne qui consulte.
 */
function analyticsRoutes({ db, mailer }) {
  const router = express.Router();
  router.use(noImpersonationOnWrite);

  const myGroupIds = async (userId) => (await db.all('SELECT group_id FROM group_members WHERE user_id = ?', [userId])).map((r) => r.group_id);

  function cleanText(value, max, label, required = false) {
    const v = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (required && !v) throw new HttpError(400, `${label} : obligatoire.`);
    if (v.length > max) throw new HttpError(400, `${label} : ${max} caractères au plus.`);
    return v;
  }

  async function cleanSharing(body, ctx) {
    const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'private';
    const groups = visibility === 'groups' ? [...new Set((Array.isArray(body.groups) ? body.groups : []).map(Number))] : [];
    if (groups.some((g) => !ctx.groupIds.includes(g))) throw new HttpError(400, "Un des groupes n'existe plus.");
    if (visibility === 'groups' && !groups.length) throw new HttpError(400, 'Choisissez au moins un groupe avec qui partager.');
    return { visibility, groups };
  }

  // ----------------------------------------------------------------------------------------------- Options

  router.get('/meta', async (req, res) => {
    const categories = await getSetting(db, 'categories');
    const priorities = await getSetting(db, 'priorities');
    const groups = await db.all('SELECT id, name FROM user_groups ORDER BY name COLLATE NOCASE');
    const mine = await myGroupIds(req.user.id);
    const forms = await db.all('SELECT id, name FROM catalog_items ORDER BY name COLLATE NOCASE');
    const label = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.label]));
    res.json({
      types: R.TYPES,
      charts: R.CHARTS,
      periods: R.PERIODS,
      dimensions: label(R.DIMENSIONS),
      metrics: label(R.METRICS),
      kpis: label(R.KPIS),
      columns: label(R.COLUMNS),
      defaultColumns: R.DEFAULT_COLUMNS,
      statuses: STATUSES.map((k) => ({ key: k, label: R.STATUS_LABELS[k] })),
      priorities: PRIORITIES.map((k) => ({ key: k, label: priorities?.[k]?.label || k })).reverse(),
      categories: categories.map((c) => ({ key: c.key, label: c.label })),
      groups: groups.map((g) => ({ ...g, mine: mine.includes(g.id) })),
      forms,
      templates: Object.entries(D.TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description, widgets: t.widgets.length })),
      frequencies: S.FREQUENCIES,
      widths: D.WIDTHS,
      heights: D.HEIGHTS,
      limits: { users: S.MAX_USERS, groups: S.MAX_GROUPS, widgets: D.MAX_WIDGETS },
    });
  });

  // Essai d'une définition (éditeur de rapport, bloc de tableau de bord).
  router.post('/preview', async (req, res) => {
    const def = R.validateDefinition(req.body?.definition, await R.definitionContext(db));
    res.json({ definition: def, result: await R.runReport(db, def, req.user) });
  });

  // ----------------------------------------------------------------------------------------------- Rapports

  const REPORT_ACCESS = `(r.owner_id = ? OR r.visibility = 'all' OR (r.visibility = 'groups' AND r.id IN (
    SELECT report_id FROM report_shares WHERE group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))))`;

  async function reportShares(id) {
    return (await db.all('SELECT g.id, g.name FROM report_shares s JOIN user_groups g ON g.id = s.group_id WHERE s.report_id = ? ORDER BY g.name', [id])).map((g) => g);
  }

  async function serializeReport(r, me) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      definition: parseJson(r.definition, {}),
      visibility: r.visibility,
      groups: await reportShares(r.id),
      owner: { id: r.owner_id, name: r.o_hide ? r.o_username : [r.o_firstname, r.o_lastname].filter(Boolean).join(' ') || r.o_username },
      mine: r.owner_id === me.id,
      schedules: r.owner_id === me.id ? (await db.get('SELECT COUNT(*) AS n FROM report_schedules WHERE report_id = ? AND active = 1', [r.id])).n : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  const REPORT_SELECT = `SELECT r.*, o.username AS o_username, o.firstname AS o_firstname, o.lastname AS o_lastname, o.hide_real_name AS o_hide
    FROM reports r LEFT JOIN users o ON o.id = r.owner_id`;

  async function loadReport(req, id, { own = false } = {}) {
    const r = await db.get(`${REPORT_SELECT} WHERE r.id = ? AND ${REPORT_ACCESS}`, [id, req.user.id, req.user.id]);
    if (!r) throw new HttpError(404, 'Rapport introuvable ou non partagé avec vous.');
    if (own && r.owner_id !== req.user.id) throw new HttpError(403, 'Seule la personne qui a créé ce rapport peut le modifier.');
    return r;
  }

  router.get('/reports', async (req, res) => {
    const rows = await db.all(`${REPORT_SELECT} WHERE ${REPORT_ACCESS} ORDER BY r.updated_at DESC`, [req.user.id, req.user.id]);
    const list = await Promise.all(rows.map((r) => serializeReport(r, req.user)));
    res.json({ mine: list.filter((r) => r.mine), shared: list.filter((r) => !r.mine) });
  });

  async function saveReport(req, existing) {
    const ctx = await R.definitionContext(db);
    const name = cleanText(req.body?.name, MAX_NAME, 'Nom du rapport', true);
    const description = String(req.body?.description ?? '').trim().slice(0, MAX_DESCRIPTION);
    const definition = R.validateDefinition(req.body?.definition, ctx);
    const { visibility, groups } = await cleanSharing(req.body || {}, ctx);
    const now = nowIso();
    let id = existing?.id;
    if (existing) {
      await db.run('UPDATE reports SET name = ?, description = ?, definition = ?, visibility = ?, updated_at = ? WHERE id = ?', [
        name,
        description,
        JSON.stringify(definition),
        visibility,
        now,
        id,
      ]);
    } else {
      const r = await db.run('INSERT INTO reports (owner_id, name, description, definition, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        req.user.id,
        name,
        description,
        JSON.stringify(definition),
        visibility,
        now,
        now,
      ]);
      id = r.lastID;
    }
    await db.run('DELETE FROM report_shares WHERE report_id = ?', [id]);
    for (const g of groups) await db.run('INSERT INTO report_shares (report_id, group_id) VALUES (?, ?)', [id, g]);
    return serializeReport(await loadReport(req, id), req.user);
  }

  router.post('/reports', async (req, res) => {
    const count = (await db.get('SELECT COUNT(*) AS n FROM reports WHERE owner_id = ?', [req.user.id])).n;
    if (count >= 100) throw new HttpError(400, '100 rapports au plus par personne : supprimez-en un.');
    res.status(201).json({ report: await saveReport(req, null) });
  });

  router.get('/reports/:id', async (req, res) => {
    res.json({ report: await serializeReport(await loadReport(req, parseId(req.params.id, 'Rapport')), req.user) });
  });

  router.put('/reports/:id', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'), { own: true });
    res.json({ report: await saveReport(req, r) });
  });

  router.delete('/reports/:id', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'), { own: true });
    await db.run('DELETE FROM reports WHERE id = ?', [r.id]);
    res.json({ success: true });
  });

  // Copie d'un rapport partagé (ou du sien) : la copie est privée et appartient à la personne.
  router.post('/reports/:id/duplicate', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'));
    const now = nowIso();
    const x = await db.run('INSERT INTO reports (owner_id, name, description, definition, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      req.user.id,
      `${r.name} (copie)`.slice(0, MAX_NAME),
      r.description,
      r.definition,
      'private',
      now,
      now,
    ]);
    res.status(201).json({ report: await serializeReport(await loadReport(req, x.lastID), req.user) });
  });

  // Résultat du rapport pour la personne qui le consulte, avec ses propres droits.
  router.get('/reports/:id/run', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'));
    const ctx = await R.definitionContext(db);
    const def = R.validateDefinition(parseJson(r.definition, {}), ctx);
    const filters = D.validateFilters({ period: req.query.period || undefined, group: req.query.group || undefined }, ctx);
    res.json({ result: await R.runReport(db, def, req.user, { overrides: D.overridesFor(def, filters) }) });
  });

  router.get('/reports/:id/csv', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'));
    const ctx = await R.definitionContext(db);
    const def = R.validateDefinition(parseJson(r.definition, {}), ctx);
    const filters = D.validateFilters({ period: req.query.period || undefined, group: req.query.group || undefined }, ctx);
    // Une liste exportée contient toutes ses lignes (500 au plus).
    const full = def.type === 'list' ? { ...def, limit: 500 } : def;
    const result = await R.runReport(db, full, req.user, { overrides: D.overridesFor(def, filters) });
    const slug = r.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="rapport-${slug || r.id}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(R.toCsv(result));
  });

  // ----------------------------------------------------------------------------------------------- Envois

  /** Destinataires possibles : toute personne active ; les groupes dont on est membre (tous pour un administrateur). */
  router.get('/recipients', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const people = await db.all(
      `SELECT ${PERSON_COLS} FROM users WHERE anonymized_at IS NULL
       AND (? = '' OR username LIKE ? ESCAPE '\\' OR (hide_real_name = 0 AND (firstname LIKE ? ESCAPE '\\' OR lastname LIKE ? ESCAPE '\\'
         OR (firstname || ' ' || lastname) LIKE ? ESCAPE '\\')))
       ORDER BY username LIMIT 20`,
      [q, like, like, like, like]
    );
    const mine = await myGroupIds(req.user.id);
    const groups = await db.all(
      `SELECT g.id, g.name, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM user_groups g ORDER BY g.name COLLATE NOCASE`
    );
    res.json({
      people: people.map((p) => ({ id: p.id, username: p.username, name: p.hide_real_name ? p.username : [p.firstname, p.lastname].filter(Boolean).join(' ') || p.username })),
      groups: groups.filter((g) => req.user.role === 'admin' || mine.includes(g.id)),
    });
  });

  async function cleanSchedule(req, body) {
    const frequency = body.frequency;
    if (!S.FREQUENCIES.includes(frequency)) throw new HttpError(400, 'Choisissez une fréquence.');
    const time = String(body.time || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Heure invalide (HH:MM).');
    const weekday = frequency === 'weekly' ? Number(body.weekday) : null;
    if (frequency === 'weekly' && !(weekday >= 0 && weekday <= 6)) throw new HttpError(400, 'Choisissez un jour de la semaine.');
    const monthday = frequency === 'monthly' ? Number(body.monthday) : null;
    if (frequency === 'monthly' && !(monthday >= 1 && monthday <= 28)) throw new HttpError(400, 'Choisissez un jour du mois entre 1 et 28.');
    const users = [...new Set((Array.isArray(body.users) ? body.users : []).map(Number))];
    const groups = [...new Set((Array.isArray(body.groups) ? body.groups : []).map(Number))];
    if (users.length > S.MAX_USERS) throw new HttpError(400, `${S.MAX_USERS} personnes au plus.`);
    if (groups.length > S.MAX_GROUPS) throw new HttpError(400, `${S.MAX_GROUPS} groupes au plus.`);
    for (const id of users) {
      if (!(await db.get('SELECT id FROM users WHERE id = ? AND anonymized_at IS NULL', [id]))) throw new HttpError(400, "Une des personnes n'existe plus.");
    }
    const mine = await myGroupIds(req.user.id);
    for (const id of groups) {
      if (!(await db.get('SELECT id FROM user_groups WHERE id = ?', [id]))) throw new HttpError(400, "Un des groupes n'existe plus.");
      if (req.user.role !== 'admin' && !mine.includes(id)) throw new HttpError(403, 'Vous pouvez envoyer seulement aux groupes dont vous êtes membre.');
    }
    const includeSelf = body.includeSelf !== false;
    if (!includeSelf && !users.length && !groups.length) throw new HttpError(400, 'Ajoutez au moins un destinataire.');
    return {
      frequency,
      time,
      weekday,
      monthday,
      users,
      groups,
      includeSelf,
      skipEmpty: Boolean(body.skipEmpty),
      message: String(body.message || '').trim().slice(0, 500),
      active: body.active !== false,
    };
  }

  async function serializeSchedule(s) {
    const users = await db.all(
      `SELECT u.id, u.username, u.firstname, u.lastname, u.hide_real_name
       FROM report_schedule_users x JOIN users u ON u.id = x.user_id WHERE x.schedule_id = ? AND u.anonymized_at IS NULL ORDER BY u.username`,
      [s.id]
    );
    const groups = await db.all('SELECT g.id, g.name FROM report_schedule_groups x JOIN user_groups g ON g.id = x.group_id WHERE x.schedule_id = ? ORDER BY g.name', [s.id]);
    const last = await db.get('SELECT ran_at, status, sent, skipped, error FROM report_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 1', [s.id]);
    return {
      id: s.id,
      reportId: s.report_id,
      frequency: s.frequency,
      weekday: s.weekday,
      monthday: s.monthday,
      time: s.time,
      label: S.describeFrequency(s),
      includeSelf: Boolean(s.include_self),
      skipEmpty: Boolean(s.skip_empty),
      message: s.message,
      active: Boolean(s.active),
      disabledReason: s.disabled_reason || null,
      nextRunAt: s.active ? s.next_run_at : null,
      lastRun: last ? { at: last.ran_at, status: last.status, sent: last.sent, skipped: parseJson(last.skipped, []), error: last.error } : null,
      users: users.map((u) => ({ id: u.id, username: u.username, name: u.hide_real_name ? u.username : [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username })),
      groups,
    };
  }

  async function writeRecipients(id, v) {
    await db.run('DELETE FROM report_schedule_users WHERE schedule_id = ?', [id]);
    await db.run('DELETE FROM report_schedule_groups WHERE schedule_id = ?', [id]);
    for (const u of v.users) await db.run('INSERT INTO report_schedule_users (schedule_id, user_id) VALUES (?, ?)', [id, u]);
    for (const g of v.groups) await db.run('INSERT INTO report_schedule_groups (schedule_id, group_id) VALUES (?, ?)', [id, g]);
  }

  router.get('/reports/:id/schedules', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'), { own: true });
    const rows = await db.all('SELECT * FROM report_schedules WHERE report_id = ? ORDER BY id', [r.id]);
    res.json({ schedules: await Promise.all(rows.map(serializeSchedule)) });
  });

  router.post('/reports/:id/schedules', async (req, res) => {
    const r = await loadReport(req, parseId(req.params.id, 'Rapport'), { own: true });
    const count = (await db.get('SELECT COUNT(*) AS n FROM report_schedules WHERE owner_id = ?', [req.user.id])).n;
    if (count >= 20) throw new HttpError(400, '20 envois programmés au plus par personne.');
    const v = await cleanSchedule(req, req.body || {});
    const next = v.active ? S.nextRun(v).toISOString() : null;
    const x = await db.run(
      `INSERT INTO report_schedules (report_id, owner_id, frequency, weekday, monthday, time, include_self, skip_empty, message, active, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, req.user.id, v.frequency, v.weekday, v.monthday, v.time, v.includeSelf ? 1 : 0, v.skipEmpty ? 1 : 0, v.message, v.active ? 1 : 0, next, nowIso()]
    );
    await writeRecipients(x.lastID, v);
    res.status(201).json({ schedule: await serializeSchedule(await db.get('SELECT * FROM report_schedules WHERE id = ?', [x.lastID])) });
  });

  async function loadSchedule(req, id) {
    const s = await db.get('SELECT * FROM report_schedules WHERE id = ?', [id]);
    if (!s || s.owner_id !== req.user.id) throw new HttpError(404, 'Envoi programmé introuvable.');
    return s;
  }

  router.put('/schedules/:id', async (req, res) => {
    const s = await loadSchedule(req, parseId(req.params.id, 'Envoi'));
    const v = await cleanSchedule(req, req.body || {});
    const next = v.active ? S.nextRun(v).toISOString() : null;
    await db.run(
      `UPDATE report_schedules SET frequency = ?, weekday = ?, monthday = ?, time = ?, include_self = ?, skip_empty = ?, message = ?, active = ?,
         disabled_reason = NULL, next_run_at = ? WHERE id = ?`,
      [v.frequency, v.weekday, v.monthday, v.time, v.includeSelf ? 1 : 0, v.skipEmpty ? 1 : 0, v.message, v.active ? 1 : 0, next, s.id]
    );
    await writeRecipients(s.id, v);
    res.json({ schedule: await serializeSchedule(await db.get('SELECT * FROM report_schedules WHERE id = ?', [s.id])) });
  });

  router.delete('/schedules/:id', async (req, res) => {
    const s = await loadSchedule(req, parseId(req.params.id, 'Envoi'));
    await db.run('DELETE FROM report_schedules WHERE id = ?', [s.id]);
    res.json({ success: true });
  });

  // Envoi immédiat, pour vérifier le résultat (même contrôle des droits).
  router.post('/schedules/:id/send', async (req, res) => {
    const s = await loadSchedule(req, parseId(req.params.id, 'Envoi'));
    const run = await S.sendSchedule(db, mailer, s.id);
    res.json({ run, schedule: await serializeSchedule(await db.get('SELECT * FROM report_schedules WHERE id = ?', [s.id])) });
  });

  router.get('/schedules/:id/runs', async (req, res) => {
    const s = await loadSchedule(req, parseId(req.params.id, 'Envoi'));
    const runs = await db.all('SELECT ran_at, status, sent, skipped, error FROM report_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 30', [s.id]);
    res.json({ runs: runs.map((r) => ({ at: r.ran_at, status: r.status, sent: r.sent, skipped: parseJson(r.skipped, []), error: r.error })) });
  });

  // ----------------------------------------------------------------------------------------------- Tableaux de bord

  const DASH_ACCESS = REPORT_ACCESS.replaceAll('r.', 'd.').replace('report_id FROM report_shares', 'dashboard_id FROM dashboard_shares');
  const DASH_SELECT = `SELECT d.*, o.username AS o_username, o.firstname AS o_firstname, o.lastname AS o_lastname, o.hide_real_name AS o_hide
    FROM dashboards d LEFT JOIN users o ON o.id = d.owner_id`;

  async function serializeDashboard(d, me, { full = false } = {}) {
    const widgets = parseJson(d.widgets, []);
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      visibility: d.visibility,
      groups: await db.all('SELECT g.id, g.name FROM dashboard_shares s JOIN user_groups g ON g.id = s.group_id WHERE s.dashboard_id = ? ORDER BY g.name', [d.id]),
      owner: { id: d.owner_id, name: d.o_hide ? d.o_username : [d.o_firstname, d.o_lastname].filter(Boolean).join(' ') || d.o_username },
      mine: d.owner_id === me.id,
      widgetCount: widgets.length,
      filters: parseJson(d.filters, {}),
      ...(full ? { widgets } : {}),
      updatedAt: d.updated_at,
    };
  }

  async function loadDashboard(req, id, { own = false } = {}) {
    const d = await db.get(`${DASH_SELECT} WHERE d.id = ? AND ${DASH_ACCESS}`, [id, req.user.id, req.user.id]);
    if (!d) throw new HttpError(404, 'Tableau de bord introuvable ou non partagé avec vous.');
    if (own && d.owner_id !== req.user.id) throw new HttpError(403, 'Seule la personne qui a créé ce tableau de bord peut le modifier.');
    return d;
  }

  router.get('/dashboards', async (req, res) => {
    const rows = await db.all(`${DASH_SELECT} WHERE ${DASH_ACCESS} ORDER BY d.updated_at DESC`, [req.user.id, req.user.id]);
    const list = await Promise.all(rows.map((d) => serializeDashboard(d, req.user)));
    res.json({ mine: list.filter((d) => d.mine), shared: list.filter((d) => !d.mine) });
  });

  async function saveDashboard(req, existing, input) {
    const ctx = await R.definitionContext(db);
    const name = cleanText(input.name, MAX_NAME, 'Nom du tableau de bord', true);
    const description = String(input.description ?? '').trim().slice(0, MAX_DESCRIPTION);
    const widgets = D.validateWidgets(input.widgets ?? [], ctx);
    const filters = D.validateFilters(input.filters, ctx);
    const { visibility, groups } = await cleanSharing(input, ctx);
    const now = nowIso();
    let id = existing?.id;
    if (existing) {
      await db.run('UPDATE dashboards SET name = ?, description = ?, widgets = ?, filters = ?, visibility = ?, updated_at = ? WHERE id = ?', [
        name,
        description,
        JSON.stringify(widgets),
        JSON.stringify(filters),
        visibility,
        now,
        id,
      ]);
    } else {
      const count = (await db.get('SELECT COUNT(*) AS n FROM dashboards WHERE owner_id = ?', [req.user.id])).n;
      if (count >= 30) throw new HttpError(400, '30 tableaux de bord au plus par personne : supprimez-en un.');
      const r = await db.run('INSERT INTO dashboards (owner_id, name, description, widgets, filters, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        req.user.id,
        name,
        description,
        JSON.stringify(widgets),
        JSON.stringify(filters),
        visibility,
        now,
        now,
      ]);
      id = r.lastID;
    }
    await db.run('DELETE FROM dashboard_shares WHERE dashboard_id = ?', [id]);
    for (const g of groups) await db.run('INSERT INTO dashboard_shares (dashboard_id, group_id) VALUES (?, ?)', [id, g]);
    return serializeDashboard(await loadDashboard(req, id), req.user, { full: true });
  }

  router.post('/dashboards', async (req, res) => {
    const body = req.body || {};
    let input = body;
    if (body.template) {
      const t = D.TEMPLATES[body.template];
      if (!t) throw new HttpError(400, 'Modèle inconnu.');
      input = { name: body.name || t.name, description: t.description, widgets: t.widgets, filters: t.filters, visibility: 'private' };
    }
    res.status(201).json({ dashboard: await saveDashboard(req, null, input) });
  });

  router.get('/dashboards/:id', async (req, res) => {
    res.json({ dashboard: await serializeDashboard(await loadDashboard(req, parseId(req.params.id, 'Tableau de bord')), req.user, { full: true }) });
  });

  router.put('/dashboards/:id', async (req, res) => {
    const d = await loadDashboard(req, parseId(req.params.id, 'Tableau de bord'), { own: true });
    res.json({ dashboard: await saveDashboard(req, d, req.body || {}) });
  });

  router.delete('/dashboards/:id', async (req, res) => {
    const d = await loadDashboard(req, parseId(req.params.id, 'Tableau de bord'), { own: true });
    await db.run('DELETE FROM dashboards WHERE id = ?', [d.id]);
    res.json({ success: true });
  });

  router.post('/dashboards/:id/duplicate', async (req, res) => {
    const d = await loadDashboard(req, parseId(req.params.id, 'Tableau de bord'));
    const copy = {
      name: `${d.name} (copie)`.slice(0, MAX_NAME),
      description: d.description,
      widgets: parseJson(d.widgets, []),
      filters: parseJson(d.filters, {}),
      visibility: 'private',
    };
    res.status(201).json({ dashboard: await saveDashboard(req, null, copy) });
  });

  // Données de tous les blocs, avec les droits de la personne qui regarde et les filtres choisis.
  router.get('/dashboards/:id/data', async (req, res) => {
    const d = await loadDashboard(req, parseId(req.params.id, 'Tableau de bord'));
    const ctx = await R.definitionContext(db);
    const saved = parseJson(d.filters, {});
    const asked = {
      period: req.query.period === undefined ? saved.period : req.query.period || undefined,
      group: req.query.group === undefined ? saved.group : req.query.group || undefined,
    };
    const filters = D.validateFilters(asked, ctx);
    const widgets = parseJson(d.widgets, []);
    const data = {};
    for (const w of widgets) {
      try {
        const def = R.validateDefinition(w.definition, ctx);
        data[w.id] = { result: await R.runReport(db, def, req.user, { overrides: D.overridesFor(def, filters) }) };
      } catch (err) {
        data[w.id] = { error: err.message };
      }
    }
    res.json({ filters, data, generatedAt: nowIso() });
  });

  return router;
}

/** Administration : tous les envois programmés (pour arrêter un envoi abusif), sans les données. */
function analyticsAdminRoutes({ db }) {
  const router = express.Router();
  router.get('/schedules', async (req, res) => {
    const rows = await db.all(
      `SELECT s.*, r.name AS report_name, u.username, u.firstname, u.lastname,
         (SELECT COUNT(*) FROM report_schedule_users WHERE schedule_id = s.id) AS users,
         (SELECT COUNT(*) FROM report_schedule_groups WHERE schedule_id = s.id) AS groups
       FROM report_schedules s JOIN reports r ON r.id = s.report_id LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.active DESC, s.next_run_at`
    );
    res.json({
      schedules: rows.map((s) => ({
        id: s.id,
        report: s.report_name,
        owner: [s.firstname, s.lastname].filter(Boolean).join(' ') || s.username,
        label: S.describeFrequency(s),
        users: s.users,
        groups: s.groups,
        active: Boolean(s.active),
        disabledReason: s.disabled_reason,
        nextRunAt: s.next_run_at,
        lastRunAt: s.last_run_at,
      })),
    });
  });
  router.post('/schedules/:id/disable', async (req, res) => {
    const s = await db.get('SELECT id FROM report_schedules WHERE id = ?', [parseId(req.params.id, 'Envoi')]);
    if (!s) throw new HttpError(404, 'Envoi programmé introuvable.');
    const reason = String(req.body?.reason || '').trim().slice(0, 200) || 'Arrêté par un administrateur';
    await db.run('UPDATE report_schedules SET active = 0, disabled_reason = ?, next_run_at = NULL WHERE id = ?', [reason, s.id]);
    res.json({ success: true });
  });
  return router;
}

module.exports = { analyticsRoutes, analyticsAdminRoutes };

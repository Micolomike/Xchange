/**
 * Envois programmés des rapports par e-mail.
 *
 * Le rapport est calculé avec les droits de son créateur, puis envoyé séparément à chaque destinataire
 * qui voit lui-même toutes les demandes du rapport. Les autres sont écartés, et l'historique de l'envoi
 * dit pourquoi (sans révéler les données).
 */
const { getMailSettings } = require('./settings');
const { parseNotifyPrefs, displayName } = require('./utils');
const { loadActor, runReport, recipientCanSee, toCsv } = require('./reports');

const FREQUENCIES = ['daily', 'weekly', 'monthly'];
/** Nom montré aux autres : pseudonyme seul si la personne l'a choisi. */
const shownName = (u) => (u.hide_real_name ? u.username : displayName(u));
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MAX_USERS = 50;
const MAX_GROUPS = 10;

/** Prochain envoi strictement après `from`, en heure locale du PC. */
function nextRun(s, from = new Date()) {
  const [h, m] = String(s.time).split(':').map(Number);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(h, m);
  if (s.frequency === 'daily') {
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
  }
  if (s.frequency === 'weekly') {
    const diff = (Number(s.weekday) - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    if (d <= from) d.setDate(d.getDate() + 7);
    return d;
  }
  // Mensuel : du 1er au 28, pour exister tous les mois.
  d.setDate(Number(s.monthday));
  if (d <= from) {
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Number(s.monthday));
  }
  return d;
}

function describeFrequency(s) {
  if (s.frequency === 'daily') return `chaque jour à ${s.time}`;
  if (s.frequency === 'weekly') return `chaque ${WEEKDAYS[s.weekday]} à ${s.time}`;
  return `le ${s.monthday === 1 ? '1er' : s.monthday} de chaque mois à ${s.time}`;
}

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('fr-FR') : v == null || v === '' ? '' : String(v));
const fmtDate = (v) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(String(v))) return v;
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  return v.length === 10 ? d.toLocaleDateString('fr-FR') : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

const TH = 'text-align:left;padding:6px 8px;border-bottom:2px solid #dde2e8;font-size:13px;color:#3d4756';
const TD = 'padding:6px 8px;border-bottom:1px solid #eef1f4;font-size:13px;color:#1b2430;vertical-align:top';

/** Contenu de l'e-mail : le rapport mis en forme (100 lignes au plus ; le fichier joint contient tout). */
function renderResult(result, appUrl) {
  const lines = [];
  let html = '';
  if (result.type === 'list') {
    const rows = result.rows.slice(0, 100);
    html += `<table style="border-collapse:collapse;width:100%"><tr>${result.columns.map((c) => `<th style="${TH}">${escapeHtml(c.label)}</th>`).join('')}</tr>`;
    for (const r of rows) {
      html += `<tr>${result.columns
        .map((c) => {
          let v = /_at$|due_date|_due$/.test(c.key) ? fmtDate(r[c.key]) : fmt(r[c.key]);
          if (c.key === 'title' && appUrl) return `<td style="${TD}"><a href="${escapeHtml(`${appUrl}/tickets/${r.id}`)}" style="color:#2f4bd8">${escapeHtml(v)}</a></td>`;
          if (c.key === 'id') v = `#${String(r.id).padStart(4, '0')}`;
          return `<td style="${TD}">${escapeHtml(v)}</td>`;
        })
        .join('')}</tr>`;
    }
    html += '</table>';
    lines.push(`${result.total} demande(s).`);
    if (result.total > rows.length) lines.push(`Les ${rows.length} premières sont affichées ; le fichier joint contient les ${result.rows.length} lignes du rapport.`);
  } else if (result.type === 'summary' || result.type === 'trend') {
    const max = Math.max(1, ...result.series.flatMap((s) => s.values.map((v) => v || 0)));
    const head = result.type === 'summary' ? result.dimension.label : 'Période';
    html += `<table style="border-collapse:collapse;width:100%"><tr><th style="${TH}">${escapeHtml(head)}</th>${result.series
      .map((s) => `<th style="${TH};text-align:right">${escapeHtml(s.label)}</th>`)
      .join('')}${result.series.length === 1 ? `<th style="${TH}"></th>` : ''}</tr>`;
    result.categories.forEach((c, i) => {
      const v = result.series[0].values[i] || 0;
      html += `<tr><td style="${TD}">${escapeHtml(c.label)}</td>${result.series.map((s) => `<td style="${TD};text-align:right">${escapeHtml(fmt(s.values[i] ?? 0))}</td>`).join('')}${
        result.series.length === 1
          ? `<td style="${TD};width:40%"><div style="background:#2f4bd8;height:10px;border-radius:3px;width:${Math.round((v / max) * 100)}%"></div></td>`
          : ''
      }</tr>`;
    });
    html += '</table>';
  } else if (result.type === 'kpi') {
    const unit = result.metric.unit ? ` ${result.metric.unit}` : '';
    html += `<p style="font-size:32px;font-weight:bold;margin:8px 0;color:#1b2430">${escapeHtml(fmt(result.value))}${unit}</p>`;
    html += `<p style="color:#626e7d;margin:0">${escapeHtml(result.metric.label)}${
      result.previous != null ? `, contre ${escapeHtml(fmt(result.previous))}${unit} sur la période précédente` : ''
    }.</p>`;
  } else if (result.type === 'heatmap') {
    html += `<table style="border-collapse:collapse"><tr><th style="${TH}">Jour</th><th style="${TH};text-align:right">Demandes créées</th></tr>`;
    result.rows.forEach((r, i) => {
      html += `<tr><td style="${TD}">${escapeHtml(r)}</td><td style="${TD};text-align:right">${result.values[i].reduce((a, b) => a + b, 0)}</td></tr>`;
    });
    html += '</table>';
    lines.push('Le détail heure par heure est dans le fichier joint.');
  }
  return { html, lines };
}

const isEmpty = (r) =>
  r.type === 'list' ? r.total === 0 : r.type === 'kpi' ? !r.value : r.type === 'heatmap' ? r.total === 0 : r.series.every((s) => s.values.every((v) => !v));

async function scheduleRecipients(db, scheduleId) {
  return db.all(
    `SELECT DISTINCT u.* FROM users u WHERE u.anonymized_at IS NULL AND (
       u.id IN (SELECT user_id FROM report_schedule_users WHERE schedule_id = ?)
       OR u.id IN (SELECT m.user_id FROM group_members m JOIN report_schedule_groups g ON g.group_id = m.group_id WHERE g.schedule_id = ?))`,
    [scheduleId, scheduleId]
  );
}

const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'rapport';

/**
 * Fait un envoi. Renvoie { status, sent, skipped, error }. `force` : envoi à la demande (« Envoyer maintenant »).
 */
async function sendSchedule(db, mailer, scheduleId, { now = new Date(), logger = console } = {}) {
  const s = await db.get(
    `SELECT s.*, r.name AS report_name, r.description AS report_description, r.definition FROM report_schedules s
     JOIN reports r ON r.id = s.report_id WHERE s.id = ?`,
    [scheduleId]
  );
  if (!s) return null;
  const record = async (status, sent, skipped, error = null) => {
    await db.run('INSERT INTO report_runs (schedule_id, ran_at, status, sent, skipped, error) VALUES (?, ?, ?, ?, ?, ?)', [
      s.id,
      now.toISOString(),
      status,
      sent,
      JSON.stringify(skipped),
      error,
    ]);
    await db.run('DELETE FROM report_runs WHERE schedule_id = ? AND id NOT IN (SELECT id FROM report_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 30)', [s.id, s.id]);
    return { status, sent, skipped, error };
  };

  const creator = await loadActor(db, s.owner_id);
  if (!creator) {
    await db.run("UPDATE report_schedules SET active = 0, disabled_reason = 'Compte du créateur supprimé' WHERE id = ?", [s.id]);
    return record('error', 0, [], 'Le compte du créateur n’existe plus : envoi arrêté.');
  }
  const mail = await getMailSettings(db);
  if (!mailer.configured || mail.enabled === false) return record('error', 0, [], 'Les e-mails ne sont pas configurés ou sont désactivés dans l’Administration.');

  let result;
  try {
    result = await runReport(db, JSON.parse(s.definition), creator);
  } catch (err) {
    logger.error(`Rapport programmé n°${s.id} : ${err.message}`);
    return record('error', 0, [], `Le rapport ne peut pas être calculé : ${err.message}`);
  }
  if (s.skip_empty && isEmpty(result)) return record('empty', 0, []);

  const def = JSON.parse(s.definition);
  const people = await scheduleRecipients(db, s.id);
  if (s.include_self && !people.some((p) => p.id === creator.id)) {
    const me = await db.get('SELECT * FROM users WHERE id = ?', [creator.id]);
    people.push(me);
  }
  const skipped = [];
  const appUrl = (mail.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  const { html: body, lines } = renderResult(result, appUrl);
  const csv = toCsv(result);
  const fileName = `rapport-${slug(s.report_name)}-${now.toISOString().slice(0, 10)}.csv`;
  const prefix = mail.subjectPrefix ? `${mail.subjectPrefix} ` : '';
  const owner = shownName(creator);
  let sent = 0;

  for (const p of people) {
    const name = shownName(p);
    if (!p.email) {
      skipped.push({ name, reason: 'pas d’adresse e-mail' });
      continue;
    }
    const self = p.id === creator.id;
    if (!p.notify_email || (!self && !parseNotifyPrefs(p.notify_prefs).reports)) {
      skipped.push({ name, reason: 'a choisi de ne pas recevoir ces e-mails' });
      continue;
    }
    const actor = self ? creator : await loadActor(db, p.id);
    if (!actor || !(await recipientCanSee(db, def, creator, actor))) {
      skipped.push({ name, reason: 'ne voit pas toutes les demandes du rapport' });
      continue;
    }
    const intro = self ? 'Voici votre rapport programmé' : `${owner} vous envoie ce rapport`;
    const text = [
      `Bonjour ${p.firstname || p.username},`,
      '',
      `${intro} : « ${s.report_name} » (${result.period || 'depuis le début'}).`,
      ...(s.message ? ['', s.message] : []),
      '',
      ...lines,
      'Le détail est dans le fichier joint (à ouvrir avec un tableur).',
      ...(appUrl ? ['', `Ouvrir dans Xchange : ${appUrl}/analyses/rapports/${s.report_id}`] : []),
      '',
      '--',
      `Envoi programmé ${describeFrequency(s)} par ${owner}.`,
      'Pour ne plus recevoir les rapports des autres : « Mon compte », Notifications.',
      ...(mail.footer ? [mail.footer] : []),
    ].join('\n');
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1b2430;line-height:1.5;max-width:760px">
<p>Bonjour ${escapeHtml(p.firstname || p.username)},</p>
<p>${escapeHtml(intro)} : <strong>${escapeHtml(s.report_name)}</strong> <span style="color:#626e7d">(${escapeHtml(result.period || 'depuis le début')})</span>.</p>
${s.report_description ? `<p style="color:#3d4756">${escapeHtml(s.report_description)}</p>` : ''}
${s.message ? `<p style="white-space:pre-line;border-left:3px solid #dde2e8;padding-left:10px">${escapeHtml(s.message)}</p>` : ''}
${body}
${lines.map((l) => `<p style="color:#626e7d;font-size:13px">${escapeHtml(l)}</p>`).join('')}
${appUrl ? `<p><a href="${escapeHtml(`${appUrl}/analyses/rapports/${s.report_id}`)}" style="display:inline-block;background:#2f4bd8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Ouvrir dans Xchange</a></p>` : ''}
<p style="color:#626e7d;font-size:12px;border-top:1px solid #dde2e8;padding-top:10px;white-space:pre-line">${escapeHtml(
      [`Envoi programmé ${describeFrequency(s)} par ${owner}. Le détail est dans le fichier joint.`, 'Pour ne plus recevoir les rapports des autres : « Mon compte », Notifications.', mail.footer]
        .filter(Boolean)
        .join('\n')
    )}</p></div>`;
    try {
      await mailer.send(
        { to: p.email, subject: `${prefix}Rapport : ${s.report_name}`, text, html, attachments: [{ filename: fileName, content: csv, contentType: 'text/csv; charset=utf-8' }] },
        { event: 'report', userId: p.id }
      );
      sent += 1;
    } catch (err) {
      skipped.push({ name, reason: 'erreur d’envoi' });
      logger.error(`Rapport programmé n°${s.id} : envoi impossible (compte n°${p.id}) : ${err.message}`);
    }
  }
  return record(sent ? 'ok' : 'error', sent, skipped, sent ? null : 'Aucun destinataire n’a pu recevoir le rapport.');
}

/** Vérifie toutes les minutes les envois arrivés à échéance (un PC éteint rattrape un seul envoi au démarrage). */
function startReportScheduler({ db, mailer, logger = console, intervalMs = 60_000 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const due = await db.all('SELECT * FROM report_schedules WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?', [now.toISOString()]);
      for (const s of due) {
        await db.run('UPDATE report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?', [now.toISOString(), nextRun(s, now).toISOString(), s.id]);
        try {
          await sendSchedule(db, mailer, s.id, { now, logger });
        } catch (err) {
          logger.error(`Rapport programmé n°${s.id} : ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Envois programmés : ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  return () => clearInterval(timer);
}

module.exports = { shownName, FREQUENCIES, MAX_USERS, MAX_GROUPS, nextRun, describeFrequency, sendSchedule, startReportScheduler, renderResult, isEmpty };

const express = require('express');
const { refreshSla } = require('../sla');
const { HttpError, parseId, nowIso } = require('../utils');
const { validateItemInput, validateSubmission, describeAnswers } = require('../catalog');
const { addEvent, MY_GROUPS_SQL } = require('../tickets');
const { canCreate } = require('../access');
const { loadTicketDetail, defaultDueDate } = require('./tickets');

function parseFields(text) {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function loadItems(db, where = '1 = 1', params = []) {
  const rows = await db.all(
    `SELECT ci.*, g.name AS group_name,
       (SELECT COUNT(*) FROM tickets t WHERE t.catalog_item = ci.id AND t.deleted_at IS NULL) AS ticket_count
     FROM catalog_items ci LEFT JOIN user_groups g ON g.id = ci.fulfillment_group
     WHERE ${where}
     ORDER BY ci.section = '' ASC, ci.section COLLATE NOCASE, ci.name COLLATE NOCASE`,
    params
  );
  const vis = await db.all(
    `SELECT v.item_id, g.id, g.name FROM catalog_visibility v JOIN user_groups g ON g.id = v.group_id
     ORDER BY g.name COLLATE NOCASE`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    section: r.section,
    priority: r.priority,
    category: r.category || '',
    active: Boolean(r.active),
    fulfillment_group: r.fulfillment_group && r.group_name ? { id: r.fulfillment_group, name: r.group_name } : null,
    visible_groups: vis.filter((v) => v.item_id === r.id).map((v) => ({ id: v.id, name: v.name })),
    fields: parseFields(r.fields),
    ticket_count: r.ticket_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/**
 * Formulaires qu'un utilisateur peut remplir : actifs, et visibles par tous
 * ou par un de ses groupes. Un administrateur les voit tous.
 */
function visibleWhere(user) {
  if (user.role === 'admin') return { sql: 'ci.active = 1', params: [] };
  return {
    sql: `ci.active = 1 AND (
      NOT EXISTS (SELECT 1 FROM catalog_visibility v WHERE v.item_id = ci.id)
      OR EXISTS (SELECT 1 FROM catalog_visibility v WHERE v.item_id = ci.id AND v.group_id IN (${MY_GROUPS_SQL})))`,
    params: [user.id],
  };
}

/** Catalogue côté demandeur. */
function catalogRoutes({ db, notifier }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const w = visibleWhere(req.user);
    const items = await loadItems(db, w.sql, w.params);
    // « Les plus demandés » : nombre d'envois de chaque formulaire sur 90 jours (un total, sans nom).
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const counts = new Map(
      (await db.all('SELECT catalog_item AS id, COUNT(*) AS n FROM tickets WHERE catalog_item IS NOT NULL AND created_at >= ? GROUP BY catalog_item', [since])).map(
        (r) => [r.id, r.n]
      )
    );
    // Le demandeur n'a pas besoin des réglages internes.
    res.json(items.map(({ visible_groups: _v, ticket_count: _c, ...item }) => ({ ...item, popularity: counts.get(item.id) || 0 })));
  });

  async function findVisible(user, id) {
    const w = visibleWhere(user);
    const [item] = await loadItems(db, `ci.id = ? AND ${w.sql}`, [id, ...w.params]);
    if (!item) throw new HttpError(404, "Ce formulaire n'existe pas ou ne vous est pas proposé.");
    return item;
  }

  router.get('/:id', async (req, res) => {
    const { visible_groups: _v, ticket_count: _c, ...item } = await findVisible(req.user, parseId(req.params.id, 'Formulaire'));
    res.json(item);
  });

  // Envoi d'un formulaire : crée le ticket, affecté au groupe qui traite ce formulaire.
  router.post('/:id/submit', async (req, res) => {
    if (!canCreate(req.user)) throw new HttpError(403, "Votre compte ne peut pas créer de demande. Demandez-le à un administrateur.");
    const item = await findVisible(req.user, parseId(req.params.id, 'Formulaire'));
    const confidential = (req.body || {}).confidential === true;
    const answers = validateSubmission(item.fields, (req.body || {}).answers || {});

    const titleField = item.fields.find((f) => f.inTitle);
    const titleAnswer = titleField && answers.find((a) => a.key === titleField.key)?.value;
    const title = (titleAnswer ? `${item.name} : ${titleAnswer}` : item.name).slice(0, 200);
    const description = describeAnswers(item.name, answers).slice(0, 10000);
    const group = item.fulfillment_group?.id ?? null;

    const now = nowIso();
    const due = await defaultDueDate(db, item.priority);
    const { lastID } = await db.run(
      `INSERT INTO tickets
        (title, description, priority, category, due_date, status, created_at, updated_at, created_by,
         assigned_group, catalog_item, form_answers, confidential)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, item.priority, item.category || '', due, now, now, req.user.id, group, item.id,
        JSON.stringify(answers), confidential ? 1 : 0]
    );
    await addEvent(db, lastID, req.user.id, 'created', null, item.name, now);
    if (group) await addEvent(db, lastID, req.user.id, 'group', null, group, now);
    if (group && notifier) notifier.ticketCreated(lastID, req.user.id);
    await refreshSla(db, lastID);
    res.status(201).json(await loadTicketDetail(db, req.user, lastID));
  });

  return router;
}

/** Gestion du catalogue, réservée aux administrateurs. */
function catalogAdminRoutes({ db }) {
  const router = express.Router();

  const findItem = async (id) => {
    const [item] = await loadItems(db, 'ci.id = ?', [id]);
    if (!item) throw new HttpError(404, 'Formulaire introuvable.');
    return item;
  };

  async function checkGroups(values) {
    const ids = [...(values.visible_groups || []), ...(values.fulfillment_group ? [values.fulfillment_group] : [])];
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const found = await db.all(`SELECT id FROM user_groups WHERE id IN (${unique.map(() => '?').join(',')})`, unique);
    if (found.length !== unique.length) {
      throw new HttpError(400, "Un des groupes choisis n'existe plus. Actualisez la page.");
    }
  }

  async function setVisibility(id, groups) {
    await db.run('DELETE FROM catalog_visibility WHERE item_id = ?', [id]);
    for (const g of groups) await db.run('INSERT INTO catalog_visibility (item_id, group_id) VALUES (?, ?)', [id, g]);
  }

  router.get('/', async (req, res) => {
    res.json(await loadItems(db));
  });

  router.get('/:id', async (req, res) => {
    res.json(await findItem(parseId(req.params.id, 'Formulaire')));
  });

  router.post('/', async (req, res) => {
    const v = validateItemInput(req.body || {});
    await checkGroups(v);
    const now = nowIso();
    const { lastID } = await db.run(
      `INSERT INTO catalog_items (name, description, section, priority, category, active, fulfillment_group, fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.name, v.description, v.section, v.priority, v.category, v.active ? 1 : 0, v.fulfillment_group, JSON.stringify(v.fields), now, now]
    );
    await setVisibility(lastID, v.visible_groups);
    res.status(201).json(await findItem(lastID));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Formulaire');
    await findItem(id);
    const v = validateItemInput(req.body || {}, { partial: true });
    await checkGroups(v);
    const columns = ['name', 'description', 'section', 'priority', 'category', 'active', 'fulfillment_group', 'fields'].filter((c) => c in v);
    const value = (c) => (c === 'active' ? (v.active ? 1 : 0) : c === 'fields' ? JSON.stringify(v.fields) : v[c]);
    await db.run(
      `UPDATE catalog_items SET ${[...columns, 'updated_at'].map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...columns.map(value), nowIso(), id]
    );
    if (v.visible_groups) await setVisibility(id, v.visible_groups);
    res.json(await findItem(id));
  });

  router.post('/:id/duplicate', async (req, res) => {
    const item = await findItem(parseId(req.params.id, 'Formulaire'));
    const now = nowIso();
    const { lastID } = await db.run(
      `INSERT INTO catalog_items (name, description, section, priority, category, active, fulfillment_group, fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [`${item.name} (copie)`.slice(0, 120), item.description, item.section, item.priority, item.category, item.fulfillment_group?.id ?? null,
        JSON.stringify(item.fields), now, now]
    );
    await setVisibility(lastID, item.visible_groups.map((g) => g.id));
    res.status(201).json(await findItem(lastID));
  });

  // Les tickets déjà créés gardent leurs réponses.
  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Formulaire');
    await findItem(id);
    await db.run('DELETE FROM catalog_items WHERE id = ?', [id]);
    res.json({ success: true });
  });

  return router;
}

module.exports = { catalogRoutes, catalogAdminRoutes, visibleWhere, loadItems };

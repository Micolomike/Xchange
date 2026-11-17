const express = require('express');
const { logUserEvent } = require('../systemLog');
const { HttpError, parseId, nowIso, displayName } = require('../utils');

function validateGroupInput(body, { partial }) {
  const errors = {};
  const values = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2) errors.name = 'Au moins 2 caractères.';
    else if (name.length > 60) errors.name = '60 caractères maximum.';
    values.name = name;
  }
  if (!partial || has('description')) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > 500) errors.description = '500 caractères maximum.';
    values.description = description;
  }
  if (has('joinable')) values.joinable = Boolean(body.joinable);
  if (has('members')) {
    const list = Array.isArray(body.members) ? body.members : null;
    if (!list || list.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
      errors.members = 'Liste de membres invalide.';
    } else {
      values.members = [...new Set(list.map(Number))];
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Certains champs sont invalides.', errors);
  return values;
}

/** Liste des groupes avec leurs membres : utile à tous pour affecter un ticket. */
async function listGroups(db) {
  const groups = await db.all(`
    SELECT g.*,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_group = g.id AND t.deleted_at IS NULL
         AND t.status IN ('open', 'in_progress')) AS active_count
    FROM user_groups g ORDER BY g.name COLLATE NOCASE`);
  const members = await db.all(`
    SELECT m.group_id, u.id, u.username, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.firstname END AS firstname, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.lastname END AS lastname
    FROM group_members m JOIN users u ON u.id = m.user_id
    ORDER BY firstname COLLATE NOCASE, lastname COLLATE NOCASE, u.username COLLATE NOCASE`);
  const byGroup = new Map(groups.map((g) => [g.id, []]));
  for (const m of members) {
    byGroup.get(m.group_id)?.push({ id: m.id, username: m.username, name: displayName(m) });
  }
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    joinable: Boolean(g.joinable),
    created_at: g.created_at,
    active_count: g.active_count,
    members: byGroup.get(g.id),
  }));
}

/** Demandes d'adhésion, avec le nom du groupe et de la personne. */
async function listRequests(db, where = '1 = 1', params = []) {
  const rows = await db.all(
    `SELECT r.*, g.name AS group_name, u.username, u.firstname, u.lastname,
       d.username AS d_username, d.firstname AS d_firstname, d.lastname AS d_lastname
     FROM group_requests r
     JOIN user_groups g ON g.id = r.group_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN users d ON d.id = r.decided_by
     WHERE ${where} ORDER BY r.created_at DESC, r.id DESC`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    reason: r.reason,
    created_at: r.created_at,
    decided_at: r.decided_at,
    group: { id: r.group_id, name: r.group_name },
    user: { id: r.user_id, username: r.username, name: displayName(r) },
    decided_by: r.d_username
      ? { username: r.d_username, name: displayName({ username: r.d_username, firstname: r.d_firstname, lastname: r.d_lastname }) }
      : null,
  }));
}

/** Crée des demandes d'adhésion (groupes ouverts, pas déjà membre, pas déjà en attente). */
async function requestGroups(db, userId, groupIds, message = '') {
  const created = [];
  for (const id of [...new Set(groupIds.map(Number))]) {
    const group = await db.get('SELECT id, joinable FROM user_groups WHERE id = ?', [id]);
    if (!group) throw new HttpError(404, 'Groupe introuvable.');
    if (!group.joinable) throw new HttpError(403, "Ce groupe n'accepte pas de demandes : un administrateur y ajoute les membres.");
    if (await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [id, userId])) {
      throw new HttpError(409, 'Vous faites déjà partie de ce groupe.');
    }
    if (await db.get("SELECT 1 FROM group_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'", [id, userId])) {
      throw new HttpError(409, 'Une demande est déjà en attente pour ce groupe.');
    }
    const { lastID } = await db.run(
      'INSERT INTO group_requests (group_id, user_id, message, created_at) VALUES (?, ?, ?, ?)',
      [id, userId, message, nowIso()]
    );
    created.push(lastID);
  }
  return created;
}

const cleanMessage = (v) => {
  const m = typeof v === 'string' ? v.trim() : '';
  if (m.length > 500) throw new HttpError(400, 'Message trop long (500 caractères maximum).', { message: '500 caractères maximum.' });
  return m;
};

function groupRoutes({ db, requireAdmin, notifier }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json(await listGroups(db));
  });

  // Pour « Mon compte » : chaque groupe, avec mon appartenance et ma dernière demande.
  router.get('/self', async (req, res) => {
    const groups = await listGroups(db);
    const mine = await listRequests(db, 'r.user_id = ?', [req.user.id]);
    res.json(
      groups
        .map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          joinable: g.joinable,
          member: g.members.some((m) => m.id === req.user.id),
          request: mine.find((r) => r.group.id === g.id) || null,
        }))
        .filter((g) => g.joinable || g.member)
    );
  });

  router.post('/:id/requests', async (req, res) => {
    const id = parseId(req.params.id, 'Groupe');
    const [requestId] = await requestGroups(db, req.user.id, [id], cleanMessage((req.body || {}).message));
    notifier?.joinRequested(requestId);
    await logUserEvent(db, `Demande pour rejoindre le groupe n°${id}`, { subjectId: req.user.id });
    res.status(201).json((await listRequests(db, 'r.id = ?', [requestId]))[0]);
  });

  router.delete('/:id/requests', async (req, res) => {
    const id = parseId(req.params.id, 'Groupe');
    const { changes } = await db.run(
      "UPDATE group_requests SET status = 'cancelled', decided_at = ? WHERE group_id = ? AND user_id = ? AND status = 'pending'",
      [nowIso(), id, req.user.id]
    );
    if (!changes) throw new HttpError(404, 'Aucune demande en attente pour ce groupe.');
    await logUserEvent(db, `Demande pour rejoindre le groupe n°${id} annulée`, { subjectId: req.user.id });
    res.json({ success: true });
  });

  router.post('/:id/leave', async (req, res) => {
    const id = parseId(req.params.id, 'Groupe');
    const { changes } = await db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [id, req.user.id]);
    if (!changes) throw new HttpError(404, 'Vous ne faites pas partie de ce groupe.');
    await logUserEvent(db, `A quitté le groupe n°${id}`, { subjectId: req.user.id });
    res.json({ success: true });
  });

  // Validation par un administrateur.
  router.get('/requests', requireAdmin, async (req, res) => {
    const status = req.query.status === 'all' ? null : 'pending';
    res.json(await listRequests(db, status ? 'r.status = ?' : "r.status <> 'cancelled'", status ? [status] : []));
  });

  async function decide(req, approve) {
    const rid = parseId(req.params.rid, 'Demande');
    const row = await db.get('SELECT * FROM group_requests WHERE id = ?', [rid]);
    if (!row) throw new HttpError(404, 'Demande introuvable.');
    if (row.status !== 'pending') throw new HttpError(409, 'Cette demande a déjà été traitée.');
    const reason = approve ? '' : cleanMessage((req.body || {}).reason);
    await db.run('UPDATE group_requests SET status = ?, reason = ?, decided_at = ?, decided_by = ? WHERE id = ?', [
      approve ? 'approved' : 'rejected',
      reason,
      nowIso(),
      req.user.id,
      rid,
    ]);
    if (approve) await db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)', [row.group_id, row.user_id]);
    notifier?.joinDecided(rid);
    return (await listRequests(db, 'r.id = ?', [rid]))[0];
  }

  router.post('/requests/:rid/approve', requireAdmin, async (req, res) => {
    res.json(await decide(req, true));
  });

  router.post('/requests/:rid/reject', requireAdmin, async (req, res) => {
    res.json(await decide(req, false));
  });

  async function ensureUniqueName(name, exceptId = 0) {
    const taken = await db.get('SELECT id FROM user_groups WHERE name = ? COLLATE NOCASE AND id <> ?', [name, exceptId]);
    if (taken) throw new HttpError(409, 'Un groupe porte déjà ce nom.', { name: 'Déjà utilisé.' });
  }

  async function setMembers(groupId, members) {
    if (members.length) {
      const found = await db.all(
        `SELECT id FROM users WHERE id IN (${members.map(() => '?').join(',')})`,
        members
      );
      if (found.length !== members.length) {
        throw new HttpError(400, "Un des membres choisis n'existe plus. Actualisez la page.", { members: 'Introuvable.' });
      }
    }
    await db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
    for (const userId of members) {
      await db.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, userId]);
    }
  }

  const findGroup = async (id) => {
    const group = (await listGroups(db)).find((g) => g.id === id);
    if (!group) throw new HttpError(404, 'Groupe introuvable.');
    return group;
  };

  router.post('/', requireAdmin, async (req, res) => {
    const values = validateGroupInput(req.body || {}, { partial: false });
    await ensureUniqueName(values.name);
    const { lastID } = await db.run('INSERT INTO user_groups (name, description, joinable, created_at) VALUES (?, ?, ?, ?)', [
      values.name,
      values.description,
      values.joinable === false ? 0 : 1,
      nowIso(),
    ]);
    if (values.members) await setMembers(lastID, values.members);
    res.status(201).json(await findGroup(lastID));
  });

  router.patch('/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id, 'Groupe');
    await findGroup(id);
    const values = validateGroupInput(req.body || {}, { partial: true });
    if ('name' in values) {
      await ensureUniqueName(values.name, id);
      await db.run('UPDATE user_groups SET name = ? WHERE id = ?', [values.name, id]);
    }
    if ('description' in values) await db.run('UPDATE user_groups SET description = ? WHERE id = ?', [values.description, id]);
    if ('joinable' in values) await db.run('UPDATE user_groups SET joinable = ? WHERE id = ?', [values.joinable ? 1 : 0, id]);
    if (values.members) await setMembers(id, values.members);
    res.json(await findGroup(id));
  });

  // Les tickets du groupe restent, sans groupe d'affectation.
  router.delete('/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id, 'Groupe');
    await findGroup(id);
    await db.run('UPDATE tickets SET assigned_group = NULL WHERE assigned_group = ?', [id]);
    await db.run('DELETE FROM user_groups WHERE id = ?', [id]);
    res.json({ success: true });
  });

  return router;
}

module.exports = { groupRoutes, listGroups, requestGroups };

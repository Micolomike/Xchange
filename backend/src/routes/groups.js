const express = require('express');
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
    SELECT m.group_id, u.id, u.username, u.firstname, u.lastname
    FROM group_members m JOIN users u ON u.id = m.user_id
    ORDER BY u.firstname COLLATE NOCASE, u.lastname COLLATE NOCASE, u.username COLLATE NOCASE`);
  const byGroup = new Map(groups.map((g) => [g.id, []]));
  for (const m of members) {
    byGroup.get(m.group_id)?.push({ id: m.id, username: m.username, name: displayName(m) });
  }
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    created_at: g.created_at,
    active_count: g.active_count,
    members: byGroup.get(g.id),
  }));
}

function groupRoutes({ db, requireAdmin }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json(await listGroups(db));
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
    const { lastID } = await db.run('INSERT INTO user_groups (name, description, created_at) VALUES (?, ?, ?)', [
      values.name,
      values.description,
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

module.exports = { groupRoutes, listGroups };

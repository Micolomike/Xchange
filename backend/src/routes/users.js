const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { HttpError, publicUser, validateUserInput, parseId, nowIso } = require('../utils');

function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

async function resetMfa(db, row) {
  await db.run(
    `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_last_step = 0,
       token_version = ? WHERE id = ?`,
    [(row.token_version || 0) + 1, row.id]
  );
  await db.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [row.id]);
}

async function countAdmins(db) {
  const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  return count;
}

/** Gestion des comptes, réservée aux administrateurs. */
function userRoutes({ db }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const rows = await db.all(`
      SELECT u.*,
        (SELECT COUNT(*) FROM tickets t WHERE t.created_by = u.id AND t.deleted_at IS NULL) AS created_count,
        (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to = u.id AND t.deleted_at IS NULL
           AND t.status IN ('open', 'in_progress')) AS assigned_active_count
      FROM users u ORDER BY u.username COLLATE NOCASE`);
    res.json(
      rows.map((r) => ({
        ...publicUser(r),
        created_count: r.created_count,
        assigned_active_count: r.assigned_active_count,
      }))
    );
  });

  router.post('/', async (req, res) => {
    const values = validateUserInput(req.body || {}, { partial: false });
    const exists = await db.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [values.username]);
    if (exists) throw new HttpError(409, "Ce nom d'utilisateur est déjà pris.", { username: 'Déjà utilisé.' });
    const { lastID } = await db.run(
      `INSERT INTO users (username, password, email, firstname, lastname, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        values.username,
        await bcrypt.hash(values.password, 10),
        values.email,
        values.firstname,
        values.lastname,
        values.role || 'user',
        nowIso(),
      ]
    );
    res.status(201).json(publicUser(await db.get('SELECT * FROM users WHERE id = ?', [lastID])));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Utilisateur introuvable.');
    const values = validateUserInput(req.body || {}, { partial: true });

    if (values.username && values.username.toLowerCase() !== row.username.toLowerCase()) {
      const taken = await db.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?', [values.username, id]);
      if (taken) throw new HttpError(409, "Ce nom d'utilisateur est déjà pris.", { username: 'Déjà utilisé.' });
    }
    if (values.role === 'user' && row.role === 'admin' && (await countAdmins(db)) <= 1) {
      throw new HttpError(400, 'Impossible de retirer le dernier administrateur.');
    }

    const updates = {};
    for (const field of ['username', 'email', 'firstname', 'lastname', 'role']) {
      if (field in values) updates[field] = values[field];
    }
    if (values.password) {
      updates.password = await bcrypt.hash(values.password, 10);
      updates.token_version = (row.token_version || 0) + 1;
    }
    const columns = Object.keys(updates);
    if (columns.length) {
      await db.run(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
        ...columns.map((c) => updates[c]),
        id,
      ]);
    }
    res.json(publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])));
  });

  router.post('/:id/reset-password', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Utilisateur introuvable.');
    const password = generatePassword();
    await db.run('UPDATE users SET password = ?, token_version = ? WHERE id = ?', [
      await bcrypt.hash(password, 10),
      (row.token_version || 0) + 1,
      id,
    ]);
    res.json({ success: true, password });
  });

  // Téléphone perdu : la double authentification est remise à zéro, l'utilisateur la reconfigure
  // à sa prochaine connexion. Ses sessions ouvertes sont fermées.
  router.post('/:id/reset-mfa', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Utilisateur introuvable.');
    await resetMfa(db, row);
    res.json({ success: true });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Utilisateur introuvable.');
    if (row.role === 'admin' && (await countAdmins(db)) <= 1) {
      throw new HttpError(400, 'Impossible de supprimer le dernier administrateur.');
    }
    // Les tickets et commentaires sont conservés (auteur / assigné remis à vide par les clés étrangères).
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  });

  return router;
}

module.exports = { userRoutes, generatePassword, resetMfa };

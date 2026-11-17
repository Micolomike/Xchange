const crypto = require('crypto');
const express = require('express');
const { logUserEvent } = require('../systemLog');
const { logSecurity } = require('../security');
const bcrypt = require('bcryptjs');
const { HttpError, publicUser, validateUserInput, parseId, nowIso, displayName } = require('../utils');
const { signImpersonationToken } = require('../middleware/auth');

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
  await db.run('DELETE FROM trusted_devices WHERE user_id = ?', [row.id]);
}

async function countAdmins(db) {
  const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  return count;
}

/** Gestion des comptes, réservée aux administrateurs. */
function userRoutes({ db, config }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const rows = await db.all(`
      SELECT u.*,
        (SELECT COUNT(*) FROM tickets t WHERE t.created_by = u.id AND t.deleted_at IS NULL) AS created_count,
        (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to = u.id AND t.deleted_at IS NULL
           AND t.status IN ('open', 'in_progress')) AS assigned_active_count
      FROM users u WHERE u.anonymized_at IS NULL ORDER BY u.username COLLATE NOCASE`);
    const memberships = await db.all(
      `SELECT m.user_id, g.id, g.name FROM group_members m JOIN user_groups g ON g.id = m.group_id
       ORDER BY g.name COLLATE NOCASE`
    );
    res.json(
      rows.map((r) => ({
        ...publicUser(r),
        created_count: r.created_count,
        assigned_active_count: r.assigned_active_count,
        groups: memberships.filter((m) => m.user_id === r.id).map((m) => ({ id: m.id, name: m.name })),
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
    await logUserEvent(db, `Compte créé par un administrateur${values.role === 'admin' ? ' (administrateur)' : ''}`, { subjectId: lastID, actorId: req.user.id });
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
    await logSecurity(db, id, 'mfa_reset', { actorId: req.user.id });
    res.json({ success: true });
  });

  // Dispense de double authentification (personnes sans smartphone) : la configuration existante
  // est effacée et les sessions fermées. Retirer la dispense ferme aussi les sessions : la personne
  // configurera son appli à sa prochaine connexion.
  router.post('/:id/mfa-exempt', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Utilisateur introuvable.');
    const exempt = (req.body || {}).exempt;
    if (typeof exempt !== 'boolean') throw new HttpError(400, 'Indiquez exempt : true ou false.');
    if (exempt) await resetMfa(db, row);
    else await db.run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [id]);
    await db.run('UPDATE users SET mfa_exempt = ?, mfa_exempt_by = ?, mfa_exempt_at = ? WHERE id = ?', [
      exempt ? 1 : 0,
      exempt ? 'admin' : null,
      exempt ? nowIso() : null,
      id,
    ]);
    await logSecurity(db, id, exempt ? 'mfa_exempted' : 'mfa_exemption_removed', { actorId: req.user.id });
    res.json(publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])));
  });

  // Se mettre à la place d'un utilisateur (non administrateur) pendant une heure au plus.
  router.post('/:id/impersonate', async (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Vous êtes déjà sur votre propre compte.');
    const target = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw new HttpError(404, 'Utilisateur introuvable.');
    if (target.role === 'admin') throw new HttpError(403, "Impossible de se mettre à la place d'un autre administrateur.");
    const admin = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    await db.run('INSERT INTO impersonations (admin_id, target_id, started_at) VALUES (?, ?, ?)', [admin.id, target.id, nowIso()]);
    res.json({ token: signImpersonationToken(target, admin, config), user: publicUser(target) });
  });

  router.get('/impersonations', async (req, res) => {
    const rows = await db.all(
      `SELECT i.id, i.started_at, i.ended_at,
         a.username AS a_username, a.firstname AS a_firstname, a.lastname AS a_lastname,
         t.username AS t_username, t.firstname AS t_firstname, t.lastname AS t_lastname
       FROM impersonations i
       LEFT JOIN users a ON a.id = i.admin_id
       LEFT JOIN users t ON t.id = i.target_id
       ORDER BY i.started_at DESC LIMIT 50`
    );
    const name = (r, p) => (r[`${p}_username`] ? displayName({ username: r[`${p}_username`], firstname: r[`${p}_firstname`], lastname: r[`${p}_lastname`] }) : 'Compte supprimé');
    res.json(rows.map((r) => ({ id: r.id, started_at: r.started_at, ended_at: r.ended_at, admin: name(r, 'a'), target: name(r, 't') })));
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

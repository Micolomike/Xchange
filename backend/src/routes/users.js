const crypto = require('crypto');
const express = require('express');
const { logUserEvent } = require('../systemLog');
const { logSecurity, SECURITY_LABELS } = require('../security');
const { NOTIFY_PREFS, NOTIFY_LABELS, parseNotifyPrefs } = require('../utils');
const { EVENT_LABELS } = require('../mailer');
const { RGPD_TYPES } = require('../rgpdRequests');
const { getMailSettings } = require('../settings');
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

  // Fiche complète d'un compte pour l'administrateur : identité, sécurité, notifications, groupes,
  // demandes, analyses, RGPD, e-mails reçus et activité récente. Jamais de mot de passe ni de secret.
  // Une demande confidentielle dont l'administrateur ne fait pas partie reste masquée (ni titre ni lien).
  router.get('/:id/overview', async (req, res) => {
    const id = parseId(req.params.id, 'Compte');
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Compte introuvable.');
    const me = req.user;
    const myGroups = (await db.all('SELECT group_id FROM group_members WHERE user_id = ?', [me.id])).map((r) => r.group_id);
    const canSee = (t) => !t.confidential || t.created_by === me.id || t.assigned_to === me.id || myGroups.includes(t.assigned_group);
    const ticketRow = (t) =>
      canSee(t)
        ? { id: t.id, title: t.title, status: t.status, priority: t.priority, created_at: t.created_at, updated_at: t.updated_at, confidential: Boolean(t.confidential), group: t.group_name }
        : { id: null, title: 'Demande confidentielle', status: t.status, priority: t.priority, created_at: t.created_at, updated_at: t.updated_at, confidential: true, hidden: true };
    const TICKET_SELECT = `SELECT t.id, t.title, t.status, t.priority, t.created_at, t.updated_at, t.confidential, t.created_by, t.assigned_to, t.assigned_group,
        g.name AS group_name FROM tickets t LEFT JOIN user_groups g ON g.id = t.assigned_group`;

    const count = async (sql, params = [id]) => (await db.get(sql, params)).n;
    const mail = await getMailSettings(db);
    const prefs = parseNotifyPrefs(row.notify_prefs);
    const isAdmin = row.role === 'admin';
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();

    const groups = await db.all(
      `SELECT g.id, g.name, (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS members
       FROM group_members m JOIN user_groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY g.name COLLATE NOCASE`,
      [id]
    );
    const lastLogin = await db.get(
      "SELECT created_at, message FROM system_logs WHERE source = 'utilisateurs' AND subject_id = ? AND message LIKE 'Connexion%' ORDER BY id DESC LIMIT 1",
      [id]
    );

    res.json({
      user: {
        ...publicUser(row),
        real_firstname: row.firstname || '',
        real_lastname: row.lastname || '',
        anonymized_at: row.anonymized_at || null,
        inactivity_warned_at: row.inactivity_warned_at || null,
        chat_retention_days: row.chat_retention_days || 0,
      },
      security: {
        mfa_enabled: Boolean(row.mfa_enabled),
        mfa_exempt: Boolean(row.mfa_exempt),
        recovery_codes_left: await count('SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL'),
        trusted_devices: await db.all(
          'SELECT label, created_at, last_used_at, expires_at FROM trusted_devices WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
          [id, nowIso()]
        ),
        last_login: lastLogin || null,
        failed_logins_30d: await count(
          "SELECT COUNT(*) AS n FROM system_logs WHERE source = 'utilisateurs' AND subject_id = ? AND message LIKE 'Échec de connexion%' AND created_at >= ?",
          [id, since30]
        ),
        events: (await db.all('SELECT type, detail, created_at FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT 10', [id])).map((e) => ({
          ...e,
          label: SECURITY_LABELS[e.type] || e.type,
        })),
        impersonations: await db.all(
          `SELECT i.started_at, i.ended_at, a.username AS admin FROM impersonations i LEFT JOIN users a ON a.id = i.admin_id
           WHERE i.target_id = ? ORDER BY i.id DESC LIMIT 5`,
          [id]
        ),
      },
      notifications: {
        // Ce que la personne recevra : il faut une adresse, les e-mails activés, et le choix correspondant.
        has_email: Boolean(row.email),
        email_enabled: Boolean(row.notify_email),
        global_enabled: mail.enabled !== false,
        prefs: NOTIFY_PREFS.filter((k) => k !== 'admin' || isAdmin).map((k) => ({ key: k, label: NOTIFY_LABELS[k], on: prefs[k] })),
        sent_30d: await count("SELECT COUNT(*) AS n FROM mail_log WHERE user_id = ? AND status = 'sent' AND created_at >= ?", [id, since30]),
        errors_30d: await count("SELECT COUNT(*) AS n FROM mail_log WHERE user_id = ? AND status = 'error' AND created_at >= ?", [id, since30]),
        recent: (await db.all('SELECT created_at, event, subject, status, error FROM mail_log WHERE user_id = ? ORDER BY id DESC LIMIT 15', [id])).map((m) => ({
          ...m,
          event_label: EVENT_LABELS[m.event] || m.event,
        })),
      },
      groups,
      group_requests: (
        await db.all(
          `SELECT r.status, r.created_at, r.decided_at, r.reason, g.name AS group_name FROM group_requests r JOIN user_groups g ON g.id = r.group_id
           WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 10`,
          [id]
        )
      ),
      tickets: {
        created_total: await count('SELECT COUNT(*) AS n FROM tickets WHERE created_by = ? AND deleted_at IS NULL'),
        created_open: await count("SELECT COUNT(*) AS n FROM tickets WHERE created_by = ? AND deleted_at IS NULL AND status IN ('open', 'in_progress')"),
        assigned_open: await count("SELECT COUNT(*) AS n FROM tickets WHERE assigned_to = ? AND deleted_at IS NULL AND status IN ('open', 'in_progress')"),
        resolved_by: await count("SELECT COUNT(*) AS n FROM tickets WHERE assigned_to = ? AND deleted_at IS NULL AND status IN ('resolved', 'closed')"),
        comments: await count('SELECT COUNT(*) AS n FROM comments WHERE author_id = ?'),
        recent_created: (await db.all(`${TICKET_SELECT} WHERE t.created_by = ? AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 8`, [id])).map(ticketRow),
        assigned: (
          await db.all(`${TICKET_SELECT} WHERE t.assigned_to = ? AND t.deleted_at IS NULL AND t.status IN ('open', 'in_progress') ORDER BY t.updated_at DESC LIMIT 8`, [id])
        ).map(ticketRow),
      },
      analyses: {
        reports: await count('SELECT COUNT(*) AS n FROM reports WHERE owner_id = ?'),
        dashboards: await count('SELECT COUNT(*) AS n FROM dashboards WHERE owner_id = ?'),
        schedules: await count('SELECT COUNT(*) AS n FROM report_schedules WHERE owner_id = ? AND active = 1'),
      },
      rgpd: (await db.all('SELECT type, status, created_at, handled_at FROM rgpd_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10', [id])).map((r) => ({
        ...r,
        label: RGPD_TYPES[r.type] || r.type,
      })),
      activity: await db.all(
        `SELECT level, source, message, created_at FROM system_logs WHERE subject_id = ? OR actor_id = ? ORDER BY id DESC LIMIT 15`,
        [id, id]
      ),
    });
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

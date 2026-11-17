const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { getSetting } = require('../settings');
const { exportUser } = require('../rgpd');
const { syncTerms, acceptTerms } = require('../terms');
const { RGPD_TYPES, dueDate } = require('../rgpdRequests');
const { exportFileName } = require('./rgpd');
const { displayName, HttpError, publicUser, validateUserInput, nowIso, NOTIFY_PREFS, parseNotifyPrefs } = require('../utils');
const QRCode = require('qrcode');
const { signToken, signChallenge, verifyChallenge, readSession, forbidImpersonation } = require('../middleware/auth');
const mfa = require('../mfa');
const { logSecurity, trustDevice, checkTrustedDevice } = require('../security');
const { requestGroups } = require('./groups');

// Haché factice : rend le temps de réponse identique que l'utilisateur existe ou non.
const DUMMY_HASH = bcrypt.hashSync('xchange-dummy-password', 10);

/**
 * Verrouille temporairement un nom d'utilisateur après trop d'échecs de connexion.
 * Ne dépend pas de l'adresse IP : protège même derrière un tunnel ou un proxy.
 */
function createLoginGuard({ maxFailures, lockMinutes }) {
  const windowMs = lockMinutes * 60 * 1000;
  const entries = new Map();
  const key = (username) => String(username).trim().toLowerCase();

  function prune(now) {
    if (entries.size < 1000) return;
    for (const [k, e] of entries) if (now - e.first > windowMs && (!e.lockedUntil || e.lockedUntil < now)) entries.delete(k);
  }

  return {
    check(username) {
      const e = entries.get(key(username));
      if (e?.lockedUntil && e.lockedUntil > Date.now()) {
        const minutes = Math.ceil((e.lockedUntil - Date.now()) / 60000);
        throw new HttpError(429, `Trop de tentatives sur ce compte. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`);
      }
    },
    fail(username) {
      const now = Date.now();
      prune(now);
      const k = key(username);
      let e = entries.get(k);
      if (!e || now - e.first > windowMs) e = { first: now, count: 0, lockedUntil: 0 };
      e.count += 1;
      if (e.count >= maxFailures) e.lockedUntil = now + windowMs;
      entries.set(k, e);
    },
    succeed(username) {
      entries.delete(key(username));
    },
  };
}

function authRoutes({ db, config, authenticate, notifier }) {
  const router = express.Router();
  const guard = createLoginGuard({ maxFailures: config.loginMaxFailures, lockMinutes: config.loginLockMinutes });
  const codeGuard = createLoginGuard({ maxFailures: config.loginMaxFailures, lockMinutes: config.loginLockMinutes });

  /** Réponse après un mot de passe correct : session, ou étape de double authentification. */
  function afterPassword(row) {
    if (row.mfa_enabled) return { mfaRequired: true, mfaToken: signChallenge(row, config, 'mfa'), user: publicUser(row) };
    if (config.mfaRequired && !row.mfa_exempt) {
      return { mfaSetupRequired: true, setupToken: signChallenge(row, config, 'setup'), user: publicUser(row) };
    }
    return { token: signToken(row, config, { mfa: false }), user: publicUser(row) };
  }

  async function newRecoveryCodes(userId) {
    const codes = mfa.generateRecoveryCodes();
    await db.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    for (const code of codes) {
      await db.run('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)', [userId, mfa.hashRecoveryCode(code)]);
    }
    return codes;
  }

  async function recoveryCodesLeft(userId) {
    const { n } = await db.get('SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
    return n;
  }

  /** Utilisateur qui configure son appli : jeton d'étape « setup », ou session d'un compte encore sans MFA. */
  async function setupUser(req) {
    const body = req.body || {};
    if (body.setupToken) return verifyChallenge(body.setupToken, 'setup', { db, config });
    const session = await readSession(req, { db, config });
    if (!session) throw new HttpError(401, 'Cette étape a expiré : reconnectez-vous.');
    if (session.impersonator) throw new HttpError(403, "Impossible pendant que vous êtes à la place d'un utilisateur.");
    return session.row;
  }

  const limiter = config.rateLimit
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
      })
    : (req, res, next) => next();

  router.get('/config', async (req, res) => {
    // Groupes ouverts aux demandes, proposés dès l'inscription.
    const joinableGroups = config.allowRegistration
      ? await db.all('SELECT id, name, description FROM user_groups WHERE joinable = 1 ORDER BY name COLLATE NOCASE')
      : [];
    res.json({ registrationOpen: config.allowRegistration, joinableGroups, trustedDeviceDays: config.trustedDeviceDays });
  });

  router.post('/register', limiter, async (req, res) => {
    if (!config.allowRegistration) {
      throw new HttpError(403, "Les inscriptions sont fermées. Demandez un compte à un administrateur.");
    }
    const values = validateUserInput(req.body || {}, { partial: false });
    const rgpd = await getSetting(db, 'rgpd');
    if (rgpd.requireTerms !== false && req.body?.acceptTerms !== true) {
      throw new HttpError(400, 'Acceptez la charte et la politique de confidentialité pour créer un compte.', {
        acceptTerms: 'Obligatoire pour créer un compte.',
      });
    }
    const exists = await db.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [values.username]);
    if (exists) throw new HttpError(409, "Ce nom d'utilisateur est déjà pris.", { username: 'Déjà utilisé.' });

    // Le tout premier compte devient administrateur.
    const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    const role = count === 0 ? 'admin' : 'user';
    const hash = await bcrypt.hash(values.password, 10);
    const { lastID } = await db.run(
      `INSERT INTO users (username, password, email, firstname, lastname, role, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [values.username, hash, values.email, values.firstname, values.lastname, role, nowIso(), nowIso()]
    );
    if (req.body?.acceptTerms === true) await acceptTerms(db, lastID, (await syncTerms(db)).version);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [lastID]);
    // Groupes choisis à l'inscription : des demandes à valider par un administrateur.
    const wanted = Array.isArray(req.body.groups) ? req.body.groups.filter((id) => Number.isInteger(Number(id))) : [];
    if (wanted.length) {
      const open = (await db.all('SELECT id FROM user_groups WHERE joinable = 1')).map((g) => g.id);
      const ids = await requestGroups(db, row.id, wanted.map(Number).filter((id) => open.includes(id)), '');
      for (const rid of ids) notifier?.joinRequested(rid);
    }
    res.status(201).json(afterPassword(row));
  });

  router.post('/login', limiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new HttpError(400, "Nom d'utilisateur et mot de passe requis.");
    }
    guard.check(username);
    const row = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username.trim()]);
    const valid = await bcrypt.compare(password, row ? row.password : DUMMY_HASH);
    if (!row || !valid) {
      guard.fail(username);
      throw new HttpError(401, 'Identifiants invalides.');
    }
    guard.succeed(username);
    // Navigateur de confiance : pas de code demandé jusqu'à l'expiration.
    if (row.mfa_enabled && (await checkTrustedDevice(db, row, req.body.deviceToken))) {
      return res.json({ token: signToken(row, config, { mfa: true }), user: publicUser(row), trustedDevice: true });
    }
    res.json({ ...afterPassword(row), ...(req.body.deviceToken ? { deviceRejected: true } : {}) });
  });

  // Deuxième étape de la connexion : code de l'appli, ou code de secours.
  router.post('/mfa/verify', limiter, async (req, res) => {
    const body = req.body || {};
    const row = await verifyChallenge(body.mfaToken, 'mfa', { db, config });
    const key = `mfa:${row.id}`;
    codeGuard.check(key);

    let usedRecoveryCode = false;
    const step = mfa.verifyTotp(row.mfa_secret, body.code, row.mfa_last_step);
    if (step) {
      await db.run('UPDATE users SET mfa_last_step = ? WHERE id = ?', [step, row.id]);
    } else {
      const hash = mfa.hashRecoveryCode(body.code);
      const recovery = mfa.normalizeRecoveryCode(body.code).length === 8
        ? await db.get('SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [row.id, hash])
        : null;
      if (!recovery) {
        codeGuard.fail(key);
        throw new HttpError(401, 'Code incorrect ou déjà utilisé.');
      }
      await db.run('UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ?', [nowIso(), recovery.id]);
      usedRecoveryCode = true;
    }
    codeGuard.succeed(key);
    const device = body.remember === true ? await trustDevice(db, row, { days: config.trustedDeviceDays, userAgent: req.get('user-agent') }) : null;
    res.json({
      token: signToken(row, config, { mfa: true }),
      user: publicUser(row),
      usedRecoveryCode,
      recoveryCodesLeft: await recoveryCodesLeft(row.id),
      ...(device ? { deviceToken: device.token, deviceExpiresAt: device.expiresAt } : {}),
    });
  });

  // Refus de la double authentification par la personne elle-même, en connaissance des risques (tracé).
  // Les administrateurs ne peuvent pas refuser : leur compte donne accès à tout.
  router.post('/mfa/decline', limiter, async (req, res) => {
    const row = await setupUser(req);
    if (row.mfa_enabled) throw new HttpError(400, 'La double authentification est déjà activée sur ce compte.');
    if (row.role === 'admin') {
      throw new HttpError(403, 'Un compte administrateur doit utiliser la double authentification : il donne accès à toutes les données.');
    }
    if ((req.body || {}).acknowledge !== true) {
      throw new HttpError(400, 'Cochez la case pour confirmer que vous avez compris les risques.', { acknowledge: 'Obligatoire.' });
    }
    const now = nowIso();
    await db.run(
      "UPDATE users SET mfa_exempt = 1, mfa_exempt_by = 'self', mfa_exempt_at = ?, mfa_pending_secret = NULL WHERE id = ?",
      [now, row.id]
    );
    await logSecurity(db, row.id, 'mfa_declined', { actorId: row.id, detail: 'Risques affichés et acceptés par la personne' });
    const updated = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    res.json({ token: signToken(updated, config, { mfa: false }), user: publicUser(updated) });
  });

  // Configuration de l'appli : 1) secret + QR code, 2) confirmation par un premier code.
  router.post('/mfa/setup/start', limiter, async (req, res) => {
    const row = await setupUser(req);
    if (row.mfa_enabled) throw new HttpError(400, 'La double authentification est déjà activée sur ce compte.');
    const secret = mfa.generateSecret();
    await db.run('UPDATE users SET mfa_pending_secret = ? WHERE id = ?', [secret, row.id]);
    const otpauthUrl = mfa.otpauthUrl(secret, row.username);
    const qr = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    res.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauthUrl, qr });
  });

  router.post('/mfa/setup/confirm', limiter, async (req, res) => {
    const row = await setupUser(req);
    if (row.mfa_enabled) throw new HttpError(400, 'La double authentification est déjà activée sur ce compte.');
    if (!row.mfa_pending_secret) throw new HttpError(400, 'Recommencez la configuration depuis le début.');
    const key = `mfa:${row.id}`;
    codeGuard.check(key);
    const step = mfa.verifyTotp(row.mfa_pending_secret, (req.body || {}).code, 0);
    if (!step) {
      codeGuard.fail(key);
      throw new HttpError(400, "Code incorrect. Vérifiez que l'heure de votre téléphone est réglée automatiquement.", {
        code: 'Incorrect.',
      });
    }
    codeGuard.succeed(key);
    await db.run(
      `UPDATE users SET mfa_enabled = 1, mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_last_step = ?,
         mfa_exempt = 0, mfa_exempt_by = NULL, mfa_exempt_at = NULL WHERE id = ?`,
      [step, row.id]
    );
    await logSecurity(db, row.id, 'mfa_enabled', { actorId: row.id });
    const recoveryCodes = await newRecoveryCodes(row.id);
    const updated = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    res.json({ token: signToken(updated, config, { mfa: true }), user: publicUser(updated), recoveryCodes });
  });

  // Fin d'une prise de contrôle : le navigateur reprend ensuite la session de l'administrateur.
  router.post('/impersonate/stop', authenticate, async (req, res) => {
    if (!req.user.impersonator) throw new HttpError(400, "Vous n'êtes pas à la place d'un utilisateur.");
    await db.run(
      `UPDATE impersonations SET ended_at = ?
       WHERE id = (SELECT id FROM impersonations WHERE admin_id = ? AND target_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1)`,
      [nowIso(), req.user.impersonator.id, req.user.id]
    );
    res.json({ success: true });
  });

  // Transparence : chaque utilisateur voit quand un administrateur a utilisé son compte.
  router.get('/impersonations', authenticate, forbidImpersonation, async (req, res) => {
    const rows = await db.all(
      `SELECT i.started_at, i.ended_at, u.username, u.firstname, u.lastname
       FROM impersonations i LEFT JOIN users u ON u.id = i.admin_id
       WHERE i.target_id = ? ORDER BY i.started_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({ started_at: r.started_at, ended_at: r.ended_at, admin: r.username ? displayName(r) : 'Administrateur supprimé' })));
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ user: req.user, recoveryCodesLeft: await recoveryCodesLeft(req.user.id) });
  });

  // Droit d'accès et de portabilité : la personne télécharge elle-même ses données.
  router.get('/me/export', authenticate, forbidImpersonation, async (req, res) => {
    const data = await exportUser(db, req.user.id);
    res.set('Content-Disposition', `attachment; filename="${exportFileName(data)}"`);
    res.json(data);
  });

  // Demandes sur ses données personnelles (anonymisation, suppression, rectification, autre).
  router.get('/me/rgpd-requests', authenticate, forbidImpersonation, async (req, res) => {
    const rows = await db.all(
      'SELECT id, type, message, status, response, created_at, handled_at FROM rgpd_requests WHERE user_id = ? ORDER BY id DESC',
      [req.user.id]
    );
    res.json(rows.map((r) => ({ ...r, due_at: dueDate(r.created_at) })));
  });

  router.post('/me/rgpd-requests', authenticate, forbidImpersonation, async (req, res) => {
    const type = String(req.body?.type || '');
    if (!RGPD_TYPES[type]) throw new HttpError(400, 'Choisissez le type de demande.', { type: 'Obligatoire.' });
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (message.length > 2000) throw new HttpError(400, 'Message trop long (2 000 caractères maximum).', { message: 'Trop long.' });
    if (['rectify', 'other'].includes(type) && !message) {
      throw new HttpError(400, 'Précisez votre demande.', { message: 'Expliquez ce que vous souhaitez.' });
    }
    const pending = await db.get("SELECT id FROM rgpd_requests WHERE user_id = ? AND type = ? AND status = 'pending'", [req.user.id, type]);
    if (pending) throw new HttpError(409, 'Une demande de ce type est déjà en cours de traitement.');
    const now = nowIso();
    const { lastID } = await db.run('INSERT INTO rgpd_requests (user_id, type, message, created_at) VALUES (?, ?, ?, ?)', [
      req.user.id,
      type,
      message,
      now,
    ]);
    notifier?.rgpdRequested(lastID);
    res.status(201).json({ id: lastID, type, message, status: 'pending', response: '', created_at: now, due_at: dueDate(now) });
  });

  // Navigateurs de confiance (connexion sans code pendant quelques jours) et journal de sécurité du compte.
  router.get('/me/security', authenticate, forbidImpersonation, async (req, res) => {
    const devices = await db.all(
      `SELECT id, label, created_at, last_used_at, expires_at FROM trusted_devices
       WHERE user_id = ? AND expires_at > ? AND token_version = (SELECT token_version FROM users WHERE id = ?) ORDER BY id DESC`,
      [req.user.id, nowIso(), req.user.id]
    );
    const events = await db.all(
      `SELECT e.type, e.detail, e.created_at, e.actor_id, a.username, a.firstname, a.lastname FROM security_events e
       LEFT JOIN users a ON a.id = e.actor_id WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({
      trustedDeviceDays: config.trustedDeviceDays,
      devices,
      events: events.map((e) => ({
        type: e.type,
        detail: e.detail,
        created_at: e.created_at,
        by: e.actor_id === req.user.id ? 'vous' : e.username ? displayName(e) : 'un administrateur',
      })),
    });
  });

  router.delete('/me/devices/:id', authenticate, forbidImpersonation, async (req, res) => {
    const { changes } = await db.run('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
    if (!changes) throw new HttpError(404, 'Navigateur introuvable.');
    await logSecurity(db, req.user.id, 'device_forgotten', { actorId: req.user.id });
    res.json({ success: true });
  });

  router.delete('/me/devices', authenticate, forbidImpersonation, async (req, res) => {
    await db.run('DELETE FROM trusted_devices WHERE user_id = ?', [req.user.id]);
    await logSecurity(db, req.user.id, 'devices_forgotten', { actorId: req.user.id });
    res.json({ success: true });
  });

  // Acceptation de la charte par un compte créé avant qu'elle existe (ou par un administrateur).
  router.post('/me/accept-terms', authenticate, forbidImpersonation, async (req, res) => {
    const current = await syncTerms(db);
    // La page lue doit être la version en vigueur : si la charte vient de changer, on la fait relire.
    if (req.body?.version !== undefined && Number(req.body.version) !== current.version) {
      throw new HttpError(409, 'La charte vient d’être modifiée : rechargez la page et relisez-la.');
    }
    await acceptTerms(db, req.user.id, current.version);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: publicUser(row), token: signToken(row, config, { mfa: req.sessionMfa }) });
  });

  // Nouveaux codes de secours (les anciens deviennent inutilisables) : exige un code de l'appli.
  router.post('/mfa/recovery-codes', authenticate, forbidImpersonation, async (req, res) => {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!row.mfa_enabled) throw new HttpError(400, "La double authentification n'est pas activée.");
    const key = `mfa:${row.id}`;
    codeGuard.check(key);
    const step = mfa.verifyTotp(row.mfa_secret, (req.body || {}).code, row.mfa_last_step);
    if (!step) {
      codeGuard.fail(key);
      throw new HttpError(400, 'Code incorrect ou déjà utilisé.', { code: 'Incorrect.' });
    }
    codeGuard.succeed(key);
    await db.run('UPDATE users SET mfa_last_step = ? WHERE id = ?', [step, row.id]);
    res.json({ recoveryCodes: await newRecoveryCodes(row.id) });
  });

  router.put('/me', authenticate, forbidImpersonation, async (req, res) => {
    const body = req.body || {};
    const { role, username, ...editable } = body; // ni le rôle ni l'identifiant ne sont modifiables ici
    const values = validateUserInput(editable, { partial: true });
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);

    let tokenVersion = row.token_version || 0;
    if (values.password) {
      const ok = typeof body.currentPassword === 'string' && (await bcrypt.compare(body.currentPassword, row.password));
      if (!ok) throw new HttpError(400, 'Mot de passe actuel incorrect.', { currentPassword: 'Incorrect.' });
      tokenVersion += 1;
      await db.run('UPDATE users SET password = ?, token_version = ? WHERE id = ?', [
        await bcrypt.hash(values.password, 10),
        tokenVersion,
        row.id,
      ]);
    }
    for (const field of ['email', 'firstname', 'lastname']) {
      if (field in values) await db.run(`UPDATE users SET ${field} = ? WHERE id = ?`, [values[field], row.id]);
    }
    if ('notify_email' in body) {
      if (typeof body.notify_email !== 'boolean') throw new HttpError(400, 'Préférence de notification invalide.');
      await db.run('UPDATE users SET notify_email = ? WHERE id = ?', [body.notify_email ? 1 : 0, row.id]);
    }
    if ('notify_prefs' in body) {
      const p = body.notify_prefs;
      if (!p || typeof p !== 'object' || Object.entries(p).some(([k, v]) => !NOTIFY_PREFS.includes(k) || typeof v !== 'boolean')) {
        throw new HttpError(400, 'Préférences de notification invalides.');
      }
      const next = { ...parseNotifyPrefs(row.notify_prefs), ...p };
      await db.run('UPDATE users SET notify_prefs = ? WHERE id = ?', [JSON.stringify(next), row.id]);
    }
    const updated = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    // Changer son mot de passe invalide les autres sessions : on renvoie un nouveau jeton.
    res.json({ user: publicUser(updated), token: signToken(updated, config, { mfa: req.sessionMfa }) });
  });

  return router;
}

module.exports = authRoutes;

const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { HttpError, publicUser, validateUserInput, nowIso } = require('../utils');
const QRCode = require('qrcode');
const { signToken, signChallenge, verifyChallenge, readSession } = require('../middleware/auth');
const mfa = require('../mfa');

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

function authRoutes({ db, config, authenticate }) {
  const router = express.Router();
  const guard = createLoginGuard({ maxFailures: config.loginMaxFailures, lockMinutes: config.loginLockMinutes });
  const codeGuard = createLoginGuard({ maxFailures: config.loginMaxFailures, lockMinutes: config.loginLockMinutes });

  /** Réponse après un mot de passe correct : session, ou étape de double authentification. */
  function afterPassword(row) {
    if (row.mfa_enabled) return { mfaRequired: true, mfaToken: signChallenge(row, config, 'mfa'), user: publicUser(row) };
    if (config.mfaRequired) {
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

  router.get('/config', (req, res) => {
    res.json({ registrationOpen: config.allowRegistration });
  });

  router.post('/register', limiter, async (req, res) => {
    if (!config.allowRegistration) {
      throw new HttpError(403, "Les inscriptions sont fermées. Demandez un compte à un administrateur.");
    }
    const values = validateUserInput(req.body || {}, { partial: false });
    const exists = await db.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [values.username]);
    if (exists) throw new HttpError(409, "Ce nom d'utilisateur est déjà pris.", { username: 'Déjà utilisé.' });

    // Le tout premier compte devient administrateur.
    const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    const role = count === 0 ? 'admin' : 'user';
    const hash = await bcrypt.hash(values.password, 10);
    const { lastID } = await db.run(
      `INSERT INTO users (username, password, email, firstname, lastname, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [values.username, hash, values.email, values.firstname, values.lastname, role, nowIso()]
    );
    const row = await db.get('SELECT * FROM users WHERE id = ?', [lastID]);
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
    res.json(afterPassword(row));
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
    res.json({
      token: signToken(row, config, { mfa: true }),
      user: publicUser(row),
      usedRecoveryCode,
      recoveryCodesLeft: await recoveryCodesLeft(row.id),
    });
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
      'UPDATE users SET mfa_enabled = 1, mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_last_step = ? WHERE id = ?',
      [step, row.id]
    );
    const recoveryCodes = await newRecoveryCodes(row.id);
    const updated = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    res.json({ token: signToken(updated, config, { mfa: true }), user: publicUser(updated), recoveryCodes });
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ user: req.user, recoveryCodesLeft: await recoveryCodesLeft(req.user.id) });
  });

  // Nouveaux codes de secours (les anciens deviennent inutilisables) : exige un code de l'appli.
  router.post('/mfa/recovery-codes', authenticate, async (req, res) => {
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

  router.put('/me', authenticate, async (req, res) => {
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
    const updated = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    // Changer son mot de passe invalide les autres sessions : on renvoie un nouveau jeton.
    res.json({ user: publicUser(updated), token: signToken(updated, config, { mfa: req.sessionMfa }) });
  });

  return router;
}

module.exports = authRoutes;

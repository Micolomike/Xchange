const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { HttpError, publicUser, validateUserInput, nowIso } = require('../utils');
const { signToken } = require('../middleware/auth');

// Haché factice : rend le temps de réponse identique que l'utilisateur existe ou non.
const DUMMY_HASH = bcrypt.hashSync('xchange-dummy-password', 10);

function authRoutes({ db, config, authenticate }) {
  const router = express.Router();

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
    res.status(201).json({ token: signToken(row, config), user: publicUser(row) });
  });

  router.post('/login', limiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new HttpError(400, "Nom d'utilisateur et mot de passe requis.");
    }
    const row = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username.trim()]);
    const valid = await bcrypt.compare(password, row ? row.password : DUMMY_HASH);
    if (!row || !valid) throw new HttpError(401, 'Identifiants invalides.');
    res.json({ token: signToken(row, config), user: publicUser(row) });
  });

  router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
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
    res.json({ user: publicUser(updated), token: signToken(updated, config) });
  });

  return router;
}

module.exports = authRoutes;

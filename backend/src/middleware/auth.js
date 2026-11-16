const jwt = require('jsonwebtoken');
const { HttpError, publicUser } = require('../utils');

/** Jeton de session, délivré seulement après la double authentification quand elle est exigée. */
function signToken(user, config, { mfa = true } = {}) {
  return jwt.sign({ sub: user.id, tv: user.token_version || 0, typ: 'session', mfa }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Jeton intermédiaire : « mfa » (saisir le code, 5 min) ou « setup » (configurer l'appli, 15 min). */
function signChallenge(user, config, typ) {
  return jwt.sign({ sub: user.id, tv: user.token_version || 0, typ }, config.jwtSecret, {
    expiresIn: typ === 'mfa' ? '5m' : '15m',
  });
}

async function verifyChallenge(token, typ, { db, config }) {
  let payload;
  try {
    payload = jwt.verify(String(token || ''), config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Cette étape a expiré : reconnectez-vous.');
  }
  if (payload.typ !== typ) throw new HttpError(401, 'Cette étape a expiré : reconnectez-vous.');
  const row = await db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
  if (!row || (row.token_version || 0) !== payload.tv) {
    throw new HttpError(401, 'Cette étape a expiré : reconnectez-vous.');
  }
  return row;
}

/** Lit la session du porteur sans lever d'erreur ; renvoie { row, mfa } ou null. */
async function readSession(req, { db, config }) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  let payload;
  try {
    payload = jwt.verify(match[1], config.jwtSecret);
  } catch {
    return null;
  }
  if (payload.typ !== 'session') return null;
  const row = await db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
  if (!row || (row.token_version || 0) !== payload.tv) return null;
  // Session sans code : refusée quand la double authentification est obligatoire, sauf compte dispensé.
  if (config.mfaRequired && !payload.mfa && !row.mfa_exempt) return null;
  return { row, mfa: Boolean(payload.mfa) };
}

/** Vérifie le jeton de session et recharge l'utilisateur (rôle à jour, compte supprimé = accès coupé). */
function authenticate({ db, config }) {
  return async (req, res, next) => {
    if (!/^Bearer\s+/i.test(req.get('authorization') || '')) throw new HttpError(401, 'Authentification requise.');
    const session = await readSession(req, { db, config });
    if (!session) throw new HttpError(401, 'Session expirée, veuillez vous reconnecter.');
    req.user = publicUser(session.row);
    req.sessionMfa = session.mfa;
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Accès réservé aux administrateurs.');
  next();
}

module.exports = { signToken, signChallenge, verifyChallenge, readSession, authenticate, requireAdmin };

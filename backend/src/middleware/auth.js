const jwt = require('jsonwebtoken');
const { HttpError, publicUser } = require('../utils');

function signToken(user, config) {
  return jwt.sign({ sub: user.id, tv: user.token_version || 0 }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Vérifie le jeton Bearer et recharge l'utilisateur (rôle à jour, compte supprimé = accès coupé). */
function authenticate({ db, config }) {
  return async (req, res, next) => {
    const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, 'Authentification requise.');

    let payload;
    try {
      payload = jwt.verify(match[1], config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expirée, veuillez vous reconnecter.');
    }

    const row = await db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
    if (!row || (row.token_version || 0) !== payload.tv) {
      throw new HttpError(401, 'Session expirée, veuillez vous reconnecter.');
    }
    req.user = publicUser(row);
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Accès réservé aux administrateurs.');
  next();
}

module.exports = { signToken, authenticate, requireAdmin };

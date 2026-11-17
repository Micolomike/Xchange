/**
 * Sécurité des comptes : journal des choix liés à la double authentification, navigateurs de confiance.
 */
const crypto = require('crypto');

/** Trace d'un choix ou d'une action de sécurité sur un compte (qui, quoi, quand). */
async function logSecurity(db, userId, type, { actorId = null, detail = '' } = {}) {
  await db.run('INSERT INTO security_events (user_id, type, actor_id, detail, created_at) VALUES (?, ?, ?, ?, ?)', [
    userId,
    type,
    actorId,
    detail,
    new Date().toISOString(),
  ]);
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Nom lisible d'un navigateur à partir de son User-Agent (« Chrome sur Windows »). */
function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /OPR\//.test(ua)
          ? 'Opera'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Navigateur';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iPhone ou iPad'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'appareil inconnu';
  return `${browser} sur ${os}`;
}

/** Enregistre un navigateur de confiance ; renvoie le jeton à garder dans ce navigateur. */
async function trustDevice(db, user, { days, userAgent }) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400_000);
  const label = deviceLabel(userAgent);
  await db.run(
    `INSERT INTO trusted_devices (user_id, token_hash, label, token_version, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user.id, hashToken(token), label, user.token_version || 0, now.toISOString(), expires.toISOString(), now.toISOString()]
  );
  await logSecurity(db, user.id, 'device_trusted', { actorId: user.id, detail: label });
  return { token, expiresAt: expires.toISOString(), label };
}

/**
 * Navigateur reconnu pour ce compte ? Il ne l'est plus après expiration, ni après un changement
 * de mot de passe ou une réinitialisation de la double authentification (version du compte changée).
 */
async function checkTrustedDevice(db, user, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return false;
  const row = await db.get(
    'SELECT id FROM trusted_devices WHERE user_id = ? AND token_hash = ? AND token_version = ? AND expires_at > ?',
    [user.id, hashToken(token), user.token_version || 0, new Date().toISOString()]
  );
  if (!row) return false;
  await db.run('UPDATE trusted_devices SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
  return true;
}

module.exports = { logSecurity, deviceLabel, trustDevice, checkTrustedDevice, hashToken };

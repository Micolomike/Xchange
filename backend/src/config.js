const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'non', 'off'].includes(String(value).toLowerCase());
}

/**
 * Lit la configuration depuis les variables d'environnement.
 * Les chemins par défaut reprennent ceux de la première version
 * (database/tickets.db et logs/deleted-tickets.json à la racine du dépôt)
 * pour qu'une base existante soit reprise telle quelle.
 */
function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(REPO_ROOT, 'database'));
  const configuredSecret = env.JWT_SECRET || env.SESSION_SECRET || '';

  return {
    port: Number(env.PORT) || 4000,
    dataDir,
    databasePath: env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : path.join(dataDir, 'tickets.db'),
    uploadsDir: env.UPLOADS_DIR ? path.resolve(env.UPLOADS_DIR) : path.join(dataDir, 'uploads'),
    legacyDeletedLogPath: path.resolve(
      env.LEGACY_DELETED_LOG || path.join(REPO_ROOT, 'logs', 'deleted-tickets.json')
    ),
    jwtSecret: configuredSecret || crypto.randomBytes(48).toString('hex'),
    jwtSecretIsEphemeral: !configuredSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    corsOrigins: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
      : null,
    maxUploadMb: Number(env.MAX_UPLOAD_MB) || 10,
    maxFilesPerUpload: 5,
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    adminUsername: env.ADMIN_USERNAME || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    trustProxy: env.TRUST_PROXY === undefined ? 1 : Number(env.TRUST_PROXY) || 0,
    rateLimit: bool(env.RATE_LIMIT, true),
  };
}

module.exports = { loadConfig };

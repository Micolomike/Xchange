/**
 * Versions de la charte d'utilisation : chaque modification du texte crée une nouvelle version,
 * archivée telle quelle ; chaque acceptation est enregistrée avec la version et la date.
 * Une personne dont la dernière version acceptée est plus ancienne doit relire et accepter.
 */
const crypto = require('crypto');
const { getSetting } = require('./settings');
const { LEGAL_DEFAULTS } = require('./legal');

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

async function effectiveCharter(db) {
  const legal = await getSetting(db, 'legal');
  return legal.charter || LEGAL_DEFAULTS.charter;
}

/**
 * Version en vigueur ; en crée une nouvelle si le texte a changé depuis la dernière
 * (modification dans l'Administration, ou nouveau texte proposé par une mise à jour).
 */
async function syncTerms(db, { actorId = null } = {}) {
  const text = await effectiveCharter(db);
  const h = hash(text);
  const latest = await db.get('SELECT version, text_hash, created_at FROM terms_versions ORDER BY version DESC LIMIT 1');
  if (latest && latest.text_hash === h) return { version: latest.version, updatedAt: latest.created_at };

  const version = latest ? latest.version + 1 : 1;
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO terms_versions (version, text, text_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)', [
    version,
    text,
    h,
    now,
    actorId,
  ]);
  if (!latest) {
    // Première version : celle que les comptes existants ont déjà acceptée.
    await db.run(
      `INSERT INTO terms_acceptances (user_id, version, accepted_at)
       SELECT id, 1, terms_accepted_at FROM users WHERE terms_accepted_at IS NOT NULL AND terms_version = 0`
    );
    await db.run('UPDATE users SET terms_version = 1 WHERE terms_accepted_at IS NOT NULL AND terms_version = 0');
  }
  const row = await db.get('SELECT version, created_at FROM terms_versions ORDER BY version DESC LIMIT 1');
  return { version: row.version, updatedAt: row.created_at };
}

/** Acceptation de la version en vigueur par une personne. */
async function acceptTerms(db, userId, version) {
  const now = new Date().toISOString();
  await db.run('INSERT INTO terms_acceptances (user_id, version, accepted_at) VALUES (?, ?, ?)', [userId, version, now]);
  await db.run('UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?', [version, now, userId]);
}

module.exports = { syncTerms, acceptTerms };

/**
 * Sauvegarde de Xchange : copie cohérente de la base (même pendant que l'appli tourne)
 * et copie des pièces jointes. Garde les N dernières sauvegardes de la base.
 *
 * Usage : node --env-file=<fichier .env> scripts/sauvegarde.js [dossier de destination]
 * Variables : DATA_DIR (comme l'appli), BACKUP_DIR (destination), BACKUP_KEEP (14 par défaut).
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { stamp, vacuumInto } = require('../src/backup');

/** Copie les fichiers absents de la destination (noms uniques : jamais modifiés ni supprimés ici). */
function copyMissing(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (fs.statSync(src).isFile() && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      copied += 1;
    }
  }
  return copied;
}

async function backup({ config, destination, keep, now = new Date() }) {
  if (!fs.existsSync(config.databasePath)) throw new Error(`Base introuvable : ${config.databasePath}`);
  fs.mkdirSync(destination, { recursive: true });

  const file = path.join(destination, `xchange_${stamp(now)}.db`);
  await vacuumInto(config.databasePath, file);
  const copied = copyMissing(config.uploadsDir, path.join(destination, 'fichiers'));

  const all = fs
    .readdirSync(destination)
    .filter((n) => /^xchange_\d{4}-\d{2}-\d{2}_\d{6}\.db$/.test(n))
    .sort()
    .reverse();
  const removed = all.slice(keep);
  for (const name of removed) fs.rmSync(path.join(destination, name), { force: true });

  return { file, copied, kept: Math.min(all.length, keep), removed: removed.length };
}

if (require.main === module) {
  const config = loadConfig();
  const destination = path.resolve(process.argv[2] || process.env.BACKUP_DIR || path.join(config.dataDir, '..', 'sauvegardes'));
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
  backup({ config, destination, keep })
    .then((r) => {
      console.log(`${new Date().toISOString()} Sauvegarde OK : ${r.file}`);
      console.log(`  ${r.copied} nouveau(x) fichier(s) joint(s) copié(s), ${r.kept} sauvegarde(s) conservée(s), ${r.removed} ancienne(s) supprimée(s).`);
    })
    .catch((err) => {
      console.error(`${new Date().toISOString()} ÉCHEC de la sauvegarde : ${err.message}`);
      process.exit(1);
    });
}

module.exports = { backup, stamp };

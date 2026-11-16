/**
 * Sauvegarde de Xchange : copie cohérente de la base (même pendant que l'appli tourne)
 * et copie des pièces jointes. Garde les N dernières sauvegardes de la base.
 *
 * Usage : node --env-file=<fichier .env> scripts/sauvegarde.js [dossier de destination]
 * Variables : DATA_DIR (comme l'appli), BACKUP_DIR (destination), BACKUP_KEEP (14 par défaut).
 */
const path = require('path');
const { loadConfig } = require('../src/config');
const { stamp, localBackup: backup } = require('../src/backup');

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

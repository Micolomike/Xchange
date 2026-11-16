/**
 * Sauvegardes : copie cohérente de la base (VACUUM INTO, possible pendant que l'appli tourne)
 * et archive .zip (base + fichiers joints) à télécharger ou à écrire sur un disque du PC.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const archiver = require('archiver');

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function vacuumInto(source, target) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(source, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      db.run('VACUUM INTO ?', [target], (err) => {
        db.close(() => (err ? reject(err) : resolve()));
      });
    });
  });
}

const LISEZMOI = [
  'Sauvegarde Xchange',
  '',
  'xchange.db : la base (comptes, tickets, commentaires, historique).',
  'fichiers/  : les pièces jointes.',
  '',
  'Pour restaurer sur le PC qui héberge Xchange, dans un Terminal administrateur :',
  '  powershell -ExecutionPolicy Bypass -File C:\\Xchange\\app\\deploy\\windows\\restaurer.ps1 -Fichier "<chemin de ce .zip>"',
  '',
].join('\r\n');

/** Écrit l'archive dans `output` (réponse HTTP ou fichier) et attend la fin de l'écriture. */
async function writeBackupZip(config, output) {
  const tmp = path.join(config.dataDir, `.sauvegarde-${crypto.randomUUID()}.db`);
  try {
    await vacuumInto(config.databasePath, tmp);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const finished = new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('finish', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(output);
    archive.file(tmp, { name: 'xchange.db' });
    if (fs.existsSync(config.uploadsDir)) archive.directory(config.uploadsDir, 'fichiers');
    archive.append(LISEZMOI, { name: 'LISEZMOI.txt' });
    await archive.finalize();
    await finished;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Disques où Xchange peut écrire une sauvegarde : lecteurs Windows présents + BACKUP_TARGETS. */
function listDestinations(config, platform = process.platform) {
  const out = [];
  const dataRoot = path.parse(path.resolve(config.dataDir)).root.toUpperCase();
  const add = (root, label) => {
    let free = null;
    let total = null;
    try {
      const s = fs.statfsSync(root);
      free = s.bavail * s.bsize;
      total = s.blocks * s.bsize;
    } catch {
      return; // lecteur sans support (lecteur de cartes vide, CD...)
    }
    out.push({ id: root, label, free, total, sameAsData: path.parse(path.resolve(root)).root.toUpperCase() === dataRoot && root.length <= 3 });
  };
  if (platform === 'win32') {
    for (let c = 65; c <= 90; c += 1) {
      const root = `${String.fromCharCode(c)}:\\`;
      if (fs.existsSync(root)) add(root, `${String.fromCharCode(c)}:`);
    }
  }
  for (const target of config.backupTargets) {
    if (fs.existsSync(target)) add(target, target);
  }
  return out;
}

module.exports = { stamp, vacuumInto, writeBackupZip, listDestinations };

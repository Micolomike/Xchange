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

/** Ne garde que les `keep` fichiers les plus récents correspondant au motif (noms datés). */
function prune(dir, pattern, keep) {
  const all = fs
    .readdirSync(dir)
    .filter((n) => pattern.test(n))
    .sort()
    .reverse();
  const removed = all.slice(keep);
  for (const name of removed) fs.rmSync(path.join(dir, name), { force: true });
  return { kept: Math.min(all.length, keep), removed: removed.length };
}

/**
 * Sauvegarde locale : xchange_<date>.db + dossier fichiers/ (copie incrémentale des pièces jointes).
 * Garde les `keep` dernières bases.
 */
async function localBackup({ config, destination, keep, now = new Date() }) {
  if (!fs.existsSync(config.databasePath)) throw new Error(`Base introuvable : ${config.databasePath}`);
  fs.mkdirSync(destination, { recursive: true });
  const file = path.join(destination, `xchange_${stamp(now)}.db`);
  await vacuumInto(config.databasePath, file);
  const copied = copyMissing(config.uploadsDir, path.join(destination, 'fichiers'));
  const { kept, removed } = prune(destination, /^xchange_\d{4}-\d{2}-\d{2}_\d{6}\.db$/, keep);
  return { file, copied, kept, removed };
}

/** Copie complète en archive .zip dans un autre dossier (ex. D:\Xchange-sauvegardes), avec rotation. */
async function zipCopy({ config, directory, keep, now = new Date() }) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `xchange_${stamp(now)}.zip`);
  try {
    await writeBackupZip(config, fs.createWriteStream(file));
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
  prune(directory, /^xchange_\d{4}-\d{2}-\d{2}_\d{6}\.zip$/, keep);
  return { file, size: fs.statSync(file).size };
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

module.exports = { stamp, vacuumInto, writeBackupZip, listDestinations, localBackup, zipCopy };

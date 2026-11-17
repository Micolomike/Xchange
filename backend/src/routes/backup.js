const fs = require('fs');
const path = require('path');
const express = require('express');
const { HttpError } = require('../utils');
const crypto = require('crypto');
const { stamp, writeBackupZip, listDestinations } = require('../backup');
const { getSetting, setSetting } = require('../settings');
const { runBackup, nextSlot, explainWriteError } = require('../backupScheduler');

/** Dossier de copie : chemin absolu, hors du dossier des données de Xchange. */
function checkCopyDir(dir, config) {
  const value = String(dir || '').trim();
  if (!value) return '';
  if (!path.isAbsolute(value) || value.length > 240) {
    throw new HttpError(400, 'Indiquez un chemin complet, par exemple D:\\Xchange-sauvegardes.', { copyDir: 'Chemin invalide.' });
  }
  const resolved = path.resolve(value);
  const inside = (parent) => {
    const rel = path.relative(parent, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (inside(path.resolve(config.dataDir)) || (config.backupDir && inside(config.backupDir))) {
    throw new HttpError(400, 'Choisissez un dossier hors des données et des sauvegardes de Xchange, idéalement sur un autre disque.', {
      copyDir: 'Dossier non autorisé.',
    });
  }
  return resolved;
}

const FOLDER_RE = /^[A-Za-z0-9 _.-]{1,64}$/;

/** Sauvegardes à la demande, réservées aux administrateurs. */
function backupRoutes({ db, config }) {
  const router = express.Router();

  router.get('/download', async (req, res) => {
    const name = `xchange_${stamp()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    await writeBackupZip(config, res);
  });

  router.get('/destinations', (req, res) => {
    res.json({ destinations: listDestinations(config), defaultFolder: 'Xchange-sauvegardes' });
  });

  router.post('/write', async (req, res) => {
    const { destination, folder = 'Xchange-sauvegardes' } = req.body || {};
    const target = listDestinations(config).find((d) => d.id === destination);
    if (!target) throw new HttpError(400, "Ce disque n'est pas disponible. Actualisez la liste.");
    const name = String(folder).trim();
    if (!FOLDER_RE.test(name) || /^\.+$/.test(name)) {
      throw new HttpError(400, 'Nom de dossier invalide : lettres, chiffres, espaces, point, tiret ou tiret bas.', {
        folder: 'Nom invalide.',
      });
    }
    const dir = path.join(target.id, name);
    const file = path.join(dir, `xchange_${stamp()}.zip`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      await writeBackupZip(config, fs.createWriteStream(file));
    } catch (err) {
      fs.rmSync(file, { force: true });
      if (['EACCES', 'EPERM', 'EROFS'].includes(err.code)) {
        throw new HttpError(403, `Xchange n'a pas le droit d'écrire sur ${target.label}. Voir « En cas de problème » dans le guide.`);
      }
      if (err.code === 'ENOSPC') throw new HttpError(507, `Plus assez de place sur ${target.label}.`);
      throw err;
    }
    res.status(201).json({ path: file, size: fs.statSync(file).size });
  });

  // Sauvegarde automatique : réglages, état, lancement manuel.
  async function scheduleInfo() {
    const settings = await getSetting(db, 'backup');
    return {
      available: Boolean(config.backupDir),
      directory: config.backupDir,
      settings,
      state: await getSetting(db, 'backup_state'),
      nextRun: config.backupDir && settings.enabled ? nextSlot(settings.time).toISOString() : null,
    };
  }

  router.get('/schedule', async (req, res) => {
    res.json(await scheduleInfo());
  });

  router.put('/schedule', async (req, res) => {
    const body = req.body || {};
    const current = await getSetting(db, 'backup');
    const next = { ...current };
    if ('enabled' in body) next.enabled = Boolean(body.enabled);
    if ('time' in body) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) {
        throw new HttpError(400, 'Heure invalide, format HH:MM.', { time: 'Heure invalide.' });
      }
      next.time = body.time;
    }
    if ('keep' in body) {
      const keep = Number(body.keep);
      if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
        throw new HttpError(400, 'Nombre de sauvegardes gardées : entre 1 et 365.', { keep: 'Entre 1 et 365.' });
      }
      next.keep = keep;
    }
    if ('copyDir' in body) next.copyDir = checkCopyDir(body.copyDir, config);
    await setSetting(db, 'backup', next);
    res.json(await scheduleInfo());
  });

  router.post('/run', async (req, res) => {
    if (!config.backupDir) throw new HttpError(400, "Les sauvegardes automatiques ne sont pas configurées sur ce serveur (BACKUP_DIR).");
    await runBackup({ db, config, logger: req.app.locals.syslog?.for('sauvegarde') || { info() {}, error() {} } });
    res.json(await scheduleInfo());
  });

  // Vérifie que Xchange peut écrire dans le dossier de copie (droits du compte Service local).
  router.post('/test-dir', async (req, res) => {
    const dir = checkCopyDir((req.body || {}).dir, config);
    if (!dir) throw new HttpError(400, 'Indiquez un dossier.', { copyDir: 'Requis.' });
    const probe = path.join(dir, `.test-xchange-${crypto.randomUUID()}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(probe, 'test');
      fs.rmSync(probe, { force: true });
    } catch (err) {
      fs.rmSync(probe, { force: true });
      return res.json({ ok: false, message: explainWriteError(err, dir) });
    }
    res.json({ ok: true, message: `Xchange peut écrire dans ${dir}.` });
  });

  return router;
}

module.exports = backupRoutes;

const fs = require('fs');
const path = require('path');
const express = require('express');
const { HttpError } = require('../utils');
const { stamp, writeBackupZip, listDestinations } = require('../backup');

const FOLDER_RE = /^[A-Za-z0-9 _.-]{1,64}$/;

/** Sauvegardes à la demande, réservées aux administrateurs. */
function backupRoutes({ config }) {
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

  return router;
}

module.exports = backupRoutes;

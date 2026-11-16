const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { HttpError } = require('../utils');
const {
  getSetting,
  setSetting,
  validateCategories,
  validatePriorities,
  validateAppearance,
} = require('../settings');

const { getAccessSettings, validateAccessSettings } = require('../access');

const LOGO_TYPES = [
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

const logoDir = (config) => path.join(config.dataDir, 'apparence');

async function publicSettings(db) {
  const appearance = await getSetting(db, 'appearance');
  const { logo, logoVersion, ...rest } = appearance;
  return {
    ...rest,
    logoUrl: logo ? `/api/settings/logo?v=${logoVersion}` : null,
    categories: (await getSetting(db, 'categories')).map(({ removed: _r, ...c }) => c),
    priorities: await getSetting(db, 'priorities'),
  };
}

/** Paramètres lus par tous, y compris les visiteurs (nom, couleur, logo, listes). */
function settingsPublicRoutes({ db, config }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json(await publicSettings(db));
  });

  router.get('/logo', async (req, res) => {
    const { logo } = await getSetting(db, 'appearance');
    const file = logo && path.join(logoDir(config), logo);
    if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Aucun logo.');
    const type = LOGO_TYPES.find((t) => logo.endsWith(`.${t.ext}`));
    res.setHeader('Content-Type', type.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(file).pipe(res);
  });

  return router;
}

/** Modification des paramètres, réservée aux administrateurs. */
function settingsAdminRoutes({ db, config }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024, files: 1 } });

  router.get('/', async (req, res) => {
    res.json({
      ...(await publicSettings(db)),
      // L'éditeur ne montre pas les catégories retirées, gardées pour les anciens tickets.
      categories: (await getSetting(db, 'categories')).filter((c) => !c.removed),
    });
  });

  router.put('/lists', async (req, res) => {
    const body = req.body || {};
    if (body.categories !== undefined) {
      const current = await getSetting(db, 'categories');
      await setSetting(db, 'categories', validateCategories(body.categories, current));
    }
    if (body.priorities !== undefined) await setSetting(db, 'priorities', validatePriorities(body.priorities));
    res.json(await publicSettings(db));
  });

  // Droits par groupe et règles de visibilité par catégorie.
  router.get('/access', async (req, res) => {
    res.json(await getAccessSettings(db));
  });

  router.put('/access', async (req, res) => {
    const groupIds = (await db.all('SELECT id FROM user_groups')).map((g) => g.id);
    const categoryKeys = (await getSetting(db, 'categories')).map((c) => c.key);
    await setSetting(db, 'access', validateAccessSettings(req.body || {}, { groupIds, categoryKeys }));
    res.json(await getAccessSettings(db));
  });

  router.put('/appearance', async (req, res) => {
    const current = await getSetting(db, 'appearance');
    await setSetting(db, 'appearance', validateAppearance(req.body || {}, current));
    res.json(await publicSettings(db));
  });

  router.post('/logo', (req, res, next) => {
    upload.single('logo')(req, res, async (err) => {
      try {
        if (err) {
          throw new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Logo trop lourd : 512 Ko maximum.' : 'Envoi du logo impossible.');
        }
        if (!req.file) throw new HttpError(400, 'Aucun fichier reçu.');
        const type = LOGO_TYPES.find((t) => t.test(req.file.buffer));
        if (!type) throw new HttpError(400, 'Format non accepté : PNG, JPG ou WEBP.');
        const dir = logoDir(config);
        fs.mkdirSync(dir, { recursive: true });
        for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
        fs.writeFileSync(path.join(dir, `logo.${type.ext}`), req.file.buffer);
        const appearance = await getSetting(db, 'appearance');
        await setSetting(db, 'appearance', { ...appearance, logo: `logo.${type.ext}`, logoVersion: Date.now() });
        res.json(await publicSettings(db));
      } catch (e) {
        next(e);
      }
    });
  });

  router.delete('/logo', async (req, res) => {
    fs.rmSync(logoDir(config), { recursive: true, force: true });
    const appearance = await getSetting(db, 'appearance');
    await setSetting(db, 'appearance', { ...appearance, logo: null, logoVersion: Date.now() });
    res.json(await publicSettings(db));
  });

  return router;
}

module.exports = { settingsPublicRoutes, settingsAdminRoutes };

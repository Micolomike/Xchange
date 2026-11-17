const express = require('express');
const { HttpError, parseId } = require('../utils');
const { getSetting, setSetting } = require('../settings');
const { LEGAL_DEFAULTS, fillRetention } = require('../legal');
const { anonymizeUser, exportUser, purgeCandidates, runPurge } = require('../rgpd');

const LEGAL_KEYS = ['legalNotice', 'privacyPolicy', 'charter'];
const MAX_LEGAL = 30000;

/** Textes juridiques tels qu'affichés (texte saisi, ou texte proposé par défaut). */
async function legalTexts(db) {
  const legal = await getSetting(db, 'legal');
  const rgpd = await getSetting(db, 'rgpd');
  const out = {};
  for (const k of LEGAL_KEYS) out[k] = legal[k] || LEGAL_DEFAULTS[k];
  out.privacyPolicy = fillRetention(out.privacyPolicy, rgpd);
  return { ...out, requireTerms: rgpd.requireTerms !== false };
}

/** Pages publiques : mentions légales, politique de confidentialité, charte. */
function legalPublicRoutes({ db }) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    res.json(await legalTexts(db));
  });
  return router;
}

function exportFileName(data) {
  const day = data.exported_at.slice(0, 10);
  return `xchange-donnees-${String(data.account.username).replace(/[^a-z0-9._-]+/gi, '_')}-${day}.json`;
}

/** Administration > Paramètres > RGPD. */
function rgpdAdminRoutes({ db, config }) {
  const router = express.Router();

  async function info() {
    const settings = await getSetting(db, 'rgpd');
    const legal = await getSetting(db, 'legal');
    const { n } = await db.get('SELECT COUNT(*) AS n FROM users WHERE anonymized_at IS NOT NULL');
    const terms = await db.get(
      'SELECT COUNT(*) AS total, SUM(terms_accepted_at IS NOT NULL) AS accepted FROM users WHERE anonymized_at IS NULL'
    );
    return {
      settings,
      state: await getSetting(db, 'rgpd_state'),
      legal: Object.fromEntries(LEGAL_KEYS.map((k) => [k, { text: legal[k] || LEGAL_DEFAULTS[k], custom: Boolean(legal[k]) }])),
      candidates: await purgeCandidates(db, settings),
      anonymized: n,
      terms: { total: terms.total, accepted: terms.accepted || 0 },
    };
  }

  router.get('/', async (req, res) => {
    res.json(await info());
  });

  router.put('/settings', async (req, res) => {
    const body = req.body || {};
    const next = { ...(await getSetting(db, 'rgpd')) };
    const months = (key, max) => {
      if (!(key in body)) return;
      const v = Number(body[key]);
      if (!Number.isInteger(v) || v < 0 || v > max) {
        throw new HttpError(400, `Durée invalide : un nombre de mois entre 0 et ${max}.`, { [key]: `Entre 0 et ${max} mois.` });
      }
      if (v > 0 && v < 3) throw new HttpError(400, 'Trois mois minimum, ou 0 pour désactiver.', { [key]: 'Trois mois minimum.' });
      next[key] = v;
    };
    months('inactiveMonths', 120);
    months('logMonths', 36);
    if ('requireTerms' in body) next.requireTerms = Boolean(body.requireTerms);
    await setSetting(db, 'rgpd', next);
    res.json(await info());
  });

  router.put('/legal', async (req, res) => {
    const body = req.body || {};
    const next = { ...(await getSetting(db, 'legal')) };
    for (const k of LEGAL_KEYS) {
      if (!(k in body)) continue;
      if (typeof body[k] !== 'string') throw new HttpError(400, 'Texte invalide.');
      const text = body[k].replace(/\r\n/g, '\n').trim();
      if (text.length > MAX_LEGAL) throw new HttpError(400, `Texte trop long (${MAX_LEGAL} caractères maximum).`, { [k]: 'Trop long.' });
      // Identique au texte proposé : on garde « par défaut », pour profiter de ses mises à jour.
      next[k] = text === LEGAL_DEFAULTS[k] ? '' : text;
    }
    await setSetting(db, 'legal', next);
    res.json(await info());
  });

  router.get('/users/:id/export', async (req, res) => {
    const data = await exportUser(db, parseId(req.params.id));
    res.set('Content-Disposition', `attachment; filename="${exportFileName(data)}"`);
    res.json(data);
  });

  router.post('/users/:id/anonymize', async (req, res) => {
    const result = await anonymizeUser(db, config, parseId(req.params.id), { mode: req.body?.mode, actorId: req.user.id });
    res.json({ success: true, ...result });
  });

  router.post('/purge', async (req, res) => {
    const done = await runPurge(db, config);
    res.json({ done, ...(await info()) });
  });

  return router;
}

module.exports = { legalPublicRoutes, rgpdAdminRoutes, legalTexts, exportFileName };

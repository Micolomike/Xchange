const express = require('express');
const { HttpError, parseId, displayName } = require('../utils');
const { getSetting, setSetting } = require('../settings');
const { LEGAL_DEFAULTS, fillRetention } = require('../legal');
const { RGPD_TYPES, dueDate } = require('../rgpdRequests');
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
      pendingRequests: (await db.get("SELECT COUNT(*) AS n FROM rgpd_requests WHERE status = 'pending'")).n,
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
    const userId = parseId(req.params.id);
    // Lancée depuis une demande de la personne : la demande est close avec l'anonymisation.
    const request = req.body?.requestId
      ? await db.get("SELECT * FROM rgpd_requests WHERE id = ? AND user_id = ? AND status = 'pending'", [Number(req.body.requestId), userId])
      : null;
    if (req.body?.requestId && !request) throw new HttpError(404, 'Demande introuvable ou déjà traitée.');
    const result = await anonymizeUser(db, config, userId, { mode: req.body?.mode, actorId: req.user.id });
    if (request) {
      const response = result.mode === 'delete' ? 'Compte anonymisé, demandes et messages supprimés.' : 'Compte anonymisé, demandes conservées sans nom.';
      await db.run("UPDATE rgpd_requests SET status = 'done', response = ?, handled_at = ?, handled_by = ? WHERE id = ?", [
        response,
        new Date().toISOString(),
        req.user.id,
        request.id,
      ]);
    }
    res.json({ success: true, ...result });
  });

  router.get('/requests', async (req, res) => {
    const rows = await db.all(
      `SELECT r.*, u.username, u.firstname, u.lastname, u.email, u.anonymized_at,
              h.username AS h_username, h.firstname AS h_firstname, h.lastname AS h_lastname
       FROM rgpd_requests r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users h ON h.id = r.handled_by
       ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT 200`
    );
    const now = new Date().toISOString();
    res.json(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        type_label: RGPD_TYPES[r.type] || r.type,
        message: r.message,
        status: r.status,
        response: r.response,
        created_at: r.created_at,
        due_at: dueDate(r.created_at),
        overdue: r.status === 'pending' && dueDate(r.created_at) < now,
        handled_at: r.handled_at,
        handled_by: r.h_username ? displayName({ username: r.h_username, firstname: r.h_firstname, lastname: r.h_lastname }) : null,
        user: r.username
          ? { id: r.user_id, name: displayName(r), username: r.username, email: r.email, anonymized: Boolean(r.anonymized_at) }
          : null,
      }))
    );
  });

  router.post('/requests/:id/close', async (req, res) => {
    const id = parseId(req.params.id);
    const status = req.body?.status;
    if (!['done', 'rejected'].includes(status)) throw new HttpError(400, 'Statut invalide.');
    const response = typeof req.body?.response === 'string' ? req.body.response.trim().slice(0, 2000) : '';
    if (status === 'rejected' && !response) throw new HttpError(400, 'Indiquez le motif du refus.', { response: 'Obligatoire pour un refus.' });
    const { changes } = await db.run(
      "UPDATE rgpd_requests SET status = ?, response = ?, handled_at = ?, handled_by = ? WHERE id = ? AND status = 'pending'",
      [status, response, new Date().toISOString(), req.user.id, id]
    );
    if (!changes) throw new HttpError(404, 'Demande introuvable ou déjà traitée.');
    res.json({ success: true });
  });

  router.post('/purge', async (req, res) => {
    const done = await runPurge(db, config);
    res.json({ done, ...(await info()) });
  });

  return router;
}

module.exports = { legalPublicRoutes, rgpdAdminRoutes, legalTexts, exportFileName };

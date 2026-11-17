const express = require('express');
const { HttpError } = require('../utils');
const { getSetting } = require('../settings');
const { searchFaq, searchForms, normalize } = require('../assistant');
const { visibleWhere, loadItems } = require('./catalog');

/** Assistant guidé : questions fréquentes et formulaires proposés à partir de quelques mots. */
function assistantRoutes({ db }) {
  const router = express.Router();

  router.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 300) : '';
    if (!q) throw new HttpError(400, 'Décrivez votre besoin en quelques mots.');
    const w = visibleWhere(req.user);
    const items = await loadItems(db, w.sql, w.params);
    const faq = searchFaq(q);
    const forms = searchForms(q, items, await getSetting(db, 'categories'));
    // Question restée sans réponse : gardée sans nom, pour améliorer l'assistant.
    if (!faq.length && !forms.length) {
      await db.run('INSERT INTO assistant_misses (query, created_at) VALUES (?, ?)', [normalize(q).slice(0, 200), new Date().toISOString()]);
    }
    res.json({ faq, forms });
  });

  // « Aucune proposition ne convient » : également gardé sans nom.
  router.post('/miss', async (req, res) => {
    const q = typeof req.body?.q === 'string' ? req.body.q.trim().slice(0, 300) : '';
    if (q) await db.run('INSERT INTO assistant_misses (query, created_at) VALUES (?, ?)', [normalize(q).slice(0, 200), new Date().toISOString()]);
    res.json({ success: true });
  });

  return router;
}

/** Administration : les besoins que l'assistant n'a pas su orienter (90 derniers jours). */
function assistantAdminRoutes({ db }) {
  const router = express.Router();
  router.get('/misses', async (req, res) => {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const rows = await db.all(
      `SELECT query, COUNT(*) AS count, MAX(created_at) AS last_at FROM assistant_misses
       WHERE created_at >= ? GROUP BY query ORDER BY count DESC, last_at DESC LIMIT 50`,
      [since]
    );
    res.json(rows);
  });
  router.delete('/misses', async (req, res) => {
    await db.run('DELETE FROM assistant_misses');
    res.json({ success: true });
  });
  return router;
}

module.exports = { assistantRoutes, assistantAdminRoutes };

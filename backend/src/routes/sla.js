const express = require('express');
const { getSetting } = require('../settings');
const { PRIORITIES } = require('../utils');
const SLA = require('../sla');

/** Administration des SLA : réglages, aperçu des échéances, recalcul des demandes en cours. */
function slaAdminRoutes({ db }) {
  const router = express.Router();

  const context = async () => ({ categoryKeys: (await getSetting(db, 'categories')).map((c) => c.key) });

  async function summary() {
    const n = new Date().toISOString();
    const r = await db.get(
      `SELECT
         SUM(CASE WHEN status IN ('open', 'in_progress') AND sla_policy IS NOT NULL THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status IN ('open', 'in_progress') AND ((sla_responded_at IS NULL AND sla_response_due < ?) OR sla_resolution_due < ?) THEN 1 ELSE 0 END) AS breached
       FROM tickets WHERE deleted_at IS NULL`,
      [n, n]
    );
    return { running: r.running || 0, breached: r.breached || 0 };
  }

  router.get('/', async (req, res) => {
    const settings = await getSetting(db, 'sla');
    const priorities = await getSetting(db, 'priorities');
    res.json({
      settings,
      preview: SLA.preview(settings),
      summary: await summary(),
      priorities: PRIORITIES.slice().reverse().map((k) => ({ key: k, label: priorities?.[k]?.label || k })),
      categories: (await getSetting(db, 'categories')).map((c) => ({ key: c.key, label: c.label })),
    });
  });

  // Aperçu des échéances avec des réglages pas encore enregistrés.
  router.post('/preview', async (req, res) => {
    const settings = SLA.validateSla(req.body || {}, await getSetting(db, 'sla'), await context());
    res.json({ preview: SLA.preview(settings) });
  });

  router.put('/', async (req, res) => {
    const before = await getSetting(db, 'sla');
    const settings = await SLA.saveSla(db, req.body || {}, await context());
    // Mise en route : les demandes existantes reçoivent leurs échéances.
    if (settings.enabled && !before.enabled) await SLA.backfillSla(db);
    res.json({ settings, preview: SLA.preview(settings), summary: await summary() });
  });

  // Applique les réglages actuels aux demandes en cours (les demandes terminées gardent leur historique).
  router.post('/recalculate', async (req, res) => {
    const count = await SLA.recalculateOpen(db);
    res.json({ count, summary: await summary() });
  });

  return router;
}

module.exports = { slaAdminRoutes };

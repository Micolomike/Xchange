const express = require('express');
const { HttpError, parseId, nowIso } = require('../utils');
const { TICKET_SELECT, serializeTicket, addEvent } = require('../tickets');
const { removeFiles } = require('./attachments');

/** Corbeille des tickets supprimés, réservée aux administrateurs. */
function adminRoutes({ db, config }) {
  const router = express.Router();

  async function purge(ids) {
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const files = await db.all(`SELECT stored_name FROM attachments WHERE ticket_id IN (${placeholders})`, ids);
    const { changes } = await db.run(`DELETE FROM tickets WHERE id IN (${placeholders})`, ids);
    removeFiles(config.uploadsDir, files.map((f) => f.stored_name));
    return changes;
  }

  router.get('/trash', async (req, res) => {
    const rows = await db.all(`${TICKET_SELECT} WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC, t.id DESC`);
    res.json(rows.map(serializeTicket));
  });

  router.post('/trash/:id/restore', async (req, res) => {
    const id = parseId(req.params.id);
    const { changes } = await db.run(
      'UPDATE tickets SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL',
      [nowIso(), id]
    );
    if (!changes) throw new HttpError(404, 'Ce ticket ne se trouve pas dans la corbeille.');
    await addEvent(db, id, req.user.id, 'restored');
    res.json({ success: true });
  });

  router.delete('/trash/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT id FROM tickets WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!row) throw new HttpError(404, 'Ce ticket ne se trouve pas dans la corbeille.');
    await purge([id]);
    res.json({ success: true });
  });

  router.delete('/trash', async (req, res) => {
    const rows = await db.all('SELECT id FROM tickets WHERE deleted_at IS NOT NULL');
    const purged = await purge(rows.map((r) => r.id));
    res.json({ success: true, purged });
  });

  return router;
}

module.exports = adminRoutes;

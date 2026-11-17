const express = require('express');
const { LEVELS, SOURCES } = require('../systemLog');

const actorName = (r) =>
  r.actor_id == null ? null : r.a_username ? [r.a_firstname, r.a_lastname].filter(Boolean).join(' ') || r.a_username : `Compte n°${r.actor_id}`;

/** Lecture du journal système (administrateurs). Le journal ne se modifie pas : il est purgé avec les journaux (RGPD). */
function systemLogRoutes({ db }) {
  const router = express.Router();

  function filters(q) {
    const where = [];
    const params = [];
    const levels = String(q.level || '')
      .split(',')
      .filter((l) => LEVELS.includes(l));
    if (levels.length) {
      where.push(`l.level IN (${levels.map(() => '?').join(', ')})`);
      params.push(...levels);
    }
    if (q.source && SOURCES[q.source]) {
      where.push('l.source = ?');
      params.push(q.source);
    }
    const text = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '';
    if (text) {
      where.push("(l.message LIKE ? ESCAPE '\\' OR l.details LIKE ? ESCAPE '\\')");
      const like = `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    if (q.from && /^\d{4}-\d{2}-\d{2}/.test(q.from)) {
      where.push('l.created_at >= ?');
      params.push(new Date(q.from).toISOString());
    }
    if (q.to && /^\d{4}-\d{2}-\d{2}/.test(q.to)) {
      // Jour de fin inclus.
      const end = new Date(q.to);
      end.setDate(end.getDate() + 1);
      where.push('l.created_at < ?');
      params.push(end.toISOString());
    }
    return { where, params };
  }

  const SELECT = `SELECT l.*, a.username AS a_username, a.firstname AS a_firstname, a.lastname AS a_lastname
    FROM system_logs l LEFT JOIN users a ON a.id = l.actor_id`;

  router.get('/', async (req, res) => {
    const { where, params } = filters(req.query);
    const before = Number(req.query.before) || null;
    if (before) {
      where.push('l.id < ?');
      params.push(before);
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = await db.all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.id DESC LIMIT ?`, [...params, limit + 1]);
    const since = new Date(Date.now() - 86400_000).toISOString();
    const last24h = await db.all('SELECT level, COUNT(*) AS n FROM system_logs WHERE created_at >= ? GROUP BY level', [since]);
    const sources = await db.all('SELECT DISTINCT source FROM system_logs');
    res.json({
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        level: r.level,
        source: r.source,
        sourceLabel: SOURCES[r.source] || r.source,
        message: r.message,
        details: r.details,
        actor: actorName(r),
        createdAt: r.created_at,
      })),
      more: rows.length > limit,
      last24h: Object.fromEntries(LEVELS.map((l) => [l, last24h.find((x) => x.level === l)?.n || 0])),
      sources: Object.entries(SOURCES)
        .filter(([k]) => sources.some((s) => s.source === k))
        .map(([key, label]) => ({ key, label })),
    });
  });

  // Export CSV (séparateur « ; », lisible par Excel), mêmes filtres, 10 000 lignes au plus.
  router.get('/csv', async (req, res) => {
    const { where, params } = filters(req.query);
    const rows = await db.all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.id DESC LIMIT 10000`, params);
    const LABELS = { info: 'Information', warn: 'Avertissement', error: 'Erreur' };
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [['Date', 'Niveau', 'Source', 'Message', 'Par', 'Détails']].concat(
      rows.map((r) => [new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), LABELS[r.level], SOURCES[r.source] || r.source, r.message, actorName(r) || '', r.details || ''])
    );
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="journal-systeme-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\ufeff${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`);
  });

  return router;
}

module.exports = { systemLogRoutes };

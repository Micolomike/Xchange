const express = require('express');
const { STATUSES, PRIORITIES, todayIso } = require('../utils');
const { getSetting } = require('../settings');
const { TICKET_SELECT, serializeTicket, visibilityClause, MY_GROUPS_SQL } = require('../tickets');

const TREND_DAYS = 14;

function lastDays(n) {
  const days = [];
  const today = new Date(`${todayIso()}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i -= 1) {
    days.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}

/** Indicateurs du tableau de bord, calculés sur les tickets visibles par l'utilisateur. */
function statsRoutes({ db }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const vis = visibilityClause(req.user);
    const base = `FROM tickets t WHERE t.deleted_at IS NULL AND ${vis.sql}`;
    const p = vis.params;
    const active = "t.status IN ('open', 'in_progress')";

    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of await db.all(`SELECT t.status AS k, COUNT(*) AS n ${base} GROUP BY t.status`, p)) {
      if (r.k in byStatus) byStatus[r.k] = r.n;
    }
    const activeByPriority = Object.fromEntries(PRIORITIES.map((s) => [s, 0]));
    for (const r of await db.all(`SELECT t.priority AS k, COUNT(*) AS n ${base} AND ${active} GROUP BY t.priority`, p)) {
      if (r.k in activeByPriority) activeByPriority[r.k] = r.n;
    }
    const byCategory = Object.fromEntries([
      ...(await getSetting(db, 'categories')).map((c) => [c.key, 0]),
      ['none', 0],
    ]);
    for (const r of await db.all(`SELECT t.category AS k, COUNT(*) AS n ${base} GROUP BY t.category`, p)) {
      byCategory[r.k || 'none'] = r.n;
    }

    const today = todayIso();
    const counts = await db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ${active} AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN ${active} AND t.assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN ${active} AND t.assigned_to = ? THEN 1 ELSE 0 END) AS assigned_to_me,
         SUM(CASE WHEN ${active} AND t.created_by = ? THEN 1 ELSE 0 END) AS created_by_me_active,
         SUM(CASE WHEN ${active} AND t.assigned_to IS NULL AND t.assigned_group IN (${MY_GROUPS_SQL}) THEN 1 ELSE 0 END) AS group_queue
       ${base}`,
      [today, req.user.id, req.user.id, req.user.id, ...p]
    );

    const { avg_hours: avgHours } = await db.get(
      `SELECT AVG((julianday(t.resolved_at) - julianday(t.created_at)) * 24) AS avg_hours
       ${base} AND t.resolved_at IS NOT NULL AND t.resolved_at >= ?`,
      [...p, new Date(Date.now() - 90 * 86400000).toISOString()]
    );

    const days = lastDays(TREND_DAYS);
    const since = `${days[0]}T00:00:00.000Z`;
    const created = new Map(
      (await db.all(`SELECT substr(t.created_at, 1, 10) AS d, COUNT(*) AS n ${base} AND t.created_at >= ? GROUP BY d`, [...p, since])).map((r) => [r.d, r.n])
    );
    const resolved = new Map(
      (await db.all(`SELECT substr(t.resolved_at, 1, 10) AS d, COUNT(*) AS n ${base} AND t.resolved_at >= ? GROUP BY d`, [...p, since])).map((r) => [r.d, r.n])
    );

    const recent = await db.all(
      `${TICKET_SELECT} WHERE t.deleted_at IS NULL AND ${vis.sql} ORDER BY t.updated_at DESC, t.id DESC LIMIT 5`,
      p
    );
    const myQueue = await db.all(
      `${TICKET_SELECT} WHERE t.deleted_at IS NULL AND t.assigned_to = ? AND ${active}
       ORDER BY CASE t.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                (t.due_date IS NULL) ASC, t.due_date ASC, t.id DESC
       LIMIT 5`,
      [req.user.id]
    );

    res.json({
      total: counts.total || 0,
      active: byStatus.open + byStatus.in_progress,
      byStatus,
      activeByPriority,
      byCategory,
      overdue: counts.overdue || 0,
      unassigned: counts.unassigned || 0,
      assignedToMe: counts.assigned_to_me || 0,
      createdByMeActive: counts.created_by_me_active || 0,
      groupQueue: counts.group_queue || 0,
      avgResolutionHours: avgHours == null ? null : Math.round(avgHours * 10) / 10,
      trend: days.map((d) => ({ date: d, created: created.get(d) || 0, resolved: resolved.get(d) || 0 })),
      recent: recent.map(serializeTicket),
      myQueue: myQueue.map(serializeTicket),
    });
  });

  return router;
}

module.exports = statsRoutes;

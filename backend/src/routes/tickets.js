const express = require('express');
const {
  HttpError,
  STATUSES,
  ACTIVE_STATUSES,
  DONE_STATUSES,
  PRIORITIES,
  CATEGORIES,
  nowIso,
  todayIso,
  toIso,
  displayName,
  parseId,
  validateTicketInput,
} = require('../utils');
const {
  TICKET_SELECT,
  serializeTicket,
  visibilityClause,
  permissionsFor,
  loadVisibleTicket,
  addEvent,
} = require('../tickets');

const SORTS = {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  title: 't.title COLLATE NOCASE',
  id: 't.id',
  priority: "CASE t.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  status: "CASE t.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END",
};

const CONTENT_FIELDS = ['title', 'description', 'priority', 'category', 'due_date'];

function listParam(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function userSummary(row, prefix = '') {
  const id = row[`${prefix}id`];
  if (!id || !row[`${prefix}username`]) return null;
  const user = {
    username: row[`${prefix}username`],
    firstname: row[`${prefix}firstname`],
    lastname: row[`${prefix}lastname`],
  };
  return { id, username: user.username, name: displayName(user) };
}

async function ensureUserExists(db, id) {
  const row = await db.get('SELECT id FROM users WHERE id = ?', [id]);
  if (!row) throw new HttpError(400, "L'utilisateur à assigner n'existe pas.", { assigned_to: 'Introuvable.' });
}

async function loadTicketDetail(db, user, id) {
  const ticket = await loadVisibleTicket(db, user, id);

  const comments = await db.all(
    `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.username AS author_username,
            u.firstname AS author_firstname, u.lastname AS author_lastname
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.ticket_id = ? ORDER BY c.created_at ASC, c.id ASC`,
    [id]
  );
  const attachments = await db.all(
    `SELECT a.id, a.original_name, a.mime_type, a.size, a.created_at, u.id AS up_id,
            u.username AS up_username, u.firstname AS up_firstname, u.lastname AS up_lastname
     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.ticket_id = ? ORDER BY a.created_at ASC, a.id ASC`,
    [id]
  );
  const events = await db.all(
    `SELECT e.id, e.type, e.from_value, e.to_value, e.created_at, u.id AS actor_id,
            u.username AS actor_username, u.firstname AS actor_firstname, u.lastname AS actor_lastname
     FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.ticket_id = ? ORDER BY e.created_at ASC, e.id ASC`,
    [id]
  );

  // Les changements d'assignation stockent des identifiants : on les traduit en noms.
  const userIds = new Set();
  for (const e of events) {
    if (e.type === 'assignee') {
      if (e.from_value) userIds.add(Number(e.from_value));
      if (e.to_value) userIds.add(Number(e.to_value));
    }
  }
  const names = new Map();
  if (userIds.size) {
    const ids = [...userIds];
    const rows = await db.all(
      `SELECT id, username, firstname, lastname FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    for (const r of rows) names.set(r.id, displayName(r));
  }
  const nameOf = (v) => (v ? names.get(Number(v)) || 'Utilisateur supprimé' : null);

  return {
    ...ticket,
    permissions: permissionsFor(user, ticket),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      created_at: toIso(c.created_at),
      author: userSummary(c, 'author_'),
      canDelete: user.role === 'admin' || c.author_id === user.id,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      name: a.original_name,
      mime_type: a.mime_type,
      size: a.size,
      created_at: toIso(a.created_at),
      uploaded_by: userSummary(a, 'up_'),
      canDelete: user.role === 'admin' || a.up_id === user.id,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      from: e.type === 'assignee' ? nameOf(e.from_value) : e.from_value,
      to: e.type === 'assignee' ? nameOf(e.to_value) : e.to_value,
      created_at: toIso(e.created_at),
      actor: userSummary(e, 'actor_'),
    })),
  };
}

function ticketRoutes({ db }) {
  const router = express.Router();

  // Liste filtrée, triée et paginée.
  router.get('/', async (req, res) => {
    const q = req.query;
    const where = ['t.deleted_at IS NULL'];
    const params = [];

    const vis = visibilityClause(req.user);
    where.push(vis.sql);
    params.push(...vis.params);

    const statuses = listParam(q.status)
      .flatMap((s) => (s === 'active' ? ACTIVE_STATUSES : s === 'done' ? DONE_STATUSES : [s]))
      .filter((s) => STATUSES.includes(s));
    if (statuses.length) {
      where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }

    const priorities = listParam(q.priority).filter((p) => PRIORITIES.includes(p));
    if (priorities.length) {
      where.push(`t.priority IN (${priorities.map(() => '?').join(',')})`);
      params.push(...priorities);
    }

    const categories = listParam(q.category)
      .map((c) => (c === 'none' ? '' : c))
      .filter((c) => CATEGORIES.includes(c));
    if (categories.length) {
      where.push(`t.category IN (${categories.map(() => '?').join(',')})`);
      params.push(...categories);
    }

    if (q.scope === 'mine') {
      where.push('t.created_by = ?');
      params.push(req.user.id);
    } else if (q.scope === 'assigned') {
      where.push('t.assigned_to = ?');
      params.push(req.user.id);
    }

    if (q.assignee === 'unassigned') where.push('t.assigned_to IS NULL');
    else if (q.assignee === 'me') {
      where.push('t.assigned_to = ?');
      params.push(req.user.id);
    } else if (q.assignee && Number.isInteger(Number(q.assignee))) {
      where.push('t.assigned_to = ?');
      params.push(Number(q.assignee));
    }

    if (q.overdue === '1' || q.overdue === 'true') {
      where.push(`t.due_date IS NOT NULL AND t.due_date < ? AND t.status IN ('open', 'in_progress')`);
      params.push(todayIso());
    }

    const search = typeof q.q === 'string' ? q.q.trim() : '';
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push(`(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR CAST(t.id AS TEXT) = ?)`);
      params.push(like, like, search.replace(/^#/, ''));
    }

    const order = String(q.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let orderBy;
    if (q.sort === 'due_date') {
      orderBy = `(t.due_date IS NULL) ASC, t.due_date ${order}`;
    } else {
      orderBy = `${SORTS[q.sort] || SORTS.created_at} ${order}`;
    }

    const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || 20, 1), 100);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const whereSql = where.join(' AND ');

    const { total } = await db.get(`SELECT COUNT(*) AS total FROM tickets t WHERE ${whereSql}`, params);
    const rows = await db.all(
      `${TICKET_SELECT} WHERE ${whereSql} ORDER BY ${orderBy}, t.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    res.json({ items: rows.map(serializeTicket), total, page, pageSize });
  });

  router.post('/', async (req, res) => {
    const values = validateTicketInput(req.body || {}, { partial: false });
    let assignedTo = null;
    if (values.assigned_to != null) {
      if (req.user.role !== 'admin') throw new HttpError(403, 'Seul un administrateur peut assigner un ticket.');
      await ensureUserExists(db, values.assigned_to);
      assignedTo = values.assigned_to;
    }

    const now = nowIso();
    const { lastID } = await db.run(
      `INSERT INTO tickets
        (title, description, priority, category, due_date, status, created_at, updated_at, created_by, assigned_to)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [values.title, values.description, values.priority, values.category, values.due_date, now, now, req.user.id, assignedTo]
    );
    await addEvent(db, lastID, req.user.id, 'created', null, null, now);
    if (assignedTo) await addEvent(db, lastID, req.user.id, 'assignee', null, assignedTo, now);

    res.status(201).json(await loadTicketDetail(db, req.user, lastID));
  });

  router.get('/:id', async (req, res) => {
    res.json(await loadTicketDetail(db, req.user, parseId(req.params.id)));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ticket = await loadVisibleTicket(db, req.user, id);
    const perms = permissionsFor(req.user, ticket);
    const values = validateTicketInput(req.body || {}, { partial: true });

    if (CONTENT_FIELDS.some((f) => f in values) && !perms.canEdit) {
      throw new HttpError(403, "Seul l'auteur du ticket ou un administrateur peut le modifier.");
    }
    if ('status' in values && !perms.canChangeStatus) {
      throw new HttpError(403, "Vous ne pouvez pas changer le statut de ce ticket.");
    }
    if ('assigned_to' in values && !perms.canAssign) {
      throw new HttpError(403, 'Seul un administrateur peut assigner un ticket.');
    }
    if (values.assigned_to != null) await ensureUserExists(db, values.assigned_to);

    const current = {
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      category: ticket.category,
      due_date: ticket.due_date,
      status: ticket.status,
      assigned_to: ticket.assignee?.id ?? null,
    };
    const changes = {};
    for (const [field, value] of Object.entries(values)) {
      if (value !== current[field]) changes[field] = value;
    }
    if (Object.keys(changes).length === 0) {
      return res.json(await loadTicketDetail(db, req.user, id));
    }

    const now = nowIso();
    changes.updated_at = now;
    if ('status' in changes) {
      if (DONE_STATUSES.includes(changes.status) && !ACTIVE_STATUSES.includes(current.status)) {
        // resolved <-> closed : on conserve la date de résolution d'origine
      } else if (DONE_STATUSES.includes(changes.status)) {
        changes.resolved_at = now;
      } else {
        changes.resolved_at = null;
      }
    }

    const columns = Object.keys(changes); // uniquement des noms issus de la validation
    await db.run(`UPDATE tickets SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...columns.map((c) => changes[c]),
      id,
    ]);

    if ('status' in changes) await addEvent(db, id, req.user.id, 'status', current.status, changes.status, now);
    if ('priority' in changes) await addEvent(db, id, req.user.id, 'priority', current.priority, changes.priority, now);
    if ('assigned_to' in changes) {
      await addEvent(db, id, req.user.id, 'assignee', current.assigned_to, changes.assigned_to, now);
    }
    const edited = ['title', 'description', 'category', 'due_date'].filter((f) => f in changes);
    if (edited.length) await addEvent(db, id, req.user.id, 'edited', null, edited.join(','), now);

    res.json(await loadTicketDetail(db, req.user, id));
  });

  // Suppression = mise à la corbeille (restaurable par un administrateur).
  router.delete('/:id', async (req, res) => {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Seul un administrateur peut supprimer un ticket.');
    const id = parseId(req.params.id);
    await loadVisibleTicket(db, req.user, id);
    const now = nowIso();
    await db.run('UPDATE tickets SET deleted_at = ?, deleted_by = ? WHERE id = ?', [now, req.user.id, id]);
    await addEvent(db, id, req.user.id, 'deleted', null, null, now);
    res.json({ success: true });
  });

  router.post('/:id/comments', async (req, res) => {
    const id = parseId(req.params.id);
    await loadVisibleTicket(db, req.user, id);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) throw new HttpError(400, 'Le commentaire est vide.', { body: 'Requis.' });
    if (body.length > 5000) throw new HttpError(400, 'Commentaire trop long (5 000 caractères maximum).');

    const now = nowIso();
    const { lastID } = await db.run(
      'INSERT INTO comments (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)',
      [id, req.user.id, body, now]
    );
    await db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', [now, id]);
    res.status(201).json({
      id: lastID,
      body,
      created_at: now,
      author: { id: req.user.id, username: req.user.username, name: req.user.name },
      canDelete: true,
    });
  });

  router.delete('/:id/comments/:commentId', async (req, res) => {
    const id = parseId(req.params.id);
    const commentId = parseId(req.params.commentId, 'Commentaire');
    await loadVisibleTicket(db, req.user, id);
    const comment = await db.get('SELECT * FROM comments WHERE id = ? AND ticket_id = ?', [commentId, id]);
    if (!comment) throw new HttpError(404, 'Commentaire introuvable.');
    if (req.user.role !== 'admin' && comment.author_id !== req.user.id) {
      throw new HttpError(403, "Seul l'auteur du commentaire ou un administrateur peut le supprimer.");
    }
    await db.run('DELETE FROM comments WHERE id = ?', [commentId]);
    res.json({ success: true });
  });

  return router;
}

module.exports = { ticketRoutes, loadTicketDetail };

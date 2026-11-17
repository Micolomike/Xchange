const express = require('express');
const { logUserEvent } = require('../systemLog');
const { refreshSla } = require('../sla');
const {
  HttpError,
  STATUSES,
  ACTIVE_STATUSES,
  DONE_STATUSES,
  PRIORITIES,
  nowIso,
  todayIso,
  toIso,
  displayName,
  parseId,
  validateTicketInput,
} = require('../utils');
const { getSetting } = require('../settings');
const { canCreate } = require('../access');
const {
  TICKET_SELECT,
  serializeTicket,
  visibilityClause,
  MY_GROUPS_SQL,
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

async function ensureGroupExists(db, id) {
  const row = await db.get('SELECT id, name FROM user_groups WHERE id = ?', [id]);
  if (!row) throw new HttpError(400, "Ce groupe n'existe pas.", { assigned_group: 'Introuvable.' });
  return row;
}

/** Un ticket affecté à un groupe ne peut avoir pour responsable qu'un membre de ce groupe. */
async function ensureMember(db, groupId, userId) {
  const row = await db.get('SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  if (!row) {
    throw new HttpError(400, "Le responsable doit faire partie du groupe d'affectation.", {
      assigned_to: "Pas membre du groupe d'affectation.",
    });
  }
}

async function loadTicketDetail(db, user, id) {
  const ticket = await loadVisibleTicket(db, user, id);

  const comments = await db.all(
    `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.username AS author_username,
            CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.firstname END AS author_firstname, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.lastname END AS author_lastname,
            i.id AS imp_id, i.username AS imp_username, CASE WHEN i.hide_real_name = 1 THEN '' ELSE i.firstname END AS imp_firstname, CASE WHEN i.hide_real_name = 1 THEN '' ELSE i.lastname END AS imp_lastname
     FROM comments c LEFT JOIN users u ON u.id = c.author_id LEFT JOIN users i ON i.id = c.impersonator_id
     WHERE c.ticket_id = ? ORDER BY c.created_at ASC, c.id ASC`,
    [id]
  );
  const attachments = await db.all(
    `SELECT a.id, a.original_name, a.mime_type, a.size, a.created_at, u.id AS up_id,
            u.username AS up_username, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.firstname END AS up_firstname, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.lastname END AS up_lastname
     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.ticket_id = ? ORDER BY a.created_at ASC, a.id ASC`,
    [id]
  );
  const events = await db.all(
    `SELECT e.id, e.type, e.from_value, e.to_value, e.created_at, u.id AS actor_id,
            u.username AS actor_username, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.firstname END AS actor_firstname, CASE WHEN u.hide_real_name = 1 THEN '' ELSE u.lastname END AS actor_lastname,
            i.id AS imp_id, i.username AS imp_username, CASE WHEN i.hide_real_name = 1 THEN '' ELSE i.firstname END AS imp_firstname, CASE WHEN i.hide_real_name = 1 THEN '' ELSE i.lastname END AS imp_lastname
     FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id LEFT JOIN users i ON i.id = e.impersonator_id
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
      `SELECT id, username, CASE WHEN hide_real_name = 1 THEN '' ELSE firstname END AS firstname, CASE WHEN hide_real_name = 1 THEN '' ELSE lastname END AS lastname FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    for (const r of rows) names.set(r.id, displayName(r));
  }
  const nameOf = (v) => (v ? names.get(Number(v)) || 'Utilisateur supprimé' : null);

  const groupNames = new Map(
    (await db.all('SELECT id, name FROM user_groups')).map((g) => [g.id, g.name])
  );
  const groupOf = (v) => (v ? groupNames.get(Number(v)) || 'Groupe supprimé' : null);
  const label = (e, v) => (e.type === 'assignee' ? nameOf(v) : e.type === 'group' ? groupOf(v) : v);

  return {
    ...ticket,
    permissions: permissionsFor(user, ticket),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      created_at: toIso(c.created_at),
      author: userSummary(c, 'author_'),
      on_behalf_by: userSummary(c, 'imp_')?.name || null,
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
      from: label(e, e.from_value),
      to: label(e, e.to_value),
      created_at: toIso(e.created_at),
      actor: userSummary(e, 'actor_'),
      on_behalf_by: userSummary(e, 'imp_')?.name || null,
    })),
  };
}

async function activeCategories(db) {
  return (await getSetting(db, 'categories')).filter((c) => c.active).map((c) => c.key);
}

/** Date limite par défaut selon la priorité (Administration > Paramètres), ou null. */
async function defaultDueDate(db, priority) {
  const days = (await getSetting(db, 'priorities'))[priority]?.days;
  if (days == null) return null;
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Après un transfert vers un groupe dont l'utilisateur ne fait pas partie, le ticket
 * peut lui devenir invisible : on renvoie alors l'essentiel avec noLongerVisible.
 */
async function detailAfterChange(db, user, id) {
  try {
    return await loadTicketDetail(db, user, id);
  } catch (err) {
    if (err.status !== 404) throw err;
    const ticket = await loadVisibleTicket(db, { role: 'admin' }, id);
    return { id: ticket.id, title: ticket.title, group: ticket.group, noLongerVisible: true };
  }
}

const NOOP = () => Promise.resolve();
const NOOP_NOTIFIER = { ticketCreated: NOOP, commentAdded: NOOP, statusChanged: NOOP, assigned: NOOP, groupChanged: NOOP };

function ticketRoutes({ db, notifier = NOOP_NOTIFIER }) {
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
      .filter((c) => /^[a-z0-9_]{0,40}$/.test(c));
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
    } else if (q.scope === 'groups') {
      where.push(`t.assigned_group IN (${MY_GROUPS_SQL})`);
      params.push(req.user.id);
    }

    if (q.group === 'none') where.push('t.assigned_group IS NULL');
    else if (q.group === 'mine') {
      where.push(`t.assigned_group IN (${MY_GROUPS_SQL})`);
      params.push(req.user.id);
    } else if (q.group && Number.isInteger(Number(q.group))) {
      where.push('t.assigned_group = ?');
      params.push(Number(q.group));
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

    // SLA : demandes en cours dont un délai est dépassé, ou proche de l'être.
    if (q.sla === 'breached' || q.sla === 'at_risk') {
      const n = new Date().toISOString();
      where.push("t.status IN ('open', 'in_progress')");
      if (q.sla === 'breached') {
        where.push('((t.sla_responded_at IS NULL AND t.sla_response_due < ?) OR t.sla_resolution_due < ?)');
        params.push(n, n);
      } else {
        where.push(`(((t.sla_responded_at IS NULL AND t.sla_response_warn <= ? AND t.sla_response_due >= ?) OR (t.sla_resolution_warn <= ? AND t.sla_resolution_due >= ?))
          AND NOT ((t.sla_responded_at IS NULL AND t.sla_response_due < ?) OR t.sla_resolution_due < ?))`);
        params.push(n, n, n, n, n, n);
      }
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
    if (!canCreate(req.user)) throw new HttpError(403, "Votre compte ne peut pas créer de ticket. Demandez-le à un administrateur.");
    const values = validateTicketInput(req.body || {}, { partial: false, categories: await activeCategories(db) });
    if (!values.due_date) values.due_date = await defaultDueDate(db, values.priority);
    let assignedTo = null;
    const assignedGroup = values.assigned_group ?? null;
    if (assignedGroup) await ensureGroupExists(db, assignedGroup);
    if (values.assigned_to != null) {
      if (req.user.role !== 'admin') throw new HttpError(403, 'Seul un administrateur peut assigner un ticket.');
      await ensureUserExists(db, values.assigned_to);
      if (assignedGroup) await ensureMember(db, assignedGroup, values.assigned_to);
      assignedTo = values.assigned_to;
    }

    const now = nowIso();
    const { lastID } = await db.run(
      `INSERT INTO tickets
        (title, description, priority, category, due_date, status, created_at, updated_at, created_by, assigned_to, assigned_group, confidential)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      [values.title, values.description, values.priority, values.category, values.due_date, now, now, req.user.id, assignedTo,
        assignedGroup, values.confidential ? 1 : 0]
    );
    await addEvent(db, lastID, req.user.id, 'created', null, null, now);
    if (assignedGroup) await addEvent(db, lastID, req.user.id, 'group', null, assignedGroup, now);
    if (assignedTo) await addEvent(db, lastID, req.user.id, 'assignee', null, assignedTo, now);
    if (assignedGroup) notifier.ticketCreated(lastID, req.user.id);
    if (assignedTo) notifier.assigned(lastID, req.user.id);
    await refreshSla(db, lastID);
    await logUserEvent(db, `Demande n°${lastID} créée`, { subjectId: req.user.id });

    res.status(201).json(await loadTicketDetail(db, req.user, lastID));
  });

  router.get('/:id', async (req, res) => {
    res.json(await loadTicketDetail(db, req.user, parseId(req.params.id)));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ticket = await loadVisibleTicket(db, req.user, id);
    const perms = permissionsFor(req.user, ticket);
    const values = validateTicketInput(req.body || {}, {
      partial: true,
      categories: [...(await activeCategories(db)), ticket.category],
    });

    if (CONTENT_FIELDS.some((f) => f in values) && !perms.canEdit) {
      throw new HttpError(403, "Seul l'auteur du ticket ou un administrateur peut le modifier.");
    }
    if ('status' in values && !perms.canChangeStatus) {
      throw new HttpError(403, "Vous ne pouvez pas changer le statut de ce ticket.");
    }
    if ('confidential' in values && values.confidential !== ticket.confidential && !perms.canSetConfidential) {
      throw new HttpError(403, "Seul l'auteur de la demande peut la rendre confidentielle ou non.");
    }
    if ('assigned_group' in values && values.assigned_group !== (ticket.group?.id ?? null) && !perms.canChangeGroup) {
      throw new HttpError(403, "Seuls un administrateur ou les membres du groupe peuvent changer le groupe d'affectation.");
    }
    if ('assigned_to' in values && values.assigned_to !== (ticket.assignee?.id ?? null) && !perms.canAssign) {
      throw new HttpError(403, 'Seuls un administrateur ou les membres du groupe peuvent assigner ce ticket.');
    }
    if (values.assigned_to != null) await ensureUserExists(db, values.assigned_to);
    if (values.assigned_group != null) await ensureGroupExists(db, values.assigned_group);

    // Responsable et groupe doivent rester cohérents.
    const finalGroup = 'assigned_group' in values ? values.assigned_group : ticket.group?.id ?? null;
    const groupChanged = finalGroup !== (ticket.group?.id ?? null);
    if (finalGroup) {
      if (values.assigned_to != null) {
        await ensureMember(db, finalGroup, values.assigned_to);
      } else if (!('assigned_to' in values) && groupChanged && ticket.assignee) {
        // Transfert à un autre groupe : le responsable actuel est retiré s'il n'en fait pas partie.
        const member = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [
          finalGroup,
          ticket.assignee.id,
        ]);
        if (!member) values.assigned_to = null;
      }
    }
    if (req.user.role !== 'admin' && values.assigned_to != null && !finalGroup) {
      throw new HttpError(403, 'Seul un administrateur peut assigner un ticket sans groupe.');
    }

    const current = {
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      category: ticket.category,
      due_date: ticket.due_date,
      status: ticket.status,
      assigned_to: ticket.assignee?.id ?? null,
      assigned_group: ticket.group?.id ?? null,
      confidential: ticket.confidential,
    };
    const changes = {};
    for (const [field, value] of Object.entries(values)) {
      if (value !== current[field]) changes[field] = value;
    }
    if (Object.keys(changes).length === 0) {
      return res.json(await detailAfterChange(db, req.user, id));
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

    if ('confidential' in changes) changes.confidential = changes.confidential ? 1 : 0;
    const columns = Object.keys(changes); // uniquement des noms issus de la validation
    await db.run(`UPDATE tickets SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...columns.map((c) => changes[c]),
      id,
    ]);

    if ('status' in changes) await addEvent(db, id, req.user.id, 'status', current.status, changes.status, now);
    if ('priority' in changes) await addEvent(db, id, req.user.id, 'priority', current.priority, changes.priority, now);
    if ('confidential' in changes) {
      await addEvent(db, id, req.user.id, 'confidential', null, changes.confidential ? 'oui' : 'non', now);
    }
    if ('assigned_group' in changes) {
      await addEvent(db, id, req.user.id, 'group', current.assigned_group, changes.assigned_group, now);
    }
    if ('assigned_to' in changes) {
      await addEvent(db, id, req.user.id, 'assignee', current.assigned_to, changes.assigned_to, now);
    }
    if ('status' in changes) notifier.statusChanged(id, req.user.id, changes.status);
    if (changes.assigned_to) notifier.assigned(id, req.user.id);
    if (changes.assigned_group) notifier.groupChanged(id, req.user.id);
    const edited = ['title', 'description', 'category', 'due_date'].filter((f) => f in changes);
    if (edited.length) await addEvent(db, id, req.user.id, 'edited', null, edited.join(','), now);
    await refreshSla(db, id);

    res.json(await detailAfterChange(db, req.user, id));
  });

  // Suppression = mise à la corbeille (restaurable par un administrateur).
  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ticket = await loadVisibleTicket(db, req.user, id);
    if (!permissionsFor(req.user, ticket).canDelete) throw new HttpError(403, "Vous n'avez pas le droit de supprimer ce ticket.");
    const now = nowIso();
    await db.run('UPDATE tickets SET deleted_at = ?, deleted_by = ? WHERE id = ?', [now, req.user.id, id]);
    await addEvent(db, id, req.user.id, 'deleted', null, null, now);
    await logUserEvent(db, `Demande n°${id} mise à la corbeille`, { subjectId: req.user.id });
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
      'INSERT INTO comments (ticket_id, author_id, body, created_at, impersonator_id) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.id, body, now, req.user.impersonator?.id ?? null]
    );
    await db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', [now, id]);
    await refreshSla(db, id);
    notifier.commentAdded(id, req.user.id, body);
    res.status(201).json({
      id: lastID,
      body,
      created_at: now,
      author: { id: req.user.id, username: req.user.username, name: req.user.name },
      on_behalf_by: req.user.impersonator?.name || null,
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

module.exports = { ticketRoutes, loadTicketDetail, defaultDueDate, NOOP_NOTIFIER };

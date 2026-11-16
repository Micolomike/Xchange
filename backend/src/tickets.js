const { HttpError, toIso, displayName } = require('./utils');

const TICKET_SELECT = `
  SELECT t.*,
    c.username AS c_username, c.firstname AS c_firstname, c.lastname AS c_lastname,
    a.username AS a_username, a.firstname AS a_firstname, a.lastname AS a_lastname,
    d.username AS d_username, d.firstname AS d_firstname, d.lastname AS d_lastname,
    g.name AS g_name, ci.name AS ci_name,
    (SELECT COUNT(*) FROM comments WHERE ticket_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM attachments WHERE ticket_id = t.id) AS attachment_count
  FROM tickets t
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users d ON d.id = t.deleted_by
  LEFT JOIN user_groups g ON g.id = t.assigned_group
  LEFT JOIN catalog_items ci ON ci.id = t.catalog_item
`;

function userRef(row, prefix, id) {
  if (!id || !row[`${prefix}_username`]) return null;
  const user = {
    username: row[`${prefix}_username`],
    firstname: row[`${prefix}_firstname`],
    lastname: row[`${prefix}_lastname`],
  };
  return { id, username: user.username, name: displayName(user) };
}

function parseAnswers(text) {
  if (!text) return [];
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function serializeTicket(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    category: row.category || '',
    status: row.status,
    due_date: row.due_date || null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    resolved_at: toIso(row.resolved_at),
    deleted_at: toIso(row.deleted_at),
    creator: userRef(row, 'c', row.created_by),
    assignee: userRef(row, 'a', row.assigned_to),
    group: row.assigned_group && row.g_name ? { id: row.assigned_group, name: row.g_name } : null,
    form: row.form_answers ? { id: row.catalog_item || null, name: row.ci_name || null } : null,
    answers: parseAnswers(row.form_answers),
    deleted_by: userRef(row, 'd', row.deleted_by),
    comment_count: row.comment_count || 0,
    attachment_count: row.attachment_count || 0,
  };
}

const MY_GROUPS_SQL = 'SELECT group_id FROM group_members WHERE user_id = ?';

/**
 * Clause SQL limitant les tickets visibles : tout pour un admin ; sinon créés par moi,
 * assignés à moi, ou affectés à un de mes groupes.
 */
function visibilityClause(user) {
  if (user.role === 'admin') return { sql: '1 = 1', params: [] };
  return {
    sql: `(t.created_by = ? OR t.assigned_to = ? OR t.assigned_group IN (${MY_GROUPS_SQL}))`,
    params: [user.id, user.id, user.id],
  };
}

async function userGroupIds(db, userId) {
  return (await db.all(MY_GROUPS_SQL, [userId])).map((r) => r.group_id);
}

function permissionsFor(user, ticket, groupIds = []) {
  const isAdmin = user.role === 'admin';
  const isCreator = ticket.creator?.id === user.id;
  const isAssignee = ticket.assignee?.id === user.id;
  const inGroup = Boolean(ticket.group && groupIds.includes(ticket.group.id));
  return {
    canEdit: isAdmin || isCreator,
    canChangeStatus: isAdmin || isCreator || isAssignee || inGroup,
    canAssign: isAdmin || inGroup,
    canChangeGroup: isAdmin || inGroup,
    canDelete: isAdmin,
    canComment: true,
  };
}

/** Charge un ticket non supprimé visible par l'utilisateur, ou lève 404. */
async function loadVisibleTicket(db, user, id, { includeDeleted = false } = {}) {
  const vis = visibilityClause(user);
  const row = await db.get(
    `${TICKET_SELECT} WHERE t.id = ? AND ${vis.sql} ${includeDeleted ? '' : 'AND t.deleted_at IS NULL'}`,
    [id, ...vis.params]
  );
  if (!row) throw new HttpError(404, 'Ticket introuvable.');
  return serializeTicket(row);
}

async function addEvent(db, ticketId, actorId, type, fromValue = null, toValue = null, at = new Date().toISOString()) {
  await db.run(
    `INSERT INTO ticket_events (ticket_id, actor_id, type, from_value, to_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ticketId, actorId, type, fromValue == null ? null : String(fromValue), toValue == null ? null : String(toValue), at]
  );
}

module.exports = {
  TICKET_SELECT,
  serializeTicket,
  visibilityClause,
  MY_GROUPS_SQL,
  userGroupIds,
  permissionsFor,
  loadVisibleTicket,
  addEvent,
};

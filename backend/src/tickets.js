const { HttpError, toIso, displayName } = require('./utils');

const TICKET_SELECT = `
  SELECT t.*,
    c.username AS c_username, CASE WHEN c.hide_real_name = 1 THEN '' ELSE c.firstname END AS c_firstname, CASE WHEN c.hide_real_name = 1 THEN '' ELSE c.lastname END AS c_lastname,
    a.username AS a_username, CASE WHEN a.hide_real_name = 1 THEN '' ELSE a.firstname END AS a_firstname, CASE WHEN a.hide_real_name = 1 THEN '' ELSE a.lastname END AS a_lastname,
    d.username AS d_username, CASE WHEN d.hide_real_name = 1 THEN '' ELSE d.firstname END AS d_firstname, CASE WHEN d.hide_real_name = 1 THEN '' ELSE d.lastname END AS d_lastname,
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
    confidential: Boolean(row.confidential),
  };
}

const MY_GROUPS_SQL = 'SELECT group_id FROM group_members WHERE user_id = ?';
const { visibilityClause, permissionsFor } = require('./access');
const { currentImpersonatorId } = require('./requestContext');

async function userGroupIds(db, userId) {
  return (await db.all(MY_GROUPS_SQL, [userId])).map((r) => r.group_id);
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
  // impersonator_id : administrateur qui agissait à la place de l'utilisateur, le cas échéant.
  await db.run(
    `INSERT INTO ticket_events (ticket_id, actor_id, type, from_value, to_value, created_at, impersonator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ticketId, actorId, type, fromValue == null ? null : String(fromValue), toValue == null ? null : String(toValue), at,
      currentImpersonatorId()]
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

/**
 * Droits par groupe (Administration > Paramètres > Droits et visibilité).
 *
 * - Une ligne « Tous les utilisateurs » (base) et une ligne par groupe ; les droits d'une
 *   personne sont la réunion de la base et de ceux de ses groupes.
 * - Voir : « own » (ses tickets : créés ou assignés), « group » (+ ceux affectés à ses groupes),
 *   « all » (tous, sauf les catégories réservées à d'autres groupes).
 * - Règles par catégorie : les membres des groupes listés voient tous les tickets de cette
 *   catégorie ; les autres n'y ont plus accès par le droit « Voir : tous ».
 * - Une demande confidentielle n'est visible que par son auteur, son responsable et les membres
 *   de son groupe d'affectation, administrateurs compris.
 */
const { HttpError } = require('./utils');
const { getSetting } = require('./settings');

const RIGHTS = ['create', 'work', 'assign', 'edit', 'delete'];
const VIEWS = ['own', 'group', 'all'];
const DEFAULT_BASE = { view: 'own', create: true, work: false, assign: false, edit: false, delete: false };
const DEFAULT_GROUP = { view: 'group', create: true, work: true, assign: true, edit: false, delete: false };

function normalizeRow(raw, fallback, { base = false } = {}) {
  const row = { ...fallback, ...(raw || {}) };
  const out = { view: VIEWS.includes(row.view) ? row.view : fallback.view };
  if (base && out.view === 'group') out.view = 'own';
  for (const r of RIGHTS) out[r] = Boolean(row[r]);
  return out;
}

async function getAccessSettings(db) {
  const raw = await getSetting(db, 'access');
  const groups = await db.all('SELECT id FROM user_groups');
  const categories = raw.categories && typeof raw.categories === 'object' ? raw.categories : {};
  const groupIds = new Set(groups.map((g) => g.id));
  return {
    base: normalizeRow(raw.base, DEFAULT_BASE, { base: true }),
    groups: Object.fromEntries(groups.map((g) => [g.id, normalizeRow(raw.groups?.[g.id], DEFAULT_GROUP)])),
    categories: Object.fromEntries(
      Object.entries(categories)
        .map(([key, list]) => [key, (Array.isArray(list) ? list : []).map(Number).filter((id) => groupIds.has(id))])
        .filter(([, list]) => list.length)
    ),
  };
}

function validateAccessSettings(body, { groupIds, categoryKeys }) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Réglages invalides.');
  const check = (row, where, base) => {
    if (!row || typeof row !== 'object') throw new HttpError(400, `${where} : réglages invalides.`);
    if (!VIEWS.includes(row.view) || (base && row.view === 'group')) throw new HttpError(400, `${where} : visibilité inconnue.`);
    return normalizeRow(row, base ? DEFAULT_BASE : DEFAULT_GROUP, { base });
  };
  const out = { base: check(body.base, 'Tous les utilisateurs', true), groups: {}, categories: {} };
  for (const [id, row] of Object.entries(body.groups || {})) {
    if (!groupIds.includes(Number(id))) throw new HttpError(400, "Un des groupes n'existe plus. Actualisez la page.");
    out.groups[Number(id)] = check(row, 'Groupe', false);
  }
  for (const [key, list] of Object.entries(body.categories || {})) {
    if (!categoryKeys.includes(key)) throw new HttpError(400, "Une des catégories n'existe plus. Actualisez la page.");
    if (!Array.isArray(list) || list.some((id) => !groupIds.includes(Number(id)))) {
      throw new HttpError(400, 'Règle de catégorie invalide.');
    }
    if (list.length) out.categories[key] = [...new Set(list.map(Number))];
  }
  return out;
}

/** Droits effectifs d'une personne, calculés à chaque requête (changements immédiats). */
async function computeAccess(db, userRow) {
  const settings = await getAccessSettings(db);
  const groupIds = (await db.all('SELECT group_id FROM group_members WHERE user_id = ?', [userRow.id])).map((r) => r.group_id);
  const rows = [settings.base, ...groupIds.map((id) => settings.groups[id]).filter(Boolean)];
  const rights = Object.fromEntries(RIGHTS.map((r) => [r, rows.some((row) => row[r])]));
  const restricted = Object.keys(settings.categories);
  const granted = restricted.filter((key) => settings.categories[key].some((id) => groupIds.includes(id)));
  return {
    groupIds,
    viewGroupIds: groupIds.filter((id) => settings.groups[id] && settings.groups[id].view !== 'own'),
    scopeAll: rows.some((row) => row.view === 'all'),
    rights,
    grantedCategories: granted,
    hiddenCategories: restricted.filter((key) => !granted.includes(key)),
  };
}

const placeholders = (list) => list.map(() => '?').join(',');

/** Clause SQL des tickets visibles par l'utilisateur (alias de table : t). */
function visibilityClause(user) {
  const base = baseVisibility(user);
  // Administrateur à la place d'un utilisateur : les demandes confidentielles restent masquées.
  if (user.impersonator) return { sql: `(${base.sql} AND t.confidential = 0)`, params: base.params };
  return base;
}

function baseVisibility(user) {
  const a = user.access || { groupIds: [], viewGroupIds: [], scopeAll: false, grantedCategories: [], hiddenCategories: [] };
  if (user.role === 'admin') {
    if (!user.id) return { sql: '1 = 1', params: [] };
    const parts = ['t.confidential = 0', 't.created_by = ?', 't.assigned_to = ?'];
    const params = [user.id, user.id];
    if (a.groupIds.length) {
      parts.push(`t.assigned_group IN (${placeholders(a.groupIds)})`);
      params.push(...a.groupIds);
    }
    return { sql: `(${parts.join(' OR ')})`, params };
  }
  const parts = ['t.created_by = ?', 't.assigned_to = ?'];
  const params = [user.id, user.id];
  if (a.viewGroupIds.length) {
    parts.push(`t.assigned_group IN (${placeholders(a.viewGroupIds)})`);
    params.push(...a.viewGroupIds);
  }
  if (a.grantedCategories.length) {
    parts.push(`(t.confidential = 0 AND t.category IN (${placeholders(a.grantedCategories)}))`);
    params.push(...a.grantedCategories);
  }
  if (a.scopeAll) {
    if (a.hiddenCategories.length) {
      parts.push(`(t.confidential = 0 AND t.category NOT IN (${placeholders(a.hiddenCategories)}))`);
      params.push(...a.hiddenCategories);
    } else parts.push('t.confidential = 0');
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

function permissionsFor(user, ticket) {
  const isAdmin = user.role === 'admin';
  const rights = user.access?.rights || {};
  const isCreator = ticket.creator?.id === user.id;
  const isAssignee = ticket.assignee?.id === user.id;
  return {
    canEdit: isAdmin || isCreator || rights.edit,
    canChangeStatus: isAdmin || isCreator || isAssignee || rights.work,
    canAssign: isAdmin || rights.assign,
    canChangeGroup: isAdmin || rights.assign,
    canDelete: isAdmin || rights.delete,
    canComment: true,
    canSetConfidential: isCreator,
  };
}

function canCreate(user) {
  return user.role === 'admin' || Boolean(user.access?.rights?.create);
}

module.exports = {
  RIGHTS,
  VIEWS,
  DEFAULT_BASE,
  DEFAULT_GROUP,
  getAccessSettings,
  validateAccessSettings,
  computeAccess,
  visibilityClause,
  permissionsFor,
  canCreate,
};

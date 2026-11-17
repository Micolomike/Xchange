/**
 * Discussions en direct : salon général, salon de chaque groupe, messages privés et conversations libres.
 * Les nouveaux messages sont poussés aux navigateurs connectés (flux SSE).
 * Les administrateurs ne lisent pas les conversations : seulement les messages qu'on leur signale.
 */
const { displayName } = require('./utils');

const MAX_MESSAGE = 2000;
const RETENTION_CHOICES = [0, 30, 180, 365]; // 0 : tant que le compte existe

/** Nom affiché d'une personne dans les discussions (pseudonyme seul si elle l'a choisi). */
const chatName = (u) =>
  !u || !u.username ? 'Compte supprimé' : u.hide_real_name ? u.username : displayName(u);

/** Connexions ouvertes : un même compte peut avoir plusieurs onglets. */
function createHub({ logger = console } = {}) {
  const clients = new Map(); // userId -> Set(res)

  function add(userId, res) {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
    return () => {
      const set = clients.get(userId);
      if (!set) return;
      set.delete(res);
      if (!set.size) clients.delete(userId);
    };
  }

  function send(userIds, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const id of userIds) {
      for (const res of clients.get(id) || []) {
        try {
          res.write(payload);
        } catch (err) {
          logger.error(`Discussion : envoi impossible (${err.message})`);
        }
      }
    }
  }

  const ping = setInterval(() => {
    for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
  }, 25_000);
  ping.unref();

  return { add, send, connected: () => [...clients.keys()], close: () => clearInterval(ping) };
}

/**
 * Salons à créer à la demande : le salon général et celui de chacun de ses groupes.
 */
async function ensureChannels(db, userId) {
  const now = new Date().toISOString();
  if (!(await db.get("SELECT id FROM chat_conversations WHERE kind = 'general'"))) {
    await db.run("INSERT INTO chat_conversations (kind, name, created_at) VALUES ('general', 'Salon général', ?)", [now]);
  }
  await db.run(
    `INSERT INTO chat_conversations (kind, group_id, created_at)
     SELECT 'group', m.group_id, ? FROM group_members m
     WHERE m.user_id = ? AND NOT EXISTS (SELECT 1 FROM chat_conversations c WHERE c.kind = 'group' AND c.group_id = m.group_id)`,
    [now, userId]
  );
}

/** Condition SQL : conversations accessibles à la personne (paramètre : son id, trois fois). */
const ACCESS_SQL = `(
  c.kind = 'general'
  OR (c.kind = 'group' AND c.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))
  OR (c.kind IN ('direct', 'custom') AND c.id IN (SELECT conversation_id FROM chat_members WHERE user_id = ?))
)`;

async function canAccess(db, userId, conversationId) {
  return Boolean(
    await db.get(`SELECT c.id FROM chat_conversations c WHERE c.id = ? AND ${ACCESS_SQL}`, [conversationId, userId, userId])
  );
}

/** Destinataires d'un événement sur une conversation. */
async function audience(db, conv) {
  if (conv.kind === 'general') return (await db.all('SELECT id FROM users WHERE anonymized_at IS NULL')).map((r) => r.id);
  if (conv.kind === 'group') return (await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [conv.group_id])).map((r) => r.user_id);
  return (await db.all('SELECT user_id FROM chat_members WHERE conversation_id = ?', [conv.id])).map((r) => r.user_id);
}

const USER_COLS = (a) => `${a}.id AS ${a}_id, ${a}.username AS ${a}_username, ${a}.firstname AS ${a}_firstname,
  ${a}.lastname AS ${a}_lastname, ${a}.hide_real_name AS ${a}_hide`;
const pick = (row, a) =>
  row[`${a}_username`]
    ? { username: row[`${a}_username`], firstname: row[`${a}_firstname`], lastname: row[`${a}_lastname`], hide_real_name: row[`${a}_hide`] }
    : null;

function serializeMessage(row, meId) {
  const author = pick(row, 'u');
  return {
    id: row.id,
    conversationId: row.conversation_id,
    author: row.author_id ? { id: row.author_id, name: chatName(author), username: author?.username || null } : null,
    body: row.deleted_at ? null : row.body,
    deleted: Boolean(row.deleted_at),
    deletedByModeration: Boolean(row.deleted_at && row.deleted_by && row.deleted_by !== row.author_id),
    createdAt: row.created_at,
    mine: row.author_id === meId,
  };
}

const MESSAGE_SELECT = `SELECT m.*, ${USER_COLS('u')} FROM chat_messages m LEFT JOIN users u ON u.id = m.author_id`;

module.exports = { MAX_MESSAGE, RETENTION_CHOICES, chatName, createHub, ensureChannels, ACCESS_SQL, canAccess, audience, serializeMessage, MESSAGE_SELECT, USER_COLS, pick };

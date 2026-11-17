const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

/** Petite surcouche à base de promesses autour de sqlite3. */
class Database {
  constructor(raw) {
    this.raw = raw;
  }

  static open(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    return new Promise((resolve, reject) => {
      const raw = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(new Database(raw))));
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.raw.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.raw.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.raw.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.raw.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.raw.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  email TEXT,
  firstname TEXT,
  lastname TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  description TEXT,
  priority TEXT,
  category TEXT,
  due_date TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS user_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  active INTEGER NOT NULL DEFAULT 1,
  fulfillment_group INTEGER REFERENCES user_groups(id) ON DELETE SET NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_visibility (
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, group_id)
);

CREATE TABLE IF NOT EXISTS group_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS impersonations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  event TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS rgpd_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  handled_at TEXT,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terms_versions (
  version INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_misses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  group_id INTEGER REFERENCES user_groups(id) ON DELETE CASCADE,
  name TEXT,
  direct_key TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  last_message_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_members (
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_reads (
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS chat_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES chat_conversations(id) ON DELETE SET NULL,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  created_at TEXT NOT NULL
);
`;

// Colonnes ajoutées depuis la première version : ajoutées à chaud sur une base existante.
const ADDED_COLUMNS = {
  users: {
    role: "TEXT NOT NULL DEFAULT 'user'",
    token_version: 'INTEGER NOT NULL DEFAULT 0',
    mfa_enabled: 'INTEGER NOT NULL DEFAULT 0',
    mfa_secret: 'TEXT',
    mfa_pending_secret: 'TEXT',
    mfa_last_step: 'INTEGER NOT NULL DEFAULT 0',
    mfa_exempt: 'INTEGER NOT NULL DEFAULT 0',
    notify_email: 'INTEGER NOT NULL DEFAULT 1',
    notify_prefs: 'TEXT',
    last_seen_at: 'TEXT',
    anonymized_at: 'TEXT',
    terms_accepted_at: 'TEXT',
    mfa_exempt_by: 'TEXT',
    terms_version: 'INTEGER NOT NULL DEFAULT 0',
    hide_real_name: 'INTEGER NOT NULL DEFAULT 0',
    inactivity_warned_at: 'TEXT',
    mfa_exempt_at: 'TEXT',
    chat_retention_days: 'INTEGER NOT NULL DEFAULT 0',
  },
  tickets: {
    status: "TEXT NOT NULL DEFAULT 'open'",
    updated_at: 'TEXT',
    resolved_at: 'TEXT',
    created_by: 'INTEGER REFERENCES users(id) ON DELETE SET NULL',
    assigned_to: 'INTEGER REFERENCES users(id) ON DELETE SET NULL',
    deleted_at: 'TEXT',
    deleted_by: 'INTEGER REFERENCES users(id) ON DELETE SET NULL',
    assigned_group: 'INTEGER REFERENCES user_groups(id) ON DELETE SET NULL',
    catalog_item: 'INTEGER REFERENCES catalog_items(id) ON DELETE SET NULL',
    form_answers: 'TEXT',
    confidential: 'INTEGER NOT NULL DEFAULT 0',
  },
  ticket_events: {
    impersonator_id: 'INTEGER REFERENCES users(id) ON DELETE SET NULL',
  },
  comments: {
    impersonator_id: 'INTEGER REFERENCES users(id) ON DELETE SET NULL',
  },
  user_groups: {
    joinable: 'INTEGER NOT NULL DEFAULT 1',
  },
  catalog_items: {
    category: "TEXT NOT NULL DEFAULT ''",
  },
};

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_deleted_at ON tickets(deleted_at);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_group ON tickets(assigned_group);
CREATE INDEX IF NOT EXISTS idx_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON group_requests(status);
CREATE INDEX IF NOT EXISTS idx_mail_log_created ON mail_log(created_at);
CREATE INDEX IF NOT EXISTS idx_trusted_user ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_security_user ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON mfa_recovery_codes(user_id);
`;

async function addMissingColumns(db) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set((await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name));
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    }
  }
}

/** Remet d'aplomb les données saisies par la première version (champs vides, valeurs nulles). */
async function normalizeLegacyData(db) {
  await db.exec(`
    UPDATE tickets SET title = '(sans titre)' WHERE title IS NULL OR trim(title) = '';
    UPDATE tickets SET description = '' WHERE description IS NULL;
    UPDATE tickets SET priority = 'medium' WHERE priority IS NULL OR priority NOT IN ('low', 'medium', 'high');
    UPDATE tickets SET category = '' WHERE category IS NULL;
    UPDATE tickets SET due_date = NULL WHERE due_date = '';
    UPDATE tickets SET due_date = substr(due_date, 1, 10) WHERE due_date IS NOT NULL;
    UPDATE tickets SET created_at = COALESCE(created_at, datetime('now')) WHERE created_at IS NULL;
    UPDATE tickets SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE users SET role = 'user' WHERE role NOT IN ('user', 'admin');
    UPDATE users SET mfa_exempt_by = 'admin' WHERE mfa_exempt = 1 AND mfa_exempt_by IS NULL;
    -- Comptes antérieurs au suivi de connexion : considérés actifs aujourd'hui, pour ne pas les purger à tort.
    UPDATE users SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE last_seen_at IS NULL AND anonymized_at IS NULL;
  `);
}

/**
 * La première version journalisait les tickets supprimés dans un fichier JSON.
 * On les réintègre une fois dans la corbeille, puis on renomme le fichier.
 */
async function importLegacyDeletedLog(db, logPath, logger) {
  if (!logPath || !fs.existsSync(logPath)) return 0;
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (err) {
    logger.warn(`Journal des suppressions illisible (${logPath}) : ${err.message}`);
    return 0;
  }
  if (!Array.isArray(entries)) return 0;

  let imported = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const deletedAt = entry.deleted_at || new Date().toISOString();
    const result = await db.run(
      `INSERT OR IGNORE INTO tickets
        (id, title, description, priority, category, due_date, created_at, updated_at, status, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?)`,
      [
        Number.isInteger(entry.id) ? entry.id : null,
        entry.title || '(sans titre)',
        entry.description || '',
        entry.priority || 'medium',
        entry.category || '',
        entry.due_date || null,
        entry.created_at || deletedAt,
        deletedAt,
        deletedAt,
      ]
    );
    imported += result.changes;
  }
  fs.renameSync(logPath, logPath.replace(/\.json$/, '') + '.imported.json');
  logger.info(`${imported} ticket(s) supprimé(s) repris depuis ${path.basename(logPath)} dans la corbeille.`);
  return imported;
}

async function migrate(db, { legacyDeletedLogPath, logger = console } = {}) {
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(SCHEMA);
  await addMissingColumns(db);
  await db.exec(INDEXES);
  await importLegacyDeletedLog(db, legacyDeletedLogPath, logger);
  await normalizeLegacyData(db);
}

async function openDatabase(file, options) {
  const db = await Database.open(file);
  await db.exec('PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') await db.exec('PRAGMA journal_mode = WAL;');
  await migrate(db, options);
  return db;
}

module.exports = { Database, openDatabase, migrate };

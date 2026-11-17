const express = require('express');
const { HttpError } = require('../utils');
const { forbidImpersonation } = require('../middleware/auth');
const {
  MAX_MESSAGE,
  RETENTION_CHOICES,
  chatName,
  ensureChannels,
  ACCESS_SQL,
  canAccess,
  audience,
  serializeMessage,
  MESSAGE_SELECT,
} = require('../chat');

const MAX_MEMBERS = 50;
const MAX_NAME = 60;
const REPORT_REASON = 500;
const nowIso = () => new Date().toISOString();

/** Limite d'envoi : 20 messages par tranche de 30 secondes et par personne. */
function createRateLimit({ max = 20, windowMs = 30_000 } = {}) {
  const hits = new Map();
  return (userId) => {
    const now = Date.now();
    const list = (hits.get(userId) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) throw new HttpError(429, 'Vous envoyez trop de messages : patientez quelques secondes.');
    list.push(now);
    hits.set(userId, list);
  };
}

const PERSON_COLS = `id, username, CASE WHEN hide_real_name = 1 THEN '' ELSE firstname END AS firstname,
  CASE WHEN hide_real_name = 1 THEN '' ELSE lastname END AS lastname, hide_real_name`;
const person = (u) => ({ id: u.id, name: chatName(u), username: u.username });

function chatRoutes({ db, hub, notifier }) {
  const router = express.Router();
  const rateLimit = createRateLimit();
  router.use(forbidImpersonation);

  async function loadConversation(req, id) {
    const conv = await db.get(
      `SELECT c.*, g.name AS group_name FROM chat_conversations c LEFT JOIN user_groups g ON g.id = c.group_id
       WHERE c.id = ? AND ${ACCESS_SQL}`,
      [Number(id), req.user.id, req.user.id]
    );
    if (!conv) throw new HttpError(404, 'Conversation introuvable.');
    return conv;
  }

  async function members(conv) {
    if (conv.kind !== 'direct' && conv.kind !== 'custom') return null;
    const rows = await db.all(
      `SELECT ${PERSON_COLS} FROM users WHERE id IN (SELECT user_id FROM chat_members WHERE conversation_id = ?) ORDER BY username`,
      [conv.id]
    );
    return rows.map(person);
  }

  async function describe(conv, meId) {
    const list = await members(conv);
    let title = conv.name || '';
    if (conv.kind === 'general') title = 'Salon général';
    else if (conv.kind === 'group') title = conv.group_name || 'Groupe';
    else if (conv.kind === 'direct') title = list.find((m) => m.id !== meId)?.name || 'Conversation privée';
    const last = await db.get(`${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`, [conv.id]);
    const read = await db.get('SELECT last_read_id FROM chat_reads WHERE conversation_id = ? AND user_id = ?', [conv.id, meId]);
    const unread = await db.get(
      'SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND id > ? AND deleted_at IS NULL AND (author_id IS NULL OR author_id <> ?)',
      [conv.id, read?.last_read_id || 0, meId]
    );
    return {
      id: conv.id,
      kind: conv.kind,
      title,
      groupId: conv.group_id || null,
      members: list,
      createdBy: conv.created_by || null,
      lastMessage: last ? serializeMessage(last, meId) : null,
      lastMessageAt: conv.last_message_at || conv.created_at,
      unread: unread.n,
    };
  }

  async function broadcast(conv, event, data) {
    hub.send(await audience(db, conv), event, data);
  }

  // Flux en direct : nouveaux messages, suppressions, conversations créées ou modifiées.
  router.get('/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    res.write(`event: ready\ndata: {}\n\n`);
    const remove = hub.add(req.user.id, res);
    req.on('close', remove);
  });

  router.get('/conversations', async (req, res) => {
    await ensureChannels(db, req.user.id);
    const rows = await db.all(
      `SELECT c.*, g.name AS group_name FROM chat_conversations c LEFT JOIN user_groups g ON g.id = c.group_id WHERE ${ACCESS_SQL}`,
      [req.user.id, req.user.id]
    );
    const list = await Promise.all(rows.map((c) => describe(c, req.user.id)));
    const order = { general: 0, group: 1 };
    list.sort((a, b) => {
      const ka = order[a.kind] ?? 2;
      const kb = order[b.kind] ?? 2;
      if (ka !== kb) return ka - kb;
      return String(b.lastMessageAt).localeCompare(String(a.lastMessageAt));
    });
    res.json({ conversations: list, unread: list.reduce((n, c) => n + c.unread, 0) });
  });

  router.get('/unread', async (req, res) => {
    const row = await db.get(
      `SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
       LEFT JOIN chat_reads r ON r.conversation_id = c.id AND r.user_id = ?
       WHERE ${ACCESS_SQL} AND m.id > COALESCE(r.last_read_id, 0) AND m.deleted_at IS NULL AND (m.author_id IS NULL OR m.author_id <> ?)`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );
    res.json({ unread: row.n });
  });

  // Personnes à qui écrire (comptes actifs, nom masqué si elles l'ont choisi).
  router.get('/people', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = await db.all(
      `SELECT ${PERSON_COLS} FROM users WHERE anonymized_at IS NULL AND id <> ?
       AND (? = '' OR username LIKE ? ESCAPE '\\' OR (hide_real_name = 0 AND (firstname LIKE ? ESCAPE '\\' OR lastname LIKE ? ESCAPE '\\'
         OR (firstname || ' ' || lastname) LIKE ? ESCAPE '\\')))
       ORDER BY username LIMIT 20`,
      [req.user.id, q, like, like, like, like]
    );
    res.json({ people: rows.map(person) });
  });

  async function activeUser(id) {
    const u = await db.get('SELECT id FROM users WHERE id = ? AND anonymized_at IS NULL', [Number(id)]);
    if (!u) throw new HttpError(404, 'Personne introuvable.');
    return u.id;
  }

  // Message privé : une seule conversation par paire de personnes.
  router.post('/direct', async (req, res) => {
    const other = await activeUser(req.body?.userId);
    if (other === req.user.id) throw new HttpError(400, 'Choisissez une autre personne.');
    const key = [req.user.id, other].sort((a, b) => a - b).join(':');
    let conv = await db.get('SELECT * FROM chat_conversations WHERE direct_key = ?', [key]);
    if (!conv) {
      const now = nowIso();
      const r = await db.run("INSERT INTO chat_conversations (kind, direct_key, created_by, created_at) VALUES ('direct', ?, ?, ?)", [key, req.user.id, now]);
      conv = await db.get('SELECT * FROM chat_conversations WHERE id = ?', [r.lastID]);
    }
    // Les deux personnes en font partie (de nouveau si l'une l'avait quittée).
    for (const id of [req.user.id, other]) {
      await db.run('INSERT OR IGNORE INTO chat_members (conversation_id, user_id, added_at) VALUES (?, ?, ?)', [conv.id, id, nowIso()]);
    }
    res.status(201).json({ conversation: await describe(conv, req.user.id) });
  });

  function cleanName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new HttpError(400, 'Donnez un nom à la conversation.');
    if (name.length > MAX_NAME) throw new HttpError(400, `Nom trop long (${MAX_NAME} caractères au plus).`);
    return name;
  }

  // Conversation de groupe libre : son créateur choisit le nom et les participants.
  router.post('/conversations', async (req, res) => {
    const name = cleanName(req.body?.name);
    const ids = [...new Set((Array.isArray(req.body?.members) ? req.body.members : []).map(Number))].filter((id) => id !== req.user.id);
    if (!ids.length) throw new HttpError(400, 'Ajoutez au moins une personne.');
    if (ids.length + 1 > MAX_MEMBERS) throw new HttpError(400, `${MAX_MEMBERS} participants au plus.`);
    for (const id of ids) await activeUser(id);
    const now = nowIso();
    const r = await db.run("INSERT INTO chat_conversations (kind, name, created_by, created_at) VALUES ('custom', ?, ?, ?)", [name, req.user.id, now]);
    for (const id of [req.user.id, ...ids]) {
      await db.run('INSERT INTO chat_members (conversation_id, user_id, added_at) VALUES (?, ?, ?)', [r.lastID, id, now]);
    }
    const conv = await db.get('SELECT * FROM chat_conversations WHERE id = ?', [r.lastID]);
    await broadcast(conv, 'conversation', { id: conv.id });
    res.status(201).json({ conversation: await describe(conv, req.user.id) });
  });

  router.get('/conversations/:id', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    res.json({ conversation: await describe(conv, req.user.id) });
  });

  // Renommer une conversation libre ou y ajouter des personnes : réservé à ses participants.
  router.put('/conversations/:id', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    if (conv.kind !== 'custom') throw new HttpError(400, 'Seules les conversations de groupe libres se renomment.');
    await db.run('UPDATE chat_conversations SET name = ? WHERE id = ?', [cleanName(req.body?.name), conv.id]);
    await broadcast(conv, 'conversation', { id: conv.id });
    res.json({ conversation: await describe(await loadConversation(req, conv.id), req.user.id) });
  });

  router.post('/conversations/:id/members', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    if (conv.kind !== 'custom') throw new HttpError(400, 'On ajoute des personnes seulement aux conversations de groupe libres.');
    const ids = [...new Set((Array.isArray(req.body?.members) ? req.body.members : []).map(Number))];
    if (!ids.length) throw new HttpError(400, 'Choisissez au moins une personne.');
    for (const id of ids) await activeUser(id);
    const count = (await db.get('SELECT COUNT(*) AS n FROM chat_members WHERE conversation_id = ?', [conv.id])).n;
    if (count + ids.length > MAX_MEMBERS) throw new HttpError(400, `${MAX_MEMBERS} participants au plus.`);
    for (const id of ids) {
      await db.run('INSERT OR IGNORE INTO chat_members (conversation_id, user_id, added_at) VALUES (?, ?, ?)', [conv.id, id, nowIso()]);
    }
    await broadcast(conv, 'conversation', { id: conv.id });
    res.json({ conversation: await describe(conv, req.user.id) });
  });

  // Quitter une conversation privée ou libre (elle disparaît quand plus personne n'y est).
  router.delete('/conversations/:id/members/me', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    if (conv.kind !== 'custom' && conv.kind !== 'direct') throw new HttpError(400, 'On ne quitte pas un salon : il suit vos groupes.');
    await db.run('DELETE FROM chat_members WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.id]);
    await db.run('DELETE FROM chat_reads WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.id]);
    const left = (await db.get('SELECT COUNT(*) AS n FROM chat_members WHERE conversation_id = ?', [conv.id])).n;
    if (!left) {
      // Les signalements en attente gardent leur copie du message.
      await db.run('DELETE FROM chat_conversations WHERE id = ?', [conv.id]);
    } else {
      await broadcast(conv, 'conversation', { id: conv.id });
    }
    hub.send([req.user.id], 'conversation', { id: conv.id, removed: true });
    res.json({ success: true });
  });

  router.get('/conversations/:id/messages', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = Number(req.query.before) || null;
    const rows = await db.all(
      `${MESSAGE_SELECT} WHERE m.conversation_id = ? ${before ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`,
      before ? [conv.id, before, limit + 1] : [conv.id, limit + 1]
    );
    const more = rows.length > limit;
    res.json({ messages: rows.slice(0, limit).reverse().map((r) => serializeMessage(r, req.user.id)), more });
  });

  router.post('/conversations/:id/messages', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    const body = typeof req.body?.body === 'string' ? req.body.body.replace(/\r\n/g, '\n').trim() : '';
    if (!body) throw new HttpError(400, 'Le message est vide.');
    if (body.length > MAX_MESSAGE) throw new HttpError(400, `Message trop long (${MAX_MESSAGE} caractères au plus).`);
    if (conv.kind === 'direct') {
      const other = await db.get(
        `SELECT u.id FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND u.id <> ? AND u.anonymized_at IS NULL`,
        [conv.id, req.user.id]
      );
      if (!other) {
        // L'autre personne a quitté la conversation : on la réintègre si son compte existe encore.
        const [a, b] = String(conv.direct_key).split(':').map(Number);
        const otherId = a === req.user.id ? b : a;
        const alive = await db.get('SELECT id FROM users WHERE id = ? AND anonymized_at IS NULL', [otherId]);
        if (!alive) throw new HttpError(409, "Cette personne n'a plus de compte : elle ne recevra pas votre message.");
        await db.run('INSERT OR IGNORE INTO chat_members (conversation_id, user_id, added_at) VALUES (?, ?, ?)', [conv.id, otherId, nowIso()]);
      }
    }
    rateLimit(req.user.id);
    const now = nowIso();
    const r = await db.run('INSERT INTO chat_messages (conversation_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', [conv.id, req.user.id, body, now]);
    await db.run('UPDATE chat_conversations SET last_message_at = ? WHERE id = ?', [now, conv.id]);
    await db.run(
      `INSERT INTO chat_reads (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`,
      [conv.id, req.user.id, r.lastID]
    );
    const row = await db.get(`${MESSAGE_SELECT} WHERE m.id = ?`, [r.lastID]);
    const message = serializeMessage(row, null);
    await broadcast(conv, 'message', message);
    res.status(201).json({ message: { ...message, mine: true } });
  });

  router.post('/conversations/:id/read', async (req, res) => {
    const conv = await loadConversation(req, req.params.id);
    const last = await db.get('SELECT MAX(id) AS id FROM chat_messages WHERE conversation_id = ?', [conv.id]);
    const upTo = Math.min(Number(req.body?.upTo) || Infinity, last.id || 0);
    await db.run(
      `INSERT INTO chat_reads (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
      [conv.id, req.user.id, upTo]
    );
    res.json({ success: true });
  });

  // L'auteur retire son message : le texte est effacé, il reste « Message supprimé ».
  router.delete('/messages/:id', async (req, res) => {
    const msg = await db.get('SELECT * FROM chat_messages WHERE id = ?', [Number(req.params.id)]);
    if (!msg || !(await canAccess(db, req.user.id, msg.conversation_id))) throw new HttpError(404, 'Message introuvable.');
    if (msg.author_id !== req.user.id) throw new HttpError(403, 'Vous ne pouvez supprimer que vos propres messages.');
    if (!msg.deleted_at) {
      await db.run("UPDATE chat_messages SET body = '', deleted_at = ?, deleted_by = ? WHERE id = ?", [nowIso(), req.user.id, msg.id]);
      const conv = await db.get('SELECT * FROM chat_conversations WHERE id = ?', [msg.conversation_id]);
      await broadcast(conv, 'deleted', { id: msg.id, conversationId: msg.conversation_id, byModeration: false });
    }
    res.json({ success: true });
  });

  // Signalement : seule une copie de ce message est montrée aux administrateurs.
  router.post('/messages/:id/report', async (req, res) => {
    const msg = await db.get('SELECT * FROM chat_messages WHERE id = ?', [Number(req.params.id)]);
    if (!msg || !(await canAccess(db, req.user.id, msg.conversation_id))) throw new HttpError(404, 'Message introuvable.');
    if (msg.deleted_at) throw new HttpError(400, 'Ce message a déjà été supprimé.');
    if (msg.author_id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas signaler votre propre message.');
    const already = await db.get("SELECT id FROM chat_reports WHERE message_id = ? AND reporter_id = ? AND status = 'pending'", [msg.id, req.user.id]);
    if (already) throw new HttpError(409, 'Vous avez déjà signalé ce message.');
    const reason = String(req.body?.reason || '').trim().slice(0, REPORT_REASON);
    const r = await db.run(
      'INSERT INTO chat_reports (message_id, conversation_id, reporter_id, author_id, reason, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [msg.id, msg.conversation_id, req.user.id, msg.author_id, reason, msg.body, nowIso()]
    );
    notifier?.chatReported?.(r.lastID);
    res.status(201).json({ success: true });
  });

  // Réglages personnels : durée de conservation de ses propres messages.
  router.get('/me/settings', async (req, res) => {
    const row = await db.get('SELECT chat_retention_days FROM users WHERE id = ?', [req.user.id]);
    const count = await db.get('SELECT COUNT(*) AS n FROM chat_messages WHERE author_id = ? AND deleted_at IS NULL', [req.user.id]);
    res.json({ retentionDays: row.chat_retention_days || 0, choices: RETENTION_CHOICES, messages: count.n });
  });

  router.put('/me/settings', async (req, res) => {
    const days = Number(req.body?.retentionDays);
    if (!RETENTION_CHOICES.includes(days)) throw new HttpError(400, 'Durée de conservation invalide.');
    await db.run('UPDATE users SET chat_retention_days = ? WHERE id = ?', [days, req.user.id]);
    res.json({ retentionDays: days });
  });

  // Effacer tous ses messages d'un coup.
  router.delete('/me/messages', async (req, res) => {
    const rows = await db.all('SELECT id, conversation_id FROM chat_messages WHERE author_id = ?', [req.user.id]);
    await db.run('DELETE FROM chat_messages WHERE author_id = ?', [req.user.id]);
    const byConv = new Map();
    for (const r of rows) byConv.set(r.conversation_id, [...(byConv.get(r.conversation_id) || []), r.id]);
    for (const [convId, ids] of byConv) {
      const conv = await db.get('SELECT * FROM chat_conversations WHERE id = ?', [convId]);
      if (conv) await broadcast(conv, 'purged', { conversationId: convId, ids });
    }
    res.json({ deleted: rows.length });
  });

  return router;
}

/** Administration : les messages signalés, et rien d'autre. */
function chatAdminRoutes({ db, hub }) {
  const router = express.Router();
  router.use(forbidImpersonation);

  const KIND_LABELS = { general: 'Salon général', group: 'Salon de groupe', direct: 'Message privé', custom: 'Conversation de groupe' };

  router.get('/reports', async (req, res) => {
    const status = ['pending', 'removed', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = await db.all(
      `SELECT r.*, c.kind, c.name AS conv_name, g.name AS group_name, m.created_at AS message_at, m.deleted_at AS message_deleted_at,
         a.username AS author_username, a.firstname AS author_firstname, a.lastname AS author_lastname,
         p.username AS reporter_username, p.firstname AS reporter_firstname, p.lastname AS reporter_lastname,
         h.username AS handler_username, h.firstname AS handler_firstname, h.lastname AS handler_lastname
       FROM chat_reports r
       LEFT JOIN chat_messages m ON m.id = r.message_id
       LEFT JOIN chat_conversations c ON c.id = r.conversation_id
       LEFT JOIN user_groups g ON g.id = c.group_id
       LEFT JOIN users a ON a.id = r.author_id
       LEFT JOIN users p ON p.id = r.reporter_id
       LEFT JOIN users h ON h.id = r.handled_by
       WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`,
      [status]
    );
    const name = (row, p) =>
      row[`${p}_username`] ? chatName({ username: row[`${p}_username`], firstname: row[`${p}_firstname`], lastname: row[`${p}_lastname`] }) : 'Compte supprimé';
    const pending = await db.get("SELECT COUNT(*) AS n FROM chat_reports WHERE status = 'pending'");
    res.json({
      pending: pending.n,
      reports: rows.map((r) => ({
        id: r.id,
        messageId: r.message_id,
        body: r.snapshot,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
        messageAt: r.message_at || null,
        messageGone: !r.message_id || Boolean(r.message_deleted_at),
        place: r.kind ? (r.kind === 'group' ? `Salon ${r.group_name || 'de groupe'}` : r.kind === 'custom' ? `Conversation « ${r.conv_name} »` : KIND_LABELS[r.kind]) : 'Conversation supprimée',
        author: { id: r.author_id, name: name(r, 'author') },
        reporter: { id: r.reporter_id, name: name(r, 'reporter') },
        handledBy: r.handled_by ? name(r, 'handler') : null,
        handledAt: r.handled_at,
      })),
    });
  });

  async function decide(req, status) {
    const report = await db.get("SELECT * FROM chat_reports WHERE id = ? AND status = 'pending'", [Number(req.params.id)]);
    if (!report) throw new HttpError(404, 'Signalement introuvable ou déjà traité.');
    const now = nowIso();
    // Tous les signalements du même message sont traités ensemble.
    const where = report.message_id ? 'message_id = ?' : 'id = ?';
    await db.run(`UPDATE chat_reports SET status = ?, handled_by = ?, handled_at = ? WHERE ${where} AND status = 'pending'`, [
      status,
      req.user.id,
      now,
      report.message_id || report.id,
    ]);
    return report;
  }

  router.post('/reports/:id/remove', async (req, res) => {
    const report = await decide(req, 'removed');
    const msg = report.message_id ? await db.get('SELECT * FROM chat_messages WHERE id = ?', [report.message_id]) : null;
    if (msg && !msg.deleted_at) {
      await db.run("UPDATE chat_messages SET body = '', deleted_at = ?, deleted_by = ? WHERE id = ?", [nowIso(), req.user.id, msg.id]);
      const conv = await db.get('SELECT * FROM chat_conversations WHERE id = ?', [msg.conversation_id]);
      if (conv) hub.send(await audience(db, conv), 'deleted', { id: msg.id, conversationId: msg.conversation_id, byModeration: true });
    }
    res.json({ success: true });
  });

  router.post('/reports/:id/dismiss', async (req, res) => {
    await decide(req, 'dismissed');
    res.json({ success: true });
  });

  return router;
}

module.exports = { chatRoutes, chatAdminRoutes, createRateLimit };

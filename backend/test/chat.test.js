const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { runPurge, anonymizeUser, exportUser } = require('../src/rgpd');

/** Ouvre le flux en direct d'une personne et collecte les événements reçus. */
async function openStream(server, token) {
  const { port } = server.address();
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch {
      /* flux fermé */
    }
  })();
  const waitFor = async (pred, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = events.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  };
  return { events, waitFor, close: () => ctrl.abort() };
}

describe('discussions en direct', () => {
  let ctx;
  let server;
  let admin;
  let anna;
  let ben;
  let chloe;
  let group;

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr' });
    admin = await ctx.register('admin', { firstname: 'Swann', email: 'admin@exemple.fr' });
    anna = await ctx.register('anna', { firstname: 'Anna', lastname: 'Martin' });
    ben = await ctx.register('ben', { firstname: 'Benoît', lastname: 'Durand', hideRealName: true });
    chloe = await ctx.register('chloe', { firstname: 'Chloé' });
    group = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Jardiniers', members: [anna.user.id, ben.user.id] })).body;
    server = ctx.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
  });
  after(async () => {
    ctx.app.locals.chatHub.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await ctx.cleanup();
  });

  const convs = async (s) => (await ctx.api.get('/api/chat/conversations').set(s.auth).expect(200)).body;

  test('salon général pour tous, salon de groupe pour ses membres seulement', async () => {
    const forAnna = await convs(anna);
    assert.equal(forAnna.conversations[0].kind, 'general');
    const salon = forAnna.conversations.find((c) => c.kind === 'group');
    assert.equal(salon.title, 'Jardiniers');
    const forChloe = await convs(chloe);
    assert.ok(!forChloe.conversations.some((c) => c.kind === 'group'));
    await ctx.api.get(`/api/chat/conversations/${salon.id}/messages`).set(chloe.auth).expect(404);
    await ctx.api.post(`/api/chat/conversations/${salon.id}/messages`).set(chloe.auth).send({ body: 'Coucou' }).expect(404);
    // L'administrateur n'a pas d'accès particulier aux salons dont il n'est pas membre.
    await ctx.api.get(`/api/chat/conversations/${salon.id}/messages`).set(admin.auth).expect(404);
  });

  test('message en direct, non lus, lecture', async () => {
    const general = (await convs(anna)).conversations.find((c) => c.kind === 'general');
    const stream = await openStream(server, ben.token);
    await stream.waitFor((e) => e.event === 'ready');
    const sent = (await ctx.api.post(`/api/chat/conversations/${general.id}/messages`).set(anna.auth).send({ body: '  Bonjour à tous  ' }).expect(201)).body;
    assert.equal(sent.message.body, 'Bonjour à tous');
    assert.equal(sent.message.author.name, 'Anna Martin');
    const got = await stream.waitFor((e) => e.event === 'message' && e.data.id === sent.message.id);
    assert.ok(got, 'message reçu en direct');
    stream.close();
    assert.equal((await ctx.api.get('/api/chat/unread').set(ben.auth)).body.unread, 1);
    assert.equal((await ctx.api.get('/api/chat/unread').set(anna.auth)).body.unread, 0);
    await ctx.api.post(`/api/chat/conversations/${general.id}/read`).set(ben.auth).send({}).expect(200);
    assert.equal((await ctx.api.get('/api/chat/unread').set(ben.auth)).body.unread, 0);
  });

  test('pseudonyme seul respecté dans les discussions et la recherche de personnes', async () => {
    const general = (await convs(ben)).conversations.find((c) => c.kind === 'general');
    await ctx.api.post(`/api/chat/conversations/${general.id}/messages`).set(ben.auth).send({ body: 'Salut' }).expect(201);
    const msgs = JSON.stringify((await ctx.api.get(`/api/chat/conversations/${general.id}/messages`).set(anna.auth)).body);
    assert.ok(!msgs.includes('Benoît') && !msgs.includes('Durand'));
    assert.ok(msgs.includes('"name":"ben"'));
    const byRealName = (await ctx.api.get('/api/chat/people?q=Durand').set(anna.auth)).body.people;
    assert.equal(byRealName.length, 0);
    const byPseudo = (await ctx.api.get('/api/chat/people?q=be').set(anna.auth)).body.people;
    assert.deepEqual(byPseudo.map((p) => p.name), ['ben']);
  });

  test('message privé : une seule conversation par paire, invisible des autres', async () => {
    const a = (await ctx.api.post('/api/chat/direct').set(anna.auth).send({ userId: chloe.user.id }).expect(201)).body.conversation;
    const b = (await ctx.api.post('/api/chat/direct').set(chloe.auth).send({ userId: anna.user.id }).expect(201)).body.conversation;
    assert.equal(a.id, b.id);
    assert.equal(a.title, 'Chloé');
    await ctx.api.post(`/api/chat/conversations/${a.id}/messages`).set(anna.auth).send({ body: 'Tu viens samedi ?' }).expect(201);
    await ctx.api.get(`/api/chat/conversations/${a.id}/messages`).set(ben.auth).expect(404);
    await ctx.api.get(`/api/chat/conversations/${a.id}/messages`).set(admin.auth).expect(404);
    await ctx.api.post('/api/chat/direct').set(anna.auth).send({ userId: anna.user.id }).expect(400);
  });

  test('conversation de groupe libre : création, ajout, départ', async () => {
    const conv = (
      await ctx.api.post('/api/chat/conversations').set(anna.auth).send({ name: 'Fête des voisins', members: [ben.user.id] }).expect(201)
    ).body.conversation;
    assert.equal(conv.kind, 'custom');
    assert.equal(conv.members.length, 2);
    await ctx.api.get(`/api/chat/conversations/${conv.id}`).set(chloe.auth).expect(404);
    await ctx.api.post(`/api/chat/conversations/${conv.id}/members`).set(ben.auth).send({ members: [chloe.user.id] }).expect(200);
    await ctx.api.get(`/api/chat/conversations/${conv.id}`).set(chloe.auth).expect(200);
    await ctx.api.put(`/api/chat/conversations/${conv.id}`).set(chloe.auth).send({ name: 'Fête du 21 juin' }).expect(200);
    await ctx.api.delete(`/api/chat/conversations/${conv.id}/members/me`).set(chloe.auth).expect(200);
    await ctx.api.get(`/api/chat/conversations/${conv.id}`).set(chloe.auth).expect(404);
    await ctx.api.post('/api/chat/conversations').set(anna.auth).send({ name: '', members: [ben.user.id] }).expect(400);
    await ctx.api.post('/api/chat/conversations').set(anna.auth).send({ name: 'Seule', members: [] }).expect(400);
  });

  test('contrôles : message vide, trop long, suppression par son auteur seulement', async () => {
    const general = (await convs(anna)).conversations.find((c) => c.kind === 'general');
    const url = `/api/chat/conversations/${general.id}/messages`;
    await ctx.api.post(url).set(anna.auth).send({ body: '   ' }).expect(400);
    await ctx.api.post(url).set(anna.auth).send({ body: 'x'.repeat(2001) }).expect(400);
    const m = (await ctx.api.post(url).set(anna.auth).send({ body: 'Oups' }).expect(201)).body.message;
    await ctx.api.delete(`/api/chat/messages/${m.id}`).set(ben.auth).expect(403);
    await ctx.api.delete(`/api/chat/messages/${m.id}`).set(anna.auth).expect(200);
    const list = (await ctx.api.get(url).set(ben.auth)).body.messages;
    const gone = list.find((x) => x.id === m.id);
    assert.equal(gone.deleted, true);
    assert.equal(gone.body, null);
  });

  test('signalement : l’administrateur voit ce message seul, le retire, est prévenu par e-mail', async () => {
    const salon = (await convs(anna)).conversations.find((c) => c.kind === 'group');
    const url = `/api/chat/conversations/${salon.id}/messages`;
    await ctx.api.post(url).set(ben.auth).send({ body: 'Message avant, privé' }).expect(201);
    const bad = (await ctx.api.post(url).set(ben.auth).send({ body: 'Propos injurieux' }).expect(201)).body.message;
    await ctx.api.post(`/api/chat/messages/${bad.id}/report`).set(ben.auth).send({}).expect(400);
    await ctx.api.post(`/api/chat/messages/${bad.id}/report`).set(chloe.auth).send({}).expect(404);
    await ctx.api.post(`/api/chat/messages/${bad.id}/report`).set(anna.auth).send({ reason: 'Insulte' }).expect(201);
    await ctx.api.post(`/api/chat/messages/${bad.id}/report`).set(anna.auth).send({}).expect(409);
    await ctx.app.locals.notifier.idle();
    assert.ok(ctx.app.locals.mailer.sent.some((m) => m.to === 'admin@exemple.fr' && /signalé/.test(m.subject)));

    await ctx.api.get('/api/admin/chat/reports').set(anna.auth).expect(403);
    const reports = (await ctx.api.get('/api/admin/chat/reports').set(admin.auth).expect(200)).body;
    assert.equal(reports.pending, 1);
    const json = JSON.stringify(reports);
    assert.ok(json.includes('Propos injurieux'));
    assert.ok(!json.includes('Message avant, privé'), 'le reste de la conversation reste privé');
    assert.equal(reports.reports[0].place, 'Salon Jardiniers');

    const stream = await openStream(server, anna.token);
    await stream.waitFor((e) => e.event === 'ready');
    await ctx.api.post(`/api/admin/chat/reports/${reports.reports[0].id}/remove`).set(admin.auth).expect(200);
    assert.ok(await stream.waitFor((e) => e.event === 'deleted' && e.data.id === bad.id && e.data.byModeration));
    stream.close();
    const after = (await ctx.api.get(url).set(anna.auth)).body.messages.find((m) => m.id === bad.id);
    assert.equal(after.deletedByModeration, true);
    assert.equal((await ctx.api.get('/api/admin/chat/reports').set(admin.auth)).body.pending, 0);
    await ctx.api.post(`/api/admin/chat/reports/${reports.reports[0].id}/dismiss`).set(admin.auth).expect(404);
  });

  test('conservation choisie par chacun, purge et suppression de tous ses messages', async () => {
    await ctx.api.put('/api/chat/me/settings').set(chloe.auth).send({ retentionDays: 7 }).expect(400);
    await ctx.api.put('/api/chat/me/settings').set(chloe.auth).send({ retentionDays: 30 }).expect(200);
    const general = (await convs(chloe)).conversations.find((c) => c.kind === 'general');
    const m = (await ctx.api.post(`/api/chat/conversations/${general.id}/messages`).set(chloe.auth).send({ body: 'Vieux message' }).expect(201)).body.message;
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    await ctx.db.run('UPDATE chat_messages SET created_at = ? WHERE id = ?', [old, m.id]);
    const kept = (await ctx.api.post(`/api/chat/conversations/${general.id}/messages`).set(chloe.auth).send({ body: 'Récent' }).expect(201)).body.message;
    const done = await runPurge(ctx.db, ctx.config, { logger: { info() {}, error() {} } });
    assert.ok(done.chatMessages >= 1);
    assert.equal(await ctx.db.get('SELECT id FROM chat_messages WHERE id = ?', [m.id]), undefined);
    assert.ok(await ctx.db.get('SELECT id FROM chat_messages WHERE id = ?', [kept.id]));
    const settings = (await ctx.api.get('/api/chat/me/settings').set(chloe.auth)).body;
    assert.equal(settings.retentionDays, 30);
    assert.ok(settings.messages >= 1);
    const del = (await ctx.api.delete('/api/chat/me/messages').set(chloe.auth).expect(200)).body;
    assert.ok(del.deleted >= 1);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM chat_messages WHERE author_id = ?', [chloe.user.id])).n, 0);
  });

  test('export et anonymisation', async () => {
    const data = await exportUser(ctx.db, anna.user.id);
    assert.ok(data.chat.messages.some((m) => m.body === 'Bonjour à tous'));
    assert.ok(data.chat.conversations.some((c) => c.type === 'Message privé'));
    assert.equal(data.chat.reports_made.length, 1);

    await anonymizeUser(ctx.db, ctx.config, ben.user.id, { mode: 'keep' });
    const general = (await convs(anna)).conversations.find((c) => c.kind === 'general');
    const msgs = (await ctx.api.get(`/api/chat/conversations/${general.id}/messages`).set(anna.auth)).body.messages;
    const salut = msgs.find((m) => m.body === 'Salut');
    assert.equal(salut.author.name, `Utilisateur supprimé n°${ben.user.id}`);

    const res = await anonymizeUser(ctx.db, ctx.config, anna.user.id, { mode: 'delete' });
    assert.ok(res.chat >= 1);
    // La conversation privée Anna / Chloé reste pour Chloé, sans les messages d'Anna.
    const forChloe = (await convs(chloe)).conversations.find((c) => c.kind === 'direct');
    assert.ok(forChloe);
    const left = (await ctx.api.get(`/api/chat/conversations/${forChloe.id}/messages`).set(chloe.auth)).body.messages;
    assert.equal(left.length, 0);
    await ctx.api.post(`/api/chat/conversations/${forChloe.id}/messages`).set(chloe.auth).send({ body: 'Tu es là ?' }).expect(409);
  });
});

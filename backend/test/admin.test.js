const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('administration et pièces jointes', () => {
  let ctx;
  let admin;
  let alice;
  let bob;

  before(async () => {
    ctx = await setup({ MAX_UPLOAD_MB: '1' });
    admin = await ctx.register('admin');
    alice = await ctx.register('alice');
    bob = await ctx.register('bob');
  });
  after(() => ctx.cleanup());

  test('la gestion des utilisateurs est réservée aux admins et ne divulgue pas les mots de passe', async () => {
    assert.equal((await ctx.api.get('/api/users').set(alice.auth)).status, 403);
    const res = await ctx.api.get('/api/users').set(admin.auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    for (const u of res.body) assert.equal(u.password, undefined);
  });

  test('un admin crée, modifie et promeut un utilisateur', async () => {
    const created = await ctx.api
      .post('/api/users')
      .set(admin.auth)
      .send({ username: 'carla', password: 'motdepasse1', role: 'user', firstname: 'Carla' });
    assert.equal(created.status, 201);

    const promoted = await ctx.api.patch(`/api/users/${created.body.id}`).set(admin.auth).send({ role: 'admin' });
    assert.equal(promoted.body.role, 'admin');

    const dup = await ctx.api.patch(`/api/users/${created.body.id}`).set(admin.auth).send({ username: 'Alice' });
    assert.equal(dup.status, 409);

    // Le nouveau rôle s'applique immédiatement, sans reconnexion.
    const login = await ctx.api.post('/api/auth/login').send({ username: 'carla', password: 'motdepasse1' });
    const carla = { Authorization: `Bearer ${login.body.token}` };
    await ctx.api.patch(`/api/users/${created.body.id}`).set(admin.auth).send({ role: 'user' }).expect(200);
    assert.equal((await ctx.api.get('/api/users').set(carla)).status, 403);
  });

  test("réinitialisation d'un mot de passe", async () => {
    const res = await ctx.api.post(`/api/users/${bob.user.id}/reset-password`).set(admin.auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.password.length, 12);
    assert.equal((await ctx.api.get('/api/auth/me').set(bob.auth)).status, 401, 'ancienne session révoquée');
    const login = await ctx.api.post('/api/auth/login').send({ username: 'bob', password: res.body.password });
    assert.equal(login.status, 200);
    bob = { ...bob, auth: { Authorization: `Bearer ${login.body.token}` } };
  });

  test('le dernier administrateur est protégé', async () => {
    assert.equal((await ctx.api.patch(`/api/users/${admin.user.id}`).set(admin.auth).send({ role: 'user' })).status, 400);
    assert.equal((await ctx.api.delete(`/api/users/${admin.user.id}`).set(admin.auth)).status, 400);
  });

  test('supprimer un utilisateur conserve ses tickets', async () => {
    const dave = await ctx.register('dave');
    const t = await ctx.createTicket(dave, { title: 'Ticket de Dave' });
    await ctx.api.delete(`/api/users/${dave.user.id}`).set(admin.auth).expect(200);
    const detail = await ctx.api.get(`/api/tickets/${t.id}`).set(admin.auth);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.creator, null);
    assert.equal((await ctx.api.get('/api/auth/me').set(dave.auth)).status, 401);
  });

  test('pièces jointes : envoi, téléchargement, droits et suppression', async () => {
    const t = await ctx.createTicket(alice, { title: 'Avec fichiers' });
    const up = await ctx.api
      .post(`/api/tickets/${t.id}/attachments`)
      .set(alice.auth)
      .attach('files', Buffer.from('bonjour'), 'réunion été.txt')
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'devis.pdf', contentType: 'application/pdf' });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.length, 2);
    assert.equal(up.body[0].name, 'réunion été.txt');

    const dl = await ctx.api.get(`/api/attachments/${up.body[0].id}`).set(alice.auth).buffer(true);
    assert.equal(dl.status, 200);
    assert.equal(dl.text ?? dl.body.toString(), 'bonjour');
    assert.match(dl.headers['content-disposition'], /attachment/);

    // Bob ne voit pas le ticket : ni lecture ni envoi.
    assert.equal((await ctx.api.get(`/api/attachments/${up.body[0].id}`).set(bob.auth)).status, 404);
    const forbidden = await ctx.api
      .post(`/api/tickets/${t.id}/attachments`)
      .set(bob.auth)
      .attach('files', Buffer.from('x'), 'x.txt');
    assert.equal(forbidden.status, 404);

    const detail = await ctx.api.get(`/api/tickets/${t.id}`).set(alice.auth);
    assert.equal(detail.body.attachments.length, 2);
    assert.equal(detail.body.attachment_count, 2);

    const storedFiles = () => fs.readdirSync(ctx.config.uploadsDir);
    assert.equal(storedFiles().length, 2);
    await ctx.api.delete(`/api/attachments/${up.body[1].id}`).set(alice.auth).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(storedFiles().length, 1);
  });

  test('pièces jointes : types et tailles refusés', async () => {
    const t = await ctx.createTicket(alice, { title: 'Refus' });
    const exe = await ctx.api.post(`/api/tickets/${t.id}/attachments`).set(alice.auth).attach('files', Buffer.from('MZ'), 'virus.exe');
    assert.equal(exe.status, 400);
    const big = await ctx.api
      .post(`/api/tickets/${t.id}/attachments`)
      .set(alice.auth)
      .attach('files', Buffer.alloc(1024 * 1024 + 10), 'gros.bin');
    assert.equal(big.status, 413);
    const none = await ctx.api.post(`/api/tickets/${t.id}/attachments`).set(alice.auth).field('x', 'y');
    assert.equal(none.status, 400);
  });

  test('corbeille : restauration puis purge définitive avec fichiers', async () => {
    const t = await ctx.createTicket(alice, { title: 'Corbeille' });
    await ctx.api.post(`/api/tickets/${t.id}/attachments`).set(alice.auth).attach('files', Buffer.from('a'), 'a.txt').expect(201);
    await ctx.api.delete(`/api/tickets/${t.id}`).set(admin.auth).expect(200);

    assert.equal((await ctx.api.get('/api/admin/trash').set(alice.auth)).status, 403);
    const trash = await ctx.api.get('/api/admin/trash').set(admin.auth);
    const entry = trash.body.find((x) => x.id === t.id);
    assert.ok(entry);
    assert.equal(entry.deleted_by.username, 'admin');

    await ctx.api.post(`/api/admin/trash/${t.id}/restore`).set(admin.auth).expect(200);
    const restored = await ctx.api.get(`/api/tickets/${t.id}`).set(alice.auth);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.events.slice(-2).map((e) => e.type), ['deleted', 'restored']);

    await ctx.api.delete(`/api/tickets/${t.id}`).set(admin.auth).expect(200);
    const before = fs.readdirSync(ctx.config.uploadsDir).length;
    await ctx.api.delete(`/api/admin/trash/${t.id}`).set(admin.auth).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fs.readdirSync(ctx.config.uploadsDir).length, before - 1);
    assert.equal((await ctx.api.post(`/api/admin/trash/${t.id}/restore`).set(admin.auth)).status, 404);

    const comments = await ctx.db.all('SELECT * FROM comments WHERE ticket_id = ?', [t.id]);
    const events = await ctx.db.all('SELECT * FROM ticket_events WHERE ticket_id = ?', [t.id]);
    assert.equal(comments.length + events.length, 0, 'suppression en cascade');
  });

  test('vider la corbeille', async () => {
    const t1 = await ctx.createTicket(alice, { title: 'v1' });
    const t2 = await ctx.createTicket(alice, { title: 'v2' });
    await ctx.api.delete(`/api/tickets/${t1.id}`).set(admin.auth).expect(200);
    await ctx.api.delete(`/api/tickets/${t2.id}`).set(admin.auth).expect(200);
    const res = await ctx.api.delete('/api/admin/trash').set(admin.auth);
    assert.ok(res.body.purged >= 2);
    assert.equal((await ctx.api.get('/api/admin/trash').set(admin.auth)).body.length, 0);
  });

  test('les anciennes routes génériques (injection SQL) ont disparu', async () => {
    const res = await ctx.api
      .put('/api/admin/table/users/1')
      .set(admin.auth)
      .send({ 'role = \'admin\' --': 'x' });
    assert.equal(res.status, 404);
    assert.ok(fs.existsSync(path.join(ctx.dir, 'tickets.db')));
  });
  test('guide administrateur en PDF : réservé aux administrateurs', async () => {
    const res = await ctx.api.get('/api/admin/guide.pdf').set(admin.auth).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /pdf/);
    assert.equal(res.body.subarray(0, 4).toString(), '%PDF');
    assert.match(res.headers['content-disposition'], /Xchange-guide-administrateur\.pdf/);
    assert.equal((await ctx.api.get('/api/admin/guide.pdf').set(alice.auth)).status, 403);
  });
});

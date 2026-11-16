const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('se mettre à la place d’un utilisateur', () => {
  let ctx;
  let admin;
  let admin2;
  let mamie;
  let imp; // en-tête d'authentification du jeton d'impersonation

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin', { firstname: 'Swann' });
    admin2 = await ctx.register('admin2');
    await ctx.api.patch(`/api/users/${admin2.user.id}`).set(admin.auth).send({ role: 'admin' }).expect(200);
    mamie = await ctx.register('mamie', { firstname: 'Francine' });
  });
  after(() => ctx.cleanup());

  test('réservé aux admins, jamais vers un autre admin ni soi-même', async () => {
    assert.equal((await ctx.api.post(`/api/users/${admin.user.id}/impersonate`).set(mamie.auth)).status, 403);
    assert.equal((await ctx.api.post(`/api/users/${admin2.user.id}/impersonate`).set(admin.auth)).status, 403);
    assert.equal((await ctx.api.post(`/api/users/${admin.user.id}/impersonate`).set(admin.auth)).status, 400);

    const res = await ctx.api.post(`/api/users/${mamie.user.id}/impersonate`).set(admin.auth);
    assert.equal(res.status, 200);
    imp = { Authorization: `Bearer ${res.body.token}` };
    const me = await ctx.api.get('/api/auth/me').set(imp);
    assert.equal(me.body.user.username, 'mamie');
    assert.equal(me.body.user.impersonator.name, 'Swann');
    // Pas d'accès administrateur pendant ce temps.
    assert.equal((await ctx.api.get('/api/users').set(imp)).status, 403);
  });

  test('les actions sont tracées et les demandes confidentielles masquées', async () => {
    const secret = await ctx.createTicket(mamie, { title: 'Mes impôts', confidential: true });
    const open = await ctx.createTicket(mamie, { title: 'Wi-Fi' });
    const list = (await ctx.api.get('/api/tickets').set(imp)).body.items.map((t) => t.title);
    assert.deepEqual(list, ['Wi-Fi']);
    assert.equal((await ctx.api.get(`/api/tickets/${secret.id}`).set(imp)).status, 404);

    await ctx.api.post(`/api/tickets/${open.id}/comments`).set(imp).send({ body: 'Redémarrez la box' }).expect(201);
    await ctx.api.patch(`/api/tickets/${open.id}`).set(imp).send({ status: 'resolved' }).expect(200);
    const detail = (await ctx.api.get(`/api/tickets/${open.id}`).set(mamie.auth)).body;
    assert.equal(detail.comments[0].author.username, 'mamie');
    assert.equal(detail.comments[0].on_behalf_by, 'Swann');
    const status = detail.events.find((e) => e.type === 'status');
    assert.equal(status.actor.username, 'mamie');
    assert.equal(status.on_behalf_by, 'Swann');
    assert.equal(detail.events.find((e) => e.type === 'created').on_behalf_by, null);
  });

  test('mot de passe et double authentification bloqués ; journal et fin de session', async () => {
    const pwd = await ctx.api.put('/api/auth/me').set(imp).send({ currentPassword: 'x', password: 'nouveaumotdepasse' });
    assert.equal(pwd.status, 403);
    assert.equal((await ctx.api.post('/api/auth/mfa/recovery-codes').set(imp).send({ code: '000000' })).status, 403);
    assert.equal((await ctx.api.put('/api/auth/me').set(imp).send({ firstname: 'Autre' })).status, 403);

    await ctx.api.post('/api/auth/impersonate/stop').set(imp).expect(200);
    const log = (await ctx.api.get('/api/users/impersonations').set(admin.auth)).body;
    assert.equal(log[0].admin, 'Swann');
    assert.ok(log[0].ended_at);
    const seen = (await ctx.api.get('/api/auth/impersonations').set(mamie.auth)).body;
    assert.equal(seen[0].admin, 'Swann');

    // Le jeton tombe si l'administrateur perd son rôle.
    const again = (await ctx.api.post(`/api/users/${mamie.user.id}/impersonate`).set(admin.auth)).body.token;
    await ctx.api.patch(`/api/users/${admin.user.id}`).set(admin2.auth).send({ role: 'user' }).expect(200);
    assert.equal((await ctx.api.get('/api/auth/me').set({ Authorization: `Bearer ${again}` })).status, 401);
  });
});

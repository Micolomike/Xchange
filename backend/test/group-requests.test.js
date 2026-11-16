const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe("demandes d'adhésion aux groupes", () => {
  let ctx;
  let admin;
  let alice;
  let open;
  let closed;

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    alice = await ctx.register('alice');
    open = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Cuisiniers' })).body;
    closed = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Coordinateurs', joinable: false })).body;
  });
  after(() => ctx.cleanup());

  test('demande, validation par un admin, puis départ du groupe', async () => {
    const self = await ctx.api.get('/api/groups/self').set(alice.auth);
    assert.deepEqual(self.body.map((g) => g.name), ['Cuisiniers']);

    assert.equal((await ctx.api.post(`/api/groups/${closed.id}/requests`).set(alice.auth).send({})).status, 403);
    const req = await ctx.api.post(`/api/groups/${open.id}/requests`).set(alice.auth).send({ message: 'Je fais de bons gâteaux' });
    assert.equal(req.status, 201);
    assert.equal(req.body.status, 'pending');
    assert.equal((await ctx.api.post(`/api/groups/${open.id}/requests`).set(alice.auth).send({})).status, 409);

    assert.equal((await ctx.api.get('/api/groups/requests').set(alice.auth)).status, 403);
    const pending = await ctx.api.get('/api/groups/requests').set(admin.auth);
    assert.equal(pending.body.length, 1);
    assert.equal(pending.body[0].message, 'Je fais de bons gâteaux');
    assert.equal((await ctx.api.get('/api/stats').set(admin.auth)).body.pendingGroupRequests, 1);

    const ok = await ctx.api.post(`/api/groups/requests/${req.body.id}/approve`).set(admin.auth);
    assert.equal(ok.body.status, 'approved');
    assert.equal((await ctx.api.post(`/api/groups/requests/${req.body.id}/approve`).set(admin.auth)).status, 409);
    const groups = await ctx.api.get('/api/groups').set(admin.auth);
    assert.ok(groups.body.find((g) => g.id === open.id).members.some((m) => m.id === alice.user.id));
    assert.equal((await ctx.api.get('/api/groups/self').set(alice.auth)).body[0].member, true);

    await ctx.api.post(`/api/groups/${open.id}/leave`).set(alice.auth).expect(200);
    assert.equal((await ctx.api.get('/api/groups/self').set(alice.auth)).body[0].member, false);
  });

  test('refus avec motif, annulation, et choix des groupes à l’inscription', async () => {
    const req = (await ctx.api.post(`/api/groups/${open.id}/requests`).set(alice.auth).send({})).body;
    const no = await ctx.api.post(`/api/groups/requests/${req.id}/reject`).set(admin.auth).send({ reason: 'Groupe complet' });
    assert.equal(no.body.status, 'rejected');
    const self = (await ctx.api.get('/api/groups/self').set(alice.auth)).body[0];
    assert.equal(self.request.reason, 'Groupe complet');

    await ctx.api.post(`/api/groups/${open.id}/requests`).set(alice.auth).send({}).expect(201);
    await ctx.api.delete(`/api/groups/${open.id}/requests`).set(alice.auth).expect(200);
    assert.equal((await ctx.api.get('/api/groups/requests').set(admin.auth)).body.length, 0);

    const config = await ctx.api.get('/api/auth/config');
    assert.deepEqual(config.body.joinableGroups.map((g) => g.name), ['Cuisiniers']);
    const reg = await ctx.api
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'motdepasse1', groups: [open.id, closed.id] });
    assert.equal(reg.status, 201);
    const pending = (await ctx.api.get('/api/groups/requests').set(admin.auth)).body;
    assert.deepEqual(pending.map((r) => [r.user.username, r.group.name]), [['bob', 'Cuisiniers']]);
  });
});

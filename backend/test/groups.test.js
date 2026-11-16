const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe("groupes d'affectation", () => {
  let ctx;
  let admin;
  let alice; // membre du groupe Support
  let bob; // membre du groupe Réseau
  let carla; // simple demandeuse
  let support;
  let reseau;

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    alice = await ctx.register('alice', { firstname: 'Alice' });
    bob = await ctx.register('bob');
    carla = await ctx.register('carla');
  });
  after(() => ctx.cleanup());

  test('seul un admin crée et modifie un groupe ; le nom est unique', async () => {
    const denied = await ctx.api.post('/api/groups').set(alice.auth).send({ name: 'Support' });
    assert.equal(denied.status, 403);

    const res = await ctx.api
      .post('/api/groups')
      .set(admin.auth)
      .send({ name: '  Support   N1 ', description: 'Premier niveau', members: [alice.user.id] });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Support N1');
    assert.deepEqual(res.body.members.map((m) => m.username), ['alice']);
    support = res.body;

    reseau = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Réseau', members: [bob.user.id] })).body;

    const dup = await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'support n1' });
    assert.equal(dup.status, 409);
    const bad = await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'x', members: ['abc'] });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.name && bad.body.details.members);
    const ghost = await ctx.api.patch(`/api/groups/${support.id}`).set(admin.auth).send({ members: [9999] });
    assert.equal(ghost.status, 400);

    // Tout utilisateur connecté voit la liste (pour choisir un groupe), et l'admin voit les appartenances.
    const list = await ctx.api.get('/api/groups').set(carla.auth);
    assert.deepEqual(list.body.map((g) => g.name), ['Réseau', 'Support N1']);
    const users = await ctx.api.get('/api/users').set(admin.auth);
    assert.deepEqual(users.body.find((u) => u.username === 'alice').groups, [{ id: support.id, name: 'Support N1' }]);
  });

  test("les membres du groupe voient et traitent le ticket, pas les autres", async () => {
    const created = await ctx.createTicket(carla, { assigned_group: support.id });
    const id = created.id;
    assert.deepEqual(created.group, { id: support.id, name: 'Support N1' });

    const seen = await ctx.api.get(`/api/tickets/${id}`).set(alice.auth);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.permissions.canAssign, true);
    assert.equal(seen.body.permissions.canEdit, false);
    assert.equal((await ctx.api.get(`/api/tickets/${id}`).set(bob.auth)).status, 404);

    const list = await ctx.api.get('/api/tickets').query({ group: 'mine' }).set(alice.auth);
    assert.deepEqual(list.body.items.map((t) => t.id), [id]);

    // Alice prend le ticket en charge.
    const taken = await ctx.api
      .patch(`/api/tickets/${id}`)
      .set(alice.auth)
      .send({ assigned_to: alice.user.id, status: 'in_progress' });
    assert.equal(taken.status, 200);
    assert.equal(taken.body.assignee.id, alice.user.id);

    // Personne hors du groupe ne peut être responsable.
    const outsider = await ctx.api.patch(`/api/tickets/${id}`).set(alice.auth).send({ assigned_to: bob.user.id });
    assert.equal(outsider.status, 400);
    assert.ok(outsider.body.details.assigned_to);
    const adminToo = await ctx.api.patch(`/api/tickets/${id}`).set(admin.auth).send({ assigned_to: bob.user.id });
    assert.equal(adminToo.status, 400);

    // La demandeuse ne peut ni assigner ni transférer.
    const byCarla = await ctx.api.patch(`/api/tickets/${id}`).set(carla.auth).send({ assigned_group: reseau.id });
    assert.equal(byCarla.status, 403);

    // Transfert au groupe Réseau : Alice n'en fait pas partie, elle n'est plus responsable.
    const moved = await ctx.api.patch(`/api/tickets/${id}`).set(alice.auth).send({ assigned_group: reseau.id });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.group.id, reseau.id);
    assert.equal(moved.body.noLongerVisible, true);
    assert.equal((await ctx.api.get(`/api/tickets/${id}`).set(alice.auth)).status, 404);
    const forBob = await ctx.api.get(`/api/tickets/${id}`).set(bob.auth);
    assert.equal(forBob.status, 200);
    assert.equal(forBob.body.assignee, null);

    const events = (await ctx.api.get(`/api/tickets/${id}`).set(admin.auth)).body.events;
    const groupEvents = events.filter((e) => e.type === 'group').map((e) => [e.from, e.to]);
    assert.deepEqual(groupEvents, [
      [null, 'Support N1'],
      ['Support N1', 'Réseau'],
    ]);
  });

  test('tableau de bord : tickets sans responsable dans mes groupes', async () => {
    const stats = await ctx.api.get('/api/stats').set(bob.auth);
    assert.equal(stats.body.groupQueue, 1);
    const none = await ctx.api.get('/api/stats').set(alice.auth);
    assert.equal(none.body.groupQueue, 0);
  });

  test("seul un admin assigne un ticket sans groupe ; supprimer un groupe garde ses tickets", async () => {
    const t = await ctx.createTicket(carla);
    const denied = await ctx.api.patch(`/api/tickets/${t.id}`).set(alice.auth).send({ assigned_to: alice.user.id });
    assert.equal(denied.status, 404); // ticket invisible pour Alice
    const ok = await ctx.api.patch(`/api/tickets/${t.id}`).set(admin.auth).send({ assigned_to: bob.user.id });
    assert.equal(ok.status, 200);

    const before = (await ctx.api.get('/api/tickets').query({ group: reseau.id }).set(admin.auth)).body.total;
    assert.equal(before, 1);
    assert.equal((await ctx.api.delete(`/api/groups/${reseau.id}`).set(bob.auth)).status, 403);
    await ctx.api.delete(`/api/groups/${reseau.id}`).set(admin.auth).expect(200);
    const orphan = await ctx.api.get('/api/tickets').query({ group: 'none' }).set(admin.auth);
    assert.equal(orphan.body.total, 2);
    const detail = await ctx.api.get(`/api/tickets/${orphan.body.items.at(-1).id}`).set(admin.auth);
    assert.equal(detail.body.group, null);
    assert.ok(detail.body.events.some((e) => e.type === 'group' && e.to === 'Groupe supprimé'));
  });
});

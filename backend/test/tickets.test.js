const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('tickets', () => {
  let ctx;
  let admin;
  let alice;
  let bob;

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    alice = await ctx.register('alice', { firstname: 'Alice', lastname: 'Durand' });
    bob = await ctx.register('bob');
  });
  after(() => ctx.cleanup());

  test('création : la date limite est bien enregistrée (dueDate et due_date)', async () => {
    const t1 = await ctx.createTicket(alice, { dueDate: '2030-01-15', category: 'bug' });
    assert.equal(t1.due_date, '2030-01-15');
    assert.equal(t1.status, 'open');
    assert.equal(t1.creator.name, 'Alice Durand');
    assert.equal(t1.events[0].type, 'created');
    assert.deepEqual(t1.permissions, {
      canEdit: true,
      canChangeStatus: true,
      canAssign: false,
      canDelete: false,
      canComment: true,
    });

    const t2 = await ctx.createTicket(alice, { due_date: '2030-02-01' });
    assert.equal(t2.due_date, '2030-02-01');
  });

  test('validation à la création', async () => {
    const res = await ctx.api
      .post('/api/tickets')
      .set(alice.auth)
      .send({ title: '', description: '', priority: 'énorme', category: 'autre', due_date: '2030-02-31' });
    assert.equal(res.status, 400);
    for (const field of ['title', 'description', 'priority', 'category', 'due_date']) {
      assert.ok(res.body.details[field], `erreur attendue sur ${field}`);
    }
  });

  test('un utilisateur ne peut pas assigner à la création', async () => {
    const res = await ctx.api
      .post('/api/tickets')
      .set(alice.auth)
      .send({ title: 'x', description: 'y', priority: 'low', assigned_to: bob.user.id });
    assert.equal(res.status, 403);
  });

  test('visibilité : un utilisateur ne voit que ses tickets et ceux qui lui sont assignés', async () => {
    const own = await ctx.createTicket(bob, { title: 'Ticket de Bob' });
    const aliceList = await ctx.api.get('/api/tickets').set(alice.auth);
    assert.ok(aliceList.body.items.every((t) => t.creator.id === alice.user.id));
    assert.equal((await ctx.api.get(`/api/tickets/${own.id}`).set(alice.auth)).status, 404);

    const adminList = await ctx.api.get('/api/tickets').set(admin.auth);
    assert.equal(adminList.body.total, 3);

    // Assigné à Alice par l'admin : elle le voit désormais.
    const assigned = await ctx.api.patch(`/api/tickets/${own.id}`).set(admin.auth).send({ assigned_to: alice.user.id });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.assignee.id, alice.user.id);
    const visible = await ctx.api.get(`/api/tickets/${own.id}`).set(alice.auth);
    assert.equal(visible.status, 200);
    assert.equal(visible.body.permissions.canEdit, false);
    assert.equal(visible.body.permissions.canChangeStatus, true);
  });

  test('cycle de vie : statuts, date de résolution et historique', async () => {
    const t = await ctx.createTicket(bob, { title: 'Cycle de vie' });
    await ctx.api.patch(`/api/tickets/${t.id}`).set(admin.auth).send({ assigned_to: alice.user.id }).expect(200);

    const inProgress = await ctx.api.patch(`/api/tickets/${t.id}`).set(alice.auth).send({ status: 'in_progress' });
    assert.equal(inProgress.body.status, 'in_progress');
    assert.equal(inProgress.body.resolved_at, null);

    const resolved = await ctx.api.patch(`/api/tickets/${t.id}`).set(alice.auth).send({ status: 'resolved' });
    assert.ok(resolved.body.resolved_at);

    const closed = await ctx.api.patch(`/api/tickets/${t.id}`).set(bob.auth).send({ status: 'closed' });
    assert.equal(closed.body.resolved_at, resolved.body.resolved_at, 'la date de résolution est conservée');

    const reopened = await ctx.api.patch(`/api/tickets/${t.id}`).set(bob.auth).send({ status: 'open' });
    assert.equal(reopened.body.resolved_at, null);

    const types = reopened.body.events.map((e) => `${e.type}:${e.from ?? ''}>${e.to ?? ''}`);
    assert.deepEqual(types, [
      'created:>',
      'assignee:>Alice Durand',
      'status:open>in_progress',
      'status:in_progress>resolved',
      'status:resolved>closed',
      'status:closed>open',
    ]);
  });

  test('permissions de modification', async () => {
    const t = await ctx.createTicket(bob, { title: 'Permissions' });
    await ctx.api.patch(`/api/tickets/${t.id}`).set(admin.auth).send({ assigned_to: alice.user.id }).expect(200);

    // L'assignée ne peut pas réécrire le contenu ni réassigner.
    assert.equal((await ctx.api.patch(`/api/tickets/${t.id}`).set(alice.auth).send({ title: 'Piraté' })).status, 403);
    assert.equal(
      (await ctx.api.patch(`/api/tickets/${t.id}`).set(alice.auth).send({ assigned_to: bob.user.id })).status,
      403
    );
    // L'auteur peut modifier le contenu.
    const edited = await ctx.api
      .patch(`/api/tickets/${t.id}`)
      .set(bob.auth)
      .send({ title: 'Permissions (modifié)', priority: 'high', due_date: '' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.title, 'Permissions (modifié)');
    assert.equal(edited.body.priority, 'high');
    const last = edited.body.events.slice(-2).map((e) => e.type);
    assert.deepEqual(last, ['priority', 'edited']);

    // Assignation à un utilisateur inexistant.
    assert.equal((await ctx.api.patch(`/api/tickets/${t.id}`).set(admin.auth).send({ assigned_to: 9999 })).status, 400);
  });

  test('commentaires : ajout, visibilité et suppression', async () => {
    const t = await ctx.createTicket(alice, { title: 'Commentaires' });
    const c = await ctx.api.post(`/api/tickets/${t.id}/comments`).set(alice.auth).send({ body: '  Bonjour  ' });
    assert.equal(c.status, 201);
    assert.equal(c.body.body, 'Bonjour');

    assert.equal((await ctx.api.post(`/api/tickets/${t.id}/comments`).set(alice.auth).send({ body: '   ' })).status, 400);
    assert.equal((await ctx.api.post(`/api/tickets/${t.id}/comments`).set(bob.auth).send({ body: 'intrus' })).status, 404);

    const adminComment = await ctx.api.post(`/api/tickets/${t.id}/comments`).set(admin.auth).send({ body: 'Pris en charge' });
    assert.equal(
      (await ctx.api.delete(`/api/tickets/${t.id}/comments/${adminComment.body.id}`).set(alice.auth)).status,
      403
    );
    await ctx.api.delete(`/api/tickets/${t.id}/comments/${c.body.id}`).set(alice.auth).expect(200);

    const detail = await ctx.api.get(`/api/tickets/${t.id}`).set(alice.auth);
    assert.equal(detail.body.comments.length, 1);
    assert.equal(detail.body.comments[0].canDelete, false);
  });

  test('filtres, recherche, tri et pagination', async () => {
    const fresh = await setup();
    try {
      const a = await fresh.register('agent');
      const u = await fresh.register('usager');
      await fresh.createTicket(u, { title: 'Écran noir', priority: 'high', category: 'bug', due_date: '2000-01-01' });
      await fresh.createTicket(u, { title: 'Nouvelle fonctionnalité', priority: 'low', category: 'feature' });
      await fresh.createTicket(u, { title: 'Accès VPN 100%', priority: 'medium', category: 'support' });
      const t4 = await fresh.createTicket(u, { title: 'Clavier', priority: 'low' });
      await fresh.api.patch(`/api/tickets/${t4.id}`).set(a.auth).send({ status: 'resolved', assigned_to: a.user.id });

      const q = (query) => fresh.api.get('/api/tickets').query(query).set(a.auth);

      assert.equal((await q({ status: 'active' })).body.total, 3);
      assert.equal((await q({ status: 'done' })).body.total, 1);
      assert.equal((await q({ priority: 'low' })).body.total, 2);
      assert.equal((await q({ category: 'none' })).body.total, 1);
      assert.equal((await q({ assignee: 'unassigned' })).body.total, 3);
      assert.equal((await q({ assignee: 'me' })).body.total, 1);
      assert.equal((await q({ overdue: '1' })).body.total, 1);
      assert.equal((await q({ q: 'vpn' })).body.items[0].title, 'Accès VPN 100%');
      assert.equal((await q({ q: '100%' })).body.total, 1, 'le % est cherché littéralement');
      assert.equal((await q({ q: `#${t4.id}` })).body.items[0].id, t4.id);

      const byPriority = await q({ sort: 'priority', order: 'desc' });
      assert.equal(byPriority.body.items[0].priority, 'high');

      const page2 = await q({ pageSize: 3, page: 2 });
      assert.equal(page2.body.items.length, 1);
      assert.equal(page2.body.total, 4);

      // Un utilisateur ne voit pas les autres même avec un filtre explicite.
      const other = await fresh.register('other');
      assert.equal((await fresh.api.get('/api/tickets').query({ assignee: String(a.user.id) }).set(other.auth)).body.total, 0);
    } finally {
      await fresh.cleanup();
    }
  });

  test('suppression : réservée aux admins, ticket envoyé à la corbeille', async () => {
    const t = await ctx.createTicket(alice, { title: 'À supprimer' });
    assert.equal((await ctx.api.delete(`/api/tickets/${t.id}`).set(alice.auth)).status, 403);
    await ctx.api.delete(`/api/tickets/${t.id}`).set(admin.auth).expect(200);
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(admin.auth)).status, 404);
    const list = await ctx.api.get('/api/tickets').set(admin.auth);
    assert.ok(!list.body.items.some((x) => x.id === t.id));
  });

  test('statistiques du tableau de bord', async () => {
    const s = await ctx.api.get('/api/stats').set(alice.auth);
    assert.equal(s.status, 200);
    assert.equal(s.body.trend.length, 14);
    assert.ok(s.body.total >= 1);
    assert.equal(
      s.body.byStatus.open + s.body.byStatus.in_progress + s.body.byStatus.resolved + s.body.byStatus.closed,
      s.body.total
    );
    assert.ok(Array.isArray(s.body.myQueue));
    const adminStats = await ctx.api.get('/api/stats').set(admin.auth);
    assert.ok(adminStats.body.total >= s.body.total);
  });

  test('identifiant invalide et route inconnue', async () => {
    assert.equal((await ctx.api.get('/api/tickets/abc').set(alice.auth)).status, 400);
    assert.equal((await ctx.api.get('/api/inexistant').set(alice.auth)).status, 404);
    const bad = await ctx.api.post('/api/tickets').set(alice.auth).set('Content-Type', 'application/json').send('{oups');
    assert.equal(bad.status, 400);
  });
});

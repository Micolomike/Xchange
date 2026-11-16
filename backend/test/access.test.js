const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('droits par groupe, règles par catégorie et confidentialité', () => {
  let ctx;
  let admin;
  let admin2;
  let fisc; // membre des Fiscalistes
  let info; // membre des Informaticiens
  let coord; // membre des Coordinateurs (voir : tous)
  let lambda; // sans groupe
  let G = {};

  const ids = async (session, query = {}) =>
    (await ctx.api.get('/api/tickets').query({ status: 'all', pageSize: 100, ...query }).set(session.auth)).body.items
      .map((t) => t.title)
      .sort();

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    admin2 = await ctx.register('admin2');
    await ctx.api.patch(`/api/users/${admin2.user.id}`).set(admin.auth).send({ role: 'admin' }).expect(200);
    fisc = await ctx.register('fisc');
    info = await ctx.register('info');
    coord = await ctx.register('coord');
    lambda = await ctx.register('lambda');
    const group = async (name, members) =>
      (await ctx.api.post('/api/groups').set(admin.auth).send({ name, members: members.map((m) => m.user.id) })).body.id;
    G = {
      fisc: await group('Fiscalistes', [fisc]),
      info: await group('Informaticiens', [info]),
      coord: await group('Coordinateurs', [coord]),
    };
    await ctx.api
      .put('/api/admin/settings/lists')
      .set(admin.auth)
      .send({ categories: [{ key: 'bug', label: 'Informatique' }, { label: 'Impôts' }, { key: 'support', label: 'Divers' }] })
      .expect(200);
  });
  after(() => ctx.cleanup());

  test('les réglages par défaut reproduisent le fonctionnement actuel', async () => {
    const res = await ctx.api.get('/api/admin/settings/access').set(admin.auth);
    assert.deepEqual(res.body.base, { view: 'own', create: true, work: false, assign: false, edit: false, delete: false });
    assert.deepEqual(res.body.groups[G.info], { view: 'group', create: true, work: true, assign: true, edit: false, delete: false });
    assert.equal((await ctx.api.get('/api/admin/settings/access').set(lambda.auth)).status, 403);
  });

  test('matrice : voir tous, règles par catégorie, droits de supprimer et de créer', async () => {
    const res = await ctx.api
      .put('/api/admin/settings/access')
      .set(admin.auth)
      .send({
        base: { view: 'own', create: true },
        groups: {
          [G.coord]: { view: 'all', create: true, work: true, assign: true, edit: true, delete: true },
          [G.fisc]: { view: 'group', create: true, work: true },
          [G.info]: { view: 'group', create: true, work: true, assign: true },
        },
        categories: { impots: [G.fisc] },
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    await ctx.createTicket(lambda, { title: 'Déclaration 2026', category: 'impots' });
    await ctx.createTicket(lambda, { title: 'Wi-Fi lent', category: 'bug' });
    await ctx.createTicket(lambda, { title: 'Question diverse', category: 'support' });

    // Les Fiscalistes voient toute la catégorie Impôts, même sans groupe d'affectation.
    assert.deepEqual(await ids(fisc), ['Déclaration 2026']);
    // « Voir : tous » sauf les catégories réservées à d'autres groupes.
    assert.deepEqual(await ids(coord), ['Question diverse', 'Wi-Fi lent']);
    assert.deepEqual(await ids(info), []);
    assert.equal((await ids(admin)).length, 3);

    // Droits issus de la matrice.
    const wifi = (await ctx.api.get('/api/tickets').query({ q: 'Wi-Fi' }).set(coord.auth)).body.items[0];
    const detail = await ctx.api.get(`/api/tickets/${wifi.id}`).set(coord.auth);
    assert.equal(detail.body.permissions.canDelete, true);
    assert.equal(detail.body.permissions.canEdit, true);
    assert.equal((await ctx.api.patch(`/api/tickets/${wifi.id}`).set(coord.auth).send({ title: 'Wi-Fi très lent' })).status, 200);
    await ctx.api.delete(`/api/tickets/${wifi.id}`).set(coord.auth).expect(200);

    // Retirer le droit de créer à « Tous les utilisateurs ».
    await ctx.api
      .put('/api/admin/settings/access')
      .set(admin.auth)
      .send({ base: { view: 'own', create: false }, groups: {}, categories: { impots: [G.fisc] } })
      .expect(200);
    const denied = await ctx.api.post('/api/tickets').set(lambda.auth).send({ title: 'x', description: 'y', priority: 'low' });
    assert.equal(denied.status, 403);
    // Les groupes gardent leur droit de créer (valeur par défaut).
    assert.ok(await ctx.createTicket(info, { title: 'Créé par un membre' }));
    const me = await ctx.api.get('/api/auth/me').set(lambda.auth);
    assert.equal(me.body.user.access.rights.create, false);
    await ctx.api.put('/api/admin/settings/access').set(admin.auth).send({ base: { view: 'own', create: true } }).expect(200);

    const bad = await ctx.api.put('/api/admin/settings/access').set(admin.auth).send({ base: { view: 'group' } });
    assert.equal(bad.status, 400);
  });

  test('demande confidentielle : invisible des administrateurs qui n’y participent pas', async () => {
    const t = await ctx.createTicket(lambda, { title: 'Mes impôts perso', category: 'impots', confidential: true, assigned_group: G.fisc });
    assert.equal(t.confidential, true);
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(admin.auth)).status, 404);
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(fisc.auth)).status, 200); // groupe affecté
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(coord.auth)).status, 404);
    assert.ok(!(await ids(admin)).includes('Mes impôts perso'));

    // Seul l'auteur peut changer la confidentialité.
    const byFisc = await ctx.api.patch(`/api/tickets/${t.id}`).set(fisc.auth).send({ confidential: false });
    assert.equal(byFisc.status, 403);
    const open = await ctx.api.patch(`/api/tickets/${t.id}`).set(lambda.auth).send({ confidential: false });
    assert.equal(open.status, 200);
    assert.ok(open.body.events.some((e) => e.type === 'confidential' && e.to === 'non'));
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(admin.auth)).status, 200);

    // Corbeille : contenu masqué pour l'administrateur hors de la demande.
    await ctx.api.patch(`/api/tickets/${t.id}`).set(lambda.auth).send({ confidential: true }).expect(200);
    await ctx.api
      .put('/api/admin/settings/access')
      .set(admin.auth)
      .send({ base: { view: 'own', create: true }, groups: { [G.fisc]: { view: 'group', create: true, delete: true } } })
      .expect(200);
    await ctx.api.delete(`/api/tickets/${t.id}`).set(fisc.auth).expect(200);
    const trash = await ctx.api.get('/api/admin/trash').set(admin2.auth);
    assert.ok(trash.body.some((x) => x.id === t.id && x.title === 'Demande confidentielle'));
  });

  test('un formulaire du catalogue fixe la catégorie et peut être envoyé en confidentiel', async () => {
    const item = (
      await ctx.api
        .post('/api/admin/catalog')
        .set(admin.auth)
        .send({ name: 'Aide déclaration', category: 'impots', fulfillment_group: G.fisc, fields: [] })
    ).body;
    assert.equal(item.category, 'impots');
    const sent = await ctx.api.post(`/api/catalog/${item.id}/submit`).set(lambda.auth).send({ answers: {}, confidential: true });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.category, 'impots');
    assert.equal(sent.body.confidential, true);
  });
});

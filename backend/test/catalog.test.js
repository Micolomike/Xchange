const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const FIELDS = [
  { key: 'poste', label: 'Numéro du poste', type: 'text', required: true, inTitle: true },
  { key: 'type', label: 'Type de panne', type: 'select', required: true, options: ['Écran', 'Clavier', 'Autre'] },
  {
    key: 'precision',
    label: 'Précisez',
    type: 'textarea',
    required: true,
    condition: { field: 'type', op: 'equals', value: 'Autre' },
  },
  { key: 'urgent', label: 'Bloquant pour travailler', type: 'checkbox' },
  {
    key: 'depuis',
    label: 'Depuis quand',
    type: 'date',
    required: true,
    condition: { field: 'urgent', op: 'checked' },
  },
  { key: 'photo', label: 'Photo', type: 'file' },
];

describe('catalogue de formulaires', () => {
  let ctx;
  let admin;
  let alice; // membre du groupe Support, qui traite le formulaire
  let bob; // membre du groupe Direction
  let carla; // sans groupe
  let support;
  let direction;
  let item;

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    alice = await ctx.register('alice');
    bob = await ctx.register('bob');
    carla = await ctx.register('carla');
    const group = async (name, members) =>
      (await ctx.api.post('/api/groups').set(admin.auth).send({ name, members })).body;
    support = await group('Support', [alice.user.id]);
    direction = await group('Direction', [bob.user.id]);
  });
  after(() => ctx.cleanup());

  test('création réservée aux admins, avec contrôle de la définition', async () => {
    assert.equal((await ctx.api.post('/api/admin/catalog').set(alice.auth).send({ name: 'x' })).status, 403);

    const bad = await ctx.api
      .post('/api/admin/catalog')
      .set(admin.auth)
      .send({
        name: 'P',
        priority: 'urgente',
        fields: [
          { key: 'a', label: '', type: 'select', options: ['seul'] },
          { key: 'a', label: 'Double', type: 'magique' },
          { key: 'b', label: 'Règle', type: 'text', condition: { field: 'zzz', op: 'equals', value: 'x' } },
        ],
      });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.name && bad.body.details.priority);
    for (const part of ['libellé est requis', 'deux choix', 'en double', 'type de champ inconnu', 'placé avant']) {
      assert.ok(bad.body.details.fields.includes(part), `erreur attendue : ${part}`);
    }

    const res = await ctx.api.post('/api/admin/catalog').set(admin.auth).send({
      name: 'Matériel en panne',
      description: 'Écran, clavier, souris…',
      section: 'Informatique',
      priority: 'high',
      fulfillment_group: support.id,
      fields: FIELDS,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.fields.length, 6);
    assert.deepEqual(res.body.fields[2].condition, { field: 'type', op: 'equals', value: 'Autre' });
    item = res.body;
  });

  test('visible par tous, puis réservé à un groupe ; un formulaire inactif disparaît', async () => {
    const names = async (session) => (await ctx.api.get('/api/catalog').set(session.auth)).body.map((i) => i.name);
    assert.deepEqual(await names(carla), ['Matériel en panne']);

    await ctx.api.patch(`/api/admin/catalog/${item.id}`).set(admin.auth).send({ visible_groups: [direction.id] }).expect(200);
    assert.deepEqual(await names(carla), []);
    assert.deepEqual(await names(bob), ['Matériel en panne']);
    assert.equal((await ctx.api.get(`/api/catalog/${item.id}`).set(carla.auth)).status, 404);
    assert.equal((await ctx.api.post(`/api/catalog/${item.id}/submit`).set(carla.auth).send({})).status, 404);

    await ctx.api.patch(`/api/admin/catalog/${item.id}`).set(admin.auth).send({ active: false }).expect(200);
    assert.deepEqual(await names(bob), []);
    await ctx.api
      .patch(`/api/admin/catalog/${item.id}`)
      .set(admin.auth)
      .send({ active: true, visible_groups: [] })
      .expect(200);
  });

  test('envoi : champs requis, règles d’affichage et création du ticket', async () => {
    const submit = (answers) => ctx.api.post(`/api/catalog/${item.id}/submit`).set(carla.auth).send({ answers });

    const missing = await submit({ type: 'Autre', urgent: true });
    assert.equal(missing.status, 400);
    assert.deepEqual(Object.keys(missing.body.details).sort(), ['depuis', 'poste', 'precision']);

    const badChoice = await submit({ poste: 'PC-12', type: 'Imprimante' });
    assert.equal(badChoice.body.details.type, 'Choix inconnu.');

    // « Précisez » est masqué (type différent de Autre) : sa valeur est ignorée.
    const ok = await submit({ poste: 'PC-12', type: 'Écran', precision: 'texte caché', urgent: true, depuis: '2026-11-10', photo: 1 });
    assert.equal(ok.status, 201);
    const t = ok.body;
    assert.equal(t.title, 'Matériel en panne : PC-12');
    assert.equal(t.priority, 'high');
    assert.deepEqual(t.group, { id: support.id, name: 'Support' });
    assert.deepEqual(t.form, { id: item.id, name: 'Matériel en panne' });
    assert.deepEqual(
      t.answers.map((a) => [a.label, a.value]),
      [
        ['Numéro du poste', 'PC-12'],
        ['Type de panne', 'Écran'],
        ['Bloquant pour travailler', 'Oui'],
        ['Depuis quand', '2026-11-10'],
        ['Photo', '1 fichier joint'],
      ]
    );
    assert.ok(t.description.includes('Depuis quand : 10/11/2026'));
    assert.ok(!t.description.includes('texte caché'));

    // Le groupe qui traite le formulaire voit le ticket.
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(alice.auth)).status, 200);
    const search = await ctx.api.get('/api/tickets').query({ q: 'PC-12' }).set(admin.auth);
    assert.equal(search.body.total, 1);
  });

  test('duplication (inactive) et suppression sans perdre les réponses des tickets', async () => {
    const copy = await ctx.api.post(`/api/admin/catalog/${item.id}/duplicate`).set(admin.auth);
    assert.equal(copy.status, 201);
    assert.equal(copy.body.name, 'Matériel en panne (copie)');
    assert.equal(copy.body.active, false);

    const list = await ctx.api.get('/api/admin/catalog').set(admin.auth);
    assert.equal(list.body.find((i) => i.id === item.id).ticket_count, 1);

    await ctx.api.delete(`/api/admin/catalog/${item.id}`).set(admin.auth).expect(200);
    const tickets = await ctx.api.get('/api/tickets').set(admin.auth);
    const kept = tickets.body.items.find((t) => t.title === 'Matériel en panne : PC-12');
    assert.deepEqual(kept.form, { id: null, name: null });
    assert.equal(kept.answers.length, 5);
  });
});

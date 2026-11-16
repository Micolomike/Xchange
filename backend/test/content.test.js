const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { applyContent, applyV1, FORMS, GROUPS, GROUPS_V2, CATEGORY_GROUP } = require('../src/content');
const { setSetting } = require('../src/settings');

const quiet = { info() {}, error() {} };

describe('contenu de départ', () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    // Existant à préserver : un groupe et un formulaire du même nom, une catégorie renommée.
    await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'informaticiens', description: 'Le mien' }).expect(201);
    await ctx.api.post('/api/admin/catalog').set(admin.auth).send({ name: 'Relecture de CV', description: 'Ma version', fields: [] }).expect(201);
  });
  after(() => ctx.cleanup());

  test('ajoute catégories, groupes, formulaires et règles sans rien écraser', async () => {
    const r = await applyContent(ctx.db, { logger: quiet });
    assert.equal(r.applied, true);
    assert.equal(r.added.groups, GROUPS.length + GROUPS_V2.length - 1);
    // 29 formulaires ajoutés + 5 réaffectés à leur nouveau groupe.
    assert.equal(r.added.forms, FORMS.length - 1 + 5);

    const groups = (await ctx.api.get('/api/groups').set(admin.auth)).body;
    assert.equal(groups.find((g) => g.name.toLowerCase() === 'informaticiens').description, 'Le mien');

    const catalog = (await ctx.api.get('/api/admin/catalog').set(admin.auth)).body;
    assert.equal(catalog.find((i) => i.name === 'Relecture de CV').description, 'Ma version');
    const virus = catalog.find((i) => i.name === 'Virus, arnaque ou message suspect');
    assert.equal(virus.priority, 'high');
    assert.equal(virus.category, 'informatique');
    assert.equal(virus.fulfillment_group.name.toLowerCase(), 'informaticiens');

    const settings = (await ctx.api.get('/api/settings')).body;
    assert.ok(settings.categories.some((c) => c.key === 'impots' && c.label === 'Impôts et fiscalité'));
    const access = (await ctx.api.get('/api/admin/settings/access').set(admin.auth)).body;
    const id = (name) => groups.find((g) => g.name.toLowerCase() === name.toLowerCase()).id;
    // Une règle par catégorie ; les sujets personnels ne sont pas visibles des Coordinateurs.
    assert.equal(Object.keys(access.categories).length, Object.keys(CATEGORY_GROUP).length);
    assert.deepEqual(access.categories.impots, [id('Fiscalistes')]);
    assert.deepEqual(access.categories.informatique, [id('Informaticiens'), id('Coordinateurs')]);
    assert.deepEqual(access.categories.voyages, [id('Globe-trotteurs'), id('Coordinateurs')]);
    assert.equal(access.groups[id('Coordinateurs')].view, 'all');
    assert.equal(access.groups[id('Coordinateurs')].edit, true);
    assert.equal(access.groups[id('Mécanos')].view, 'group');
    const voyage = catalog.find((i) => i.name === 'Préparer un voyage');
    assert.equal(voyage.fulfillment_group.name, 'Globe-trotteurs');

    // Une seule fois : un second passage ne rajoute rien, même après suppression.
    await ctx.api.delete(`/api/admin/catalog/${virus.id}`).set(admin.auth).expect(200);
    assert.equal((await applyContent(ctx.db, { logger: quiet })).applied, false);
    assert.ok(!(await ctx.api.get('/api/admin/catalog').set(admin.auth)).body.some((i) => i.id === virus.id));
  });

  test('passage de la version 1 à la version 2 : les modifications de l’utilisateur sont gardées', async () => {
    const other = await setup();
    try {
      const a = await other.register('admin');
      const counts = { categories: 0, groups: 0, forms: 0 };
      await applyV1(other.db, new Date().toISOString(), counts);
      await setSetting(other.db, 'content_version', 1);
      await setSetting(other.db, 'access', { categories: { impots: [] } });
      const groups = (await other.api.get('/api/groups').set(a.auth)).body;
      const id = (name) => groups.find((g) => g.name === name).id;
      // L'utilisateur a choisi lui-même : voyage traité par les Organisateurs → Cuisiniers, impôts → Profs.
      const catalog = (await other.api.get('/api/admin/catalog').set(a.auth)).body;
      const voyage = catalog.find((i) => i.name === 'Préparer un voyage');
      await other.api.patch(`/api/admin/catalog/${voyage.id}`).set(a.auth).send({ fulfillment_group: id('Cuisiniers') }).expect(200);
      await setSetting(other.db, 'access', { categories: { impots: [id('Profs')] } });

      const r = await applyContent(other.db, { logger: quiet });
      assert.equal(r.applied, true);
      const after = (await other.api.get('/api/admin/catalog').set(a.auth)).body;
      assert.equal(after.find((i) => i.name === 'Préparer un voyage').fulfillment_group.name, 'Cuisiniers');
      assert.equal(after.find((i) => i.name === 'Problème de smartphone ou de tablette').fulfillment_group.name, 'Experts mobiles');
      const access = (await other.api.get('/api/admin/settings/access').set(a.auth)).body;
      assert.deepEqual(access.categories.impots, [id('Profs')]);
      assert.ok(access.categories.telephone.length === 2);
    } finally {
      await other.cleanup();
    }
  });

  test('un formulaire de départ avec règle d’affichage fonctionne de bout en bout', async () => {
    const user = await ctx.register('mamie');
    const list = (await ctx.api.get('/api/catalog').set(user.auth)).body;
    const form = list.find((i) => i.name === 'Aide à la déclaration de revenus');
    const missing = await ctx.api
      .post(`/api/catalog/${form.id}/submit`)
      .set(user.auth)
      .send({ answers: { situation: 'Célibataire', changement: 'Oui' } });
    assert.equal(missing.status, 400);
    assert.ok(missing.body.details.qu_est_ce_qui_a_change);
    const ok = await ctx.api
      .post(`/api/catalog/${form.id}/submit`)
      .set(user.auth)
      .send({ answers: { situation: 'Célibataire', changement: 'Non' }, confidential: true });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.category, 'impots');
    assert.equal(ok.body.group.name, 'Fiscalistes');
  });
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { applyContent, FORMS, GROUPS } = require('../src/content');

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
    assert.equal(r.added.groups, GROUPS.length - 1);
    assert.equal(r.added.forms, FORMS.length - 1);

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
    const fisc = groups.find((g) => g.name === 'Fiscalistes').id;
    assert.deepEqual(access.categories.impots, [fisc]);

    // Une seule fois : un second passage ne rajoute rien, même après suppression.
    await ctx.api.delete(`/api/admin/catalog/${virus.id}`).set(admin.auth).expect(200);
    assert.equal((await applyContent(ctx.db, { logger: quiet })).applied, false);
    assert.ok(!(await ctx.api.get('/api/admin/catalog').set(admin.auth)).body.some((i) => i.id === virus.id));
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

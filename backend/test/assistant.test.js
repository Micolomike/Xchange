const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { applyContent } = require('../src/content');

describe('assistant guidé (sans IA)', () => {
  let ctx;
  let admin;
  let user;
  const ask = (q, who = user) => ctx.api.get('/api/assistant/search').query({ q }).set(who.auth);

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin');
    user = await ctx.register('mamie');
    await applyContent(ctx.db, { logger: { info() {} } }); // le catalogue de départ
  });
  after(() => ctx.cleanup());

  test('oriente vers les bons formulaires, avec les mots de tous les jours', async () => {
    const wifi = (await ask('mon wifi ne marche plus').expect(200)).body;
    assert.ok(wifi.forms.length >= 1);
    assert.ok(wifi.forms.some((f) => /internet|wi-?fi|box/i.test(f.name)), JSON.stringify(wifi.forms));
    const impots = (await ask('aide pour ma déclaration d’impôts').expect(200)).body;
    assert.ok(impots.forms.some((f) => /d[ée]claration|imp[ôo]t/i.test(f.name)), JSON.stringify(impots.forms));
    const tel = (await ask('mon smartphone est lent')).body;
    assert.ok(tel.forms.some((f) => /smartphone|t[ée]l[ée]phone|tablette/i.test(f.name)), JSON.stringify(tel.forms));
  });

  test('répond aux questions sur l’utilisation d’Xchange', async () => {
    const r = (await ask('où en est ma demande ?')).body;
    assert.equal(r.faq[0].question, 'Où en est ma demande ?');
    assert.equal(r.faq[0].link, '/tickets');
    assert.equal((await ask('j’ai oublié mon mot de passe')).body.faq[0].question, 'J’ai oublié mon mot de passe');
  });

  test('ne propose que les formulaires visibles par la personne', async () => {
    const g = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Réservé' })).body;
    await ctx.api
      .post('/api/admin/catalog')
      .set(admin.auth)
      .send({ name: 'Réparation de trottinette électrique', fields: [], visible_groups: [g.id] })
      .expect(201);
    assert.equal((await ask('trottinette électrique', admin)).body.forms[0].name, 'Réparation de trottinette électrique');
    assert.ok(!(await ask('trottinette électrique')).body.forms.some((f) => /trottinette/i.test(f.name)));
  });

  test('questions sans réponse gardées sans nom, visibles par les administrateurs', async () => {
    const r = (await ask('xylophone quantique')).body;
    assert.deepEqual(r, { faq: [], forms: [] });
    await ctx.api.post('/api/assistant/miss').set(user.auth).send({ q: 'Xylophone quantique !' }).expect(200);
    const rows = await ctx.db.all('SELECT * FROM assistant_misses');
    assert.ok(rows.every((x) => !('user_id' in x)));
    const misses = (await ctx.api.get('/api/admin/assistant/misses').set(admin.auth).expect(200)).body;
    assert.equal(misses[0].query, 'xylophone quantique');
    assert.equal(misses[0].count, 2);
    assert.equal((await ctx.api.get('/api/admin/assistant/misses').set(user.auth)).status, 403);
    assert.equal((await ask('')).status, 400);
  });
});

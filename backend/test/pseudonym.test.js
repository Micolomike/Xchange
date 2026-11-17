const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('pseudonyme seul : prénom et nom cachés aux autres', () => {
  let ctx;
  let admin;
  let discret;
  let karim;
  let group;
  let ticket;

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr' });
    admin = await ctx.register('admin', { firstname: 'Swann', email: 'admin@exemple.fr' });
    discret = await ctx.register('lechat', { firstname: 'Jeanne', lastname: 'Dupont', email: 'jeanne@exemple.fr', hideRealName: true });
    karim = await ctx.register('karim', { firstname: 'Karim', email: 'karim@exemple.fr' });
    group = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Voisins', members: [discret.user.id, karim.user.id] })).body;
    ticket = await ctx.createTicket(discret, { title: 'Volet bloqué', assigned_group: group.id });
    await ctx.api.post(`/api/tickets/${ticket.id}/comments`).set(discret.auth).send({ body: 'Merci !' }).expect(201);
  });
  after(() => ctx.cleanup());

  test('choisi à l’inscription ; la personne voit toujours son vrai nom', async () => {
    assert.equal(discret.user.hide_real_name, true);
    const me = (await ctx.api.get('/api/auth/me').set(discret.auth)).body.user;
    assert.equal(me.firstname, 'Jeanne');
    assert.equal(me.name, 'Jeanne Dupont');
  });

  test('les autres ne voient que le pseudonyme : demande, messages, historique, groupe', async () => {
    const seen = (await ctx.api.get(`/api/tickets/${ticket.id}`).set(karim.auth).expect(200)).body;
    const json = JSON.stringify(seen);
    assert.ok(!json.includes('Jeanne') && !json.includes('Dupont'), json);
    assert.ok(json.includes('lechat'));
    const list = JSON.stringify((await ctx.api.get('/api/tickets').set(karim.auth)).body);
    assert.ok(!list.includes('Jeanne'));
    const groups = JSON.stringify((await ctx.api.get('/api/groups').set(karim.auth)).body);
    assert.ok(!groups.includes('Jeanne') && !groups.includes('Dupont'));
  });

  test('les e-mails envoyés aux autres utilisent le pseudonyme', async () => {
    await ctx.app.locals.notifier.idle();
    const toKarim = ctx.app.locals.mailer.sent.filter((m) => m.to === 'karim@exemple.fr');
    assert.ok(toKarim.length >= 1);
    assert.ok(toKarim.every((m) => !m.text.includes('Jeanne')));
    assert.ok(toKarim.some((m) => m.text.includes('lechat')));
  });

  test('les administrateurs voient le vrai nom dans la gestion des comptes', async () => {
    const users = (await ctx.api.get('/api/users').set(admin.auth)).body;
    const u = users.find((x) => x.username === 'lechat');
    assert.equal(u.firstname, 'Jeanne');
    assert.equal(u.hide_real_name, true);
  });

  test('modifiable dans le profil', async () => {
    assert.equal((await ctx.api.put('/api/auth/me').set(discret.auth).send({ hide_real_name: 'oui' })).status, 400);
    await ctx.api.put('/api/auth/me').set(discret.auth).send({ hide_real_name: false }).expect(200);
    const seen = JSON.stringify((await ctx.api.get(`/api/tickets/${ticket.id}`).set(karim.auth)).body);
    assert.ok(seen.includes('Jeanne'));
    await ctx.api.put('/api/auth/me').set(discret.auth).send({ hide_real_name: true }).expect(200);
    assert.ok(!JSON.stringify((await ctx.api.get(`/api/tickets/${ticket.id}`).set(karim.auth)).body).includes('Jeanne'));
  });
});

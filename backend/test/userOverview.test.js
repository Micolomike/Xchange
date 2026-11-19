const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('fiche d’un compte (administration)', () => {
  let ctx;
  let admin;
  let lea;
  let group;

  before(async () => {
    ctx = await setup({ SEED_CONTENT: 'false', SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr' });
    admin = await ctx.register('admin', { firstname: 'Swann', lastname: 'Magna' });
    lea = await ctx.register('lea', { firstname: 'Léa', lastname: 'Martin', email: 'lea@exemple.fr' });
    group = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Jardinage', members: [lea.user.id] })).body;
  });
  after(() => ctx.cleanup());

  test('réservée aux administrateurs, sans secret', async () => {
    await ctx.api.get(`/api/users/${lea.user.id}/overview`).set(lea.auth).expect(403);
    await ctx.api.get('/api/users/9999/overview').set(admin.auth).expect(404);
    const r = await ctx.api.get(`/api/users/${lea.user.id}/overview`).set(admin.auth).expect(200);
    const text = JSON.stringify(r.body);
    for (const secret of ['password', 'mfa_secret', 'token_hash', 'code_hash']) assert.ok(!text.includes(secret), secret);
    assert.equal(r.body.user.username, 'lea');
    assert.deepEqual(r.body.groups.map((g) => g.name), ['Jardinage']);
  });

  test('notifications : état réel et e-mails reçus', async () => {
    await ctx.api.put('/api/auth/me').set(lea.auth).send({ notify_prefs: { group_new: false } }).expect(200);
    let n = (await ctx.api.get(`/api/users/${lea.user.id}/overview`).set(admin.auth)).body.notifications;
    assert.equal(n.has_email, true);
    assert.equal(n.email_enabled, true);
    assert.equal(n.prefs.find((p) => p.key === 'group_new').on, false);
    assert.ok(!n.prefs.some((p) => p.key === 'admin')); // choix réservé aux administrateurs
    await ctx.api.put('/api/auth/me').set(lea.auth).send({ notify_prefs: { group_new: true } }).expect(200);

    await ctx.createTicket(admin, { title: 'Tondre la pelouse', assigned_group: group.id });
    await ctx.app.locals.notifier.idle();
    n = (await ctx.api.get(`/api/users/${lea.user.id}/overview`).set(admin.auth)).body.notifications;
    assert.equal(n.sent_30d, 1);
    assert.equal(n.recent[0].event_label, 'nouvelle demande pour un groupe');
  });

  test('demandes : une demande confidentielle hors de portée de l’administrateur reste masquée', async () => {
    await ctx.createTicket(lea, { title: 'Secret de Léa', confidential: true });
    await ctx.createTicket(lea, { title: 'Arroser les tomates' });
    const t = (await ctx.api.get(`/api/users/${lea.user.id}/overview`).set(admin.auth)).body.tickets;
    assert.equal(t.created_total, 2);
    assert.ok(t.recent_created.some((x) => x.title === 'Arroser les tomates' && x.id));
    const hidden = t.recent_created.find((x) => x.hidden);
    assert.deepEqual([hidden.title, hidden.id], ['Demande confidentielle', null]);
    assert.ok(!JSON.stringify(t).includes('Secret de Léa'));
  });
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('notifications par e-mail', () => {
  let ctx;
  let admin;
  let mamie;
  let karim;
  let info;
  let mails;

  const settle = async () => ctx.app.locals.notifier.idle();
  const take = async () => {
    await settle();
    const out = mails.splice(0, mails.length);
    return out.map((m) => ({ to: m.to, subject: m.subject, text: m.text }));
  };

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr', MAIL_FROM: 'x.change@orange.fr' });
    mails = ctx.app.locals.mailer.sent;
    admin = await ctx.register('admin', { email: 'admin@exemple.fr', firstname: 'Swann' });
    mamie = await ctx.register('mamie', { email: 'mamie@exemple.fr', firstname: 'Francine' });
    karim = await ctx.register('karim', { email: 'karim@exemple.fr', firstname: 'Karim' });
    info = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Informaticiens', members: [karim.user.id] })).body;
    await ctx.api.put('/api/admin/settings/mail').set(admin.auth).send({ appUrl: 'https://micolomike.exemple.ts.net/' }).expect(200);
    await take();
  });
  after(() => ctx.cleanup());

  test('nouvelle demande pour un groupe, assignation, message et statut', async () => {
    const t = await ctx.createTicket(mamie, { title: 'Wi-Fi lent', assigned_group: info.id });
    let sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['karim@exemple.fr']);
    assert.match(sent[0].subject, /Nouvelle demande pour Informaticiens : #\d{4} Wi-Fi lent/);
    assert.ok(sent[0].text.includes(`https://micolomike.exemple.ts.net/tickets/${t.id}`));

    await ctx.api.patch(`/api/tickets/${t.id}`).set(karim.auth).send({ assigned_to: karim.user.id, status: 'in_progress' }).expect(200);
    sent = await take();
    // Karim s'assigne lui-même : seule Francine est prévenue (changement de statut).
    assert.deepEqual(sent.map((m) => m.to), ['mamie@exemple.fr']);
    assert.match(sent[0].subject, /En cours/);

    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(karim.auth).send({ body: 'Redémarre la box' }).expect(201);
    sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['mamie@exemple.fr']);
    assert.ok(sent[0].text.includes('Redémarre la box'));

    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(mamie.auth).send({ body: 'Merci, ça marche' }).expect(201);
    sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['karim@exemple.fr']);
  });

  test('demande confidentielle : ni titre ni contenu dans l’e-mail', async () => {
    const t = await ctx.createTicket(mamie, { title: 'Mes impôts 2026', assigned_group: info.id, confidential: true });
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(karim.auth).send({ body: 'Montant : 1 234 €' }).expect(201);
    const sent = await take();
    assert.equal(sent.length, 2);
    for (const m of sent) {
      assert.ok(!m.subject.includes('impôts') && !m.text.includes('impôts'));
      assert.ok(!m.text.includes('1 234'));
    }
  });

  test('préférence : plus d’e-mail quand on se désabonne ; rien sans adresse', async () => {
    await ctx.api.put('/api/auth/me').set(mamie.auth).send({ notify_email: false }).expect(200);
    const t = await ctx.createTicket(mamie, { title: 'Imprimante', assigned_group: info.id });
    await take();
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(karim.auth).send({ body: 'Je regarde' }).expect(201);
    assert.deepEqual(await take(), []);
    assert.equal((await ctx.api.put('/api/auth/me').set(mamie.auth).send({ notify_email: 'non' })).status, 400);
  });

  test('adhésion à un groupe : admins prévenus, puis la personne', async () => {
    await ctx.api.post(`/api/groups/${info.id}/requests`).set(mamie.auth).send({ message: 'Je veux aider' }).expect(201);
    let sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['admin@exemple.fr']);
    assert.ok(sent[0].text.includes('Je veux aider'));
    const pending = (await ctx.api.get('/api/groups/requests').set(admin.auth)).body;
    await ctx.api.post(`/api/groups/requests/${pending[0].id}/approve`).set(admin.auth).expect(200);
    // Francine s'est désabonnée : rien ne part.
    assert.deepEqual(await take(), []);
  });

  test('administration : état, réglages et e-mail de test', async () => {
    const info2 = await ctx.api.get('/api/admin/settings/mail').set(admin.auth);
    assert.equal(info2.body.configured, true);
    assert.equal(info2.body.from, 'x.change@orange.fr');
    assert.equal((await ctx.api.put('/api/admin/settings/mail').set(admin.auth).send({ appUrl: 'pas une adresse' })).status, 400);
    await ctx.api.post('/api/admin/settings/mail/test').set(admin.auth).expect(200);
    const sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['admin@exemple.fr']);

    await ctx.api.put('/api/admin/settings/mail').set(admin.auth).send({ enabled: false }).expect(200);
    await ctx.api.post(`/api/groups/${info.id}/leave`).set(karim.auth).expect(200);
    const t = await ctx.createTicket(karim, { title: 'x' });
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(admin.auth).send({ body: 'y' }).expect(201);
    assert.deepEqual(await take(), []);
  });
});

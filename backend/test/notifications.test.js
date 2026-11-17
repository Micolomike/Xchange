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
    return out.map((m) => ({ to: m.to, subject: m.subject, text: m.text, from: m.from }));
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

  test('préférences fines : chacun choisit ce qu’il reçoit', async () => {
    await ctx.api.put('/api/auth/me').set(mamie.auth).send({ notify_email: true }).expect(200);
    const me = await ctx.api.put('/api/auth/me').set(karim.auth).send({ notify_prefs: { group_new: false } }).expect(200);
    assert.equal(me.body.user.notify_prefs.group_new, false);
    assert.equal(me.body.user.notify_prefs.mine, true);
    assert.equal((await ctx.api.put('/api/auth/me').set(karim.auth).send({ notify_prefs: { inconnu: true } })).status, 400);
    const t = await ctx.createTicket(mamie, { title: 'Scanner', assigned_group: info.id });
    assert.deepEqual(await take(), []); // Karim ne veut plus les nouvelles demandes de groupe
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(mamie.auth).send({ body: 'Urgent' }).expect(201);
    assert.deepEqual((await take()).map((m) => m.to), ['karim@exemple.fr']); // mais garde les messages
    await ctx.api.put('/api/auth/me').set(karim.auth).send({ notify_prefs: { group_new: true } }).expect(200);
  });

  test('réglages de l’administrateur : événements, statuts, contenu, expéditeur', async () => {
    const put = (body) => ctx.api.put('/api/admin/settings/mail').set(admin.auth).send(body).expect(200);
    await put({ events: { ticket_created: false }, statuses: ['resolved'], includeContent: false, subjectPrefix: '[Entraide]', senderName: 'Xchange Entraide', footer: 'Association des voisins' });
    const t = await ctx.createTicket(mamie, { title: 'Box Internet', assigned_group: info.id });
    assert.deepEqual(await take(), []);
    await ctx.api.patch(`/api/tickets/${t.id}`).set(karim.auth).send({ status: 'in_progress' }).expect(200);
    assert.deepEqual(await take(), []); // « En cours » n'est plus notifié
    await ctx.api.patch(`/api/tickets/${t.id}`).set(karim.auth).send({ status: 'resolved' }).expect(200);
    const sent = await take();
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^\[Entraide\] #\d{4} : Résolu$/);
    assert.ok(!sent[0].text.includes('Box Internet'));
    assert.ok(sent[0].text.includes('Association des voisins'));
    assert.equal(sent[0].from, '"Xchange Entraide" <x.change@orange.fr>');
    const bad = await ctx.api.put('/api/admin/settings/mail').set(admin.auth).send({ statuses: ['nimporte'] });
    assert.equal(bad.status, 400);
    await put({ events: { ticket_created: true }, statuses: ['open', 'in_progress', 'resolved', 'closed'], includeContent: true, subjectPrefix: '[Xchange]', footer: '' });
  });

  test('journal des envois, aperçu et statistiques', async () => {
    const log = (await ctx.api.get('/api/admin/settings/mail/log').set(admin.auth).expect(200)).body;
    assert.ok(log.length > 5);
    assert.ok(log.every((l) => l.status === 'sent' && l.to_email && l.event));
    assert.equal(log[0].event, 'status_changed');
    assert.equal(log[0].user, 'Francine');
    const preview = (await ctx.api.post('/api/admin/settings/mail/preview').set(admin.auth).send({ event: 'comment' }).expect(200)).body;
    assert.match(preview.subject, /Nouveau message/);
    assert.ok(preview.html.includes('Bonjour Swann'));
    assert.equal((await ctx.api.post('/api/admin/settings/mail/preview').set(admin.auth).send({ event: 'x' })).status, 400);
    const info = (await ctx.api.get('/api/admin/settings/mail').set(admin.auth)).body;
    assert.ok(info.stats.sent7d >= log.length);
    assert.equal(info.settings.events.comment, true);
    assert.equal(info.people.noEmail, 0);
    assert.equal((await ctx.api.get('/api/admin/settings/mail/log').set(mamie.auth)).status, 403);
  });

  test('administration : état, réglages et e-mail de test', async () => {
    const info2 = await ctx.api.get('/api/admin/settings/mail').set(admin.auth);
    assert.equal(info2.body.configured, true);
    assert.equal(info2.body.from, 'x.change@orange.fr');
    assert.equal((await ctx.api.put('/api/admin/settings/mail').set(admin.auth).send({ appUrl: 'pas une adresse' })).status, 400);
    await ctx.api.post('/api/admin/settings/mail/test').set(admin.auth).expect(200);
    let sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['admin@exemple.fr']);
    const other = await ctx.api.post('/api/admin/settings/mail/test').set(admin.auth).send({ to: 'autre@exemple.fr' }).expect(200);
    assert.equal(other.body.to, 'autre@exemple.fr');
    sent = await take();
    assert.deepEqual(sent.map((m) => m.to), ['autre@exemple.fr']);
    assert.equal((await ctx.api.post('/api/admin/settings/mail/test').set(admin.auth).send({ to: 'pas-une-adresse' })).status, 400);

    await ctx.api.put('/api/admin/settings/mail').set(admin.auth).send({ enabled: false }).expect(200);
    await ctx.api.post(`/api/groups/${info.id}/leave`).set(karim.auth).expect(200);
    const t = await ctx.createTicket(karim, { title: 'x' });
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(admin.auth).send({ body: 'y' }).expect(201);
    assert.deepEqual(await take(), []);
  });
});

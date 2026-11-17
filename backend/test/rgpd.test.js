const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers');
const { runPurge } = require('../src/rgpd');
const { LEGAL_DEFAULTS } = require('../src/legal');

describe('RGPD', () => {
  let ctx;
  let admin;
  let helper;

  before(async () => {
    ctx = await setup();
    admin = await ctx.register('admin', { firstname: 'Swann' });
    helper = await ctx.register('karim', { firstname: 'Karim' });
  });
  after(() => ctx.cleanup());

  const upload = (session, ticketId, name) =>
    ctx.api.post(`/api/tickets/${ticketId}/attachments`).set(session.auth).attach('files', Buffer.from('contenu'), name).expect(201);
  const files = () => fs.readdirSync(ctx.config.uploadsDir);

  test('inscription : la charte doit être acceptée, la date est gardée', async () => {
    const refused = await ctx.api.post('/api/auth/register').send({ username: 'sans', password: 'motdepasse1' });
    assert.equal(refused.status, 400);
    assert.ok(refused.body.details.acceptTerms);
    const ok = await ctx.register('avec');
    assert.ok(ok.user.terms_accepted_at);
    // Réglage coupé : plus de case obligatoire.
    await ctx.api.put('/api/admin/rgpd/settings').set(admin.auth).send({ requireTerms: false }).expect(200);
    await ctx.api.post('/api/auth/register').send({ username: 'libre', password: 'motdepasse1' }).expect(201);
    await ctx.api.put('/api/admin/rgpd/settings').set(admin.auth).send({ requireTerms: true }).expect(200);
  });

  test('pages publiques : textes par défaut, durées remplies, modification et retour au texte d’origine', async () => {
    const pub = (await ctx.api.get('/api/legal').expect(200)).body;
    assert.ok(pub.legalNotice.includes('Éditeur du site'));
    assert.ok(pub.privacyPolicy.includes('après 2 ans sans connexion'));
    assert.ok(pub.privacyPolicy.includes("demandes d'adhésion déjà traitées : 1 an"));
    assert.ok(pub.privacyPolicy.includes('30 jours dans la corbeille'));
    assert.equal(pub.requireTerms, true);

    await ctx.api.put('/api/admin/rgpd/legal').set(admin.auth).send({ legalNotice: '## Éditeur\nSwann' }).expect(200);
    assert.equal((await ctx.api.get('/api/legal')).body.legalNotice, '## Éditeur\nSwann');
    const info = (await ctx.api.put('/api/admin/rgpd/legal').set(admin.auth).send({ legalNotice: LEGAL_DEFAULTS.legalNotice }).expect(200)).body;
    assert.equal(info.legal.legalNotice.custom, false);
    assert.equal((await ctx.api.put('/api/admin/rgpd/legal').set(helper.auth).send({ charter: 'x' })).status, 403);
  });

  test('réglages de conservation validés', async () => {
    const put = (body) => ctx.api.put('/api/admin/rgpd/settings').set(admin.auth).send(body);
    assert.equal((await put({ inactiveMonths: 1 })).status, 400);
    assert.equal((await put({ logMonths: 99 })).status, 400);
    assert.equal((await put({ inactiveMonths: 'beaucoup' })).status, 400);
    const ok = (await put({ inactiveMonths: 36, logMonths: 6 }).expect(200)).body;
    assert.equal(ok.settings.inactiveMonths, 36);
    assert.ok((await ctx.api.get('/api/legal')).body.privacyPolicy.includes('après 3 ans sans connexion'));
    await put({ inactiveMonths: 24, logMonths: 12 }).expect(200);
  });

  test('export : toutes les données de la personne, par l’admin ou par elle-même', async () => {
    const francine = await ctx.register('francine', { firstname: 'Francine', lastname: 'Martin' });
    const t = await ctx.createTicket(francine, { title: 'Ma box', description: 'Ne marche plus' });
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(admin.auth).send({ body: 'Je regarde' }).expect(201);
    await upload(francine, t.id, 'photo.txt');

    const res = await ctx.api.get(`/api/admin/rgpd/users/${francine.user.id}/export`).set(admin.auth).expect(200);
    assert.match(res.headers['content-disposition'], /attachment; filename="xchange-donnees-francine-/);
    const data = res.body;
    assert.equal(data.account.email, 'francine@exemple.fr');
    assert.equal(data.account.password, undefined);
    assert.equal(data.requests[0].title, 'Ma box');
    assert.equal(data.requests[0].messages[0].author, 'Swann');
    assert.equal(data.requests[0].attachments[0].original_name, 'photo.txt');

    const mine = await ctx.api.get('/api/auth/me/export').set(francine.auth).expect(200);
    assert.equal(mine.body.account.username, 'francine');
    assert.equal((await ctx.api.get(`/api/admin/rgpd/users/${admin.user.id}/export`).set(francine.auth)).status, 403);
  });

  test('anonymisation en conservant les demandes', async () => {
    const paul = await ctx.register('paul', { firstname: 'Paul', lastname: 'Durand' });
    const t = await ctx.createTicket(paul, { title: 'Déclaration d’impôts' });
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(paul.auth).send({ body: 'Merci d’avance' }).expect(201);
    await upload(paul, t.id, 'avis.txt');
    const before = files().length;
    const groups = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Fiscalistes', members: [paul.user.id] })).body;
    assert.ok(groups.id);

    assert.equal((await ctx.api.post(`/api/admin/rgpd/users/${paul.user.id}/anonymize`).set(admin.auth).send({ mode: 'n’importe' })).status, 400);
    const r = await ctx.api.post(`/api/admin/rgpd/users/${paul.user.id}/anonymize`).set(admin.auth).send({ mode: 'keep' }).expect(200);
    assert.equal(r.body.attachments, 1);
    assert.equal(files().length, before - 1);

    // Session coupée, connexion impossible, identité effacée.
    assert.equal((await ctx.api.get('/api/auth/me').set(paul.auth)).status, 401);
    assert.equal((await ctx.api.post('/api/auth/login').send({ username: 'paul', password: 'motdepasse1' })).status, 401);
    const row = await ctx.db.get('SELECT * FROM users WHERE id = ?', [paul.user.id]);
    assert.equal(row.email, null);
    assert.equal(row.username, `utilisateur-supprime-${paul.user.id}`);
    assert.ok(row.anonymized_at);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?', [paul.user.id])).n, 0);

    // La demande reste, signée « Utilisateur supprimé ».
    const detail = (await ctx.api.get(`/api/tickets/${t.id}`).set(admin.auth).expect(200)).body;
    assert.equal(detail.title, 'Déclaration d’impôts');
    assert.match(JSON.stringify(detail), /Utilisateur supprimé n°/);
    assert.ok(!JSON.stringify(detail).includes('Durand'));

    // Plus dans la liste des utilisateurs ; compté comme anonymisé.
    const users = (await ctx.api.get('/api/users').set(admin.auth)).body;
    assert.ok(!users.some((u) => u.id === paul.user.id));
    assert.equal((await ctx.api.get('/api/admin/rgpd').set(admin.auth)).body.anonymized, 1);
    assert.equal((await ctx.api.post(`/api/admin/rgpd/users/${paul.user.id}/anonymize`).set(admin.auth).send({ mode: 'keep' })).status, 400);
  });

  test('anonymisation en supprimant les demandes et messages', async () => {
    const lea = await ctx.register('lea', { firstname: 'Léa' });
    const own = await ctx.createTicket(lea, { title: 'Ma demande' });
    await upload(lea, own.id, 'piece.txt');
    const g = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Voisins', members: [lea.user.id, helper.user.id] })).body;
    const other = await ctx.createTicket(helper, { title: 'Demande de Karim', assigned_group: g.id });
    await ctx.api.post(`/api/tickets/${other.id}/comments`).set(lea.auth).send({ body: 'Mon avis' }).expect(201);
    const before = files().length;

    const r = (await ctx.api.post(`/api/admin/rgpd/users/${lea.user.id}/anonymize`).set(admin.auth).send({ mode: 'delete' }).expect(200)).body;
    assert.equal(r.tickets, 1);
    assert.equal(r.comments, 1);
    assert.equal(files().length, before - 1);
    assert.equal((await ctx.api.get(`/api/tickets/${own.id}`).set(admin.auth)).status, 404);
    const kept = (await ctx.api.get(`/api/tickets/${other.id}`).set(admin.auth).expect(200)).body;
    assert.ok(!JSON.stringify(kept).includes('Mon avis'));
  });

  test('garde-fous : soi-même et dernier administrateur', async () => {
    assert.equal((await ctx.api.post(`/api/admin/rgpd/users/${admin.user.id}/anonymize`).set(admin.auth).send({ mode: 'keep' })).status, 400);
    assert.equal((await ctx.api.post(`/api/admin/rgpd/users/99999/anonymize`).set(admin.auth).send({ mode: 'keep' })).status, 404);
  });

  test('demandes RGPD : formulaire, suivi, traitement par anonymisation ou réponse', async () => {
    const zoe = await ctx.register('zoe', { firstname: 'Zoé' });
    const post = (body) => ctx.api.post('/api/auth/me/rgpd-requests').set(zoe.auth).send(body);
    assert.equal((await post({ type: 'nimporte' })).status, 400);
    assert.equal((await post({ type: 'rectify' })).status, 400); // message obligatoire
    const rect = (await post({ type: 'rectify', message: 'Mon nom est mal écrit' }).expect(201)).body;
    assert.equal((await post({ type: 'rectify', message: 'encore' })).status, 409);
    const anon = (await post({ type: 'anonymize' }).expect(201)).body;
    assert.ok(anon.due_at > anon.created_at);

    let list = (await ctx.api.get('/api/admin/rgpd/requests').set(admin.auth).expect(200)).body;
    assert.equal(list.filter((r) => r.status === 'pending').length, 2);
    assert.equal(list[0].user.name, 'Zoé');
    assert.equal((await ctx.api.get('/api/admin/rgpd').set(admin.auth)).body.pendingRequests, 2);
    assert.equal((await ctx.api.get('/api/admin/rgpd/requests').set(zoe.auth)).status, 403);

    assert.equal((await ctx.api.post(`/api/admin/rgpd/requests/${rect.id}/close`).set(admin.auth).send({ status: 'rejected' })).status, 400);
    await ctx.api.post(`/api/admin/rgpd/requests/${rect.id}/close`).set(admin.auth).send({ status: 'done', response: 'Corrigé.' }).expect(200);
    const mine = (await ctx.api.get('/api/auth/me/rgpd-requests').set(zoe.auth).expect(200)).body;
    assert.equal(mine.find((r) => r.id === rect.id).response, 'Corrigé.');
    assert.equal((await ctx.api.get('/api/auth/me/export').set(zoe.auth)).body.data_requests.length, 2);

    await ctx.api.post(`/api/admin/rgpd/users/${zoe.user.id}/anonymize`).set(admin.auth).send({ mode: 'keep', requestId: anon.id }).expect(200);
    list = (await ctx.api.get('/api/admin/rgpd/requests').set(admin.auth)).body;
    const closed = list.find((r) => r.id === anon.id);
    assert.equal(closed.status, 'done');
    assert.equal(closed.handled_by, 'Swann');
    assert.equal(closed.user.anonymized, true);
    assert.ok(!JSON.stringify(closed).includes('Zoé'));
  });

  test('purge : comptes inactifs anonymisés, vieux journaux supprimés, admins épargnés', async () => {
    const old = await ctx.register('ancien');
    const recent = await ctx.register('recent');
    const longAgo = new Date(Date.now() - 30 * 31 * 86400_000).toISOString();
    await ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id IN (?, ?)', [longAgo, old.user.id, admin.user.id]);
    await ctx.db.run(
      "INSERT INTO mail_log (created_at, event, user_id, to_email, subject, status) VALUES (?, 'test', NULL, 'x@exemple.fr', 'vieux', 'sent'), (?, 'test', NULL, 'x@exemple.fr', 'récent', 'sent')",
      [longAgo, new Date().toISOString()]
    );

    // Corbeille : une demande supprimée il y a 40 jours est effacée, une récente reste.
    const trashed = await ctx.createTicket(recent, { title: 'Vieille demande' });
    const recentTrash = await ctx.createTicket(recent, { title: 'Demande récente' });
    await ctx.db.run('UPDATE tickets SET deleted_at = ? WHERE id = ?', [new Date(Date.now() - 40 * 86400_000).toISOString(), trashed.id]);
    await ctx.db.run('UPDATE tickets SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), recentTrash.id]);
    assert.equal((await ctx.api.put('/api/admin/rgpd/settings').set(admin.auth).send({ trashDays: 999 })).status, 400);

    const info = (await ctx.api.get('/api/admin/rgpd').set(admin.auth)).body;
    assert.equal(info.candidates.trash, 1);
    assert.deepEqual(info.candidates.inactive.map((u) => u.id), [old.user.id]);
    assert.equal(info.candidates.logs.mail, 1);

    const done = await runPurge(ctx.db, ctx.config, { logger: { info() {}, error() {} } });
    assert.deepEqual(done, { accounts: 1, mail: 1, impersonations: 0, groupRequests: 0, trash: 1 });
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM tickets WHERE id = ?', [trashed.id])).n, 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM tickets WHERE id = ?', [recentTrash.id])).n, 1);
    assert.ok((await ctx.db.get('SELECT anonymized_at FROM users WHERE id = ?', [old.user.id])).anonymized_at);
    assert.equal((await ctx.db.get('SELECT anonymized_at FROM users WHERE id = ?', [recent.user.id])).anonymized_at, null);
    assert.equal((await ctx.db.get('SELECT anonymized_at FROM users WHERE id = ?', [admin.user.id])).anonymized_at, null);
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM mail_log WHERE subject = 'récent'")).n, 1);
    assert.ok((await ctx.api.get('/api/admin/rgpd').set(admin.auth)).body.state.lastRunAt);

    // 0 mois : purge désactivée.
    await ctx.api.put('/api/admin/rgpd/settings').set(admin.auth).send({ inactiveMonths: 0 }).expect(200);
    await ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [longAgo, recent.user.id]);
    assert.equal((await runPurge(ctx.db, ctx.config, { logger: { info() {}, error() {} } })).accounts, 0);
  });

  test('une connexion met à jour la dernière activité', async () => {
    const u = await ctx.register('actif');
    await ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', u.user.id]);
    await ctx.api.get('/api/auth/me').set(u.auth).expect(200);
    const row = await ctx.db.get('SELECT last_seen_at FROM users WHERE id = ?', [u.user.id]);
    assert.ok(row.last_seen_at > '2026');
  });
});

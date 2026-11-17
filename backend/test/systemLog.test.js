const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { runPurge } = require('../src/rgpd');

describe('journal système', () => {
  let ctx;
  let admin;
  let anna;

  before(async () => {
    ctx = await setup({ SEED_CONTENT: 'false' });
    admin = await ctx.register('admin', { firstname: 'Swann', lastname: 'Magna' });
    anna = await ctx.register('anna', { firstname: 'Anna' });
  });
  after(() => ctx.cleanup());

  const quiet = { console: { log() {}, info() {}, warn() {}, error() {} } };

  test('les actions d’administration sont tracées avec leur auteur, sans nom ni adresse', async () => {
    await ctx.api.patch(`/api/users/${anna.user.id}`).set(admin.auth).send({ firstname: 'Annie' }).expect(200);
    await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Jardiniers' }).expect(201);
    // Une requête refusée n'est pas tracée.
    await ctx.api.patch(`/api/users/${admin.user.id}`).set(anna.auth).send({ role: 'user' }).expect(403);
    const log = (await ctx.api.get('/api/admin/system-log?source=administration').set(admin.auth).expect(200)).body;
    assert.deepEqual(
      log.items.map((i) => i.message),
      ['Groupe créé', `Compte n°${anna.user.id} modifié (rôle, droits ou état)`]
    );
    assert.equal(log.items[0].actor, 'Swann Magna');
    assert.equal(log.items[0].sourceLabel, 'Administration');
    await ctx.api.get('/api/admin/system-log').set(anna.auth).expect(403);
  });

  test('erreurs des tâches et du serveur, filtres, pagination, export', async () => {
    const syslog = ctx.app.locals.syslog;
    const { createSystemLog } = require('../src/systemLog');
    const own = createSystemLog({ db: ctx.db, ...quiet });
    await own.for('sauvegarde').error('ÉCHEC de la sauvegarde : disque plein');
    await own.for('serveur').error(new Error('boum'));
    await own.for('sla').warn('Seuil proche');
    assert.ok(syslog);
    const errors = (await ctx.api.get('/api/admin/system-log?level=error').set(admin.auth)).body;
    assert.deepEqual(errors.items.map((i) => i.message), ['boum', 'ÉCHEC de la sauvegarde : disque plein']);
    assert.match(errors.items[0].details, /Error: boum/);
    assert.equal(errors.last24h.error, 2);
    assert.equal(errors.last24h.warn, 1);
    assert.ok(errors.sources.some((s) => s.key === 'sauvegarde'));
    const search = (await ctx.api.get('/api/admin/system-log?q=disque').set(admin.auth)).body;
    assert.equal(search.items.length, 1);
    const page1 = (await ctx.api.get('/api/admin/system-log?limit=2').set(admin.auth)).body;
    assert.equal(page1.items.length, 2);
    assert.equal(page1.more, true);
    const page2 = (await ctx.api.get(`/api/admin/system-log?limit=2&before=${page1.items[1].id}`).set(admin.auth)).body;
    assert.ok(page2.items[0].id < page1.items[1].id);
    const csv = await ctx.api.get('/api/admin/system-log/csv?level=error').set(admin.auth).expect(200);
    assert.match(csv.text, /Date;Niveau;Source;Message;Compte concerné;Par;Détails/);
    assert.match(csv.text, /Erreur;Sauvegardes;ÉCHEC de la sauvegarde : disque plein/);
  });

  test('activité des comptes : connexions, profil, demandes, filtre par compte, export', async () => {
    await ctx.api.post('/api/auth/login').send({ username: 'anna', password: 'mauvais-mot' }).expect(401);
    await ctx.api.post('/api/auth/login').send({ username: 'personne', password: 'mauvais-mot' }).expect(401);
    await ctx.api.put('/api/auth/me').set(anna.auth).send({ lastname: 'Durand' }).expect(200);
    const ticket = await ctx.createTicket(anna);
    await ctx.api.delete(`/api/tickets/${ticket.id}`).set(admin.auth).expect(200);
    const created = (await ctx.api.post('/api/users').set(admin.auth).send({ username: 'bruno', password: 'motdepasse1', email: 'bruno@exemple.fr', role: 'user' }).expect(201)).body;

    const log = (await ctx.api.get('/api/admin/system-log?source=utilisateurs&limit=500').set(admin.auth).expect(200)).body;
    const messages = log.items.map((i) => i.message);
    assert.ok(messages.some((m) => /^Échec de connexion : mot de passe incorrect/.test(m)));
    assert.ok(messages.some((m) => /^Échec de connexion : identifiant inconnu/.test(m)));
    // Ni l'identifiant tapé ni le mot de passe ne sont écrits.
    assert.ok(!JSON.stringify(log.items).includes('personne'));
    assert.ok(!JSON.stringify(log.items).includes('mauvais-mot'));
    assert.ok(messages.includes('Profil modifié : nom'), messages.join(' | '));
    assert.ok(!JSON.stringify(log.items).includes('Durand') || log.items.every((i) => !i.message.includes('Durand')));
    assert.ok(messages.includes(`Demande n°${ticket.id} créée`));
    assert.ok(messages.includes(`Demande n°${ticket.id} mise à la corbeille`));
    const byAdmin = log.items.find((i) => i.message.startsWith('Compte créé par un administrateur'));
    assert.equal(byAdmin.subjectId, created.id);
    assert.equal(byAdmin.actor, 'Swann Magna');

    // Filtre sur un compte : ce qui le concerne ou ce qu'il a fait, y compris les actions d'administration.
    const mine = (await ctx.api.get(`/api/admin/system-log?user=${anna.user.id}&limit=500`).set(admin.auth).expect(200)).body;
    assert.equal(mine.user.name, 'Annie Durand');
    assert.ok(mine.items.length > 0);
    assert.ok(mine.items.every((i) => i.subjectId === anna.user.id || i.actor === 'Annie Durand'));
    assert.ok(mine.items.some((i) => i.source === 'administration' && i.subject === 'Annie Durand'));
    const csv = await ctx.api.get(`/api/admin/system-log/csv?user=${anna.user.id}`).set(admin.auth).expect(200);
    assert.match(csv.text, /Date;Niveau;Source;Message;Compte concerné;Par;Détails/);

    // L'export RGPD de la personne contient son activité.
    const exp = (await ctx.api.get('/api/auth/me/export').set(anna.auth).expect(200)).body;
    assert.ok(exp.account_activity.some((a) => a.message === 'Profil modifié : nom' && a.by === 'vous-même'));
    assert.ok(exp.account_activity.some((a) => a.by === 'un administrateur'));
  });

  test('purge avec les journaux', async () => {
    const old = new Date(Date.now() - 400 * 86400_000).toISOString();
    await ctx.db.run("INSERT INTO system_logs (level, source, message, created_at) VALUES ('info', 'serveur', 'Très ancien', ?)", [old]);
    const done = await runPurge(ctx.db, ctx.config, { logger: { info() {}, error() {} } });
    assert.ok(done.systemLogs >= 1);
    assert.equal(await ctx.db.get("SELECT id FROM system_logs WHERE message = 'Très ancien'"), undefined);
  });
});

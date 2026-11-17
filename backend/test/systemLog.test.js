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
    assert.match(csv.text, /Date;Niveau;Source;Message;Par;Détails/);
    assert.match(csv.text, /Erreur;Sauvegardes;ÉCHEC de la sauvegarde : disque plein/);
  });

  test('purge avec les journaux', async () => {
    const old = new Date(Date.now() - 400 * 86400_000).toISOString();
    await ctx.db.run("INSERT INTO system_logs (level, source, message, created_at) VALUES ('info', 'serveur', 'Très ancien', ?)", [old]);
    const done = await runPurge(ctx.db, ctx.config, { logger: { info() {}, error() {} } });
    assert.ok(done.systemLogs >= 1);
    assert.equal(await ctx.db.get("SELECT id FROM system_logs WHERE message = 'Très ancien'"), undefined);
  });
});

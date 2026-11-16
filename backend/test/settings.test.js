const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { lastSlot, runBackup } = require('../src/backupScheduler');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe("paramètres de l'administration", () => {
  let ctx;
  let admin;
  let alice;
  let copyDir;

  before(async () => {
    ctx = await setup({}, { prepare: (config) => Object.assign(config, { backupDir: path.join(config.dataDir, '..', `sauv-${Date.now()}`) }) });
    admin = await ctx.register('admin');
    alice = await ctx.register('alice');
    copyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xchange-copie-'));
  });
  after(() => {
    fs.rmSync(copyDir, { recursive: true, force: true });
    if (ctx.config.backupDir) fs.rmSync(ctx.config.backupDir, { recursive: true, force: true });
    return ctx.cleanup();
  });

  test('les paramètres publics sont lisibles sans connexion ; leur modification est réservée aux admins', async () => {
    const pub = await ctx.api.get('/api/settings');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.appName, 'Xchange');
    assert.deepEqual(pub.body.categories.map((c) => c.key), ['bug', 'feature', 'support']);
    assert.equal(pub.body.priorities.high.label, 'Haute');
    assert.equal((await ctx.api.put('/api/admin/settings/lists').set(alice.auth).send({})).status, 403);
  });

  test('catégories : ajout, renommage, désactivation ; une catégorie inactive est refusée pour un nouveau ticket', async () => {
    const used = await ctx.createTicket(alice, { category: 'bug' });
    const res = await ctx.api
      .put('/api/admin/settings/lists')
      .set(admin.auth)
      .send({
        categories: [
          { key: 'bug', label: 'Anomalie', active: false },
          { key: 'support', label: 'Support' },
          { label: 'Matériel' },
          { label: 'Accès réseau' },
        ],
      });
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.categories.map((c) => [c.key, c.label, c.active]),
      [
        ['bug', 'Anomalie', false],
        ['support', 'Support', true],
        ['materiel', 'Matériel', true],
        ['acces_reseau', 'Accès réseau', true],
        ['feature', 'Fonctionnalité', false],
      ]
    );
    // L'éditeur ne montre plus la catégorie retirée.
    const editor = await ctx.api.get('/api/admin/settings').set(admin.auth);
    assert.ok(!editor.body.categories.some((c) => c.key === 'feature'));

    const refused = await ctx.api
      .post('/api/tickets')
      .set(alice.auth)
      .send({ title: 'x', description: 'y', priority: 'low', category: 'bug' });
    assert.equal(refused.status, 400);
    const ok = await ctx.createTicket(alice, { category: 'materiel' });
    assert.equal(ok.category, 'materiel');
    // Un ancien ticket garde sa catégorie désactivée et reste modifiable.
    const edit = await ctx.api.patch(`/api/tickets/${used.id}`).set(alice.auth).send({ category: 'bug', title: 'Nouveau titre' });
    assert.equal(edit.status, 200);

    const dup = await ctx.api.put('/api/admin/settings/lists').set(admin.auth).send({ categories: [{ label: 'A' }, { label: 'a' }] });
    assert.equal(dup.status, 400);
  });

  test('priorités : noms, couleurs et délai par défaut appliqué aux nouveaux tickets', async () => {
    const res = await ctx.api
      .put('/api/admin/settings/lists')
      .set(admin.auth)
      .send({
        priorities: {
          high: { label: 'Urgente', color: 'purple', days: 1 },
          medium: { label: 'Normale', color: 'blue', days: 5 },
          low: { label: 'Quand possible', color: 'gray', days: null },
        },
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.priorities.high.label, 'Urgente');

    const t = await ctx.createTicket(alice, { priority: 'high' });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.ok([tomorrow, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)].includes(t.due_date));
    const chosen = await ctx.createTicket(alice, { priority: 'high', due_date: '2031-01-01' });
    assert.equal(chosen.due_date, '2031-01-01');
    assert.equal((await ctx.createTicket(alice, { priority: 'low' })).due_date, null);

    const bad = await ctx.api
      .put('/api/admin/settings/lists')
      .set(admin.auth)
      .send({ priorities: { high: { label: 'A', color: 'jaune' }, medium: { label: 'B', color: 'red' }, low: { label: 'C', color: 'red' } } });
    assert.equal(bad.status, 400);
  });

  test('apparence : nom, couleur lisible, accueil et logo', async () => {
    const tooLight = await ctx.api.put('/api/admin/settings/appearance').set(admin.auth).send({ primaryColor: '#ffd700' });
    assert.equal(tooLight.status, 400);
    const res = await ctx.api
      .put('/api/admin/settings/appearance')
      .set(admin.auth)
      .send({ appName: 'Helpdesk Magna', primaryColor: '#0B6E4F', homeTitle: 'Le support de la famille', homeText: 'Une demande ?' });
    assert.equal(res.status, 200);
    assert.equal(res.body.appName, 'Helpdesk Magna');
    assert.equal(res.body.primaryColor, '#0b6e4f');

    const fake = await ctx.api.post('/api/admin/settings/logo').set(admin.auth).attach('logo', Buffer.from('<svg/>'), 'logo.svg');
    assert.equal(fake.status, 400);
    const up = await ctx.api.post('/api/admin/settings/logo').set(admin.auth).attach('logo', PNG, 'logo.png');
    assert.equal(up.status, 200);
    assert.match(up.body.logoUrl, /^\/api\/settings\/logo\?v=\d+$/);
    const img = await ctx.api.get(up.body.logoUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');

    await ctx.api.delete('/api/admin/settings/logo').set(admin.auth).expect(200);
    assert.equal((await ctx.api.get('/api/settings')).body.logoUrl, null);
  });

  test('sauvegarde automatique : réglages, copie vers un autre dossier et rotation', async () => {
    const bad = await ctx.api.put('/api/admin/backup/schedule').set(admin.auth).send({ time: '25:00', keep: 0 });
    assert.equal(bad.status, 400);
    const inside = await ctx.api.put('/api/admin/backup/schedule').set(admin.auth).send({ copyDir: ctx.config.dataDir });
    assert.equal(inside.status, 400);
    const relative = await ctx.api.put('/api/admin/backup/schedule').set(admin.auth).send({ copyDir: 'sauvegardes' });
    assert.equal(relative.status, 400);

    const test = await ctx.api.post('/api/admin/backup/test-dir').set(admin.auth).send({ dir: path.join(copyDir, 'Xchange') });
    assert.deepEqual(test.body.ok, true);

    const res = await ctx.api
      .put('/api/admin/backup/schedule')
      .set(admin.auth)
      .send({ time: '02:15', keep: 2, copyDir: path.join(copyDir, 'Xchange') });
    assert.equal(res.status, 200);
    assert.equal(res.body.available, true);
    assert.ok(res.body.nextRun);

    for (let i = 0; i < 3; i += 1) {
      await runBackup({ db: ctx.db, config: ctx.config, logger: { info() {}, error() {} }, now: new Date(2026, 0, 10 + i, 2, 15) });
    }
    const local = fs.readdirSync(ctx.config.backupDir).filter((n) => n.endsWith('.db'));
    const zips = fs.readdirSync(path.join(copyDir, 'Xchange')).filter((n) => n.endsWith('.zip'));
    assert.equal(local.length, 2);
    assert.deepEqual(zips.sort(), ['xchange_2026-01-11_021500.zip', 'xchange_2026-01-12_021500.zip']);

    const run = await ctx.api.post('/api/admin/backup/run').set(admin.auth);
    assert.equal(run.body.state.lastStatus, 'ok');
    assert.equal(run.body.state.copyStatus, 'ok');
  });

  test('créneau de sauvegarde : aujourd’hui si l’heure est passée, sinon hier', () => {
    const at = (h, m) => new Date(2026, 10, 16, h, m);
    assert.equal(lastSlot('03:30', at(10, 0)).getTime(), at(3, 30).getTime());
    assert.equal(lastSlot('03:30', at(2, 0)).getTime(), new Date(2026, 10, 15, 3, 30).getTime());
  });
});

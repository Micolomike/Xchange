const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { backup } = require('../scripts/sauvegarde');

describe('mode PC : site servi par l’API', () => {
  let ctx;
  before(async () => {
    ctx = await setup(
      { SERVE_FRONTEND: 'true' },
      {
        prepare: async (config) => {
          // Un faux build du frontend, à l'emplacement configuré.
          config.frontendDir = path.join(config.dataDir, 'dist');
          fs.mkdirSync(path.join(config.frontendDir, 'assets'), { recursive: true });
          fs.writeFileSync(path.join(config.frontendDir, 'index.html'), '<!doctype html><title>Xchange</title>');
          fs.writeFileSync(path.join(config.frontendDir, 'assets', 'app-123.js'), 'console.log(1)');
        },
      }
    );
  });
  after(() => ctx.cleanup());

  test('la racine et les routes de l’application renvoient index.html', async () => {
    for (const url of ['/', '/tickets/12', '/admin?tab=trash']) {
      const res = await ctx.api.get(url);
      assert.equal(res.status, 200, url);
      assert.match(res.text, /<title>Xchange<\/title>/);
      assert.equal(res.headers['cache-control'], 'no-cache');
    }
  });

  test('les fichiers compilés sont servis avec un cache long', async () => {
    const res = await ctx.api.get('/assets/app-123.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /immutable/);
  });

  test('un fichier absent reste une 404 et l’API garde ses réponses JSON', async () => {
    assert.equal((await ctx.api.get('/assets/inconnu.js')).status, 404);
    const api = await ctx.api.get('/api/inexistant');
    assert.equal(api.status, 404);
    assert.equal(api.body.error, 'Route inconnue.');
    assert.equal((await ctx.api.get('/api/health')).body.status, 'ok');
  });

  test('la politique de sécurité du contenu ne force pas le HTTPS (accès local)', async () => {
    const csp = (await ctx.api.get('/')).headers['content-security-policy'];
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(!csp.includes('upgrade-insecure-requests'));
  });
});

describe('verrouillage après échecs de connexion', () => {
  let ctx;
  before(async () => {
    ctx = await setup({ LOGIN_MAX_FAILURES: '3', LOGIN_LOCK_MINUTES: '15' });
    await ctx.register('alice');
  });
  after(() => ctx.cleanup());

  test('le compte est bloqué après 3 échecs, même avec le bon mot de passe', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await ctx.api.post('/api/auth/login').send({ username: 'alice', password: 'mauvais-mdp' });
      assert.equal(res.status, 401);
    }
    const locked = await ctx.api.post('/api/auth/login').send({ username: 'ALICE', password: 'motdepasse1' });
    assert.equal(locked.status, 429);
    assert.match(locked.body.error, /Réessayez dans 15 minutes/);
  });

  test('un compte inexistant est bloqué de la même façon (pas d’indice sur son existence)', async () => {
    for (let i = 0; i < 3; i += 1) {
      await ctx.api.post('/api/auth/login').send({ username: 'personne', password: 'x' });
    }
    assert.equal((await ctx.api.post('/api/auth/login').send({ username: 'personne', password: 'x' })).status, 429);
  });

  test('une connexion réussie remet le compteur à zéro', async () => {
    await ctx.register('bruno');
    for (let i = 0; i < 2; i += 1) {
      await ctx.api.post('/api/auth/login').send({ username: 'bruno', password: 'faux' });
    }
    assert.equal((await ctx.api.post('/api/auth/login').send({ username: 'bruno', password: 'motdepasse1' })).status, 200);
    for (let i = 0; i < 2; i += 1) {
      await ctx.api.post('/api/auth/login').send({ username: 'bruno', password: 'faux' });
    }
    assert.equal((await ctx.api.post('/api/auth/login').send({ username: 'bruno', password: 'motdepasse1' })).status, 200);
  });
});

describe('sauvegarde', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.cleanup());

  test('copie cohérente de la base, fichiers joints et rotation', async () => {
    const admin = await ctx.register('admin');
    const t = await ctx.createTicket(admin, { title: 'À sauvegarder' });
    await ctx.api.post(`/api/tickets/${t.id}/attachments`).set(admin.auth).attach('files', Buffer.from('a'), 'a.txt').expect(201);

    const dest = path.join(ctx.dir, 'sauvegardes');
    for (let i = 0; i < 4; i += 1) {
      await backup({ config: ctx.config, destination: dest, keep: 3, now: new Date(2026, 10, 16, 3, 30, i) });
    }
    const dbs = fs.readdirSync(dest).filter((n) => n.endsWith('.db')).sort();
    assert.deepEqual(dbs, ['xchange_2026-11-16_033001.db', 'xchange_2026-11-16_033002.db', 'xchange_2026-11-16_033003.db']);
    assert.equal(fs.readdirSync(path.join(dest, 'fichiers')).length, 1);

    // La copie s'ouvre et contient le ticket.
    const { Database } = require('../src/db');
    const copy = await Database.open(path.join(dest, dbs.at(-1)));
    const row = await copy.get('SELECT title FROM tickets WHERE id = ?', [t.id]);
    await copy.close();
    assert.equal(row.title, 'À sauvegarder');
  });
});

describe('sauvegarde depuis l’administration', () => {
  const AdmZip = require('adm-zip');
  let ctx;
  let admin;
  let target;
  before(async () => {
    ctx = await setup({}, {
      prepare: async (config) => {
        target = path.join(config.dataDir, 'cle-usb');
        fs.mkdirSync(target);
        config.backupTargets = [target];
      },
    });
    admin = await ctx.register('admin');
    const t = await ctx.createTicket(admin, { title: 'Dans la sauvegarde' });
    await ctx.api.post(`/api/tickets/${t.id}/attachments`).set(admin.auth).attach('files', Buffer.from('contenu'), 'note.txt').expect(201);
  });
  after(() => ctx.cleanup());

  test('réservée aux administrateurs', async () => {
    const user = await ctx.register('user');
    assert.equal((await ctx.api.get('/api/admin/backup/download').set(user.auth)).status, 403);
    assert.equal((await ctx.api.get('/api/admin/backup/destinations').set(user.auth)).status, 403);
  });

  test('téléchargement : un .zip avec la base, les fichiers joints et le mode d’emploi', async () => {
    const res = await ctx.api.get('/api/admin/backup/download').set(admin.auth).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /attachment; filename="xchange_\d{4}-\d{2}-\d{2}_\d{6}\.zip"/);
    const zip = new AdmZip(res.body);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    assert.ok(names.includes('xchange.db'));
    assert.ok(names.includes('LISEZMOI.txt'));
    assert.equal(names.filter((n) => n.startsWith('fichiers/') && !n.endsWith('/')).length, 1);
    const dbFile = path.join(ctx.dir, 'extrait.db');
    fs.writeFileSync(dbFile, zip.getEntry('xchange.db').getData());
    const { Database } = require('../src/db');
    const copy = await Database.open(dbFile);
    assert.equal((await copy.get("SELECT COUNT(*) AS n FROM tickets WHERE title = 'Dans la sauvegarde'")).n, 1);
    await copy.close();
    assert.equal(fs.readdirSync(ctx.dir).filter((n) => n.startsWith('.sauvegarde-')).length, 0, 'fichier temporaire supprimé');
  });

  test('écriture sur un disque proposé, dans un sous-dossier', async () => {
    const list = await ctx.api.get('/api/admin/backup/destinations').set(admin.auth);
    const dest = list.body.destinations.find((d) => d.id === target);
    assert.ok(dest, 'la destination configurée est proposée');
    assert.ok(dest.free > 0);
    const res = await ctx.api.post('/api/admin/backup/write').set(admin.auth).send({ destination: target, folder: 'Mes sauvegardes' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.path.startsWith(path.join(target, 'Mes sauvegardes')));
    assert.ok(fs.statSync(res.body.path).size > 100);
  });

  test('refuse un disque non proposé et les noms de dossier dangereux', async () => {
    assert.equal((await ctx.api.post('/api/admin/backup/write').set(admin.auth).send({ destination: '/etc' })).status, 400);
    for (const folder of ['..', '../ailleurs', 'a/b', 'a\\b', '']) {
      const res = await ctx.api.post('/api/admin/backup/write').set(admin.auth).send({ destination: target, folder });
      assert.equal(res.status, 400, folder);
    }
    assert.ok(!fs.existsSync(path.join(ctx.dir, 'ailleurs')));
  });
});

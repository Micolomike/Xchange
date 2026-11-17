const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { runPurge } = require('../src/rgpd');

describe('comptes inactifs : e-mail d’avertissement un mois avant l’anonymisation', () => {
  let ctx;
  let admin;
  const quiet = { info() {}, error() {} };
  const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();
  const purge = (now = new Date()) => runPurge(ctx.db, ctx.config, { now, logger: quiet, notifier: ctx.app.locals.notifier });
  const anonymized = async (id) => Boolean((await ctx.db.get('SELECT anonymized_at FROM users WHERE id = ?', [id])).anonymized_at);

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr' });
    admin = await ctx.register('admin', { email: 'admin@exemple.fr' });
  });
  after(() => ctx.cleanup());

  test('prévenu, puis anonymisé 30 jours après s’il ne revient pas', async () => {
    const u = await ctx.register('dormeur', { email: 'dormeur@exemple.fr', firstname: 'Jean' });
    // Ni notifications ni rien : l'avertissement part quand même (message de service).
    await ctx.api.put('/api/auth/me').set(u.auth).send({ notify_email: false }).expect(200);
    await ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [daysAgo(24 * 30.5 + 5), u.user.id]);

    const info = (await ctx.api.get('/api/admin/rgpd').set(admin.auth)).body;
    assert.deepEqual(info.candidates.toWarn.map((x) => x.id), [u.user.id]);
    assert.equal(info.candidates.inactive.length, 0);
    assert.equal(info.candidates.toWarn[0].row, undefined);

    const sent = ctx.app.locals.mailer.sent;
    const before1 = sent.length;
    let done = await purge();
    assert.equal(done.warned, 1);
    assert.equal(done.accounts, 0);
    const mail = sent.at(-1);
    assert.equal(sent.length, before1 + 1);
    assert.equal(mail.to, 'dormeur@exemple.fr');
    assert.match(mail.subject, /Votre compte sera anonymisé le \d{1,2} \S+ 20\d\d/);
    assert.ok(mail.text.includes('il suffit de vous connecter'));

    // Le lendemain : pas de second e-mail, pas encore anonymisé.
    done = await purge(new Date(Date.now() + 86400_000));
    assert.equal(done.warned, 0);
    assert.equal(await anonymized(u.user.id), false);

    // 31 jours après l'avertissement : anonymisé.
    done = await purge(new Date(Date.now() + 31 * 86400_000));
    assert.equal(done.accounts, 1);
    assert.equal(await anonymized(u.user.id), true);
  });

  test('revenir après l’avertissement annule l’anonymisation', async () => {
    const u = await ctx.register('revenant', { email: 'revenant@exemple.fr' });
    await ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [daysAgo(24 * 30.5 + 5), u.user.id]);
    assert.equal((await purge()).warned, 1);
    await ctx.api.get('/api/auth/me').set(u.auth).expect(200); // reconnexion
    const done = await purge(new Date(Date.now() + 31 * 86400_000));
    assert.equal(done.accounts, 0);
    assert.equal(await anonymized(u.user.id), false);
  });

  test('sans adresse e-mail : anonymisé à l’échéance, sans avertissement possible', async () => {
    const u = await ctx.register('sansmail', { email: '' });
    await ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [daysAgo(25 * 31), u.user.id]);
    const done = await purge();
    assert.equal(done.warned, 0);
    assert.equal(done.accounts, 1);
  });

  test('aperçu de l’e-mail d’avertissement', async () => {
    const msg = await ctx.app.locals.notifier.inactivityWarning(
      { id: admin.user.id, username: 'admin', email: 'admin@exemple.fr' },
      { lastSeen: daysAgo(700), deadline: new Date(Date.now() + 30 * 86400_000).toISOString() }
    );
    assert.equal(msg, true);
    const log = (await ctx.api.get('/api/admin/settings/mail/log').set(admin.auth)).body;
    assert.equal(log[0].event, 'inactivity_warning');
  });
});

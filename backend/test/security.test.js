const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('double authentification : refus tracé et navigateurs de confiance', () => {
  let ctx;
  let admin;
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

  async function enroll(username) {
    const reg = await ctx.api.post('/api/auth/register').send({ username, password: 'motdepasse1', acceptTerms: true });
    const start = await ctx.api.post('/api/auth/mfa/setup/start').send({ setupToken: reg.body.setupToken });
    const confirm = await ctx.api
      .post('/api/auth/mfa/setup/confirm')
      .send({ setupToken: reg.body.setupToken, code: await ctx.nextCode(username, start.body.secret) });
    assert.equal(confirm.status, 200);
    return { token: confirm.body.token, secret: start.body.secret, user: confirm.body.user };
  }

  before(async () => {
    ctx = await setup({ MFA_REQUIRED: 'true', TRUSTED_DEVICE_DAYS: '30' });
    admin = await enroll('admin');
  });
  after(() => ctx.cleanup());

  test('refus à l’inscription : case obligatoire, session ouverte, choix tracé', async () => {
    const reg = await ctx.api.post('/api/auth/register').send({ username: 'mamie', password: 'motdepasse1', acceptTerms: true });
    assert.equal(reg.body.mfaSetupRequired, true);
    const missing = await ctx.api.post('/api/auth/mfa/decline').send({ setupToken: reg.body.setupToken });
    assert.equal(missing.status, 400);

    const ok = await ctx.api.post('/api/auth/mfa/decline').send({ setupToken: reg.body.setupToken, acknowledge: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.mfa_exempt, true);
    assert.equal(ok.body.user.mfa_exempt_by, 'self');
    assert.ok(ok.body.user.mfa_exempt_at);
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(ok.body.token))).status, 200);

    // Connexion suivante : directement, sans étape de double authentification.
    const login = await ctx.api.post('/api/auth/login').send({ username: 'mamie', password: 'motdepasse1' });
    assert.ok(login.body.token);

    // La trace est visible par la personne, par l'administrateur et dans l'export.
    const sec = (await ctx.api.get('/api/auth/me/security').set(bearer(login.body.token))).body;
    assert.equal(sec.events[0].type, 'mfa_declined');
    assert.equal(sec.events[0].by, 'vous');
    const users = (await ctx.api.get('/api/users').set(bearer(admin.token))).body;
    assert.equal(users.find((u) => u.username === 'mamie').mfa_exempt_by, 'self');
    const exp = (await ctx.api.get('/api/auth/me/export').set(bearer(login.body.token))).body;
    assert.equal(exp.account.double_authentication_declined.by, 'vous-même');
    assert.equal(exp.security_history[0].type, 'mfa_declined');
  });

  test('un administrateur ne peut pas refuser la double authentification', async () => {
    await ctx.api.post('/api/users').set(bearer(admin.token)).send({ username: 'chef', password: 'motdepasse1', role: 'admin' }).expect(201);
    const login = await ctx.api.post('/api/auth/login').send({ username: 'chef', password: 'motdepasse1' });
    const r = await ctx.api.post('/api/auth/mfa/decline').send({ setupToken: login.body.setupToken, acknowledge: true });
    assert.equal(r.status, 403);
  });

  test('activer ensuite la double authentification efface le refus', async () => {
    const login = await ctx.api.post('/api/auth/login').send({ username: 'mamie', password: 'motdepasse1' });
    const start = await ctx.api.post('/api/auth/mfa/setup/start').set(bearer(login.body.token)).send({});
    const ok = await ctx.api
      .post('/api/auth/mfa/setup/confirm')
      .set(bearer(login.body.token))
      .send({ code: await ctx.nextCode('mamie', start.body.secret) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.mfa_exempt, false);
    const sec = (await ctx.api.get('/api/auth/me/security').set(bearer(ok.body.token))).body;
    assert.deepEqual(sec.events.map((e) => e.type), ['mfa_enabled', 'mfa_declined']);
  });

  test('navigateur de confiance : plus de code pendant 30 jours, révocable', async () => {
    const karim = await enroll('karim');
    const first = await ctx.api.post('/api/auth/login').send({ username: 'karim', password: 'motdepasse1' });
    assert.equal(first.body.mfaRequired, true);
    const verified = await ctx.api
      .post('/api/auth/mfa/verify')
      .set('User-Agent', UA)
      .send({ mfaToken: first.body.mfaToken, code: await ctx.nextCode('karim', karim.secret), remember: true });
    assert.equal(verified.status, 200);
    const deviceToken = verified.body.deviceToken;
    assert.match(deviceToken, /^[a-f0-9]{64}$/);
    const days = (new Date(verified.body.deviceExpiresAt) - Date.now()) / 86400_000;
    assert.ok(days > 29.9 && days <= 30);

    // Avec le jeton : session complète directement.
    const again = await ctx.api.post('/api/auth/login').send({ username: 'karim', password: 'motdepasse1', deviceToken });
    assert.equal(again.body.trustedDevice, true);
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(again.body.token))).status, 200);
    // Le jeton d'un autre compte ne sert à rien ; le mot de passe reste exigé.
    assert.equal((await ctx.api.post('/api/auth/login').send({ username: 'admin', password: 'motdepasse1', deviceToken })).body.mfaRequired, true);
    assert.equal((await ctx.api.post('/api/auth/login').send({ username: 'karim', password: 'mauvais', deviceToken })).status, 401);

    const sec = (await ctx.api.get('/api/auth/me/security').set(bearer(again.body.token))).body;
    assert.equal(sec.trustedDeviceDays, 30);
    assert.equal(sec.devices.length, 1);
    assert.equal(sec.devices[0].label, 'Chrome sur Windows');

    // Révocation par la personne.
    await ctx.api.delete('/api/auth/me/devices').set(bearer(again.body.token)).expect(200);
    const after1 = await ctx.api.post('/api/auth/login').send({ username: 'karim', password: 'motdepasse1', deviceToken });
    assert.equal(after1.body.mfaRequired, true);
    assert.equal(after1.body.deviceRejected, true);
  });

  test('changement de mot de passe, réinitialisation et expiration annulent la confiance', async () => {
    const lea = await enroll('lea');
    const trust = async () => {
      const l = await ctx.api.post('/api/auth/login').send({ username: 'lea', password: 'motdepasse1' });
      const v = await ctx.api
        .post('/api/auth/mfa/verify')
        .send({ mfaToken: l.body.mfaToken, code: await ctx.nextCode('lea', lea.secret), remember: true });
      return v.body;
    };
    const loginWith = (deviceToken, password = 'motdepasse1') =>
      ctx.api.post('/api/auth/login').send({ username: 'lea', password, deviceToken });

    // Changement de mot de passe.
    let v = await trust();
    await ctx.api.put('/api/auth/me').set(bearer(v.token)).send({ password: 'nouveaumdp1', currentPassword: 'motdepasse1' }).expect(200);
    assert.equal((await loginWith(v.deviceToken, 'nouveaumdp1')).body.mfaRequired, true);
    await ctx.db.run("UPDATE users SET password = (SELECT password FROM users WHERE username = 'karim') WHERE username = 'lea'");

    // Expiration.
    v = await trust();
    await ctx.db.run('UPDATE trusted_devices SET expires_at = ? WHERE user_id = ?', ['2020-01-01T00:00:00.000Z', lea.user.id]);
    assert.equal((await loginWith(v.deviceToken)).body.mfaRequired, true);

    // Réinitialisation de la double authentification par un administrateur.
    v = await trust();
    await ctx.api.post(`/api/users/${lea.user.id}/reset-mfa`).set(bearer(admin.token)).expect(200);
    const after = await loginWith(v.deviceToken);
    assert.equal(after.body.mfaSetupRequired, true);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?', [lea.user.id])).n, 0);
  });

  test('dispense par un administrateur : tracée comme telle', async () => {
    const u = await enroll('paul');
    await ctx.api.post(`/api/users/${u.user.id}/mfa-exempt`).set(bearer(admin.token)).send({ exempt: true }).expect(200);
    const row = (await ctx.api.get('/api/users').set(bearer(admin.token))).body.find((x) => x.username === 'paul');
    assert.equal(row.mfa_exempt_by, 'admin');
    const login = await ctx.api.post('/api/auth/login').send({ username: 'paul', password: 'motdepasse1' });
    const sec = (await ctx.api.get('/api/auth/me/security').set(bearer(login.body.token))).body;
    assert.equal(sec.events[0].type, 'mfa_exempted');
    assert.notEqual(sec.events[0].by, 'vous');
  });
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup } = require('./helpers');

describe('double authentification (obligatoire)', () => {
  let ctx;
  const secrets = {};
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });

  async function enroll(username) {
    const reg = await ctx.api.post('/api/auth/register').send({ username, password: 'motdepasse1' });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.mfaSetupRequired, true);
    assert.equal(reg.body.token, undefined, 'aucune session avant la double authentification');
    const start = await ctx.api.post('/api/auth/mfa/setup/start').send({ setupToken: reg.body.setupToken });
    assert.equal(start.status, 200);
    secrets[username] = start.body.secret;
    const confirm = await ctx.api
      .post('/api/auth/mfa/setup/confirm')
      .send({ setupToken: reg.body.setupToken, code: await ctx.nextCode(username, start.body.secret) });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    return confirm.body;
  }

  async function login(username) {
    const res = await ctx.api.post('/api/auth/login').send({ username, password: 'motdepasse1' });
    return res.body;
  }

  before(async () => {
    ctx = await setup({ MFA_REQUIRED: 'true', LOGIN_MAX_FAILURES: '4' });
  });
  after(() => ctx.cleanup());

  test('inscription : configuration de l’appli puis session et 10 codes de secours', async () => {
    const reg = await ctx.api.post('/api/auth/register').send({ username: 'admin', password: 'motdepasse1' });
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(reg.body.setupToken))).status, 401);

    const start = await ctx.api.post('/api/auth/mfa/setup/start').send({ setupToken: reg.body.setupToken });
    assert.match(start.body.qr, /^data:image\/png;base64,/);
    assert.match(start.body.otpauthUrl, /^otpauth:\/\/totp\/Xchange%3Aadmin\?secret=[A-Z2-7]+&issuer=Xchange/);
    secrets.admin = start.body.secret;

    const wrong = await ctx.api.post('/api/auth/mfa/setup/confirm').send({ setupToken: reg.body.setupToken, code: '000000' });
    assert.equal(wrong.status, 400);

    const ok = await ctx.api
      .post('/api/auth/mfa/setup/confirm')
      .send({ setupToken: reg.body.setupToken, code: await ctx.nextCode('admin', secrets.admin) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.recoveryCodes.length, 10);
    assert.match(ok.body.recoveryCodes[0], /^[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.equal(ok.body.user.mfa_enabled, true);
    assert.equal(ok.body.user.mfa_secret, undefined);
    secrets.adminCodes = ok.body.recoveryCodes;

    const me = await ctx.api.get('/api/auth/me').set(bearer(ok.body.token));
    assert.equal(me.status, 200);
    assert.equal(me.body.recoveryCodesLeft, 10);
  });

  test('connexion en deux étapes, code faux refusé, code rejoué refusé', async () => {
    const first = await login('admin');
    assert.equal(first.mfaRequired, true);
    assert.equal(first.token, undefined);
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(first.mfaToken))).status, 401, 'le jeton d’étape n’ouvre pas de session');

    assert.equal((await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: first.mfaToken, code: '123456' })).status, 401);
    const code = await ctx.nextCode('admin', secrets.admin);
    const ok = await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: first.mfaToken, code });
    assert.equal(ok.status, 200);
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(ok.body.token))).status, 200);

    const again = await login('admin');
    const replay = await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: again.mfaToken, code });
    assert.equal(replay.status, 401, 'un code déjà utilisé est refusé');
  });

  test('code de secours : accepté une seule fois', async () => {
    const recovery = secrets.adminCodes[0].toUpperCase().replace('-', ' ');
    const a = await login('admin');
    const ok = await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: a.mfaToken, code: recovery });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.usedRecoveryCode, true);
    assert.equal(ok.body.recoveryCodesLeft, 9);
    const b = await login('admin');
    assert.equal((await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: b.mfaToken, code: secrets.adminCodes[0] })).status, 401);
  });

  test('nouveaux codes de secours : exigent un code de l’appli', async () => {
    const a = await login('admin');
    const session = (await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: a.mfaToken, code: secrets.adminCodes[1] })).body.token;
    assert.equal((await ctx.api.post('/api/auth/mfa/recovery-codes').set(bearer(session)).send({ code: '000000' })).status, 400);
    const res = await ctx.api
      .post('/api/auth/mfa/recovery-codes')
      .set(bearer(session))
      .send({ code: await ctx.nextCode('admin', secrets.admin) });
    assert.equal(res.status, 200);
    assert.equal(res.body.recoveryCodes.length, 10);
    const c = await login('admin');
    assert.equal(
      (await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: c.mfaToken, code: secrets.adminCodes[2] })).status,
      401,
      'les anciens codes ne marchent plus'
    );
    secrets.adminCodes = res.body.recoveryCodes;
  });

  test('un jeton de session sans double authentification (ancienne version) est refusé', async () => {
    const forged = jwt.sign({ sub: 1, tv: 0, typ: 'session', mfa: false }, ctx.config.jwtSecret);
    const legacy = jwt.sign({ sub: 1, tv: 0 }, ctx.config.jwtSecret);
    assert.equal((await ctx.api.get('/api/auth/me').set(bearer(forged))).status, 401);
    assert.equal((await ctx.api.get('/api/auth/me').set(bearer(legacy))).status, 401);
  });

  test('un compte créé par un admin configure son appli à la première connexion', async () => {
    const a = await login('admin');
    const admin = (await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: a.mfaToken, code: secrets.adminCodes[0] })).body.token;
    await ctx.api.post('/api/users').set(bearer(admin)).send({ username: 'bob', password: 'motdepasse1' }).expect(201);
    const bob = await login('bob');
    assert.equal(bob.mfaSetupRequired, true);
    secrets.adminSession = admin;
  });

  test('réinitialisation par un admin : sessions fermées, reconfiguration exigée', async () => {
    const carla = await enroll('carla');
    const users = await ctx.api.get('/api/users').set(bearer(secrets.adminSession));
    const row = users.body.find((u) => u.username === 'carla');
    assert.equal(row.mfa_enabled, true);
    await ctx.api.post(`/api/users/${row.id}/reset-mfa`).set(bearer(secrets.adminSession)).expect(200);
    assert.equal((await ctx.api.get('/api/auth/me').set(bearer(carla.token))).status, 401);
    const again = await login('carla');
    assert.equal(again.mfaSetupRequired, true);
    assert.equal((await ctx.api.post(`/api/users/${row.id}/reset-mfa`).set(bearer(carla.token))).status, 401);
  });

  test('dispense par un admin : connexion sans code, puis dispense retirée', async () => {
    const erin = await enroll('erin');
    const users = await ctx.api.get('/api/users').set(bearer(secrets.adminSession));
    const id = users.body.find((u) => u.username === 'erin').id;
    assert.equal((await ctx.api.post(`/api/users/${id}/mfa-exempt`).set(bearer(erin.token)).send({ exempt: true })).status, 403);

    const res = await ctx.api.post(`/api/users/${id}/mfa-exempt`).set(bearer(secrets.adminSession)).send({ exempt: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfa_exempt, true);
    assert.equal(res.body.mfa_enabled, false);
    // Ancienne session fermée ; la nouvelle connexion ne demande pas de code et fonctionne.
    assert.equal((await ctx.api.get('/api/auth/me').set(bearer(erin.token))).status, 401);
    const direct = await login('erin');
    assert.ok(direct.token);
    assert.equal(direct.mfaRequired, undefined);
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(direct.token))).status, 200);

    // Dispense retirée : session fermée et configuration exigée à nouveau.
    await ctx.api.post(`/api/users/${id}/mfa-exempt`).set(bearer(secrets.adminSession)).send({ exempt: false }).expect(200);
    assert.equal((await ctx.api.get('/api/tickets').set(bearer(direct.token))).status, 401);
    assert.equal((await login('erin')).mfaSetupRequired, true);
    const bad = await ctx.api.post(`/api/users/${id}/mfa-exempt`).set(bearer(secrets.adminSession)).send({ exempt: 'oui' });
    assert.equal(bad.status, 400);
  });

  test('trop de codes faux bloquent la vérification', async () => {
    await enroll('dave');
    const a = await login('dave');
    for (let i = 0; i < 4; i += 1) {
      await ctx.api.post('/api/auth/mfa/verify').send({ mfaToken: a.mfaToken, code: '000000' });
    }
    const locked = await ctx.api
      .post('/api/auth/mfa/verify')
      .send({ mfaToken: a.mfaToken, code: await ctx.nextCode('dave', secrets.dave) });
    assert.equal(locked.status, 429);
  });
});

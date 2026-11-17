const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('authentification', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.cleanup());

  test('le premier inscrit devient administrateur, les suivants utilisateurs', async () => {
    const alice = await ctx.register('alice');
    const bob = await ctx.register('bob');
    assert.equal(alice.user.role, 'admin');
    assert.equal(bob.user.role, 'user');
    assert.equal(alice.user.password, undefined);
  });

  test("refuse un nom d'utilisateur déjà pris, même avec une casse différente", async () => {
    const res = await ctx.api.post('/api/auth/register').send({ username: 'ALICE', password: 'motdepasse1', acceptTerms: true });
    assert.equal(res.status, 409);
  });

  test('valide les champs à l’inscription', async () => {
    const res = await ctx.api.post('/api/auth/register').send({ username: 'x', password: 'court', email: 'pas-un-mail' });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.username);
    assert.ok(res.body.details.password);
    assert.ok(res.body.details.email);
  });

  test('connexion : succès, puis échec avec un message générique', async () => {
    const ok = await ctx.api.post('/api/auth/login').send({ username: 'alice', password: 'motdepasse1' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);

    const badPassword = await ctx.api.post('/api/auth/login').send({ username: 'alice', password: 'mauvais!!' });
    const unknownUser = await ctx.api.post('/api/auth/login').send({ username: 'personne', password: 'mauvais!!' });
    assert.equal(badPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.equal(badPassword.body.error, unknownUser.body.error);
  });

  test('les routes protégées exigent un jeton valide', async () => {
    assert.equal((await ctx.api.get('/api/tickets')).status, 401);
    assert.equal((await ctx.api.get('/api/tickets').set('Authorization', 'Bearer faux')).status, 401);
    assert.equal((await ctx.api.get('/api/users')).status, 401);
  });

  test('/me renvoie le profil et permet de le modifier', async () => {
    const login = await ctx.api.post('/api/auth/login').send({ username: 'bob', password: 'motdepasse1' });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const me = await ctx.api.get('/api/auth/me').set(auth);
    assert.equal(me.body.user.username, 'bob');

    const upd = await ctx.api.put('/api/auth/me').set(auth).send({ firstname: 'Bob', lastname: 'Martin', role: 'admin' });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.user.name, 'Bob Martin');
    assert.equal(upd.body.user.role, 'user', 'le rôle ne doit pas être modifiable par soi-même');
  });

  test('changer son mot de passe exige l’ancien et invalide les anciens jetons', async () => {
    const login = await ctx.api.post('/api/auth/login').send({ username: 'bob', password: 'motdepasse1' });
    const auth = { Authorization: `Bearer ${login.body.token}` };

    const wrong = await ctx.api.put('/api/auth/me').set(auth).send({ password: 'nouveau-mdp', currentPassword: 'faux' });
    assert.equal(wrong.status, 400);

    const ok = await ctx.api
      .put('/api/auth/me')
      .set(auth)
      .send({ password: 'nouveau-mdp', currentPassword: 'motdepasse1' });
    assert.equal(ok.status, 200);
    assert.equal((await ctx.api.get('/api/auth/me').set(auth)).status, 401, 'ancien jeton révoqué');
    assert.equal(
      (await ctx.api.get('/api/auth/me').set('Authorization', `Bearer ${ok.body.token}`)).status,
      200,
      'nouveau jeton valide'
    );
  });

  test('inscriptions fermées par configuration', async () => {
    const closed = await setup({ ALLOW_REGISTRATION: 'false' });
    try {
      const cfg = await closed.api.get('/api/auth/config');
      assert.equal(cfg.body.registrationOpen, false);
      const res = await closed.api.post('/api/auth/register').send({ username: 'zoe', password: 'motdepasse1' });
      assert.equal(res.status, 403);
    } finally {
      await closed.cleanup();
    }
  });

  test('ADMIN_USERNAME / ADMIN_PASSWORD créent un administrateur au démarrage', async () => {
    const seeded = await setup({ ADMIN_USERNAME: 'root', ADMIN_PASSWORD: 'motdepasse-admin' });
    try {
      const res = await seeded.api.post('/api/auth/login').send({ username: 'root', password: 'motdepasse-admin' });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, 'admin');
      const next = await seeded.register('premier');
      assert.equal(next.user.role, 'user', 'un admin existe déjà : pas de promotion automatique');
    } finally {
      await seeded.cleanup();
    }
  });
});

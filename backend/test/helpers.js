const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp, ensureAdmin } = require('../src/app');

const silentLogger = { info() {}, warn() {}, error() {} };

/** Monte une instance isolée de l'API sur un dossier temporaire. */
async function setup(env = {}, { prepare } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xchange-test-'));
  const config = loadConfig({
    DATA_DIR: dir,
    LEGACY_DELETED_LOG: path.join(dir, 'logs', 'deleted-tickets.json'),
    JWT_SECRET: 'test-secret',
    RATE_LIMIT: 'false',
    ...env,
  });
  if (prepare) await prepare(config);
  const db = await openDatabase(config.databasePath, {
    legacyDeletedLogPath: config.legacyDeletedLogPath,
    logger: silentLogger,
  });
  await ensureAdmin(db, config, silentLogger);
  const app = createApp({ db, config, logger: silentLogger });
  const api = request(app);

  async function register(username, extra = {}) {
    const res = await api
      .post('/api/auth/register')
      .send({ username, password: 'motdepasse1', email: `${username}@exemple.fr`, ...extra });
    if (res.status !== 201) throw new Error(`register ${username}: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.token, user: res.body.user, auth: { Authorization: `Bearer ${res.body.token}` } };
  }

  async function createTicket(session, body = {}) {
    const res = await api
      .post('/api/tickets')
      .set(session.auth)
      .send({ title: 'Imprimante en panne', description: 'Bourrage papier au 2e étage', priority: 'medium', ...body });
    if (res.status !== 201) throw new Error(`createTicket: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function cleanup() {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return { api, app, db, config, dir, register, createTicket, cleanup };
}

module.exports = { setup, silentLogger };

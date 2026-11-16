const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Database } = require('../src/db');
const { setup } = require('./helpers');

// Schéma exact de la première version (index.js d'août 2025).
const LEGACY_SCHEMA = `
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, description TEXT, priority TEXT, category TEXT, due_date TEXT, created_at TEXT
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, email TEXT, firstname TEXT, lastname TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

test('reprend une base et un journal de suppressions de la première version', async () => {
  const ctx = await setup({}, {
    prepare: async (config) => {
      const legacy = await Database.open(config.databasePath);
      await legacy.exec(LEGACY_SCHEMA);
      await legacy.run('INSERT INTO users (username, password) VALUES (?, ?)', ['ancien', bcrypt.hashSync('ancien-mdp', 10)]);
      await legacy.run('INSERT INTO users (username, password) VALUES (?, ?)', ['second', bcrypt.hashSync('second-mdp', 10)]);
      await legacy.run(
        'INSERT INTO tickets (title, description, priority, category, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['Ancien ticket', 'Créé en 2025', 'high', '', '', '2025-08-09T10:00:00.000Z']
      );
      await legacy.run(
        'INSERT INTO tickets (title, description, priority, category, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['Sans priorité', null, null, null, '2025-09-01T00:00:00.000Z', '2025-08-10T10:00:00.000Z']
      );
      await legacy.close();

      fs.mkdirSync(path.dirname(config.legacyDeletedLogPath), { recursive: true });
      fs.writeFileSync(
        config.legacyDeletedLogPath,
        JSON.stringify([
          { id: 42, title: 'Supprimé autrefois', description: 'd', priority: 'low', category: 'bug', due_date: '', created_at: '2025-08-08T09:00:00.000Z', deleted_at: '2025-08-09T09:00:00.000Z' },
        ])
      );
    },
  });

  try {
    // Les anciens mots de passe (bcrypt) restent valables.
    const login = await ctx.api.post('/api/auth/login').send({ username: 'ancien', password: 'ancien-mdp' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'admin', 'le plus ancien compte est promu administrateur');
    const auth = { Authorization: `Bearer ${login.body.token}` };

    const second = await ctx.api.post('/api/auth/login').send({ username: 'second', password: 'second-mdp' });
    assert.equal(second.body.user.role, 'user');

    const list = await ctx.api.get('/api/tickets').query({ sort: 'id', order: 'asc' }).set(auth);
    assert.equal(list.body.total, 2);
    const [first, other] = list.body.items;
    assert.equal(first.status, 'open');
    assert.equal(first.due_date, null, 'date vide normalisée');
    assert.equal(other.priority, 'medium');
    assert.equal(other.description, '');
    assert.equal(other.due_date, '2025-09-01');
    assert.equal(other.created_at, '2025-08-10T10:00:00.000Z');

    const trash = await ctx.api.get('/api/admin/trash').set(auth);
    assert.equal(trash.body.length, 1);
    assert.equal(trash.body[0].id, 42);
    assert.ok(!fs.existsSync(ctx.config.legacyDeletedLogPath), 'journal renommé après import');
    assert.ok(fs.existsSync(ctx.config.legacyDeletedLogPath.replace(/\.json$/, '.imported.json')));

    // Le ticket restauré redevient un ticket normal.
    await ctx.api.post('/api/admin/trash/42/restore').set(auth).expect(200);
    const restored = await ctx.api.get('/api/tickets/42').set(auth);
    assert.equal(restored.body.title, 'Supprimé autrefois');
  } finally {
    await ctx.cleanup();
  }
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup } = require('./helpers');
const { objectToSheets, sheetsToLongTable } = require('../src/exports');

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe('exports CSV, Excel et JSON', () => {
  let ctx;
  let admin;
  let anna;
  let report;

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr', SEED_CONTENT: 'false' });
    admin = await ctx.register('admin', { firstname: 'Swann', lastname: 'Magna' });
    anna = await ctx.register('anna', { firstname: 'Anna', lastname: 'Martin' });
    await ctx.createTicket(anna, { title: '=HYPERLINK("http://x")', priority: 'high' });
    await ctx.createTicket(anna, { title: 'Tondeuse en panne', priority: 'low' });
    report = (
      await ctx.api
        .post('/api/analytics/reports')
        .set(anna.auth)
        .send({ name: 'Mes demandes', definition: { type: 'list', columns: ['id', 'title', 'priority', 'created_at'], filters: {} } })
        .expect(201)
    ).body.report;
  });
  after(() => ctx.cleanup());

  test('rapport : trois formats, formule jamais interprétée, vraies dates en Excel', async () => {
    const url = `/api/analytics/reports/${report.id}/export`;
    const csv = await ctx.api.get(`${url}?format=csv`).set(anna.auth).expect(200);
    assert.match(csv.headers['content-disposition'], /rapport-Mes-demandes-\d{4}-\d{2}-\d{2}\.csv/);
    assert.match(csv.text, /Tondeuse en panne/);

    const xlsx = await ctx.api.get(`${url}?format=xlsx`).set(anna.auth).buffer(true).parse(binary).expect(200);
    assert.match(xlsx.headers['content-type'], /spreadsheetml/);
    assert.match(xlsx.headers['content-disposition'], /\.xlsx"/);
    const ws = (await readXlsx(xlsx.body)).worksheets[0];
    assert.equal(ws.name, 'Mes demandes');
    assert.deepEqual(ws.getRow(1).values.slice(1), ['N°', 'Titre', 'Priorité', 'Créée le']);
    const titles = [ws.getRow(2).getCell(2), ws.getRow(3).getCell(2)];
    const formula = titles.find((c) => String(c.value).includes('HYPERLINK'));
    assert.equal(formula.type, ExcelJS.ValueType.String);
    assert.equal(formula.formula, undefined);
    assert.ok(ws.getRow(2).getCell(4).value instanceof Date);
    assert.ok(ws.autoFilter);

    const json = await ctx.api.get(`${url}?format=json`).set(anna.auth).expect(200);
    assert.equal(json.body.rapport, 'Mes demandes');
    assert.equal(json.body.lignes.length, 2);
    assert.ok(json.body.lignes.some((l) => l.Titre === 'Tondeuse en panne' && l['Priorité'] === 'Basse'));

    await ctx.api.get(`${url}?format=pdf`).set(anna.auth).expect(400);
    // L'ancien lien CSV marche toujours.
    await ctx.api.get(`/api/analytics/reports/${report.id}/csv`).set(anna.auth).expect(200);
  });

  test('journal système : Excel et JSON avec les mêmes filtres', async () => {
    const xlsx = await ctx.api.get('/api/admin/system-log/export?format=xlsx&source=utilisateurs').set(admin.auth).buffer(true).parse(binary).expect(200);
    const ws = (await readXlsx(xlsx.body)).worksheets[0];
    assert.deepEqual(ws.getRow(1).values.slice(1), ['Date', 'Niveau', 'Source', 'Message', 'Compte concerné', 'Par', 'Détails']);
    assert.ok(ws.rowCount > 1);
    assert.ok(ws.getRow(2).getCell(1).value instanceof Date);
    const json = (await ctx.api.get('/api/admin/system-log/export?format=json&source=utilisateurs').set(admin.auth).expect(200)).body;
    assert.ok(json.length > 0);
    assert.ok(json.every((e) => e.source === 'utilisateurs'));
    assert.ok(json.some((e) => e.compte_concerne?.nom === 'Anna Martin'));
    await ctx.api.get('/api/admin/system-log/export?format=xlsx').set(anna.auth).expect(403);
  });

  test('données personnelles : JSON, Excel (une feuille par rubrique) et CSV aplati', async () => {
    const plain = (await ctx.api.get('/api/auth/me/export').set(anna.auth).expect(200)).body;
    assert.equal(plain.account.username, 'anna');

    const json = await ctx.api.get('/api/auth/me/export?format=json').set(anna.auth).expect(200);
    assert.match(json.headers['content-disposition'], /xchange-donnees-anna-.*\.json/);
    assert.equal(JSON.parse(json.text).account.username, 'anna');

    const xlsx = await ctx.api.get('/api/auth/me/export?format=xlsx').set(anna.auth).buffer(true).parse(binary).expect(200);
    const wb = await readXlsx(xlsx.body);
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ['Export', 'Compte', 'Demandes', 'Demandes - historique', 'Activité du compte']) assert.ok(names.includes(n), names.join(', '));
    const demandes = wb.getWorksheet('Demandes');
    assert.ok(demandes.getRow(1).values.includes('title'));
    const history = wb.getWorksheet('Demandes - historique');
    assert.equal(history.getRow(1).getCell(1).value, 'Demandes n°');

    const csv = await ctx.api.get('/api/auth/me/export?format=csv').set(anna.auth).expect(200);
    assert.match(csv.text, /^﻿Rubrique;Ligne;Champ;Valeur/);
    assert.match(csv.text, /Compte;;username;anna/);
    assert.match(csv.text, /Demandes;\d+;title;Tondeuse en panne/);

    // Côté administration, même chose.
    await ctx.api.get(`/api/admin/rgpd/users/${anna.user.id}/export?format=xlsx`).set(admin.auth).expect(200);
    const log = (await ctx.api.get(`/api/admin/system-log?user=${anna.user.id}&limit=500`).set(admin.auth)).body.items.map((i) => i.message);
    assert.ok(log.includes('Export de ses données personnelles (Excel)'));
  });

  test('envoi programmé : fichier joint au format choisi', async () => {
    const url = `/api/analytics/reports/${report.id}/schedules`;
    await ctx.api.post(url).set(anna.auth).send({ frequency: 'daily', time: '08:00', fileFormat: 'docx' }).expect(400);
    const s = (await ctx.api.post(url).set(anna.auth).send({ frequency: 'daily', time: '08:00', fileFormat: 'xlsx' }).expect(201)).body.schedule;
    assert.equal(s.fileFormat, 'xlsx');
    ctx.app.locals.mailer.sent.length = 0;
    await ctx.api.post(`/api/analytics/schedules/${s.id}/send`).set(anna.auth).expect(200);
    const [mail] = ctx.app.locals.mailer.sent;
    assert.match(mail.attachments[0].filename, /\.xlsx$/);
    const att = mail.attachments[0];
    const content = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, att.encoding || 'base64');
    const ws = (await readXlsx(content)).worksheets[0];
    assert.equal(ws.getRow(1).getCell(2).value, 'Titre');
    // Par défaut, toujours du CSV.
    const d = (await ctx.api.post(url).set(anna.auth).send({ frequency: 'daily', time: '09:00' }).expect(201)).body.schedule;
    assert.equal(d.fileFormat, 'csv');
  });

  test('aplatissement d’un objet imbriqué', () => {
    const sheets = objectToSheets({ a: 1, compte: { nom: 'x', prefs: { mail: true } }, liste: [{ id: 7, t: 'y', sous: [{ v: 1 }, { v: 2 }] }] });
    assert.deepEqual(
      sheets.map((s) => s.name),
      ['Export', 'compte', 'liste', 'liste.sous']
    );
    assert.deepEqual(sheets[1].rows, [
      ['nom', 'x'],
      ['prefs.mail', true],
    ]);
    assert.deepEqual(sheets[3].headers, ['liste n°', 'v']);
    assert.deepEqual(sheets[3].rows, [
      [7, 1],
      [7, 2],
    ]);
    const long = sheetsToLongTable(sheets);
    assert.deepEqual(long.rows[0], ['Export', '', 'a', 1]);
  });
});

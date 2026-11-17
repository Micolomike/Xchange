const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { nextRun } = require('../src/reportSchedules');
const { anonymizeUser } = require('../src/rgpd');
const { toCsv, periodWindow } = require('../src/reports');

describe('analyses : rapports, envois programmés, tableaux de bord', () => {
  let ctx;
  let admin;
  let anna;
  let ben;
  let chloe;
  let group;
  let t1;
  let t2;

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr', SEED_CONTENT: 'false' });
    admin = await ctx.register('admin', { firstname: 'Swann', email: 'admin@exemple.fr' });
    anna = await ctx.register('anna', { firstname: 'Anna', lastname: 'Martin', email: 'anna@exemple.fr' });
    ben = await ctx.register('ben', { firstname: 'Benoît', email: 'ben@exemple.fr' });
    chloe = await ctx.register('chloe', { firstname: 'Chloé', email: 'chloe@exemple.fr' });
    group = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Jardiniers', members: [anna.user.id, ben.user.id] })).body;
    t1 = await ctx.createTicket(anna, { title: 'Tondeuse en panne', priority: 'high', assigned_group: group.id });
    t2 = await ctx.createTicket(chloe, { title: 'Volet bloqué', priority: 'low' });
    await ctx.createTicket(anna, { title: 'Arrosage automatique', priority: 'medium', assigned_group: group.id });
  });
  after(() => ctx.cleanup());

  const list = { type: 'list', columns: ['id', 'title', 'priority', 'group'], filters: {} };

  test('options et aperçu, calculé avec les droits de la personne', async () => {
    const meta = (await ctx.api.get('/api/analytics/meta').set(anna.auth).expect(200)).body;
    assert.ok(meta.templates.length >= 4);
    assert.ok(meta.groups.find((g) => g.id === group.id).mine);
    const forAnna = (await ctx.api.post('/api/analytics/preview').set(anna.auth).send({ definition: list }).expect(200)).body.result;
    assert.equal(forAnna.total, 2);
    assert.ok(!JSON.stringify(forAnna).includes('Volet'));
    const forChloe = (await ctx.api.post('/api/analytics/preview').set(chloe.auth).send({ definition: list }).expect(200)).body.result;
    assert.deepEqual(forChloe.rows.map((r) => r.title), ['Volet bloqué']);
    await ctx.api.post('/api/analytics/preview').set(anna.auth).send({ definition: { type: 'summary' } }).expect(400);
  });

  test('regroupements, tendance, indicateur, carte de chaleur', async () => {
    const run = async (definition) => (await ctx.api.post('/api/analytics/preview').set(admin.auth).send({ definition }).expect(200)).body.result;
    const byPrio = await run({ type: 'summary', dimension: 'priority', chart: 'bar' });
    assert.deepEqual(
      byPrio.categories.map((c) => c.label),
      ['Haute', 'Moyenne', 'Basse']
    );
    assert.deepEqual(byPrio.series[0].values, [1, 1, 1]);
    const stacked = await run({ type: 'summary', dimension: 'group', split: 'status', chart: 'stacked' });
    assert.equal(stacked.series[0].label, 'Ouvert');
    assert.ok(stacked.categories.some((c) => c.label === 'Sans groupe'));
    const trend = await run({ type: 'trend', interval: 'day', filters: { period: { range: '7d' } } });
    assert.equal(trend.categories.length, 7);
    assert.equal(trend.series[0].values.at(-1), 3);
    const kpi = await run({ type: 'kpi', metric: 'open', filters: {} });
    assert.equal(kpi.value, 3);
    const created = await run({ type: 'kpi', metric: 'created', filters: { period: { range: '30d' } } });
    assert.equal(created.value, 3);
    assert.equal(created.previous, 0);
    assert.equal(created.spark.length, 30);
    const heat = await run({ type: 'heatmap', filters: {} });
    assert.equal(heat.total, 3);
    assert.equal(heat.values.length, 7);
  });

  test('partage : privé par défaut, puis avec un groupe ; seul le créateur modifie', async () => {
    const r = (
      await ctx.api.post('/api/analytics/reports').set(anna.auth).send({ name: 'Demandes du jardin', definition: list }).expect(201)
    ).body.report;
    assert.equal(r.visibility, 'private');
    await ctx.api.get(`/api/analytics/reports/${r.id}`).set(ben.auth).expect(404);
    await ctx.api.put(`/api/analytics/reports/${r.id}`).set(anna.auth).send({ name: 'Demandes du jardin', definition: list, visibility: 'groups', groups: [group.id] }).expect(200);
    const seen = (await ctx.api.get('/api/analytics/reports').set(ben.auth)).body;
    assert.equal(seen.shared.length, 1);
    await ctx.api.put(`/api/analytics/reports/${r.id}`).set(ben.auth).send({ name: 'x', definition: list }).expect(403);
    await ctx.api.get(`/api/analytics/reports/${r.id}`).set(chloe.auth).expect(404);
    // Rapport partagé avec tout le monde : Chloé le voit, avec ses propres droits.
    await ctx.api.put(`/api/analytics/reports/${r.id}`).set(anna.auth).send({ name: 'Demandes du jardin', definition: list, visibility: 'all' }).expect(200);
    const forChloe = (await ctx.api.get(`/api/analytics/reports/${r.id}/run`).set(chloe.auth).expect(200)).body.result;
    assert.deepEqual(forChloe.rows.map((x) => x.title), ['Volet bloqué']);
    const copy = (await ctx.api.post(`/api/analytics/reports/${r.id}/duplicate`).set(chloe.auth).expect(201)).body.report;
    assert.equal(copy.mine, true);
    assert.equal(copy.visibility, 'private');
  });

  test('export CSV : séparateur point-virgule, pas de formule', async () => {
    const r = (await ctx.api.post('/api/analytics/reports').set(anna.auth).send({ name: 'Export', definition: list }).expect(201)).body.report;
    const res = await ctx.api.get(`/api/analytics/reports/${r.id}/csv`).set(anna.auth).expect(200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.text, /N°;Titre;Priorité;Groupe/);
    assert.match(res.text, /Tondeuse en panne;Haute;Jardiniers/);
    const csv = toCsv({ type: 'list', columns: [{ key: 'title', label: 'Titre' }], rows: [{ title: '=HYPERLINK("x")' }] });
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  });

  test('envois programmés : groupes dont on est membre, droits du créateur contrôlés pour chaque destinataire', async () => {
    const r = (await ctx.api.post('/api/analytics/reports').set(anna.auth).send({ name: 'Hebdo jardin', definition: list }).expect(201)).body.report;
    const url = `/api/analytics/reports/${r.id}/schedules`;
    const other = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Cuisiniers', members: [chloe.user.id] })).body;
    await ctx.api.post(url).set(anna.auth).send({ frequency: 'weekly', weekday: 1, time: '08:30', groups: [other.id] }).expect(403);
    await ctx.api.post(url).set(anna.auth).send({ frequency: 'weekly', weekday: 9, time: '08:30' }).expect(400);
    await ctx.api.post(url).set(ben.auth).send({ frequency: 'daily', time: '08:30' }).expect(404);
    const s = (
      await ctx.api.post(url).set(anna.auth).send({ frequency: 'weekly', weekday: 1, time: '08:30', groups: [group.id], users: [chloe.user.id], message: 'Bonne semaine' }).expect(201)
    ).body.schedule;
    assert.equal(s.label, 'chaque lundi à 08:30');
    assert.ok(s.nextRunAt);

    ctx.app.locals.mailer.sent.length = 0;
    const run = (await ctx.api.post(`/api/analytics/schedules/${s.id}/send`).set(anna.auth).expect(200)).body.run;
    // Anna (créatrice) et Ben (même groupe) reçoivent ; Chloé ne voit pas les demandes du groupe : écartée.
    assert.equal(run.sent, 2, JSON.stringify(run) + JSON.stringify(ctx.app.locals.mailer.sent.map((m) => m.to)));
    assert.deepEqual(run.skipped, [{ name: 'Chloé', reason: 'ne voit pas toutes les demandes du rapport' }]);
    const mails = ctx.app.locals.mailer.sent;
    assert.deepEqual(mails.map((m) => m.to).sort(), ['anna@exemple.fr', 'ben@exemple.fr']);
    const toBen = mails.find((m) => m.to === 'ben@exemple.fr');
    assert.match(toBen.subject, /Rapport : Hebdo jardin/);
    assert.match(toBen.text, /Anna Martin vous envoie ce rapport/);
    assert.match(toBen.text, /Bonne semaine/);
    assert.equal(toBen.attachments.length, 1);
    assert.match(toBen.attachments[0].content, /Tondeuse en panne/);
    assert.ok(!toBen.html.includes('Volet'));

    // Ben ne veut plus des rapports des autres.
    await ctx.api.put('/api/auth/me').set(ben.auth).send({ notify_prefs: { reports: false } }).expect(200);
    ctx.app.locals.mailer.sent.length = 0;
    const run2 = (await ctx.api.post(`/api/analytics/schedules/${s.id}/send`).set(anna.auth).expect(200)).body.run;
    assert.equal(run2.sent, 1);
    assert.ok(run2.skipped.some((x) => x.name === 'Benoît' && /ne pas recevoir/.test(x.reason)));
    const runs = (await ctx.api.get(`/api/analytics/schedules/${s.id}/runs`).set(anna.auth).expect(200)).body.runs;
    assert.equal(runs.length, 2);

    // L'administrateur voit les envois de tous et peut en arrêter un.
    const all = (await ctx.api.get('/api/admin/analytics/schedules').set(admin.auth).expect(200)).body.schedules;
    assert.ok(all.some((x) => x.id === s.id && x.report === 'Hebdo jardin'));
    await ctx.api.get('/api/admin/analytics/schedules').set(anna.auth).expect(403);
    await ctx.api.post(`/api/admin/analytics/schedules/${s.id}/disable`).set(admin.auth).send({}).expect(200);
    const after = (await ctx.api.get(url).set(anna.auth)).body.schedules[0];
    assert.equal(after.active, false);
    assert.equal(after.disabledReason, 'Arrêté par un administrateur');
  });

  test('prochain envoi : jour, semaine, mois', () => {
    const from = new Date(2026, 10, 17, 10, 0); // mardi 17 novembre 2026, 10 h
    assert.deepEqual(nextRun({ frequency: 'daily', time: '08:30' }, from), new Date(2026, 10, 18, 8, 30));
    assert.deepEqual(nextRun({ frequency: 'daily', time: '18:00' }, from), new Date(2026, 10, 17, 18, 0));
    assert.deepEqual(nextRun({ frequency: 'weekly', weekday: 1, time: '08:30' }, from), new Date(2026, 10, 23, 8, 30));
    assert.deepEqual(nextRun({ frequency: 'weekly', weekday: 2, time: '09:00' }, from), new Date(2026, 10, 24, 9, 0));
    assert.deepEqual(nextRun({ frequency: 'monthly', monthday: 1, time: '07:00' }, from), new Date(2026, 11, 1, 7, 0));
    assert.deepEqual(nextRun({ frequency: 'monthly', monthday: 28, time: '07:00' }, from), new Date(2026, 10, 28, 7, 0));
    const w = periodWindow('last_month', from);
    assert.deepEqual([w.from, w.to], [new Date(2026, 9, 1), new Date(2026, 10, 1)]);
  });

  test('tableaux de bord : modèle, filtres communs, partage, données avec les droits de chacun', async () => {
    const d = (await ctx.api.post('/api/analytics/dashboards').set(anna.auth).send({ template: 'activite' }).expect(201)).body.dashboard;
    assert.equal(d.name, 'Activité générale');
    assert.ok(d.widgets.length >= 8);
    const data = (await ctx.api.get(`/api/analytics/dashboards/${d.id}/data`).set(anna.auth).expect(200)).body;
    const open = d.widgets.find((w) => w.definition.type === 'kpi' && w.definition.metric === 'open');
    assert.equal(data.data[open.id].result.value, 2);
    // Filtre de groupe : rien hors des Jardiniers.
    const filtered = (await ctx.api.get(`/api/analytics/dashboards/${d.id}/data?group=${group.id}`).set(anna.auth).expect(200)).body;
    assert.equal(filtered.filters.group, group.id);
    await ctx.api.get(`/api/analytics/dashboards/${d.id}`).set(chloe.auth).expect(404);
    await ctx.api.put(`/api/analytics/dashboards/${d.id}`).set(anna.auth).send({ ...d, visibility: 'all' }).expect(200);
    const forChloe = (await ctx.api.get(`/api/analytics/dashboards/${d.id}/data`).set(chloe.auth).expect(200)).body;
    assert.equal(forChloe.data[open.id].result.value, 1);
    await ctx.api.put(`/api/analytics/dashboards/${d.id}`).set(chloe.auth).send(d).expect(403);
    await ctx.api.put(`/api/analytics/dashboards/${d.id}`).set(anna.auth).send({ ...d, widgets: [{ id: 'x', title: '', definition: list }] }).expect(400);
  });

  test('signal en direct après une modification de demande', async () => {
    const sent = [];
    const hub = ctx.app.locals.chatHub;
    const original = hub.send;
    hub.send = (ids, event, data) => sent.push({ ids, event, data });
    try {
      await ctx.api.patch(`/api/tickets/${t1.id}`).set(anna.auth).send({ priority: 'low' }).expect(200);
      await new Promise((r) => setTimeout(r, 1300));
      assert.ok(sent.some((e) => e.event === 'tickets'));
      assert.ok(!JSON.stringify(sent).includes('Tondeuse'));
    } finally {
      hub.send = original;
    }
  });

  test('anonymisation : rapports, tableaux et envois de la personne supprimés', async () => {
    assert.ok((await ctx.db.get('SELECT COUNT(*) AS n FROM reports WHERE owner_id = ?', [anna.user.id])).n > 0);
    await anonymizeUser(ctx.db, ctx.config, anna.user.id, { mode: 'keep' });
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM reports WHERE owner_id = ?', [anna.user.id])).n, 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM dashboards WHERE owner_id = ?', [anna.user.id])).n, 0);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM report_schedules WHERE owner_id = ?', [anna.user.id])).n, 0);
    assert.ok(t2);
  });
});

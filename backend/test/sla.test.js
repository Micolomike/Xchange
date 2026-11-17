const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const SLA = require('../src/sla');

const business = { mode: 'business', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', holidays: true };

describe('SLA : calendrier', () => {
  test('jours fériés français, Pâques compris', () => {
    const h = SLA.frenchHolidays(2026);
    for (const d of ['2026-1-1', '2026-4-6', '2026-5-1', '2026-5-8', '2026-5-14', '2026-5-25', '2026-7-14', '2026-8-15', '2026-11-1', '2026-11-11', '2026-12-25']) {
      assert.ok(h.has(d), d);
    }
    assert.equal(h.size, 11);
  });

  test('temps ouvré : soirées, week-ends et jours fériés sautés', () => {
    // Vendredi 13 novembre 2026, 17 h + 2 h ouvrées : lundi 16, 10 h.
    assert.deepEqual(SLA.addWorkingMinutes(new Date(2026, 10, 13, 17, 0), 120, business), new Date(2026, 10, 16, 10, 0));
    // Mardi 10 novembre, 17 h + 2 h : le 11 novembre est férié, donc jeudi 12, 10 h.
    assert.deepEqual(SLA.addWorkingMinutes(new Date(2026, 10, 10, 17, 0), 120, business), new Date(2026, 10, 12, 10, 0));
    // Créée un samedi : le compteur part lundi 9 h.
    assert.deepEqual(SLA.addWorkingMinutes(new Date(2026, 10, 14, 11, 0), 60, business), new Date(2026, 10, 16, 10, 0));
    // Sans les jours fériés.
    assert.deepEqual(SLA.addWorkingMinutes(new Date(2026, 10, 10, 17, 0), 120, { ...business, holidays: false }), new Date(2026, 10, 11, 10, 0));
    // Temps continu.
    assert.deepEqual(SLA.addWorkingMinutes(new Date(2026, 10, 14, 11, 0), 60, { mode: 'continuous' }), new Date(2026, 10, 14, 12, 0));
    assert.equal(SLA.workingMinutesBetween(new Date(2026, 10, 13, 17, 0), new Date(2026, 10, 16, 10, 0), business), 120);
  });
});

describe('SLA : demandes, réglages, alertes, analyses', () => {
  let ctx;
  let admin;
  let anna;
  let ben;
  let group;

  before(async () => {
    ctx = await setup({ SMTP_HOST: 'test', SMTP_USER: 'x.change@orange.fr', SEED_CONTENT: 'false' });
    admin = await ctx.register('admin', { firstname: 'Swann', email: 'admin@exemple.fr' });
    anna = await ctx.register('anna', { firstname: 'Anna', email: 'anna@exemple.fr' });
    ben = await ctx.register('ben', { firstname: 'Benoît', email: 'ben@exemple.fr' });
    group = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Support', members: [ben.user.id] })).body;
  });
  after(() => ctx.cleanup());

  test('réglages par défaut et aperçu des échéances', async () => {
    await ctx.api.get('/api/admin/sla').set(anna.auth).expect(403);
    const r = (await ctx.api.get('/api/admin/sla').set(admin.auth).expect(200)).body;
    assert.equal(r.settings.enabled, true);
    assert.deepEqual(r.settings.targets.high, { response: 240, resolution: 1080 });
    assert.equal(r.settings.warnPercent, 75);
    assert.ok(r.preview.high.response < r.preview.high.resolution);
    await ctx.api.put('/api/admin/sla').set(admin.auth).send({ warnPercent: 99 }).expect(400);
    await ctx.api.put('/api/admin/sla').set(admin.auth).send({ targets: { high: { response: 600, resolution: 60 } } }).expect(400);
    await ctx.api.put('/api/admin/sla').set(admin.auth).send({ calendar: { mode: 'business', days: [], start: '09:00', end: '18:00' } }).expect(400);
  });

  test('échéances à la création, prise en charge détectée, recalcul si la priorité change', async () => {
    const t = await ctx.createTicket(anna, { priority: 'high', assigned_group: group.id });
    assert.ok(t.sla.response.due && t.sla.resolution.due);
    assert.equal(t.sla.response.state, 'running');
    assert.equal(t.sla.response.doneAt, null);
    // Un message de l'auteur ne compte pas ; celui d'un membre du groupe, si.
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(anna.auth).send({ body: 'Des nouvelles ?' }).expect(201);
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(anna.auth)).body.sla.response.doneAt, null);
    await ctx.api.post(`/api/tickets/${t.id}/comments`).set(ben.auth).send({ body: 'Je regarde.' }).expect(201);
    const after1 = (await ctx.api.get(`/api/tickets/${t.id}`).set(anna.auth)).body.sla;
    assert.equal(after1.response.state, 'met');
    // Passage en priorité basse : la résolution est recalculée (plus lointaine), la prise en charge reste acquise.
    await ctx.api.patch(`/api/tickets/${t.id}`).set(admin.auth).send({ priority: 'low' }).expect(200);
    const after2 = (await ctx.api.get(`/api/tickets/${t.id}`).set(anna.auth)).body.sla;
    assert.ok(after2.resolution.due > after1.resolution.due);
    assert.equal(after2.response.state, 'met');
    // Résolue : respectée.
    await ctx.api.patch(`/api/tickets/${t.id}`).set(admin.auth).send({ status: 'resolved' }).expect(200);
    assert.equal((await ctx.api.get(`/api/tickets/${t.id}`).set(anna.auth)).body.sla.resolution.state, 'met');
  });

  test('règle par catégorie et recalcul des demandes en cours', async () => {
    const cats = (await ctx.api.get('/api/admin/sla').set(admin.auth)).body.categories;
    const t = await ctx.createTicket(anna, { priority: 'medium', category: cats[0].key });
    await ctx.api
      .put('/api/admin/sla')
      .set(admin.auth)
      .send({ rules: [{ category: cats[0].key, priority: 'all', response: 60, resolution: 120 }], calendar: { mode: 'continuous' } })
      .expect(200);
    const r = (await ctx.api.post('/api/admin/sla/recalculate').set(admin.auth).expect(200)).body;
    assert.ok(r.count >= 1);
    const sla = (await ctx.api.get(`/api/tickets/${t.id}`).set(anna.auth)).body.sla;
    const created = new Date((await ctx.db.get('SELECT created_at FROM tickets WHERE id = ?', [t.id])).created_at);
    assert.equal(new Date(sla.resolution.due) - created, 120 * 60_000);
  });

  test('alertes : approche puis dépassement, une seule fois, au groupe sans responsable', async () => {
    const t = await ctx.createTicket(anna, { priority: 'high', assigned_group: group.id });
    const past = (min) => new Date(Date.now() - min * 60_000).toISOString();
    const future = (min) => new Date(Date.now() + min * 60_000).toISOString();
    await ctx.db.run('UPDATE tickets SET sla_resolution_warn = ?, sla_resolution_due = ?, sla_response_warn = ?, sla_response_due = ? WHERE id = ?', [
      past(5),
      future(60),
      future(10),
      future(20),
      t.id,
    ]);
    ctx.app.locals.mailer.sent.length = 0;
    assert.equal(await SLA.checkAlerts(ctx.db, ctx.app.locals.notifier), 1);
    await ctx.app.locals.notifier.idle();
    const mails = ctx.app.locals.mailer.sent;
    assert.deepEqual(mails.map((m) => m.to), ['ben@exemple.fr']);
    assert.match(mails[0].subject, /Délai bientôt dépassé/);
    assert.equal(await SLA.checkAlerts(ctx.db, ctx.app.locals.notifier), 0);
    await ctx.db.run('UPDATE tickets SET sla_resolution_due = ? WHERE id = ?', [past(1), t.id]);
    assert.equal(await SLA.checkAlerts(ctx.db, ctx.app.locals.notifier), 1);
    await ctx.app.locals.notifier.idle();
    assert.match(ctx.app.locals.mailer.sent.at(-1).subject, /Délai dépassé/);
    // Liste des demandes : filtre « délai dépassé ».
    const list = (await ctx.api.get('/api/tickets?sla=breached').set(admin.auth).expect(200)).body;
    assert.deepEqual(list.items.map((x) => x.id), [t.id]);
    assert.equal(list.items[0].sla.resolution.state, 'breached');
  });

  test('analyses : indicateurs, regroupement et tableau de bord SLA', async () => {
    const run = async (definition) => (await ctx.api.post('/api/analytics/preview').set(admin.auth).send({ definition }).expect(200)).body.result;
    assert.equal((await run({ type: 'kpi', metric: 'sla_breached', filters: {} })).value, 1);
    const rate = await run({ type: 'kpi', metric: 'sla_rate', filters: { period: { range: '30d' } } });
    // Une résolue à temps, une en cours déjà en retard.
    assert.equal(rate.value, 50);
    assert.equal(rate.metric.unit, '%');
    const states = await run({ type: 'summary', dimension: 'sla_state', chart: 'donut', filters: {} });
    assert.ok(states.categories.some((c) => c.label === 'Dépassé, en cours'));
    const trend = await run({ type: 'trend', interval: 'week', series: ['sla_rate', 'created'], filters: { period: { range: '30d' } } });
    assert.equal(trend.series.length, 1);
    assert.equal(trend.series[0].key, 'sla_rate');
    const late = await run({ type: 'list', columns: ['id', 'sla_state'], filters: { sla: 'attention', status: ['open', 'in_progress'] } });
    assert.equal(late.rows.length, 1);
    assert.equal(late.rows[0].sla_state, 'Dépassé, en cours');
    const tpl = (await ctx.api.get('/api/analytics/templates/sla').set(anna.auth).expect(200)).body.dashboard;
    assert.equal(tpl.name, 'Délais (SLA)');
    const data = (await ctx.api.get('/api/analytics/templates/sla/data').set(admin.auth).expect(200)).body.data;
    assert.ok(Object.values(data).every((d) => d.result), JSON.stringify(Object.values(data).filter((d) => d.error)));
  });

  test('anciennes demandes : échéances rattrapées sans alertes', async () => {
    await ctx.db.run('UPDATE tickets SET sla_policy = NULL');
    const n = await SLA.backfillSla(ctx.db);
    assert.ok(n >= 3);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM tickets WHERE sla_policy IS NULL')).n, 0);
    assert.equal(await SLA.checkAlerts(ctx.db, ctx.app.locals.notifier), 0);
  });
});

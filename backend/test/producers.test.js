const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { upgradeProducers } = require('../src/ticketFields');

describe('table des champs, variables et record producers', () => {
  let ctx;
  let admin;
  let alice; // membre du groupe Atelier (traite les demandes)
  let bob; // demandeur
  let atelier;
  let fMateriel;
  let fQuantite;
  let fReferent;
  let item;

  before(async () => {
    ctx = await setup({ SEED_CONTENT: 'false' });
    admin = await ctx.register('admin', { firstname: 'Swann', lastname: 'Magna' });
    alice = await ctx.register('alice', { firstname: 'Alice', lastname: 'Martin' });
    bob = await ctx.register('bob', { firstname: 'Bob', lastname: 'Durand' });
    atelier = (await ctx.api.post('/api/groups').set(admin.auth).send({ name: 'Atelier', members: [alice.user.id] })).body;
  });
  after(() => ctx.cleanup());

  test('dictionnaire : champs système en lecture, champs personnalisés créés par un administrateur', async () => {
    await ctx.api.get('/api/admin/ticket-fields').set(bob.auth).expect(403);
    const dict = (await ctx.api.get('/api/admin/ticket-fields').set(admin.auth).expect(200)).body;
    assert.ok(dict.system.some((f) => f.name === 'priority' && f.map));
    assert.ok(dict.system.some((f) => f.name === 'status' && !f.map));

    const bad = await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ label: 'Matériel', type: 'select', options: ['Perceuse'] }).expect(400);
    assert.match(bad.body.details.options, /deux choix/);
    fMateriel = (
      await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ label: 'Matériel prêté', type: 'select', options: ['Perceuse', 'Ponceuse', 'Scie'] }).expect(201)
    ).body;
    assert.equal(fMateriel.name, 'u_materiel_prete');
    assert.equal(fMateriel.write, 'handlers');
    const dup = await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ name: 'u_materiel_prete', label: 'Autre', type: 'text' }).expect(400);
    assert.match(dup.body.details.name, /existe déjà/);
    await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ name: 'materiel', label: 'X', type: 'text' }).expect(400);
    fQuantite = (await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ label: 'Quantité', type: 'number', write: 'editors' }).expect(201)).body;
    fReferent = (await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ label: 'Référent', type: 'user' }).expect(201)).body;

    // Lisibles par tout compte connecté (fiche de demande, rapports).
    const pub = (await ctx.api.get('/api/ticket-fields').set(bob.auth).expect(200)).body;
    assert.deepEqual(
      pub.fields.map((f) => f.name),
      ['u_materiel_prete', 'u_quantite', 'u_referent']
    );
  });

  test('record producer : mappages contrôlés (type, choix, champ en double)', async () => {
    const base = { name: 'Prêt de matériel', fulfillment_group: atelier.id, priority: 'low' };
    const send = (fields, extra = {}) => ctx.api.post('/api/admin/catalog').set(admin.auth).send({ ...base, ...extra, fields });

    let r = await send([{ key: 'nb', label: 'Combien', type: 'text', mapTo: 'u_quantite' }]).expect(400);
    assert.match(r.body.details.mapping, /ne peut pas alimenter/);
    r = await send([{ key: 'outil', label: 'Outil', type: 'select', options: ['Perceuse', 'Marteau'], mapTo: 'u_materiel_prete' }]).expect(400);
    assert.match(r.body.details.mapping, /absents du champ.*Marteau/);
    r = await send([{ key: 'urg', label: 'Urgence', type: 'radio', options: ['Basse', 'Extrême'], mapTo: 'priority' }]).expect(400);
    assert.match(r.body.details.mapping, /sans priorité correspondante : Extrême/);
    r = await send([
      { key: 'a', label: 'A', type: 'text', mapTo: 'title' },
      { key: 'b', label: 'B', type: 'text', mapTo: 'title' },
    ]).expect(400);
    assert.match(r.body.details.mapping, /même champ/);
    r = await send([{ key: 'a', label: 'A', type: 'text' }], { field_values: { u_quantite: 'beaucoup' } }).expect(400);
    assert.match(r.body.details.mapping, /nombre attendu/);

    item = (
      await send(
        [
          { key: 'objet', label: 'Objet du prêt', type: 'text', required: true, mapTo: 'title' },
          { key: 'outil', label: 'Outil', type: 'select', options: ['Perceuse', 'Scie'], required: true, mapTo: 'u_materiel_prete' },
          { key: 'combien', label: 'Combien', type: 'number', mapTo: 'u_quantite' },
          { key: 'urgence', label: 'Urgence', type: 'radio', options: ['Basse', 'Moyenne', 'Haute'], mapTo: 'priority' },
          { key: 'retour', label: 'Date de retour', type: 'date', mapTo: 'due_date' },
          { key: 'remarque', label: 'Remarque', type: 'textarea' },
        ],
        { field_values: { u_referent: String(alice.user.id), u_quantite: '1' } }
      ).expect(201)
    ).body;
    assert.equal(item.fields[0].mapTo, 'title');
    assert.deepEqual(item.field_values, { u_referent: String(alice.user.id), u_quantite: '1' });
    // Le demandeur ne voit pas les valeurs fixées.
    const seen = (await ctx.api.get(`/api/catalog/${item.id}`).set(bob.auth).expect(200)).body;
    assert.equal(seen.field_values, undefined);
  });

  let ticket;
  test('envoi : variables recopiées dans les champs, valeurs fixées, table des variables', async () => {
    ticket = (
      await ctx.api
        .post(`/api/catalog/${item.id}/submit`)
        .set(bob.auth)
        .send({ answers: { objet: 'Étagère', outil: 'Perceuse', combien: '2', urgence: 'Haute', retour: '2030-05-02', remarque: 'Merci !' } })
        .expect(201)
    ).body;
    assert.equal(ticket.title, 'Prêt de matériel : Étagère');
    assert.equal(ticket.priority, 'high');
    assert.equal(ticket.due_date, '2030-05-02');
    const byName = Object.fromEntries(ticket.fields.map((f) => [f.name, f]));
    assert.equal(byName.u_materiel_prete.value, 'Perceuse');
    assert.equal(byName.u_quantite.value, '2'); // la variable l'emporte sur la valeur fixée
    assert.equal(byName.u_referent.display, 'Alice Martin');
    assert.equal(ticket.variables.length, 6);
    assert.deepEqual(ticket.variables.find((v) => v.key === 'remarque'), { key: 'remarque', label: 'Remarque', type: 'textarea', value: 'Merci !' });

    // Sans réponse à une variable mappée : la valeur fixée reste.
    const t2 = (await ctx.api.post(`/api/catalog/${item.id}/submit`).set(bob.auth).send({ answers: { objet: 'Mur', outil: 'Scie' } }).expect(201)).body;
    assert.equal(t2.fields.find((f) => f.name === 'u_quantite').value, '1');
    assert.equal(t2.priority, 'low');
  });

  test('fiche : droits de modification par champ, historique', async () => {
    const byName = (t) => Object.fromEntries(t.fields.map((f) => [f.name, f]));
    // Bob (auteur) : « Quantité » (droit editors) oui, « Matériel » (handlers) non.
    assert.equal(byName(ticket).u_quantite.canWrite, true);
    const bobView = (await ctx.api.get(`/api/tickets/${ticket.id}`).set(bob.auth)).body;
    assert.equal(byName(bobView).u_materiel_prete.canWrite, false);
    await ctx.api.patch(`/api/tickets/${ticket.id}/fields`).set(bob.auth).send({ values: { u_materiel_prete: 'Scie' } }).expect(403);
    const after = (await ctx.api.patch(`/api/tickets/${ticket.id}/fields`).set(bob.auth).send({ values: { u_quantite: '3,5' } }).expect(200)).body;
    assert.equal(byName(after).u_quantite.value, '3.5');
    await ctx.api.patch(`/api/tickets/${ticket.id}/fields`).set(bob.auth).send({ values: { u_quantite: 'trois' } }).expect(400);

    // Alice traite la demande (assignée) : elle peut changer le matériel.
    await ctx.api.patch(`/api/tickets/${ticket.id}`).set(admin.auth).send({ assigned_to: alice.user.id }).expect(200);
    const a = (await ctx.api.patch(`/api/tickets/${ticket.id}/fields`).set(alice.auth).send({ values: { u_materiel_prete: 'Scie', u_referent: null } }).expect(200)).body;
    assert.equal(byName(a).u_materiel_prete.value, 'Scie');
    assert.equal(byName(a).u_referent.value, null);
    const events = a.events.filter((e) => e.type === 'field').map((e) => JSON.parse(e.to));
    assert.deepEqual(events.at(-2), { label: 'Matériel prêté', from: 'Perceuse', to: 'Scie' });
    assert.deepEqual(events.at(-1), { label: 'Référent', from: 'Alice Martin', to: null });
  });

  test('un champ utilisé par un formulaire ne peut être ni supprimé, ni désactivé, ni perdre un choix utilisé', async () => {
    let r = await ctx.api.delete(`/api/admin/ticket-fields/${fMateriel.id}`).set(admin.auth).expect(409);
    assert.match(r.body.error, /Prêt de matériel/);
    await ctx.api.patch(`/api/admin/ticket-fields/${fMateriel.id}`).set(admin.auth).send({ active: false }).expect(409);
    r = await ctx.api.patch(`/api/admin/ticket-fields/${fMateriel.id}`).set(admin.auth).send({ options: ['Perceuse', 'Ponceuse'] }).expect(409);
    assert.match(r.body.error, /Choix encore utilisés/);
    // Un choix non utilisé peut partir ; le libellé change librement.
    await ctx.api.patch(`/api/admin/ticket-fields/${fMateriel.id}`).set(admin.auth).send({ options: ['Perceuse', 'Scie'], label: 'Outil prêté' }).expect(200);

    const vars = (await ctx.api.get('/api/admin/variables').set(admin.auth).expect(200)).body.variables;
    const outil = vars.find((v) => v.key === 'outil');
    assert.equal(outil.mapLabel, 'Outil prêté');
    assert.equal(outil.answers, 2);
    assert.equal(vars.find((v) => v.key === 'objet').mapLabel, 'Titre');
  });

  test('rapports : champs personnalisés en colonne, regroupement et filtre', async () => {
    const preview = (definition) => ctx.api.post('/api/analytics/preview').set(admin.auth).send({ definition });
    const list = (await preview({ type: 'list', columns: ['id', 'u_materiel_prete', 'u_quantite'], filters: {} }).expect(200)).body.result;
    assert.deepEqual(list.columns.map((c) => c.label), ['N°', 'Outil prêté', 'Quantité']);
    assert.equal(list.columns[2].kind, 'number');
    const row = list.rows.find((x) => x.id === ticket.id);
    assert.equal(row.u_materiel_prete, 'Scie');
    assert.equal(row.u_quantite, 3.5);

    const sum = (await preview({ type: 'summary', dimension: 'u_materiel_prete', filters: {} }).expect(200)).body.result;
    assert.deepEqual(
      sum.categories.map((c) => c.label).sort(),
      ['Scie']
    );
    assert.equal(sum.series[0].values[0], 2);
    const filtered = (await preview({ type: 'list', filters: { fields: [{ key: 'u_quantite', op: 'range', min: '2' }] } }).expect(200)).body.result;
    assert.deepEqual(filtered.rows.map((x) => x.id), [ticket.id]);
    await preview({ type: 'list', filters: { fields: [{ key: 'u_materiel_prete', op: 'in', values: ['Tondeuse'] }] } }).expect(400);
    await preview({ type: 'summary', dimension: 'u_quantite', filters: {} }).expect(400);

    const meta = (await ctx.api.get('/api/analytics/meta').set(bob.auth).expect(200)).body;
    assert.ok(meta.fields.some((f) => f.key === 'u_referent' && f.kind === 'user' && f.groupable));
  });

  test('rapports : variables d’un formulaire, seulement quand il est le seul choisi', async () => {
    const preview = (definition) => ctx.api.post('/api/analytics/preview').set(admin.auth).send({ definition });
    const vars = (await ctx.api.get(`/api/analytics/forms/${item.id}/variables`).set(bob.auth).expect(200)).body.variables;
    assert.ok(vars.some((v) => v.key === `var_${item.id}_remarque` && v.kind === 'text'));
    assert.ok(vars.some((v) => v.key === `var_${item.id}_urgence` && v.groupable));

    const key = `var_${item.id}_remarque`;
    let r = await preview({ type: 'list', columns: ['id', key], filters: {} }).expect(200);
    assert.ok(!r.body.result.columns.some((c) => c.key === key)); // sans formulaire choisi : colonne ignorée
    r = await preview({ type: 'list', columns: ['id', key], filters: { form: [String(item.id)] } }).expect(200);
    assert.equal(r.body.result.rows.find((x) => x.id === ticket.id)[key], 'Merci !');

    const sum = (await preview({ type: 'summary', dimension: `var_${item.id}_urgence`, filters: { form: [String(item.id)] } }).expect(200)).body.result;
    assert.deepEqual(sum.categories.map((c) => c.label).sort(), ['Haute', 'Non renseigné']);
    const err = await preview({ type: 'summary', dimension: `var_${item.id}_urgence`, filters: {} }).expect(400);
    assert.match(err.body.error, /choisissez son formulaire/);
    const f = (
      await preview({ type: 'list', filters: { form: [String(item.id)], fields: [{ key: `var_${item.id}_combien`, op: 'range', min: '2', max: '2' }] } }).expect(200)
    ).body.result;
    assert.deepEqual(f.rows.map((x) => x.id), [ticket.id]);

    // Rapport enregistré dont le champ disparaît ensuite : la colonne est retirée sans erreur.
    const tmp = (await ctx.api.post('/api/admin/ticket-fields').set(admin.auth).send({ label: 'Éphémère', type: 'text' }).expect(201)).body;
    const rep = (
      await ctx.api.post('/api/analytics/reports').set(admin.auth).send({ name: 'Avec éphémère', definition: { type: 'list', columns: ['id', 'u_ephemere'], filters: { fields: [{ key: 'u_ephemere', op: 'filled' }] } } }).expect(201)
    ).body.report;
    await ctx.api.delete(`/api/admin/ticket-fields/${tmp.id}`).set(admin.auth).expect(200);
    const run = (await ctx.api.get(`/api/analytics/reports/${rep.id}/run`).set(admin.auth).expect(200)).body.result;
    assert.deepEqual(run.columns.map((c) => c.key), ['id']);
  });

  test('mise à niveau : « compléter le titre » devient un mappage, anciennes réponses rangées en variables', async () => {
    const now = new Date().toISOString();
    const { lastID: legacy } = await ctx.db.run(
      'INSERT INTO catalog_items (name, fields, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['Ancien', JSON.stringify([{ key: 'poste', label: 'Poste', type: 'text', inTitle: true }]), now, now]
    );
    const { lastID: t } = await ctx.db.run(
      "INSERT INTO tickets (title, description, priority, status, created_at, updated_at, created_by, catalog_item, form_answers) VALUES ('Ancien : 12', '', 'low', 'open', ?, ?, ?, ?, ?)",
      [now, now, bob.user.id, legacy, JSON.stringify([{ key: 'poste', label: 'Poste', type: 'text', value: '12' }])]
    );
    assert.equal(await upgradeProducers(ctx.db), 1);
    assert.equal(await upgradeProducers(ctx.db), 0);
    const fields = JSON.parse((await ctx.db.get('SELECT fields FROM catalog_items WHERE id = ?', [legacy])).fields);
    assert.deepEqual(fields, [{ key: 'poste', label: 'Poste', type: 'text', mapTo: 'title' }]);
    const v = await ctx.db.all('SELECT var_key, value, item_id FROM ticket_variables WHERE ticket_id = ?', [t]);
    assert.deepEqual(v, [{ var_key: 'poste', value: '12', item_id: legacy }]);
  });

  test('export des données : champs renseignés et variables des demandes', async () => {
    const data = (await ctx.api.get('/api/auth/me/export').set(bob.auth).expect(200)).body;
    const r = data.requests.find((x) => x.id === ticket.id);
    assert.ok(r.custom_fields.some((f) => f.field === 'Outil prêté' && f.value === 'Scie'));
    assert.ok(r.form_answers.some((a) => a.key === 'remarque'));
  });
});

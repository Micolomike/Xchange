const express = require('express');
const { HttpError, parseId, nowIso, displayName } = require('../utils');
const F = require('../ticketFields');

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Formulaires qui utilisent un champ (variable associée ou valeur fixée). */
async function producersUsing(db, name) {
  const items = await db.all('SELECT id, name, fields, field_values FROM catalog_items ORDER BY name COLLATE NOCASE');
  return items
    .filter((it) => parseJson(it.fields, []).some((v) => v.mapTo === name) || Object.prototype.hasOwnProperty.call(parseJson(it.field_values, {}), name))
    .map((it) => ({ id: it.id, name: it.name }));
}

/** Champs personnalisés : lecture pour tout compte connecté (fiche de demande, rapports), choix de personnes. */
function ticketFieldRoutes({ db }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const fields = await F.loadCustomFields(db, { activeOnly: true });
    const groups = await db.all('SELECT id, name FROM user_groups ORDER BY name COLLATE NOCASE');
    res.json({ fields, groups });
  });

  // Recherche de personnes pour un champ « Référence : utilisateur ».
  router.get('/people', async (req, res) => {
    // ?ids=1,2 : noms de personnes déjà choisies (affichage d'une valeur enregistrée).
    if (typeof req.query.ids === 'string') {
      const ids = req.query.ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
      const rows = ids.length
        ? await db.all(
            `SELECT id, username, CASE WHEN hide_real_name = 1 THEN '' ELSE firstname END AS firstname, CASE WHEN hide_real_name = 1 THEN '' ELSE lastname END AS lastname
             FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
          )
        : [];
      return res.json({ people: rows.map((u) => ({ id: u.id, name: displayName(u), username: u.username })) });
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await db.all(
      `SELECT id, username, CASE WHEN hide_real_name = 1 THEN '' ELSE firstname END AS firstname, CASE WHEN hide_real_name = 1 THEN '' ELSE lastname END AS lastname
       FROM users WHERE anonymized_at IS NULL
       AND (? = '' OR username LIKE ? ESCAPE '\\' OR (hide_real_name = 0 AND (firstname LIKE ? ESCAPE '\\' OR lastname LIKE ? ESCAPE '\\'
         OR (firstname || ' ' || lastname) LIKE ? ESCAPE '\\')))
       ORDER BY username LIMIT 20`,
      [q, like, like, like, like]
    );
    res.json({ people: rows.map((u) => ({ id: u.id, name: displayName(u), username: u.username })) });
  });

  return router;
}

/** Dictionnaire de la table des demandes et table des variables (administration). */
function ticketFieldAdminRoutes({ db }) {
  const router = express.Router();

  const findField = async (id) => {
    const row = await db.get('SELECT * FROM ticket_fields WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Champ introuvable.');
    return F.rowToField(row);
  };

  router.get('/', async (req, res) => {
    const custom = await F.loadCustomFields(db);
    const counts = new Map((await db.all('SELECT field_id, COUNT(*) AS n FROM ticket_field_values GROUP BY field_id')).map((r) => [r.field_id, r.n]));
    const out = [];
    for (const f of custom) out.push({ ...f, valueCount: counts.get(f.id) || 0, producers: await producersUsing(db, f.name) });
    const system = [];
    for (const f of F.SYSTEM_FIELDS) system.push({ ...f, producers: f.map ? await producersUsing(db, f.name) : [] });
    res.json({ system, custom: out, types: F.CUSTOM_TYPES, writeAccess: F.WRITE_ACCESS, compatible: F.COMPATIBLE, max: F.MAX_CUSTOM });
  });

  router.post('/', async (req, res) => {
    const v = F.validateCustomField(req.body || {}, { creating: true });
    if (v.type === 'select' && (v.options || []).length < 2) throw new HttpError(400, 'Le champ contient des erreurs.', { options: 'Au moins deux choix.' });
    if (v.type !== 'select') v.options = [];
    const n = (await db.get('SELECT COUNT(*) AS n FROM ticket_fields')).n;
    if (n >= F.MAX_CUSTOM) throw new HttpError(400, `${F.MAX_CUSTOM} champs personnalisés au plus.`);
    if (await db.get('SELECT 1 FROM ticket_fields WHERE name = ?', [v.name])) {
      throw new HttpError(400, 'Le champ contient des erreurs.', { name: 'Ce nom technique existe déjà.' });
    }
    const pos = (await db.get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ticket_fields')).p;
    const now = nowIso();
    const { lastID } = await db.run(
      'INSERT INTO ticket_fields (name, label, type, options, help, write_access, active, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.name, v.label, v.type, JSON.stringify(v.options), v.help, v.write, v.active ? 1 : 0, pos, now, now]
    );
    res.status(201).json(await findField(lastID));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Champ');
    const field = await findField(id);
    const v = F.validateCustomField(req.body || {}, { creating: false });
    if ('options' in v) {
      if (field.type !== 'select') delete v.options;
      else if (v.options.length < 2) throw new HttpError(400, 'Le champ contient des erreurs.', { options: 'Au moins deux choix.' });
    }
    // Un formulaire qui alimente ce champ doit rester cohérent : on refuse ce qui le casserait.
    const producers = await producersUsing(db, field.name);
    if (producers.length && v.active === false) {
      throw new HttpError(409, `Ce champ est utilisé par : ${producers.map((p) => p.name).join(', ')}. Retirez-le de ces formulaires avant de le désactiver.`);
    }
    if (producers.length && v.options) {
      const removed = field.options.filter((o) => !v.options.includes(o));
      if (removed.length) {
        const items = await db.all('SELECT name, fields, field_values FROM catalog_items');
        const blocking = items.filter(
          (it) =>
            parseJson(it.fields, []).some((x) => x.mapTo === field.name && (x.type === 'yesno' ? ['Oui', 'Non'] : x.options || []).some((o) => removed.includes(o))) ||
            removed.includes(parseJson(it.field_values, {})[field.name])
        );
        if (blocking.length) {
          throw new HttpError(409, `Choix encore utilisés par : ${blocking.map((b) => b.name).join(', ')}. Modifiez ces formulaires d'abord.`);
        }
      }
    }
    const map = { label: 'label', help: 'help', write: 'write_access', active: 'active', options: 'options' };
    const cols = Object.keys(map).filter((k) => k in v);
    if (cols.length) {
      const val = (k) => (k === 'active' ? (v.active ? 1 : 0) : k === 'options' ? JSON.stringify(v.options) : v[k]);
      await db.run(`UPDATE ticket_fields SET ${cols.map((k) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map(val), nowIso(), id]);
    }
    res.json(await findField(id));
  });

  router.post('/reorder', async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const existing = (await db.all('SELECT id FROM ticket_fields')).map((r) => r.id);
    if (ids.length !== existing.length || ids.some((i) => !existing.includes(i))) throw new HttpError(400, 'Ordre invalide. Actualisez la page.');
    for (const [i, id] of ids.entries()) await db.run('UPDATE ticket_fields SET position = ? WHERE id = ?', [i + 1, id]);
    res.json({ success: true });
  });

  // Suppression définitive : le champ et toutes ses valeurs. Refusée tant qu'un formulaire l'utilise.
  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Champ');
    const field = await findField(id);
    const producers = await producersUsing(db, field.name);
    if (producers.length) {
      throw new HttpError(409, `Ce champ est utilisé par : ${producers.map((p) => p.name).join(', ')}. Retirez-le de ces formulaires avant de le supprimer.`);
    }
    await db.run('DELETE FROM ticket_fields WHERE id = ?', [id]);
    res.json({ success: true });
  });

  return router;
}

/** Table des variables : toutes les variables de tous les formulaires, avec leur champ associé. */
function variableAdminRoutes({ db }) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    const items = await db.all('SELECT id, name, active, fields FROM catalog_items ORDER BY name COLLATE NOCASE');
    const counts = new Map(
      (await db.all('SELECT item_id, var_key, COUNT(*) AS n FROM ticket_variables WHERE item_id IS NOT NULL GROUP BY item_id, var_key')).map((r) => [
        `${r.item_id}|${r.var_key}`,
        r.n,
      ])
    );
    const custom = new Map((await F.loadCustomFields(db)).map((f) => [f.name, f.label]));
    const system = new Map(F.SYSTEM_FIELDS.map((f) => [f.name, f.label]));
    const variables = [];
    for (const it of items) {
      parseJson(it.fields, []).forEach((v, i) => {
        variables.push({
          producer: { id: it.id, name: it.name, active: Boolean(it.active) },
          order: i + 1,
          key: v.key,
          label: v.label,
          type: v.type,
          required: Boolean(v.required),
          options: v.options || [],
          mapTo: v.mapTo || null,
          mapLabel: v.mapTo ? system.get(v.mapTo) || custom.get(v.mapTo) || v.mapTo : null,
          answers: counts.get(`${it.id}|${v.key}`) || 0,
        });
      });
    }
    res.json({ variables });
  });
  return router;
}

module.exports = { ticketFieldRoutes, ticketFieldAdminRoutes, variableAdminRoutes, producersUsing };

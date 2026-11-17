/**
 * Dictionnaire de la table des demandes (comme le dictionnaire d'une table ServiceNow).
 *
 * - Champs système : les colonnes de la table `tickets`, décrites ici, non modifiables.
 * - Champs personnalisés : créés par un administrateur (nom technique « u_… »), valeurs rangées dans
 *   `ticket_field_values`, affichés sur la fiche de la demande, filtrables et reportables.
 *
 * Les variables d'un formulaire (record producer) peuvent être associées (« mappées ») à un champ :
 * à l'envoi, la réponse est recopiée dans ce champ. Les règles de compatibilité sont ici.
 */
const { HttpError, PRIORITIES, isValidDate, nowIso } = require('./utils');
const { getSetting } = require('./settings');

const CUSTOM_TYPES = {
  text: 'Texte court',
  textarea: 'Texte long',
  select: 'Liste de choix',
  number: 'Nombre',
  date: 'Date',
  yesno: 'Oui / Non',
  user: 'Référence : utilisateur',
  group: 'Référence : groupe',
};
const WRITE_ACCESS = {
  editors: "Auteur, administrateurs et droit « modifier »",
  handlers: 'Personnes qui traitent la demande (responsable, droit « traiter », administrateurs)',
  admins: 'Administrateurs seulement',
};
const NAME_RE = /^u_[a-z0-9_]{1,37}$/;
const MAX_CUSTOM = 100;
const MAX_OPTIONS = 50;

/** Champs système de la table des demandes, dans l'ordre du dictionnaire. `map` : alimentable par une variable. */
const SYSTEM_FIELDS = [
  { name: 'id', label: 'Numéro', type: 'integer', column: 'id' },
  { name: 'title', label: 'Titre', type: 'text', column: 'title', map: true, note: 'Le titre devient « Nom du formulaire : réponse ».' },
  { name: 'description', label: 'Description', type: 'textarea', column: 'description', map: true, note: 'La réponse est placée en tête, avant le récapitulatif de toutes les réponses.' },
  { name: 'status', label: 'Statut', type: 'choice', column: 'status' },
  { name: 'priority', label: 'Priorité', type: 'choice', column: 'priority', map: true, note: 'Les choix de la variable doivent porter les noms des priorités.' },
  { name: 'category', label: 'Catégorie', type: 'choice', column: 'category', map: true, note: 'Les choix de la variable doivent porter les noms des catégories.' },
  { name: 'due_date', label: 'Échéance', type: 'date', column: 'due_date', map: true },
  { name: 'confidential', label: 'Confidentielle', type: 'yesno', column: 'confidential', map: true },
  { name: 'assigned_group', label: "Groupe d'affectation", type: 'group', column: 'assigned_group', note: 'Fixé par le formulaire (groupe qui traite).' },
  { name: 'assigned_to', label: 'Responsable', type: 'user', column: 'assigned_to' },
  { name: 'created_by', label: 'Demandeur', type: 'user', column: 'created_by' },
  { name: 'catalog_item', label: 'Formulaire (record producer)', type: 'reference', column: 'catalog_item' },
  { name: 'created_at', label: 'Créée le', type: 'datetime', column: 'created_at' },
  { name: 'updated_at', label: 'Mise à jour le', type: 'datetime', column: 'updated_at' },
  { name: 'resolved_at', label: 'Résolue le', type: 'datetime', column: 'resolved_at' },
  { name: 'sla_resolution_due', label: 'Résolution attendue avant (SLA)', type: 'datetime', column: 'sla_resolution_due' },
];
const SYSTEM_BY_NAME = new Map(SYSTEM_FIELDS.map((f) => [f.name, f]));

/** Types de variable acceptés pour chaque type de champ cible. */
const COMPATIBLE = {
  title: ['text', 'select', 'radio', 'email'],
  description: ['text', 'textarea'],
  priority: ['select', 'radio'],
  category: ['select', 'radio'],
  due_date: ['date'],
  confidential: ['yesno', 'checkbox'],
  // Champs personnalisés, selon leur type.
  'custom:text': ['text', 'select', 'radio', 'email', 'number', 'date', 'yesno', 'checkbox'],
  'custom:textarea': ['text', 'textarea', 'select', 'radio', 'email'],
  'custom:select': ['select', 'radio', 'yesno'],
  'custom:number': ['number'],
  'custom:date': ['date'],
  'custom:yesno': ['yesno', 'checkbox'],
  'custom:user': [],
  'custom:group': [],
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};

function rowToField(r) {
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    type: r.type,
    options: parseJson(r.options, []),
    help: r.help || '',
    write: r.write_access,
    active: Boolean(r.active),
    position: r.position,
  };
}

/** Champs personnalisés (tous, ou seulement les actifs). */
async function loadCustomFields(db, { activeOnly = false } = {}) {
  const rows = await db.all(`SELECT * FROM ticket_fields ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY position, id`);
  return rows.map(rowToField);
}

/** Nom technique proposé à partir du libellé : « Numéro de série » → u_numero_de_serie. */
function suggestName(label) {
  const slug = String(label || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 37);
  return `u_${slug || 'champ'}`;
}

/** Valide la définition d'un champ personnalisé (création : tout ; modification : sans le nom ni le type). */
function validateCustomField(body, { creating }) {
  const errors = {};
  const v = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (creating) {
    v.name = str(body.name) || suggestName(body.label);
    if (!NAME_RE.test(v.name)) errors.name = 'Nom technique : « u_ » puis lettres minuscules, chiffres ou « _ » (40 caractères au plus).';
    v.type = body.type;
    if (!CUSTOM_TYPES[v.type]) errors.type = 'Type de champ inconnu.';
  }
  if (creating || has('label')) {
    v.label = str(body.label).replace(/\s+/g, ' ');
    if (v.label.length < 2) errors.label = 'Au moins 2 caractères.';
    else if (v.label.length > 80) errors.label = '80 caractères au plus.';
  }
  if (creating || has('help')) {
    v.help = str(body.help);
    if (v.help.length > 300) errors.help = '300 caractères au plus.';
  }
  if (creating || has('write')) {
    v.write = body.write || 'handlers';
    if (!WRITE_ACCESS[v.write]) errors.write = 'Droit de modification inconnu.';
  }
  if (creating || has('active')) v.active = body.active === undefined ? true : Boolean(body.active);
  if (has('options')) {
    const options = Array.isArray(body.options) ? [...new Set(body.options.map(str).filter(Boolean))] : [];
    if (options.some((o) => o.length > 100)) errors.options = 'Un choix fait plus de 100 caractères.';
    if (options.length > MAX_OPTIONS) errors.options = `${MAX_OPTIONS} choix au plus.`;
    v.options = options;
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Le champ contient des erreurs.', errors);
  return v;
}

/**
 * Contrôle et normalise la valeur d'un champ personnalisé. Renvoie null pour « vide ».
 * `ctx` : { userIds: Set, groupIds: Set } pour les références (facultatif : contrôle en base sinon).
 */
async function normalizeValue(db, field, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = typeof raw === 'string' ? raw.trim() : String(raw);
  if (s === '') return null;
  const bad = (msg) => {
    throw new HttpError(400, `« ${field.label} » : ${msg}`);
  };
  switch (field.type) {
    case 'text':
      return s.length > 500 ? bad('500 caractères au plus.') : s;
    case 'textarea':
      return s.length > 5000 ? bad('5 000 caractères au plus.') : s;
    case 'select':
      return field.options.includes(s) ? s : bad('choix inconnu.');
    case 'number': {
      const n = s.replace(',', '.');
      return /^-?\d+(\.\d+)?$/.test(n) && n.length <= 30 ? n : bad('nombre attendu.');
    }
    case 'date':
      return isValidDate(s.slice(0, 10)) && s.length === 10 ? s : bad('date invalide.');
    case 'yesno':
      if (['oui', 'true', '1'].includes(s.toLowerCase())) return 'Oui';
      if (['non', 'false', '0'].includes(s.toLowerCase())) return 'Non';
      return bad('« Oui » ou « Non » attendu.');
    case 'user': {
      const id = Number(s);
      if (!Number.isInteger(id) || id <= 0) bad('utilisateur invalide.');
      const u = await db.get('SELECT id FROM users WHERE id = ? AND anonymized_at IS NULL', [id]);
      return u ? String(id) : bad("cet utilisateur n'existe plus.");
    }
    case 'group': {
      const id = Number(s);
      if (!Number.isInteger(id) || id <= 0) bad('groupe invalide.');
      const g = await db.get('SELECT id FROM user_groups WHERE id = ?', [id]);
      return g ? String(id) : bad("ce groupe n'existe plus.");
    }
    default:
      return bad('type inconnu.');
  }
}

/** Valeurs des champs personnalisés d'une demande, prêtes pour l'affichage (références traduites en noms). */
async function loadTicketFieldValues(db, ticketId, fields) {
  const rows = await db.all('SELECT field_id, value FROM ticket_field_values WHERE ticket_id = ?', [ticketId]);
  const byId = new Map(rows.map((r) => [r.field_id, r.value]));
  const out = [];
  for (const f of fields) {
    const value = byId.has(f.id) ? byId.get(f.id) : null;
    if (!f.active && value == null) continue;
    let display = value;
    if (value != null && f.type === 'user') {
      const u = await db.get(
        "SELECT username, CASE WHEN hide_real_name = 1 THEN '' ELSE firstname END AS firstname, CASE WHEN hide_real_name = 1 THEN '' ELSE lastname END AS lastname FROM users WHERE id = ?",
        [Number(value)]
      );
      display = u ? [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username : 'Compte supprimé';
    } else if (value != null && f.type === 'group') {
      display = (await db.get('SELECT name FROM user_groups WHERE id = ?', [Number(value)]))?.name || 'Groupe supprimé';
    }
    if (value != null && f.type === 'date') display = value.split('-').reverse().join('/');
    if (value != null && f.type === 'number') display = value.replace('.', ',');
    out.push({ ...f, value, display });
  }
  return out;
}

/** La personne peut-elle modifier ce champ sur cette demande ? */
function canWriteField(field, user, ticket, perms) {
  if (user.role === 'admin') return true;
  if (field.write === 'admins') return false;
  if (field.write === 'editors') return Boolean(perms.canEdit);
  const rights = user.access?.rights || {};
  return Boolean(rights.work || rights.assign || ticket.assignee?.id === user.id);
}

/** Enregistre une valeur (null : efface). Renvoie { from, to } si elle a changé, sinon null. */
async function setFieldValue(db, ticketId, field, value) {
  const current = (await db.get('SELECT value FROM ticket_field_values WHERE ticket_id = ? AND field_id = ?', [ticketId, field.id]))?.value ?? null;
  if (current === value) return null;
  if (value == null) await db.run('DELETE FROM ticket_field_values WHERE ticket_id = ? AND field_id = ?', [ticketId, field.id]);
  else {
    await db.run(
      'INSERT INTO ticket_field_values (ticket_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(ticket_id, field_id) DO UPDATE SET value = excluded.value',
      [ticketId, field.id, value]
    );
  }
  return { from: current, to: value };
}

// ---------------------------------------------------------------------------------------------------
// Mappage variable → champ

/** Clé de compatibilité d'un champ cible. */
function targetKind(target, customByName) {
  if (SYSTEM_BY_NAME.get(target)?.map) return target;
  const c = customByName.get(target);
  return c ? `custom:${c.type}` : null;
}

/** Libellé d'un choix de priorité / catégorie → clé, ou null. */
async function choiceMaps(db) {
  const priorities = await getSetting(db, 'priorities');
  const categories = (await getSetting(db, 'categories')).filter((c) => c.active);
  const norm = (s) => String(s).trim().toLowerCase();
  const pMap = new Map();
  for (const k of PRIORITIES) {
    pMap.set(norm(k), k);
    if (priorities?.[k]?.label) pMap.set(norm(priorities[k].label), k);
  }
  const cMap = new Map();
  for (const c of categories) {
    cMap.set(norm(c.key), c.key);
    cMap.set(norm(c.label), c.key);
  }
  return { priority: (v) => pMap.get(norm(v)) ?? null, category: (v) => cMap.get(norm(v)) ?? null };
}

/**
 * Vérifie les mappages des variables d'un formulaire et ses valeurs fixées.
 * Renvoie la liste des problèmes (vide si tout va bien) et les valeurs fixées normalisées.
 */
async function checkProducerMapping(db, variables, fieldValues = {}) {
  const custom = await loadCustomFields(db);
  const customByName = new Map(custom.map((f) => [f.name, f]));
  const maps = await choiceMaps(db);
  const problems = [];
  const used = new Map();
  for (const v of variables) {
    if (!v.mapTo) continue;
    const kind = targetKind(v.mapTo, customByName);
    const name = `« ${v.label} »`;
    if (!kind) {
      problems.push(`${name} : le champ « ${v.mapTo} » n'existe pas.`);
      continue;
    }
    if (used.has(v.mapTo)) problems.push(`${name} et « ${used.get(v.mapTo)} » alimentent le même champ.`);
    used.set(v.mapTo, v.label);
    if (!COMPATIBLE[kind].includes(v.type)) {
      problems.push(`${name} : une variable de ce type ne peut pas alimenter ce champ.`);
      continue;
    }
    const field = customByName.get(v.mapTo);
    if (field && !field.active) problems.push(`${name} : le champ « ${field.label} » est désactivé.`);
    const options = v.type === 'yesno' ? ['Oui', 'Non'] : v.options || [];
    if (kind === 'priority' || kind === 'category') {
      const unknown = options.filter((o) => !maps[kind](o));
      if (unknown.length) problems.push(`${name} : choix sans ${kind === 'priority' ? 'priorité' : 'catégorie'} correspondante : ${unknown.join(', ')}.`);
    }
    if (kind === 'custom:select') {
      const unknown = options.filter((o) => !field.options.includes(o));
      if (unknown.length) problems.push(`${name} : choix absents du champ « ${field.label} » : ${unknown.join(', ')}.`);
    }
  }
  // Valeurs fixées : champs personnalisés uniquement.
  const fixed = {};
  for (const [name, raw] of Object.entries(fieldValues || {})) {
    const field = customByName.get(name);
    if (!field) {
      problems.push(`Valeur fixée : le champ « ${name} » n'existe pas.`);
      continue;
    }
    try {
      const v = await normalizeValue(db, field, raw);
      if (v != null) fixed[name] = v;
    } catch (err) {
      problems.push(`Valeur fixée : ${err.message}`);
    }
  }
  return { problems, fixed };
}

/**
 * Calcule ce qu'un envoi de formulaire écrit dans la demande : colonnes système et champs personnalisés.
 * `answers` : réponses validées [{ key, label, type, value }].
 */
async function applyProducer(db, item, answers) {
  const custom = await loadCustomFields(db);
  const customByName = new Map(custom.map((f) => [f.name, f]));
  const maps = await choiceMaps(db);
  const byKey = new Map(answers.map((a) => [a.key, a]));
  const system = {};
  const fields = new Map();
  // 1. Valeurs fixées par le formulaire.
  for (const [name, value] of Object.entries(item.field_values || {})) {
    const f = customByName.get(name);
    if (f?.active) fields.set(f.id, { field: f, value });
  }
  // 2. Variables mappées (une réponse vide ne remplace pas une valeur fixée).
  for (const v of item.fields || []) {
    if (!v.mapTo) continue;
    const a = byKey.get(v.key);
    if (!a || a.value === '' || a.value == null) continue;
    const value = String(a.value);
    if (v.mapTo === 'title') system.title = value;
    else if (v.mapTo === 'description') system.description = value;
    else if (v.mapTo === 'priority') system.priority = maps.priority(value) || undefined;
    else if (v.mapTo === 'category') system.category = maps.category(value) || undefined;
    else if (v.mapTo === 'due_date') system.due_date = isValidDate(value) ? value : undefined;
    else if (v.mapTo === 'confidential') system.confidential = value === 'Oui';
    else {
      const f = customByName.get(v.mapTo);
      if (!f?.active) continue;
      try {
        const normalized = await normalizeValue(db, f, f.type === 'text' ? value.slice(0, 500) : value);
        if (normalized != null) fields.set(f.id, { field: f, value: normalized });
      } catch {
        // Valeur incompatible (formulaire modifié entre-temps) : la réponse reste dans les variables.
      }
    }
  }
  for (const k of Object.keys(system)) if (system[k] === undefined) delete system[k];
  return { system, fields: [...fields.values()] };
}

/** Range les réponses dans la table des variables. */
async function saveVariables(db, ticketId, itemId, answers) {
  let i = 0;
  for (const a of answers) {
    await db.run('INSERT INTO ticket_variables (ticket_id, item_id, var_key, label, type, value, position) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      ticketId,
      itemId,
      a.key,
      a.label,
      a.type,
      String(a.value ?? ''),
      i++,
    ]);
  }
}

/**
 * Mise à niveau des données (au démarrage, sans effet si déjà faite) :
 * - « compléter le titre » des anciens formulaires devient un mappage vers le champ Titre ;
 * - les réponses déjà envoyées sont rangées dans la table des variables.
 */
async function upgradeProducers(db) {
  const items = await db.all('SELECT id, fields FROM catalog_items');
  for (const it of items) {
    const vars = parseJson(it.fields, []);
    if (!Array.isArray(vars) || !vars.some((v) => 'inTitle' in v)) continue;
    const next = vars.map(({ inTitle, ...v }) => (inTitle && !v.mapTo ? { ...v, mapTo: 'title' } : v));
    await db.run('UPDATE catalog_items SET fields = ? WHERE id = ?', [JSON.stringify(next), it.id]);
  }
  const tickets = await db.all(
    `SELECT t.id, t.catalog_item, t.form_answers FROM tickets t
     WHERE t.form_answers IS NOT NULL AND t.form_answers != '' AND NOT EXISTS (SELECT 1 FROM ticket_variables v WHERE v.ticket_id = t.id)`
  );
  let n = 0;
  for (const t of tickets) {
    const answers = parseJson(t.form_answers, []);
    if (!Array.isArray(answers) || !answers.length) continue;
    const item = t.catalog_item && (await db.get('SELECT id FROM catalog_items WHERE id = ?', [t.catalog_item]));
    await saveVariables(db, t.id, item ? item.id : null, answers.filter((a) => a && a.key));
    n += 1;
  }
  return n;
}

module.exports = {
  CUSTOM_TYPES,
  WRITE_ACCESS,
  SYSTEM_FIELDS,
  COMPATIBLE,
  MAX_CUSTOM,
  loadCustomFields,
  suggestName,
  validateCustomField,
  normalizeValue,
  loadTicketFieldValues,
  canWriteField,
  setFieldValue,
  checkProducerMapping,
  applyProducer,
  saveVariables,
  upgradeProducers,
  rowToField,
  nowIso,
};

const { HttpError, PRIORITIES, isValidDate } = require('./utils');

/** Types de champ proposés dans le constructeur de formulaires. */
const FIELD_TYPES = ['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number', 'email', 'file'];
const CHOICE_TYPES = ['select', 'radio'];
// Opérateurs des règles d'affichage : « afficher ce champ si … ».
const CONDITION_OPS = ['equals', 'not_equals', 'checked', 'not_checked', 'filled', 'empty'];

const KEY_RE = /^[a-z0-9_]{1,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELDS = 60;
const MAX_OPTIONS = 50;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function validateField(raw, index, previous) {
  const where = `Champ ${index + 1}`;
  const errors = [];
  const field = {
    key: str(raw.key),
    label: str(raw.label),
    type: raw.type,
    required: Boolean(raw.required),
    help: str(raw.help),
    placeholder: str(raw.placeholder),
    inTitle: Boolean(raw.inTitle),
  };
  if (!KEY_RE.test(field.key)) errors.push(`${where} : identifiant technique invalide.`);
  if (!field.label) errors.push(`${where} : le libellé est requis.`);
  else if (field.label.length > 200) errors.push(`${where} : libellé trop long (200 caractères maximum).`);
  if (!FIELD_TYPES.includes(field.type)) errors.push(`${where} : type de champ inconnu.`);
  if (field.help.length > 500) errors.push(`${where} : aide trop longue (500 caractères maximum).`);
  if (field.placeholder.length > 200) field.placeholder = field.placeholder.slice(0, 200);
  if (field.inTitle && field.type !== 'text') field.inTitle = false;

  if (CHOICE_TYPES.includes(field.type)) {
    const options = Array.isArray(raw.options) ? [...new Set(raw.options.map(str).filter(Boolean))] : [];
    if (options.length < 2) errors.push(`« ${field.label || where} » : au moins deux choix.`);
    if (options.length > MAX_OPTIONS) errors.push(`« ${field.label || where} » : ${MAX_OPTIONS} choix maximum.`);
    if (options.some((o) => o.length > 200)) errors.push(`« ${field.label || where} » : choix trop long.`);
    field.options = options;
  }

  if (raw.condition && raw.condition.field) {
    const source = previous.find((f) => f.key === raw.condition.field);
    const op = raw.condition.op;
    if (!source) {
      errors.push(`« ${field.label || where} » : la règle d'affichage doit porter sur un champ placé avant lui.`);
    } else if (!CONDITION_OPS.includes(op)) {
      errors.push(`« ${field.label || where} » : règle d'affichage inconnue.`);
    } else {
      const condition = { field: source.key, op };
      if (op === 'equals' || op === 'not_equals') {
        condition.value = str(raw.condition.value);
        if (CHOICE_TYPES.includes(source.type) && !source.options?.includes(condition.value)) {
          errors.push(`« ${field.label || where} » : choisissez une valeur de « ${source.label} » pour la règle.`);
        }
      }
      if ((op === 'checked' || op === 'not_checked') && source.type !== 'checkbox') {
        errors.push(`« ${field.label || where} » : « coché » ne s'applique qu'à une case à cocher.`);
      }
      field.condition = condition;
    }
  }
  return { field, errors };
}

/** Valide la définition d'un formulaire envoyée par le constructeur. */
function validateItemInput(body, { partial = false } = {}) {
  const errors = {};
  const values = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('name')) {
    values.name = str(body.name).replace(/\s+/g, ' ');
    if (values.name.length < 2) errors.name = 'Au moins 2 caractères.';
    else if (values.name.length > 120) errors.name = '120 caractères maximum.';
  }
  if (!partial || has('description')) {
    values.description = str(body.description);
    if (values.description.length > 2000) errors.description = '2 000 caractères maximum.';
  }
  if (!partial || has('section')) {
    values.section = str(body.section).replace(/\s+/g, ' ');
    if (values.section.length > 60) errors.section = '60 caractères maximum.';
  }
  if (!partial || has('priority')) {
    values.priority = body.priority || 'medium';
    if (!PRIORITIES.includes(values.priority)) errors.priority = 'Priorité inconnue.';
  }
  if (!partial || has('active')) values.active = body.active === undefined ? true : Boolean(body.active);
  if (!partial || has('fulfillment_group')) {
    const raw = body.fulfillment_group;
    if (raw === null || raw === '' || raw === undefined) values.fulfillment_group = null;
    else if (!Number.isInteger(Number(raw)) || Number(raw) <= 0) errors.fulfillment_group = 'Groupe invalide.';
    else values.fulfillment_group = Number(raw);
  }
  if (!partial || has('visible_groups')) {
    const list = body.visible_groups == null ? [] : body.visible_groups;
    if (!Array.isArray(list) || list.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
      errors.visible_groups = 'Liste de groupes invalide.';
    } else values.visible_groups = [...new Set(list.map(Number))];
  }
  if (!partial || has('fields')) {
    const list = Array.isArray(body.fields) ? body.fields : null;
    if (!list) errors.fields = 'Liste de champs invalide.';
    else if (list.length > MAX_FIELDS) errors.fields = `${MAX_FIELDS} champs maximum.`;
    else {
      const fields = [];
      const problems = [];
      for (const [i, raw] of list.entries()) {
        const { field, errors: e } = validateField(raw || {}, i, fields);
        if (fields.some((f) => f.key === field.key)) problems.push(`Champ ${i + 1} : identifiant en double.`);
        problems.push(...e);
        fields.push(field);
      }
      if (fields.filter((f) => f.inTitle).length > 1) problems.push('Un seul champ peut compléter le titre du ticket.');
      if (problems.length) errors.fields = problems.join(' ');
      values.fields = fields;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Le formulaire contient des erreurs.', errors);
  return values;
}

const isEmpty = (v) => v === undefined || v === null || v === '' || v === false;

/** Le champ est-il affiché, compte tenu des réponses déjà données ? */
function isFieldVisible(field, answers, byKey) {
  const c = field.condition;
  if (!c) return true;
  const source = byKey.get(c.field);
  if (!source || !isFieldVisible(source, answers, byKey)) return false;
  const v = answers[c.field];
  switch (c.op) {
    case 'equals':
      return String(v ?? '') === c.value;
    case 'not_equals':
      return String(v ?? '') !== c.value;
    case 'checked':
      return v === true;
    case 'not_checked':
      return v !== true;
    case 'filled':
      return !isEmpty(v);
    case 'empty':
      return isEmpty(v);
    default:
      return true;
  }
}

/**
 * Contrôle les réponses d'un utilisateur. Les champs masqués par une règle sont ignorés,
 * les pièces jointes sont envoyées à part (ticket créé d'abord).
 */
function validateSubmission(fields, raw = {}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const answers = {};
  // Normalise d'abord, pour que les règles s'appuient sur des valeurs propres.
  for (const f of fields) {
    const v = raw[f.key];
    if (f.type === 'checkbox') answers[f.key] = v === true || v === 'true';
    else if (f.type === 'file') answers[f.key] = Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0;
    else if (f.type === 'number') answers[f.key] = v === '' || v == null ? '' : String(v).trim();
    else answers[f.key] = typeof v === 'string' ? v.trim() : '';
  }

  const errors = {};
  const out = [];
  for (const f of fields) {
    if (!isFieldVisible(f, answers, byKey)) continue;
    const v = answers[f.key];
    if (f.type === 'file') {
      if (f.required && !v) errors[f.key] = 'Ajoutez au moins un fichier.';
      if (v) out.push({ key: f.key, label: f.label, type: f.type, value: `${v} fichier${v > 1 ? 's' : ''} joint${v > 1 ? 's' : ''}` });
      continue;
    }
    if (f.type === 'checkbox') {
      if (f.required && !v) errors[f.key] = 'Cette case doit être cochée.';
      out.push({ key: f.key, label: f.label, type: f.type, value: v ? 'Oui' : 'Non' });
      continue;
    }
    if (isEmpty(v)) {
      if (f.required) errors[f.key] = 'Ce champ est requis.';
      continue;
    }
    if (f.type === 'textarea' ? v.length > 5000 : v.length > 500) errors[f.key] = 'Réponse trop longue.';
    else if (CHOICE_TYPES.includes(f.type) && !f.options.includes(v)) errors[f.key] = 'Choix inconnu.';
    else if (f.type === 'date' && !isValidDate(v)) errors[f.key] = 'Date invalide.';
    else if (f.type === 'number' && !/^-?\d+([.,]\d+)?$/.test(v)) errors[f.key] = 'Nombre attendu.';
    else if (f.type === 'email' && !EMAIL_RE.test(v)) errors[f.key] = 'Adresse e-mail invalide.';
    out.push({ key: f.key, label: f.label, type: f.type, value: v });
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Certaines réponses sont à compléter.', errors);
  return out;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Description lisible du ticket, reprise aussi par la recherche plein texte. */
function describeAnswers(itemName, answers) {
  const lines = answers.map((a) => {
    const value = a.type === 'date' ? formatDate(a.value) : a.value;
    return a.type === 'textarea' && value.includes('\n') ? `${a.label} :\n${value}` : `${a.label} : ${value}`;
  });
  return [`Demande faite avec le formulaire « ${itemName} ».`, '', ...lines].join('\n');
}

module.exports = {
  FIELD_TYPES,
  CONDITION_OPS,
  validateItemInput,
  validateSubmission,
  isFieldVisible,
  describeAnswers,
};

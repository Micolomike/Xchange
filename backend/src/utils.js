class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const ACTIVE_STATUSES = ['open', 'in_progress'];
const DONE_STATUSES = ['resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high'];
const CATEGORIES = ['', 'bug', 'feature', 'support'];
const ROLES = ['user', 'admin'];

const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Convertit les dates SQLite « AAAA-MM-JJ HH:MM:SS » (UTC) en ISO 8601. */
function toIso(value) {
  if (!value) return value ?? null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value.replace(' ', 'T') + 'Z';
  return value;
}

function displayName(user) {
  if (!user) return null;
  const full = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();
  return full || user.username;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    firstname: row.firstname || '',
    lastname: row.lastname || '',
    role: row.role,
    mfa_enabled: Boolean(row.mfa_enabled),
    mfa_exempt: Boolean(row.mfa_exempt),
    name: displayName(row),
    created_at: toIso(row.created_at),
  };
}

function parseId(value, label = 'Identifiant') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${label} invalide.`);
  return id;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

/** Contrôle les champs d'un utilisateur. `partial` : seuls les champs fournis sont vérifiés. */
function validateUserInput(body, { partial = false, requirePassword = !partial } = {}) {
  const errors = {};
  const values = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('username')) {
    const username = asTrimmedString(body.username);
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      errors.username = "3 à 32 caractères : lettres, chiffres, point, tiret ou tiret bas.";
    }
    values.username = username;
  }
  if (requirePassword || (has('password') && body.password !== '' && body.password != null)) {
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) errors.password = 'Le mot de passe doit contenir au moins 8 caractères.';
    else if (password.length > 128) errors.password = 'Le mot de passe est trop long (128 caractères maximum).';
    values.password = password;
  }
  if (!partial || has('email')) {
    const email = asTrimmedString(body.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Adresse e-mail invalide.';
    values.email = email;
  }
  for (const field of ['firstname', 'lastname']) {
    if (!partial || has(field)) {
      const v = asTrimmedString(body[field]);
      if (v.length > 64) errors[field] = '64 caractères maximum.';
      values[field] = v;
    }
  }
  if (has('role')) {
    if (!ROLES.includes(body.role)) errors.role = 'Rôle inconnu.';
    values.role = body.role;
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Certains champs sont invalides.', errors);
  return values;
}

/** Contrôle les champs d'un ticket. */
function validateTicketInput(body, { partial = false } = {}) {
  const errors = {};
  const values = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('title')) {
    const title = asTrimmedString(body.title);
    if (!title) errors.title = 'Le titre est requis.';
    else if (title.length > 200) errors.title = '200 caractères maximum.';
    values.title = title;
  }
  if (!partial || has('description')) {
    const description = asTrimmedString(body.description);
    if (!description) errors.description = 'La description est requise.';
    else if (description.length > 10000) errors.description = '10 000 caractères maximum.';
    values.description = description;
  }
  if (!partial || has('priority')) {
    if (!PRIORITIES.includes(body.priority)) errors.priority = 'La priorité est requise.';
    values.priority = body.priority;
  }
  if (has('category')) {
    const category = body.category == null ? '' : body.category;
    if (!CATEGORIES.includes(category)) errors.category = 'Catégorie inconnue.';
    values.category = category;
  } else if (!partial) {
    values.category = '';
  }
  // La première version envoyait « dueDate » : on accepte les deux orthographes.
  const dueKey = has('due_date') ? 'due_date' : has('dueDate') ? 'dueDate' : null;
  if (dueKey) {
    const due = body[dueKey];
    if (due === '' || due == null) values.due_date = null;
    else if (typeof due !== 'string' || !isValidDate(due.slice(0, 10))) errors.due_date = 'Date limite invalide.';
    else values.due_date = due.slice(0, 10);
  } else if (!partial) {
    values.due_date = null;
  }
  if (has('status')) {
    if (!STATUSES.includes(body.status)) errors.status = 'Statut inconnu.';
    values.status = body.status;
  }
  if (has('assigned_to')) {
    const raw = body.assigned_to;
    if (raw === null || raw === '' || raw === undefined) values.assigned_to = null;
    else if (!Number.isInteger(Number(raw)) || Number(raw) <= 0) errors.assigned_to = 'Utilisateur invalide.';
    else values.assigned_to = Number(raw);
  }
  if (has('assigned_group')) {
    const raw = body.assigned_group;
    if (raw === null || raw === '' || raw === undefined) values.assigned_group = null;
    else if (!Number.isInteger(Number(raw)) || Number(raw) <= 0) errors.assigned_group = 'Groupe invalide.';
    else values.assigned_group = Number(raw);
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Certains champs sont invalides.', errors);
  return values;
}

module.exports = {
  HttpError,
  STATUSES,
  ACTIVE_STATUSES,
  DONE_STATUSES,
  PRIORITIES,
  CATEGORIES,
  ROLES,
  nowIso,
  todayIso,
  toIso,
  displayName,
  publicUser,
  parseId,
  isValidDate,
  validateUserInput,
  validateTicketInput,
};

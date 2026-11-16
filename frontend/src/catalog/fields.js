/** Types de champ du constructeur de formulaires (mêmes valeurs que le serveur). */
export const FIELD_TYPES = {
  text: { label: 'Texte court', hint: 'Une ligne' },
  textarea: { label: 'Texte long', hint: 'Plusieurs lignes' },
  select: { label: 'Liste déroulante', hint: 'Un choix parmi une liste' },
  radio: { label: 'Boutons de choix', hint: 'Un choix, tous visibles' },
  checkbox: { label: 'Case à cocher', hint: 'Cochée ou non' },
  yesno: { label: 'Oui / Non', hint: 'Deux boutons Oui et Non' },
  date: { label: 'Date', hint: 'Calendrier' },
  number: { label: 'Nombre', hint: 'Chiffres uniquement' },
  email: { label: 'E-mail', hint: 'Adresse e-mail' },
  file: { label: 'Pièce jointe', hint: 'Un ou plusieurs fichiers' },
};

export const CHOICE_TYPES = ['select', 'radio'];
export const YES_NO = ['Oui', 'Non'];

export const CONDITION_OPS = {
  equals: 'est égal à',
  not_equals: "n'est pas égal à",
  checked: 'est coché',
  not_checked: "n'est pas coché",
  filled: 'est rempli',
  empty: 'est vide',
};

/** Opérateurs possibles selon le type du champ source de la règle. */
export function opsFor(type) {
  if (type === 'checkbox') return ['checked', 'not_checked'];
  if (type === 'file') return ['filled', 'empty'];
  return ['equals', 'not_equals', 'filled', 'empty'];
}

export const needsValue = (op) => op === 'equals' || op === 'not_equals';

const isEmpty = (v) => v === undefined || v === null || v === '' || v === false || v === 0;

/** Même règle que le serveur : le champ est-il affiché compte tenu des réponses ? */
export function isFieldVisible(field, values, byKey) {
  const c = field.condition;
  if (!c?.field) return true;
  const source = byKey.get(c.field);
  if (!source || !isFieldVisible(source, values, byKey)) return false;
  const v = values[c.field];
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

export function newKey() {
  return `c${Math.random().toString(36).slice(2, 9)}`;
}

/** Contrôle côté navigateur avant l'envoi (le serveur refait le même contrôle). */
export function checkRequired(fields, values) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const counted = Object.fromEntries(fields.map((f) => [f.key, f.type === 'file' ? values[f.key]?.length || 0 : values[f.key]]));
  const errors = {};
  for (const f of fields) {
    if (!f.required || !isFieldVisible(f, counted, byKey)) continue;
    const v = values[f.key];
    if (f.type === 'file' ? !v?.length : f.type === 'checkbox' ? v !== true : !String(v ?? '').trim()) {
      errors[f.key] = f.type === 'file' ? 'Ajoutez au moins un fichier.' : f.type === 'checkbox' ? 'Cette case doit être cochée.' : 'Ce champ est requis.';
    }
  }
  return errors;
}

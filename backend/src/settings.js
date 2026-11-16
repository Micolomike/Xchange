/**
 * Paramètres modifiables depuis l'Administration, stockés dans la base (table settings).
 * Chaque paramètre est un objet JSON ; une valeur absente prend sa valeur par défaut.
 */
const { HttpError } = require('./utils');

const PRIORITY_KEYS = ['high', 'medium', 'low'];
// Couleurs proposées pour les priorités : des teintes lisibles sur fond blanc.
const PRIORITY_COLORS = ['red', 'orange', 'gray', 'blue', 'green', 'purple'];

const DEFAULTS = {
  categories: [
    { key: 'bug', label: 'Bug', active: true },
    { key: 'feature', label: 'Fonctionnalité', active: true },
    { key: 'support', label: 'Support', active: true },
  ],
  priorities: {
    high: { label: 'Haute', color: 'red', days: null },
    medium: { label: 'Moyenne', color: 'orange', days: null },
    low: { label: 'Basse', color: 'gray', days: null },
  },
  appearance: {
    appName: 'Xchange',
    primaryColor: '#2f4bd8',
    homeTitle: '',
    homeText: '',
    logo: null, // nom du fichier dans DATA_DIR/apparence
    logoVersion: 0,
  },
  backup: {
    enabled: true,
    time: '03:30',
    keep: 14,
    copyDir: '',
  },
  backup_state: {
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    lastFile: null,
    copyStatus: null,
    copyError: null,
    copyFile: null,
  },
};

async function getSetting(db, key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  const fallback = DEFAULTS[key];
  if (!row) return structuredClone(fallback);
  try {
    const value = JSON.parse(row.value);
    return Array.isArray(fallback) ? value : { ...structuredClone(fallback), ...value };
  } catch {
    return structuredClone(fallback);
  }
}

async function setSetting(db, key, value) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)]
  );
  return value;
}

const str = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

function slugify(label) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

/** Catégories : les clés existantes sont gardées (les tickets s'y réfèrent), les nouvelles en reçoivent une. */
function validateCategories(input, current) {
  if (!Array.isArray(input) || input.length > 50) throw new HttpError(400, 'Liste de catégories invalide (50 au maximum).');
  const known = new Set(current.map((c) => c.key));
  const used = new Set();
  const out = [];
  for (const raw of input) {
    const label = str(raw?.label);
    if (!label || label.length > 40) throw new HttpError(400, 'Chaque catégorie a un nom de 1 à 40 caractères.');
    if (out.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      throw new HttpError(400, `La catégorie « ${label} » apparaît deux fois.`);
    }
    let key = typeof raw.key === 'string' && known.has(raw.key) ? raw.key : '';
    if (!key) {
      const base = slugify(label) || 'categorie';
      key = base;
      for (let i = 2; known.has(key) || used.has(key); i += 1) key = `${base}_${i}`;
    }
    used.add(key);
    out.push({ key, label, active: raw.active !== false });
  }
  // Une catégorie retirée de la liste mais déjà utilisée reste connue, désactivée.
  for (const c of current) if (!used.has(c.key)) out.push({ ...c, active: false, removed: true });
  return out;
}

function validatePriorities(input) {
  const out = {};
  for (const key of PRIORITY_KEYS) {
    const raw = input?.[key] || {};
    const label = str(raw.label);
    if (!label || label.length > 30) throw new HttpError(400, 'Chaque priorité a un nom de 1 à 30 caractères.');
    if (!PRIORITY_COLORS.includes(raw.color)) throw new HttpError(400, 'Couleur de priorité inconnue.');
    let days = null;
    if (raw.days !== null && raw.days !== undefined && raw.days !== '') {
      days = Number(raw.days);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        throw new HttpError(400, 'Le délai par défaut est un nombre de jours entre 0 et 365, ou vide.');
      }
    }
    out[key] = { label, color: raw.color, days };
  }
  const labels = PRIORITY_KEYS.map((k) => out[k].label.toLowerCase());
  if (new Set(labels).size !== labels.length) throw new HttpError(400, 'Les trois priorités doivent avoir des noms différents.');
  return out;
}

/** Rapport de contraste WCAG entre deux couleurs #rrggbb. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function validateAppearance(input, current) {
  const out = { ...current };
  if ('appName' in input) {
    out.appName = str(input.appName);
    if (!out.appName || out.appName.length > 30) throw new HttpError(400, "Le nom de l'application fait de 1 à 30 caractères.");
  }
  if ('primaryColor' in input) {
    const color = String(input.primaryColor || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new HttpError(400, 'Couleur invalide : format #rrggbb attendu.');
    if (contrast(color, '#ffffff') < 4.5) {
      throw new HttpError(400, 'Cette couleur est trop claire : le texte blanc des boutons ne serait pas lisible. Choisissez une teinte plus foncée.');
    }
    out.primaryColor = color;
  }
  if ('homeTitle' in input) {
    out.homeTitle = str(input.homeTitle);
    if (out.homeTitle.length > 120) throw new HttpError(400, "Titre d'accueil : 120 caractères maximum.");
  }
  if ('homeText' in input) {
    out.homeText = typeof input.homeText === 'string' ? input.homeText.trim() : '';
    if (out.homeText.length > 600) throw new HttpError(400, "Texte d'accueil : 600 caractères maximum.");
  }
  return out;
}

module.exports = {
  DEFAULTS,
  PRIORITY_KEYS,
  PRIORITY_COLORS,
  getSetting,
  setSetting,
  validateCategories,
  validatePriorities,
  validateAppearance,
  contrast,
};

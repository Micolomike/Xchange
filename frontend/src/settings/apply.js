import { ACTIVE_CATEGORY_KEYS, CATEGORIES, PRIORITIES, PRIORITY_COLORS } from '../lib/constants';

const DEFAULT_ACCENT = '#2f4bd8';

function mix(hex, target, weight) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(target.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v * (1 - weight) + b[i] * weight).toString(16).padStart(2, '0')).join('')}`;
}

/** Couleur principale et ses deux variantes (survol foncé, fond clair). */
export function accentShades(color) {
  const base = /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : DEFAULT_ACCENT;
  return { accent: base, strong: mix(base, '#000000', 0.22), soft: mix(base, '#ffffff', 0.9) };
}

/** Variantes pour le mode sombre : boutons un peu éclaircis, textes clairs, fonds teintés foncés. */
export function darkAccentShades(color) {
  const { accent } = accentShades(color);
  return {
    accent: mix(accent, '#ffffff', 0.1),
    hover: mix(accent, '#ffffff', 0.22),
    strong: mix(accent, '#ffffff', 0.6),
    soft: mix(accent, '#171d26', 0.78),
  };
}

/**
 * Applique les paramètres au reste de l'interface : listes (objets partagés modifiés en place,
 * lus au rendu par les pages), couleur principale, titre de l'onglet et icône.
 */
export function applySettings(s) {
  if (s.categories) {
    for (const key of Object.keys(CATEGORIES)) delete CATEGORIES[key];
    ACTIVE_CATEGORY_KEYS.length = 0;
    for (const c of s.categories) {
      CATEGORIES[c.key] = c.label;
      if (c.active) ACTIVE_CATEGORY_KEYS.push(c.key);
    }
  }
  if (s.priorities) {
    for (const [key, p] of Object.entries(s.priorities)) {
      if (!PRIORITIES[key]) continue;
      PRIORITIES[key].label = p.label;
      PRIORITIES[key].className = PRIORITY_COLORS[p.color]?.className || PRIORITIES[key].className;
      PRIORITIES[key].days = p.days;
    }
  }
  const { accent, strong, soft } = accentShades(s.primaryColor);
  const dark = darkAccentShades(s.primaryColor);
  const root = document.documentElement.style;
  root.setProperty('--accent-light', accent);
  root.setProperty('--accent-hover-light', strong);
  root.setProperty('--accent-strong-light', strong);
  root.setProperty('--accent-soft-light', soft);
  root.setProperty('--accent-dark', dark.accent);
  root.setProperty('--accent-hover-dark', dark.hover);
  root.setProperty('--accent-strong-dark', dark.strong);
  root.setProperty('--accent-soft-dark', dark.soft);
  if (s.appName) document.title = s.appName;
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    icon.type = s.logoUrl ? '' : 'image/svg+xml';
    icon.href = s.logoUrl ? s.logoSrc : '/favicon.svg';
  }
}

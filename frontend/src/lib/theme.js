/** Thème de l'interface : choix de la personne (clair, sombre) ou celui du système, retenu sur cet appareil. */
const KEY = 'xchange.theme';
export const THEMES = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Automatique' },
];

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

export function getThemeChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((t) => t.value === v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolvedTheme(choice = getThemeChoice()) {
  if (choice === 'light' || choice === 'dark') return choice;
  return media?.matches ? 'dark' : 'light';
}

function apply() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  for (const fn of listeners) fn(getThemeChoice(), theme);
}

export function setThemeChoice(choice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
  apply();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media?.addEventListener?.('change', apply);

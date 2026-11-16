export const STATUSES = {
  open: { label: 'Ouvert', badge: 'bg-open-soft text-open', dot: 'bg-open' },
  in_progress: { label: 'En cours', badge: 'bg-progress-soft text-progress', dot: 'bg-progress' },
  resolved: { label: 'Résolu', badge: 'bg-resolved-soft text-resolved', dot: 'bg-resolved' },
  closed: { label: 'Fermé', badge: 'bg-closed-soft text-closed', dot: 'bg-closed' },
};
export const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'];

export const PRIORITIES = {
  high: { label: 'Haute', className: 'text-danger', bars: 3 },
  medium: { label: 'Moyenne', className: 'text-progress', bars: 2 },
  low: { label: 'Basse', className: 'text-ink-mute', bars: 1 },
};
export const PRIORITY_ORDER = ['high', 'medium', 'low'];

/** Couleurs proposées pour les priorités (Administration > Paramètres). */
export const PRIORITY_COLORS = {
  red: { label: 'Rouge', className: 'text-danger' },
  orange: { label: 'Orange', className: 'text-progress' },
  gray: { label: 'Gris', className: 'text-ink-mute' },
  blue: { label: 'Bleu', className: 'text-open' },
  green: { label: 'Vert', className: 'text-resolved' },
  purple: { label: 'Violet', className: 'text-violet' },
};

// Remplacées au démarrage par les catégories des paramètres (voir settings/apply.js).
export const CATEGORIES = {
  bug: 'Bug',
  feature: 'Fonctionnalité',
  support: 'Support',
};
export const ACTIVE_CATEGORY_KEYS = ['bug', 'feature', 'support'];

export const ROLES = {
  user: 'Utilisateur',
  admin: 'Administrateur',
};

export const MAX_UPLOAD_MB = 10;
export const MAX_FILES = 5;

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

/** Choix de notification d'un compte (« Mon compte »). */
export const NOTIFY_CHOICES = [
  { key: 'mine', label: 'Mes demandes', hint: 'Réponses, changements de statut, réponse à une demande pour rejoindre un groupe.' },
  { key: 'assigned', label: 'Une demande m’est confiée' },
  { key: 'handled', label: 'Messages sur les demandes que je traite', hint: 'Ou que mon groupe peut prendre, tant que personne ne s’en occupe.' },
  { key: 'group_new', label: 'Nouvelles demandes dans mes groupes', hint: 'Y compris les demandes transférées à un de mes groupes.' },
  { key: 'admin', label: 'Demandes pour rejoindre un groupe, à valider', adminOnly: true },
  { key: 'sla', label: 'Délais (SLA) bientôt dépassés ou dépassés', hint: 'Pour les demandes qui me sont confiées, ou celles de mes groupes sans responsable.' },
  { key: 'reports', label: 'Rapports programmés envoyés par d’autres personnes', hint: 'Les rapports que vous programmez vous-même vous sont toujours envoyés.' },
];

/**
 * Résumé des notifications d'un compte : ce qu'il reçoit vraiment.
 * kind : ok (tout), partial (certains choix coupés), off (tout coupé), noemail (pas d'adresse).
 */
export function notifyState(u) {
  if (!u.email) return { kind: 'noemail', label: 'Sans e-mail', detail: "Aucune adresse : ce compte ne reçoit aucun e-mail." };
  if (u.notify_email === false) return { kind: 'off', label: 'Coupées', detail: 'A désactivé tous les e-mails dans « Mon compte ».' };
  const off = NOTIFY_CHOICES.filter((c) => (!c.adminOnly || u.role === 'admin') && u.notify_prefs?.[c.key] === false);
  if (off.length) return { kind: 'partial', label: 'Partielles', detail: `Ne reçoit pas : ${off.map((c) => c.label).join(' ; ')}.` };
  return { kind: 'ok', label: 'Actives', detail: 'Reçoit tous les e-mails prévus.' };
}

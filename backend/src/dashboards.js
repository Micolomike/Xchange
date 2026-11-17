/**
 * Tableaux de bord : une grille de blocs, chacun avec sa propre définition de rapport.
 * Les données sont toujours calculées avec les droits de la personne qui regarde.
 */
const { HttpError } = require('./utils');
const { validateDefinition } = require('./reports');

const WIDTHS = [3, 4, 6, 8, 12];
const HEIGHTS = [1, 2, 3];
const MAX_WIDGETS = 24;

function validateWidgets(raw, ctx) {
  if (!Array.isArray(raw)) throw new HttpError(400, 'Blocs invalides.');
  if (raw.length > MAX_WIDGETS) throw new HttpError(400, `${MAX_WIDGETS} blocs au plus par tableau de bord.`);
  const ids = new Set();
  return raw.map((w, i) => {
    if (!w || typeof w !== 'object') throw new HttpError(400, 'Bloc invalide.');
    const id = String(w.id || `b${i + 1}`).slice(0, 40);
    if (ids.has(id)) throw new HttpError(400, 'Deux blocs ont le même identifiant.');
    ids.add(id);
    const title = String(w.title || '').trim().slice(0, 80);
    if (!title) throw new HttpError(400, `Donnez un titre au bloc n°${i + 1}.`);
    let definition;
    try {
      definition = validateDefinition(w.definition, ctx);
    } catch (err) {
      throw new HttpError(400, `Bloc « ${title} » : ${err.message}`);
    }
    return {
      id,
      title,
      w: WIDTHS.includes(Number(w.w)) ? Number(w.w) : 6,
      h: HEIGHTS.includes(Number(w.h)) ? Number(w.h) : definition.type === 'kpi' ? 1 : 2,
      definition,
      ...(w.reportId ? { reportId: Number(w.reportId) } : {}),
    };
  });
}

function validateFilters(raw, ctx) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (f.period) {
    if (!['all', 'today', '7d', '30d', '90d', '12m', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'].includes(f.period)) {
      throw new HttpError(400, 'Période inconnue.');
    }
    out.period = f.period;
  }
  if (f.group) {
    if (f.group !== 'mine' && !ctx.groupIds.includes(Number(f.group))) throw new HttpError(400, "Le groupe choisi n'existe plus.");
    out.group = f.group === 'mine' ? 'mine' : Number(f.group);
  }
  return out;
}

/** Filtres communs du tableau appliqués à un bloc. */
function overridesFor(definition, filters) {
  const o = {};
  if (filters.period) o.period = { range: filters.period, field: definition.filters.period?.field || 'created' };
  if (filters.group) o.group = [String(filters.group)];
  return o;
}

const kpi = (id, title, metric, range = 'all', extra = {}) => ({ id, title, w: 3, h: 1, definition: { type: 'kpi', chart: 'number', metric, filters: { period: { range }, ...extra } } });
const summary = (id, title, dimension, chart, opts = {}) => ({
  id,
  title,
  w: opts.w || 6,
  h: opts.h || 2,
  definition: { type: 'summary', chart, dimension, split: opts.split, metric: opts.metric || 'count', filters: { period: { range: opts.range || 'all' }, ...(opts.filters || {}) } },
});

const TEMPLATES = {
  sla: {
    name: 'Délais (SLA)',
    description: 'Respect des engagements de prise en charge et de résolution.',
    filters: {},
    widgets: [
      kpi('k1', 'Résolutions dans les délais', 'sla_rate', '90d'),
      kpi('k2', 'Prises en charge dans les délais', 'sla_response_rate', '90d'),
      kpi('k3', 'En cours, délai dépassé', 'sla_breached'),
      kpi('k4', 'En cours, bientôt dépassé', 'sla_at_risk'),
      { id: 't1', title: 'Résolues dans les délais, par semaine de résolution (%)', w: 8, h: 2, definition: { type: 'trend', chart: 'line', interval: 'week', series: ['sla_rate'], filters: { period: { range: '90d' } } } },
      summary('s1', 'Demandes en cours, par état du délai', 'sla_state', 'donut', { w: 4, filters: { status: ['open', 'in_progress'] } }),
      summary('s2', 'Respect par priorité (%)', 'priority', 'bar', { metric: 'sla_rate', range: '90d' }),
      summary('s3', 'Respect par groupe (%)', 'group', 'hbar', { metric: 'sla_rate', range: '90d' }),
      summary('s4', 'Dépassements par catégorie', 'category', 'hbar', { metric: 'sla_breached', range: '90d' }),
      summary('s5', 'Prise en charge par groupe', 'group', 'stacked', { split: 'sla_response_state', range: '90d' }),
      {
        id: 'l1',
        title: 'À traiter en priorité : délai dépassé ou bientôt dépassé',
        w: 12,
        h: 3,
        definition: {
          type: 'list',
          chart: 'table',
          columns: ['id', 'title', 'priority', 'group', 'assignee', 'sla_state', 'sla_resolution_due'],
          sort: { field: 'sla_resolution_due', dir: 'asc' },
          limit: 50,
          filters: { status: ['open', 'in_progress'], sla: 'attention', period: { range: 'all' } },
        },
      },
    ],
  },
  activite: {
    name: 'Activité générale',
    description: 'Vue d’ensemble des demandes que vous pouvez voir.',
    filters: { period: '30d' },
    widgets: [
      kpi('k1', 'Demandes créées', 'created', '30d'),
      kpi('k2', 'Demandes résolues', 'resolved', '30d'),
      kpi('k3', 'En cours', 'open'),
      kpi('k4', 'En retard', 'overdue'),
      { id: 't1', title: 'Créées et résolues', w: 8, h: 2, definition: { type: 'trend', chart: 'area', interval: 'day', series: ['created', 'resolved'], filters: { period: { range: '30d' } } } },
      summary('s1', 'Par statut', 'status', 'donut', { w: 4 }),
      summary('s2', 'Par catégorie', 'category', 'hbar'),
      summary('s3', 'Par groupe et par statut', 'group', 'stacked', { split: 'status' }),
      { id: 'h1', title: 'Quand les demandes arrivent', w: 12, h: 2, definition: { type: 'heatmap', chart: 'heatmap', filters: { period: { range: '90d' } } } },
    ],
  },
  groupe: {
    name: 'Mes groupes',
    description: 'Les demandes affectées à vos groupes.',
    filters: { group: 'mine' },
    widgets: [
      kpi('k1', 'En cours', 'open'),
      kpi('k2', 'Sans responsable', 'unassigned'),
      kpi('k3', 'En retard', 'overdue'),
      kpi('k4', 'Délai moyen de résolution', 'avg_resolution', '90d'),
      summary('s1', 'Charge par responsable', 'assignee', 'stacked', { split: 'priority', filters: { status: ['open', 'in_progress'] } }),
      summary('s2', 'Par priorité', 'priority', 'donut', { filters: { status: ['open', 'in_progress'] } }),
      {
        id: 'l1',
        title: 'En attente d’un responsable',
        w: 12,
        h: 2,
        definition: { type: 'list', chart: 'table', columns: ['id', 'title', 'priority', 'group', 'due_date', 'created_at'], sort: { field: 'created_at', dir: 'asc' }, limit: 20, filters: { status: ['open', 'in_progress'], assignee: 'none', period: { range: 'all' } } },
      },
    ],
  },
  delais: {
    name: 'Délais de traitement',
    description: 'Combien de temps pour résoudre une demande, et où ça bloque.',
    filters: { period: '90d' },
    widgets: [
      kpi('k1', 'Délai moyen de résolution', 'avg_resolution', '90d'),
      kpi('k2', 'Demandes résolues', 'resolved', '90d'),
      kpi('k3', 'En retard', 'overdue'),
      kpi('k4', 'Sans responsable', 'unassigned'),
      summary('s1', 'Délai moyen par catégorie (h)', 'category', 'hbar', { metric: 'avg_resolution', range: '90d', filters: { period: { range: '90d', field: 'resolved' } } }),
      summary('s2', 'Délai moyen par priorité (h)', 'priority', 'bar', { metric: 'avg_resolution', range: '90d', filters: { period: { range: '90d', field: 'resolved' } } }),
      { id: 't1', title: 'Résolues par mois', w: 12, h: 2, definition: { type: 'trend', chart: 'bar', interval: 'month', series: ['created', 'resolved'], filters: { period: { range: '12m' } } } },
    ],
  },
  file: {
    name: 'Ma file',
    description: 'Les demandes qui vous sont confiées.',
    filters: {},
    widgets: [
      kpi('k1', 'Confiées à moi, en cours', 'open', 'all', { assignee: 'me' }),
      kpi('k2', 'En retard', 'overdue', 'all', { assignee: 'me' }),
      kpi('k3', 'Résolues ce mois-ci', 'resolved', 'this_month', { assignee: 'me' }),
      kpi('k4', 'Mon délai moyen', 'avg_resolution', '90d', { assignee: 'me' }),
      {
        id: 'l1',
        title: 'À traiter',
        w: 12,
        h: 3,
        definition: { type: 'list', chart: 'table', columns: ['id', 'title', 'status', 'priority', 'due_date', 'creator', 'updated_at'], sort: { field: 'due_date', dir: 'asc' }, limit: 50, filters: { assignee: 'me', status: ['open', 'in_progress'], period: { range: 'all' } } },
      },
    ],
  },
};

module.exports = { WIDTHS, HEIGHTS, MAX_WIDGETS, TEMPLATES, validateWidgets, validateFilters, overridesFor };

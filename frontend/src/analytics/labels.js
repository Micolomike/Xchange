/** Libellés et valeurs par défaut des Analyses. */
export const TYPE_LABELS = {
  list: { label: 'Liste de demandes', hint: 'Un tableau, une ligne par demande' },
  summary: { label: 'Regroupement', hint: 'Compter par statut, groupe, catégorie…' },
  trend: { label: 'Évolution', hint: 'Créées et résolues dans le temps' },
  kpi: { label: 'Indicateur', hint: 'Un chiffre clé, comparé à la période précédente' },
  heatmap: { label: 'Carte de chaleur', hint: 'Les jours et heures où les demandes arrivent' },
};
export const CHART_LABELS = {
  table: 'Tableau',
  bar: 'Barres',
  hbar: 'Barres horizontales',
  donut: 'Anneau',
  stacked: 'Barres empilées',
  line: 'Courbes',
  area: 'Aires',
  number: 'Chiffre',
  heatmap: 'Carte de chaleur',
};


/** Définition par défaut de chaque type. */
export function defaultDefinition(type, meta) {
  const filters = { period: { range: type === 'trend' ? '30d' : 'all', field: 'created' } };
  if (type === 'list') return { type, chart: 'table', columns: meta.defaultColumns, sort: { field: 'created_at', dir: 'desc' }, limit: 100, filters };
  if (type === 'summary') return { type, chart: 'bar', dimension: 'status', metric: 'count', limit: 12, filters };
  if (type === 'trend') return { type, chart: 'area', interval: 'day', series: ['created', 'resolved'], filters };
  if (type === 'kpi') return { type, chart: 'number', metric: 'open', filters };
  return { type: 'heatmap', chart: 'heatmap', filters: { period: { range: '90d', field: 'created' } } };
}


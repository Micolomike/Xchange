/**
 * Rapports : un moteur unique, utilisé par les rapports, leurs envois programmés et les tableaux de bord.
 *
 * Un rapport est une définition (filtres + présentation) appliquée aux demandes visibles par une personne :
 * - dans l'application, avec les droits de la personne qui le consulte ;
 * - par e-mail, avec les droits du créateur, et seulement aux destinataires qui voient eux-mêmes toutes les
 *   demandes du rapport (contrôle fait à chaque envoi).
 * Les discussions n'en font jamais partie.
 */
const { toCsv: exportCsv, buildExport } = require('./exports');
const { HttpError, STATUSES, PRIORITIES, ACTIVE_STATUSES, publicUser } = require('./utils');
const { getSetting } = require('./settings');
const { visibilityClause, computeAccess } = require('./access');

const STATUS_LABELS = { open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu', closed: 'Fermé' };
const TYPES = ['list', 'summary', 'trend', 'kpi', 'heatmap'];
const MAX_ROWS = 500;

const PERIODS = {
  all: 'Depuis le début',
  today: "Aujourd'hui",
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '90 derniers jours',
  '12m': '12 derniers mois',
  this_week: 'Cette semaine',
  last_week: 'La semaine dernière',
  this_month: 'Ce mois-ci',
  last_month: 'Le mois dernier',
  this_year: 'Cette année',
};
const DATE_FIELDS = { created: 't.created_at', updated: 't.updated_at', resolved: 't.resolved_at' };

const PERSON = (alias) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.hide_real_name = 1 OR TRIM(COALESCE(${alias}.firstname, '') || ' ' || COALESCE(${alias}.lastname, '')) = ''
    THEN ${alias}.username ELSE TRIM(COALESCE(${alias}.firstname, '') || ' ' || COALESCE(${alias}.lastname, '')) END`;

const FROM = `FROM tickets t
  LEFT JOIN user_groups g ON g.id = t.assigned_group
  LEFT JOIN users ua ON ua.id = t.assigned_to
  LEFT JOIN users uc ON uc.id = t.created_by
  LEFT JOIN catalog_items ci ON ci.id = t.catalog_item`;

/** État du délai de résolution (SLA) : none, running, at_risk, breached (en cours), met, missed. */
const SLA_RES_STATE = `CASE WHEN t.sla_resolution_due IS NULL THEN 'none'
  WHEN t.resolved_at IS NOT NULL THEN CASE WHEN t.resolved_at <= t.sla_resolution_due THEN 'met' ELSE 'missed' END
  WHEN :now > t.sla_resolution_due THEN 'breached'
  WHEN t.sla_resolution_warn IS NOT NULL AND :now >= t.sla_resolution_warn THEN 'at_risk'
  ELSE 'running' END`;
const SLA_RESP_DONE = 'COALESCE(t.sla_responded_at, t.resolved_at)';
const SLA_RESP_STATE = `CASE WHEN t.sla_response_due IS NULL THEN 'none'
  WHEN ${SLA_RESP_DONE} IS NOT NULL THEN CASE WHEN ${SLA_RESP_DONE} <= t.sla_response_due THEN 'met' ELSE 'missed' END
  WHEN :now > t.sla_response_due THEN 'breached'
  ELSE 'running' END`;
const rateOf = (state, finished) =>
  `100.0 * SUM(CASE WHEN (${state}) = 'met' THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN (${state}) IN (${finished}) THEN 1 ELSE 0 END), 0)`;
const SLA_STATE_LABELS = {
  none: 'Sans engagement',
  running: 'Dans les temps',
  at_risk: 'À risque',
  breached: 'Dépassé, en cours',
  met: 'Respecté',
  missed: 'Non respecté',
};
const SLA_ORDER = ['met', 'running', 'at_risk', 'breached', 'missed', 'none'];

const ACTIVE_SQL = `t.status IN (${ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')})`;
const RESOLUTION_HOURS = '(julianday(t.resolved_at) - julianday(t.created_at)) * 24';

/** Axes de regroupement. `key` : valeur SQL du groupe ; `label` : libellé SQL (facultatif). */
const DIMENSIONS = {
  status: { label: 'Statut', key: 't.status' },
  priority: { label: 'Priorité', key: 't.priority' },
  category: { label: 'Catégorie', key: "COALESCE(t.category, '')" },
  group: { label: 'Groupe', key: 'COALESCE(t.assigned_group, 0)', name: 'g.name' },
  assignee: { label: 'Responsable', key: 'COALESCE(t.assigned_to, 0)', name: PERSON('ua') },
  creator: { label: 'Demandeur', key: 'COALESCE(t.created_by, 0)', name: PERSON('uc') },
  form: { label: 'Formulaire', key: 'COALESCE(t.catalog_item, 0)', name: 'ci.name' },
  month: { label: 'Mois de création', key: "strftime('%Y-%m', t.created_at, 'localtime')" },
  weekday: { label: 'Jour de la semaine', key: "CAST(strftime('%w', t.created_at, 'localtime') AS INTEGER)" },
  sla_state: { label: 'Délai de résolution (SLA)', key: SLA_RES_STATE },
  sla_response_state: { label: 'Délai de prise en charge (SLA)', key: SLA_RESP_STATE },
};

/** Mesures d'un regroupement. */
const METRICS = {
  count: { label: 'Nombre de demandes', sql: 'COUNT(*)' },
  open: { label: 'Demandes en cours', sql: `SUM(CASE WHEN ${ACTIVE_SQL} THEN 1 ELSE 0 END)` },
  overdue: { label: 'Demandes en retard', sql: `SUM(CASE WHEN ${ACTIVE_SQL} AND t.due_date IS NOT NULL AND t.due_date < :today THEN 1 ELSE 0 END)` },
  resolved: { label: 'Demandes résolues', sql: 'SUM(CASE WHEN t.resolved_at IS NOT NULL THEN 1 ELSE 0 END)' },
  avg_resolution: { label: 'Délai moyen de résolution (heures)', sql: `AVG(CASE WHEN t.resolved_at IS NOT NULL THEN ${RESOLUTION_HOURS} END)`, decimals: 1 },
  sla_rate: { label: 'Résolutions dans les délais (%)', sql: rateOf(SLA_RES_STATE, "'met', 'missed', 'breached'"), decimals: 1, percent: true },
  sla_response_rate: { label: 'Prises en charge dans les délais (%)', sql: rateOf(SLA_RESP_STATE, "'met', 'missed', 'breached'"), decimals: 1, percent: true },
  sla_breached: { label: 'Délais dépassés', sql: `SUM(CASE WHEN (${SLA_RES_STATE}) IN ('breached', 'missed') THEN 1 ELSE 0 END)` },
};

/** Indicateurs chiffrés (type « kpi »). */
const KPIS = {
  created: { label: 'Demandes créées', field: 'created', sql: 'COUNT(*)' },
  resolved: { label: 'Demandes résolues', field: 'resolved', sql: 'COUNT(*)', where: 't.resolved_at IS NOT NULL' },
  open: { label: 'Demandes en cours', field: null, sql: 'COUNT(*)', where: ACTIVE_SQL },
  overdue: { label: 'Demandes en retard', field: null, sql: 'COUNT(*)', where: `${ACTIVE_SQL} AND t.due_date IS NOT NULL AND t.due_date < :today` },
  unassigned: { label: 'Sans responsable', field: null, sql: 'COUNT(*)', where: `${ACTIVE_SQL} AND t.assigned_to IS NULL` },
  avg_resolution: { label: 'Délai moyen de résolution', field: 'resolved', sql: `AVG(${RESOLUTION_HOURS})`, where: 't.resolved_at IS NOT NULL', unit: 'h', decimals: 1 },
  // Parmi les demandes dont l'issue est connue : résolues à temps, résolues en retard, ou en cours déjà en retard.
  sla_rate: { label: 'Résolutions dans les délais (SLA)', field: 'created', sql: rateOf(SLA_RES_STATE, "'met', 'missed', 'breached'"), where: 't.sla_resolution_due IS NOT NULL', unit: '%', decimals: 1 },
  sla_response_rate: { label: 'Prises en charge dans les délais (SLA)', field: 'created', sql: rateOf(SLA_RESP_STATE, "'met', 'missed', 'breached'"), where: 't.sla_response_due IS NOT NULL', unit: '%', decimals: 1 },
  sla_breached: {
    label: 'En cours, délai dépassé',
    field: null,
    sql: 'COUNT(*)',
    where: `${ACTIVE_SQL} AND ((t.sla_responded_at IS NULL AND t.sla_response_due < :now) OR t.sla_resolution_due < :now)`,
  },
  sla_at_risk: {
    label: 'En cours, délai bientôt dépassé',
    field: null,
    sql: 'COUNT(*)',
    where: `${ACTIVE_SQL} AND (${SLA_RES_STATE}) = 'at_risk' AND NOT (t.sla_responded_at IS NULL AND t.sla_response_due < :now)`,
  },
};

/** Colonnes d'une liste. */
const COLUMNS = {
  id: { label: 'N°', sql: 't.id' },
  title: { label: 'Titre', sql: 't.title' },
  status: { label: 'Statut', sql: 't.status' },
  priority: { label: 'Priorité', sql: 't.priority' },
  category: { label: 'Catégorie', sql: "COALESCE(t.category, '')" },
  group: { label: 'Groupe', sql: 'g.name' },
  assignee: { label: 'Responsable', sql: PERSON('ua') },
  creator: { label: 'Demandeur', sql: PERSON('uc') },
  form: { label: 'Formulaire', sql: 'ci.name' },
  created_at: { label: 'Créée le', sql: 't.created_at' },
  updated_at: { label: 'Mise à jour le', sql: 't.updated_at' },
  due_date: { label: 'Échéance', sql: 't.due_date' },
  resolved_at: { label: 'Résolue le', sql: 't.resolved_at' },
  resolution_hours: { label: 'Délai de résolution (h)', sql: `ROUND(${RESOLUTION_HOURS}, 1)` },
  comments: { label: 'Messages', sql: '(SELECT COUNT(*) FROM comments WHERE ticket_id = t.id)' },
  sla_state: { label: 'Délai de résolution (SLA)', sql: SLA_RES_STATE },
  sla_response_due: { label: 'Prise en charge attendue avant', sql: 't.sla_response_due' },
  sla_resolution_due: { label: 'Résolution attendue avant', sql: 't.sla_resolution_due' },
};
const DEFAULT_COLUMNS = ['id', 'title', 'status', 'priority', 'group', 'assignee', 'created_at'];
const CHARTS = {
  list: ['table'],
  summary: ['bar', 'hbar', 'donut', 'stacked', 'table'],
  trend: ['line', 'area', 'bar'],
  kpi: ['number'],
  heatmap: ['heatmap'],
};
const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Fenêtre de dates d'une période, en heure locale du serveur. `to` exclu. */
function periodWindow(range, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = (n) => new Date(today.getTime() - (n - 1) * 86400_000);
  switch (range) {
    case 'today':
      return { from: today, to: null };
    case '7d':
      return { from: days(7), to: null };
    case '30d':
      return { from: days(30), to: null };
    case '90d':
      return { from: days(90), to: null };
    case '12m':
      return { from: new Date(today.getFullYear(), today.getMonth() - 11, 1), to: null };
    case 'this_week':
      return { from: monday, to: null };
    case 'last_week':
      return { from: new Date(monday.getTime() - 7 * 86400_000), to: monday };
    case 'this_month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: null };
    case 'last_month':
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
    case 'this_year':
      return { from: new Date(today.getFullYear(), 0, 1), to: null };
    default:
      return { from: null, to: null };
  }
}

/** Période précédente de même longueur (pour comparer un indicateur). */
function previousWindow(range, now = new Date()) {
  const w = periodWindow(range, now);
  if (!w.from) return null;
  const end = w.to || now;
  if (range === 'this_month' || range === 'last_month') {
    const f = new Date(w.from.getFullYear(), w.from.getMonth() - 1, 1);
    // Ce mois-ci : même nombre de jours écoulés le mois précédent.
    return { from: f, to: range === 'last_month' ? w.from : new Date(f.getTime() + (now - w.from)) };
  }
  if (range === 'this_year') {
    const f = new Date(w.from.getFullYear() - 1, 0, 1);
    return { from: f, to: new Date(f.getTime() + (now - w.from)) };
  }
  const len = end - w.from;
  return { from: new Date(w.from.getTime() - len), to: w.from };
}

// ---------------------------------------------------------------------------------------------------
// Validation

const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function cleanFilters(raw = {}, ctx) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const pick = (name, values, allowed, label) => {
    const vals = [...new Set(list(values).map(String))];
    if (vals.some((v) => !allowed.includes(v))) throw new HttpError(400, `Filtre « ${label} » : valeur inconnue.`);
    if (vals.length) out[name] = vals;
  };
  pick('status', f.status, STATUSES, 'Statut');
  pick('priority', f.priority, PRIORITIES, 'Priorité');
  pick('category', f.category, ['', ...ctx.categoryKeys], 'Catégorie');
  const groups = [...new Set(list(f.group).map(String))];
  if (groups.some((g) => !['mine', 'none'].includes(g) && !ctx.groupIds.includes(Number(g)))) {
    throw new HttpError(400, "Filtre « Groupe » : un des groupes n'existe plus.");
  }
  if (groups.length) out.group = groups;
  const forms = [...new Set(list(f.form).map(String))];
  if (forms.some((v) => v !== 'none' && !ctx.formIds.includes(Number(v)))) throw new HttpError(400, "Filtre « Formulaire » : un des formulaires n'existe plus.");
  if (forms.length) out.form = forms;
  if (f.assignee && !['any', 'me', 'none', 'assigned'].includes(f.assignee)) throw new HttpError(400, 'Filtre « Responsable » invalide.');
  if (f.assignee && f.assignee !== 'any') out.assignee = f.assignee;
  if (f.creator && !['any', 'me'].includes(f.creator)) throw new HttpError(400, 'Filtre « Demandeur » invalide.');
  if (f.creator === 'me') out.creator = 'me';
  if (f.overdue) out.overdue = true;
  if (f.sla && !['any', 'met', 'missed', 'breached', 'at_risk', 'late', 'attention'].includes(f.sla)) throw new HttpError(400, 'Filtre « SLA » invalide.');
  if (f.sla && f.sla !== 'any') out.sla = f.sla;
  if (f.confidential && !['any', 'exclude', 'only'].includes(f.confidential)) throw new HttpError(400, 'Filtre « Confidentialité » invalide.');
  if (f.confidential && f.confidential !== 'any') out.confidential = f.confidential;
  const range = f.period?.range || 'all';
  if (!PERIODS[range]) throw new HttpError(400, 'Période inconnue.');
  const field = f.period?.field || 'created';
  if (!DATE_FIELDS[field]) throw new HttpError(400, 'Date de la période inconnue.');
  out.period = { range, field };
  const q = typeof f.q === 'string' ? f.q.trim().slice(0, 100) : '';
  if (q) out.q = q;
  return out;
}

/** Vérifie et normalise une définition de rapport. */
function validateDefinition(raw, ctx) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Définition du rapport invalide.');
  const type = raw.type || 'list';
  if (!TYPES.includes(type)) throw new HttpError(400, 'Type de rapport inconnu.');
  const def = { type, filters: cleanFilters(raw.filters, ctx) };
  const chart = raw.chart || CHARTS[type][0];
  if (!CHARTS[type].includes(chart)) throw new HttpError(400, "Ce type d'affichage ne convient pas à ce rapport.");
  def.chart = chart;
  if (type === 'list') {
    const cols = list(raw.columns).filter((c) => COLUMNS[c]);
    def.columns = cols.length ? [...new Set(cols)] : DEFAULT_COLUMNS;
    const sort = raw.sort?.field && COLUMNS[raw.sort.field] ? raw.sort.field : 'created_at';
    def.sort = { field: sort, dir: raw.sort?.dir === 'asc' ? 'asc' : 'desc' };
    def.limit = Math.min(Math.max(Number(raw.limit) || 100, 1), MAX_ROWS);
  }
  if (type === 'summary') {
    if (!DIMENSIONS[raw.dimension]) throw new HttpError(400, 'Choisissez par quoi regrouper.');
    def.dimension = raw.dimension;
    if (raw.split) {
      if (!DIMENSIONS[raw.split] || raw.split === raw.dimension) throw new HttpError(400, 'Second regroupement invalide.');
      def.split = raw.split;
    }
    if (def.chart === 'stacked' && !def.split) throw new HttpError(400, 'Un graphique empilé demande un second regroupement.');
    def.metric = METRICS[raw.metric] ? raw.metric : 'count';
    def.limit = Math.min(Math.max(Number(raw.limit) || 12, 1), 50);
  }
  if (type === 'trend') {
    def.interval = ['day', 'week', 'month'].includes(raw.interval) ? raw.interval : 'day';
    const series = list(raw.series).filter((s) => ['created', 'resolved', 'sla_rate'].includes(s));
    def.series = series.length ? [...new Set(series)] : ['created', 'resolved'];
    // Un pourcentage ne partage pas son axe avec des nombres de demandes.
    if (def.series.includes('sla_rate')) def.series = ['sla_rate'];
    if (def.filters.period.range === 'all') def.filters.period.range = def.interval === 'month' ? '12m' : '30d';
  }
  if (type === 'kpi') {
    if (!KPIS[raw.metric]) throw new HttpError(400, 'Choisissez un indicateur.');
    def.metric = raw.metric;
  }
  return def;
}

async function definitionContext(db) {
  return {
    categoryKeys: (await getSetting(db, 'categories')).map((c) => c.key),
    groupIds: (await db.all('SELECT id FROM user_groups')).map((g) => g.id),
    formIds: (await db.all('SELECT id FROM catalog_items')).map((f) => f.id),
  };
}

// ---------------------------------------------------------------------------------------------------
// Requêtes

/** Une personne avec ses droits du moment, pour calculer un rapport en son nom. */
async function loadActor(db, userId) {
  const row = await db.get('SELECT * FROM users WHERE id = ? AND anonymized_at IS NULL', [userId]);
  if (!row) return null;
  return { ...publicUser(row), access: await computeAccess(db, row) };
}

const isoOf = (d) => (d ? d.toISOString() : null);

/**
 * Clause WHERE d'une définition pour une personne : demandes non supprimées, visibles par elle, filtres.
 * `window` remplace la période des filtres (comparaisons, tendances).
 */
function whereClause(def, actor, { window, dateField, skipPeriod = false, overrides = {} } = {}) {
  const f = { ...def.filters, ...overrides };
  const vis = visibilityClause(actor);
  const parts = ['t.deleted_at IS NULL', vis.sql];
  const params = [...vis.params];
  const inList = (sql, values) => {
    parts.push(`${sql} IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  };
  if (f.status?.length) inList('t.status', f.status);
  if (f.priority?.length) inList('t.priority', f.priority);
  if (f.category?.length) inList("COALESCE(t.category, '')", f.category);
  if (f.group?.length) {
    const ors = [];
    const ids = f.group.filter((g) => !['mine', 'none'].includes(g)).map(Number);
    if (ids.length) {
      ors.push(`t.assigned_group IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    if (f.group.includes('mine')) {
      ors.push('t.assigned_group IN (SELECT group_id FROM group_members WHERE user_id = ?)');
      params.push(actor.id);
    }
    if (f.group.includes('none')) ors.push('t.assigned_group IS NULL');
    parts.push(`(${ors.join(' OR ')})`);
  }
  if (f.form?.length) {
    const ids = f.form.filter((v) => v !== 'none').map(Number);
    const ors = [];
    if (ids.length) {
      ors.push(`t.catalog_item IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    if (f.form.includes('none')) ors.push('t.catalog_item IS NULL');
    parts.push(`(${ors.join(' OR ')})`);
  }
  if (f.assignee === 'me') {
    parts.push('t.assigned_to = ?');
    params.push(actor.id);
  } else if (f.assignee === 'none') parts.push('t.assigned_to IS NULL');
  else if (f.assignee === 'assigned') parts.push('t.assigned_to IS NOT NULL');
  if (f.creator === 'me') {
    parts.push('t.created_by = ?');
    params.push(actor.id);
  }
  if (f.overdue) {
    parts.push(`${ACTIVE_SQL} AND t.due_date IS NOT NULL AND t.due_date < ?`);
    params.push(localDay(new Date()));
  }
  if (f.sla) {
    const st = withToday(`(${SLA_RES_STATE})`);
    // « late » : dépassé, terminé ou non ; « attention » : en cours, dépassé ou bientôt dépassé.
    const values = f.sla === 'late' ? ['breached', 'missed'] : f.sla === 'attention' ? ['breached', 'at_risk'] : [f.sla];
    parts.push(`${st.sql} IN (${values.map(() => '?').join(', ')})`);
    params.push(...st.params, ...values);
  }
  if (f.confidential === 'exclude') parts.push('t.confidential = 0');
  if (f.confidential === 'only') parts.push('t.confidential = 1');
  if (f.q) {
    parts.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  if (!skipPeriod) {
    const w = window || periodWindow(f.period?.range);
    const col = DATE_FIELDS[dateField || f.period?.field || 'created'];
    if (w.from) {
      parts.push(`${col} >= ?`);
      params.push(isoOf(w.from));
    }
    if (w.to) {
      parts.push(`${col} < ?`);
      params.push(isoOf(w.to));
    }
  }
  return { sql: parts.join(' AND '), params };
}

/** Remplace :today (date locale du jour) et :now (instant présent) par des paramètres, dans l'ordre. */
const withToday = (sql) => {
  const today = localDay(new Date());
  const now = new Date().toISOString();
  const params = [];
  const out = sql.replace(/:(today|now)\b/g, (_, k) => {
    params.push(k === 'today' ? today : now);
    return '?';
  });
  return { sql: out, params };
};

async function labelMaps(db) {
  const categories = await getSetting(db, 'categories');
  const priorities = await getSetting(db, 'priorities');
  return {
    status: (v) => STATUS_LABELS[v] || v,
    priority: (v) => priorities?.[v]?.label || v,
    category: (v) => (v ? categories.find((c) => c.key === v)?.label || v : 'Sans catégorie'),
  };
}

function dimensionLabel(dim, key, name, labels) {
  if (dim === 'status' || dim === 'priority' || dim === 'category') return labels[dim](key);
  if (dim === 'group') return Number(key) ? name || 'Groupe supprimé' : 'Sans groupe';
  if (dim === 'assignee') return Number(key) ? name || 'Compte supprimé' : 'Personne';
  if (dim === 'creator') return Number(key) ? name || 'Compte supprimé' : 'Compte supprimé';
  if (dim === 'form') return Number(key) ? name || 'Formulaire supprimé' : 'Demande libre';
  if (dim === 'month') {
    const [y, m] = String(key).split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  if (dim === 'weekday') return WEEKDAYS[Number(key)] || key;
  if (dim === 'sla_state' || dim === 'sla_response_state') return SLA_STATE_LABELS[key] || key;
  return String(key);
}

/** Ordre naturel des valeurs d'un axe. */
function sortKeys(dim, entries) {
  if (dim === 'status') return entries.sort((a, b) => STATUSES.indexOf(a.key) - STATUSES.indexOf(b.key));
  if (dim === 'priority') return entries.sort((a, b) => PRIORITIES.indexOf(b.key) - PRIORITIES.indexOf(a.key));
  if (dim === 'month') return entries.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  if (dim === 'weekday') return entries.sort((a, b) => ((Number(a.key) + 6) % 7) - ((Number(b.key) + 6) % 7));
  if (dim === 'sla_state' || dim === 'sla_response_state') return entries.sort((a, b) => SLA_ORDER.indexOf(a.key) - SLA_ORDER.indexOf(b.key));
  return entries.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'fr'));
}

const round = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

async function runList(db, def, actor, opts) {
  const w = whereClause(def, actor, opts);
  const cols = def.columns.map((c) => `${COLUMNS[c].sql} AS "${c}"`).join(', ');
  const order = `${COLUMNS[def.sort.field].sql} ${def.sort.dir === 'asc' ? 'ASC' : 'DESC'}, t.id DESC`;
  const total = (await db.get(`SELECT COUNT(*) AS n ${FROM} WHERE ${w.sql}`, w.params)).n;
  const sel = withToday(`SELECT t.id AS _id, ${cols}`);
  const ord = withToday(order);
  const rows = await db.all(`${sel.sql} ${FROM} WHERE ${w.sql} ORDER BY ${ord.sql} LIMIT ?`, [...sel.params, ...w.params, ...ord.params, def.limit]);
  const labels = await labelMaps(db);
  return {
    type: 'list',
    columns: def.columns.map((c) => ({ key: c, label: COLUMNS[c].label })),
    rows: rows.map((r) => {
      const out = { id: r._id };
      for (const c of def.columns) {
        let v = r[c];
        if (c === 'status') v = labels.status(v);
        if (c === 'priority') v = labels.priority(v);
        if (c === 'category') v = labels.category(v);
        if (c === 'sla_state') v = SLA_STATE_LABELS[v] || v;
        out[c] = v ?? null;
      }
      return out;
    }),
    total,
    truncated: total > rows.length,
  };
}

async function runSummary(db, def, actor, opts) {
  const w = whereClause(def, actor, opts);
  const dim = DIMENSIONS[def.dimension];
  const split = def.split ? DIMENSIONS[def.split] : null;
  const sel = withToday(
    `SELECT ${dim.key} AS k, ${dim.name || 'NULL'} AS kn${split ? `, ${split.key} AS s, ${split.name || 'NULL'} AS sn` : ''},
       ${METRICS[def.metric].sql} AS v, COUNT(*) AS c, SUM(CASE WHEN t.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS rc`
  );
  const rows = await db.all(`${sel.sql} ${FROM} WHERE ${w.sql} GROUP BY k${split ? ', s' : ''}`, [...sel.params, ...w.params]);
  const labels = await labelMaps(db);
  const cats = new Map();
  for (const r of rows) {
    const e = cats.get(String(r.k)) || { key: r.k, label: dimensionLabel(def.dimension, r.k, r.kn, labels), total: 0 };
    e.total += r.c;
    cats.set(String(r.k), e);
  }
  let categories = sortKeys(def.dimension, [...cats.values()]);
  let other = null;
  if (categories.length > def.limit && !['status', 'priority', 'month', 'weekday', 'sla_state', 'sla_response_state'].includes(def.dimension)) {
    other = new Set(categories.slice(def.limit - 1).map((c) => String(c.key)));
    categories = [...categories.slice(0, def.limit - 1), { key: '__other', label: 'Autres', total: 0 }];
  }
  const catIndex = (k) => (other?.has(String(k)) ? categories.length - 1 : categories.findIndex((c) => String(c.key) === String(k)));
  const decimals = METRICS[def.metric].decimals || 0;
  // Moyennes et pourcentages : une valeur regroupée (« Autres ») est pondérée, pas additionnée.
  const avg = def.metric === 'avg_resolution' || METRICS[def.metric].percent;
  let series;
  if (!split) {
    const values = categories.map(() => 0);
    const weights = categories.map(() => 0);
    for (const r of rows) {
      const i = catIndex(r.k);
      if (avg) {
        if (r.v != null) {
          const wgt = METRICS[def.metric].percent ? r.c : r.rc;
          values[i] += r.v * wgt;
          weights[i] += wgt;
        }
      } else values[i] += r.v || 0;
    }
    series = [{ key: def.metric, label: METRICS[def.metric].label, values: values.map((v, i) => round(avg ? (weights[i] ? v / weights[i] : null) : v, decimals)) }];
  } else {
    const ser = new Map();
    for (const r of rows) {
      const sk = String(r.s);
      if (!ser.has(sk)) {
        ser.set(sk, { key: r.s, label: dimensionLabel(def.split, r.s, r.sn, labels), values: categories.map(() => 0), weights: categories.map(() => 0), total: 0 });
      }
      const s = ser.get(sk);
      const i = catIndex(r.k);
      if (avg) {
        if (r.v != null) {
          const wgt = METRICS[def.metric].percent ? r.c : r.rc;
          s.values[i] += r.v * wgt;
          s.weights[i] += wgt;
        }
      } else s.values[i] += r.v || 0;
      s.total += r.c;
    }
    series = sortKeys(def.split, [...ser.values()]).map((s) => ({
      key: s.key,
      label: s.label,
      values: s.values.map((v, i) => round(avg ? (s.weights[i] ? v / s.weights[i] : null) : v, decimals)),
    }));
  }
  return {
    type: 'summary',
    dimension: { key: def.dimension, label: dim.label },
    split: split ? { key: def.split, label: split.label } : null,
    metric: { key: def.metric, label: METRICS[def.metric].label, decimals, unit: METRICS[def.metric].percent ? '%' : null },
    categories: categories.map((c) => ({ key: c.key, label: c.label })),
    series,
    total: rows.reduce((n, r) => n + r.c, 0),
  };
}

function buckets(interval, w, now = new Date()) {
  const out = [];
  const end = w.to || now;
  const d = new Date(w.from);
  if (interval === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (interval === 'month') d.setDate(1);
  while (d < end && out.length < 400) {
    if (interval === 'month') {
      out.push({ key: localMonth(d), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
      d.setMonth(d.getMonth() + 1);
    } else {
      out.push({ key: localDay(d), label: `${d.getDate()} ${MONTHS[d.getMonth()]}` });
      d.setDate(d.getDate() + (interval === 'week' ? 7 : 1));
    }
  }
  return out;
}

async function runTrend(db, def, actor, opts) {
  const range = opts.overrides?.period?.range || def.filters.period.range;
  const w = opts.window || periodWindow(range === 'all' ? '30d' : range);
  const b = buckets(def.interval, w);
  const keyOf = (col) =>
    def.interval === 'month'
      ? `strftime('%Y-%m', ${col}, 'localtime')`
      : def.interval === 'week'
        ? `date(${col}, 'localtime', '-6 days', 'weekday 1')`
        : `date(${col}, 'localtime')`;
  const labels = { created: 'Créées', resolved: 'Résolues', sla_rate: 'Résolutions dans les délais (%)' };
  const series = [];
  for (const s of def.series) {
    if (s === 'sla_rate') {
      const where = whereClause(def, actor, { ...opts, window: w, dateField: 'resolved' });
      const rate = withToday(rateOf(SLA_RES_STATE, "'met', 'missed'"));
      const rows = await db.all(
        `SELECT ${keyOf('t.resolved_at')} AS k, ${rate.sql} AS v ${FROM} WHERE ${where.sql} AND t.resolved_at IS NOT NULL AND t.sla_resolution_due IS NOT NULL GROUP BY k`,
        [...rate.params, ...where.params]
      );
      const map = new Map(rows.map((r) => [r.k, r.v == null ? null : round(r.v, 1)]));
      series.push({ key: s, label: labels[s], values: b.map((x) => (map.has(x.key) ? map.get(x.key) : null)), unit: '%' });
      continue;
    }
    const col = DATE_FIELDS[s];
    const where = whereClause(def, actor, { ...opts, window: w, dateField: s });
    const rows = await db.all(`SELECT ${keyOf(col)} AS k, COUNT(*) AS n ${FROM} WHERE ${where.sql} AND ${col} IS NOT NULL GROUP BY k`, where.params);
    const map = new Map(rows.map((r) => [r.k, r.n]));
    series.push({ key: s, label: labels[s], values: b.map((x) => map.get(x.key) || 0) });
  }
  return { type: 'trend', interval: def.interval, categories: b, series, metric: def.series[0] === 'sla_rate' ? { key: 'sla_rate', label: labels.sla_rate, decimals: 1, unit: '%' } : undefined };
}

async function runKpi(db, def, actor, opts) {
  const k = KPIS[def.metric];
  const range = opts.overrides?.period?.range || def.filters.period.range;
  const compute = async (window) => {
    const where = whereClause(def, actor, { ...opts, window, dateField: k.field || undefined, skipPeriod: !k.field });
    const extra = k.where ? withToday(k.where) : { sql: '1 = 1', params: [] };
    const sel = withToday(k.sql);
    const r = await db.get(`SELECT ${sel.sql} AS v ${FROM} WHERE ${where.sql} AND ${extra.sql}`, [...sel.params, ...where.params, ...extra.params]);
    return round(r.v, k.decimals || 0);
  };
  const value = await compute(opts.window || periodWindow(range));
  const prevWindow = k.field && !opts.window ? previousWindow(range) : null;
  const previous = prevWindow ? await compute(prevWindow) : null;
  // Tendance sur la période, pour une petite courbe sous le chiffre.
  let spark = null;
  if (k.field && !k.unit && range !== 'all') {
    const t = await runTrend(db, { ...def, type: 'trend', interval: ['12m', 'this_year'].includes(range) ? 'month' : 'day', series: [k.field] }, actor, opts);
    spark = t.series[0].values;
  }
  return { type: 'kpi', metric: { key: def.metric, label: k.label, unit: k.unit || null, decimals: k.decimals || 0 }, value: value ?? 0, previous, spark, period: k.field ? PERIODS[range] : 'En ce moment' };
}

async function runHeatmap(db, def, actor, opts) {
  const w = whereClause(def, actor, opts);
  const rows = await db.all(
    `SELECT CAST(strftime('%w', t.created_at, 'localtime') AS INTEGER) AS d, CAST(strftime('%H', t.created_at, 'localtime') AS INTEGER) AS h, COUNT(*) AS n
     ${FROM} WHERE ${w.sql} GROUP BY d, h`,
    w.params
  );
  // Lignes du lundi au dimanche, colonnes de 0 h à 23 h.
  const values = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) values[(r.d + 6) % 7][r.h] = r.n;
  return {
    type: 'heatmap',
    rows: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
    columns: Array.from({ length: 24 }, (_, h) => `${h} h`),
    values,
    max: Math.max(0, ...values.flat()),
    total: rows.reduce((n, r) => n + r.n, 0),
  };
}

/**
 * Calcule un rapport pour une personne. `overrides` : filtres imposés par un tableau de bord
 * (période, groupe), qui remplacent ceux du rapport.
 */
async function runReport(db, def, actor, { overrides = {} } = {}) {
  const opts = { overrides };
  const result =
    def.type === 'list'
      ? await runList(db, def, actor, opts)
      : def.type === 'summary'
        ? await runSummary(db, def, actor, opts)
        : def.type === 'trend'
          ? await runTrend(db, def, actor, opts)
          : def.type === 'kpi'
            ? await runKpi(db, def, actor, opts)
            : await runHeatmap(db, def, actor, opts);
  return { ...result, chart: def.chart, period: result.period || PERIODS[overrides.period?.range || def.filters.period.range], generatedAt: new Date().toISOString() };
}

/**
 * Un destinataire peut recevoir le rapport calculé avec les droits du créateur seulement s'il voit
 * lui-même chacune des demandes concernées (aucune n'échappe à ses propres droits).
 */
async function recipientCanSee(db, def, creator, recipient) {
  if (recipient.id === creator.id) return true;
  const w = whereClause(def, creator, def.type === 'trend' || def.type === 'kpi' ? { skipPeriod: true } : {});
  const vis = visibilityClause(recipient);
  // COALESCE : une comparaison avec une valeur vide (NULL) ne doit pas faire passer une demande pour visible.
  const hidden = await db.get(`SELECT COUNT(*) AS n ${FROM} WHERE ${w.sql} AND NOT COALESCE(${vis.sql}, 0)`, [...w.params, ...vis.params]);
  return hidden.n === 0;
}

// ---------------------------------------------------------------------------------------------------
// Export CSV (séparateur « ; » pour Excel en français, BOM UTF-8)

/** Le résultat d'un rapport sous forme de table (intitulés + lignes), pour les exports. */
function resultTable(result) {
  if (result.type === 'list') {
    return { headers: result.columns.map((c) => c.label), rows: result.rows.map((r) => result.columns.map((c) => r[c.key])) };
  }
  if (result.type === 'summary' || result.type === 'trend') {
    const head = result.type === 'summary' ? result.dimension.label : 'Période';
    return { headers: [head, ...result.series.map((s) => s.label)], rows: result.categories.map((c, i) => [c.label, ...result.series.map((s) => s.values[i])]) };
  }
  if (result.type === 'kpi') return { headers: ['Indicateur', 'Valeur', 'Période précédente'], rows: [[result.metric.label, result.value, result.previous]] };
  if (result.type === 'heatmap') return { headers: ['Jour', ...result.columns], rows: result.rows.map((r, i) => [r, ...result.values[i]]) };
  return { headers: [], rows: [] };
}

function toCsv(result) {
  const t = resultTable(result);
  return exportCsv(t.headers, t.rows);
}

/** Export d'un résultat de rapport au format demandé (csv, xlsx, json). */
function reportExport(format, result, { name, baseName }) {
  const t = resultTable(result);
  return buildExport(format, {
    baseName,
    title: name,
    sheets: [{ name: name || 'Rapport', headers: t.headers, rows: t.rows }],
    json: {
      rapport: name,
      periode: result.period || 'depuis le début',
      exporte_le: new Date().toISOString(),
      lignes: t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? null]))),
    },
  });
}

module.exports = {
  resultTable,
  reportExport,
  SLA_STATE_LABELS,
  TYPES,
  PERIODS,
  DIMENSIONS,
  METRICS,
  KPIS,
  COLUMNS,
  CHARTS,
  DEFAULT_COLUMNS,
  STATUS_LABELS,
  validateDefinition,
  definitionContext,
  loadActor,
  runReport,
  recipientCanSee,
  periodWindow,
  previousWindow,
  toCsv,
};

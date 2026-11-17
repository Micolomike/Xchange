/**
 * SLA : engagements de délai pour la prise en charge et la résolution des demandes.
 *
 * - Les délais se comptent en temps ouvré (jours et heures choisis, jours fériés français exclus),
 *   ou en temps continu.
 * - Chaque demande garde ses propres échéances, calculées à sa création (et recalculées si sa priorité
 *   ou sa catégorie change avant l'échéance). Modifier les réglages ne touche que les nouvelles demandes,
 *   sauf si l'administrateur demande de recalculer les demandes en cours.
 * - Prise en charge : la demande a un responsable, change de statut, ou reçoit un message d'une autre
 *   personne que son auteur. Résolution : passage à « Résolu » ou « Fermé ».
 */
const { HttpError, PRIORITIES } = require('./utils');
const { getSetting, setSetting } = require('./settings');

const MAX_MINUTES = 60 * 24 * 365;
const DAY = 86400_000;

// ---------------------------------------------------------------------------------------------- Calendrier

/** Jours fériés en France (métropole), calculés pour une année : fixes et liés à Pâques. */
function frenchHolidays(year) {
  // Calcul de Pâques (algorithme de Meeus).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(year, month - 1, day);
  const plus = (n) => new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + n);
  const key = (dt) => `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
  return new Set(
    [
      new Date(year, 0, 1),
      plus(1), // lundi de Pâques
      new Date(year, 4, 1),
      new Date(year, 4, 8),
      plus(39), // Ascension
      plus(50), // lundi de Pentecôte
      new Date(year, 6, 14),
      new Date(year, 7, 15),
      new Date(year, 10, 1),
      new Date(year, 10, 11),
      new Date(year, 11, 25),
    ].map(key)
  );
}

const holidayCache = new Map();
function isHoliday(d) {
  const y = d.getFullYear();
  if (!holidayCache.has(y)) holidayCache.set(y, frenchHolidays(y));
  return holidayCache.get(y).has(`${y}-${d.getMonth() + 1}-${d.getDate()}`);
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** Plage ouvrée d'un jour (en millisecondes), ou null s'il est chômé. */
function windowOf(day, cal) {
  if (!cal.days.includes(day.getDay())) return null;
  if (cal.holidays && isHoliday(day)) return null;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(cal.start));
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(cal.end));
  return [start.getTime(), end.getTime()];
}

const dayMinutes = (cal) => (cal.mode === 'continuous' ? 1440 : toMinutes(cal.end) - toMinutes(cal.start));

/** Date atteinte après `minutes` de temps ouvré à partir de `from`. */
function addWorkingMinutes(from, minutes, cal) {
  if (cal.mode === 'continuous') return new Date(from.getTime() + minutes * 60_000);
  let left = minutes * 60_000;
  let cursor = from.getTime();
  let day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let n = 0; n < 3700; n += 1) {
    const w = windowOf(day, cal);
    if (w) {
      const start = Math.max(cursor, w[0]);
      if (start < w[1]) {
        const avail = w[1] - start;
        if (left <= avail) return new Date(start + left);
        left -= avail;
      }
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    cursor = day.getTime();
  }
  return new Date(from.getTime() + minutes * 60_000);
}

/** Minutes ouvrées entre deux dates (0 si `to` est avant `from`). */
function workingMinutesBetween(from, to, cal) {
  if (to <= from) return 0;
  if (cal.mode === 'continuous') return Math.round((to - from) / 60_000);
  let total = 0;
  let day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let n = 0; n < 3700 && day.getTime() < to.getTime(); n += 1) {
    const w = windowOf(day, cal);
    if (w) {
      const s = Math.max(w[0], from.getTime());
      const e = Math.min(w[1], to.getTime());
      if (e > s) total += e - s;
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return Math.round(total / 60_000);
}

// ---------------------------------------------------------------------------------------------- Réglages

function cleanTarget(v, label) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > MAX_MINUTES) throw new HttpError(400, `${label} : durée invalide.`);
  return n;
}

function validateSla(body, current, { categoryKeys }) {
  const b = body && typeof body === 'object' ? body : {};
  const out = structuredClone(current);
  if ('enabled' in b) out.enabled = Boolean(b.enabled);
  if (b.calendar) {
    const c = b.calendar;
    const mode = c.mode === 'continuous' ? 'continuous' : 'business';
    const days = [...new Set((Array.isArray(c.days) ? c.days : []).map(Number))].filter((d) => d >= 0 && d <= 6).sort();
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (mode === 'business') {
      if (!days.length) throw new HttpError(400, 'Choisissez au moins un jour ouvré.');
      if (!time.test(c.start) || !time.test(c.end) || toMinutes(c.end) - toMinutes(c.start) < 60) {
        throw new HttpError(400, 'Horaires invalides : la fin doit être au moins une heure après le début.');
      }
    }
    out.calendar = { mode, days: days.length ? days : [1, 2, 3, 4, 5], start: c.start || '09:00', end: c.end || '18:00', holidays: c.holidays !== false };
  }
  if ('warnPercent' in b) {
    const w = Number(b.warnPercent);
    if (!(w >= 10 && w <= 95)) throw new HttpError(400, "Le seuil d'alerte doit être entre 10 et 95 %.");
    out.warnPercent = Math.round(w);
  }
  if (b.targets) {
    out.targets = {};
    for (const p of PRIORITIES) {
      const t = b.targets[p] || {};
      out.targets[p] = { response: cleanTarget(t.response, 'Prise en charge'), resolution: cleanTarget(t.resolution, 'Résolution') };
      if (out.targets[p].response && out.targets[p].resolution && out.targets[p].response > out.targets[p].resolution) {
        throw new HttpError(400, 'La prise en charge doit être plus courte que la résolution.');
      }
    }
  }
  if ('rules' in b) {
    if (!Array.isArray(b.rules) || b.rules.length > 50) throw new HttpError(400, 'Règles invalides.');
    out.rules = b.rules.map((r) => {
      if (!['', ...categoryKeys].includes(r.category)) throw new HttpError(400, "Une règle vise une catégorie qui n'existe plus.");
      if (!['all', ...PRIORITIES].includes(r.priority || 'all')) throw new HttpError(400, 'Règle : priorité inconnue.');
      const rule = { category: r.category, priority: r.priority || 'all', response: cleanTarget(r.response, 'Règle'), resolution: cleanTarget(r.resolution, 'Règle') };
      if (rule.response && rule.resolution && rule.response > rule.resolution) throw new HttpError(400, 'Règle : la prise en charge doit être plus courte que la résolution.');
      return rule;
    });
  }
  if (b.notify) out.notify = { warning: b.notify.warning !== false, breach: b.notify.breach !== false };
  return out;
}

/** Cibles d'une demande : première règle de sa catégorie qui convient, sinon celles de sa priorité. */
function targetsFor(settings, ticket) {
  const cat = ticket.category || '';
  const rule = settings.rules.find((r) => r.category === cat && (r.priority === 'all' || r.priority === ticket.priority));
  const base = settings.targets[ticket.priority] || { response: null, resolution: null };
  return rule ? { response: rule.response, resolution: rule.resolution, rule: true } : { ...base, rule: false };
}

/** Échéances d'une demande créée à `created`. */
function computeDue(settings, ticket, created = new Date(ticket.created_at)) {
  const t = targetsFor(settings, ticket);
  const cal = settings.calendar;
  const pct = settings.warnPercent / 100;
  const at = (min) => (min ? addWorkingMinutes(created, min, cal).toISOString() : null);
  return {
    response_due: at(t.response),
    response_warn: t.response ? at(Math.max(1, Math.round(t.response * pct))) : null,
    resolution_due: at(t.resolution),
    resolution_warn: t.resolution ? at(Math.max(1, Math.round(t.resolution * pct))) : null,
  };
}

const policyKey = (t) => `${t.priority}|${t.category || ''}`;

// ---------------------------------------------------------------------------------------------- Demandes

const DONE = ['resolved', 'closed'];

/**
 * Met à jour le SLA d'une demande après un changement : échéances (création ou changement de priorité ou
 * de catégorie avant résolution) et date de prise en charge.
 */
async function refreshSla(db, ticketId, { now = new Date(), force = false } = {}) {
  const settings = await getSetting(db, 'sla');
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!t) return;
  const sets = {};
  if (settings.enabled && (force || t.sla_policy == null || (t.sla_policy !== policyKey(t) && !t.resolved_at))) {
    const due = computeDue(settings, t);
    sets.sla_policy = policyKey(t);
    // Une étape déjà atteinte garde ses échéances.
    if (!t.sla_responded_at || force || t.sla_policy == null) Object.assign(sets, { sla_response_due: due.response_due, sla_response_warn: due.response_warn });
    if (!t.resolved_at || force || t.sla_policy == null) Object.assign(sets, { sla_resolution_due: due.resolution_due, sla_resolution_warn: due.resolution_warn });
    // Nouvelle échéance : les alertes déjà envoyées pour l'ancienne ne comptent plus.
    if (t.sla_policy != null) sets.sla_notified = '';
  }
  if (!t.sla_responded_at) {
    let responded = t.assigned_to != null || t.status !== 'open';
    if (!responded) {
      responded = Boolean(await db.get('SELECT 1 FROM comments WHERE ticket_id = ? AND author_id IS NOT ? LIMIT 1', [ticketId, t.created_by]));
    }
    if (responded) sets.sla_responded_at = now.toISOString();
  }
  const cols = Object.keys(sets);
  if (cols.length) await db.run(`UPDATE tickets SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => sets[c]), ticketId]);
}

/**
 * Demandes sans SLA (créées avant sa mise en place) : échéances calculées depuis leur création, et date de
 * prise en charge retrouvée dans l'historique (premier responsable, premier changement de statut,
 * premier message d'une autre personne).
 */
async function backfillSla(db) {
  const settings = await getSetting(db, 'sla');
  if (!settings.enabled) return 0;
  const rows = await db.all('SELECT * FROM tickets WHERE sla_policy IS NULL');
  for (const t of rows) {
    const due = computeDue(settings, t);
    const first = await db.get(
      `SELECT MIN(at) AS at FROM (
         SELECT MIN(created_at) AS at FROM ticket_events WHERE ticket_id = ? AND type IN ('assignee', 'status')
         UNION ALL SELECT MIN(created_at) FROM comments WHERE ticket_id = ? AND author_id IS NOT ?)`,
      [t.id, t.id, t.created_by]
    );
    const responded = first?.at || (t.assigned_to != null || t.status !== 'open' ? t.updated_at || t.created_at : null);
    await db.run(
      `UPDATE tickets SET sla_policy = ?, sla_response_due = ?, sla_response_warn = ?, sla_resolution_due = ?, sla_resolution_warn = ?,
         sla_responded_at = COALESCE(sla_responded_at, ?), sla_notified = 'rw,rb,sw,sb' WHERE id = ?`,
      [policyKey(t), due.response_due, due.response_warn, due.resolution_due, due.resolution_warn, responded, t.id]
    );
  }
  return rows.length;
}

/** Recalcule les échéances des demandes en cours avec les réglages actuels (après une modification). */
async function recalculateOpen(db) {
  const rows = await db.all("SELECT id FROM tickets WHERE deleted_at IS NULL AND status IN ('open', 'in_progress')");
  for (const r of rows) await refreshSla(db, r.id, { force: true });
  return rows.length;
}

/** État d'une étape à un instant : none, running, at_risk, breached, met, missed. */
function stepState({ due, warn, doneAt }, now = new Date()) {
  if (!due) return 'none';
  if (doneAt) return doneAt <= due ? 'met' : 'missed';
  const n = now.toISOString();
  if (n > due) return 'breached';
  if (warn && n >= warn) return 'at_risk';
  return 'running';
}

/** Résumé SLA d'une demande pour l'API. */
function describeTicketSla(row, now = new Date()) {
  if (!row.sla_policy) return null;
  const response = { due: row.sla_response_due, warnAt: row.sla_response_warn, doneAt: row.sla_responded_at };
  const resolution = { due: row.sla_resolution_due, warnAt: row.sla_resolution_warn, doneAt: row.resolved_at };
  // Une demande fermée sans être prise en charge : la prise en charge compte à la résolution.
  if (!response.doneAt && DONE.includes(row.status)) response.doneAt = row.resolved_at;
  return {
    response: { ...response, state: stepState(response, now) },
    resolution: { ...resolution, state: stepState(resolution, now) },
  };
}

// ---------------------------------------------------------------------------------------------- Alertes

/**
 * Alertes : à l'approche de l'échéance (seuil) et quand elle est dépassée, pour le responsable,
 * ou les membres du groupe s'il n'y en a pas. Une seule fois par étape et par échéance.
 */
async function checkAlerts(db, notifier, now = new Date()) {
  const settings = await getSetting(db, 'sla');
  if (!settings.enabled || !notifier) return 0;
  const n = now.toISOString();
  const rows = await db.all(
    `SELECT * FROM tickets WHERE deleted_at IS NULL AND status IN ('open', 'in_progress') AND sla_policy IS NOT NULL AND (
       (sla_responded_at IS NULL AND sla_response_warn IS NOT NULL AND sla_response_warn <= ?)
       OR (sla_resolution_warn IS NOT NULL AND sla_resolution_warn <= ?))`,
    [n, n]
  );
  let sent = 0;
  for (const t of rows) {
    const done = new Set(String(t.sla_notified || '').split(',').filter(Boolean));
    const todo = [];
    if (!t.sla_responded_at && t.sla_response_due) {
      if (n > t.sla_response_due && !done.has('rb')) todo.push(['rb', 'response', 'breach']);
      else if (n >= t.sla_response_warn && n <= t.sla_response_due && !done.has('rw')) todo.push(['rw', 'response', 'warning']);
    }
    if (t.sla_resolution_due) {
      if (n > t.sla_resolution_due && !done.has('sb')) todo.push(['sb', 'resolution', 'breach']);
      else if (n >= t.sla_resolution_warn && n <= t.sla_resolution_due && !done.has('sw')) todo.push(['sw', 'resolution', 'warning']);
    }
    for (const [code, step, kind] of todo) {
      done.add(code);
      // Un dépassement vaut aussi pour l'alerte d'approche, qui n'a plus lieu d'être.
      if (code === 'rb') done.add('rw');
      if (code === 'sb') done.add('sw');
      if ((kind === 'warning' && settings.notify.warning) || (kind === 'breach' && settings.notify.breach)) {
        notifier.slaAlert(t.id, { step, kind, due: step === 'response' ? t.sla_response_due : t.sla_resolution_due });
        sent += 1;
      }
    }
    if (todo.length) await db.run('UPDATE tickets SET sla_notified = ? WHERE id = ?', [[...done].join(','), t.id]);
  }
  return sent;
}

function startSlaScheduler({ db, notifier, logger = console, intervalMs = 5 * 60_000 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkAlerts(db, notifier);
    } catch (err) {
      logger.error(`Alertes SLA : ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 10_000).unref();
  return () => clearInterval(timer);
}

/** Exemple pour l'administration : échéances d'une demande créée maintenant, pour chaque priorité. */
function preview(settings, now = new Date()) {
  return Object.fromEntries(
    PRIORITIES.map((p) => {
      const d = computeDue(settings, { priority: p, category: '' }, now);
      return [p, { response: d.response_due, resolution: d.resolution_due }];
    })
  );
}

async function saveSla(db, body, ctx) {
  const next = validateSla(body, await getSetting(db, 'sla'), ctx);
  await setSetting(db, 'sla', next);
  return next;
}

module.exports = {
  frenchHolidays,
  addWorkingMinutes,
  workingMinutesBetween,
  dayMinutes,
  validateSla,
  saveSla,
  targetsFor,
  computeDue,
  refreshSla,
  backfillSla,
  recalculateOpen,
  stepState,
  describeTicketSla,
  checkAlerts,
  startSlaScheduler,
  preview,
};

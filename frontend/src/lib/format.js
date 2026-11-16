const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const relFmt = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export function formatDate(value) {
  if (!value) return '';
  // Les dates limites « AAAA-MM-JJ » sont des jours calendaires : pas de décalage de fuseau.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}

export function formatRelative(value) {
  if (!value) return '';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "à l'instant";
  if (abs < 3600) return relFmt.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relFmt.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return relFmt.format(Math.round(diff / 86400), 'day');
  return formatDate(value);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(ticket) {
  return Boolean(
    ticket.due_date && ['open', 'in_progress'].includes(ticket.status) && ticket.due_date < todayIso()
  );
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

export function formatDuration(hours) {
  if (hours == null) return 'n.d.';
  if (hours < 1 / 60) return '< 1 min';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} j`;
}

export const ticketNumber = (id) => `#${String(id).padStart(4, '0')}`;

export function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

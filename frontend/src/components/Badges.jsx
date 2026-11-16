import { PRIORITIES, STATUSES } from '../lib/constants';
import { ticketNumber } from '../lib/format';

export function StatusBadge({ status }) {
  const s = STATUSES[status] || STATUSES.open;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.badge}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

/** Priorité : trois barres croissantes, doublées du libellé (jamais la couleur seule). */
export function PriorityBadge({ priority, showLabel = true }) {
  const p = PRIORITIES[priority] || PRIORITIES.medium;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${p.className}`} title={`Priorité ${p.label.toLowerCase()}`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`w-[3px] rounded-[1px] ${n <= p.bars ? 'bg-current' : 'bg-line-strong'}`}
            style={{ height: `${4 + n * 3}px` }}
          />
        ))}
      </span>
      {showLabel ? p.label : <span className="sr-only">Priorité {p.label}</span>}
    </span>
  );
}

export function TicketStub({ id, size = 'sm', muted = false }) {
  return (
    <span
      className={`ticket-stub ${size === 'lg' ? 'ticket-stub--lg' : 'text-xs'} ${muted ? 'ticket-stub--muted' : ''}`}
      aria-label={`Ticket ${ticketNumber(id)}`}
    >
      {ticketNumber(id)}
    </span>
  );
}

export function Avatar({ user, size = 'sm' }) {
  if (!user) return null;
  const initials = (user.name || user.username)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const dims = size === 'lg' ? 'size-9 text-sm' : 'size-6 text-[0.625rem]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-ink text-white font-bold ${dims}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

import { FiAlertTriangle, FiCheckCircle, FiClock, FiXCircle } from 'react-icons/fi';
import { formatDateTime, formatRelative } from '../lib/format';

const ACTIVE = ['open', 'in_progress'];

/** État le plus urgent des deux délais d'une demande en cours : breached, at_risk ou null. */
function urgency(ticket) {
  const s = ticket.sla;
  if (!s || !ACTIVE.includes(ticket.status)) return null;
  const states = [s.response.state, s.resolution.state];
  if (states.includes('breached')) return 'breached';
  if (states.includes('at_risk')) return 'at_risk';
  return null;
}

/** Pastille dans les listes : seulement quand un délai est dépassé ou proche de l'être. */
export function SlaBadge({ ticket }) {
  const u = urgency(ticket);
  if (!u) return null;
  return u === 'breached' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
      <FiXCircle aria-hidden="true" /> Délai dépassé
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-progress-soft px-2 py-0.5 text-xs font-semibold text-progress">
      <FiAlertTriangle aria-hidden="true" /> Délai proche
    </span>
  );
}

const STEP = {
  met: { icon: FiCheckCircle, cls: 'text-resolved', text: (d) => `Respecté (${formatDateTime(d.doneAt)})` },
  missed: { icon: FiXCircle, cls: 'text-danger', text: (d) => `Non respecté : fait ${formatDateTime(d.doneAt)}, attendu avant ${formatDateTime(d.due)}` },
  breached: { icon: FiXCircle, cls: 'font-semibold text-danger', text: (d) => `Dépassé ${formatRelative(d.due)} (attendu avant ${formatDateTime(d.due)})` },
  at_risk: { icon: FiAlertTriangle, cls: 'font-semibold text-progress', text: (d) => `Bientôt dépassé : avant ${formatDateTime(d.due)}, ${formatRelative(d.due)}` },
  running: { icon: FiClock, cls: 'text-ink', text: (d) => `Avant ${formatDateTime(d.due)} (${formatRelative(d.due)})` },
};

/** Encart de la demande : prise en charge et résolution. */
export function SlaDetail({ sla }) {
  if (!sla) return <span className="text-ink-mute">Aucun engagement</span>;
  const rows = [
    ['Prise en charge', sla.response],
    ['Résolution', sla.resolution],
  ].filter(([, d]) => d.state !== 'none');
  if (!rows.length) return <span className="text-ink-mute">Aucun engagement pour cette priorité</span>;
  return (
    <ul className="space-y-1.5">
      {rows.map(([label, d]) => {
        const st = STEP[d.state];
        const Icon = st.icon;
        return (
          <li key={label} className={`flex items-start gap-1.5 ${st.cls}`}>
            <Icon aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-xs font-semibold text-ink-mute">{label}</span>
              {st.text(d)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

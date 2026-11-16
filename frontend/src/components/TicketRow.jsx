import { Link } from 'react-router-dom';
import { FiCalendar, FiMessageSquare, FiPaperclip, FiUsers } from 'react-icons/fi';
import { PriorityBadge, StatusBadge, TicketStub } from './Badges';
import { formatDate, formatRelative, isOverdue } from '../lib/format';

/** Ligne de ticket compacte, utilisée sur le tableau de bord. */
export default function TicketRow({ ticket, meta = 'updated' }) {
  const overdue = isOverdue(ticket);
  return (
    <li>
      <Link
        to={`/tickets/${ticket.id}`}
        className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-paper focus-visible:bg-paper"
      >
        <TicketStub id={ticket.id} muted={['resolved', 'closed'].includes(ticket.status)} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold text-ink group-hover:text-accent-strong">{ticket.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.due_date && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'font-semibold text-danger' : ''}`}>
                <FiCalendar aria-hidden="true" />
                {overdue ? 'En retard : ' : 'Échéance : '}
                {formatDate(ticket.due_date)}
              </span>
            )}
            {ticket.group && (
              <span className="inline-flex items-center gap-1">
                <FiUsers aria-hidden="true" /> {ticket.group.name}
              </span>
            )}
            {meta === 'updated' && <span>Mis à jour {formatRelative(ticket.updated_at)}</span>}
            {ticket.comment_count > 0 && (
              <span className="inline-flex items-center gap-1" title="Commentaires">
                <FiMessageSquare aria-hidden="true" /> {ticket.comment_count}
              </span>
            )}
            {ticket.attachment_count > 0 && (
              <span className="inline-flex items-center gap-1" title="Pièces jointes">
                <FiPaperclip aria-hidden="true" /> {ticket.attachment_count}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

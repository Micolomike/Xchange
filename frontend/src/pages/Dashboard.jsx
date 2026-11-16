import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus } from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { api } from '../lib/api';
import { PRIORITIES, PRIORITY_ORDER } from '../lib/constants';
import { formatDuration, plural } from '../lib/format';
import { PriorityBadge } from '../components/Badges';
import TicketRow from '../components/TicketRow';
import TrendChart from '../components/TrendChart';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

function Counter({ to, value, label, tone = 'text-ink' }) {
  const content = (
    <>
      <span className={`block text-3xl font-extrabold tabular-nums ${tone}`}>{value}</span>
      <span className="mt-1 block text-sm text-ink-soft">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className="panel block px-4 py-4 transition-colors hover:border-accent">
      {content}
    </Link>
  ) : (
    <div className="panel px-4 py-4">{content}</div>
  );
}

function Section({ title, action, children }) {
  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api('/api/stats')
      .then(setStats)
      .catch(setError);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = user.firstname || user.username;

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!stats) return <Spinner />;

  const maxPriority = Math.max(1, ...Object.values(stats.activeByPriority));
  const subtitle =
    stats.assignedToMe > 0
      ? `${plural(stats.assignedToMe, 'ticket vous est assigné', 'tickets vous sont assignés')} et en attente.`
      : stats.active > 0
        ? `${plural(stats.active, 'ticket actif', 'tickets actifs')}, aucun ne vous est assigné.`
        : 'Aucun ticket en attente pour le moment.';

  return (
    <div>
      <PageHeader
        title={`Bonjour ${firstName}`}
        actions={
          <Link to="/tickets/new" className="btn btn-primary sm:hidden">
            <FiPlus aria-hidden="true" /> Nouveau ticket
          </Link>
        }
      >
        {subtitle}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Counter to="/tickets?status=open" value={stats.byStatus.open} label="Ouverts" tone="text-open" />
        <Counter to="/tickets?status=in_progress" value={stats.byStatus.in_progress} label="En cours" tone="text-progress" />
        <Counter
          to="/tickets?overdue=1"
          value={stats.overdue}
          label="En retard"
          tone={stats.overdue ? 'text-danger' : 'text-ink'}
        />
        <Counter value={formatDuration(stats.avgResolutionHours)} label="Délai moyen de résolution (90 j)" />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section
            title="Ma file"
            action={
              stats.assignedToMe > 0 && (
                <Link to="/tickets?assignee=me&status=active" className="text-sm font-semibold text-accent hover:underline">
                  Tout voir ({stats.assignedToMe})
                </Link>
              )
            }
          >
            {stats.groupQueue > 0 && (
              <div className="border-b border-line bg-accent-soft/60 px-4 py-2.5 text-sm">
                <Link to="/tickets?group=mine&assignee=unassigned" className="font-semibold text-accent-strong hover:underline">
                  {plural(
                    stats.groupQueue,
                    'ticket de vos groupes attend un responsable',
                    'tickets de vos groupes attendent un responsable'
                  )}
                </Link>
              </div>
            )}
            {stats.myQueue.length ? (
              <ul className="divide-y divide-line">
                {stats.myQueue.map((t) => (
                  <TicketRow key={t.id} ticket={t} meta="none" />
                ))}
              </ul>
            ) : (
              <EmptyState title="Rien ne vous est assigné">
                {isAdmin
                  ? 'Les tickets que vous vous assignez apparaîtront ici, triés par priorité.'
                  : 'Quand un ticket vous sera assigné, il apparaîtra ici.'}
              </EmptyState>
            )}
          </Section>

          <Section
            title="Activité récente"
            action={
              <Link to="/tickets?sort=updated_at" className="text-sm font-semibold text-accent hover:underline">
                Tous les tickets
              </Link>
            }
          >
            {stats.recent.length ? (
              <ul className="divide-y divide-line">
                {stats.recent.map((t) => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Aucun ticket pour l'instant"
                action={
                  <Link to="/tickets/new" className="btn btn-primary">
                    Créer le premier ticket
                  </Link>
                }
              >
                Décrivez une demande ou un incident : il sera suivi jusqu'à sa résolution.
              </EmptyState>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="14 derniers jours">
            <div className="px-4 py-4">
              <TrendChart data={stats.trend} />
            </div>
          </Section>

          <Section title="Tickets actifs par priorité">
            <ul className="space-y-3 px-4 py-4">
              {PRIORITY_ORDER.map((p) => {
                const n = stats.activeByPriority[p];
                return (
                  <li key={p}>
                    <Link
                      to={`/tickets?priority=${p}&status=active`}
                      className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 rounded-md text-sm hover:bg-paper"
                    >
                      <PriorityBadge priority={p} />
                      <span className="h-2.5 overflow-hidden rounded-r-[4px] bg-paper">
                        <span
                          className="block h-full rounded-r-[4px] bg-ink-soft"
                          style={{ width: `${(n / maxPriority) * 100}%` }}
                        />
                      </span>
                      <span className="text-right font-semibold tabular-nums">
                        {n}
                        <span className="sr-only"> ticket(s) de priorité {PRIORITIES[p].label.toLowerCase()}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {isAdmin && stats.unassigned > 0 && (
              <div className="border-t border-line px-4 py-3 text-sm">
                <Link to="/tickets?assignee=unassigned&status=active" className="font-semibold text-accent hover:underline">
                  {plural(stats.unassigned, 'ticket actif sans responsable', 'tickets actifs sans responsable')}
                </Link>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

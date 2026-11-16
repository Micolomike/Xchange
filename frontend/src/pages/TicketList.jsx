import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight, FiPlus, FiSearch, FiX } from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { api } from '../lib/api';
import { CATEGORIES, PRIORITIES, PRIORITY_ORDER } from '../lib/constants';
import { formatDate, formatRelative, isOverdue, plural } from '../lib/format';
import { Avatar, PriorityBadge, StatusBadge, TicketStub } from '../components/Badges';
import TicketRow from '../components/TicketRow';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

const STATUS_TABS = [
  { value: 'active', label: 'Actifs' },
  { value: 'open', label: 'Ouverts' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'resolved', label: 'Résolus' },
  { value: 'closed', label: 'Fermés' },
  { value: 'all', label: 'Tous' },
];

const SORTS = [
  { value: 'updated_at:desc', label: 'Dernière activité' },
  { value: 'created_at:desc', label: 'Plus récents' },
  { value: 'created_at:asc', label: 'Plus anciens' },
  { value: 'priority:desc', label: 'Priorité' },
  { value: 'due_date:asc', label: 'Échéance la plus proche' },
];

const PAGE_SIZE = 20;
const FILTER_KEYS = ['q', 'priority', 'category', 'assignee', 'scope', 'overdue'];

export default function TicketList() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState(params.get('q') || '');

  const status = params.get('status') || 'active';
  const sortParam = params.get('sort');
  const sort = SORTS.some((s) => s.value === sortParam) ? sortParam : sortParam ? `${sortParam}:desc` : SORTS[0].value;
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = useMemo(() => {
    const [sortField, order] = sort.split(':');
    return {
      status: status === 'all' ? '' : status,
      q: params.get('q'),
      priority: params.get('priority'),
      category: params.get('category'),
      assignee: params.get('assignee'),
      scope: params.get('scope'),
      overdue: params.get('overdue'),
      sort: sortField,
      order,
      page,
      pageSize: PAGE_SIZE,
    };
  }, [params, status, sort, page]);

  const setParam = useCallback(
    (key, value) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '' || value == null) next.delete(key);
          else next.set(key, value);
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const load = useCallback(() => {
    setError(null);
    api('/api/tickets', { query })
      .then(setData)
      .catch(setError);
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isAdmin) api('/api/users').then(setUsers).catch(() => {});
  }, [isAdmin]);

  // Recherche appliquée 300 ms après la dernière frappe.
  useEffect(() => {
    const current = params.get('q') || '';
    if (search.trim() === current) return undefined;
    const t = setTimeout(() => setParam('q', search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, params, setParam]);

  const hasFilters = FILTER_KEYS.some((k) => params.get(k));
  const resetFilters = () => {
    setSearch('');
    setParams((prev) => {
      const next = new URLSearchParams();
      if (prev.get('status')) next.set('status', prev.get('status'));
      return next;
    });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <PageHeader
        title="Tickets"
        actions={
          <Link to="/tickets/new" className="btn btn-primary sm:hidden">
            <FiPlus aria-hidden="true" /> Nouveau ticket
          </Link>
        }
      >
        {isAdmin ? "Tous les tickets de l'équipe." : 'Les tickets que vous avez créés ou qui vous sont assignés.'}
      </PageHeader>

      <div className="panel">
        <div className="flex gap-1 overflow-x-auto border-b border-line px-2" role="group" aria-label="Filtrer par statut">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => setParam('status', tab.value === 'active' ? '' : tab.value)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                status === tab.value
                  ? 'border-accent text-accent-strong'
                  : 'border-transparent text-ink-mute hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
          <label className="relative block sm:col-span-2 lg:col-span-1">
            <span className="sr-only">Rechercher</span>
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
            <input
              type="search"
              className="field pl-9"
              placeholder="Titre, description ou n°"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            className="field"
            aria-label="Priorité"
            value={params.get('priority') || ''}
            onChange={(e) => setParam('priority', e.target.value)}
          >
            <option value="">Toutes priorités</option>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                Priorité {PRIORITIES[p].label.toLowerCase()}
              </option>
            ))}
          </select>
          <select
            className="field"
            aria-label="Catégorie"
            value={params.get('category') || ''}
            onChange={(e) => setParam('category', e.target.value)}
          >
            <option value="">Toutes catégories</option>
            {Object.entries(CATEGORIES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
            <option value="none">Sans catégorie</option>
          </select>
          {isAdmin ? (
            <select
              className="field"
              aria-label="Responsable"
              value={params.get('assignee') || ''}
              onChange={(e) => setParam('assignee', e.target.value)}
            >
              <option value="">Tous responsables</option>
              <option value="me">Assignés à moi</option>
              <option value="unassigned">Sans responsable</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="field"
              aria-label="Périmètre"
              value={params.get('scope') || ''}
              onChange={(e) => setParam('scope', e.target.value)}
            >
              <option value="">Tous mes tickets</option>
              <option value="mine">Créés par moi</option>
              <option value="assigned">Qui me sont assignés</option>
            </select>
          )}
          <select className="field" aria-label="Trier par" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {(hasFilters || data) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-ink-mute">
            <span aria-live="polite">{data ? plural(data.total, 'ticket', 'tickets') : ''}</span>
            <span className="flex flex-wrap items-center gap-2">
              {params.get('overdue') && (
                <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setParam('overdue', '')}>
                  En retard uniquement <FiX aria-label="Retirer le filtre" />
                </button>
              )}
              {hasFilters && (
                <button type="button" className="font-semibold text-accent hover:underline" onClick={resetFilters}>
                  Effacer les filtres
                </button>
              )}
            </span>
          </div>
        )}

        {error ? (
          <div className="p-6">
            <ErrorState error={error} onRetry={load} />
          </div>
        ) : !data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters || status !== 'all' ? 'Aucun ticket ne correspond' : 'Aucun ticket pour le moment'}
            action={
              hasFilters ? (
                <button type="button" className="btn btn-secondary" onClick={resetFilters}>
                  Effacer les filtres
                </button>
              ) : (
                <Link to="/tickets/new" className="btn btn-primary">
                  Créer un ticket
                </Link>
              )
            }
          >
            {hasFilters ? 'Essayez un autre mot-clé ou retirez un filtre.' : 'Les tickets apparaîtront ici dès leur création.'}
          </EmptyState>
        ) : (
          <>
            {/* Mobile : liste compacte */}
            <ul className="divide-y divide-line border-t border-line md:hidden">
              {data.items.map((t) => (
                <TicketRow key={t.id} ticket={t} />
              ))}
            </ul>

            {/* Écrans larges : tableau */}
            <div className="hidden overflow-x-auto border-t border-line md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-paper text-xs font-semibold text-ink-mute">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">N°</th>
                    <th scope="col" className="px-4 py-2.5">Sujet</th>
                    <th scope="col" className="px-4 py-2.5">Statut</th>
                    <th scope="col" className="px-4 py-2.5">Priorité</th>
                    <th scope="col" className="px-4 py-2.5">Responsable</th>
                    <th scope="col" className="px-4 py-2.5">Échéance</th>
                    <th scope="col" className="px-4 py-2.5">Activité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((t) => {
                    const overdue = isOverdue(t);
                    return (
                      <tr
                        key={t.id}
                        className="cursor-pointer align-top transition-colors hover:bg-paper"
                        onClick={(e) => {
                          if (!e.target.closest('a')) navigate(`/tickets/${t.id}`);
                        }}
                      >
                        <td className="px-4 py-3">
                          <TicketStub id={t.id} muted={['resolved', 'closed'].includes(t.status)} />
                        </td>
                        <td className="max-w-[22rem] px-4 py-3">
                          <Link to={`/tickets/${t.id}`} className="font-semibold text-ink hover:text-accent-strong">
                            {t.title}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-ink-mute">
                            {[CATEGORIES[t.category], t.creator ? `par ${t.creator.name}` : null].filter(Boolean).join(', ')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-4 py-3">
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td className="px-4 py-3">
                          {t.assignee ? (
                            <span className="inline-flex items-center gap-2">
                              <Avatar user={t.assignee} /> <span className="truncate">{t.assignee.name}</span>
                            </span>
                          ) : (
                            <span className="text-ink-mute">Personne</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-3 ${overdue ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                          {t.due_date ? formatDate(t.due_date) : <span className="text-ink-mute">Aucune</span>}
                          {overdue && <span className="block text-xs">En retard</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-mute">{formatRelative(t.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav className="flex items-center justify-between border-t border-line px-4 py-3 text-sm" aria-label="Pagination">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setParam('page', String(page - 1))}
                >
                  <FiChevronLeft aria-hidden="true" /> Précédent
                </button>
                <span className="text-ink-mute">
                  Page {page} sur {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setParam('page', String(page + 1))}
                >
                  Suivant <FiChevronRight aria-hidden="true" />
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}

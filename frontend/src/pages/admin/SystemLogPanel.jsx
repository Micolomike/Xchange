import { Fragment, useCallback, useEffect, useState } from 'react';
import { FiAlertCircle, FiAlertTriangle, FiChevronDown, FiDownload, FiInfo, FiRefreshCw } from 'react-icons/fi';
import { api } from '../../lib/api';
import { toastError } from '../../lib/notify';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';

const LEVELS = {
  info: { label: 'Information', icon: FiInfo, cls: 'bg-accent-soft text-accent-strong' },
  warn: { label: 'Avertissement', icon: FiAlertTriangle, cls: 'bg-progress-soft text-progress' },
  error: { label: 'Erreur', icon: FiAlertCircle, cls: 'bg-danger-soft text-danger' },
};
const PAGE = 100;

const when = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function LevelBadge({ level }) {
  const l = LEVELS[level] || LEVELS.info;
  const Icon = l.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${l.cls}`}>
      <Icon aria-hidden="true" /> {l.label}
    </span>
  );
}

/**
 * Journal système : démarrages, tâches automatiques (sauvegardes, purge, alertes, rapports), erreurs,
 * et actions des administrateurs. Lecture seule ; purgé avec les journaux (onglet RGPD).
 */
export default function SystemLogPanel() {
  const [filters, setFilters] = useState({ level: '', source: '', q: '', from: '', to: '' });
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [auto, setAuto] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api('/api/admin/system-log', { query: { ...filters, limit: PAGE } }));
    } catch (err) {
      setError(err);
    }
  }, [filters]);
  useEffect(() => {
    load();
  }, [load]);

  // Recherche appliquée après une courte pause de frappe.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Actualisation automatique toutes les 10 secondes.
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [auto, load]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await api('/api/admin/system-log', { query: { ...filters, limit: PAGE, before: data.items.at(-1).id } });
      setData((d) => ({ ...d, items: [...d.items, ...r.items], more: r.more }));
    } catch (err) {
      toastError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const download = async () => {
    try {
      const res = await api('/api/admin/system-log/csv', { query: filters, raw: true });
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'journal-systeme.csv';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      toastError(err);
    }
  };

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {['error', 'warn', 'info'].map((l) => {
            const L = LEVELS[l];
            const Icon = L.icon;
            const active = filters.level === l;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={active}
                onClick={() => set({ level: active ? '' : l })}
                className={`panel flex items-center gap-3 p-4 text-left transition-colors hover:border-accent ${active ? 'border-accent ring-1 ring-accent' : ''}`}
              >
                <span className={`flex size-9 items-center justify-center rounded-full ${L.cls}`}>
                  <Icon aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-2xl font-bold tabular-nums">{data.last24h[l]}</span>
                  <span className="text-sm text-ink-mute">
                    {L.label.toLowerCase()}
                    {data.last24h[l] > 1 ? 's' : ''} ces dernières 24 h
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="log-level" className="label">
            Niveau
          </label>
          <select id="log-level" className="field" value={filters.level} onChange={(e) => set({ level: e.target.value })}>
            <option value="">Tous</option>
            <option value="error">Erreurs</option>
            <option value="warn,error">Avertissements et erreurs</option>
            <option value="warn">Avertissements</option>
            <option value="info">Informations</option>
          </select>
        </div>
        <div>
          <label htmlFor="log-source" className="label">
            Source
          </label>
          <select id="log-source" className="field" value={filters.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">Toutes</option>
            {data?.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="log-from" className="label">
            Du
          </label>
          <input id="log-from" type="date" className="field" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="log-to" className="label">
            Au
          </label>
          <input id="log-to" type="date" className="field" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="log-q" className="label">
            Rechercher
          </label>
          <input id="log-q" type="search" className="field" placeholder="Mot, numéro de compte ou de demande" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Actualiser toutes les 10 s
          </label>
          <button type="button" className="btn btn-secondary" onClick={load} aria-label="Actualiser" title="Actualiser">
            <FiRefreshCw aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-secondary" onClick={download}>
            <FiDownload aria-hidden="true" /> CSV
          </button>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !data && <Spinner />}
      {data && !data.items.length && (
        <div className="panel">
          <EmptyState title="Aucune entrée">Rien ne correspond à ces filtres.</EmptyState>
        </div>
      )}
      {data?.items.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-mute">
                <th scope="col" className="px-4 py-2">
                  Date
                </th>
                <th scope="col" className="px-4 py-2">
                  Niveau
                </th>
                <th scope="col" className="px-4 py-2">
                  Source
                </th>
                <th scope="col" className="px-4 py-2">
                  Message
                </th>
                <th scope="col" className="px-4 py-2">
                  Par
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <Fragment key={i.id}>
                  <tr className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-soft">{when(i.createdAt)}</td>
                    <td className="px-4 py-2">
                      <LevelBadge level={i.level} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-soft">{i.sourceLabel}</td>
                    <td className="px-4 py-2">
                      <span className="break-words">{i.message}</span>
                      {i.details && (
                        <button
                          type="button"
                          className="ml-2 inline-flex items-center gap-0.5 text-xs font-semibold text-accent-strong hover:underline"
                          aria-expanded={open.has(i.id)}
                          onClick={() => toggle(i.id)}
                        >
                          Détails <FiChevronDown aria-hidden="true" className={open.has(i.id) ? 'rotate-180' : ''} />
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-soft">{i.actor || <span className="text-ink-mute">Xchange</span>}</td>
                  </tr>
                  {open.has(i.id) && (
                    <tr className="border-b border-line">
                      <td colSpan={5} className="px-4 pb-3">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-paper p-3 text-xs text-ink-soft">{i.details}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {data.more && (
            <div className="border-t border-line p-3 text-center">
              <button type="button" className="btn btn-secondary" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'Chargement…' : 'Entrées plus anciennes'}
              </button>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-ink-mute">
        Le journal ne se modifie pas. Il est effacé au bout de la durée de conservation des journaux (onglet RGPD) ; la même information est aussi écrite dans
        C:\Xchange\journaux sur le PC.
      </p>
    </div>
  );
}

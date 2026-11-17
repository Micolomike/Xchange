import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiClock, FiFileText, FiPlus, FiShare2, FiSlash } from 'react-icons/fi';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { useAuth } from '../../auth/context';
import { AnalyticsTabs } from '../../analytics/common';
import { TYPE_LABELS } from '../../analytics/labels';

const SHARE = { private: 'Privé', groups: 'Partagé avec des groupes', all: 'Partagé avec tout le monde' };

function ReportCard({ r }) {
  return (
    <li>
      <Link to={`/analyses/rapports/${r.id}`} className="panel flex h-full flex-col gap-1 p-4 transition-colors hover:border-accent">
        <span className="flex items-start gap-2">
          <FiFileText aria-hidden="true" className="mt-1 shrink-0 text-ink-mute" />
          <span className="font-semibold text-ink">{r.name}</span>
        </span>
        {r.description && <span className="line-clamp-2 text-sm text-ink-mute">{r.description}</span>}
        <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-2 text-xs text-ink-mute">
          <span>{TYPE_LABELS[r.definition.type]?.label}</span>
          <span className="inline-flex items-center gap-1">
            <FiShare2 aria-hidden="true" /> {r.mine ? SHARE[r.visibility] : `Par ${r.owner.name}`}
          </span>
          {r.schedules > 0 && (
            <span className="inline-flex items-center gap-1">
              <FiClock aria-hidden="true" /> {r.schedules} envoi{r.schedules > 1 ? 's' : ''} programmé{r.schedules > 1 ? 's' : ''}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** Administration : tous les envois programmés, pour arrêter un envoi gênant (les données ne sont pas montrées). */
function AllSchedules() {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    api('/api/admin/analytics/schedules')
      .then((r) => setRows(r.schedules))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  if (!rows?.length) return null;
  const stop = async (s) => {
    if (!(await confirmAction({ title: 'Arrêter cet envoi ?', text: `« ${s.report} », de ${s.owner}. La personne verra qu’il a été arrêté par un administrateur.`, confirmText: 'Arrêter', danger: true }))) return;
    try {
      await api(`/api/admin/analytics/schedules/${s.id}/disable`, { method: 'POST', body: {} });
      toast('Envoi arrêté');
      load();
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <section className="mt-10" aria-labelledby="all-schedules">
      <h2 id="all-schedules" className="mb-1 text-lg font-bold">
        Envois programmés de tous les comptes
      </h2>
      <p className="mb-3 text-sm text-ink-mute">Visible par les administrateurs. Vous voyez qui envoie quoi et quand, jamais le contenu des rapports.</p>
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-mute">
              <th className="px-4 py-2">Rapport</th>
              <th className="px-4 py-2">Créé par</th>
              <th className="px-4 py-2">Fréquence</th>
              <th className="px-4 py-2">Destinataires</th>
              <th className="px-4 py-2">Prochain envoi</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-semibold">{s.report}</td>
                <td className="px-4 py-2">{s.owner}</td>
                <td className="px-4 py-2">{s.label}</td>
                <td className="px-4 py-2">
                  {s.users} personne{s.users > 1 ? 's' : ''}, {s.groups} groupe{s.groups > 1 ? 's' : ''}
                </td>
                <td className="px-4 py-2">{s.active ? formatDateTime(s.nextRunAt) : <span className="text-ink-mute">Arrêté{s.disabledReason ? ` : ${s.disabledReason}` : ''}</span>}</td>
                <td className="px-4 py-2 text-right">
                  {s.active && (
                    <button type="button" className="btn btn-ghost text-danger" onClick={() => stop(s)}>
                      <FiSlash aria-hidden="true" /> Arrêter
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Reports() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    api('/api/analytics/reports').then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader
        title="Analyses"
        actions={
          <Link to="/analyses/rapports/nouveau" className="btn btn-primary">
            <FiPlus aria-hidden="true" /> Nouveau rapport
          </Link>
        }
      >
        Des rapports sur les demandes, à consulter, télécharger ou recevoir par e-mail.
      </PageHeader>
      <AnalyticsTabs />
      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !data && <Spinner />}
      {data && (
        <>
          <section aria-labelledby="my-reports">
            <h2 id="my-reports" className="mb-3 text-lg font-bold">
              Mes rapports
            </h2>
            {data.mine.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.mine.map((r) => (
                  <ReportCard key={r.id} r={r} />
                ))}
              </ul>
            ) : (
              <div className="panel">
                <EmptyState
                  title="Créez votre premier rapport"
                  action={
                    <Link to="/analyses/rapports/nouveau" className="btn btn-primary">
                      <FiPlus aria-hidden="true" /> Nouveau rapport
                    </Link>
                  }
                >
                  Une liste, un regroupement, une évolution ou un indicateur, avec les filtres de votre choix. Vous pourrez le recevoir par e-mail.
                </EmptyState>
              </div>
            )}
          </section>
          {data.shared.length > 0 && (
            <section aria-labelledby="shared-reports" className="mt-8">
              <h2 id="shared-reports" className="mb-3 text-lg font-bold">
                Partagés avec moi
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.shared.map((r) => (
                  <ReportCard key={r.id} r={r} />
                ))}
              </ul>
            </section>
          )}
          {isAdmin && <AllSchedules />}
        </>
      )}
    </div>
  );
}

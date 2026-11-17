import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiGrid, FiLayout, FiPlus, FiShare2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { toast, toastError } from '../../lib/notify';
import { ErrorState, PageHeader, Spinner } from '../../components/ui';
import { useMeta } from '../../analytics/useMeta';
import { AnalyticsTabs } from '../../analytics/common';

const SHARE = { private: 'Privé', groups: 'Partagé avec des groupes', all: 'Partagé avec tout le monde' };

function DashCard({ d }) {
  return (
    <li>
      <Link to={`/analyses/tableaux/${d.id}`} className="panel flex h-full flex-col gap-1 p-4 transition-colors hover:border-accent">
        <span className="flex items-start gap-2">
          <FiGrid aria-hidden="true" className="mt-1 shrink-0 text-ink-mute" />
          <span className="font-semibold text-ink">{d.name}</span>
        </span>
        {d.description && <span className="line-clamp-2 text-sm text-ink-mute">{d.description}</span>}
        <span className="mt-auto flex flex-wrap gap-x-3 pt-2 text-xs text-ink-mute">
          <span>
            {d.widgetCount} bloc{d.widgetCount > 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1">
            <FiShare2 aria-hidden="true" /> {d.mine ? SHARE[d.visibility] : `Par ${d.owner.name}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function Dashboards() {
  const navigate = useNavigate();
  const { meta } = useMeta();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError(null);
    api('/api/analytics/dashboards').then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  const create = async (template) => {
    setBusy(true);
    try {
      const body = template ? { template } : { name: 'Nouveau tableau de bord', widgets: [] };
      const { dashboard } = await api('/api/analytics/dashboards', { method: 'POST', body });
      toast('Tableau de bord créé');
      navigate(`/analyses/tableaux/${dashboard.id}${template ? '' : '?modifier=1'}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Analyses"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => create(null)} disabled={busy}>
            <FiPlus aria-hidden="true" /> Tableau vide
          </button>
        }
      >
        Des tableaux de bord qui se mettent à jour en direct, calculés avec vos droits.
      </PageHeader>
      <AnalyticsTabs />
      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !data && <Spinner />}
      {data && (
        <>
          {data.mine.length > 0 && (
            <section aria-labelledby="my-dash" className="mb-8">
              <h2 id="my-dash" className="mb-3 text-lg font-bold">
                Mes tableaux de bord
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.mine.map((d) => (
                  <DashCard key={d.id} d={d} />
                ))}
              </ul>
            </section>
          )}
          {data.shared.length > 0 && (
            <section aria-labelledby="shared-dash" className="mb-8">
              <h2 id="shared-dash" className="mb-3 text-lg font-bold">
                Partagés avec moi
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.shared.map((d) => (
                  <DashCard key={d.id} d={d} />
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="templates">
            <h2 id="templates" className="mb-1 text-lg font-bold">
              Partir d’un modèle
            </h2>
            <p className="mb-3 text-sm text-ink-mute">Un tableau prêt à l’emploi, que vous pourrez ensuite modifier.</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {meta?.templates.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => create(t.key)}
                    className="flex h-full w-full flex-col items-start gap-1 rounded-lg border border-dashed border-line-strong p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft/40"
                  >
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      <FiLayout aria-hidden="true" /> {t.name}
                    </span>
                    <span className="text-sm text-ink-mute">{t.description}</span>
                    <span className="mt-auto pt-1 text-xs text-ink-mute">{t.widgets} blocs</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

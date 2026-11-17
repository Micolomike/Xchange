import { useCallback, useEffect, useState } from 'react';
import { FiCheck, FiTrash2 } from 'react-icons/fi';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';

const VIEWS = [
  { value: 'pending', label: 'À traiter' },
  { value: 'removed', label: 'Retirés' },
  { value: 'dismissed', label: 'Classés sans suite' },
];

/** Modération des discussions : seuls les messages signalés sont visibles, jamais le reste des conversations. */
export default function ChatReportsPanel() {
  const [view, setView] = useState('pending');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api('/api/admin/chat/reports', { query: { status: view } }));
    } catch (err) {
      setError(err);
    }
  }, [view]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const decide = async (report, action) => {
    if (action === 'remove') {
      const ok = await confirmAction({
        title: 'Retirer ce message ?',
        text: 'Il sera remplacé par « Message retiré par la modération » pour tous les participants.',
        confirmText: 'Retirer',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api(`/api/admin/chat/reports/${report.id}/${action}`, { method: 'POST' });
      toast(action === 'remove' ? 'Message retiré' : 'Signalement classé sans suite');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel p-5 text-sm text-ink-soft">
        <p>
          Les discussions sont privées : vous ne voyez ici que les messages qu’un participant vous a signalés, tels qu’ils étaient au moment du
          signalement. Retirer un message l’efface pour tout le monde ; classer sans suite le laisse en place. Les signalements traités sont
          effacés avec les journaux, selon la durée réglée dans l’onglet RGPD.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Signalements affichés">
        {VIEWS.map((v) => (
          <label
            key={v.value}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${
              view === v.value ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong text-ink-soft hover:border-accent'
            }`}
          >
            <input type="radio" name="report-view" className="sr-only" checked={view === v.value} onChange={() => setView(v.value)} />
            {v.label}
            {v.value === 'pending' && data?.pending > 0 && <span className="rounded-full bg-danger px-1.5 text-xs text-white">{data.pending}</span>}
          </label>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !data && <Spinner />}
      {data && !data.reports.length && (
        <div className="panel">
          <EmptyState title={view === 'pending' ? 'Aucun signalement à traiter' : 'Rien ici pour le moment'}>
            Quand un participant signale un message, vous êtes prévenu par e-mail si cette notification est activée.
          </EmptyState>
        </div>
      )}
      {data?.reports.length > 0 && (
        <ul className="space-y-3">
          {data.reports.map((r) => (
            <li key={r.id} className="panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <p>
                  <span className="font-semibold">{r.author.name}</span>
                  <span className="text-ink-mute"> dans {r.place}</span>
                  {r.messageAt && <span className="text-ink-mute">, le {formatDateTime(r.messageAt)}</span>}
                </p>
                <p className="text-xs text-ink-mute">
                  Signalé par {r.reporter.name} le {formatDateTime(r.createdAt)}
                </p>
              </div>
              <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-md border-l-4 border-danger bg-paper px-3 py-2">{r.body}</blockquote>
              {r.reason && (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">Motif :</span> {r.reason}
                </p>
              )}
              {r.status === 'pending' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-danger" onClick={() => decide(r, 'remove')} disabled={r.messageGone}>
                    <FiTrash2 aria-hidden="true" /> Retirer le message
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => decide(r, 'dismiss')}>
                    <FiCheck aria-hidden="true" /> Classer sans suite
                  </button>
                  {r.messageGone && <span className="self-center text-xs text-ink-mute">Le message n’existe plus (supprimé par son auteur).</span>}
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink-mute">
                  {r.status === 'removed' ? 'Retiré' : 'Classé sans suite'} par {r.handledBy || 'un administrateur'} le {formatDateTime(r.handledAt)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

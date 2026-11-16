import { useCallback, useEffect, useState } from 'react';
import { FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { formatDateTime, plural } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { StatusBadge, TicketStub } from '../../components/Badges';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';

export default function TrashPanel() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api('/api/admin/trash').then(setItems).catch(setError);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (t) => {
    try {
      await api(`/api/admin/trash/${t.id}/restore`, { method: 'POST' });
      toast('Ticket restauré');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const purge = async (t) => {
    const ok = await confirmAction({
      title: 'Supprimer définitivement ?',
      text: `« ${t.title} », ses commentaires et ses fichiers seront effacés. Cette action est irréversible.`,
      confirmText: 'Supprimer définitivement',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/trash/${t.id}`, { method: 'DELETE' });
      toast('Ticket supprimé définitivement');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const emptyTrash = async () => {
    const ok = await confirmAction({
      title: 'Vider la corbeille ?',
      text: `${plural(items.length, 'ticket sera effacé', 'tickets seront effacés')} avec leurs commentaires et fichiers. Cette action est irréversible.`,
      confirmText: 'Vider la corbeille',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('/api/admin/trash', { method: 'DELETE' });
      toast('Corbeille vidée');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <Spinner />;

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-ink-mute">
          Les tickets mis à la corbeille restent restaurables jusqu'à leur suppression définitive.
        </p>
        {items.length > 0 && (
          <button type="button" className="btn btn-danger" onClick={emptyTrash}>
            <FiTrash2 aria-hidden="true" /> Vider la corbeille
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState title="La corbeille est vide">Les tickets supprimés apparaîtront ici.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <TicketStub id={t.id} muted />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{t.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                  <StatusBadge status={t.status} />
                  Supprimé le {formatDateTime(t.deleted_at)}
                  {t.deleted_by && ` par ${t.deleted_by.name}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => restore(t)}>
                  <FiRotateCcw aria-hidden="true" /> Restaurer
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-2 hover:text-danger"
                  onClick={() => purge(t)}
                  aria-label={`Supprimer définitivement le ticket ${t.id}`}
                  title="Supprimer définitivement"
                >
                  <FiTrash2 aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

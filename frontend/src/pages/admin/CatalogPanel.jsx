import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiCopy, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { formatDate, plural } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';

/** Besoins que l'assistant n'a pas su orienter : idées de formulaires ou de réponses à ajouter. */
function AssistantMisses() {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    api('/api/admin/assistant/misses')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  if (!rows) return null;
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="misses-title">
      <h3 id="misses-title" className="font-bold">
        Besoins que l’assistant n’a pas su orienter
      </h3>
      <p className="mt-1 text-sm text-ink-mute">
        Les 90 derniers jours, sans nom. Un besoin qui revient souvent mérite peut-être un formulaire, ou de meilleurs mots dans la
        description d’un formulaire existant.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">Rien pour l’instant.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {rows.map((r) => (
            <li key={r.query} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>{r.query}</span>
              <span className="shrink-0 text-xs text-ink-mute">
                {r.count} fois, dernière le {formatDate(r.last_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CatalogPanel() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setError(null);
    return api('/api/admin/catalog').then(setItems).catch(setError);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const duplicate = async (item) => {
    try {
      const copy = await api(`/api/admin/catalog/${item.id}/duplicate`, { method: 'POST' });
      toast('Copie créée, non publiée');
      navigate(`/admin/catalogue/${copy.id}`);
    } catch (err) {
      toastError(err);
    }
  };

  const remove = async (item) => {
    const ok = await confirmAction({
      title: `Supprimer le formulaire « ${item.name} » ?`,
      text: item.ticket_count
        ? `Les ${plural(item.ticket_count, 'ticket déjà créé', 'tickets déjà créés')} gardent leurs réponses. Pour seulement le retirer du catalogue, décochez plutôt « Publié ».`
        : 'Il disparaît du catalogue. Cette action est définitive.',
      confirmText: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/catalog/${item.id}`, { method: 'DELETE' });
      toast('Formulaire supprimé');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <Spinner />;

  return (
    <div className="space-y-6">
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="max-w-xl text-sm text-ink-mute">
          Chaque formulaire (record producer) publié apparaît dans le catalogue. Une fois envoyé, il crée une demande : ses variables
          alimentent les champs associés, ses valeurs fixées complètent la demande, et toutes les réponses sont gardées.
        </p>
        <span className="flex gap-2">
          <Link to="/catalogue" className="btn btn-secondary">
            Voir le catalogue
          </Link>
          <Link to="/admin/catalogue/nouveau" className="btn btn-primary">
            <FiPlus aria-hidden="true" /> Nouveau formulaire
          </Link>
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Aucun formulaire pour l'instant"
          action={
            <Link to="/admin/catalogue/nouveau" className="btn btn-secondary">
              Créer le premier formulaire
            </Link>
          }
        >
          Par exemple : Matériel en panne, Demande d'accès, Commande de fournitures.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs font-semibold text-ink-mute">
              <tr>
                <th scope="col" className="px-5 py-2.5">Formulaire</th>
                <th scope="col" className="px-5 py-2.5">Traité par</th>
                <th scope="col" className="px-5 py-2.5">Visible par</th>
                <th scope="col" className="px-5 py-2.5 text-right">Questions</th>
                <th scope="col" className="px-5 py-2.5 text-right">Tickets</th>
                <th scope="col" className="px-5 py-2.5">État</th>
                <th scope="col" className="px-5 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="max-w-xs px-5 py-3">
                    <Link to={`/admin/catalogue/${i.id}`} className="block font-semibold hover:text-accent-strong">
                      {i.name}
                    </Link>
                    <span className="block text-xs text-ink-mute">{i.section || 'Autres demandes'}</span>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{i.fulfillment_group?.name || <span className="text-ink-mute">Administrateurs</span>}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {i.visible_groups.length ? i.visible_groups.map((g) => g.name).join(', ') : 'Tout le monde'}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{i.fields.length}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{i.ticket_count}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    {i.active ? (
                      <span className="font-semibold text-resolved">Publié</span>
                    ) : (
                      <span className="text-ink-mute">Brouillon</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <Link
                      to={`/admin/catalogue/${i.id}`}
                      className="btn btn-ghost px-2"
                      aria-label={`Modifier le formulaire ${i.name}`}
                      title="Modifier"
                    >
                      <FiEdit2 aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost px-2"
                      onClick={() => duplicate(i)}
                      aria-label={`Dupliquer le formulaire ${i.name}`}
                      title="Dupliquer"
                    >
                      <FiCopy aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 hover:text-danger"
                      onClick={() => remove(i)}
                      aria-label={`Supprimer le formulaire ${i.name}`}
                      title="Supprimer"
                    >
                      <FiTrash2 aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    <AssistantMisses />
    </div>
  );
}

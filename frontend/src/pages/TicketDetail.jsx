import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FiArrowLeft,
  FiCheckCircle,
  FiDownload,
  FiEdit2,
  FiFile,
  FiPlayCircle,
  FiRotateCcw,
  FiTrash2,
} from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { api, downloadAttachment } from '../lib/api';
import { CATEGORIES, PRIORITIES, PRIORITY_ORDER, STATUSES, STATUS_ORDER } from '../lib/constants';
import { formatDate, formatDateTime, formatRelative, formatSize, isOverdue } from '../lib/format';
import { confirmAction, toast, toastError } from '../lib/notify';
import { Avatar, PriorityBadge, StatusBadge, TicketStub } from '../components/Badges';
import FileDrop from '../components/FileDrop';
import { ErrorState, Field, Spinner } from '../components/ui';

const FIELD_NAMES = {
  title: 'le titre',
  description: 'la description',
  category: 'la catégorie',
  due_date: 'la date limite',
};

function listFr(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

function describeEvent(e) {
  const who = e.actor?.name || 'Un utilisateur supprimé';
  const status = (v) => `« ${STATUSES[v]?.label || v} »`;
  const priority = (v) => `« ${PRIORITIES[v]?.label || v} »`;
  switch (e.type) {
    case 'created':
      return `${who} a créé le ticket`;
    case 'status':
      return `${who} a passé le statut de ${status(e.from)} à ${status(e.to)}`;
    case 'priority':
      return `${who} a changé la priorité de ${priority(e.from)} à ${priority(e.to)}`;
    case 'assignee':
      if (!e.to) return `${who} a retiré ${e.from} du ticket`;
      if (!e.from) return e.actor && e.to === e.actor.name ? `${who} s'est assigné le ticket` : `${who} a assigné le ticket à ${e.to}`;
      return `${who} a réassigné le ticket de ${e.from} à ${e.to}`;
    case 'edited':
      return `${who} a modifié ${listFr((e.to || '').split(',').map((f) => FIELD_NAMES[f] || f))}`;
    case 'attachment_added':
      return `${who} a joint « ${e.to} »`;
    case 'attachment_removed':
      return `${who} a retiré « ${e.from} »`;
    case 'deleted':
      return `${who} a mis le ticket à la corbeille`;
    case 'restored':
      return `${who} a restauré le ticket`;
    default:
      return `${who} a modifié le ticket`;
  }
}

function SideItem({ label, children }) {
  return (
    <div className="py-3">
      <dt className="mb-1 text-xs font-semibold text-ink-mute">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function EditForm({ ticket, onCancel, onSave }) {
  const [form, setForm] = useState({
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    due_date: ticket.due_date || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const update = (name, value) => setForm((f) => ({ ...f, [name]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-5" noValidate>
      <Field id="edit-title" label="Titre" required error={errors.title}>
        {(p) => <input {...p} className="field" value={form.title} maxLength={200} onChange={(e) => update('title', e.target.value)} />}
      </Field>
      <Field id="edit-description" label="Description" required error={errors.description}>
        {(p) => (
          <textarea
            {...p}
            className="field min-h-48 resize-y"
            value={form.description}
            maxLength={10000}
            onChange={(e) => update('description', e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="edit-category" label="Catégorie" error={errors.category}>
          {(p) => (
            <select {...p} className="field" value={form.category} onChange={(e) => update('category', e.target.value)}>
              <option value="">Aucune</option>
              {Object.entries(CATEGORIES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="edit-due" label="Date limite" error={errors.due_date}>
          {(p) => <input {...p} type="date" className="field" value={form.due_date} onChange={(e) => update('due_date', e.target.value)} />}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api(`/api/tickets/${id}`)
      .then(setTicket)
      .catch(setError);
  }, [id]);

  useEffect(() => {
    setTicket(null);
    load();
  }, [load]);

  useEffect(() => {
    if (isAdmin) api('/api/users').then(setUsers).catch(() => {});
  }, [isAdmin]);

  if (error) {
    return (
      <div className="py-8">
        <ErrorState error={error} onRetry={error.status === 404 ? undefined : load} />
        <p className="mt-6 text-center">
          <Link to="/tickets" className="font-semibold text-accent hover:underline">
            Revenir aux tickets
          </Link>
        </p>
      </div>
    );
  }
  if (!ticket) return <Spinner />;

  const perms = ticket.permissions;
  const overdue = isOverdue(ticket);
  const isActive = ['open', 'in_progress'].includes(ticket.status);

  const patch = async (body, message) => {
    setBusy(true);
    try {
      const updated = await api(`/api/tickets/${ticket.id}`, { method: 'PATCH', body });
      setTicket(updated);
      if (message) toast(message);
      return updated;
    } catch (err) {
      toastError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  const safePatch = (body, message) => patch(body, message).catch(() => {});

  const takeOver = () =>
    safePatch(
      { status: 'in_progress', ...(isAdmin && !ticket.assignee ? { assigned_to: user.id } : {}) },
      'Ticket pris en charge'
    );

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await api(`/api/tickets/${ticket.id}/comments`, { method: 'POST', body: { body: comment } });
      setComment('');
      await load();
    } catch (err) {
      toastError(err);
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = async (c) => {
    if (!(await confirmAction({ title: 'Supprimer ce commentaire ?', confirmText: 'Supprimer', danger: true }))) return;
    try {
      await api(`/api/tickets/${ticket.id}/comments/${c.id}`, { method: 'DELETE' });
      await load();
      toast('Commentaire supprimé');
    } catch (err) {
      toastError(err);
    }
  };

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    try {
      await api(`/api/tickets/${ticket.id}/attachments`, { method: 'POST', body: fd });
      setFiles([]);
      await load();
      toast(files.length > 1 ? 'Fichiers joints' : 'Fichier joint');
    } catch (err) {
      toastError(err);
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (a) => {
    if (!(await confirmAction({ title: `Retirer « ${a.name} » ?`, text: 'Le fichier sera supprimé du serveur.', confirmText: 'Retirer', danger: true }))) return;
    try {
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' });
      await load();
      toast('Fichier retiré');
    } catch (err) {
      toastError(err);
    }
  };

  const download = async (a) => {
    try {
      await downloadAttachment(a);
    } catch (err) {
      toastError(err);
    }
  };

  const trash = async () => {
    const ok = await confirmAction({
      title: 'Mettre ce ticket à la corbeille ?',
      text: "Il disparaît des listes ; un administrateur peut le restaurer depuis l'administration.",
      confirmText: 'Mettre à la corbeille',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      toast('Ticket mis à la corbeille');
      navigate('/tickets');
    } catch (err) {
      toastError(err);
    }
  };

  // Fil d'activité : commentaires et changements, dans l'ordre chronologique.
  const timeline = [
    ...ticket.events.map((e) => ({ kind: 'event', at: e.created_at, key: `e${e.id}`, data: e })),
    ...ticket.comments.map((c) => ({ kind: 'comment', at: c.created_at, key: `c${c.id}`, data: c })),
  ].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.kind === b.kind) return 0; // tri stable : l'ordre du serveur est conservé
    return a.kind === 'event' ? -1 : 1;
  });

  return (
    <div>
      <Link to="/tickets" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink">
        <FiArrowLeft aria-hidden="true" /> Tous les tickets
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <TicketStub id={ticket.id} size="lg" muted={!isActive} />
          <StatusBadge status={ticket.status} />
          {overdue && <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">En retard</span>}
        </div>
        <h1 className="mt-4 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{ticket.title}</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Ouvert par <span className="font-semibold text-ink-soft">{ticket.creator?.name || 'un utilisateur supprimé'}</span>{' '}
          le {formatDateTime(ticket.created_at)}
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <section className="panel" aria-labelledby="desc-title">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 id="desc-title" className="font-bold">
                Description
              </h2>
              {perms.canEdit && !editing && (
                <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => setEditing(true)}>
                  <FiEdit2 aria-hidden="true" /> Modifier
                </button>
              )}
            </div>
            {editing ? (
              <EditForm
                ticket={ticket}
                onCancel={() => setEditing(false)}
                onSave={async (form) => {
                  await patch(form, 'Ticket modifié');
                  setEditing(false);
                }}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words px-5 py-4 leading-relaxed text-ink-soft">{ticket.description}</p>
            )}
          </section>

          <section className="panel" aria-labelledby="files-title">
            <h2 id="files-title" className="border-b border-line px-5 py-3 font-bold">
              Pièces jointes {ticket.attachments.length > 0 && <span className="text-ink-mute">({ticket.attachments.length})</span>}
            </h2>
            {ticket.attachments.length > 0 && (
              <ul className="divide-y divide-line">
                {ticket.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                    <FiFile className="shrink-0 text-ink-mute" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-sm font-semibold text-accent hover:underline"
                        onClick={() => download(a)}
                      >
                        {a.name}
                      </button>
                      <p className="text-xs text-ink-mute">
                        {formatSize(a.size)}, ajouté par {a.uploaded_by?.name || 'un utilisateur supprimé'} {formatRelative(a.created_at)}
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost px-2" onClick={() => download(a)} aria-label={`Télécharger ${a.name}`}>
                      <FiDownload aria-hidden="true" />
                    </button>
                    {a.canDelete && (
                      <button
                        type="button"
                        className="btn btn-ghost px-2 hover:text-danger"
                        onClick={() => removeAttachment(a)}
                        aria-label={`Retirer ${a.name}`}
                      >
                        <FiTrash2 aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-3 border-t border-line px-5 py-4 first:border-t-0">
              <FileDrop files={files} onChange={setFiles} compact />
              {files.length > 0 && (
                <div className="flex justify-end">
                  <button type="button" className="btn btn-primary" onClick={upload} disabled={uploading}>
                    {uploading ? 'Envoi…' : `Joindre ${files.length > 1 ? `les ${files.length} fichiers` : 'le fichier'}`}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="activity-title">
            <h2 id="activity-title" className="border-b border-line px-5 py-3 font-bold">
              Activité
            </h2>
            <ol className="px-5 py-4">
              {timeline.map((item) =>
                item.kind === 'event' ? (
                  <li key={item.key} className="relative flex gap-3 pb-4 pl-1 text-sm before:absolute before:left-[0.53rem] before:top-4 before:h-full before:w-px before:bg-line last:before:hidden">
                    <span className="relative mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-white bg-line-strong ring-1 ring-line-strong" />
                    <p className="text-ink-soft">
                      {describeEvent(item.data)}
                      <time dateTime={item.at} className="ml-2 text-xs text-ink-mute" title={formatDateTime(item.at)}>
                        {formatRelative(item.at)}
                      </time>
                    </p>
                  </li>
                ) : (
                  <li key={item.key} className="relative pb-4 pl-7 before:absolute before:left-[0.53rem] before:top-0 before:h-full before:w-px before:bg-line last:before:hidden">
                    <div className="rounded-lg border border-line bg-paper/60">
                      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                        <Avatar user={item.data.author || { name: '?', username: '?' }} />
                        <span className="font-semibold">{item.data.author?.name || 'Utilisateur supprimé'}</span>
                        <time dateTime={item.at} className="text-xs text-ink-mute" title={formatDateTime(item.at)}>
                          {formatRelative(item.at)}
                        </time>
                        {item.data.canDelete && (
                          <button
                            type="button"
                            className="ml-auto rounded p-1 text-ink-mute hover:bg-white hover:text-danger"
                            onClick={() => deleteComment(item.data)}
                            aria-label="Supprimer le commentaire"
                          >
                            <FiTrash2 aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-relaxed">{item.data.body}</p>
                    </div>
                  </li>
                )
              )}
            </ol>
            <form onSubmit={postComment} className="border-t border-line px-5 py-4">
              <label htmlFor="comment" className="label">
                Ajouter un commentaire
              </label>
              <textarea
                id="comment"
                className="field min-h-24 resize-y"
                value={comment}
                maxLength={5000}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(e);
                }}
                placeholder="Une précision, une question, la solution trouvée…"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="hidden text-xs text-ink-mute sm:inline">Ctrl + Entrée pour envoyer</span>
                <button type="submit" className="btn btn-primary ml-auto" disabled={posting || !comment.trim()}>
                  {posting ? 'Envoi…' : 'Commenter'}
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {perms.canChangeStatus && (
            <div className="panel space-y-2 p-4">
              {ticket.status === 'open' && (
                <button type="button" className="btn btn-primary w-full" onClick={takeOver} disabled={busy}>
                  <FiPlayCircle aria-hidden="true" /> Prendre en charge
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  className={`btn w-full ${ticket.status === 'open' ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => safePatch({ status: 'resolved' }, 'Ticket résolu')}
                  disabled={busy}
                >
                  <FiCheckCircle aria-hidden="true" /> Marquer comme résolu
                </button>
              )}
              {ticket.status === 'resolved' && (
                <button type="button" className="btn btn-secondary w-full" onClick={() => safePatch({ status: 'closed' }, 'Ticket fermé')} disabled={busy}>
                  Fermer le ticket
                </button>
              )}
              {!isActive && (
                <button type="button" className="btn btn-secondary w-full" onClick={() => safePatch({ status: 'open' }, 'Ticket rouvert')} disabled={busy}>
                  <FiRotateCcw aria-hidden="true" /> Rouvrir
                </button>
              )}
            </div>
          )}

          <dl className="panel divide-y divide-line px-4">
            <SideItem label="Statut">
              {perms.canChangeStatus ? (
                <select
                  className="field py-1.5"
                  aria-label="Statut"
                  value={ticket.status}
                  disabled={busy}
                  onChange={(e) => safePatch({ status: e.target.value }, 'Statut mis à jour')}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUSES[s].label}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge status={ticket.status} />
              )}
            </SideItem>
            <SideItem label="Responsable">
              {perms.canAssign ? (
                <>
                  <select
                    className="field py-1.5"
                    aria-label="Responsable"
                    value={ticket.assignee?.id || ''}
                    disabled={busy}
                    onChange={(e) =>
                      safePatch({ assigned_to: e.target.value ? Number(e.target.value) : null }, 'Responsable mis à jour')
                    }
                  >
                    <option value="">Personne</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  {ticket.assignee?.id !== user.id && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs font-semibold text-accent hover:underline"
                      onClick={() => safePatch({ assigned_to: user.id }, 'Ticket assigné à vous')}
                    >
                      M'assigner ce ticket
                    </button>
                  )}
                </>
              ) : ticket.assignee ? (
                <span className="inline-flex items-center gap-2">
                  <Avatar user={ticket.assignee} /> {ticket.assignee.name}
                </span>
              ) : (
                <span className="text-ink-mute">Personne pour l'instant</span>
              )}
            </SideItem>
            <SideItem label="Priorité">
              {perms.canEdit ? (
                <select
                  className="field py-1.5"
                  aria-label="Priorité"
                  value={ticket.priority}
                  disabled={busy}
                  onChange={(e) => safePatch({ priority: e.target.value }, 'Priorité mise à jour')}
                >
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITIES[p].label}
                    </option>
                  ))}
                </select>
              ) : (
                <PriorityBadge priority={ticket.priority} />
              )}
            </SideItem>
            <SideItem label="Catégorie">{CATEGORIES[ticket.category] || <span className="text-ink-mute">Aucune</span>}</SideItem>
            <SideItem label="Date limite">
              {ticket.due_date ? (
                <span className={overdue ? 'font-semibold text-danger' : ''}>{formatDate(ticket.due_date)}</span>
              ) : (
                <span className="text-ink-mute">Aucune</span>
              )}
            </SideItem>
            <SideItem label="Dernière activité">{formatDateTime(ticket.updated_at)}</SideItem>
            {ticket.resolved_at && <SideItem label="Résolu le">{formatDateTime(ticket.resolved_at)}</SideItem>}
          </dl>

          {perms.canDelete && (
            <button type="button" className="btn btn-ghost w-full text-danger hover:bg-danger-soft hover:text-danger" onClick={trash}>
              <FiTrash2 aria-hidden="true" /> Mettre à la corbeille
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

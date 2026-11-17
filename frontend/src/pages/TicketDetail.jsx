import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FiArrowLeft,
  FiCheckCircle,
  FiDownload,
  FiEdit2,
  FiFile,
  FiImage,
  FiLock,
  FiPlayCircle,
  FiRotateCcw,
  FiTrash2,
} from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { api, downloadAttachment } from '../lib/api';
import { MAX_FILES, MAX_UPLOAD_MB, ACTIVE_CATEGORY_KEYS, CATEGORIES, PRIORITIES, PRIORITY_ORDER, STATUSES, STATUS_ORDER } from '../lib/constants';
import { formatDate, formatDateTime, formatRelative, formatSize, isOverdue } from '../lib/format';
import { SlaDetail } from '../components/Sla';
import { confirmAction, toast, toastError } from '../lib/notify';
import { Avatar, PriorityBadge, StatusBadge, TicketStub } from '../components/Badges';
import FileDrop from '../components/FileDrop';
import TicketFieldsPanel from '../components/TicketFieldsPanel';
import { ImageThumb, ImageViewer } from '../components/AttachmentImage';
import { forgetImage, isImageAttachment } from '../lib/images';
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
      return e.to ? `${who} a créé le ticket avec le formulaire « ${e.to} »` : `${who} a créé le ticket`;
    case 'status':
      return `${who} a passé le statut de ${status(e.from)} à ${status(e.to)}`;
    case 'priority':
      return `${who} a changé la priorité de ${priority(e.from)} à ${priority(e.to)}`;
    case 'assignee':
      if (!e.to) return `${who} a retiré ${e.from} du ticket`;
      if (!e.from) return e.actor && e.to === e.actor.name ? `${who} s'est assigné le ticket` : `${who} a assigné le ticket à ${e.to}`;
      return `${who} a réassigné le ticket de ${e.from} à ${e.to}`;
    case 'group':
      if (!e.to) return `${who} a retiré le ticket du groupe ${e.from}`;
      if (!e.from) return `${who} a affecté le ticket au groupe ${e.to}`;
      return `${who} a transféré le ticket du groupe ${e.from} au groupe ${e.to}`;
    case 'confidential':
      return e.to === 'oui' ? `${who} a rendu la demande confidentielle` : `${who} a retiré la confidentialité`;
    case 'edited':
      return `${who} a modifié ${listFr((e.to || '').split(',').map((f) => FIELD_NAMES[f] || f))}`;
    case 'attachment_added':
      return `${who} a joint « ${e.to} »`;
    case 'attachment_removed':
      return `${who} a retiré « ${e.from} »`;
    case 'field': {
      let c = {};
      try {
        c = JSON.parse(e.to || '{}');
      } catch {
        /* ancien format */
      }
      if (c.to == null) return `${who} a vidé « ${c.label} »`;
      return c.from == null ? `${who} a renseigné « ${c.label} » : ${c.to}` : `${who} a changé « ${c.label} » de ${c.from} à ${c.to}`;
    }
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
              {Object.entries(CATEGORIES)
                .filter(([k]) => ACTIVE_CATEGORY_KEYS.includes(k) || k === ticket.category)
                .map(([k, label]) => (
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
  const [groups, setGroups] = useState([]);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sendingImages, setSendingImages] = useState(0);
  const [viewing, setViewing] = useState(null);
  const [dropOnComment, setDropOnComment] = useState(false);
  const imageInput = useRef(null);
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
    api('/api/groups').then(setGroups).catch(() => {});
  }, [isAdmin]);

  if (error) {
    return (
      <div className="py-8">
        <ErrorState error={error} onRetry={error.status === 404 ? undefined : load} />
        <p className="mt-6 text-center">
          <Link to="/tickets" className="font-semibold text-accent-strong hover:underline">
            Revenir aux tickets
          </Link>
        </p>
      </div>
    );
  }
  if (!ticket) return <Spinner />;

  const perms = ticket.permissions;
  const overdue = isOverdue(ticket);
  // Responsables possibles : les membres du groupe d'affectation, sinon (admin) tous les comptes.
  const ticketGroup = ticket.group ? groups.find((g) => g.id === ticket.group.id) : null;
  const candidates = ticket.group ? ticketGroup?.members || [] : users;
  const canTakeIt = perms.canAssign && (!ticket.group || candidates.some((m) => m.id === user.id));
  const isActive = ['open', 'in_progress'].includes(ticket.status);

  const patch = async (body, message) => {
    setBusy(true);
    try {
      const updated = await api(`/api/tickets/${ticket.id}`, { method: 'PATCH', body });
      if (updated.noLongerVisible) {
        toast(`Ticket transféré au groupe ${updated.group?.name || ''}`.trim());
        navigate('/tickets', { replace: true });
        return updated;
      }
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
      { status: 'in_progress', ...(canTakeIt && !ticket.assignee ? { assigned_to: user.id } : {}) },
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

  const sendFiles = async (list) => {
    const fd = new FormData();
    list.forEach((f) => fd.append('files', f, f.name));
    await api(`/api/tickets/${ticket.id}/attachments`, { method: 'POST', body: fd });
    await load();
  };

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    try {
      await sendFiles(files);
      setFiles([]);
      toast(files.length > 1 ? 'Fichiers joints' : 'Fichier joint');
    } catch (err) {
      toastError(err);
    } finally {
      setUploading(false);
    }
  };

  // Images envoyées depuis la zone de message (bouton, coller ou glisser) : elles partent tout de suite
  // et apparaissent dans l'activité.
  const sendImages = async (list) => {
    const all = Array.from(list || []);
    const images = all.filter((f) => isImageAttachment(f));
    const tooBig = images.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    const ok = images.filter((f) => f.size <= MAX_UPLOAD_MB * 1024 * 1024).slice(0, MAX_FILES);
    if (all.length > images.length) toastError(new Error('Seules les images (PNG, JPEG, GIF, WebP, AVIF, BMP) vont ici ; les autres fichiers se joignent dans « Pièces jointes ».'));
    if (tooBig.length) toastError(new Error(`${tooBig.map((f) => f.name).join(', ')} : plus de ${MAX_UPLOAD_MB} Mo.`));
    if (images.length - tooBig.length > MAX_FILES) toastError(new Error(`${MAX_FILES} images au plus par envoi.`));
    if (!ok.length) return;
    // Une image collée s'appelle souvent « image.png » : on lui donne un nom daté.
    const stamp = new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-').replace(/\s+/g, '_');
    const named = ok.map((f, i) =>
      /^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? new File([f], `capture_${stamp}${ok.length > 1 ? `_${i + 1}` : ''}.${f.name.split('.').pop()}`, { type: f.type }) : f
    );
    setSendingImages(named.length);
    try {
      await sendFiles(named);
    } catch (err) {
      toastError(err);
    } finally {
      setSendingImages(0);
    }
  };

  const removeAttachment = async (a) => {
    if (!(await confirmAction({ title: `Retirer « ${a.name} » ?`, text: 'Le fichier sera supprimé du serveur.', confirmText: 'Retirer', danger: true }))) return;
    try {
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' });
      forgetImage(a.id);
      if (viewing?.id === a.id) setViewing(null);
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

  // Images jointes : affichées dans l'activité, regroupées par envoi (même personne, même instant).
  const imageGroups = new Map();
  for (const a of ticket.attachments) {
    if (!isImageAttachment(a)) continue;
    const key = `${a.created_at}|${a.uploaded_by?.id ?? ''}`;
    if (!imageGroups.has(key)) imageGroups.set(key, { at: a.created_at, by: a.uploaded_by, images: [] });
    imageGroups.get(key).images.push(a);
  }
  // L'événement « a joint … » d'une image affichée ferait doublon.
  const shownImages = new Set(ticket.attachments.filter(isImageAttachment).map((a) => `${a.created_at}|${a.name}`));

  // Fil d'activité : commentaires, images et changements, dans l'ordre chronologique.
  const timeline = [
    ...ticket.events
      .filter((e) => !(e.type === 'attachment_added' && shownImages.has(`${e.created_at}|${e.to}`)))
      .map((e) => ({ kind: 'event', at: e.created_at, key: `e${e.id}`, data: e })),
    ...ticket.comments.map((c) => ({ kind: 'comment', at: c.created_at, key: `c${c.id}`, data: c })),
    ...[...imageGroups.values()].map((g) => ({ kind: 'images', at: g.at, key: `i${g.images[0].id}`, data: g })),
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
          {ticket.confidential && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-surface">
              <FiLock aria-hidden="true" /> Confidentielle
            </span>
          )}
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
                {ticket.answers?.length && !editing ? 'Demande' : 'Description'}
                {ticket.form && !editing && (
                  <span className="ml-2 text-sm font-normal text-ink-mute">
                    formulaire « {ticket.form.name || 'supprimé'} »
                  </span>
                )}
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
            ) : ticket.answers?.length ? (
              <dl className="divide-y divide-line">
                {ticket.answers.map((a) => (
                  <div key={a.key} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-sm font-semibold text-ink-mute">{a.label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-ink">
                      {a.type === 'date' ? formatDate(a.value) : a.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="whitespace-pre-wrap break-words px-5 py-4 leading-relaxed text-ink-soft">{ticket.description}</p>
            )}
          </section>

          <TicketFieldsPanel ticket={ticket} onSaved={setTicket} />

          <section className="panel" aria-labelledby="files-title">
            <h2 id="files-title" className="border-b border-line px-5 py-3 font-bold">
              Pièces jointes {ticket.attachments.length > 0 && <span className="text-ink-mute">({ticket.attachments.length})</span>}
            </h2>
            {ticket.attachments.length > 0 && (
              <ul className="divide-y divide-line">
                {ticket.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                    {isImageAttachment(a) ? (
                      <ImageThumb attachment={a} onOpen={setViewing} className="size-10 shrink-0" />
                    ) : (
                      <FiFile className="shrink-0 text-ink-mute" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-sm font-semibold text-accent-strong hover:underline"
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
                    <span className="relative mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-surface bg-line-strong ring-1 ring-line-strong" />
                    <p className="text-ink-soft">
                      {describeEvent(item.data)}
                      {item.data.on_behalf_by && (
                        <span className="text-ink-mute"> (fait par {item.data.on_behalf_by})</span>
                      )}
                      <time dateTime={item.at} className="ml-2 text-xs text-ink-mute" title={formatDateTime(item.at)}>
                        {formatRelative(item.at)}
                      </time>
                    </p>
                  </li>
                ) : item.kind === 'images' ? (
                  <li key={item.key} className="relative pb-4 pl-7 before:absolute before:left-[0.53rem] before:top-0 before:h-full before:w-px before:bg-line last:before:hidden">
                    <div className="rounded-lg border border-line bg-paper/60">
                      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                        <Avatar user={item.data.by || { name: '?', username: '?' }} />
                        <span className="font-semibold">{item.data.by?.name || 'Utilisateur supprimé'}</span>
                        <span className="text-ink-mute">
                          {item.data.images.length > 1 ? `a joint ${item.data.images.length} images` : 'a joint une image'}
                        </span>
                        <time dateTime={item.at} className="text-xs text-ink-mute" title={formatDateTime(item.at)}>
                          {formatRelative(item.at)}
                        </time>
                      </div>
                      <div className={`grid gap-2 p-3 ${item.data.images.length > 1 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
                        {item.data.images.map((a) => (
                          <figure key={a.id} className="min-w-0">
                            <ImageThumb
                              attachment={a}
                              onOpen={setViewing}
                              natural={item.data.images.length === 1}
                              className={item.data.images.length > 1 ? 'aspect-square w-full' : 'w-fit max-w-full'}
                            />
                            <figcaption className="mt-1 truncate text-xs text-ink-mute" title={a.name}>
                              {a.name}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    </div>
                  </li>
                ) : (
                  <li key={item.key} className="relative pb-4 pl-7 before:absolute before:left-[0.53rem] before:top-0 before:h-full before:w-px before:bg-line last:before:hidden">
                    <div className="rounded-lg border border-line bg-paper/60">
                      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                        <Avatar user={item.data.author || { name: '?', username: '?' }} />
                        <span className="font-semibold">{item.data.author?.name || 'Utilisateur supprimé'}</span>
                        {item.data.on_behalf_by && (
                          <span className="text-xs text-ink-mute">écrit par {item.data.on_behalf_by}</span>
                        )}
                        <time dateTime={item.at} className="text-xs text-ink-mute" title={formatDateTime(item.at)}>
                          {formatRelative(item.at)}
                        </time>
                        {item.data.canDelete && (
                          <button
                            type="button"
                            className="ml-auto rounded p-1 text-ink-mute hover:bg-surface hover:text-danger"
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
                className={`field min-h-24 resize-y ${dropOnComment ? 'border-accent bg-accent-soft' : ''}`}
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData?.files || []);
                  if (pasted.length) {
                    e.preventDefault();
                    sendImages(pasted);
                  }
                }}
                onDragOver={(e) => {
                  if (Array.from(e.dataTransfer.types).includes('Files')) {
                    e.preventDefault();
                    setDropOnComment(true);
                  }
                }}
                onDragLeave={() => setDropOnComment(false)}
                onDrop={(e) => {
                  if (e.dataTransfer.files.length) {
                    e.preventDefault();
                    setDropOnComment(false);
                    sendImages(e.dataTransfer.files);
                  }
                }}
                value={comment}
                maxLength={5000}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(e);
                }}
                placeholder="Votre message. Restez courtois, sans vulgarité, et n’indiquez pas d’informations sensibles (santé, numéros de compte, mots de passe)."
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    sendImages(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => imageInput.current?.click()} disabled={sendingImages > 0}>
                  <FiImage aria-hidden="true" />
                  {sendingImages ? `Envoi de ${sendingImages > 1 ? `${sendingImages} images` : "l'image"}…` : 'Image'}
                </button>
                <span className="hidden text-xs text-ink-mute md:inline">Coller ou glisser une image l'envoie aussi ; Ctrl + Entrée pour commenter</span>
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
            <SideItem label="Groupe d'affectation">
              {perms.canChangeGroup ? (
                <select
                  className="field py-1.5"
                  aria-label="Groupe d'affectation"
                  value={ticket.group?.id || ''}
                  disabled={busy}
                  onChange={(e) =>
                    safePatch({ assigned_group: e.target.value ? Number(e.target.value) : null }, "Groupe d'affectation mis à jour")
                  }
                >
                  <option value="">Aucun groupe</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : ticket.group ? (
                ticket.group.name
              ) : (
                <span className="text-ink-mute">Aucun groupe</span>
              )}
            </SideItem>
            <SideItem label="Responsable">
              {perms.canAssign && (ticket.group || isAdmin) ? (
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
                    {ticket.assignee && !candidates.some((u) => u.id === ticket.assignee.id) && (
                      <option value={ticket.assignee.id}>{ticket.assignee.name}</option>
                    )}
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  {ticket.group && candidates.length === 0 && (
                    <p className="mt-1.5 text-xs text-ink-mute">Ce groupe n'a pas encore de membre.</p>
                  )}
                  {canTakeIt && ticket.assignee?.id !== user.id && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs font-semibold text-accent-strong hover:underline"
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
            <SideItem label="Catégorie">{CATEGORIES[ticket.category] || ticket.category || <span className="text-ink-mute">Aucune</span>}</SideItem>
            <SideItem label="Date limite">
              {ticket.due_date ? (
                <span className={overdue ? 'font-semibold text-danger' : ''}>{formatDate(ticket.due_date)}</span>
              ) : (
                <span className="text-ink-mute">Aucune</span>
              )}
            </SideItem>
            <SideItem label="Délais (SLA)">
              <SlaDetail sla={ticket.sla} />
            </SideItem>
            {perms.canSetConfidential && (
              <SideItem label="Confidentialité">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={ticket.confidential}
                    disabled={busy}
                    onChange={(e) =>
                      safePatch(
                        { confidential: e.target.checked },
                        e.target.checked ? 'Demande rendue confidentielle' : 'Confidentialité retirée'
                      )
                    }
                  />
                  <span>Demande confidentielle</span>
                </label>
              </SideItem>
            )}
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
      <ImageViewer attachment={viewing} onClose={() => setViewing(null)} onDownload={download} />
    </div>
  );
}

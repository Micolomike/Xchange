import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft, FiEdit2, FiFlag, FiHash, FiLogOut, FiMessageCircle, FiPlus, FiSend, FiTrash2, FiUserPlus, FiUsers, FiX } from 'react-icons/fi';
import { ErrorState, Field, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { confirmAction, toast, toastError } from '../lib/notify';
import { useAuth } from '../auth/context';
import { useChat } from '../chat/context';

const MAX_MESSAGE = 2000;
const KIND_ICONS = { general: FiHash, group: FiHash, direct: FiMessageCircle, custom: FiUsers };

const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
const shortWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

function preview(c) {
  const m = c.lastMessage;
  if (!m) return c.kind === 'general' ? 'Ouvert à toutes et à tous' : c.kind === 'group' ? 'Salon des membres du groupe' : 'Aucun message pour le moment';
  if (m.deleted) return 'Message supprimé';
  const who = m.mine ? 'Vous' : c.kind === 'direct' ? '' : m.author?.name || 'Compte supprimé';
  return `${who ? `${who} : ` : ''}${m.body}`;
}

/** Fenêtre modale native (Échap et fond grisé gérés par le navigateur). */
function Modal({ open, onClose, title, children, footer, labelId }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={labelId}
      className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id={labelId} className="font-bold">
              {title}
            </h2>
            <button type="button" className="btn btn-ghost px-2" onClick={onClose} aria-label="Fermer">
              <FiX aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4 text-sm">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Recherche de personnes (pseudonyme, ou prénom et nom quand la personne les montre). */
function PeoplePicker({ exclude = [], onPick, label = 'Rechercher une personne' }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setPeople((await api('/api/chat/people', { query: { q } })).people);
      } catch {
        setPeople([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const shown = people.filter((p) => !exclude.includes(p.id));
  return (
    <div>
      <Field id="chat-people" label={label}>
        {(p) => <input {...p} type="search" className="field" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pseudonyme ou nom" />}
      </Field>
      <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line" aria-label="Résultats">
        {shown.length === 0 && <li className="px-3 py-2 text-ink-mute">Personne ne correspond.</li>}
        {shown.map((p) => (
          <li key={p.id} className="border-b border-line last:border-0">
            <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-paper" onClick={() => onPick(p)}>
              <span>
                <span className="font-semibold">{p.name}</span>
                {p.name !== p.username && <span className="ml-2 text-ink-mute">{p.username}</span>}
              </span>
              <FiPlus aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewConversationDialog({ open, onClose, onCreated }) {
  const [mode, setMode] = useState('direct');
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('direct');
      setPicked([]);
      setName('');
    }
  }, [open]);

  const startDirect = async (person) => {
    setBusy(true);
    try {
      const { conversation } = await api('/api/chat/direct', { method: 'POST', body: { userId: person.id } });
      onCreated(conversation);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { conversation } = await api('/api/chat/conversations', { method: 'POST', body: { name, members: picked.map((p) => p.id) } });
      onCreated(conversation);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle conversation" labelId="new-conv-title">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Type de conversation</legend>
        {[
          ['direct', 'Message privé', 'Avec une seule personne'],
          ['custom', 'Conversation de groupe', 'Avec plusieurs personnes, sous un nom'],
        ].map(([value, label, hint]) => (
          <label key={value} className={`flex flex-1 cursor-pointer items-start gap-2 rounded-md border p-3 ${mode === value ? 'border-accent bg-accent-soft' : 'border-line'}`}>
            <input type="radio" name="conv-mode" className="mt-1" checked={mode === value} onChange={() => setMode(value)} />
            <span>
              <span className="font-semibold">{label}</span>
              <span className="block text-ink-mute">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === 'direct' ? (
        <PeoplePicker label="À qui écrire ?" onPick={(p) => !busy && startDirect(p)} />
      ) : (
        <form onSubmit={createGroup} className="space-y-4">
          <Field id="conv-name" label="Nom de la conversation" required>
            {(p) => <input {...p} className="field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Par exemple : Fête des voisins" />}
          </Field>
          <div>
            <p className="label">Participants ({picked.length})</p>
            <ul className="flex flex-wrap gap-2">
              {picked.map((p) => (
                <li key={p.id} className="inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1">
                  {p.name}
                  <button type="button" className="text-ink-mute hover:text-ink" aria-label={`Retirer ${p.name}`} onClick={() => setPicked((l) => l.filter((x) => x.id !== p.id))}>
                    <FiX aria-hidden="true" />
                  </button>
                </li>
              ))}
              {!picked.length && <li className="text-ink-mute">Ajoutez au moins une personne.</li>}
            </ul>
          </div>
          <PeoplePicker label="Ajouter des participants" exclude={picked.map((p) => p.id)} onPick={(p) => setPicked((l) => [...l, p])} />
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !picked.length}>
              <FiUsers aria-hidden="true" /> Créer la conversation
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ManageDialog({ open, onClose, conversation, onChanged, onLeave }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName(conversation?.title || '');
  }, [open, conversation]);
  if (!conversation?.members) return null;

  const rename = async (e) => {
    e.preventDefault();
    try {
      onChanged((await api(`/api/chat/conversations/${conversation.id}`, { method: 'PUT', body: { name } })).conversation);
      toast('Conversation renommée');
    } catch (err) {
      toastError(err);
    }
  };
  const add = async (person) => {
    try {
      onChanged((await api(`/api/chat/conversations/${conversation.id}/members`, { method: 'POST', body: { members: [person.id] } })).conversation);
      toast(`${person.name} ajouté(e)`);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Gérer la conversation" labelId="manage-conv-title">
      <form onSubmit={rename} className="flex items-end gap-2">
        <div className="flex-1">
          <Field id="conv-rename" label="Nom">
            {(p) => <input {...p} className="field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>
        <button type="submit" className="btn btn-secondary" disabled={!name.trim() || name.trim() === conversation.title}>
          Renommer
        </button>
      </form>
      <div>
        <p className="label">Participants ({conversation.members.length})</p>
        <p className="text-ink-soft">{conversation.members.map((m) => m.name).join(', ')}</p>
      </div>
      <PeoplePicker label="Ajouter quelqu'un" exclude={conversation.members.map((m) => m.id)} onPick={add} />
      <div className="border-t border-line pt-4">
        <button type="button" className="btn btn-danger" onClick={onLeave}>
          <FiLogOut aria-hidden="true" /> Quitter la conversation
        </button>
      </div>
    </Modal>
  );
}

function ReportDialog({ message, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [message]);
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/chat/messages/${message.id}/report`, { method: 'POST', body: { reason } });
      toast('Message signalé aux administrateurs');
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(message)}
      onClose={onClose}
      title="Signaler ce message"
      labelId="report-title"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={busy}>
            <FiFlag aria-hidden="true" /> Signaler
          </button>
        </>
      }
    >
      {message && (
        <>
          <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-4 border-line bg-paper px-3 py-2">{message.body}</blockquote>
          <p className="text-ink-soft">
            Les administrateurs verront ce message seul, avec son auteur et votre motif. Le reste de la conversation reste privé. L'auteur ne sait pas
            qui l'a signalé.
          </p>
          <Field id="report-reason" label="Motif (facultatif)">
            {(p) => <textarea {...p} className="field" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Insulte, harcèlement, données sensibles…" />}
          </Field>
        </>
      )}
    </Modal>
  );
}

function ConversationList({ conversations, selectedId }) {
  return (
    <ul className="divide-y divide-line">
      {conversations.map((c) => {
        const Icon = KIND_ICONS[c.kind] || FiMessageCircle;
        const active = c.id === selectedId;
        const unread = active ? 0 : c.unread;
        return (
          <li key={c.id}>
            <Link
              to={`/discussions/${c.id}`}
              aria-current={active ? 'page' : undefined}
              className={`flex items-start gap-3 px-4 py-3 ${active ? 'bg-accent-soft' : 'hover:bg-paper'}`}
            >
              <Icon className="mt-1 shrink-0 text-ink-mute" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${unread ? 'font-bold text-ink' : 'font-semibold text-ink-soft'}`}>{c.title}</span>
                  <span className="shrink-0 text-xs text-ink-mute">{shortWhen(c.lastMessage?.createdAt)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-ink-mute">{preview(c)}</span>
                  {unread > 0 && (
                    <span className="shrink-0 rounded-full bg-accent px-2 text-xs font-bold text-white">
                      {unread}
                      <span className="sr-only"> non lu{unread > 1 ? 's' : ''}</span>
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MessageItem({ m, showAuthor, onDelete, onReport }) {
  const own = m.mine;
  return (
    <li className={`group flex ${own ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] ${own ? 'items-end' : 'items-start'} flex flex-col`}>
        {showAuthor && !own && <span className="mb-0.5 px-1 text-xs font-semibold text-ink-soft">{m.author?.name || 'Compte supprimé'}</span>}
        <div className="flex items-end gap-1">
          {own && !m.deleted && (
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-1 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-60"
              aria-label="Supprimer ce message"
              onClick={() => onDelete(m)}
            >
              <FiTrash2 aria-hidden="true" />
            </button>
          )}
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[0.9375rem] ${
              m.deleted ? 'border border-dashed border-line italic text-ink-mute' : own ? 'bg-accent text-white' : 'bg-paper text-ink'
            }`}
          >
            {m.deleted ? (m.deletedByModeration ? 'Message retiré par la modération' : 'Message supprimé') : m.body}
          </div>
          {!own && !m.deleted && m.author && (
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-1 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-60"
              aria-label={`Signaler ce message de ${m.author.name}`}
              onClick={() => onReport(m)}
            >
              <FiFlag aria-hidden="true" />
            </button>
          )}
        </div>
        <time dateTime={m.createdAt} className="mt-0.5 px-1 text-[0.6875rem] text-ink-mute">
          {time(m.createdAt)}
        </time>
      </div>
    </li>
  );
}

function Thread({ conversation, onBack, onConversationChanged, onLeft }) {
  const { user } = useAuth();
  const chat = useChat();
  const [messages, setMessages] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [managing, setManaging] = useState(false);
  const scroller = useRef(null);
  const stick = useRef(true);
  const keepFrom = useRef(null);
  const id = conversation.id;

  const markRead = useCallback(() => {
    api(`/api/chat/conversations/${id}/read`, { method: 'POST', body: {} })
      .then(() => chat?.refreshUnread())
      .catch(() => {});
  }, [id, chat]);

  const load = useCallback(async () => {
    setMessages(null);
    setError(null);
    try {
      const r = await api(`/api/chat/conversations/${id}/messages`);
      stick.current = true;
      setMessages(r.messages);
      setMore(r.more);
      markRead();
    } catch (err) {
      setError(err);
    }
  }, [id, markRead]);

  useEffect(() => {
    load();
    chat?.setActiveConversation(id);
    return () => chat?.setActiveConversation(null);
  }, [id, load, chat]);

  // Événements en direct sur cette conversation.
  useEffect(() => {
    if (!chat) return undefined;
    return chat.subscribe((event, data) => {
      if (!data) return;
      if (event === 'message' && data.conversationId === id) {
        const el = scroller.current;
        stick.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120 || data.author?.id === user.id;
        setMessages((list) => (list && !list.some((m) => m.id === data.id) ? [...list, { ...data, mine: data.author?.id === user.id }] : list));
        if (document.visibilityState === 'visible') markRead();
      }
      if (event === 'deleted' && data.conversationId === id) {
        setMessages((list) => list?.map((m) => (m.id === data.id ? { ...m, body: null, deleted: true, deletedByModeration: data.byModeration } : m)));
      }
      if (event === 'purged' && data.conversationId === id) {
        setMessages((list) => list?.filter((m) => !data.ids.includes(m.id)));
      }
    });
  }, [chat, id, user.id, markRead]);

  // Reste en bas quand on y était ; garde la position quand on charge les messages précédents.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    if (keepFrom.current != null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const loadOlder = async () => {
    const el = scroller.current;
    try {
      const r = await api(`/api/chat/conversations/${id}/messages`, { query: { before: messages[0]?.id } });
      keepFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((list) => [...r.messages, ...list]);
      setMore(r.more);
    } catch (err) {
      toastError(err);
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { message } = await api(`/api/chat/conversations/${id}/messages`, { method: 'POST', body: { body } });
      stick.current = true;
      setMessages((list) => (list && !list.some((m) => m.id === message.id) ? [...list, message] : list));
      setText('');
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };

  const remove = async (m) => {
    if (!(await confirmAction({ title: 'Supprimer ce message ?', text: 'Il sera remplacé par « Message supprimé » pour tout le monde.', confirmText: 'Supprimer', danger: true }))) return;
    try {
      await api(`/api/chat/messages/${m.id}`, { method: 'DELETE' });
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, body: null, deleted: true } : x)));
    } catch (err) {
      toastError(err);
    }
  };

  const leave = async () => {
    const text =
      conversation.kind === 'direct'
        ? 'Elle disparaîtra de votre liste. Si cette personne vous écrit de nouveau, elle réapparaîtra.'
        : 'Vous ne recevrez plus ses messages. Un participant pourra vous ajouter de nouveau.';
    if (!(await confirmAction({ title: 'Quitter la conversation ?', text, confirmText: 'Quitter', danger: true }))) return;
    try {
      await api(`/api/chat/conversations/${id}/members/me`, { method: 'DELETE' });
      setManaging(false);
      onLeft();
    } catch (err) {
      toastError(err);
    }
  };

  const items = useMemo(() => {
    const out = [];
    let day = null;
    let prev = null;
    for (const m of messages || []) {
      const d = new Date(m.createdAt).toDateString();
      if (d !== day) {
        out.push({ sep: dayLabel(m.createdAt), key: `d-${m.id}` });
        day = d;
        prev = null;
      }
      const showAuthor = conversation.kind !== 'direct' && (!prev || prev.author?.id !== m.author?.id);
      out.push({ m, showAuthor, key: m.id });
      prev = m;
    }
    return out;
  }, [messages, conversation.kind]);

  const subtitle =
    conversation.kind === 'general'
      ? 'Salon ouvert à toutes et à tous'
      : conversation.kind === 'group'
        ? 'Salon des membres du groupe'
        : conversation.kind === 'direct'
          ? 'Message privé'
          : conversation.members.map((m) => m.name).join(', ');

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="thread-title">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <button type="button" className="btn btn-ghost px-2 md:hidden" onClick={onBack} aria-label="Retour aux conversations">
          <FiArrowLeft aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id="thread-title" className="truncate font-bold">
            {conversation.title}
          </h2>
          <p className="truncate text-xs text-ink-mute">{subtitle}</p>
        </div>
        {conversation.kind === 'custom' && (
          <button type="button" className="btn btn-ghost px-2" onClick={() => setManaging(true)} aria-label="Gérer la conversation" title="Renommer, ajouter des participants, quitter">
            <FiEdit2 aria-hidden="true" /> <FiUserPlus aria-hidden="true" />
          </button>
        )}
        {conversation.kind === 'direct' && (
          <button type="button" className="btn btn-ghost px-2" onClick={leave} aria-label="Quitter la conversation" title="Quitter la conversation">
            <FiLogOut aria-hidden="true" />
          </button>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-relevant="additions">
        {error && <ErrorState error={error} onRetry={load} />}
        {!error && !messages && <Spinner />}
        {messages && (
          <>
            {more && (
              <div className="mb-3 text-center">
                <button type="button" className="btn btn-secondary" onClick={loadOlder}>
                  Messages précédents
                </button>
              </div>
            )}
            {!messages.length && <p className="py-10 text-center text-ink-mute">Aucun message. Lancez la conversation !</p>}
            <ol className="space-y-2">
              {items.map((it) =>
                it.sep ? (
                  <li key={it.key} className="py-2 text-center text-xs font-semibold text-ink-mute first-letter:uppercase">
                    {it.sep}
                  </li>
                ) : (
                  <MessageItem key={it.key} m={it.m} showAuthor={it.showAuthor} onDelete={remove} onReport={setReporting} />
                )
              )}
            </ol>
          </>
        )}
      </div>

      <form onSubmit={send} className="border-t border-line p-3">
        <label htmlFor="chat-input" className="sr-only">
          Votre message
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="chat-input"
            className="field max-h-40 min-h-[2.75rem] flex-1 resize-none"
            rows={text.split('\n').length > 1 ? Math.min(text.split('\n').length, 5) : 1}
            maxLength={MAX_MESSAGE}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Votre message : restez courtois, sans données sensibles (santé, comptes, mots de passe)"
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()} aria-label="Envoyer">
            <FiSend aria-hidden="true" /> <span className="hidden sm:inline">Envoyer</span>
          </button>
        </div>
        <p className="mt-1 flex justify-between text-xs text-ink-mute">
          <span>Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</span>
          {text.length > MAX_MESSAGE - 200 && <span>{MAX_MESSAGE - text.length} caractères restants</span>}
        </p>
      </form>

      <ReportDialog message={reporting} onClose={() => setReporting(null)} />
      {conversation.kind === 'custom' && (
        <ManageDialog open={managing} onClose={() => setManaging(false)} conversation={conversation} onChanged={onConversationChanged} onLeave={leave} />
      )}
    </section>
  );
}

export default function Discussions() {
  const { id } = useParams();
  const selectedId = id ? Number(id) : null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const chat = useChat();
  const [conversations, setConversations] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setConversations((await api('/api/chat/conversations')).conversations);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Liste à jour en direct : dernier message, non lus, conversations créées ou quittées.
  useEffect(() => {
    if (!chat) return undefined;
    return chat.subscribe((event, data) => {
      if (event === 'message' && data) {
        setConversations((list) => {
          if (!list) return list;
          const c = list.find((x) => x.id === data.conversationId);
          if (!c) {
            load();
            return list;
          }
          const mine = data.author?.id === user.id;
          const updated = {
            ...c,
            lastMessage: { ...data, mine },
            lastMessageAt: data.createdAt,
            unread: mine || data.conversationId === selectedId ? c.unread : c.unread + 1,
          };
          const rest = list.filter((x) => x.id !== c.id);
          const fixed = rest.filter((x) => x.kind === 'general' || x.kind === 'group');
          const others = rest.filter((x) => x.kind !== 'general' && x.kind !== 'group');
          return updated.kind === 'general' || updated.kind === 'group'
            ? list.map((x) => (x.id === c.id ? updated : x))
            : [...fixed, updated, ...others];
        });
      }
      if (event === 'conversation' || event === 'deleted' || event === 'purged') {
        load();
        if (event === 'conversation' && data?.removed && data.id === selectedId) navigate('/discussions', { replace: true });
      }
    });
  }, [chat, load, user.id, selectedId, navigate]);

  // La conversation ouverte est lue : son compteur repasse à zéro.
  useEffect(() => {
    if (selectedId) setConversations((list) => list?.map((c) => (c.id === selectedId ? { ...c, unread: 0 } : c)));
  }, [selectedId]);

  const selected = conversations?.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    if (conversations && selectedId && !selected) navigate('/discussions', { replace: true });
  }, [conversations, selectedId, selected, navigate]);

  if (user.impersonator) {
    return <ErrorState error={{ message: "Les discussions ne sont pas accessibles quand vous êtes à la place d'un utilisateur : elles sont privées." }} />;
  }
  if (error && !conversations) return <ErrorState error={error} onRetry={load} />;
  if (!conversations) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">Discussions</h1>
          <p className="mt-1 text-ink-mute">
            Échangez en direct avec les autres membres. {chat?.status === 'offline' && <span className="text-danger">Connexion perdue, nouvelle tentative…</span>}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <FiPlus aria-hidden="true" /> Nouvelle conversation
        </button>
      </div>

      <div className="panel flex h-[calc(100dvh-14rem)] min-h-[26rem] overflow-hidden">
        <nav aria-label="Conversations" className={`w-full shrink-0 overflow-y-auto border-line md:block md:w-72 md:border-r ${selected ? 'hidden' : 'block'}`}>
          <ConversationList conversations={conversations} selectedId={selectedId} />
        </nav>
        {selected ? (
          <Thread
            key={selected.id}
            conversation={selected}
            onBack={() => navigate('/discussions')}
            onConversationChanged={(c) => setConversations((list) => list.map((x) => (x.id === c.id ? { ...x, ...c, unread: 0 } : x)))}
            onLeft={() => {
              navigate('/discussions', { replace: true });
              load();
            }}
          />
        ) : (
          <div className="hidden flex-1 items-center justify-center p-8 text-center text-ink-mute md:flex">
            <p>
              Choisissez une conversation à gauche,
              <br />
              ou commencez-en une nouvelle.
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-mute">
        Vos messages privés ne sont lus par personne d'autre que les participants. Les administrateurs ne voient un message que s'il leur est signalé.
        Vous choisissez combien de temps vos messages sont gardés dans « Mon compte ».
      </p>

      <NewConversationDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          setConversations((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
          navigate(`/discussions/${c.id}`);
        }}
      />
    </div>
  );
}

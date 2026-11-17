import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiAlertTriangle, FiCheckCircle, FiEye, FiRefreshCw, FiSend, FiX } from 'react-icons/fi';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { toast, toastError } from '../../lib/notify';
import { ErrorState, Field, Spinner } from '../../components/ui';

/** Événements, dans l'ordre où on les rencontre : du point de vue de la personne qui reçoit l'e-mail. */
const MAIL_EVENTS = [
  { key: 'ticket_created', label: 'Nouvelle demande pour un groupe', who: 'Membres du groupe choisi' },
  { key: 'ticket_transferred', label: 'Demande transférée à un groupe', who: 'Membres du nouveau groupe' },
  { key: 'assigned', label: 'Demande confiée à quelqu’un', who: 'La personne à qui on la confie' },
  { key: 'comment', label: 'Nouveau message sur une demande', who: 'Le demandeur et le responsable' },
  { key: 'status_changed', label: 'Changement de statut', who: 'Le demandeur' },
  { key: 'join_requested', label: 'Demande pour rejoindre un groupe', who: 'Les administrateurs' },
  { key: 'join_decided', label: 'Réponse à une demande d’adhésion', who: 'La personne qui a demandé' },
];
const EVENT_LABELS = Object.fromEntries([...MAIL_EVENTS.map((e) => [e.key, e.label]), ['test', 'E-mail de test']]);

const STATUSES = [
  { key: 'open', label: 'Rouverte' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'resolved', label: 'Résolue' },
  { key: 'closed', label: 'Fermée' },
];

function Card({ title, description, children, id }) {
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby={id}>
      <h3 id={id} className="font-bold">
        {title}
      </h3>
      {description && <p className="mt-1 text-sm text-ink-mute">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Stat({ value, label, tone }) {
  return (
    <div className="rounded-md border border-line px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${tone || 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink-mute">{label}</div>
    </div>
  );
}

function PreviewDialog({ preview, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (preview && d && !d.open) d.showModal();
    if (!preview && d?.open) d.close();
  }, [preview]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
      aria-labelledby="preview-title"
    >
      {preview && (
        <div>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h4 id="preview-title" className="font-bold">
                Aperçu : {EVENT_LABELS[preview.event]}
              </h4>
              <p className="mt-1 text-sm text-ink-soft">
                <span className="text-ink-mute">Objet : </span>
                {preview.subject}
              </p>
            </div>
            <button type="button" className="btn btn-ghost px-2" onClick={onClose} aria-label="Fermer l’aperçu">
              <FiX aria-hidden="true" />
            </button>
          </div>
          {/* Un e-mail se lit toujours sur fond blanc, même en mode sombre. */}
          <iframe title="Contenu de l’e-mail" sandbox="" srcDoc={`<body style="margin:16px;background:#fff">${preview.html}</body>`} className="h-80 w-full bg-white" />
          <p className="border-t border-line px-5 py-3 text-xs text-ink-mute">Exemple fictif, avec vos réglages enregistrés.</p>
        </div>
      )}
    </dialog>
  );
}

function SendingCard({ info, onChange }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const { state, stats } = info;
  const recentError = state.lastError && state.lastErrorAt && (!state.lastSentAt || state.lastErrorAt > state.lastSentAt);

  const sendTest = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/admin/settings/mail/test', { method: 'POST', body: to ? { to } : {} });
      toast(`E-mail de test envoyé à ${r.to}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
      onChange();
    }
  };

  let status;
  if (!info.configured) status = { icon: FiAlertTriangle, tone: 'text-progress', text: 'Non configuré' };
  else if (recentError) status = { icon: FiAlertTriangle, tone: 'text-danger', text: 'Dernier envoi en échec' };
  else status = { icon: FiCheckCircle, tone: 'text-resolved', text: 'Opérationnel' };
  const StatusIcon = status.icon;

  return (
    <Card id="mail-sending" title="Envoi" description="La boîte d’envoi est configurée dans le fichier xchange.env du serveur. Son mot de passe n’apparaît jamais ici.">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className={`flex items-center gap-2 font-semibold ${status.tone}`}>
          <StatusIcon aria-hidden="true" /> {status.text}
        </p>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <Switch checked={info.settings.enabled} onChange={(v) => onChange({ enabled: v })} label="Envoyer les notifications" />
          Envoyer les notifications
        </label>
      </div>

      {!info.configured && (
        <div className="mt-4 rounded-md bg-progress-soft p-4 text-sm text-ink-soft">
          <p>Pour activer l’envoi, ajoutez ces lignes à C:\Xchange\xchange.env (Bloc-notes lancé en administrateur), puis lancez redemarrer.ps1 :</p>
          <pre className="mt-2 overflow-x-auto rounded bg-surface p-3 text-xs text-ink">{`SMTP_HOST=smtp.orange.fr
SMTP_PORT=465
SMTP_USER=adresse@orange.fr
SMTP_PASSWORD=mot de passe de la boîte
MAIL_FROM=adresse@orange.fr`}</pre>
        </div>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-mute">Serveur</dt>
        <dd>{info.host || '—'}</dd>
        <dt className="text-ink-mute">Expéditeur</dt>
        <dd>{info.from ? `${info.settings.senderName || 'Xchange'} <${info.from}>` : '—'}</dd>
        <dt className="text-ink-mute">Dernier envoi réussi</dt>
        <dd>{state.lastSentAt ? formatDateTime(state.lastSentAt) : 'aucun'}</dd>
        {recentError && (
          <>
            <dt className="text-ink-mute">Dernière erreur</dt>
            <dd className="text-danger">
              {formatDateTime(state.lastErrorAt)} : {state.lastError}
            </dd>
          </>
        )}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-sm">
        <Stat value={stats.sent7d} label="envoyés sur 7 jours" />
        <Stat value={stats.errors7d} label="échecs sur 7 jours" tone={stats.errors7d ? 'text-danger' : undefined} />
      </div>

      <form onSubmit={sendTest} className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-5">
        <Field id="mail-test-to" label="Envoyer un e-mail de test à" hint="Vide : votre adresse.">
          {(p) => <input {...p} type="email" className="field sm:w-72" value={to} onChange={(e) => setTo(e.target.value)} placeholder="votre adresse" />}
        </Field>
        <button type="submit" className="btn btn-secondary" disabled={busy || !info.configured}>
          <FiSend aria-hidden="true" /> {busy ? 'Envoi…' : 'Envoyer le test'}
        </button>
      </form>
    </Card>
  );
}

function EventsCard({ settings, onSave, onPreview }) {
  const [events, setEvents] = useState(settings.events);
  const [statuses, setStatuses] = useState(settings.statuses);
  const [commentToGroup, setCommentToGroup] = useState(settings.commentToGroup);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await onSave({ events, statuses, commentToGroup }, 'Événements enregistrés');
    setBusy(false);
  };
  const toggleStatus = (key) => setStatuses((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

  return (
    <Card id="mail-events" title="Événements" description="Choisissez ce qui déclenche un e-mail. La personne qui fait l’action n’est jamais prévenue, et chacun peut affiner ses choix dans « Mon compte ».">
      <ul className="divide-y divide-line rounded-md border border-line">
        {MAIL_EVENTS.map((e) => (
          <li key={e.key} className="px-4 py-3">
            <div className="flex items-center gap-4">
              <Switch checked={events[e.key]} onChange={(v) => setEvents({ ...events, [e.key]: v })} label={e.label} />
              <div className="min-w-0 flex-1">
                <p className={`font-semibold ${events[e.key] ? '' : 'text-ink-mute'}`}>{e.label}</p>
                <p className="text-sm text-ink-mute">{e.who}</p>
              </div>
              <button type="button" className="btn btn-ghost px-2 text-sm" onClick={() => onPreview(e.key)} aria-label={`Aperçu : ${e.label}`}>
                <FiEye aria-hidden="true" /> <span className="hidden sm:inline">Aperçu</span>
              </button>
            </div>
            {e.key === 'comment' && events.comment && (
              <label className="mt-3 ml-15 flex items-start gap-2 text-sm text-ink-soft">
                <input type="checkbox" className="mt-1" checked={commentToGroup} onChange={(ev) => setCommentToGroup(ev.target.checked)} />
                Si personne n’a encore pris la demande, prévenir tout son groupe
              </label>
            )}
            {e.key === 'status_changed' && events.status_changed && (
              <fieldset className="mt-3 ml-15">
                <legend className="text-sm text-ink-soft">Prévenir quand la demande passe à :</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STATUSES.map((s) => (
                    <label
                      key={s.key}
                      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                        statuses.includes(s.key) ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong text-ink-soft'
                      }`}
                    >
                      <input type="checkbox" className="sr-only" checked={statuses.includes(s.key)} onChange={() => toggleStatus(s.key)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          Enregistrer les événements
        </button>
      </div>
    </Card>
  );
}

function ContentCard({ settings, onSave }) {
  const [form, setForm] = useState({
    senderName: settings.senderName,
    subjectPrefix: settings.subjectPrefix,
    includeContent: settings.includeContent,
    footer: settings.footer,
    appUrl: settings.appUrl,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const suggested = typeof window !== 'undefined' ? window.location.origin : '';
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors((await onSave(form, 'Contenu des e-mails enregistré')) || {});
    setBusy(false);
  };

  return (
    <Card id="mail-content" title="Contenu des e-mails">
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="mail-sender" label="Nom de l’expéditeur" hint="Affiché dans la boîte de réception." error={errors.senderName}>
            {(p) => <input {...p} className="field" value={form.senderName} onChange={set('senderName')} placeholder="Xchange" />}
          </Field>
          <Field id="mail-prefix" label="Début de l’objet" hint="Aide à repérer et trier les e-mails." error={errors.subjectPrefix}>
            {(p) => <input {...p} className="field" value={form.subjectPrefix} onChange={set('subjectPrefix')} placeholder="[Xchange]" />}
          </Field>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={form.includeContent} onChange={set('includeContent')} />
          <span>
            <span className="font-semibold">Montrer le titre des demandes et le texte des messages</span>
            <span className="block text-ink-mute">
              Décoché, l’e-mail donne seulement le numéro et un lien. Les demandes confidentielles ne sont jamais détaillées.
            </span>
          </span>
        </label>
        <Field id="mail-footer" label="Texte en bas des e-mails" hint="Facultatif, par exemple le nom de l’association ou un contact." error={errors.footer}>
          {(p) => <textarea {...p} rows={2} className="field" value={form.footer} onChange={set('footer')} />}
        </Field>
        <Field id="mail-appurl" label="Adresse publique d’Xchange" hint="Utilisée pour les liens « Voir la demande ». Vide : valeur APP_URL du serveur." error={errors.appUrl}>
          {(p) => (
            <div className="flex flex-wrap gap-2">
              <input {...p} className="field min-w-0 flex-1" value={form.appUrl} onChange={set('appUrl')} placeholder={suggested} />
              {!form.appUrl && suggested && (
                <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...form, appUrl: suggested })}>
                  Utiliser cette adresse
                </button>
              )}
            </div>
          )}
        </Field>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Enregistrer le contenu
          </button>
        </div>
      </form>
    </Card>
  );
}

function PeopleCard({ people }) {
  return (
    <Card id="mail-people" title="Destinataires" description="Une personne sans adresse e-mail ne reçoit rien, quels que soient les réglages.">
      <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
        <Stat value={people.total} label="comptes" />
        <Stat value={people.noEmail} label="sans adresse e-mail" tone={people.noEmail ? 'text-progress' : undefined} />
        <Stat value={people.optedOut} label="ont tout coupé" />
      </div>
      {people.noEmail > 0 && (
        <p className="mt-4 text-sm text-ink-soft">
          Sans adresse : {people.noEmailList.map((u) => u.name).join(', ')}
          {people.noEmail > people.noEmailList.length && '…'}.{' '}
          <Link to="/admin" className="font-semibold text-accent-strong underline">
            Compléter dans Utilisateurs
          </Link>
        </p>
      )}
    </Card>
  );
}

function LogCard({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api(`/api/admin/settings/mail/log?limit=100${onlyErrors ? '&status=error' : ''}`).then(setRows).catch(setError);
  }, [onlyErrors]);
  useEffect(load, [load, refreshKey]);

  return (
    <Card id="mail-log" title="Journal des envois" description="Les 100 derniers e-mails partis ou en échec.">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Échecs seulement
        </label>
        <button type="button" className="btn btn-ghost text-sm" onClick={load}>
          <FiRefreshCw aria-hidden="true" /> Actualiser
        </button>
      </div>
      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !rows && <Spinner />}
      {rows && !rows.length && <p className="text-sm text-ink-mute">{onlyErrors ? 'Aucun échec.' : 'Aucun e-mail envoyé pour l’instant.'}</p>}
      {rows && rows.length > 0 && (
        <div className="max-h-96 overflow-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-paper text-xs text-ink-mute">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Événement</th>
                <th className="px-3 py-2 font-semibold">Destinataire</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Objet</th>
                <th className="px-3 py-2 font-semibold">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-soft">{formatDateTime(r.created_at)}</td>
                  <td className="px-3 py-2">{EVENT_LABELS[r.event] || r.event}</td>
                  <td className="px-3 py-2">
                    {r.user || r.to_email}
                    {r.user && <span className="block text-xs text-ink-mute">{r.to_email}</span>}
                  </td>
                  <td className="hidden max-w-xs truncate px-3 py-2 text-ink-soft md:table-cell" title={r.subject}>
                    {r.subject}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === 'sent' ? (
                      <span className="font-semibold text-resolved">Envoyé</span>
                    ) : (
                      <span className="font-semibold text-danger" title={r.error || ''}>
                        Échec
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function NotificationsPanel() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    api('/api/admin/settings/mail').then(setInfo).catch(setError);
  }, []);
  useEffect(load, [load]);

  /** Enregistre une partie des réglages ; renvoie les erreurs de champ éventuelles. */
  const save = async (patch, message) => {
    try {
      setInfo(await api('/api/admin/settings/mail', { method: 'PUT', body: patch }));
      toast(message);
      return null;
    } catch (err) {
      toastError(err);
      return err.details || null;
    }
  };

  const openPreview = async (event) => {
    try {
      setPreview({ event, ...(await api('/api/admin/settings/mail/preview', { method: 'POST', body: { event } })) });
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!info) return <Spinner />;
  return (
    <div className="space-y-6">
      <SendingCard
        info={info}
        onChange={(patch) => {
          if (patch) save(patch, patch.enabled ? 'Notifications activées' : 'Notifications coupées');
          else {
            load();
            setVersion((v) => v + 1);
          }
        }}
      />
      <EventsCard settings={info.settings} onSave={save} onPreview={openPreview} />
      <ContentCard settings={info.settings} onSave={save} />
      <PeopleCard people={info.people} />
      <LogCard refreshKey={version} />
      <PreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

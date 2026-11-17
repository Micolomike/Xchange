import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiDownload, FiExternalLink, FiPlay, FiSearch, FiUserX, FiX } from 'react-icons/fi';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { confirmAction, promptText, toast, toastError } from '../../lib/notify';
import { exportFileName, saveJson } from '../../lib/saveJson';
import { ErrorState, Field, Spinner } from '../../components/ui';
import { forgetLegal, LEGAL_PAGES } from '../../legal/useLegal';

function Card({ id, title, description, children }) {
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

const fullName = (u) => [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username;

/* ------------------------------------------------------------------ Anonymisation */

function AnonymizeDialog({ user, onClose, onDone, initialMode = 'keep', requestId = null }) {
  const ref = useRef(null);
  const [mode, setMode] = useState('keep');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (user && d && !d.open) d.showModal();
    if (!user && d?.open) d.close();
    setMode(initialMode);
    setTyped('');
  }, [user, initialMode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api(`/api/admin/rgpd/users/${user.id}/anonymize`, { method: 'POST', body: { mode, ...(requestId ? { requestId } : {}) } });
      const parts = [];
      if (r.tickets) parts.push(`${r.tickets} demande(s) supprimée(s)`);
      if (r.comments) parts.push(`${r.comments} message(s) supprimé(s)`);
      if (r.attachments) parts.push(`${r.attachments} pièce(s) jointe(s) supprimée(s)`);
      toast(`Compte anonymisé${parts.length ? ` : ${parts.join(', ')}` : ''}`);
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="anon-title"
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      {user && (
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <h4 id="anon-title" className="font-bold">
              Anonymiser le compte de {fullName(user)}
            </h4>
            <button type="button" className="btn btn-ghost px-2" onClick={onClose} aria-label="Annuler">
              <FiX aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4 text-sm">
            <p className="text-ink-soft">
              Irréversible. Le nom, l’identifiant et l’adresse e-mail sont remplacés par « Utilisateur supprimé », le mot de passe, la
              double authentification et les sessions sont effacés, ainsi que les pièces jointes déposées, les groupes, les demandes
              d’adhésion et les journaux qui le concernent.
            </p>
            <fieldset className="space-y-2">
              <legend className="font-semibold">Ses demandes et ses messages</legend>
              <label className="flex items-start gap-3 rounded-md border border-line p-3">
                <input type="radio" name="anon-mode" className="mt-1" checked={mode === 'keep'} onChange={() => setMode('keep')} />
                <span>
                  <span className="font-semibold">Les conserver, anonymisés</span>
                  <span className="block text-ink-mute">
                    Utile aux autres (solutions trouvées). Le texte n’est pas modifié : un nom écrit dedans reste visible.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md border border-line p-3">
                <input type="radio" name="anon-mode" className="mt-1" checked={mode === 'delete'} onChange={() => setMode('delete')} />
                <span>
                  <span className="font-semibold">Les supprimer</span>
                  <span className="block text-ink-mute">Ses demandes (avec leurs messages et fichiers) et ses messages sur les autres demandes.</span>
                </span>
              </label>
            </fieldset>
            <Field id="anon-confirm" label={`Pour confirmer, tapez son identifiant : ${user.username}`}>
              {(p) => <input {...p} className="field" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />}
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || typed.trim().toLowerCase() !== user.username.toLowerCase()}>
              <FiUserX aria-hidden="true" /> {busy ? 'Anonymisation…' : 'Anonymiser définitivement'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function PersonCard({ me, onChange }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [toAnonymize, setToAnonymize] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/users').then(setUsers).catch(setError);
  }, []);
  useEffect(load, [load]);

  const matches = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return users.filter((u) => [u.username, u.firstname, u.lastname, u.email].some((v) => v && v.toLowerCase().includes(q))).slice(0, 8);
  }, [users, query]);
  const selected = users?.find((u) => u.id === selectedId) || null;

  const exportData = async () => {
    setBusy(true);
    try {
      const data = await api(`/api/admin/rgpd/users/${selected.id}/export`);
      saveJson(data, exportFileName(data));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  return (
    <Card
      id="rgpd-person"
      title="Données d’une personne"
      description="Pour répondre à une demande d’accès, de portabilité ou d’effacement. Vous avez un mois pour répondre."
    >
      {!users ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <Field id="rgpd-search" label="Rechercher un compte" hint="Nom, prénom, identifiant ou adresse e-mail.">
              {(p) => (
                <div className="relative">
                  <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                  <input {...p} type="search" className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                </div>
              )}
            </Field>
            {query.trim() && (
              <ul className="mt-2 divide-y divide-line rounded-md border border-line" aria-label="Comptes trouvés">
                {matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-mute">Aucun compte trouvé.</li>}
                {matches.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(u.id)}
                      aria-pressed={u.id === selectedId}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-paper ${u.id === selectedId ? 'bg-accent-soft' : ''}`}
                    >
                      <span className="font-semibold">{fullName(u)}</span>
                      <span className="block text-xs text-ink-mute">
                        {u.username}
                        {u.email ? `, ${u.email}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-line p-4">
            {!selected ? (
              <p className="text-sm text-ink-mute">Choisissez un compte pour exporter ses données ou l’anonymiser.</p>
            ) : (
              <>
                <p className="font-bold">{fullName(selected)}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-ink-mute">Identifiant</dt>
                  <dd>{selected.username}</dd>
                  <dt className="text-ink-mute">E-mail</dt>
                  <dd>{selected.email || 'aucun'}</dd>
                  <dt className="text-ink-mute">Créé le</dt>
                  <dd>{selected.created_at ? formatDateTime(selected.created_at) : 'inconnu'}</dd>
                  <dt className="text-ink-mute">Dernière activité</dt>
                  <dd>{selected.last_seen_at ? formatDateTime(selected.last_seen_at) : 'inconnue'}</dd>
                  <dt className="text-ink-mute">Charte acceptée</dt>
                  <dd>{selected.terms_accepted_at ? formatDateTime(selected.terms_accepted_at) : 'non'}</dd>
                  <dt className="text-ink-mute">Demandes</dt>
                  <dd>{selected.created_count}</dd>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary" onClick={exportData} disabled={busy}>
                    <FiDownload aria-hidden="true" /> Exporter ses données (JSON)
                  </button>
                  {selected.id !== me.id && (
                    <button type="button" className="btn btn-danger" onClick={() => setToAnonymize(selected)}>
                      <FiUserX aria-hidden="true" /> Anonymiser…
                    </button>
                  )}
                </div>
                {selected.id === me.id && <p className="mt-2 text-xs text-ink-mute">Vous ne pouvez pas anonymiser votre propre compte.</p>}
              </>
            )}
          </div>
        </div>
      )}
      <AnonymizeDialog
        user={toAnonymize}
        onClose={() => setToAnonymize(null)}
        onDone={() => {
          setToAnonymize(null);
          setSelectedId(null);
          setQuery('');
          load();
          onChange();
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ Demandes des personnes */

const REQUEST_STATUS = {
  pending: { label: 'À traiter', cls: 'bg-progress-soft text-progress' },
  done: { label: 'Traitée', cls: 'bg-resolved-soft text-resolved' },
  rejected: { label: 'Refusée', cls: 'bg-closed-soft text-closed' },
};

function RequestsCard({ onChange }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [anon, setAnon] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api('/api/admin/rgpd/requests').then(setRows).catch(setError);
  }, []);
  useEffect(load, [load]);

  const close = async (r, status) => {
    const res = await promptText({
      title: status === 'done' ? 'Marquer la demande comme traitée' : 'Refuser la demande',
      label: status === 'done' ? 'Réponse visible par la personne (facultatif)' : 'Motif du refus, visible par la personne',
      confirmText: status === 'done' ? 'Marquer traitée' : 'Refuser',
    });
    if (!res.isConfirmed) return;
    try {
      await api(`/api/admin/rgpd/requests/${r.id}/close`, { method: 'POST', body: { status, response: res.value || '' } });
      toast(status === 'done' ? 'Demande traitée' : 'Demande refusée');
      load();
      onChange();
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!rows) return <Spinner />;
  const pending = rows.filter((r) => r.status === 'pending');
  const visible = showAll ? rows : pending;

  return (
    <Card
      id="rgpd-requests"
      title={`Demandes des personnes${pending.length ? ` (${pending.length} à traiter)` : ''}`}
      description="Faites depuis « Mon compte ». Le délai légal de réponse est d’un mois."
    >
      {visible.length === 0 ? (
        <p className="text-sm text-ink-mute">{showAll ? 'Aucune demande pour l’instant.' : 'Aucune demande en attente.'}</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => {
            const st = REQUEST_STATUS[r.status];
            const erasure = r.type === 'anonymize' || r.type === 'erase';
            return (
              <li key={r.id} className="rounded-md border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  <span className="font-semibold">{r.type_label}</span>
                  <span className="text-sm text-ink-mute">par {r.user ? r.user.name : 'compte supprimé'}</span>
                </div>
                <p className="mt-1 text-xs text-ink-mute">
                  Reçue le {formatDateTime(r.created_at)}
                  {r.status === 'pending' && (
                    <span className={r.overdue ? 'font-semibold text-danger' : ''}>
                      {', '}
                      réponse attendue avant le {formatDateTime(r.due_at)}
                      {r.overdue && ' (délai dépassé)'}
                    </span>
                  )}
                  {r.handled_at && `, ${r.status === 'done' ? 'traitée' : 'refusée'} le ${formatDateTime(r.handled_at)} par ${r.handled_by || 'un administrateur'}`}
                </p>
                {r.message && <p className="mt-2 whitespace-pre-line rounded bg-paper px-3 py-2 text-sm">{r.message}</p>}
                {r.response && <p className="mt-2 text-sm text-ink-soft">Réponse : {r.response}</p>}
                {r.status === 'pending' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {erasure && r.user && !r.user.anonymized && (
                      <button
                        type="button"
                        className="btn btn-danger py-1.5 text-sm"
                        onClick={() => setAnon({ user: { id: r.user.id, username: r.user.username, firstname: r.user.name }, mode: r.type === 'erase' ? 'delete' : 'keep', requestId: r.id })}
                      >
                        <FiUserX aria-hidden="true" /> Anonymiser le compte…
                      </button>
                    )}
                    {r.user && !r.user.anonymized && (
                      <button
                        type="button"
                        className="btn btn-secondary py-1.5 text-sm"
                        onClick={async () => {
                          try {
                            const data = await api(`/api/admin/rgpd/users/${r.user.id}/export`);
                            saveJson(data, exportFileName(data));
                          } catch (err) {
                            toastError(err);
                          }
                        }}
                      >
                        <FiDownload aria-hidden="true" /> Ses données
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary py-1.5 text-sm" onClick={() => close(r, 'done')}>
                      Marquer traitée
                    </button>
                    <button type="button" className="btn btn-ghost py-1.5 text-sm" onClick={() => close(r, 'rejected')}>
                      Refuser
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > pending.length && (
        <button type="button" className="btn btn-ghost mt-3 text-sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Masquer les demandes closes' : `Voir aussi les ${rows.length - pending.length} demande(s) close(s)`}
        </button>
      )}
      <AnonymizeDialog
        user={anon?.user || null}
        initialMode={anon?.mode}
        requestId={anon?.requestId}
        onClose={() => setAnon(null)}
        onDone={() => {
          setAnon(null);
          load();
          onChange();
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ Conservation et purge */

function RetentionCard({ info, onSaved }) {
  const [form, setForm] = useState({
    inactiveMonths: String(info.settings.inactiveMonths),
    logMonths: String(info.settings.logMonths),
    trashDays: String(info.settings.trashDays ?? 30),
    requireTerms: info.settings.requireTerms !== false,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const { candidates, state } = info;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api('/api/admin/rgpd/settings', {
        method: 'PUT',
        body: {
          inactiveMonths: Number(form.inactiveMonths),
          logMonths: Number(form.logMonths),
          trashDays: Number(form.trashDays),
          requireTerms: form.requireTerms,
        },
      });
      setErrors({});
      forgetLegal();
      toast('Règles de conservation enregistrées');
      onSaved(next);
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const purgeNow = async () => {
    const n = candidates.inactive.length;
    const ok = await confirmAction({
      title: 'Lancer la purge maintenant ?',
      text: `${n} compte(s) inactif(s) seront anonymisés (demandes conservées), ${candidates.trash} demande(s) de la corbeille effacée(s) et ${
        candidates.logs.mail + candidates.logs.impersonations + candidates.logs.groupRequests
      } ligne(s) de journal supprimées.`,
      confirmText: 'Lancer la purge',
      danger: n > 0,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/rgpd/purge', { method: 'POST' });
      toast(`Purge faite : ${r.done.accounts} compte(s), ${r.done.trash} demande(s) de la corbeille, ${r.done.mail + r.done.impersonations + r.done.groupRequests} ligne(s) de journal`);
      onSaved(r);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <Card
      id="rgpd-retention"
      title="Conservation et purge"
      description="La purge tourne automatiquement une fois par jour. Les administrateurs ne sont jamais anonymisés automatiquement."
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="rgpd-inactive" label="Anonymiser les comptes inactifs depuis (mois)" hint="24 mois est la durée habituelle. 0 : jamais." error={errors.inactiveMonths}>
            {(p) => <input {...p} type="number" min="0" max="120" className="field" value={form.inactiveMonths} onChange={set('inactiveMonths')} />}
          </Field>
          <Field id="rgpd-logs" label="Supprimer les journaux plus vieux que (mois)" hint="Entre 6 et 12 mois recommandés. 0 : jamais." error={errors.logMonths}>
            {(p) => <input {...p} type="number" min="0" max="36" className="field" value={form.logMonths} onChange={set('logMonths')} />}
          </Field>
          <Field id="rgpd-trash" label="Vider la corbeille après (jours)" hint="Demandes supprimées, effacées pour de bon. 0 : jamais." error={errors.trashDays}>
            {(p) => <input {...p} type="number" min="0" max="365" className="field" value={form.trashDays} onChange={set('trashDays')} />}
          </Field>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={form.requireTerms} onChange={set('requireTerms')} />
          <span>
            <span className="font-semibold">Faire accepter la charte et la politique de confidentialité à l’inscription</span>
            <span className="block text-ink-mute">
              {info.terms.accepted} compte(s) sur {info.terms.total} les ont acceptées. Les autres voient un bandeau les invitant à le faire.
            </span>
          </span>
        </label>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Enregistrer
          </button>
        </div>
      </form>

      <div className="mt-5 border-t border-line pt-5">
        <h4 className="font-semibold">Prochaine purge</h4>
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          <li>
            {candidates.inactive.length} compte(s) inactif(s) à anonymiser
            {candidates.inactive.length > 0 && ` : ${candidates.inactive.map((u) => u.name).join(', ')}`}
          </li>
          <li>{candidates.logs.mail} e-mail(s) du journal d’envoi à supprimer</li>
          <li>{candidates.logs.impersonations} trace(s) de prise de contrôle à supprimer</li>
          <li>{candidates.logs.groupRequests} demande(s) d’adhésion à un groupe, déjà traitée(s), à supprimer</li>
          <li>{candidates.trash} demande(s) de la corbeille à effacer définitivement</li>
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-mute">
            Dernière purge : {state.lastRunAt ? formatDateTime(state.lastRunAt) : 'pas encore lancée'}
            {state.lastError && <span className="block text-danger">Erreur : {state.lastError}</span>}
          </p>
          <button type="button" className="btn btn-secondary" onClick={purgeNow} disabled={busy}>
            <FiPlay aria-hidden="true" /> Lancer la purge maintenant
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Textes juridiques */

function LegalCard({ legal, onSaved }) {
  const [current, setCurrent] = useState(LEGAL_PAGES[0].key);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(LEGAL_PAGES.map((p) => [p.key, legal[p.key].text])));
  const [busy, setBusy] = useState(false);
  const page = LEGAL_PAGES.find((p) => p.key === current);
  const todo = (drafts[current].match(/\[[^\]]+\]/g) || []).length;
  const changed = drafts[current] !== legal[current].text;

  const save = async (text) => {
    setBusy(true);
    try {
      const next = await api('/api/admin/rgpd/legal', { method: 'PUT', body: { [current]: text } });
      forgetLegal();
      setDrafts((d) => ({ ...d, [current]: next.legal[current].text }));
      toast(text ? `${page.title} : enregistré` : `${page.title} : texte proposé rétabli`);
      onSaved(next);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      id="rgpd-legal"
      title="Textes juridiques"
      description="Pages publiques, en lien en bas de chaque page. « ## » commence un titre, « - » une ligne de liste ; laissez une ligne vide entre deux paragraphes. Dans la politique de confidentialité, {{inactiveMonths}}, {{logMonths}} et {{trashDays}} affichent les durées réglées ci-dessus."
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Texte à modifier">
        {LEGAL_PAGES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={current === p.key}
            onClick={() => setCurrent(p.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              current === p.key ? 'bg-accent-soft text-accent-strong' : 'text-ink-soft hover:bg-paper'
            }`}
          >
            {p.title}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${legal[current].custom ? 'bg-resolved-soft text-resolved' : 'bg-closed-soft text-closed'}`}>
          {legal[current].custom ? 'Texte personnalisé' : 'Texte proposé par défaut'}
        </span>
        {todo > 0 && (
          <span className="rounded-full bg-progress-soft px-2.5 py-0.5 text-xs font-semibold text-progress">
            {todo} passage(s) entre crochets à compléter
          </span>
        )}
        <Link to={page.path} target="_blank" className="ml-auto inline-flex items-center gap-1 font-semibold text-accent-strong hover:underline">
          Voir la page <FiExternalLink aria-hidden="true" />
        </Link>
      </div>
      <label htmlFor="rgpd-legal-text" className="sr-only">
        {page.title}
      </label>
      <textarea
        id="rgpd-legal-text"
        className="field mt-3 min-h-96 resize-y font-mono text-sm leading-relaxed"
        value={drafts[current]}
        onChange={(e) => setDrafts({ ...drafts, [current]: e.target.value })}
        spellCheck
      />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {legal[current].custom && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              if (await confirmAction({ title: 'Rétablir le texte proposé ?', text: 'Votre version sera remplacée.', confirmText: 'Rétablir' })) save('');
            }}
          >
            Rétablir le texte proposé
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={() => save(drafts[current])}>
          Enregistrer
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Rappels */

function RemindersCard() {
  return (
    <Card id="rgpd-reminders" title="À faire hors de l’application">
      <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
        <li>
          Tenir un <span className="font-semibold text-ink">registre des traitements</span> : une fiche suffit pour Xchange (modèle sur
          cnil.fr). Document interne, rien à publier.
        </li>
        <li>
          En cas de fuite de données (PC volé, base exposée) : prévenir la <span className="font-semibold text-ink">CNIL sous 72 heures</span> si
          elle présente un risque pour les personnes.
        </li>
        <li>Compléter les passages entre crochets des mentions légales et de la politique de confidentialité.</li>
        <li>Les sauvegardes contiennent les données des comptes anonymisés jusqu’à leur rotation : gardez-en un nombre limité.</li>
      </ul>
    </Card>
  );
}

export default function RgpdPanel({ me }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    api('/api/admin/rgpd').then(setInfo).catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!info) return <Spinner />;
  return (
    <div className="space-y-6">
      <RequestsCard onChange={load} />
      <PersonCard me={me} onChange={load} />
      <RetentionCard key={JSON.stringify(info.settings)} info={info} onSaved={setInfo} />
      <LegalCard legal={info.legal} onSaved={setInfo} />
      <RemindersCard />
      <p className="text-sm text-ink-mute">{info.anonymized} compte(s) anonymisé(s) à ce jour.</p>
    </div>
  );
}

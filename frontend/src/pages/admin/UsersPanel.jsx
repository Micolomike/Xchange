import { useCallback, useEffect, useState } from 'react';
import { FiEdit2, FiEye, FiKey, FiShieldOff, FiTrash2, FiUserPlus } from 'react-icons/fi';
import { useAuth } from '../../auth/context';
import { api } from '../../lib/api';
import { ROLES } from '../../lib/constants';
import { formatDate, formatDateTime } from '../../lib/format';
import { confirmAction, showInfo, toast, toastError } from '../../lib/notify';
import { Avatar } from '../../components/Badges';
import { ErrorState, Field, Spinner } from '../../components/ui';

const EMPTY = { username: '', password: '', firstname: '', lastname: '', email: '', role: 'user' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function UserForm({ initial, onCancel, onSaved }) {
  const editing = Boolean(initial.id);
  const [form, setForm] = useState({ ...EMPTY, ...initial, password: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const update = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      username: form.username,
      firstname: form.firstname,
      lastname: form.lastname,
      email: form.email,
      role: form.role,
    };
    if (form.password || !editing) body.password = form.password;
    try {
      await api(editing ? `/api/users/${initial.id}` : '/api/users', { method: editing ? 'PATCH' : 'POST', body });
      toast(editing ? 'Utilisateur modifié' : 'Utilisateur créé');
      onSaved();
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
      setSaving(false);
    }
  };

  const input = (name, extra = {}) => (p) => (
    <input {...p} className="field" value={form[name]} onChange={(e) => update(name, e.target.value)} {...extra} />
  );

  return (
    <form onSubmit={submit} className="border-b border-line bg-paper/60 p-5" noValidate>
      <h3 className="mb-4 font-bold">{editing ? `Modifier ${initial.username}` : 'Nouvel utilisateur'}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="u-username" label="Nom d'utilisateur" required error={errors.username}>
          {input('username', { autoComplete: 'off' })}
        </Field>
        <Field id="u-firstname" label="Prénom" error={errors.firstname}>
          {input('firstname')}
        </Field>
        <Field id="u-lastname" label="Nom" error={errors.lastname}>
          {input('lastname')}
        </Field>
        <Field id="u-email" label="E-mail" error={errors.email}>
          {input('email', { type: 'email' })}
        </Field>
        <Field
          id="u-password"
          label={editing ? 'Nouveau mot de passe' : 'Mot de passe'}
          required={!editing}
          error={errors.password}
          hint={editing ? 'Laisser vide pour ne pas le changer.' : 'Au moins 8 caractères.'}
        >
          {input('password', { type: 'password', autoComplete: 'new-password' })}
        </Field>
        <Field id="u-role" label="Rôle" error={errors.role}>
          {(p) => (
            <select {...p} className="field" value={form.role} onChange={(e) => update('role', e.target.value)}>
              {Object.entries(ROLES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : "Créer l'utilisateur"}
        </button>
      </div>
    </form>
  );
}

export default function UsersPanel() {
  const { user: me, impersonate } = useAuth();
  const [log, setLog] = useState([]);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [formFor, setFormFor] = useState(null); // null, {} (création) ou un utilisateur

  const load = useCallback(() => {
    setError(null);
    api('/api/users/impersonations')
      .then(setLog)
      .catch(() => {});
    return api('/api/users').then(setUsers).catch(setError);
  }, []);

  const actAs = async (u) => {
    const ok = await confirmAction({
      title: `Vous mettre à la place de ${u.name} ?`,
      text:
        "Vous verrez Xchange comme cette personne pendant une heure au plus et pourrez agir pour elle. Chaque action portera la mention « fait par » votre nom, la personne verra cet accès dans « Mon compte », et ses demandes confidentielles resteront masquées.",
      confirmText: 'Me mettre à sa place',
    });
    if (!ok) return;
    try {
      await impersonate(u);
    } catch (err) {
      toastError(err);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (u, role) => {
    try {
      await api(`/api/users/${u.id}`, { method: 'PATCH', body: { role } });
      toast(`${u.username} est maintenant ${ROLES[role].toLowerCase()}`);
    } catch (err) {
      toastError(err);
    }
    load();
  };

  const resetPassword = async (u) => {
    const ok = await confirmAction({
      title: `Réinitialiser le mot de passe de ${u.username} ?`,
      text: 'Un mot de passe temporaire sera généré et ses sessions ouvertes seront fermées.',
      confirmText: 'Réinitialiser',
    });
    if (!ok) return;
    try {
      const { password } = await api(`/api/users/${u.id}/reset-password`, { method: 'POST' });
      showInfo({
        title: 'Mot de passe réinitialisé',
        icon: 'success',
        html: `Transmettez ce mot de passe temporaire à <b>${escapeHtml(u.username)}</b> :<br><code style="display:inline-block;margin-top:12px;padding:6px 12px;background:var(--color-paper);color:var(--color-ink);border-radius:6px;font-size:1.1rem;letter-spacing:.04em">${escapeHtml(password)}</code><br><small>Il pourra le changer depuis « Mon compte ».</small>`,
      });
    } catch (err) {
      toastError(err);
    }
  };

  const resetMfa = async (u) => {
    const ok = await confirmAction({
      title: `Réinitialiser la double authentification de ${u.username} ?`,
      text: "À faire s'il a perdu son téléphone et ses codes de secours. Ses sessions sont fermées et il reconfigurera une appli à sa prochaine connexion.",
      confirmText: 'Réinitialiser',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/users/${u.id}/reset-mfa`, { method: 'POST' });
      toast(`Double authentification de ${u.username} réinitialisée`);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const setExempt = async (u, exempt) => {
    const ok = await confirmAction(
      exempt
        ? {
            title: `Dispenser ${u.username} de la double authentification ?`,
            text:
              (u.role === 'admin'
                ? "Attention : c'est un compte administrateur, accessible depuis Internet avec son seul mot de passe. "
                : '') +
              "Il se connectera avec son seul mot de passe. Sa configuration actuelle est effacée et ses sessions sont fermées. Conseillez-lui un mot de passe long.",
            confirmText: 'Dispenser',
            danger: true,
          }
        : {
            title: `Exiger à nouveau la double authentification pour ${u.username} ?`,
            text: 'Ses sessions sont fermées ; il configurera une appli à sa prochaine connexion.',
            confirmText: 'Exiger',
          }
    );
    if (!ok) return;
    try {
      await api(`/api/users/${u.id}/mfa-exempt`, { method: 'POST', body: { exempt } });
      toast(exempt ? `${u.username} est dispensé de double authentification` : `Double authentification exigée pour ${u.username}`);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const remove = async (u) => {
    const ok = await confirmAction({
      title: `Supprimer le compte de ${u.username} ?`,
      text: 'Ses tickets et commentaires sont conservés, sans auteur. Cette action est définitive.',
      confirmText: 'Supprimer le compte',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/users/${u.id}`, { method: 'DELETE' });
      toast('Compte supprimé');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!users) return <Spinner />;

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-ink-mute">
          {users.length} compte{users.length > 1 ? 's' : ''}, dont {users.filter((u) => u.role === 'admin').length} administrateur
          {users.filter((u) => u.role === 'admin').length > 1 ? 's' : ''}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setFormFor({})}>
          <FiUserPlus aria-hidden="true" /> Ajouter un utilisateur
        </button>
      </div>

      {formFor && (
        <UserForm
          key={formFor.id || 'new'}
          initial={formFor}
          onCancel={() => setFormFor(null)}
          onSaved={() => {
            setFormFor(null);
            load();
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs font-semibold text-ink-mute">
            <tr>
              <th scope="col" className="px-5 py-2.5">Utilisateur</th>
              <th scope="col" className="px-5 py-2.5">E-mail</th>
              <th scope="col" className="px-5 py-2.5">Rôle</th>
              <th scope="col" className="px-5 py-2.5">Groupes</th>
              <th scope="col" className="px-5 py-2.5">Double auth.</th>
              <th scope="col" className="px-5 py-2.5 text-right">Tickets créés</th>
              <th scope="col" className="px-5 py-2.5 text-right">En charge</th>
              <th scope="col" className="px-5 py-2.5">Inscrit le</th>
              <th scope="col" className="px-5 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <Avatar user={u} size="lg" />
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {u.name}
                        {u.id === me.id && <span className="ml-1 text-xs font-normal text-ink-mute">(vous)</span>}
                      </span>
                      <span className="block text-xs text-ink-mute">{u.username}</span>
                    </span>
                  </span>
                </td>
                <td className="px-5 py-3 text-ink-soft">{u.email || <span className="text-ink-mute">Non renseigné</span>}</td>
                <td className="px-5 py-3">
                  <select
                    className="field w-auto py-1"
                    aria-label={`Rôle de ${u.username}`}
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value)}
                  >
                    {Object.entries(ROLES).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-3 text-ink-soft">
                  {u.groups?.length ? u.groups.map((g) => g.name).join(', ') : <span className="text-ink-mute">Aucun</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-3">
                  {u.mfa_enabled ? (
                    <span className="font-semibold text-resolved">Activée</span>
                  ) : u.mfa_exempt ? (
                    <span className="font-semibold text-progress">Dispensé</span>
                  ) : (
                    <span className="text-ink-mute">À configurer</span>
                  )}
                  <button
                    type="button"
                    className="block text-xs font-semibold text-accent-strong hover:underline"
                    onClick={() => setExempt(u, !u.mfa_exempt)}
                    aria-label={
                      u.mfa_exempt
                        ? `Exiger la double authentification pour ${u.username}`
                        : `Dispenser ${u.username} de la double authentification`
                    }
                  >
                    {u.mfa_exempt ? 'Exiger' : 'Dispenser'}
                  </button>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{u.created_count}</td>
                <td className="px-5 py-3 text-right tabular-nums">{u.assigned_active_count}</td>
                <td className="whitespace-nowrap px-5 py-3 text-ink-mute">{formatDate(u.created_at)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right">
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    onClick={() => actAs(u)}
                    disabled={u.role === 'admin' || u.id === me.id}
                    aria-label={`Se mettre à la place de ${u.username}`}
                    title={u.role === 'admin' ? "Impossible pour un administrateur" : 'Se mettre à sa place'}
                  >
                    <FiEye aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-ghost px-2" onClick={() => setFormFor(u)} aria-label={`Modifier ${u.username}`} title="Modifier">
                    <FiEdit2 aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    onClick={() => resetPassword(u)}
                    aria-label={`Réinitialiser le mot de passe de ${u.username}`}
                    title="Réinitialiser le mot de passe"
                  >
                    <FiKey aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    onClick={() => resetMfa(u)}
                    disabled={!u.mfa_enabled}
                    aria-label={`Réinitialiser la double authentification de ${u.username}`}
                    title={u.mfa_enabled ? 'Réinitialiser la double authentification' : 'Double authentification pas encore configurée'}
                  >
                    <FiShieldOff aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 hover:text-danger"
                    onClick={() => remove(u)}
                    disabled={u.id === me.id}
                    aria-label={`Supprimer ${u.username}`}
                    title={u.id === me.id ? 'Vous ne pouvez pas supprimer votre propre compte' : 'Supprimer'}
                  >
                    <FiTrash2 aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {log.length > 0 && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink-soft">Journal des prises de contrôle ({log.length})</summary>
          <ul className="mt-2 space-y-1 text-ink-soft">
            {log.map((l) => (
              <li key={l.id}>
                {formatDateTime(l.started_at)} : {l.admin} à la place de {l.target}
                {l.ended_at ? `, jusqu'à ${formatDateTime(l.ended_at)}` : ', sans retour explicite (expire après 1 h)'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiEdit2, FiPlus, FiSearch, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { plural } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { Avatar } from '../../components/Badges';
import { EmptyState, ErrorState, Field, Spinner } from '../../components/ui';

function GroupForm({ initial, users, onCancel, onSaved }) {
  const editing = Boolean(initial.id);
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [members, setMembers] = useState(() => new Set((initial.members || []).map((m) => m.id)));
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.name} ${u.username}`.toLowerCase().includes(q));
  }, [users, filter]);

  const toggle = (id) =>
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name, description, members: [...members] };
      await api(editing ? `/api/groups/${initial.id}` : '/api/groups', { method: editing ? 'PATCH' : 'POST', body });
      toast(editing ? 'Groupe modifié' : 'Groupe créé');
      onSaved();
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="border-b border-line bg-paper/60 p-5" noValidate>
      <h3 className="mb-4 font-bold">{editing ? `Modifier ${initial.name}` : 'Nouveau groupe'}</h3>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Field id="g-name" label="Nom" required error={errors.name} hint="Par exemple : Support informatique, Services généraux.">
            {(p) => (
              <input
                {...p}
                className="field"
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((er) => ({ ...er, name: undefined }));
                }}
                autoFocus
              />
            )}
          </Field>
          <Field id="g-description" label="Description" error={errors.description} hint="Ce que traite ce groupe.">
            {(p) => (
              <textarea
                {...p}
                rows={3}
                className="field"
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset>
          <legend className="label">
            Membres <span className="font-normal text-ink-mute">({members.size} sélectionné{members.size > 1 ? 's' : ''})</span>
          </legend>
          <label className="relative mb-2 block">
            <span className="sr-only">Filtrer les comptes</span>
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
            <input
              type="search"
              className="field pl-9"
              placeholder="Filtrer par nom"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line bg-white">
            {shown.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-paper">
                  <input type="checkbox" className="size-4" checked={members.has(u.id)} onChange={() => toggle(u.id)} />
                  <Avatar user={u} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{u.name}</span>
                    <span className="block truncate text-xs text-ink-mute">{u.username}</span>
                  </span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-ink-mute">Aucun compte ne correspond.</li>}
          </ul>
          {errors.members && <p className="mt-1 text-sm text-danger">{errors.members}</p>}
        </fieldset>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer le groupe'}
        </button>
      </div>
    </form>
  );
}

function MemberList({ members }) {
  if (!members.length) return <span className="text-ink-mute">Aucun membre</span>;
  const first = members.slice(0, 4);
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-1">
        {first.map((m) => (
          <span key={m.id} className="rounded-full ring-2 ring-white" title={m.name}>
            <Avatar user={m} />
          </span>
        ))}
      </span>
      <span className="text-ink-soft">{plural(members.length, 'membre', 'membres')}</span>
    </span>
  );
}

export default function GroupsPanel() {
  const [groups, setGroups] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [formFor, setFormFor] = useState(null); // null, {} (création) ou un groupe

  const load = useCallback(() => {
    setError(null);
    return Promise.all([api('/api/groups'), api('/api/users')])
      .then(([g, u]) => {
        setGroups(g);
        setUsers(u);
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (g) => {
    const ok = await confirmAction({
      title: `Supprimer le groupe ${g.name} ?`,
      text:
        g.active_count > 0
          ? `Ses ${plural(g.active_count, 'ticket actif', 'tickets actifs')} resteront, sans groupe d'affectation.`
          : 'Ses tickets restent, sans groupe d’affectation.',
      confirmText: 'Supprimer le groupe',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/groups/${g.id}`, { method: 'DELETE' });
      toast('Groupe supprimé');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!groups) return <Spinner />;

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="max-w-xl text-sm text-ink-mute">
          Un ticket affecté à un groupe est visible et traitable par tous ses membres. Seul un membre du groupe peut en être
          responsable.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setFormFor({})}>
          <FiPlus aria-hidden="true" /> Nouveau groupe
        </button>
      </div>

      {formFor && (
        <GroupForm
          key={formFor.id || 'new'}
          initial={formFor}
          users={users}
          onCancel={() => setFormFor(null)}
          onSaved={() => {
            setFormFor(null);
            load();
          }}
        />
      )}

      {groups.length === 0 ? (
        !formFor && (
          <EmptyState
            title="Aucun groupe pour l'instant"
            action={
              <button type="button" className="btn btn-secondary" onClick={() => setFormFor({})}>
                Créer le premier groupe
              </button>
            }
          >
            Créez une équipe par type de demande, par exemple Support informatique ou Services généraux.
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs font-semibold text-ink-mute">
              <tr>
                <th scope="col" className="px-5 py-2.5">Groupe</th>
                <th scope="col" className="px-5 py-2.5">Membres</th>
                <th scope="col" className="px-5 py-2.5 text-right">Tickets actifs</th>
                <th scope="col" className="px-5 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="max-w-md px-5 py-3">
                    <span className="block font-semibold">{g.name}</span>
                    {g.description && <span className="block text-xs text-ink-mute">{g.description}</span>}
                  </td>
                  <td className="px-5 py-3">
                    <MemberList members={g.members} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {g.active_count > 0 ? (
                      <Link to={`/tickets?group=${g.id}`} className="font-semibold text-accent hover:underline">
                        {g.active_count}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <button
                      type="button"
                      className="btn btn-ghost px-2"
                      onClick={() => setFormFor(g)}
                      aria-label={`Modifier le groupe ${g.name}`}
                      title="Modifier"
                    >
                      <FiEdit2 aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 hover:text-danger"
                      onClick={() => remove(g)}
                      aria-label={`Supprimer le groupe ${g.name}`}
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
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { api } from '../lib/api';
import { ACTIVE_CATEGORY_KEYS, CATEGORIES, PRIORITIES, PRIORITY_ORDER } from '../lib/constants';
import { todayIso } from '../lib/format';
import { toast, toastError } from '../lib/notify';
import { PriorityBadge } from '../components/Badges';
import FileDrop from '../components/FileDrop';
import ConfidentialOption from '../components/ConfidentialOption';
import { Field, PageHeader } from '../components/ui';

export default function CreateTicket() {
  const { isAdmin, canCreate } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    category: '',
    due_date: '',
    assigned_to: '',
    assigned_group: '',
    confidential: false,
  });
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [catalogSize, setCatalogSize] = useState(0);

  useEffect(() => {
    if (isAdmin) api('/api/users').then(setUsers).catch(() => {});
    api('/api/groups').then(setGroups).catch(() => {});
    api('/api/catalog')
      .then((items) => setCatalogSize(items.length))
      .catch(() => {});
  }, [isAdmin]);

  const chosenGroup = groups.find((g) => String(g.id) === form.assigned_group);
  // Un ticket affecté à un groupe ne peut avoir pour responsable qu'un de ses membres.
  const assignees = chosenGroup ? chosenGroup.members : users;
  const changeGroup = (value) => {
    const group = groups.find((g) => String(g.id) === value);
    setForm((f) => ({
      ...f,
      assigned_group: value,
      assigned_to: group && f.assigned_to && !group.members.some((m) => String(m.id) === f.assigned_to) ? '' : f.assigned_to,
    }));
  };

  const update = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = 'Donnez un titre court qui résume la demande.';
    if (!form.description.trim()) e.description = 'Décrivez la demande : contexte, ce qui est attendu, ce qui a été essayé.';
    return e;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const local = validate();
    if (Object.keys(local).length) {
      setErrors(local);
      document.getElementById(`ticket-${Object.keys(local)[0]}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        ...form,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
        assigned_group: form.assigned_group ? Number(form.assigned_group) : null,
      };
      if (!isAdmin) delete body.assigned_to;
      const ticket = await api('/api/tickets', { method: 'POST', body });

      if (files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        try {
          await api(`/api/tickets/${ticket.id}/attachments`, { method: 'POST', body: fd });
        } catch (err) {
          toastError({ message: `Ticket créé, mais les fichiers n'ont pas été envoyés : ${err.message}` });
          navigate(`/tickets/${ticket.id}`);
          return;
        }
      }
      toast('Ticket créé');
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
      setSubmitting(false);
    }
  };

  if (!canCreate) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-bold">Création de ticket non autorisée</h1>
        <p className="text-ink-mute">Votre compte ne peut pas créer de demande. Adressez-vous à un administrateur.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Nouveau ticket">Décrivez la demande ; vous pourrez compléter et échanger ensuite.</PageHeader>
      {catalogSize > 0 && (
        <p className="mb-5 rounded-md bg-accent-soft/60 px-4 py-2.5 text-sm">
          Un formulaire existe peut-être pour votre demande :{' '}
          <Link to="/catalogue" className="font-semibold text-accent-strong hover:underline">
            voir le catalogue
          </Link>
          .
        </p>
      )}

      <form onSubmit={handleSubmit} className="panel space-y-5 p-5 sm:p-6" noValidate>
        <Field id="ticket-title" label="Titre" required error={errors.title}>
          {(props) => (
            <input
              {...props}
              className="field"
              maxLength={200}
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="Ex. : impossible d'imprimer depuis le 2e étage"
              autoFocus
            />
          )}
        </Field>

        <Field id="ticket-description" label="Description" required error={errors.description}>
          {(props) => (
            <textarea
              {...props}
              className="field min-h-40 resize-y"
              maxLength={10000}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          )}
        </Field>

        <fieldset>
          <legend className="label">Priorité</legend>
          <div className="grid grid-cols-3 gap-2">
            {PRIORITY_ORDER.slice()
              .reverse()
              .map((p) => (
                <label
                  key={p}
                  className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                    form.priority === p ? 'border-accent bg-accent-soft' : 'border-line-strong bg-white hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={p}
                    checked={form.priority === p}
                    onChange={() => update('priority', p)}
                    className="sr-only"
                  />
                  <PriorityBadge priority={p} />
                </label>
              ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="ticket-category" label="Catégorie" error={errors.category}>
            {(props) => (
              <select {...props} className="field" value={form.category} onChange={(e) => update('category', e.target.value)}>
                <option value="">Aucune</option>
                {ACTIVE_CATEGORY_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {CATEGORIES[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="ticket-due"
            label="Date limite souhaitée"
            error={errors.due_date}
            hint={
              PRIORITIES[form.priority]?.days != null && !form.due_date
                ? `Vide : dans ${PRIORITIES[form.priority].days} jour${PRIORITIES[form.priority].days > 1 ? 's' : ''} (priorité ${PRIORITIES[form.priority].label.toLowerCase()}).`
                : undefined
            }
          >
            {(props) => (
              <input
                {...props}
                type="date"
                className="field"
                min={todayIso()}
                value={form.due_date}
                onChange={(e) => update('due_date', e.target.value)}
              />
            )}
          </Field>
        </div>

        {(groups.length > 0 || isAdmin) && (
          <div className="grid gap-5 sm:grid-cols-2">
            {groups.length > 0 && (
              <Field
                id="ticket-group"
                label="Groupe d'affectation"
                error={errors.assigned_group}
                hint="L'équipe qui traitera la demande ; ses membres verront le ticket."
              >
                {(props) => (
                  <select {...props} className="field" value={form.assigned_group} onChange={(e) => changeGroup(e.target.value)}>
                    <option value="">Aucun groupe</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            {isAdmin && (
              <Field id="ticket-assignee" label="Responsable" error={errors.assigned_to} hint="Vous pourrez aussi l'assigner plus tard.">
                {(props) => (
                  <select {...props} className="field" value={form.assigned_to} onChange={(e) => update('assigned_to', e.target.value)}>
                    <option value="">Personne pour l'instant</option>
                    {assignees.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.username})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
        )}

        <ConfidentialOption checked={form.confidential} onChange={(v) => update('confidential', v)} />

        <div>
          <p className="label">Pièces jointes</p>
          <FileDrop files={files} onChange={setFiles} />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
          <Link to="/tickets" className="btn btn-secondary">
            Annuler
          </Link>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Création…' : 'Créer le ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { FiEdit2 } from 'react-icons/fi';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { toast, toastError } from '../lib/notify';
import CustomFieldInput from './CustomFieldInput';

const shown = (f) => {
  if (f.value == null || f.value === '') return <span className="text-ink-mute">Non renseigné</span>;
  if (f.type === 'date') return formatDate(f.value);
  if (f.type === 'number') return String(f.value).replace('.', ',');
  return f.display ?? f.value;
};

/**
 * Champs personnalisés de la demande (dictionnaire de la table) : lecture pour tous ceux qui voient
 * la demande, modification selon le droit de chaque champ.
 */
export default function TicketFieldsPanel({ ticket, onSaved }) {
  const fields = ticket.fields || [];
  const writable = fields.filter((f) => f.canWrite);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({});
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing && writable.some((f) => f.type === 'group') && !groups.length) {
      api('/api/ticket-fields')
        .then((r) => setGroups(r.groups))
        .catch(() => {});
    }
  }, [editing, writable, groups.length]);

  if (!fields.length) return null;

  const start = () => {
    setValues(Object.fromEntries(writable.map((f) => [f.name, f.value ?? ''])));
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const changed = Object.fromEntries(writable.filter((f) => (f.value ?? '') !== values[f.name]).map((f) => [f.name, values[f.name] === '' ? null : values[f.name]]));
    if (!Object.keys(changed).length) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api(`/api/tickets/${ticket.id}/fields`, { method: 'PATCH', body: { values: changed } });
      toast('Informations enregistrées');
      setEditing(false);
      onSaved(updated);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="fields-title">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="fields-title" className="font-bold">
          Informations complémentaires
        </h2>
        {writable.length > 0 && !editing && (
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={start}>
            <FiEdit2 aria-hidden="true" /> Modifier
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="space-y-4 px-5 py-4">
          {fields.map((f) =>
            f.canWrite ? (
              <div key={f.name}>
                <label htmlFor={`cf-${f.name}`} className="label">
                  {f.label}
                </label>
                <CustomFieldInput id={`cf-${f.name}`} field={f} groups={groups} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
                {f.help && <p className="mt-1 text-xs text-ink-mute">{f.help}</p>}
              </div>
            ) : (
              <div key={f.name}>
                <p className="label">{f.label}</p>
                <p className="text-sm">{shown(f)}</p>
              </div>
            )
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      ) : (
        <dl className="divide-y divide-line">
          {fields.map((f) => (
            <div key={f.name} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4">
              <dt className="text-sm font-semibold text-ink-mute" title={f.help || undefined}>
                {f.label}
              </dt>
              <dd className="whitespace-pre-wrap break-words text-ink">{shown(f)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

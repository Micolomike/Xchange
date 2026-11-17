import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiArrowDown, FiArrowUp, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { plural } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import Modal from '../../components/Modal';
import { ErrorState, Field, Spinner } from '../../components/ui';

const SYSTEM_TYPES = {
  integer: 'Numéro',
  text: 'Texte court',
  textarea: 'Texte long',
  choice: 'Liste de choix',
  date: 'Date',
  datetime: 'Date et heure',
  yesno: 'Oui / Non',
  user: 'Référence : utilisateur',
  group: 'Référence : groupe',
  reference: 'Référence : formulaire',
};

// Même règle que le serveur : « u_ » puis le libellé sans accents.
const suggestName = (label) =>
  `u_${
    String(label || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 37) || 'champ'
  }`;

function Producers({ list }) {
  if (!list?.length) return <span className="text-ink-mute">-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((p) => (
        <Link key={p.id} to={`/admin/catalogue/${p.id}`} className="rounded bg-paper px-1.5 py-0.5 text-xs font-semibold text-accent-strong hover:underline">
          {p.name}
        </Link>
      ))}
    </span>
  );
}

function FieldDialog({ open, onClose, field, meta, onSaved }) {
  const creating = !field?.id;
  const [v, setV] = useState({});
  const [nameTouched, setNameTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setNameTouched(false);
    setV(
      field?.id
        ? { label: field.label, help: field.help, write: field.write, active: field.active, options: field.options.join('\n') }
        : { label: '', name: '', type: 'text', help: '', write: 'handlers', active: true, options: 'Choix 1\nChoix 2' }
    );
  }, [open, field]);

  const set = (patch) => {
    setV((x) => ({ ...x, ...patch }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  };

  const save = async () => {
    setSaving(true);
    const options = (v.options || '')
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    const body = creating
      ? { label: v.label, name: v.name || suggestName(v.label), type: v.type, help: v.help, write: v.write, active: v.active, options }
      : { label: v.label, help: v.help, write: v.write, active: v.active, ...(field.type === 'select' ? { options } : {}) };
    try {
      await api(creating ? '/api/admin/ticket-fields' : `/api/admin/ticket-fields/${field.id}`, { method: creating ? 'POST' : 'PATCH', body });
      toast(creating ? 'Champ créé' : 'Champ enregistré');
      onSaved();
      onClose();
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const type = creating ? v.type : field?.type;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? 'Nouveau champ de la table des demandes' : `Modifier « ${field?.label} »`}
      labelId="tf-dialog-title"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : creating ? 'Créer le champ' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="tf-label" label="Libellé" required error={errors.label}>
          {(p) => (
            <input
              {...p}
              className="field"
              maxLength={80}
              value={v.label || ''}
              onChange={(e) => set({ label: e.target.value, ...(creating && !nameTouched ? { name: suggestName(e.target.value) } : {}) })}
            />
          )}
        </Field>
        {creating ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tf-name" label="Nom technique" error={errors.name} hint="Ne change plus après la création. Sert dans les rapports.">
              {(p) => (
                <input
                  {...p}
                  className="field font-mono text-sm"
                  maxLength={40}
                  value={v.name || ''}
                  onChange={(e) => {
                    setNameTouched(true);
                    set({ name: e.target.value });
                  }}
                />
              )}
            </Field>
            <Field id="tf-type" label="Type" error={errors.type} hint="Ne change plus après la création.">
              {(p) => (
                <select {...p} className="field" value={v.type} onChange={(e) => set({ type: e.target.value })}>
                  {Object.entries(meta.types).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ) : (
          <p className="text-sm text-ink-mute">
            Nom technique <code className="font-mono">{field?.name}</code>, type {meta.types[field?.type]?.toLowerCase()}.
          </p>
        )}
        {type === 'select' && (
          <Field id="tf-options" label="Choix" error={errors.options} hint="Un choix par ligne.">
            {(p) => <textarea {...p} className="field" rows={5} value={v.options || ''} onChange={(e) => set({ options: e.target.value })} />}
          </Field>
        )}
        <Field id="tf-help" label="Aide" error={errors.help} hint="Affichée au survol du libellé et sous le champ en modification (facultatif).">
          {(p) => <input {...p} className="field" maxLength={300} value={v.help || ''} onChange={(e) => set({ help: e.target.value })} />}
        </Field>
        <Field id="tf-write" label="Qui peut le modifier sur une demande ?" error={errors.write}>
          {(p) => (
            <select {...p} className="field" value={v.write} onChange={(e) => set({ write: e.target.value })}>
              {Object.entries(meta.writeAccess).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="text-xs text-ink-mute">Toute personne qui voit la demande voit aussi ce champ.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={Boolean(v.active)} onChange={(e) => set({ active: e.target.checked })} />
          Actif (affiché sur les demandes, proposé aux formulaires et aux rapports)
        </label>
      </div>
    </Modal>
  );
}

/** Dictionnaire de la table des demandes : champs système et champs personnalisés. */
export default function TicketFieldsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api('/api/admin/ticket-fields').then(setData).catch(setError);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const move = async (index, delta) => {
    const ids = data.custom.map((f) => f.id);
    const [m] = ids.splice(index, 1);
    ids.splice(index + delta, 0, m);
    try {
      await api('/api/admin/ticket-fields/reorder', { method: 'POST', body: { ids } });
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const remove = async (f) => {
    const ok = await confirmAction({
      title: `Supprimer le champ « ${f.label} » ?`,
      text: f.valueCount
        ? `Les valeurs déjà saisies sur ${plural(f.valueCount, 'demande', 'demandes')} seront effacées, et les rapports qui l'utilisent perdront cette colonne. Pour le masquer sans rien perdre, désactivez-le plutôt.`
        : 'Aucune demande ne l’a encore renseigné. Cette action est définitive.',
      confirmText: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/ticket-fields/${f.id}`, { method: 'DELETE' });
      toast('Champ supprimé');
      load();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="space-y-6">
      <section className="panel" aria-labelledby="tf-custom">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h3 id="tf-custom" className="font-bold">
              Champs personnalisés
            </h3>
            <p className="max-w-2xl text-sm text-ink-mute">
              Ajoutés à chaque demande : affichés dans « Informations complémentaires », alimentés par les variables des formulaires ou par une valeur fixée, et
              disponibles dans les rapports (colonne, regroupement, filtre).
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})} disabled={data.custom.length >= data.max}>
            <FiPlus aria-hidden="true" /> Nouveau champ
          </button>
        </div>
        {data.custom.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-mute">Aucun champ personnalisé pour l’instant. Par exemple : Matériel prêté, Quantité, Référent.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-mute">
                <tr>
                  <th scope="col" className="px-4 py-2">Libellé</th>
                  <th scope="col" className="px-4 py-2">Nom technique</th>
                  <th scope="col" className="px-4 py-2">Type</th>
                  <th scope="col" className="px-4 py-2">Modifiable par</th>
                  <th scope="col" className="px-4 py-2 text-right">Demandes</th>
                  <th scope="col" className="px-4 py-2">Formulaires</th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.custom.map((f, i) => (
                  <tr key={f.id} className={f.active ? '' : 'text-ink-mute'}>
                    <td className="px-4 py-2 font-semibold">
                      {f.label}
                      {!f.active && <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-xs font-normal">désactivé</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{f.name}</td>
                    <td className="px-4 py-2">
                      {data.types[f.type]}
                      {f.type === 'select' && <span className="block text-xs text-ink-mute">{f.options.join(', ')}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs">{f.write === 'admins' ? 'Administrateurs' : f.write === 'editors' ? 'Auteur et éditeurs' : 'Personnes qui traitent'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.valueCount}</td>
                    <td className="px-4 py-2">
                      <Producers list={f.producers} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <button type="button" className="btn btn-ghost px-2" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${f.label}`} title="Monter">
                        <FiArrowUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-2"
                        disabled={i === data.custom.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Descendre ${f.label}`}
                        title="Descendre"
                      >
                        <FiArrowDown aria-hidden="true" />
                      </button>
                      <button type="button" className="btn btn-ghost px-2" onClick={() => setEditing(f)} aria-label={`Modifier ${f.label}`} title="Modifier">
                        <FiEdit2 aria-hidden="true" />
                      </button>
                      <button type="button" className="btn btn-ghost px-2 hover:text-danger" onClick={() => remove(f)} aria-label={`Supprimer ${f.label}`} title="Supprimer">
                        <FiTrash2 aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="tf-system">
        <div className="border-b border-line px-5 py-3">
          <h3 id="tf-system" className="font-bold">
            Champs système
          </h3>
          <p className="text-sm text-ink-mute">Les colonnes de base d’une demande, non modifiables. Certaines peuvent être alimentées par une variable de formulaire.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-mute">
              <tr>
                <th scope="col" className="px-4 py-2">Libellé</th>
                <th scope="col" className="px-4 py-2">Nom technique</th>
                <th scope="col" className="px-4 py-2">Type</th>
                <th scope="col" className="px-4 py-2">Alimentable par une variable</th>
                <th scope="col" className="px-4 py-2">Formulaires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.system.map((f) => (
                <tr key={f.name}>
                  <td className="px-4 py-2 font-semibold">{f.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{f.name}</td>
                  <td className="px-4 py-2">{SYSTEM_TYPES[f.type] || f.type}</td>
                  <td className="px-4 py-2 text-xs">
                    {f.map ? 'Oui' : 'Non'}
                    {f.note && <span className="block text-ink-mute">{f.note}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Producers list={f.producers} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <FieldDialog open={Boolean(editing)} onClose={() => setEditing(null)} field={editing} meta={data} onSaved={load} />
    </div>
  );
}

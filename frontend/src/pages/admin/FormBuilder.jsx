import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowDown, FiArrowLeft, FiArrowUp, FiPlus, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { ACTIVE_CATEGORY_KEYS, CATEGORIES, PRIORITIES, PRIORITY_ORDER } from '../../lib/constants';
import { toast, toastError } from '../../lib/notify';
import { CHOICE_TYPES, CONDITION_OPS, FIELD_TYPES, YES_NO, needsValue, newKey, opsFor } from '../../catalog/fields';
import FormRenderer from '../../catalog/FormRenderer';
import { ErrorState, Field, Spinner } from '../../components/ui';
import CustomFieldInput from '../../components/CustomFieldInput';

const EMPTY_ITEM = {
  name: '',
  description: '',
  section: '',
  priority: 'medium',
  category: '',
  active: true,
  fulfillment_group: '',
  visible_groups: [],
  fields: [],
  field_values: {},
};

/** Nom technique d'une variable tiré de son libellé : « Date de retour » → date_de_retour. */
const keyFromLabel = (label) =>
  String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/** Champs de la demande qu'une variable de ce type peut alimenter. */
function targetsFor(type, dict) {
  if (!dict) return [];
  const sys = dict.system.filter((f) => f.map && dict.compatible[f.name]?.includes(type)).map((f) => ({ name: f.name, label: f.label, note: f.note, system: true }));
  const custom = dict.custom
    .filter((f) => f.active && dict.compatible[`custom:${f.type}`]?.includes(type))
    .map((f) => ({ name: f.name, label: f.label, note: f.type === 'select' ? `Choix du champ : ${f.options.join(', ')}.` : null }));
  return [...sys, ...custom];
}

const cleanOptions = (options) => (options || []).map((o) => o.trim()).filter(Boolean);

/** Définition envoyée au serveur, et utilisée par l'aperçu. */
function normalizeFields(fields) {
  return fields.map((f) => {
    const { uid: _u, keyTouched: _k, ...out } = f;
    if (!out.mapTo) delete out.mapTo;
    if (CHOICE_TYPES.includes(f.type)) out.options = cleanOptions(f.options);
    else if (f.type === 'yesno') out.options = YES_NO;
    else delete out.options;
    if (!f.condition?.field) delete out.condition;
    return out;
  });
}

function TypePicker({ onPick, onCancel }) {
  return (
    <div className="rounded-lg border border-accent bg-accent-soft/40 p-3">
      <p className="mb-2 text-sm font-semibold">Type de la nouvelle variable</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(FIELD_TYPES).map(([type, t]) => (
          <button
            key={type}
            type="button"
            className="rounded-md border border-line-strong bg-surface px-3 py-2 text-left hover:border-accent"
            onClick={() => onPick(type)}
          >
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className="block text-xs text-ink-mute">{t.hint}</span>
          </button>
        ))}
      </div>
      <button type="button" className="mt-2 text-sm text-ink-mute hover:text-ink hover:underline" onClick={onCancel}>
        Annuler
      </button>
    </div>
  );
}

function FieldEditor({ field, index, count, previous, onChange, onMove, onRemove, dict, usedTargets, keyEditable }) {
  const id = `fb-${field.uid || field.key}`;
  const set = (patch) => onChange({ ...field, ...patch });
  const targets = targetsFor(field.type, dict);
  const source = previous.find((p) => p.key === field.condition?.field);
  const sourceOptions = !source
    ? null
    : source.type === 'yesno'
      ? YES_NO
      : CHOICE_TYPES.includes(source.type)
        ? cleanOptions(source.options)
        : null;

  const setCondition = (patch) => {
    const next = { ...(field.condition || {}), ...patch };
    if (patch.field) {
      const src = previous.find((p) => p.key === patch.field);
      next.op = opsFor(src?.type)[0];
      next.value = '';
    }
    set({ condition: next });
  };

  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper/70 px-4 py-2">
        <span className="text-sm font-bold">Variable {index + 1}</span>
        <span className="text-sm text-ink-mute">{FIELD_TYPES[field.type].label}</span>
        <code className="font-mono text-xs text-ink-mute" title="Nom technique">
          {field.key}
        </code>
        <span className="ml-auto flex">
          <button
            type="button"
            className="btn btn-ghost px-2 py-1"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Monter la question ${index + 1}`}
            title="Monter"
          >
            <FiArrowUp aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2 py-1"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`Descendre la question ${index + 1}`}
            title="Descendre"
          >
            <FiArrowDown aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2 py-1 hover:text-danger"
            onClick={onRemove}
            aria-label={`Supprimer la question ${index + 1}`}
            title="Supprimer"
          >
            <FiTrash2 aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field id={`${id}-label`} label="Libellé" required>
            {(p) => (
              <input
                {...p}
                className="field"
                value={field.label}
                maxLength={200}
                onChange={(e) => set({ label: e.target.value, ...(keyEditable && !field.keyTouched ? { key: keyFromLabel(e.target.value) || field.key } : {}) })}
              />
            )}
          </Field>
          <Field id={`${id}-type`} label="Type">
            {(p) => (
              <select
                {...p}
                className="field"
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value;
                  set({
                    type,
                    options: CHOICE_TYPES.includes(type) ? field.options || ['Choix 1', 'Choix 2'] : undefined,
                    mapTo: targetsFor(type, dict).some((t) => t.name === field.mapTo) ? field.mapTo : '',
                  });
                }}
              >
                {Object.entries(FIELD_TYPES).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${id}-map`}
            label="Alimente le champ de la demande"
            hint={
              targets.find((t) => t.name === field.mapTo)?.note ||
              (targets.length ? 'La réponse est recopiée dans ce champ, reportable pour toutes les demandes.' : 'Aucun champ ne peut recevoir ce type de réponse.')
            }
          >
            {(p) => (
              <select {...p} className="field" value={field.mapTo || ''} disabled={!targets.length} onChange={(e) => set({ mapTo: e.target.value })}>
                <option value="">Aucun (variable seulement)</option>
                {targets.some((t) => t.system) && (
                  <optgroup label="Champs système">
                    {targets
                      .filter((t) => t.system)
                      .map((t) => (
                        <option key={t.name} value={t.name} disabled={usedTargets.has(t.name) && field.mapTo !== t.name}>
                          {t.label}
                          {usedTargets.has(t.name) && field.mapTo !== t.name ? ' (déjà utilisé)' : ''}
                        </option>
                      ))}
                  </optgroup>
                )}
                {targets.some((t) => !t.system) && (
                  <optgroup label="Champs personnalisés">
                    {targets
                      .filter((t) => !t.system)
                      .map((t) => (
                        <option key={t.name} value={t.name} disabled={usedTargets.has(t.name) && field.mapTo !== t.name}>
                          {t.label} ({t.name}){usedTargets.has(t.name) && field.mapTo !== t.name ? ' (déjà utilisé)' : ''}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-key`}
            label="Nom technique"
            hint={keyEditable ? 'Tiré du libellé ; sert dans les rapports et les règles d’affichage.' : 'Ne change plus : des réponses y sont rattachées.'}
          >
            {(p) => (
              <input
                {...p}
                className="field font-mono text-sm"
                maxLength={40}
                value={field.key}
                readOnly={!keyEditable}
                onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'), keyTouched: true })}
              />
            )}
          </Field>
        </div>

        {CHOICE_TYPES.includes(field.type) && (
          <Field id={`${id}-options`} label="Choix proposés" hint="Un choix par ligne.">
            {(p) => (
              <textarea
                {...p}
                rows={Math.min(8, Math.max(3, (field.options || []).length + 1))}
                className="field"
                value={(field.options || []).join('\n')}
                onChange={(e) => set({ options: e.target.value.split('\n') })}
              />
            )}
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-help`} label="Aide" hint="Texte affiché sous la question (facultatif).">
            {(p) => <input {...p} className="field" value={field.help} maxLength={500} onChange={(e) => set({ help: e.target.value })} />}
          </Field>
          {['text', 'textarea', 'number', 'email'].includes(field.type) && (
            <Field id={`${id}-placeholder`} label="Exemple dans le champ" hint="Texte grisé avant la saisie (facultatif).">
              {(p) => (
                <input
                  {...p}
                  className="field"
                  value={field.placeholder}
                  maxLength={200}
                  onChange={(e) => set({ placeholder: e.target.value })}
                />
              )}
            </Field>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={field.required} onChange={(e) => set({ required: e.target.checked })} />
            Obligatoire
          </label>
          {previous.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={Boolean(field.condition)}
                onChange={(e) =>
                  set({
                    condition: e.target.checked
                      ? { field: previous.at(-1).key, op: opsFor(previous.at(-1).type)[0], value: '' }
                      : undefined,
                  })
                }
              />
              Afficher seulement si…
            </label>
          )}
        </div>

        {field.condition && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-paper px-3 py-2.5 text-sm">
            <span>Afficher si</span>
            <select
              className="field w-auto max-w-56 py-1"
              aria-label="Question dont dépend l'affichage"
              value={field.condition.field}
              onChange={(e) => setCondition({ field: e.target.value })}
            >
              {previous.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label || '(sans libellé)'}
                </option>
              ))}
            </select>
            <select
              className="field w-auto py-1"
              aria-label="Condition"
              value={field.condition.op}
              onChange={(e) => setCondition({ op: e.target.value })}
            >
              {opsFor(source?.type).map((op) => (
                <option key={op} value={op}>
                  {CONDITION_OPS[op]}
                </option>
              ))}
            </select>
            {needsValue(field.condition.op) &&
              (sourceOptions ? (
                <select
                  className="field w-auto max-w-56 py-1"
                  aria-label="Valeur attendue"
                  value={field.condition.value}
                  onChange={(e) => setCondition({ value: e.target.value })}
                >
                  <option value="">Choisir…</option>
                  {sourceOptions.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="field w-auto py-1"
                  aria-label="Valeur attendue"
                  value={field.condition.value}
                  onChange={(e) => setCondition({ value: e.target.value })}
                />
              ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** Valeurs fixées : écrites dans les champs personnalisés de chaque demande créée (comme un modèle). */
function FixedValues({ dict, groups, values, mapped, onChange }) {
  const fields = dict.custom.filter((f) => f.active);
  return (
    <section className="panel p-5" aria-labelledby="fb-fixed">
      <h2 id="fb-fixed" className="font-bold">
        Valeurs fixées des champs
      </h2>
      <p className="mb-4 text-sm text-ink-mute">
        Écrites dans chaque demande créée par ce formulaire. Une variable associée au même champ les remplace quand elle est remplie.
      </p>
      {fields.length === 0 ? (
        <p className="text-sm text-ink-mute">
          Aucun champ personnalisé. Créez-en dans{' '}
          <Link to="/admin?tab=catalog&section=fields" className="font-semibold text-accent-strong hover:underline">
            la table des champs
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={`fv-${f.name}`} className="label">
                {f.label} <code className="font-mono text-xs font-normal text-ink-mute">{f.name}</code>
              </label>
              <CustomFieldInput
                id={`fv-${f.name}`}
                field={f}
                groups={groups}
                value={values[f.name] ?? ''}
                onChange={(v) => onChange({ ...values, [f.name]: v })}
              />
              {mapped.has(f.name) && <p className="mt-1 text-xs text-ink-mute">Aussi alimenté par une variable : valeur par défaut si elle reste vide.</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Ce que crée le formulaire : pour chaque champ de la demande, d'où vient sa valeur. */
function MappingSummary({ item, dict, groups }) {
  const byTarget = new Map(item.fields.filter((f) => f.mapTo).map((f) => [f.mapTo, f]));
  const variable = (name) => byTarget.get(name) && `Variable « ${byTarget.get(name).label || 'sans libellé'} »`;
  const groupName = groups.find((g) => String(g.id) === String(item.fulfillment_group))?.name;
  const rows = [
    ['Titre', byTarget.get('title') ? `« ${item.name || 'Nom du formulaire'} : » puis la réponse à « ${byTarget.get('title').label || 'sans libellé'} »` : `Nom du formulaire : « ${item.name || '…'} »`],
    ['Description', `${byTarget.get('description') ? `${variable('description')}, puis ` : ''}récapitulatif de toutes les réponses`],
    ['Priorité', variable('priority') || `Fixée : ${PRIORITIES[item.priority]?.label || item.priority}`],
    ['Catégorie', variable('category') || (item.category ? `Fixée : ${CATEGORIES[item.category] || item.category}` : 'Aucune')],
    ["Groupe d'affectation", groupName ? `Fixé : ${groupName}` : 'Aucun (administrateurs)'],
    ['Échéance', variable('due_date') || 'Selon la priorité (Paramètres)'],
    ['Confidentielle', variable('confidential') || 'Au choix du demandeur'],
    ...dict.custom
      .filter((f) => f.active && (byTarget.has(f.name) || (item.field_values?.[f.name] ?? '') !== ''))
      .map((f) => [
        f.label,
        [variable(f.name), (item.field_values?.[f.name] ?? '') !== '' ? (byTarget.has(f.name) ? 'sinon valeur fixée' : 'Valeur fixée') : null].filter(Boolean).join(', '),
      ]),
  ];
  return (
    <section className="panel p-5" aria-labelledby="fb-summary">
      <h2 id="fb-summary" className="font-bold">
        Ce que crée ce formulaire
      </h2>
      <p className="mb-3 text-sm text-ink-mute">Une demande, remplie ainsi. Les variables sans champ associé restent dans la table des variables.</p>
      <table className="w-full text-left text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Champ de la demande</th>
            <th scope="col">Valeur</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([field, source]) => (
            <tr key={field}>
              <th scope="row" className="w-48 py-1.5 pr-3 align-top font-semibold text-ink-mute">
                {field}
              </th>
              <td className="py-1.5">{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function FormBuilder() {
  const { id } = useParams();
  const isNew = id === 'nouveau';
  const navigate = useNavigate();
  const [item, setItem] = useState(isNew ? EMPTY_ITEM : null);
  const [groups, setGroups] = useState([]);
  const [sections, setSections] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState({});
  const [dict, setDict] = useState(null);
  const [savedKeys, setSavedKeys] = useState(new Set());

  useEffect(() => {
    api('/api/groups').then(setGroups).catch(() => {});
    api('/api/admin/ticket-fields').then(setDict).catch(() => {});
    api('/api/admin/catalog')
      .then((list) => setSections([...new Set(list.map((i) => i.section).filter(Boolean))]))
      .catch(() => {});
    if (isNew) return;
    api(`/api/admin/catalog/${id}`)
      .then((data) => {
        setSavedKeys(new Set(data.fields.map((f) => f.key)));
        setItem({
          ...data,
          fulfillment_group: data.fulfillment_group?.id ? String(data.fulfillment_group.id) : '',
          visible_groups: data.visible_groups.map((g) => g.id),
          field_values: data.field_values || {},
          fields: data.fields.map((f) => ({ help: '', placeholder: '', required: false, ...f, uid: newKey() })),
        });
      })
      .catch(setLoadError);
  }, [id, isNew]);

  const previewFields = useMemo(() => (item ? normalizeFields(item.fields) : []), [item]);

  if (loadError) return <ErrorState error={loadError} />;
  if (!item) return <Spinner />;

  const set = (patch) => {
    setItem((it) => ({ ...it, ...patch }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  };
  const setFields = (fields) => set({ fields });

  const addField = (type) => {
    setFields([
      ...item.fields,
      {
        key: newKey(),
        label: '',
        type,
        required: false,
        help: '',
        placeholder: '',
        uid: newKey(),
        ...(CHOICE_TYPES.includes(type) ? { options: ['Choix 1', 'Choix 2'] } : {}),
      },
    ]);
    setPicking(false);
  };

  const updateField = (index, next) => {
    const prev = item.fields[index];
    let fixed = next;
    if (next.key !== prev.key) {
      // Nom technique unique dans le formulaire ; les règles d'affichage suivent le changement.
      const others = new Set(item.fields.filter((_, i) => i !== index).map((f) => f.key));
      let key = next.key || prev.key;
      for (let n = 2; others.has(key); n += 1) key = `${(next.key || prev.key).slice(0, 36)}_${n}`;
      fixed = { ...next, key };
    }
    setFields(
      item.fields.map((f, i) =>
        i === index ? fixed : f.condition?.field === prev.key && fixed.key !== prev.key ? { ...f, condition: { ...f.condition, field: fixed.key } } : f
      )
    );
  };

  // Une règle ne peut porter que sur une question placée avant : on retire celles qui deviennent impossibles.
  const dropBrokenConditions = (fields) =>
    fields.map((f, i) =>
      f.condition && !fields.slice(0, i).some((p) => p.key === f.condition.field) ? { ...f, condition: undefined } : f
    );

  const moveField = (index, delta) => {
    const fields = [...item.fields];
    const [moved] = fields.splice(index, 1);
    fields.splice(index + delta, 0, moved);
    setFields(dropBrokenConditions(fields));
  };

  const removeField = (index) => setFields(dropBrokenConditions(item.fields.filter((_, i) => i !== index)));

  const toggleVisible = (gid) =>
    set({
      visible_groups: item.visible_groups.includes(gid)
        ? item.visible_groups.filter((g) => g !== gid)
        : [...item.visible_groups, gid],
    });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: item.name,
      description: item.description,
      section: item.section,
      priority: item.priority,
      category: item.category || '',
      active: item.active,
      fulfillment_group: item.fulfillment_group ? Number(item.fulfillment_group) : null,
      visible_groups: item.visible_groups,
      fields: normalizeFields(item.fields),
      field_values: Object.fromEntries(Object.entries(item.field_values || {}).filter(([, v]) => v !== '' && v != null)),
    };
    try {
      await api(isNew ? '/api/admin/catalog' : `/api/admin/catalog/${id}`, { method: isNew ? 'POST' : 'PATCH', body });
      toast(isNew ? 'Formulaire créé' : 'Formulaire enregistré');
      navigate('/admin?tab=catalog');
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
      setSaving(false);
    }
  };

  const restricted = item.visible_groups.length > 0;

  return (
    <form onSubmit={save} noValidate>
      <Link to="/admin?tab=catalog" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink">
        <FiArrowLeft aria-hidden="true" /> Record producers
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          {isNew ? 'Nouveau formulaire' : `Modifier « ${item.name || 'sans nom'} »`}
        </h1>
        <div className="flex gap-2">
          <Link to="/admin?tab=catalog" className="btn btn-secondary">
            Annuler
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer le formulaire'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className="panel space-y-4 p-5" aria-labelledby="fb-general">
            <h2 id="fb-general" className="font-bold">
              Informations
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="fb-name" label="Nom du formulaire" required error={errors.name} hint="Devient le titre des tickets créés.">
                {(p) => <input {...p} className="field" value={item.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />}
              </Field>
              <Field id="fb-section" label="Rubrique du catalogue" error={errors.section} hint="Par exemple : Informatique, Ressources humaines.">
                {(p) => (
                  <>
                    <input
                      {...p}
                      className="field"
                      list="fb-sections"
                      value={item.section}
                      maxLength={60}
                      onChange={(e) => set({ section: e.target.value })}
                    />
                    <datalist id="fb-sections">
                      {sections.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </div>
            <Field id="fb-description" label="Description" error={errors.description} hint="Affichée dans le catalogue et en haut du formulaire.">
              {(p) => (
                <textarea
                  {...p}
                  rows={2}
                  className="field"
                  value={item.description}
                  maxLength={2000}
                  onChange={(e) => set({ description: e.target.value })}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="fb-group"
                label="Groupe qui traite les demandes"
                error={errors.fulfillment_group}
                hint="Les tickets créés lui sont affectés."
              >
                {(p) => (
                  <select {...p} className="field" value={item.fulfillment_group} onChange={(e) => set({ fulfillment_group: e.target.value })}>
                    <option value="">Aucun (administrateurs)</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field id="fb-priority" label="Priorité des tickets créés" error={errors.priority}>
                {(p) => (
                  <select {...p} className="field" value={item.priority} onChange={(e) => set({ priority: e.target.value })}>
                    {PRIORITY_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {PRIORITIES[k].label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            <Field
              id="fb-category"
              label="Catégorie des tickets créés"
              error={errors.category}
              hint="Les règles de visibilité par catégorie (Paramètres) s'appliquent à ces tickets."
            >
              {(p) => (
                <select {...p} className="field max-w-sm" value={item.category} onChange={(e) => set({ category: e.target.value })}>
                  <option value="">Aucune</option>
                  {Object.entries(CATEGORIES)
                    .filter(([k]) => ACTIVE_CATEGORY_KEYS.includes(k) || k === item.category)
                    .map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                </select>
              )}
            </Field>

            <fieldset>
              <legend className="label">Qui peut utiliser ce formulaire ?</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="fb-vis" className="size-4" checked={!restricted} onChange={() => set({ visible_groups: [] })} />
                  Tout le monde
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="fb-vis"
                    className="size-4"
                    checked={restricted}
                    disabled={groups.length === 0}
                    onChange={() => groups.length && set({ visible_groups: [groups[0].id] })}
                  />
                  Certains groupes seulement
                </label>
              </div>
              {groups.length === 0 && (
                <p className="mt-1 text-xs text-ink-mute">Créez d'abord des groupes pour réserver un formulaire.</p>
              )}
              {restricted && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                        item.visible_groups.includes(g.id) ? 'border-accent bg-accent-soft' : 'border-line-strong'
                      }`}
                    >
                      <input type="checkbox" className="size-4" checked={item.visible_groups.includes(g.id)} onChange={() => toggleVisible(g.id)} />
                      {g.name}
                    </label>
                  ))}
                </div>
              )}
              {errors.visible_groups && <p className="mt-1 text-sm text-danger">{errors.visible_groups}</p>}
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={item.active} onChange={(e) => set({ active: e.target.checked })} />
              Publié dans le catalogue
            </label>
          </section>

          <section className="panel p-5" aria-labelledby="fb-questions">
            <h2 id="fb-questions" className="font-bold">
              Variables {item.fields.length > 0 && <span className="text-ink-mute">({item.fields.length})</span>}
            </h2>
            <p className="mb-4 text-sm text-ink-mute">
              Les questions posées au demandeur. Toutes les réponses sont gardées avec la demande ; une variable associée à un champ y recopie en plus sa
              réponse.
            </p>
            {errors.mapping && (
              <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {errors.mapping}
              </p>
            )}
            {errors.fields && (
              <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {errors.fields}
              </p>
            )}
            {item.fields.length === 0 && !picking && (
              <p className="mb-4 text-sm text-ink-mute">Aucune question pour l'instant : ajoutez la première.</p>
            )}
            <ol className="space-y-4">
              {item.fields.map((f, i) => (
                <FieldEditor
                  key={f.uid}
                  dict={dict}
                  usedTargets={new Set(item.fields.filter((x, j) => j !== i && x.mapTo).map((x) => x.mapTo))}
                  keyEditable={!savedKeys.has(f.key)}
                  field={f}
                  index={i}
                  count={item.fields.length}
                  previous={item.fields.slice(0, i)}
                  onChange={(next) => updateField(i, next)}
                  onMove={(delta) => moveField(i, delta)}
                  onRemove={() => removeField(i)}
                />
              ))}
            </ol>
            <div className="mt-4">
              {picking ? (
                <TypePicker onPick={addField} onCancel={() => setPicking(false)} />
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setPicking(true)}>
                  <FiPlus aria-hidden="true" /> Ajouter une variable
                </button>
              )}
            </div>
          </section>

          {dict && (
            <FixedValues
              dict={dict}
              groups={groups}
              values={item.field_values || {}}
              mapped={new Set(item.fields.map((f) => f.mapTo).filter(Boolean))}
              onChange={(field_values) => set({ field_values })}
            />
          )}
          {dict && <MappingSummary item={item} dict={dict} groups={groups} />}
        </div>

        <aside className="min-w-0" aria-labelledby="fb-preview">
          <div className="xl:sticky xl:top-20">
            <h2 id="fb-preview" className="mb-2 text-sm font-semibold text-ink-mute">
              Aperçu pour le demandeur
            </h2>
            <div className="panel max-h-[calc(100vh-8rem)] overflow-y-auto p-5">
              <p className="text-lg font-bold">{item.name || 'Nom du formulaire'}</p>
              {item.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-mute">{item.description}</p>}
              <div className="mt-5">
                {previewFields.length ? (
                  <FormRenderer
                    fields={previewFields.map((f) => ({ ...f, label: f.label || '(sans libellé)' }))}
                    values={preview}
                    onChange={(k, v) => setPreview((p) => ({ ...p, [k]: v }))}
                    idPrefix="preview"
                  />
                ) : (
                  <p className="text-sm text-ink-mute">Les questions s'afficheront ici. Essayez les règles d'affichage en répondant.</p>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}

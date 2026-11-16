import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowDown, FiArrowLeft, FiArrowUp, FiPlus, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { ACTIVE_CATEGORY_KEYS, CATEGORIES, PRIORITIES, PRIORITY_ORDER } from '../../lib/constants';
import { toast, toastError } from '../../lib/notify';
import { CHOICE_TYPES, CONDITION_OPS, FIELD_TYPES, YES_NO, needsValue, newKey, opsFor } from '../../catalog/fields';
import FormRenderer from '../../catalog/FormRenderer';
import { ErrorState, Field, Spinner } from '../../components/ui';

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
};

const cleanOptions = (options) => (options || []).map((o) => o.trim()).filter(Boolean);

/** Définition envoyée au serveur, et utilisée par l'aperçu. */
function normalizeFields(fields) {
  return fields.map((f) => {
    const out = { ...f };
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
      <p className="mb-2 text-sm font-semibold">Type de la nouvelle question</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(FIELD_TYPES).map(([type, t]) => (
          <button
            key={type}
            type="button"
            className="rounded-md border border-line-strong bg-white px-3 py-2 text-left hover:border-accent"
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

function FieldEditor({ field, index, count, previous, onChange, onMove, onRemove }) {
  const id = `fb-${field.key}`;
  const set = (patch) => onChange({ ...field, ...patch });
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
    <li className="rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper/70 px-4 py-2">
        <span className="text-sm font-bold">Question {index + 1}</span>
        <span className="text-sm text-ink-mute">{FIELD_TYPES[field.type].label}</span>
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
              <input {...p} className="field" value={field.label} maxLength={200} onChange={(e) => set({ label: e.target.value })} />
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
                    inTitle: type === 'text' ? field.inTitle : false,
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
          {field.type === 'text' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={field.inTitle} onChange={(e) => set({ inTitle: e.target.checked })} />
              Ajouter la réponse au titre du ticket
            </label>
          )}
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

  useEffect(() => {
    api('/api/groups').then(setGroups).catch(() => {});
    api('/api/admin/catalog')
      .then((list) => setSections([...new Set(list.map((i) => i.section).filter(Boolean))]))
      .catch(() => {});
    if (isNew) return;
    api(`/api/admin/catalog/${id}`)
      .then((data) =>
        setItem({
          ...data,
          fulfillment_group: data.fulfillment_group?.id ? String(data.fulfillment_group.id) : '',
          visible_groups: data.visible_groups.map((g) => g.id),
          fields: data.fields.map((f) => ({ help: '', placeholder: '', required: false, inTitle: false, ...f })),
        })
      )
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
        inTitle: false,
        ...(CHOICE_TYPES.includes(type) ? { options: ['Choix 1', 'Choix 2'] } : {}),
      },
    ]);
    setPicking(false);
  };

  const updateField = (index, next) => {
    // Un seul champ complète le titre.
    setFields(
      item.fields.map((f, i) => (i === index ? next : next.inTitle && f.inTitle ? { ...f, inTitle: false } : f))
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
        <FiArrowLeft aria-hidden="true" /> Catalogue
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
            <h2 id="fb-questions" className="mb-4 font-bold">
              Questions {item.fields.length > 0 && <span className="text-ink-mute">({item.fields.length})</span>}
            </h2>
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
                  key={f.key}
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
                  <FiPlus aria-hidden="true" /> Ajouter une question
                </button>
              )}
            </div>
          </section>
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

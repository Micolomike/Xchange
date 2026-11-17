import { NavLink } from 'react-router-dom';
import { FiChevronDown } from 'react-icons/fi';
import { Field } from '../components/ui';

/** Onglets de la rubrique Analyses. */
export function AnalyticsTabs() {
  const cls = ({ isActive }) =>
    `-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
      isActive ? 'border-accent text-accent-strong' : 'border-transparent text-ink-mute hover:text-ink'
    }`;
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Analyses">
      <NavLink to="/analyses/tableaux" className={cls}>
        Tableaux de bord
      </NavLink>
      <NavLink to="/analyses/rapports" className={cls}>
        Rapports
      </NavLink>
    </nav>
  );
}

/** Choix multiple compact : une liste de cases à cocher dans un menu déroulant. */
export function MultiPick({ label, options, value = [], onChange, allLabel = 'Tous' }) {
  const selected = options.filter((o) => value.includes(o.key));
  const summary = selected.length === 0 ? allLabel : selected.length <= 2 ? selected.map((o) => o.label).join(', ') : `${selected.length} choisis`;
  return (
    <details className="group relative">
      <summary className="field flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">
          <span className="text-ink-mute">{label} : </span>
          {summary}
        </span>
        <FiChevronDown aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <fieldset className="absolute z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-md border border-line bg-surface p-2 shadow-lg">
        <legend className="sr-only">{label}</legend>
        {options.map((o) => (
          <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper">
            <input
              type="checkbox"
              checked={value.includes(o.key)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((v) => v !== o.key))}
            />
            {o.label}
          </label>
        ))}
        {value.length > 0 && (
          <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs font-semibold text-accent-strong hover:bg-paper" onClick={() => onChange([])}>
            Tout effacer
          </button>
        )}
      </fieldset>
    </details>
  );
}

/** Partage : privé, certains groupes, tout le monde. */
export function SharingFields({ value, onChange, meta, what = 'ce rapport' }) {
  const choices = [
    { key: 'private', label: 'Privé', hint: 'Vous seul' },
    { key: 'groups', label: 'Groupes', hint: 'Les membres des groupes choisis' },
    { key: 'all', label: 'Tout le monde', hint: 'Tous les comptes' },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="label">Qui peut voir {what} ?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map((c) => (
          <label
            key={c.key}
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${value.visibility === c.key ? 'border-accent bg-accent-soft' : 'border-line'}`}
          >
            <input type="radio" name={`share-${what}`} className="mt-1" checked={value.visibility === c.key} onChange={() => onChange({ ...value, visibility: c.key })} />
            <span>
              <span className="block font-semibold">{c.label}</span>
              <span className="block text-xs text-ink-mute">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {value.visibility === 'groups' && (
        <MultiPick
          label="Groupes"
          allLabel="Aucun"
          options={meta.groups.map((g) => ({ key: g.id, label: g.name }))}
          value={value.groups}
          onChange={(groups) => onChange({ ...value, groups })}
        />
      )}
      <p className="text-xs text-ink-mute">
        Partager ne donne accès à aucune demande en plus : chacun voit les résultats calculés avec ses propres droits.
      </p>
    </fieldset>
  );
}

/** Champ de titre/description réutilisé. */
export function TextField({ id, label, value, onChange, max, required, textarea }) {
  return (
    <Field id={id} label={label} required={required}>
      {(p) =>
        textarea ? (
          <textarea {...p} className="field" rows={2} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input {...p} className="field" maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

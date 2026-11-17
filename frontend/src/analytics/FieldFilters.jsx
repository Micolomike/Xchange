import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { PersonPicker } from '../components/CustomFieldInput';
import { MultiPick } from './common';

const OPS = {
  choice: [
    ['in', 'est parmi'],
    ['filled', 'est renseigné'],
    ['empty', 'est vide'],
  ],
  user: [
    ['in', 'est'],
    ['filled', 'est renseigné'],
    ['empty', 'est vide'],
  ],
  group: [
    ['in', 'est parmi'],
    ['filled', 'est renseigné'],
    ['empty', 'est vide'],
  ],
  text: [
    ['contains', 'contient'],
    ['filled', 'est renseigné'],
    ['empty', 'est vide'],
  ],
  number: [
    ['range', 'est entre'],
    ['filled', 'est renseigné'],
    ['empty', 'est vide'],
  ],
  date: [
    ['range', 'est entre'],
    ['filled', 'est renseigné'],
    ['empty', 'est vide'],
  ],
};

/**
 * Filtres sur les champs personnalisés et les variables d'un formulaire : une ligne par condition,
 * toutes les conditions doivent être vraies.
 */
export default function FieldFilters({ value = [], onChange, available, groups, idPrefix }) {
  const byKey = new Map(available.map((a) => [a.key, a]));
  const rows = value.filter((r) => byKey.has(r.key));
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (key) => {
    const a = byKey.get(key);
    if (a) onChange([...rows, { key, op: OPS[a.kind][0][0] }]);
  };

  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const a = byKey.get(r.key);
        const id = `${idPrefix}-ff-${i}`;
        return (
          <div key={`${r.key}-${i}`} className="rounded-md border border-line p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{a.label}</span>
              <select className="field w-auto py-1 text-sm" aria-label={`Condition sur ${a.label}`} value={r.op} onChange={(e) => set(i, { op: e.target.value, values: undefined, value: undefined, min: undefined, max: undefined })}>
                {OPS[a.kind].map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost ml-auto px-2 py-1 hover:text-danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Retirer le filtre sur ${a.label}`} title="Retirer">
                <FiTrash2 aria-hidden="true" />
              </button>
            </div>
            {r.op === 'in' && a.kind === 'choice' && (
              <div className="mt-2">
                <MultiPick label="Valeurs" allLabel="Choisir…" options={a.options.map((o) => ({ key: o, label: o }))} value={r.values || []} onChange={(values) => set(i, { values })} />
              </div>
            )}
            {r.op === 'in' && a.kind === 'group' && (
              <div className="mt-2">
                <MultiPick label="Groupes" allLabel="Choisir…" options={groups.map((g) => ({ key: String(g.id), label: g.name }))} value={r.values || []} onChange={(values) => set(i, { values })} />
              </div>
            )}
            {r.op === 'in' && a.kind === 'user' && (
              <div className="mt-2">
                <PersonPicker id={id} value={r.values?.[0] || ''} onChange={(v) => set(i, { values: v ? [v] : [] })} />
              </div>
            )}
            {r.op === 'contains' && (
              <input className="field mt-2" aria-label={`Texte cherché dans ${a.label}`} maxLength={100} value={r.value || ''} onChange={(e) => set(i, { value: e.target.value })} />
            )}
            {r.op === 'range' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  className="field"
                  type={a.kind === 'date' ? 'date' : 'text'}
                  inputMode={a.kind === 'number' ? 'decimal' : undefined}
                  aria-label={`${a.label} : au moins`}
                  placeholder="Au moins"
                  value={r.min ?? ''}
                  onChange={(e) => set(i, { min: e.target.value })}
                />
                <input
                  className="field"
                  type={a.kind === 'date' ? 'date' : 'text'}
                  inputMode={a.kind === 'number' ? 'decimal' : undefined}
                  aria-label={`${a.label} : au plus`}
                  placeholder="Au plus"
                  value={r.max ?? ''}
                  onChange={(e) => set(i, { max: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}
      {rows.length < 10 && available.length > 0 && (
        <div className="flex items-center gap-2">
          <FiPlus aria-hidden="true" className="text-ink-mute" />
          <select className="field py-1.5 text-sm" aria-label="Ajouter un filtre sur un champ ou une variable" value="" onChange={(e) => add(e.target.value)}>
            <option value="">Filtrer sur un champ ou une variable…</option>
            {available.some((a) => !a.variable) && (
              <optgroup label="Champs personnalisés">
                {available
                  .filter((a) => !a.variable)
                  .map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
              </optgroup>
            )}
            {available.some((a) => a.variable) && (
              <optgroup label="Variables du formulaire">
                {available
                  .filter((a) => a.variable)
                  .map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </div>
      )}
    </div>
  );
}

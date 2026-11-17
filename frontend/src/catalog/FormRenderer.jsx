import { useMemo } from 'react';
import FileDrop from '../components/FileDrop';
import { Field } from '../components/ui';
import { YES_NO, isFieldVisible } from './fields';

/**
 * Affiche un formulaire du catalogue. `values` contient les réponses (les pièces jointes
 * sont des tableaux de File) ; les champs masqués par une règle ne sont pas rendus.
 */
export default function FormRenderer({ fields, values, onChange, errors = {}, idPrefix = 'cf' }) {
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const counted = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.key, f.type === 'file' ? values[f.key]?.length || 0 : values[f.key]])),
    [fields, values]
  );

  return (
    <div className="space-y-5">
      {fields.map((f) => {
        if (!isFieldVisible(f, counted, byKey)) return null;
        const id = `${idPrefix}-${f.key}`;
        const value = values[f.key];
        const set = (v) => onChange(f.key, v);

        if (f.type === 'checkbox') {
          return (
            <div key={f.key}>
              <label className="flex items-start gap-2.5 text-[0.9375rem]">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={value === true}
                  onChange={(e) => set(e.target.checked)}
                  aria-invalid={errors[f.key] ? 'true' : undefined}
                />
                <span>
                  {f.label}
                  {f.required && <span className="text-danger" aria-hidden="true"> *</span>}
                  {f.help && <span className="block text-xs text-ink-mute">{f.help}</span>}
                </span>
              </label>
              {errors[f.key] && <p className="mt-1 text-sm text-danger">{errors[f.key]}</p>}
            </div>
          );
        }

        if (f.type === 'radio' || f.type === 'yesno') {
          const options = f.type === 'yesno' ? YES_NO : f.options;
          return (
            <fieldset key={f.key} aria-invalid={errors[f.key] ? 'true' : undefined}>
              <legend className="label">
                {f.label}
                {f.required && <span className="text-danger" aria-hidden="true"> *</span>}
              </legend>
              {f.help && <p className="-mt-0.5 mb-2 text-xs text-ink-mute">{f.help}</p>}
              <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                  <label
                    key={o}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      value === o ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong bg-surface hover:bg-paper'
                    }`}
                  >
                    <input type="radio" name={id} value={o} checked={value === o} onChange={() => set(o)} className="size-4" />
                    {o}
                  </label>
                ))}
              </div>
              {errors[f.key] && <p className="mt-1 text-sm text-danger">{errors[f.key]}</p>}
            </fieldset>
          );
        }

        if (f.type === 'file') {
          return (
            <div key={f.key}>
              <p className="label">
                {f.label}
                {f.required && <span className="text-danger" aria-hidden="true"> *</span>}
              </p>
              {f.help && <p className="-mt-0.5 mb-2 text-xs text-ink-mute">{f.help}</p>}
              <FileDrop files={value || []} onChange={set} />
              {errors[f.key] && <p className="mt-1 text-sm text-danger">{errors[f.key]}</p>}
            </div>
          );
        }

        return (
          <Field key={f.key} id={id} label={f.label} required={f.required} hint={f.help} error={errors[f.key]}>
            {(props) =>
              f.type === 'textarea' ? (
                <textarea
                  {...props}
                  rows={4}
                  className="field"
                  placeholder={f.placeholder}
                  value={value || ''}
                  onChange={(e) => set(e.target.value)}
                />
              ) : f.type === 'select' ? (
                <select {...props} className="field" value={value || ''} onChange={(e) => set(e.target.value)}>
                  <option value="">Choisir…</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...props}
                  type={f.type === 'number' ? 'text' : f.type}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  className={`field ${f.type === 'date' || f.type === 'number' ? 'max-w-56' : ''}`}
                  placeholder={f.placeholder}
                  value={value || ''}
                  onChange={(e) => set(e.target.value)}
                />
              )
            }
          </Field>
        );
      })}
    </div>
  );
}

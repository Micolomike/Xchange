import { useEffect, useId, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { api } from '../lib/api';

/** Choix d'une personne (champ « Référence : utilisateur ») : recherche par nom ou identifiant. */
export function PersonPicker({ id, value, onChange, disabled }) {
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const box = useRef(null);

  // Nom de la personne déjà choisie.
  useEffect(() => {
    if (!value) {
      setName('');
      return;
    }
    let alive = true;
    api('/api/ticket-fields/people', { query: { ids: String(value) } })
      .then((r) => alive && setName(r.people[0]?.name || 'Compte supprimé'))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      api('/api/ticket-fields/people', { query: { q } })
        .then((r) => setResults(r.people))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (value && !open) {
    return (
      <div className="flex items-center gap-2">
        <span className="field flex-1 truncate bg-paper">{name || '…'}</span>
        {!disabled && (
          <>
            <button type="button" className="btn btn-ghost px-2" onClick={() => setOpen(true)}>
              Changer
            </button>
            <button type="button" className="btn btn-ghost px-2" onClick={() => onChange('')} aria-label="Retirer la personne" title="Retirer">
              <FiX aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <input
        id={id}
        className="field"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="Rechercher une personne…"
        value={q}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-mute">Aucune personne trouvée.</li>
          ) : (
            results.map((p) => (
              <li key={p.id} role="option" aria-selected={String(p.id) === String(value)}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-paper"
                  onClick={() => {
                    onChange(String(p.id));
                    setName(p.name);
                    setQ('');
                    setOpen(false);
                  }}
                >
                  {p.name} <span className="text-ink-mute">@{p.username}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Saisie d'une valeur de champ personnalisé, selon son type. `value` : texte ('' = vide). */
export default function CustomFieldInput({ field, value, onChange, groups = [], id, disabled }) {
  const v = value ?? '';
  switch (field.type) {
    case 'textarea':
      return <textarea id={id} className="field" rows={3} maxLength={5000} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select id={id} className="field" value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Non renseigné</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'yesno':
      return (
        <select id={id} className="field" value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Non renseigné</option>
          <option value="Oui">Oui</option>
          <option value="Non">Non</option>
        </select>
      );
    case 'number':
      return <input id={id} className="field" inputMode="decimal" maxLength={30} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input id={id} type="date" className="field" value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'group':
      return (
        <select id={id} className="field" value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Non renseigné</option>
          {groups.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {g.name}
            </option>
          ))}
        </select>
      );
    case 'user':
      return <PersonPicker id={id} value={v} onChange={onChange} disabled={disabled} />;
    default:
      return <input id={id} className="field" maxLength={500} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}

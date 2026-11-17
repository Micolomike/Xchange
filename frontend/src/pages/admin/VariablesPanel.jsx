import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { FIELD_TYPES } from '../../catalog/fields';
import { ErrorState, Spinner } from '../../components/ui';

/** Table des variables : toutes les questions de tous les formulaires, avec le champ qu'elles alimentent. */
export default function VariablesPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [producer, setProducer] = useState('');
  const [mapped, setMapped] = useState('all');

  const load = useCallback(() => {
    setError(null);
    return api('/api/admin/variables')
      .then((r) => setRows(r.variables))
      .catch(setError);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const producers = useMemo(() => [...new Map((rows || []).map((r) => [r.producer.id, r.producer])).values()], [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter(
      (r) =>
        (!producer || String(r.producer.id) === producer) &&
        (mapped === 'all' || (mapped === 'yes' ? r.mapTo : !r.mapTo)) &&
        (!needle || `${r.label} ${r.key} ${r.mapLabel || ''}`.toLowerCase().includes(needle))
    );
  }, [rows, q, producer, mapped]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!rows) return <Spinner />;

  return (
    <section className="panel" aria-labelledby="vars-title">
      <div className="border-b border-line px-5 py-3">
        <h3 id="vars-title" className="font-bold">
          Table des variables
        </h3>
        <p className="max-w-3xl text-sm text-ink-mute">
          Chaque question d’un formulaire est une variable. Ses réponses sont gardées avec la demande et reportables quand un rapport porte sur ce seul
          formulaire ; une variable associée à un champ recopie en plus sa réponse dans ce champ, reportable pour toutes les demandes.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
        <div>
          <label htmlFor="vars-q" className="label">
            Rechercher
          </label>
          <input id="vars-q" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Libellé, nom technique, champ…" />
        </div>
        <div>
          <label htmlFor="vars-producer" className="label">
            Formulaire
          </label>
          <select id="vars-producer" className="field" value={producer} onChange={(e) => setProducer(e.target.value)}>
            <option value="">Tous</option>
            {producers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vars-mapped" className="label">
            Champ associé
          </label>
          <select id="vars-mapped" className="field" value={mapped} onChange={(e) => setMapped(e.target.value)}>
            <option value="all">Peu importe</option>
            <option value="yes">Associées à un champ</option>
            <option value="no">Sans champ associé</option>
          </select>
        </div>
        <p className="ml-auto text-sm text-ink-mute">
          {shown.length} variable{shown.length > 1 ? 's' : ''} sur {rows.length}
        </p>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 border-b border-line bg-surface text-xs text-ink-mute">
            <tr>
              <th scope="col" className="px-4 py-2">Formulaire</th>
              <th scope="col" className="px-2 py-2 text-right">Ordre</th>
              <th scope="col" className="px-4 py-2">Variable</th>
              <th scope="col" className="px-4 py-2">Nom technique</th>
              <th scope="col" className="px-4 py-2">Type</th>
              <th scope="col" className="px-4 py-2">Champ associé</th>
              <th scope="col" className="px-4 py-2 text-right">Réponses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r) => (
              <tr key={`${r.producer.id}-${r.key}`}>
                <td className="px-4 py-2">
                  <Link to={`/admin/catalogue/${r.producer.id}`} className="font-semibold text-accent-strong hover:underline">
                    {r.producer.name}
                  </Link>
                  {!r.producer.active && <span className="ml-1 text-xs text-ink-mute">(non publié)</span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{r.order}</td>
                <td className="px-4 py-2">
                  {r.label}
                  {r.required && (
                    <span className="text-danger" title="Obligatoire">
                      {' '}
                      *
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{r.key}</td>
                <td className="px-4 py-2">{FIELD_TYPES[r.type]?.label || r.type}</td>
                <td className="px-4 py-2">
                  {r.mapTo ? (
                    <>
                      {r.mapLabel} <span className="font-mono text-xs text-ink-mute">{r.mapTo}</span>
                    </>
                  ) : (
                    <span className="text-ink-mute">-</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.answers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

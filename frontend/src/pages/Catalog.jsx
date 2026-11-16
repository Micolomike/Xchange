import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiChevronRight, FiEdit3, FiSearch } from 'react-icons/fi';
import { api } from '../lib/api';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

function ItemLink({ to, title, description }) {
  return (
    <li>
      <Link
        to={to}
        className="group flex h-full items-start gap-3 rounded-lg border border-line bg-white px-4 py-3.5 transition-colors hover:border-accent hover:bg-accent-soft/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink group-hover:text-accent-strong">{title}</span>
          {description && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-mute">{description}</span>}
        </span>
        <FiChevronRight className="mt-1 shrink-0 text-ink-mute group-hover:text-accent" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** Catalogue des demandes : un formulaire par type de demande, regroupés par rubrique. */
export default function Catalog() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  const load = () => {
    setError(null);
    api('/api/catalog').then(setItems).catch(setError);
  };
  useEffect(load, []);

  const sections = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const shown = needle
      ? items.filter((i) => `${i.name} ${i.description} ${i.section}`.toLowerCase().includes(needle))
      : items;
    const map = new Map();
    for (const i of shown) {
      const key = i.section || 'Autres demandes';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    return [...map.entries()];
  }, [items, q]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <Spinner />;

  return (
    <div>
      <PageHeader title="Catalogue">Choisissez le formulaire qui correspond à votre demande.</PageHeader>

      {items.length > 0 && (
        <label className="relative mb-6 block max-w-md">
          <span className="sr-only">Rechercher un formulaire</span>
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
          <input
            type="search"
            className="field pl-9"
            placeholder="Rechercher un formulaire"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      )}

      {items.length > 0 && sections.length === 0 && (
        <EmptyState title="Aucun formulaire ne correspond">Essayez un autre mot, ou faites une demande libre.</EmptyState>
      )}

      <div className="space-y-8">
        {sections.map(([name, list]) => (
          <section key={name} aria-labelledby={`sec-${name}`}>
            <h2 id={`sec-${name}`} className="mb-3 text-lg font-bold">
              {name}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((i) => (
                <ItemLink key={i.id} to={`/catalogue/${i.id}`} title={i.name} description={i.description} />
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="sec-libre">
          <h2 id="sec-libre" className="mb-3 text-lg font-bold">
            Rien ne correspond ?
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link
                to="/tickets/new"
                className="group flex h-full items-start gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3.5 transition-colors hover:border-accent hover:bg-accent-soft/40"
              >
                <FiEdit3 className="mt-1 shrink-0 text-ink-mute" aria-hidden="true" />
                <span>
                  <span className="block font-semibold text-ink group-hover:text-accent-strong">Demande libre</span>
                  <span className="block text-sm text-ink-mute">Décrivez votre besoin avec vos mots.</span>
                </span>
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiChevronRight, FiEdit3, FiSearch, FiStar } from 'react-icons/fi';
import { api } from '../lib/api';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';

const POPULAR = '__populaires';
const OTHER = 'Autres demandes';
const POPULAR_MAX = 6;

const sectionOf = (i) => i.section || OTHER;
const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function ItemLink({ item, showSection }) {
  return (
    <li>
      <Link
        to={`/catalogue/${item.id}`}
        className="group flex h-full items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-accent hover:bg-accent-soft/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink group-hover:text-accent-strong">{item.name}</span>
          {item.description && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-mute">{item.description}</span>}
          {showSection && <span className="mt-1.5 block text-xs font-semibold text-ink-soft">{sectionOf(item)}</span>}
        </span>
        <FiChevronRight className="mt-1 shrink-0 text-ink-mute group-hover:text-accent-strong" aria-hidden="true" />
      </Link>
    </li>
  );
}

function FreeRequest() {
  return (
    <li>
      <Link
        to="/tickets/new"
        className="group flex h-full items-start gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3.5 transition-colors hover:border-accent hover:bg-accent-soft/40"
      >
        <FiEdit3 className="mt-1 shrink-0 text-ink-mute" aria-hidden="true" />
        <span>
          <span className="block font-semibold text-ink group-hover:text-accent-strong">Demande libre</span>
          <span className="block text-sm text-ink-mute">Rien ne correspond ? Décrivez votre besoin avec vos mots.</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Catalogue des demandes : une rubrique à la fois, choisie dans le menu (à gauche sur ordinateur,
 * en pastilles sur téléphone), précédée des formulaires les plus demandés. La recherche porte sur tout le catalogue.
 */
export default function Catalog() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();

  const load = () => {
    setError(null);
    api('/api/catalog').then(setItems).catch(setError);
  };
  useEffect(load, []);

  const { sections, popular } = useMemo(() => {
    const map = new Map();
    for (const i of items || []) {
      const key = sectionOf(i);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    // « Autres demandes » (formulaires sans rubrique) toujours en dernier.
    const list = [...map.entries()].sort(([a], [b]) => (a === OTHER) - (b === OTHER) || a.localeCompare(b, 'fr'));
    const top = [...(items || [])]
      .filter((i) => i.popularity > 0)
      .sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name, 'fr'))
      .slice(0, POPULAR_MAX);
    return { sections: list, popular: top };
  }, [items]);

  const requested = params.get('rubrique');
  const current =
    requested === POPULAR && popular.length
      ? POPULAR
      : sections.some(([name]) => name === requested)
        ? requested
        : popular.length
          ? POPULAR
          : // Sans historique : la rubrique qui a le plus de formulaires.
            [...sections].sort((a, b) => b[1].length - a[1].length)[0]?.[0];

  const choose = (name) => {
    setQ('');
    setParams(name ? { rubrique: name } : {}, { replace: true });
  };

  const needle = normalize(q.trim());
  const results = useMemo(
    () => (needle ? (items || []).filter((i) => normalize(`${i.name} ${i.description} ${i.section}`).includes(needle)) : null),
    [items, needle]
  );

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <Spinner />;

  const menu = [
    ...(popular.length ? [{ key: POPULAR, label: 'Les plus demandés', count: popular.length, icon: true }] : []),
    ...sections.map(([name, list]) => ({ key: name, label: name, count: list.length })),
  ];
  const shown = current === POPULAR ? popular : sections.find(([name]) => name === current)?.[1] || [];
  const title = current === POPULAR ? 'Les plus demandés' : current;

  return (
    <div>
      <PageHeader title="Catalogue">Choisissez le formulaire qui correspond à votre demande.</PageHeader>

      {items.length === 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FreeRequest />
        </ul>
      ) : (
        <>
          <label className="relative mb-5 block max-w-xl">
            <span className="sr-only">Rechercher dans tout le catalogue</span>
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
            <input
              type="search"
              className="field pl-9"
              placeholder={`Rechercher parmi ${items.length} formulaire${items.length > 1 ? 's' : ''}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>

          <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
            <nav aria-label="Rubriques du catalogue" className={results ? 'max-lg:hidden' : ''}>
              {/* Téléphone et tablette : pastilles défilantes. Ordinateur : liste verticale collante. */}
              <ul className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:sticky lg:top-20 lg:mx-0 lg:mb-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
                {menu.map((m) => {
                  const active = !results && m.key === current;
                  return (
                    <li key={m.key} className="shrink-0">
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => choose(m.key)}
                        className={`flex w-full items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-left text-sm font-semibold transition-colors lg:rounded-md lg:border-0 lg:py-2 ${
                          active
                            ? 'border-accent bg-accent-soft text-accent-strong'
                            : 'border-line text-ink-soft hover:bg-ink/5 hover:text-ink'
                        }`}
                      >
                        {m.icon && <FiStar aria-hidden="true" className="shrink-0" />}
                        <span className="lg:min-w-0 lg:flex-1 lg:truncate">{m.label}</span>
                        <span className={`text-xs ${active ? 'text-accent-strong' : 'text-ink-mute'}`}>{m.count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section aria-labelledby="catalog-pane-title" className="min-w-0">
              {results ? (
                <>
                  <h2 id="catalog-pane-title" className="mb-3 text-lg font-bold" aria-live="polite">
                    {results.length
                      ? `${results.length} formulaire${results.length > 1 ? 's' : ''} pour « ${q.trim()} »`
                      : `Aucun formulaire pour « ${q.trim()} »`}
                  </h2>
                  {!results.length && (
                    <EmptyState title="Essayez un autre mot">Ou faites une demande libre : elle sera orientée par un administrateur.</EmptyState>
                  )}
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {results.map((i) => (
                      <ItemLink key={i.id} item={i} showSection />
                    ))}
                    <FreeRequest />
                  </ul>
                </>
              ) : (
                <>
                  <h2 id="catalog-pane-title" className="mb-1 text-lg font-bold">
                    {title}
                  </h2>
                  <p className="mb-3 text-sm text-ink-mute">
                    {current === POPULAR
                      ? 'Les formulaires les plus utilisés ces trois derniers mois.'
                      : `${shown.length} formulaire${shown.length > 1 ? 's' : ''} dans cette rubrique.`}
                  </p>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.map((i) => (
                      <ItemLink key={i.id} item={i} showSection={current === POPULAR} />
                    ))}
                    <FreeRequest />
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

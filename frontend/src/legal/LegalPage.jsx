import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Spinner } from '../components/ui';
import LegalText from './LegalText';
import { formatDate } from '../lib/format';
import { LEGAL_PAGES, useLegal } from './useLegal';

/** Page publique : mentions légales, politique de confidentialité ou charte. */
export default function LegalPage({ kind }) {
  const page = LEGAL_PAGES.find((p) => p.key === kind);
  const { data, error } = useLegal();
  useEffect(() => {
    document.title = `${page.title} · Xchange`;
  }, [page.title]);

  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
      <nav aria-label="Autres textes" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {LEGAL_PAGES.filter((p) => p.key !== kind).map((p) => (
          <Link key={p.key} to={p.path} className="font-semibold text-accent-strong hover:underline">
            {p.title}
          </Link>
        ))}
      </nav>
      <div className="panel mt-6 p-6 sm:p-8">
        {error && <ErrorState error={error} />}
        {!error && !data && <Spinner />}
        {data && kind === 'charter' && data.termsVersion && (
          <p className="mb-6 text-sm text-ink-mute">
            Version {data.termsVersion}, en vigueur depuis le {formatDate(data.termsUpdatedAt)}.
          </p>
        )}
        {data && <LegalText text={data[kind]} />}
      </div>
    </article>
  );
}

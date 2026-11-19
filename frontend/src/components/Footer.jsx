import { Link } from 'react-router-dom';
import { LEGAL_PAGES } from '../legal/useLegal';
import { useSettings } from '../settings/context';

export default function Footer() {
  const { settings } = useSettings();
  return (
    <footer className="border-t border-line">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-ink-mute sm:pr-56">
        <p>{settings.appName || 'Xchange'}</p>
        <nav aria-label="Informations légales" className="flex flex-wrap gap-x-5 gap-y-1">
          {LEGAL_PAGES.map((p) => (
            <Link key={p.key} to={p.path} className="hover:text-ink hover:underline">
              {p.title}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

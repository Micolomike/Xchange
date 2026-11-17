import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { useLegal } from '../legal/useLegal';
import { toastError } from '../lib/notify';

/** Comptes créés avant la charte : invitation à la lire et à l'accepter (non bloquant). */
export default function TermsBanner() {
  const { user, acceptTerms } = useAuth();
  const { data } = useLegal();
  const [busy, setBusy] = useState(false);
  if (!user || user.terms_accepted_at || user.impersonator || !data?.requireTerms) return null;

  const accept = async () => {
    setBusy(true);
    try {
      await acceptTerms();
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-line bg-accent-soft" role="region" aria-label="Charte d’utilisation">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-6">
        <p className="flex-1 text-ink">
          Xchange a maintenant une{' '}
          <Link to="/charte" className="font-semibold text-accent-strong underline">
            charte d’utilisation
          </Link>{' '}
          et une{' '}
          <Link to="/confidentialite" className="font-semibold text-accent-strong underline">
            politique de confidentialité
          </Link>
          . Merci de les lire.
        </p>
        <button type="button" className="btn btn-primary py-1.5 text-sm" onClick={accept} disabled={busy}>
          J’ai lu et j’accepte
        </button>
      </div>
    </div>
  );
}

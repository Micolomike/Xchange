import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { forgetLegal, useLegal } from '../legal/useLegal';
import { formatDate } from '../lib/format';
import { toastError } from '../lib/notify';

/** Comptes créés avant la charte : invitation à la lire et à l'accepter (non bloquant). */
export default function TermsBanner() {
  const { user, acceptTerms } = useAuth();
  const { data } = useLegal();
  const [busy, setBusy] = useState(false);
  if (!user || user.impersonator || !data?.requireTerms || (user.terms_version || 0) >= data.termsVersion) return null;
  const changed = (user.terms_version || 0) > 0;

  const accept = async () => {
    setBusy(true);
    try {
      await acceptTerms(data.termsVersion);
    } catch (err) {
      toastError(err);
      setBusy(false);
      if (err.status === 409) {
        forgetLegal();
        window.location.reload();
      }
    }
  };

  return (
    <div className="border-b border-line bg-accent-soft" role="region" aria-label="Charte d’utilisation">
      <div className="shell flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
        {changed ? (
          <p className="flex-1 text-ink">
            La{' '}
            <Link to="/charte" className="font-semibold text-accent-strong underline">
              charte d’utilisation
            </Link>{' '}
            a été modifiée le {formatDate(data.termsUpdatedAt)}. Merci de la relire et de l’accepter à nouveau.
          </p>
        ) : (
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
        )}
        <button type="button" className="btn btn-primary py-1.5 text-sm" onClick={accept} disabled={busy}>
          J’ai lu et j’accepte
        </button>
      </div>
    </div>
  );
}

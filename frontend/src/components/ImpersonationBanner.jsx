import { useState } from 'react';
import { FiEye } from 'react-icons/fi';
import { useAuth } from '../auth/context';

/** Bandeau permanent pendant qu'un administrateur est à la place d'un utilisateur. */
export default function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  const [leaving, setLeaving] = useState(false);
  if (!user?.impersonator) return null;
  return (
    <div role="status" className="sticky top-0 z-50 bg-progress text-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <FiEye aria-hidden="true" className="shrink-0" />
        <p className="min-w-0 flex-1">
          Vous êtes à la place de <strong>{user.name}</strong>. Vos actions sont enregistrées à son nom, avec la mention « fait
          par {user.impersonator.name} ». Ses demandes confidentielles restent masquées.
        </p>
        <button
          type="button"
          className="rounded-md bg-surface px-3 py-1.5 font-semibold text-progress hover:bg-surface/90"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            stopImpersonating();
          }}
        >
          {leaving ? 'Retour…' : 'Revenir à mon compte'}
        </button>
      </div>
    </div>
  );
}

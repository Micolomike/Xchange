import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { Field, Spinner, ErrorState } from '../components/ui';
import { Logo } from '../components/Navbar';
import RecoveryCodes from '../components/RecoveryCodes';
import { toast } from '../lib/notify';

/**
 * Configuration de l'appli d'authentification (Microsoft Authenticator, Google Authenticator…).
 * Accessible juste après le mot de passe (étape « setup ») ou depuis « Mon compte » si la MFA n'est pas encore active.
 */
export default function MfaSetup() {
  const { user, challenge, startMfaSetup, confirmMfaSetup, finishMfaSetup, cancelChallenge } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [setup, setSetup] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);

  const pending = challenge?.kind === 'setup' ? challenge.user : null;
  const account = pending || user;
  const allowed = Boolean(pending || (user && !user.mfa_enabled));

  const load = () => {
    setLoadError(null);
    startMfaSetup().then(setSetup).catch(setLoadError);
  };

  useEffect(() => {
    // Un seul démarrage : chaque appel génère une nouvelle clé côté serveur.
    if (!allowed || started.current) return;
    started.current = true;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed && !result) return <Navigate to={user ? '/profile' : '/login'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      setResult(await confirmMfaSetup(code.replace(/\s/g, '')));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    finishMfaSetup(result);
    toast('Double authentification activée');
    navigate(pending ? from : '/profile', { replace: true });
  };

  const abandon = () => {
    cancelChallenge();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto max-w-xl pt-2">
      {pending && (
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
      )}
      <div className="panel p-6 sm:p-8">
        {!result ? (
          <>
            <h1 className="mb-1 text-xl font-bold">Activer la double authentification</h1>
            <p className="mb-6 text-sm text-ink-mute">
              En plus du mot de passe, Xchange vous demandera un code à 6 chiffres affiché par une appli sur votre téléphone.
              Cette étape est obligatoire pour tous les comptes.
            </p>

            {loadError ? (
              <ErrorState error={loadError} onRetry={load} />
            ) : !setup ? (
              <Spinner label="Préparation de votre clé…" />
            ) : (
              <ol className="space-y-6">
                <li>
                  <h2 className="font-semibold">1. Installez une appli d'authentification</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    Microsoft Authenticator, Google Authenticator, ou toute appli compatible (2FAS, Aegis, 1Password…), depuis
                    le Play Store ou l'App Store.
                  </p>
                </li>
                <li>
                  <h2 className="font-semibold">2. Ajoutez le compte Xchange</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    Dans l'appli, choisissez « Ajouter un compte » puis scannez ce QR code.
                  </p>
                  <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
                    <img
                      src={setup.qr}
                      alt="QR code à scanner avec l'appli d'authentification"
                      width="180"
                      height="180"
                      className="rounded-md border border-line"
                    />
                    <div className="min-w-0 text-sm">
                      <p className="text-ink-soft">Impossible de scanner ? Saisissez cette clé dans l'appli :</p>
                      <p
                        className="mt-2 break-words rounded-md bg-paper px-3 py-2 font-mono text-[0.95rem] tracking-wide text-ink"
                        data-testid="mfa-secret"
                      >
                        {setup.secret}
                      </p>
                      <a href={setup.otpauthUrl} className="mt-2 inline-block font-semibold text-accent-strong hover:underline">
                        Vous êtes sur votre téléphone ? Ouvrir dans l'appli
                      </a>
                    </div>
                  </div>
                </li>
                <li>
                  <h2 className="font-semibold">3. Saisissez le code affiché</h2>
                  <form onSubmit={submit} className="mt-3 space-y-4" noValidate>
                    <Field id="mfa-setup-code" label="Code à 6 chiffres" error={error}>
                      {(props) => (
                        <input
                          {...props}
                          name="code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={7}
                          className="field max-w-48 font-mono text-lg tracking-[0.3em]"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                          autoFocus
                        />
                      )}
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="btn btn-primary" disabled={submitting || code.replace(/\s/g, '').length !== 6}>
                        {submitting ? 'Vérification…' : 'Activer'}
                      </button>
                      {pending && (
                        <button type="button" className="btn btn-ghost" onClick={abandon}>
                          Annuler
                        </button>
                      )}
                    </div>
                  </form>
                </li>
              </ol>
            )}
          </>
        ) : (
          <>
            <h1 className="mb-1 text-xl font-bold">Gardez vos codes de secours</h1>
            <p className="mb-5 text-sm text-ink-soft">
              Si vous perdez votre téléphone, chacun de ces codes remplace une fois le code de l'appli. Rangez-les hors de ce
              PC (gestionnaire de mots de passe, papier) : ils ne seront plus affichés.
            </p>
            <RecoveryCodes codes={result.recoveryCodes} username={account.username} />
            <label className="mt-6 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              <span>J'ai enregistré mes codes de secours en lieu sûr.</span>
            </label>
            <button type="button" className="btn btn-primary mt-4 w-full" disabled={!saved} onClick={finish}>
              Continuer vers Xchange
            </button>
          </>
        )}
      </div>
    </div>
  );
}

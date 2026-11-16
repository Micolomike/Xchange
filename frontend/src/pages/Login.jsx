import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { Field } from '../components/ui';
import { Logo } from '../components/Navbar';
import { toast } from '../lib/notify';

/** Deuxième étape : code de l'appli d'authentification, ou code de secours. */
function CodeStep({ from }) {
  const { challenge, verifyMfa, cancelChallenge } = useAuth();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const clean = recovery ? code.replace(/[\s-]/g, '') : code.replace(/\s/g, '');
  const complete = recovery ? clean.length === 8 : clean.length === 6;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await verifyMfa(code.trim());
      if (data.usedRecoveryCode) {
        toast(
          `Code de secours utilisé : il vous en reste ${data.recoveryCodesLeft}. Pensez à en générer de nouveaux dans « Mon compte ».`,
          'warning'
        );
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
      if (err.status === 401 && /expir/i.test(err.message)) cancelChallenge();
    }
  };

  const toggle = () => {
    setRecovery((r) => !r);
    setCode('');
    setError(null);
  };

  return (
    <div className="panel p-6 sm:p-8">
      <h1 className="mb-1 text-xl font-bold">Vérification</h1>
      <p className="mb-6 text-sm text-ink-mute">
        {recovery
          ? 'Saisissez un de vos codes de secours (format xxxx-xxxx). Il ne servira qu\'une fois.'
          : `Ouvrez votre appli d'authentification et saisissez le code affiché pour Xchange (${challenge.user.username}).`}
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="login-code" label={recovery ? 'Code de secours' : 'Code à 6 chiffres'}>
          {(props) => (
            <input
              {...props}
              key={recovery ? 'recovery' : 'totp'}
              name="code"
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck="false"
              maxLength={recovery ? 9 : 7}
              className="field font-mono text-lg tracking-[0.2em]"
              value={code}
              onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/[^\d ]/g, ''))}
              autoFocus
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={submitting || !complete}>
          {submitting ? 'Vérification…' : 'Valider'}
        </button>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="font-semibold text-accent hover:underline" onClick={toggle}>
          {recovery ? "Utiliser le code de l'appli" : 'Utiliser un code de secours'}
        </button>
        <button type="button" className="text-ink-mute hover:text-ink hover:underline" onClick={cancelChallenge}>
          Changer de compte
        </button>
      </div>
      {recovery && (
        <p className="mt-4 text-xs text-ink-mute">
          Plus de téléphone ni de codes de secours ? Un administrateur peut réinitialiser votre double authentification.
        </p>
      )}
    </div>
  );
}

export default function Login() {
  const { user, login, registrationOpen, challenge } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  if (user) return <Navigate to={from} replace />;
  if (challenge?.kind === 'setup') return <Navigate to="/double-authentification" replace state={{ from }} />;
  if (challenge?.kind === 'mfa') {
    return (
      <div className="mx-auto max-w-sm pt-6">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <CodeStep from={from} />
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const next = await login(form.username.trim(), form.password);
      if (next.kind === 'session') navigate(from, { replace: true });
      else {
        setSubmitting(false);
        setForm((f) => ({ ...f, password: '' }));
      }
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <div className="mx-auto max-w-sm pt-6">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>
      <div className="panel p-6 sm:p-8">
        <h1 className="mb-6 text-xl font-bold">Se connecter</h1>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field id="login-username" label="Nom d'utilisateur">
            {(props) => (
              <input
                {...props}
                name="username"
                autoComplete="username"
                className="field"
                value={form.username}
                onChange={update}
                required
                autoFocus
              />
            )}
          </Field>
          <Field id="login-password" label="Mot de passe">
            {(props) => (
              <input
                {...props}
                name="password"
                type="password"
                autoComplete="current-password"
                className="field"
                value={form.password}
                onChange={update}
                required
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={submitting || !form.username || !form.password}>
            {submitting ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
      {registrationOpen && (
        <p className="mt-4 text-center text-sm text-ink-mute">
          Pas encore de compte ?{' '}
          <Link to="/register" className="font-semibold text-accent hover:underline">
            Créer un compte
          </Link>
        </p>
      )}
    </div>
  );
}

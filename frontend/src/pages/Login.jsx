import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { Field } from '../components/ui';
import { Logo } from '../components/Navbar';

export default function Login() {
  const { user, login, registrationOpen } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  if (user) return <Navigate to={from} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(form.username.trim(), form.password);
      navigate(from, { replace: true });
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

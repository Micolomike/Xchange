import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { Field } from '../components/ui';
import { Logo } from '../components/Navbar';
import { toast } from '../lib/notify';

export default function Register() {
  const { user, register, registrationOpen } = useAuth();
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    firstname: '',
    lastname: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  if (user) return <Navigate to="/" replace />;

  if (!registrationOpen) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-bold">Inscriptions fermées</h1>
        <p className="text-ink-mute">Demandez un compte à un administrateur de votre équipe.</p>
        <Link to="/login" className="btn btn-secondary mt-6">
          Se connecter
        </Link>
      </div>
    );
  }

  const update = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((errs) => ({ ...errs, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const local = {};
    if (form.password.length < 8) local.password = 'Au moins 8 caractères.';
    if (form.password !== form.confirmPassword) local.confirmPassword = 'Les deux mots de passe ne correspondent pas.';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSubmitting(true);
    try {
      const { confirmPassword: _ignored, ...payload } = form;
      const created = await register(payload);
      toast(created.role === 'admin' ? 'Compte créé : vous êtes administrateur' : 'Compte créé');
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(err.details || {});
      setError(err.message);
      setSubmitting(false);
    }
  };

  const input = (name, extra = {}) => (props) => (
    <input {...props} name={name} className="field" value={form[name]} onChange={update} {...extra} />
  );

  return (
    <div className="mx-auto max-w-md pt-2">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>
      <div className="panel p-6 sm:p-8">
        <h1 className="mb-1 text-xl font-bold">Créer un compte</h1>
        <p className="mb-6 text-sm text-ink-mute">Le premier compte créé devient administrateur.</p>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field id="reg-username" label="Nom d'utilisateur" required error={errors.username} hint="3 à 32 caractères, sans espace.">
            {input('username', { autoComplete: 'username', autoFocus: true })}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="reg-firstname" label="Prénom" error={errors.firstname}>
              {input('firstname', { autoComplete: 'given-name' })}
            </Field>
            <Field id="reg-lastname" label="Nom" error={errors.lastname}>
              {input('lastname', { autoComplete: 'family-name' })}
            </Field>
          </div>
          <Field id="reg-email" label="E-mail" error={errors.email}>
            {input('email', { type: 'email', autoComplete: 'email' })}
          </Field>
          <Field id="reg-password" label="Mot de passe" required error={errors.password} hint="Au moins 8 caractères.">
            {input('password', { type: 'password', autoComplete: 'new-password' })}
          </Field>
          <Field id="reg-confirm" label="Confirmer le mot de passe" required error={errors.confirmPassword}>
            {input('confirmPassword', { type: 'password', autoComplete: 'new-password' })}
          </Field>
          {error && !Object.keys(errors).some((k) => errors[k]) && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? 'Création du compte…' : 'Créer mon compte'}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-sm text-ink-mute">
        Déjà un compte ?{' '}
        <Link to="/login" className="font-semibold text-accent hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

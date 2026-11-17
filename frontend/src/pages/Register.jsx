import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { Field } from '../components/ui';
import { Logo } from '../components/Navbar';
import { toast } from '../lib/notify';
import { useLegal } from '../legal/useLegal';

export default function Register() {
  const { user, register, registrationOpen, challenge, joinableGroups } = useAuth();
  const [wantedGroups, setWantedGroups] = useState([]);
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
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [hideRealName, setHideRealName] = useState(false);
  const { data: legal } = useLegal();
  const navigate = useNavigate();

  if (user) return <Navigate to="/" replace />;
  if (challenge?.kind === 'setup') return <Navigate to="/double-authentification" replace />;

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
    if (legal?.requireTerms !== false && !acceptTerms) local.acceptTerms = 'Cochez cette case pour créer un compte.';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSubmitting(true);
    try {
      const { confirmPassword: _ignored, ...payload } = form;
      const next = await register({ ...payload, groups: wantedGroups, acceptTerms, hideRealName });
      toast(next.user.role === 'admin' ? 'Compte créé : vous êtes administrateur' : 'Compte créé');
      navigate(next.kind === 'setup' ? '/double-authentification' : '/', { replace: true });
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
          <Field
            id="reg-username"
            label="Nom d'utilisateur (pseudonyme)"
            required
            error={errors.username}
            hint="3 à 32 caractères, sans espace. Visible par tous."
          >
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
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={hideRealName} onChange={(e) => setHideRealName(e.target.checked)} />
            <span>
              N’afficher que mon pseudonyme
              <span className="block text-xs text-ink-mute">
                Les autres membres ne verront ni votre prénom ni votre nom. Les administrateurs les voient. Modifiable dans « Mon compte ».
              </span>
            </span>
          </label>
          <Field id="reg-email" label="E-mail" error={errors.email}>
            {input('email', { type: 'email', autoComplete: 'email' })}
          </Field>
          <Field id="reg-password" label="Mot de passe" required error={errors.password} hint="Au moins 8 caractères.">
            {input('password', { type: 'password', autoComplete: 'new-password' })}
          </Field>
          <Field id="reg-confirm" label="Confirmer le mot de passe" required error={errors.confirmPassword}>
            {input('confirmPassword', { type: 'password', autoComplete: 'new-password' })}
          </Field>
          {joinableGroups.length > 0 && (
            <fieldset>
              <legend className="label">Groupes d'entraide à rejoindre (facultatif)</legend>
              <p className="-mt-0.5 mb-2 text-xs text-ink-mute">
                Pour aider les autres dans un domaine. Un administrateur valide chaque demande ; vous pourrez en changer dans
                « Mon compte ».
              </p>
              <div className="flex flex-wrap gap-2">
                {joinableGroups.map((g) => (
                  <label
                    key={g.id}
                    title={g.description}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                      wantedGroups.includes(g.id) ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={wantedGroups.includes(g.id)}
                      onChange={() =>
                        setWantedGroups((list) => (list.includes(g.id) ? list.filter((x) => x !== g.id) : [...list, g.id]))
                      }
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {legal?.requireTerms !== false && (
            <div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={acceptTerms}
                  aria-invalid={Boolean(errors.acceptTerms)}
                  aria-describedby={errors.acceptTerms ? 'reg-terms-error' : undefined}
                  onChange={(e) => {
                    setAcceptTerms(e.target.checked);
                    setErrors((errs) => ({ ...errs, acceptTerms: undefined }));
                  }}
                />
                <span>
                  J’accepte la{' '}
                  <Link to="/charte" target="_blank" className="font-semibold text-accent-strong underline">
                    charte d’utilisation
                  </Link>{' '}
                  et la{' '}
                  <Link to="/confidentialite" target="_blank" className="font-semibold text-accent-strong underline">
                    politique de confidentialité
                  </Link>
                </span>
              </label>
              {errors.acceptTerms && (
                <p id="reg-terms-error" role="alert" className="mt-1 text-sm text-danger">
                  {errors.acceptTerms}
                </p>
              )}
            </div>
          )}
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
        <Link to="/login" className="font-semibold text-accent-strong hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

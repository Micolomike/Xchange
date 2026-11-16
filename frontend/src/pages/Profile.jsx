import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiShield } from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { api } from '../lib/api';
import RecoveryCodes from '../components/RecoveryCodes';
import { ROLES } from '../lib/constants';
import { toast, toastError } from '../lib/notify';
import { Field, PageHeader } from '../components/ui';

function MfaSection({ user }) {
  const [left, setLeft] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);

  useEffect(() => {
    api('/api/auth/me')
      .then((d) => setLeft(d.recoveryCodesLeft))
      .catch(() => {});
  }, []);

  const regenerate = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { recoveryCodes } = await api('/api/auth/mfa/recovery-codes', { method: 'POST', body: { code: code.replace(/\s/g, '') } });
      setCodes(recoveryCodes);
      setLeft(recoveryCodes.length);
      setCode('');
      toast('Nouveaux codes de secours créés ; les anciens ne fonctionnent plus');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mb-6 space-y-4 p-5 sm:p-6" aria-labelledby="mfa-title">
      <h2 id="mfa-title" className="flex items-center gap-2 font-bold">
        <FiShield aria-hidden="true" /> Double authentification
      </h2>
      {!user.mfa_enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">Pas encore activée sur ce compte.</p>
          <Link to="/double-authentification" className="btn btn-primary">
            Activer la double authentification
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            Activée : un code de votre appli d'authentification est demandé à chaque connexion.
            {left !== null && (
              <>
                {' '}
                Codes de secours restants : <strong className={left <= 2 ? 'text-danger' : 'text-ink'}>{left}</strong>.
              </>
            )}
          </p>
          <p className="text-sm text-ink-mute">
            Changement de téléphone : demandez à un administrateur de réinitialiser votre double authentification, puis
            reconfigurez-la à la connexion suivante.
          </p>
          {codes ? (
            <div>
              <p className="mb-3 text-sm font-semibold">Vos nouveaux codes, affichés une seule fois :</p>
              <RecoveryCodes codes={codes} username={user.username} />
            </div>
          ) : (
            <form onSubmit={regenerate} className="flex flex-wrap items-end gap-3" noValidate>
              <Field id="p-mfa-code" label="Code de l'appli, pour créer de nouveaux codes de secours" error={error}>
                {(p) => (
                  <input
                    {...p}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    className="field max-w-40 font-mono tracking-[0.2em]"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                  />
                )}
              </Field>
              <button type="submit" className="btn btn-secondary" disabled={busy || code.replace(/\s/g, '').length !== 6}>
                {busy ? 'Création…' : 'Nouveaux codes de secours'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const [info, setInfo] = useState({ firstname: user.firstname, lastname: user.lastname, email: user.email });
  const [infoErrors, setInfoErrors] = useState({});
  const [savingInfo, setSavingInfo] = useState(false);

  const [pwd, setPwd] = useState({ currentPassword: '', password: '', confirm: '' });
  const [pwdErrors, setPwdErrors] = useState({});
  const [savingPwd, setSavingPwd] = useState(false);

  const saveInfo = async (e) => {
    e.preventDefault();
    setSavingInfo(true);
    try {
      await updateProfile(info);
      setInfoErrors({});
      toast('Profil enregistré');
    } catch (err) {
      setInfoErrors(err.details || {});
      toastError(err);
    } finally {
      setSavingInfo(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pwd.password !== pwd.confirm) {
      setPwdErrors({ confirm: 'Les deux mots de passe ne correspondent pas.' });
      return;
    }
    setSavingPwd(true);
    try {
      await updateProfile({ currentPassword: pwd.currentPassword, password: pwd.password });
      setPwd({ currentPassword: '', password: '', confirm: '' });
      setPwdErrors({});
      toast('Mot de passe changé ; vos autres sessions sont fermées');
    } catch (err) {
      setPwdErrors(err.details || {});
      toastError(err);
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mon compte">
        {user.username}, {ROLES[user.role].toLowerCase()}
      </PageHeader>

      <form onSubmit={saveInfo} className="panel mb-6 space-y-4 p-5 sm:p-6" noValidate>
        <h2 className="font-bold">Informations</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="p-firstname" label="Prénom" error={infoErrors.firstname}>
            {(p) => <input {...p} className="field" value={info.firstname} onChange={(e) => setInfo({ ...info, firstname: e.target.value })} />}
          </Field>
          <Field id="p-lastname" label="Nom" error={infoErrors.lastname}>
            {(p) => <input {...p} className="field" value={info.lastname} onChange={(e) => setInfo({ ...info, lastname: e.target.value })} />}
          </Field>
        </div>
        <Field id="p-email" label="E-mail" error={infoErrors.email}>
          {(p) => <input {...p} type="email" className="field" value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} />}
        </Field>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={savingInfo}>
            {savingInfo ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>

      <MfaSection user={user} />

      <form onSubmit={savePassword} className="panel space-y-4 p-5 sm:p-6" noValidate>
        <h2 className="font-bold">Mot de passe</h2>
        <Field id="p-current" label="Mot de passe actuel" required error={pwdErrors.currentPassword}>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              className="field"
              value={pwd.currentPassword}
              onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="p-new" label="Nouveau mot de passe" required error={pwdErrors.password} hint="Au moins 8 caractères.">
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="new-password"
                className="field"
                value={pwd.password}
                onChange={(e) => setPwd({ ...pwd, password: e.target.value })}
              />
            )}
          </Field>
          <Field id="p-confirm" label="Confirmation" required error={pwdErrors.confirm}>
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="new-password"
                className="field"
                value={pwd.confirm}
                onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={savingPwd || !pwd.currentPassword || !pwd.password}>
            {savingPwd ? 'Changement…' : 'Changer le mot de passe'}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useState } from 'react';
import { useAuth } from '../auth/context';
import { ROLES } from '../lib/constants';
import { toast, toastError } from '../lib/notify';
import { Field, PageHeader } from '../components/ui';

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

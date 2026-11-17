import { useCallback, useEffect, useMemo, useState } from 'react';
import { trustedDevice } from '../lib/trustedDevice';
import { api, impersonation, setUnauthorizedHandler, tokenStore } from '../lib/api';
import { AuthContext } from './context';

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // loading : vérification du jeton en cours ; error : serveur injoignable ; ready : état connu.
  const [status, setStatus] = useState(() => (tokenStore.get() ? 'loading' : 'ready'));
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [joinableGroups, setJoinableGroups] = useState([]);
  // Étape intermédiaire après le mot de passe : { kind: 'mfa' | 'setup', token, user }.
  const [challenge, setChallenge] = useState(null);
  const [trustedDeviceDays, setTrustedDeviceDays] = useState(30);

  const clearSession = useCallback(() => {
    // Fin (ou expiration) d'une prise de contrôle : retour à la session de l'administrateur.
    if (impersonation.restore()) {
      window.location.assign('/admin');
      return;
    }
    tokenStore.clear();
    setUser(null);
    setChallenge(null);
  }, []);

  const loadSession = useCallback(async () => {
    if (!tokenStore.get()) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      const { user: me } = await api('/api/auth/me');
      setUser(me);
      setStatus('ready');
    } catch (err) {
      if (err.status === 401) {
        clearSession();
        setStatus('ready');
      } else {
        setStatus('error');
      }
    }
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    loadSession();
    api('/api/auth/config', { auth: false })
      .then((cfg) => {
        setRegistrationOpen(cfg.registrationOpen);
        setJoinableGroups(cfg.joinableGroups || []);
        setTrustedDeviceDays(cfg.trustedDeviceDays || 30);
      })
      .catch(() => {});
  }, [clearSession, loadSession]);

  const openSession = useCallback((data) => {
    tokenStore.set(data.token);
    setChallenge(null);
    setUser(data.user);
    setStatus('ready');
    // Les droits (groupes, matrice) arrivent avec /me.
    api('/api/auth/me')
      .then(({ user: me }) => setUser(me))
      .catch(() => {});
    return data.user;
  }, []);

  /** Réponse du serveur après le mot de passe : session ouverte, ou étape de double authentification. */
  const afterPassword = useCallback(
    (data) => {
      if (data.mfaRequired) {
        const next = { kind: 'mfa', token: data.mfaToken, user: data.user };
        setChallenge(next);
        return next;
      }
      if (data.mfaSetupRequired) {
        const next = { kind: 'setup', token: data.setupToken, user: data.user };
        setChallenge(next);
        return next;
      }
      openSession(data);
      return { kind: 'session', user: data.user };
    },
    [openSession]
  );

  const login = useCallback(
    async (username, password) => {
      const deviceToken = trustedDevice.get(username);
      const data = await api('/api/auth/login', { method: 'POST', body: { username, password, deviceToken }, auth: false });
      if (data.deviceRejected) trustedDevice.remove(username);
      return afterPassword(data);
    },
    [afterPassword]
  );

  const register = useCallback(
    async (form) => afterPassword(await api('/api/auth/register', { method: 'POST', body: form, auth: false })),
    [afterPassword]
  );

  const verifyMfa = useCallback(
    async (code, remember = false) => {
      const data = await api('/api/auth/mfa/verify', {
        method: 'POST',
        body: { mfaToken: challenge?.token, code, remember },
        auth: false,
      });
      if (data.deviceToken) trustedDevice.set(data.user.username, data.deviceToken, data.deviceExpiresAt);
      openSession(data);
      return data;
    },
    [challenge, openSession]
  );

  // Configuration de l'appli : avec le jeton d'étape « setup », ou avec la session si le compte n'a pas encore de MFA.
  const startMfaSetup = useCallback(
    () =>
      challenge?.kind === 'setup'
        ? api('/api/auth/mfa/setup/start', { method: 'POST', body: { setupToken: challenge.token }, auth: false })
        : api('/api/auth/mfa/setup/start', { method: 'POST', body: {} }),
    [challenge]
  );

  /** Valide le premier code ; la session n'est ouverte qu'avec finishMfaSetup, après lecture des codes de secours. */
  const confirmMfaSetup = useCallback(
    (code) =>
      challenge?.kind === 'setup'
        ? api('/api/auth/mfa/setup/confirm', { method: 'POST', body: { setupToken: challenge.token, code }, auth: false })
        : api('/api/auth/mfa/setup/confirm', { method: 'POST', body: { code } }),
    [challenge]
  );

  /** Refus de la double authentification, risques acceptés : la session s'ouvre sans code. */
  const declineMfa = useCallback(
    async () =>
      openSession(
        challenge?.kind === 'setup'
          ? await api('/api/auth/mfa/decline', { method: 'POST', body: { setupToken: challenge.token, acknowledge: true }, auth: false })
          : await api('/api/auth/mfa/decline', { method: 'POST', body: { acknowledge: true } })
      ),
    [challenge, openSession]
  );

  const cancelChallenge = useCallback(() => setChallenge(null), []);

  const impersonate = useCallback(async (target) => {
    const { token } = await api(`/api/users/${target.id}/impersonate`, { method: 'POST' });
    impersonation.start(token);
    window.location.assign('/');
  }, []);

  const stopImpersonating = useCallback(async () => {
    await api('/api/auth/impersonate/stop', { method: 'POST' }).catch(() => {});
    if (impersonation.restore()) window.location.assign('/admin');
  }, []);

  // Se déconnecter pendant une prise de contrôle ramène à la session de l'administrateur.
  const logout = useCallback(() => {
    if (impersonation.active()) stopImpersonating();
    else clearSession();
  }, [clearSession, stopImpersonating]);

  const updateProfile = useCallback(
    async (body) => openSession(await api('/api/auth/me', { method: 'PUT', body })),
    [openSession]
  );

  const acceptTerms = useCallback(
    async (version) => openSession(await api('/api/auth/me/accept-terms', { method: 'POST', body: { version } })),
    [openSession]
  );

  const value = useMemo(
    () => ({
      user,
      status,
      isAdmin: user?.role === 'admin',
      canCreate: Boolean(user) && (user.role === 'admin' || user.access?.rights?.create !== false),
      registrationOpen,
      joinableGroups,
      trustedDeviceDays,
      challenge,
      login,
      register,
      verifyMfa,
      startMfaSetup,
      confirmMfaSetup,
      finishMfaSetup: openSession,
      cancelChallenge,
      declineMfa,
      logout,
      impersonate,
      stopImpersonating,
      updateProfile,
      acceptTerms,
      retry: loadSession,
    }),
    [
      user,
      status,
      registrationOpen,
      joinableGroups,
      trustedDeviceDays,
      challenge,
      login,
      register,
      verifyMfa,
      startMfaSetup,
      confirmMfaSetup,
      openSession,
      cancelChallenge,
      declineMfa,
      logout,
      impersonate,
      stopImpersonating,
      updateProfile,
      acceptTerms,
      loadSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

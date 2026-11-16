import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../lib/api';
import { AuthContext } from './context';

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // loading : vérification du jeton en cours ; error : serveur injoignable ; ready : état connu.
  const [status, setStatus] = useState(() => (tokenStore.get() ? 'loading' : 'ready'));
  const [registrationOpen, setRegistrationOpen] = useState(true);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
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
      .then((cfg) => setRegistrationOpen(cfg.registrationOpen))
      .catch(() => {});
  }, [clearSession, loadSession]);

  const openSession = useCallback((data) => {
    tokenStore.set(data.token);
    setUser(data.user);
    setStatus('ready');
    return data.user;
  }, []);

  const login = useCallback(
    async (username, password) =>
      openSession(await api('/api/auth/login', { method: 'POST', body: { username, password }, auth: false })),
    [openSession]
  );

  const register = useCallback(
    async (form) => openSession(await api('/api/auth/register', { method: 'POST', body: form, auth: false })),
    [openSession]
  );

  const updateProfile = useCallback(
    async (body) => openSession(await api('/api/auth/me', { method: 'PUT', body })),
    [openSession]
  );

  const value = useMemo(
    () => ({
      user,
      status,
      isAdmin: user?.role === 'admin',
      registrationOpen,
      login,
      register,
      logout: clearSession,
      updateProfile,
      retry: loadSession,
    }),
    [user, status, registrationOpen, login, register, clearSession, updateProfile, loadSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

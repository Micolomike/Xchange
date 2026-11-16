import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, api } from '../lib/api';
import { SettingsContext } from './context';
import { applySettings } from './apply';

const FALLBACK = { appName: 'Xchange', primaryColor: '#2f4bd8', homeTitle: '', homeText: '', logoUrl: null };

function withLogo(data) {
  return { ...data, logoSrc: data.logoUrl ? `${API_BASE_URL}${data.logoUrl}` : null };
}

/** Charge les paramètres publics (nom, couleur, logo, listes) avant d'afficher l'application. */
export default function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);

  const update = useCallback((data) => {
    const next = withLogo(data);
    applySettings(next);
    setSettings(next);
    return next;
  }, []);

  useEffect(() => {
    api('/api/settings', { auth: false })
      .then(update)
      // Serveur injoignable : valeurs par défaut, l'écran d'erreur habituel prendra le relais.
      .catch(() => update(FALLBACK));
  }, [update]);

  const value = useMemo(() => (settings ? { settings, update } : null), [settings, update]);
  if (!value) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

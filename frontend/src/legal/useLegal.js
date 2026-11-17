import { useEffect, useState } from 'react';
import { api } from '../lib/api';

let cache = null;

/** Textes juridiques publics (mentions légales, confidentialité, charte), chargés une fois par visite. */
export function useLegal() {
  const [data, setData] = useState(cache);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (cache) return;
    api('/api/legal', { auth: false })
      .then((d) => {
        cache = d;
        setData(d);
      })
      .catch(setError);
  }, []);
  return { data, error };
}

/** Après une modification dans l'Administration : la prochaine lecture recharge les textes. */
export function forgetLegal() {
  cache = null;
}

export const LEGAL_PAGES = [
  { key: 'legalNotice', path: '/mentions-legales', title: 'Mentions légales' },
  { key: 'privacyPolicy', path: '/confidentialite', title: 'Politique de confidentialité' },
  { key: 'charter', path: '/charte', title: 'Charte d’utilisation' },
];

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

let cache = null;
let pending = null;

/** Options des Analyses (périodes, axes, groupes, formulaires…), chargées une fois par page. */
export function useMeta() {
  const [meta, setMeta] = useState(cache);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (cache) return;
    pending ??= api('/api/analytics/meta').finally(() => {
      pending = null;
    });
    pending
      .then((m) => {
        cache = m;
        setMeta(m);
        // Les groupes ou formulaires peuvent changer : on rechargera à la prochaine visite.
        setTimeout(() => {
          cache = null;
        }, 60_000);
      })
      .catch(setError);
  }, []);
  return { meta, error };
}

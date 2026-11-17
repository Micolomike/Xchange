/**
 * Navigateurs de confiance : jeton gardé dans ce navigateur, par compte, pour ne pas redemander
 * le code de double authentification jusqu'à son expiration (le serveur reste seul juge).
 */
const KEY = 'xchange.trustedDevices';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function write(all) {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : le code sera demandé */
  }
}

const norm = (username) => String(username || '').trim().toLowerCase();

export const trustedDevice = {
  get(username) {
    const entry = read()[norm(username)];
    if (!entry || !entry.token || new Date(entry.expiresAt) <= new Date()) return undefined;
    return entry.token;
  },
  set(username, token, expiresAt) {
    write({ ...read(), [norm(username)]: { token, expiresAt } });
  },
  remove(username) {
    const all = read();
    delete all[norm(username)];
    write(all);
  },
};

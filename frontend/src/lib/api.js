const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const API_BASE_URL = BASE_URL;
const TOKEN_KEY = 'xchange.token';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* stockage indisponible : la session ne survivra pas au rechargement */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* rien à faire */
    }
  },
};

// Prise de contrôle (impersonate) : la session de l'administrateur est mise de côté.
const ADMIN_TOKEN_KEY = 'xchange.adminToken';
export const impersonation = {
  active() {
    try {
      return Boolean(localStorage.getItem(ADMIN_TOKEN_KEY));
    } catch {
      return false;
    }
  },
  start(token) {
    try {
      localStorage.setItem(ADMIN_TOKEN_KEY, tokenStore.get());
    } catch {
      /* rien */
    }
    tokenStore.set(token);
  },
  /** Reprend la session de l'administrateur ; renvoie false s'il n'y en avait pas. */
  restore() {
    try {
      const admin = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (!admin) return false;
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      tokenStore.set(admin);
      return true;
    } catch {
      return false;
    }
  },
};

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Appel à l'API Xchange. Renvoie le JSON décodé ou lève une ApiError
 * avec le message français renvoyé par le serveur.
 */
export async function api(path, { method = 'GET', body, query, auth = true, raw = false } = {}) {
  const headers = {};
  const token = auth ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}${buildQuery(query)}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(
      "Impossible de joindre le serveur. S'il était en veille, il peut mettre jusqu'à une minute à redémarrer : réessayez.",
      0
    );
  }

  if (raw && res.ok) return res;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (res.status === 401 && token && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(data?.error || `Erreur inattendue (${res.status}).`, res.status, data?.details);
  }
  return data;
}

/** Télécharge une pièce jointe (la route exige le jeton, d'où le passage par un blob). */
export async function downloadAttachment(attachment) {
  const res = await api(`/api/attachments/${attachment.id}`, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

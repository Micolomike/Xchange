import { expect } from '@playwright/test';

export const API = 'http://localhost:4000';

export const ADMIN = { username: 'swann', password: 'motdepasse1', firstname: 'Swann', lastname: 'Martin' };
export const AGENT = { username: 'karim', password: 'motdepasse1', firstname: 'Karim', lastname: 'Benali' };
export const USER = { username: 'ines', password: 'motdepasse1', firstname: 'Inès', lastname: 'Roux' };

/** Appel direct à l'API (préparation des données). */
export async function api(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

export async function login(user) {
  return (await api('POST', '/api/auth/login', { username: user.username, password: user.password })).token;
}

/** Date AAAA-MM-JJ décalée de `days` jours par rapport à aujourd'hui (heure de Paris). */
export function day(days) {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

/** Relève les erreurs JavaScript non interceptées de la page. */
export function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

export async function expectNoHorizontalOverflow(page) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth, 'la page ne doit pas défiler horizontalement').toBeLessThanOrEqual(innerWidth);
}

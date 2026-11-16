import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';

// Calcul des codes de l'appli d'authentification avec le module du serveur.
const mfa = createRequire(import.meta.url)('../../backend/src/mfa.js');

export const API = 'http://127.0.0.1:4000';

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

// Clés MFA des comptes de test, partagées entre projets (processus distincts) par un fichier.
const SECRETS = path.join(process.env.XCHANGE_E2E_DATA, 'e2e-mfa.json');
const readSecrets = () => {
  try {
    return JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
  } catch {
    return {};
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function saveSecret(username, secret) {
  const all = readSecrets();
  all[username] = { secret: secret.replace(/\s/g, ''), lastStep: 0 };
  fs.writeFileSync(SECRETS, JSON.stringify(all));
}

/** Code valide et jamais utilisé (le serveur refuse de réutiliser un code). */
export async function nextCode(username) {
  const all = readSecrets();
  const entry = all[username];
  if (!entry) throw new Error(`pas de clé MFA connue pour ${username}`);
  const step = Math.max(entry.lastStep + 1, mfa.currentStep() - 1);
  while (step > mfa.currentStep() + 1) await sleep(250);
  entry.lastStep = step;
  fs.writeFileSync(SECRETS, JSON.stringify(all));
  return mfa.totp(entry.secret, step);
}

/** Connexion par l'API, avec configuration de l'appli au premier passage ; renvoie le jeton de session. */
export async function login(user) {
  const res = await api('POST', '/api/auth/login', { username: user.username, password: user.password });
  if (res.token) return res.token;
  if (res.mfaRequired) {
    return (await api('POST', '/api/auth/mfa/verify', { mfaToken: res.mfaToken, code: await nextCode(user.username) })).token;
  }
  const { secret } = await api('POST', '/api/auth/mfa/setup/start', { setupToken: res.setupToken });
  saveSecret(user.username, secret);
  const done = await api('POST', '/api/auth/mfa/setup/confirm', { setupToken: res.setupToken, code: await nextCode(user.username) });
  return done.token;
}

/** Configure l'appli depuis l'écran affiché après le mot de passe ; renvoie les codes de secours. */
export async function completeMfaSetup(page, username) {
  await expect(page.getByRole('heading', { name: 'Activer la double authentification' })).toBeVisible();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  saveSecret(username, await page.getByTestId('mfa-secret').innerText());
  await page.fill('#mfa-setup-code', await nextCode(username));
  await page.getByRole('button', { name: 'Activer' }).click();
  await expect(page.getByRole('heading', { name: 'Gardez vos codes de secours' })).toBeVisible();
  const codes = await page.getByRole('list', { name: 'Codes de secours' }).locator('li').allInnerTexts();
  await expect(page.getByRole('button', { name: 'Continuer vers Xchange' })).toBeDisabled();
  await page.getByLabel("J'ai enregistré mes codes de secours en lieu sûr.").check();
  await page.getByRole('button', { name: 'Continuer vers Xchange' }).click();
  return codes;
}

/** Saisit le code de l'appli à l'écran « Vérification ». */
export async function enterMfaCode(page, username) {
  await expect(page.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  await page.fill('#login-code', await nextCode(username));
  await page.getByRole('button', { name: 'Valider' }).click();
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

import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { ADMIN, AGENT, USER, api, day, login, trackPageErrors } from './helpers.js';

// Un seul parcours, étape par étape, dans le même onglet (la session est conservée).
test.describe.configure({ mode: 'serial' });

let page;
let pageErrors;
let ids = [];
let createdId;
let tempPassword;

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, acceptDownloads: true });
  page = await context.newPage();
  pageErrors = trackPageErrors(page);
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) pageErrors.push(msg.text());
  });
});

test.afterAll(async () => {
  await page.context().close();
});

test('un visiteur voit la page d’accueil', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('suivie jusqu');
  await expect(page.getByRole('link', { name: 'Se connecter' }).first()).toBeVisible();
});

test('le premier inscrit devient administrateur', async () => {
  await page.getByRole('link', { name: 'Créer un compte' }).first().click();
  await page.fill('#reg-username', ADMIN.username);
  await page.fill('#reg-firstname', ADMIN.firstname);
  await page.fill('#reg-lastname', ADMIN.lastname);
  await page.fill('#reg-email', 'swann@exemple.fr');
  await page.fill('#reg-password', ADMIN.password);
  await page.fill('#reg-confirm', 'autre-chose');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByText('Les deux mots de passe ne correspondent pas.')).toBeVisible();

  await page.fill('#reg-confirm', ADMIN.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByRole('heading', { name: `Bonjour ${ADMIN.firstname}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toBeVisible();
});

test('préparation des données par l’API', async () => {
  const admin = await login(ADMIN);
  const karim = await api('POST', '/api/users', { ...AGENT, role: 'admin' }, admin);
  await api('POST', '/api/users', { ...USER, email: 'ines@exemple.fr' }, admin);
  const ines = await login(USER);
  const k = await login(AGENT);

  const seed = [
    ['Le VPN se coupe toutes les dix minutes', 'high', 'support', day(-2)],
    ['Accès au dossier partagé Comptabilité', 'medium', 'support', day(3)],
    ['Bouton « Exporter » sans effet sur Firefox', 'high', 'bug', day(1)],
    ['Ajouter un filtre par site dans le reporting', 'low', 'feature', null],
    ['Écran secondaire non détecté après mise à jour', 'medium', 'bug', day(-5)],
    ['Commande de deux claviers', 'low', '', null],
    ['Badge d’accès désactivé', 'high', 'support', day(0)],
  ];
  ids = [];
  for (const [title, priority, category, due_date] of seed) {
    const t = await api('POST', '/api/tickets', { title, description: `${title}.`, priority, category, due_date }, ines);
    ids.push(t.id);
  }
  await api('PATCH', `/api/tickets/${ids[0]}`, { assigned_to: karim.id, status: 'in_progress' }, admin);
  await api('POST', `/api/tickets/${ids[0]}/comments`, { body: 'Je regarde les journaux du concentrateur VPN.' }, k);
  await api('PATCH', `/api/tickets/${ids[1]}`, { assigned_to: karim.id }, admin);
  await api('PATCH', `/api/tickets/${ids[1]}`, { status: 'resolved' }, k);
  await api('PATCH', `/api/tickets/${ids[3]}`, { status: 'closed' }, admin);
  await api('PATCH', `/api/tickets/${ids[4]}`, { assigned_to: 1 }, admin);
  await api('PATCH', `/api/tickets/${ids[6]}`, { assigned_to: 1, status: 'in_progress' }, admin);
});

test('création d’un ticket avec pièce jointe', async () => {
  await page.getByRole('link', { name: 'Nouveau ticket' }).first().click();
  await page.getByRole('button', { name: 'Créer le ticket' }).click();
  await expect(page.getByText('Donnez un titre court qui résume la demande.')).toBeVisible();

  await page.fill('#ticket-title', 'Imprimante du 2e étage hors ligne');
  await page.fill('#ticket-description', "L'imprimante du 2e étage apparaît hors ligne.\nRedémarrage déjà tenté.");
  await page.locator('label', { hasText: 'Haute' }).click();
  await page.selectOption('#ticket-category', 'support');
  await page.fill('#ticket-due', day(2));
  await page.selectOption('#ticket-assignee', { label: 'Karim Benali (karim)' });
  await page.setInputFiles('input[type=file]', {
    name: 'journal réseau.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ping 10.0.2.15 : délai dépassé'),
  });
  await expect(page.getByText('journal réseau.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Créer le ticket' }).click();

  await expect(page.getByRole('heading', { name: 'Imprimante du 2e étage hors ligne' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'journal réseau.txt', exact: true })).toBeVisible();
  createdId = Number(page.url().split('/').pop());
  expect(createdId).toBeGreaterThan(0);
});

test('commentaire, prise en charge, historique et téléchargement', async () => {
  await page.fill('#comment', 'Le câble réseau était débranché, je le remets.');
  await page.getByRole('button', { name: 'Commenter' }).click();
  await expect(page.getByText('Le câble réseau était débranché')).toBeVisible();

  await page.getByRole('button', { name: 'Prendre en charge' }).click();
  await expect(page.getByText('a passé le statut de « Ouvert » à « En cours »')).toBeVisible();
  const firstEvent = page.locator('section[aria-labelledby=activity-title] ol > li').first();
  await expect(firstEvent).toContainText('a créé le ticket');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'journal réseau.txt', exact: true }).click();
  const download = await downloadPromise;
  // On contrôle le contenu plutôt que le nom : Playwright 1.65 renvoie « download »
  // comme nom suggéré dès qu'il contient des accents (Playwright 1.63 renvoie le bon nom).
  const content = await fs.readFile(await download.path(), 'utf8');
  expect(content).toBe('ping 10.0.2.15 : délai dépassé');
});

test('liste : recherche et filtres', async () => {
  await page.getByRole('link', { name: 'Tickets', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByText('6 tickets', { exact: true })).toBeVisible();

  await page.fill('input[type=search]', 'vpn');
  await expect(page.getByText('1 ticket', { exact: true })).toBeVisible();
  await page.fill('input[type=search]', '');

  await page.getByRole('button', { name: 'Tous', exact: true }).click();
  await expect(page.getByText('8 tickets', { exact: true })).toBeVisible();
  await page.selectOption('select[aria-label="Responsable"]', 'unassigned');
  await expect(page.getByText('3 tickets', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).first().click();
});

test('tableau de bord et accès aux tickets en retard', async () => {
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await expect(page.getByRole('heading', { name: 'Ma file' })).toBeVisible();
  await expect(page.locator('figure svg')).toBeVisible();
  await page.locator('a[href="/tickets?overdue=1"]').click();
  await expect(page).toHaveURL(/\/tickets\?overdue=1$/);
  await expect(page.getByText('2 tickets', { exact: true })).toBeVisible();
});

test('corbeille puis administration des comptes', async () => {
  await page.goto(`/tickets/${ids[5]}`);
  await page.getByRole('button', { name: 'Mettre à la corbeille' }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page).toHaveURL(/\/tickets$/);

  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page.getByText('3 comptes, dont 2 administrateurs')).toBeVisible();

  await page.getByRole('button', { name: `Réinitialiser le mot de passe de ${USER.username}` }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByText('Mot de passe réinitialisé')).toBeVisible();
  tempPassword = (await page.locator('.swal2-html-container code').innerText()).trim();
  expect(tempPassword).toHaveLength(12);
  await page.locator('.swal2-confirm').click();

  await page.getByRole('tab', { name: 'Corbeille' }).click();
  await expect(page.getByText('Commande de deux claviers')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurer' }).click();
  await expect(page.getByText('La corbeille est vide')).toBeVisible();
});

test('un utilisateur simple a des droits restreints', async () => {
  await page.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
  // Depuis une page protégée, la déconnexion ramène à l'accueil (pas à /login).
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('suivie jusqu');

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
  await page.fill('#login-username', USER.username);
  await page.fill('#login-password', USER.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Identifiants invalides.')).toBeVisible();

  await page.fill('#login-password', tempPassword);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: `Bonjour ${USER.firstname}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);

  await page.goto(`/tickets/${createdId}`);
  await expect(page.getByText('Ticket introuvable.')).toBeVisible();

  await page.goto(`/tickets/${ids[0]}`);
  await expect(page.getByRole('button', { name: 'Modifier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mettre à la corbeille' })).toHaveCount(0);
});

test('page inconnue et absence d’erreur JavaScript', async () => {
  await page.goto('/nimporte-quoi');
  await expect(page.getByText("Cette page n'existe pas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

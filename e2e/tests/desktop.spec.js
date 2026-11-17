import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { ADMIN, AGENT, USER, api, completeMfaSetup, day, enterMfaCode, login, nextCode, trackPageErrors } from './helpers.js';

// Un seul parcours, étape par étape, dans le même onglet (la session est conservée).
test.describe.configure({ mode: 'serial' });

let page;
let pageErrors;
let ids = [];
let createdId;
let tempPassword;
let adminRecoveryCodes;

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
  await expect(page.getByText('Cochez cette case pour créer un compte.')).toBeVisible();

  await page.fill('#reg-confirm', ADMIN.password);
  await page.getByRole('checkbox', { name: /J’accepte la charte/ }).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  // La double authentification est obligatoire : configuration de l'appli avant d'entrer.
  await expect(page).toHaveURL(/\/double-authentification$/);
  await page.fill('#mfa-setup-code', '000000');
  await page.getByRole('button', { name: 'Activer' }).click();
  await expect(page.getByText(/Code incorrect/)).toBeVisible();
  adminRecoveryCodes = await completeMfaSetup(page, ADMIN.username);
  expect(adminRecoveryCodes).toHaveLength(10);
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

  // Inès a « perdu son téléphone » : l'administrateur réinitialise sa double authentification.
  await page.getByRole('button', { name: `Réinitialiser la double authentification de ${USER.username}` }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByText(`Double authentification de ${USER.username} réinitialisée`)).toBeVisible();
  await expect(page.getByRole('button', { name: `Réinitialiser la double authentification de ${USER.username}` })).toBeDisabled();

  // Dispense puis retour à l'obligation, depuis la table des utilisateurs.
  await page.getByRole('button', { name: `Dispenser ${AGENT.username} de la double authentification` }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByRole('row', { name: new RegExp(AGENT.username) })).toContainText('Dispensé');
  await page.getByRole('button', { name: `Exiger la double authentification pour ${AGENT.username}` }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByRole('row', { name: new RegExp(AGENT.username) })).toContainText('À configurer');

  await page.getByRole('tab', { name: 'Corbeille' }).click();
  await expect(page.getByText('Commande de deux claviers')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurer' }).click();
  await expect(page.getByText('La corbeille est vide')).toBeVisible();
});

test("groupes d'affectation", async () => {
  await page.getByRole('tab', { name: 'Groupes' }).click();
  await expect(page.getByText("Aucun groupe pour l'instant")).toBeVisible();
  await page.getByRole('button', { name: 'Nouveau groupe' }).click();
  await page.fill('#g-name', 'Support informatique');
  await page.fill('#g-description', 'Postes, réseau et imprimantes');
  await page.getByPlaceholder('Filtrer par nom').fill('kar');
  await page.locator('fieldset').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Créer le groupe' }).click();
  const row = page.getByRole('row', { name: /Support informatique/ });
  await expect(row).toContainText('1 membre');

  // Une demande envoyée au groupe s'affiche avec son groupe et son historique.
  const token = await login(ADMIN);
  const groups = await api('GET', '/api/groups', undefined, token);
  const ticket = await api(
    'POST',
    '/api/tickets',
    { title: 'Écran qui clignote', description: 'Depuis ce matin.', priority: 'medium', assigned_group: groups[0].id },
    token
  );
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.getByLabel("Groupe d'affectation")).toHaveValue(String(groups[0].id));
  await expect(page.getByText('a affecté le ticket au groupe Support informatique')).toBeVisible();
  // Responsables proposés : les seuls membres du groupe.
  await expect(page.getByLabel('Responsable').locator('option')).toHaveText(['Personne', 'Karim Benali']);
  await page.goto('/admin?tab=groups');
});

test('catalogue : construire un formulaire puis l’utiliser', async () => {
  await page.goto('/admin?tab=catalog');
  await expect(page.getByText("Aucun formulaire pour l'instant")).toBeVisible();
  await page.getByRole('link', { name: 'Nouveau formulaire' }).click();
  await page.fill('#fb-name', 'Matériel en panne');
  await page.fill('#fb-section', 'Informatique');
  await page.fill('#fb-description', 'Écran, clavier ou imprimante qui ne fonctionne plus.');
  await page.selectOption('#fb-group', { label: 'Support informatique' });
  await page.selectOption('#fb-priority', 'high');

  const questions = page.locator('section[aria-labelledby=fb-questions] ol > li');
  await page.getByRole('button', { name: 'Ajouter une question' }).click();
  await page.getByRole('button', { name: /^Texte court/ }).click();
  await questions.nth(0).getByLabel('Libellé').fill('Numéro du poste');
  await questions.nth(0).getByLabel('Obligatoire').check();
  await questions.nth(0).getByLabel('Ajouter la réponse au titre du ticket').check();

  await page.getByRole('button', { name: 'Ajouter une question' }).click();
  await page.getByRole('button', { name: /^Boutons de choix/ }).click();
  await questions.nth(1).getByLabel('Libellé').fill('Type de matériel');
  await questions.nth(1).getByLabel('Choix proposés').fill('Écran\nClavier\nAutre');

  await page.getByRole('button', { name: 'Ajouter une question' }).click();
  await page.getByRole('button', { name: /^Oui \/ Non/ }).click();
  await questions.nth(2).getByLabel('Libellé').fill('Anomalie bloquante');

  await page.getByRole('button', { name: 'Ajouter une question' }).click();
  await page.getByRole('button', { name: /^Texte court/ }).click();
  await questions.nth(3).getByLabel('Libellé').fill('Précisez le matériel');
  await questions.nth(3).getByLabel('Obligatoire').check();
  await questions.nth(3).getByLabel('Afficher seulement si…').check();
  await questions.nth(3).getByLabel("Question dont dépend l'affichage").selectOption({ label: 'Type de matériel' });
  await questions.nth(3).getByLabel('Valeur attendue').selectOption('Autre');

  // L'aperçu applique la règle d'affichage.
  const preview = page.locator('aside[aria-labelledby=fb-preview]');
  await expect(preview.getByText('Précisez le matériel')).toHaveCount(0);
  await preview.getByText('Autre', { exact: true }).click();
  await expect(preview.getByText('Précisez le matériel')).toBeVisible();

  await page.getByRole('button', { name: 'Enregistrer le formulaire' }).click();
  await expect(page).toHaveURL(/\/admin\?tab=catalog$/);
  await expect(page.getByRole('row', { name: /Matériel en panne/ })).toContainText('Support informatique');

  // Côté demandeur.
  await page.getByRole('link', { name: 'Catalogue', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeVisible();
  await page.getByRole('link', { name: /Matériel en panne/ }).click();
  await page.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(page.getByText('Ce champ est requis.')).toBeVisible();
  await page.getByLabel('Numéro du poste').fill('PC-0042');
  await page.getByText('Autre', { exact: true }).click();
  await page.getByLabel('Précisez le matériel').fill('Webcam');
  await page.getByRole('radio', { name: 'Oui' }).check();
  await page.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(page.getByRole('heading', { name: 'Matériel en panne : PC-0042' })).toBeVisible();
  await expect(page.getByText('Webcam')).toBeVisible();
  await expect(page.locator('dl').getByText('Anomalie bloquante')).toBeVisible();
  await expect(page.getByLabel("Groupe d'affectation")).toHaveValue(/\d+/);
  await expect(page.getByText('a créé le ticket avec le formulaire « Matériel en panne »')).toBeVisible();
  await page.goto('/admin');
});

test('sauvegardes : téléchargement et écriture sur un disque', async () => {
  await page.getByRole('tab', { name: 'Sauvegardes' }).click();
  await expect(page).toHaveURL(/\/admin\?tab=backup$/);

  // Sans la fenêtre « Enregistrer sous » (absente de Firefox et Safari) : téléchargement classique.
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger la sauvegarde' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^xchange_.+\.zip$/);
  const zip = await fs.readFile(await download.path());
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.includes(Buffer.from('xchange.db'))).toBe(true);

  const disk = page.getByRole('radio', { name: /cle-usb/ });
  await expect(disk).toBeChecked();
  await page.fill('#backup-folder', '../ailleurs');
  await page.getByRole('button', { name: 'Enregistrer la sauvegarde' }).click();
  await expect(page.getByText('Nom invalide.')).toBeVisible();
  await page.fill('#backup-folder', 'Xchange-sauvegardes');
  await page.getByRole('button', { name: 'Enregistrer la sauvegarde' }).click();
  const status = page.getByRole('status').filter({ hasText: 'Sauvegarde écrite' });
  await expect(status).toContainText(/cle-usb.Xchange-sauvegardes.xchange_.+\.zip/);
  const written = (await status.locator('.font-mono').innerText()).trim();
  expect((await fs.readFile(written)).subarray(0, 2).toString()).toBe('PK');
});

test('mon compte : codes de secours', async () => {
  await page.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Mon compte' }).click();
  await expect(page.getByText('Codes de secours restants')).toContainText('10');
  await page.fill('#p-mfa-code', await nextCode(ADMIN.username));
  await page.getByRole('button', { name: 'Nouveaux codes de secours' }).click();
  await expect(page.getByText('Vos nouveaux codes, affichés une seule fois')).toBeVisible();
  const fresh = await page.getByRole('list', { name: 'Codes de secours' }).locator('li').allInnerTexts();
  expect(fresh).toHaveLength(10);
  expect(fresh).not.toContain(adminRecoveryCodes[0]);
  adminRecoveryCodes = fresh;
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
  // Double authentification réinitialisée par l'administrateur : nouvelle configuration.
  await completeMfaSetup(page, USER.username);
  await expect(page.getByRole('heading', { name: `Bonjour ${USER.firstname}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);

  await page.goto(`/tickets/${createdId}`);
  await expect(page.getByText('Ticket introuvable.')).toBeVisible();

  await page.goto(`/tickets/${ids[0]}`);
  await expect(page.getByRole('button', { name: 'Modifier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mettre à la corbeille' })).toHaveCount(0);

  // Demande pour rejoindre un groupe d'entraide, à valider par un administrateur.
  await page.goto('/profile');
  const groupRow = page.locator('section[aria-labelledby=groups-title] li', { hasText: 'Support informatique' });
  await groupRow.getByRole('button', { name: 'Demander à rejoindre' }).click();
  await groupRow.getByLabel("Un mot pour l'administrateur (facultatif)").fill('Je dépanne déjà toute la famille');
  await groupRow.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(groupRow.getByText('Demande en attente')).toBeVisible();
});

test('connexion avec un code de secours', async () => {
  await page.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
  await page.goto('/login');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  await page.getByRole('button', { name: 'Utiliser un code de secours' }).click();
  await page.fill('#login-code', adminRecoveryCodes[0]);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('il vous en reste 9')).toBeVisible();
  await expect(page.getByRole('heading', { name: `Bonjour ${ADMIN.firstname}` })).toBeVisible();
});

test("validation d'une demande d'adhésion", async () => {
  await page.goto('/');
  await page.getByRole('link', { name: "1 demande d'adhésion à un groupe à valider" }).click();
  await expect(page).toHaveURL(/\/admin\?tab=groups$/);
  const card = page.locator('section[aria-labelledby=req-title]');
  await expect(card).toContainText('souhaite rejoindre Support informatique');
  await expect(card).toContainText('Je dépanne déjà toute la famille');
  await card.getByRole('button', { name: 'Accepter' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Support informatique/ })).toContainText('2 membres');
});

test('se mettre à la place d’un utilisateur', async () => {
  await page.goto('/admin');
  await page.getByRole('button', { name: `Se mettre à la place de ${USER.username}` }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByText('Vous êtes à la place de')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);

  await page.goto(`/tickets/${ids[0]}`);
  await page.fill('#comment', 'Je regarde avec toi, Inès.');
  await page.getByRole('button', { name: 'Commenter' }).click();
  await expect(page.getByText(`écrit par ${ADMIN.firstname} ${ADMIN.lastname}`)).toBeVisible();

  await page.getByRole('button', { name: 'Revenir à mon compte' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('Vous êtes à la place de')).toHaveCount(0);
  await expect(page.getByText('Journal des prises de contrôle (1)')).toBeVisible();
});

test('paramètres : listes, délai par défaut et apparence', async () => {
  await page.goto('/admin?tab=settings');
  // Matrice des droits : le groupe Support informatique voit tous les tickets et peut supprimer.
  await page.getByLabel('Tickets visibles : Support informatique').selectOption('all');
  await page.getByLabel('Supprimer : Support informatique').check();
  await page.getByRole('button', { name: 'Enregistrer les droits' }).click();
  await expect(page.getByText('Droits enregistrés')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Tickets visibles : Support informatique')).toHaveValue('all');
  await expect(page.getByLabel('Supprimer : Support informatique')).toBeChecked();

  await page.getByRole('tab', { name: 'Notifications' }).click();
  await expect(page).toHaveURL(/section=notifications/);
  await expect(page.getByText('Non configuré')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer les droits' })).toBeHidden();

  await page.getByRole('tab', { name: 'Catégories et priorités' }).click();
  await page.getByRole('button', { name: 'Ajouter une catégorie' }).click();
  await page.getByLabel('Nom de la catégorie 4').fill('Matériel');
  await page.getByLabel('Nom de la priorité 1').fill('Urgente');
  await page.getByLabel('Couleur de la priorité 1').selectOption('purple');
  await page.getByLabel('Délai par défaut de la priorité 1, en jours').fill('2');
  await page.getByRole('button', { name: 'Enregistrer les listes' }).click();
  await expect(page.getByText('Listes enregistrées')).toBeVisible();

  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.fill('#set-name', 'Helpdesk Magna');
  await page.fill('#set-color', '#ffd700');
  await page.getByRole('button', { name: "Enregistrer l'apparence" }).click();
  await expect(page.locator('form p[role=alert]').filter({ hasText: 'trop claire' })).toBeVisible();
  await page.fill('#set-color', '#0b6e4f');
  await page.getByRole('button', { name: "Enregistrer l'apparence" }).click();
  await expect(page.getByRole('link', { name: 'Helpdesk Magna' })).toBeVisible();
  await expect(page).toHaveTitle('Helpdesk Magna');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
  expect(accent).toBe('#0b6e4f');

  // Nouveau ticket : catégorie ajoutée, priorité renommée, date limite par défaut annoncée.
  await page.goto('/tickets/new');
  await expect(page.locator('#ticket-category option', { hasText: 'Matériel' })).toHaveCount(1);
  await page.locator('label', { hasText: 'Urgente' }).click();
  await expect(page.getByText('Vide : dans 2 jours (priorité urgente).')).toBeVisible();
  await page.fill('#ticket-title', 'Clavier HS');
  await page.fill('#ticket-description', 'Touches bloquées.');
  await page.selectOption('#ticket-category', { label: 'Matériel' });
  await page.getByLabel(/Demande confidentielle/).check();
  await page.getByRole('button', { name: 'Créer le ticket' }).click();
  await expect(page.getByRole('heading', { name: 'Clavier HS' })).toBeVisible();
  await expect(page.locator('header').getByText('Confidentielle')).toBeVisible();
  await expect(page.locator('dl').getByText('Matériel')).toBeVisible();
  await expect(page.locator('dl').getByText('Aucune')).toHaveCount(0);
});

test('RGPD : pages légales, onglet d’administration, export et anonymisation', async () => {
  const admin = await login(ADMIN);
  await api('POST', '/api/users', { username: 'lucie', password: 'motdepasse-lucie', firstname: 'Lucie', email: 'lucie@exemple.fr' }, admin);
  const lucie = await login({ username: 'lucie', password: 'motdepasse-lucie' });
  await api('POST', '/api/auth/me/rgpd-requests', { type: 'erase', message: 'Je quitte l’association.' }, lucie);
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Politique de confidentialité' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Politique de confidentialité' })).toBeVisible();
  await expect(page.getByText('après 2 ans sans connexion')).toBeVisible();

  await page.goto('/admin?tab=settings&section=rgpd');
  await expect(page.getByRole('button', { name: 'Guide administrateur (PDF)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Données d’une personne' })).toBeVisible();
  await page.fill('#rgpd-search', 'lucie');
  await page.getByRole('button', { name: /Lucie/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter ses données (JSON)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^xchange-donnees-lucie-\d{4}-\d{2}-\d{2}\.json$/);

  // Demande de Lucie traitée depuis la carte des demandes : suppression proposée par défaut.
  const card = page.locator('section[aria-labelledby="rgpd-requests"]');
  await expect(card.getByText('Je quitte l’association.')).toBeVisible();
  await card.getByRole('button', { name: 'Anonymiser le compte…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /Les supprimer/ })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Anonymiser définitivement' })).toBeDisabled();
  await dialog.getByLabel(/tapez son identifiant/).fill('lucie');
  await dialog.getByRole('button', { name: 'Anonymiser définitivement' }).click();
  await expect(page.getByText(/Compte anonymisé/)).toBeVisible();
  await expect(card.getByText('Aucune demande en attente.')).toBeVisible();
  await expect(page.getByText('1 compte(s) anonymisé(s) à ce jour.')).toBeVisible();

  // Texte juridique modifié puis visible publiquement.
  await page.getByRole('tab', { name: 'Charte d’utilisation' }).click();
  await page.fill('#rgpd-legal-text', '## Règle\nSoyez sympas.');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).last().click();
  await page.getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByText('Texte personnalisé')).toBeVisible();
  await page.goto('/charte');
  await expect(page.getByText('Soyez sympas.')).toBeVisible();
  await expect(page.getByText(/^Version 2, en vigueur depuis le/)).toBeVisible();
  // Nouvelle version : l'administrateur lui-même doit la relire et l'accepter.
  const banner = page.getByRole('region', { name: 'Charte d’utilisation' });
  await expect(banner).toContainText('a été modifiée le');
  await banner.getByRole('button', { name: 'J’ai lu et j’accepte' }).click();
  await expect(banner).toBeHidden();
});

test('double authentification : refus tracé à l’inscription, navigateur de confiance', async ({ browser }, testInfo) => {
  // Refus à l'inscription, dans un navigateur à part.
  const ctx = await browser.newContext(testInfo.project.use);
  const p = await ctx.newPage();
  await p.goto('/register');
  await p.fill('#reg-username', 'bernard');
  await p.fill('#reg-password', 'motdepasse-bernard');
  await p.fill('#reg-confirm', 'motdepasse-bernard');
  await p.getByRole('checkbox', { name: /J’accepte la charte/ }).check();
  await p.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(p).toHaveURL(/\/double-authentification$/);
  await p.getByRole('button', { name: 'Je ne souhaite pas utiliser la double authentification' }).click();
  const go = p.getByRole('button', { name: 'Continuer sans double authentification' });
  await expect(go).toBeDisabled();
  await p.getByRole('checkbox', { name: /J’ai compris les risques/ }).check();
  await go.click();
  await expect(p.getByRole('link', { name: 'Tableau de bord' })).toBeVisible();
  await p.goto('/profile');
  await expect(p.getByText(/Vous avez choisi le .* de ne pas utiliser la double/)).toBeVisible();
  await expect(p.getByText('Double authentification refusée, risques acceptés, par vous')).toBeVisible();
  await ctx.close();

  // L'administrateur voit que c'est le choix de la personne.
  await page.goto('/admin');
  await expect(page.getByRole('row', { name: /bernard/ })).toContainText('Refusée par la personne');

  // Navigateur de confiance : le code n'est demandé qu'une fois.
  const ctx2 = await browser.newContext(testInfo.project.use);
  const q = await ctx2.newPage();
  const signIn = async () => {
    await q.goto('/login');
    await q.fill('#login-username', ADMIN.username);
    await q.fill('#login-password', ADMIN.password);
    await q.getByRole('button', { name: 'Se connecter' }).click();
  };
  await signIn();
  await expect(q.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  await q.getByRole('checkbox', { name: /Faire confiance à ce navigateur pendant 30 jours/ }).check();
  await q.fill('#login-code', await nextCode(ADMIN.username));
  await q.getByRole('button', { name: 'Valider' }).click();
  await expect(q.getByRole('heading', { name: `Bonjour ${ADMIN.firstname}` })).toBeVisible();
  await q.evaluate(() => localStorage.removeItem('xchange.token'));
  await signIn();
  await expect(q.getByRole('heading', { name: `Bonjour ${ADMIN.firstname}` })).toBeVisible();
  await q.goto('/profile');
  await expect(q.getByText('Navigateurs de confiance')).toBeVisible();
  await q.getByRole('button', { name: 'Retirer tous les navigateurs' }).click();
  await expect(q.getByText('Tous les navigateurs ont été retirés')).toBeVisible();
  await q.evaluate(() => localStorage.removeItem('xchange.token'));
  await signIn();
  await expect(q.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  await ctx2.close();
});

test('assistant guidé : orientation vers la bonne page', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Besoin d’aide ?' }).click();
  const panel = page.getByRole('dialog', { name: 'Assistant' });
  await panel.getByLabel(/Décrivez votre besoin/).fill('je voudrais discuter avec quelqu’un');
  await panel.getByLabel(/Décrivez votre besoin/).press('Enter');
  await expect(panel.getByRole('heading', { name: 'Comment parler directement avec quelqu’un ?' })).toBeVisible();
  await panel.getByRole('button', { name: 'Fermer l’assistant' }).click();
});

test('discussions : message privé en direct, signalement et modération', async ({ browser }, testInfo) => {
  // Inès (mot de passe provisoire donné par l'administrateur), dans un autre navigateur.
  const token = await login({ ...USER, password: tempPassword });
  const ctx = await browser.newContext(testInfo.project.use);
  await ctx.addInitScript((t) => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.setItem('xchange.token', t);
      sessionStorage.setItem('e2e-init', '1');
    }
  }, token);
  const q = await ctx.newPage();
  const thread = (p) => p.locator('section[aria-labelledby="thread-title"] ol');
  const qErrors = trackPageErrors(q);
  await q.goto('/');
  await expect(q.getByRole('link', { name: 'Discussions' })).toBeVisible();

  // Swann écrit à Inès.
  await page.goto('/discussions');
  await expect(page.getByRole('link', { name: /Salon général/ })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle conversation' });
  await dialog.getByLabel('À qui écrire ?').fill('ines');
  await dialog.getByRole('button', { name: new RegExp(USER.firstname) }).click();
  await expect(page.getByRole('heading', { name: `${USER.firstname} ${USER.lastname}` })).toBeVisible();
  await page.fill('#chat-input', 'Bonjour Inès, ton badge fonctionne de nouveau ?');
  await page.keyboard.press('Enter');
  await expect(thread(page).getByText('Bonjour Inès, ton badge fonctionne de nouveau ?')).toBeVisible();

  // Inès voit le compteur sans recharger la page, puis répond.
  await expect(q.getByTestId('chat-unread')).toContainText('1');
  await q.getByRole('link', { name: /Discussions/ }).click();
  await q.getByRole('link', { name: new RegExp(`${ADMIN.firstname} ${ADMIN.lastname}`) }).click();
  await expect(thread(q).getByText('Bonjour Inès, ton badge fonctionne de nouveau ?')).toBeVisible();
  await expect(q.getByTestId('chat-unread')).toHaveCount(0);
  await q.fill('#chat-input', 'Oui, merci beaucoup !');
  await q.getByRole('button', { name: 'Envoyer' }).click();
  // Arrivée en direct chez Swann.
  await expect(thread(page).getByText('Oui, merci beaucoup !')).toBeVisible();

  // Inès signale le message (exemple) ; l'administrateur ne voit que celui-là.
  const msg = thread(q).getByRole('listitem').filter({ hasText: 'Bonjour Inès, ton badge' });
  await msg.hover();
  await msg.getByRole('button', { name: /Signaler ce message/ }).click();
  const report = q.getByRole('dialog', { name: 'Signaler ce message' });
  await report.getByLabel('Motif (facultatif)').fill('Test de signalement');
  await report.getByRole('button', { name: 'Signaler' }).click();
  await expect(q.getByText('Message signalé aux administrateurs')).toBeVisible();

  await page.goto('/admin?tab=chat');
  await expect(page.getByText('Test de signalement')).toBeVisible();
  await expect(page.getByText('Oui, merci beaucoup !')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retirer le message' }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByText('Aucun signalement à traiter')).toBeVisible();
  await expect(thread(q).getByText('Message retiré par la modération')).toBeVisible();

  // Durée de conservation choisie par Inès.
  await q.goto('/profile');
  const keep = q.getByRole('radiogroup', { name: 'Conservation de mes messages' });
  await keep.getByText('30 jours', { exact: true }).click();
  await expect(q.getByText('Durée de conservation enregistrée')).toBeVisible();
  await q.reload();
  await expect(keep.getByRole('radio', { name: '30 jours' })).toBeChecked();
  expect(qErrors).toEqual([]);
  await ctx.close();
});

test('analyses : tableau de bord, rapport, envoi programmé', async () => {
  await page.goto('/analyses');
  await expect(page).toHaveURL(/\/analyses\/tableaux$/);
  await page.getByRole('button', { name: /Activité générale/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Activité générale' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Par statut', exact: true })).toBeVisible();
  await expect(page.getByText('En direct')).toBeVisible();
  // Vue en tableau d'un graphique.
  const statusBlock = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Par statut', exact: true }) });
  await statusBlock.getByRole('button', { name: 'Voir les valeurs en tableau' }).click();
  await expect(statusBlock.getByRole('rowheader', { name: 'Ouvert' })).toBeVisible();

  // Modification : un bloc de plus.
  await page.getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByText('Mode modification')).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un bloc' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un bloc' });
  await dialog.getByLabel('Titre du bloc').fill('Mes demandes en retard');
  await dialog.getByText('Indicateur', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Tableau de bord enregistré')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mes demandes en retard' })).toBeVisible();

  // Rapport.
  await page.getByRole('link', { name: 'Tableaux de bord' }).click();
  await page.getByRole('navigation', { name: 'Analyses' }).getByRole('link', { name: 'Rapports' }).click();
  await page.getByRole('link', { name: 'Nouveau rapport' }).first().click();
  await page.getByLabel('Nom').fill('Demandes par priorité');
  await page.getByLabel('Regrouper par').selectOption('priority');
  await expect(page.getByRole('region', { name: 'Aperçu' }).getByText('Urgente')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Demandes par priorité' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^rapport-Demandes-par-priorite-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.getByRole('button', { name: 'Programmer un envoi' }).click();
  const sch = page.getByRole('dialog', { name: 'Programmer un envoi par e-mail' });
  await expect(sch.getByText('avec vos droits')).toBeVisible();
  await sch.getByRole('button', { name: 'Programmer' }).click();
  await expect(page.getByText('Chaque lundi à 08:00')).toBeVisible();
  // Pas de boîte d'envoi configurée dans ce test : l'échec est expliqué et tracé.
  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page.getByText(/e-mails ne sont pas configurés/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Historique' }).click();
  await expect(page.getByRole('dialog', { name: 'Historique des envois' }).getByText('Échec')).toBeVisible();
  await page.getByRole('dialog', { name: 'Historique des envois' }).getByRole('button', { name: 'Fermer' }).click();
  // L'administrateur voit les envois de tous.
  await page.goto('/analyses/rapports');
  await expect(page.getByRole('heading', { name: 'Envois programmés de tous les comptes' })).toBeVisible();
});

test('SLA : réglages, demande, tableau de bord', async () => {
  await page.goto('/admin?tab=sla');
  await expect(page.getByRole('heading', { name: 'Délais par priorité' })).toBeVisible();
  await expect(page.getByLabel('Résolution, Urgente')).toHaveValue('2');
  await page.getByLabel('Résolution, Urgente').fill('3');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/Délais enregistrés/)).toBeVisible();
  await page.getByRole('button', { name: 'Appliquer aux demandes en cours' }).click();
  await page.locator('.swal2-confirm').click();
  await expect(page.getByText(/demande\(s\) recalculée\(s\)/)).toBeVisible();

  await page.goto(`/tickets/${ids[0]}`);
  const sla = page.getByRole('definition').filter({ hasText: 'Prise en charge' });
  await expect(sla).toBeVisible();
  await expect(sla.getByText('Résolution')).toBeVisible();

  await page.goto('/admin?tab=sla');
  await page.getByRole('link', { name: 'Tableau de bord SLA' }).click();
  await expect(page).toHaveURL(/\/analyses\/sla$/);
  await expect(page.getByRole('heading', { name: 'Délais (SLA)', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En cours, délai dépassé' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /À traiter en priorité/ })).toBeVisible();
});

test('mode sombre : choix retenu après rechargement', async () => {
  await page.goto('/profile');
  const display = page.getByRole('radiogroup', { name: 'Thème' });
  await expect(display).toBeVisible();
  await display.getByText('Sombre', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 20, 27)');
  await page.getByRole('button', { name: /^Thème : sombre/ }).click();
  await expect(display).toBeVisible();
  await display.getByText('Clair', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('page inconnue et absence d’erreur JavaScript', async () => {
  await page.goto('/nimporte-quoi');
  await expect(page.getByText("Cette page n'existe pas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

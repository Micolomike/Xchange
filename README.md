# Xchange

Application de gestion de tickets pour une équipe : on crée une demande, on l'assigne, on en discute avec des pièces jointes et on la suit jusqu'à sa résolution.

- **Frontend** : React 19, Vite, Tailwind CSS 4 (`frontend/`)
- **API** : Node.js, Express 5, SQLite (`backend/`)

## Fonctionnalités

**Tickets**
- Création avec titre, description, priorité (basse, moyenne, haute), catégorie (bug, fonctionnalité, support), date limite et pièces jointes.
- Cycle de vie : ouvert, en cours, résolu, fermé ; réouverture possible. La date de résolution est enregistrée.
- Assignation à un responsable, commentaires, historique complet des changements (statut, priorité, responsable, modifications, fichiers).
- Liste filtrable (statut, priorité, catégorie, responsable, retard), recherche plein texte et par numéro, tri, pagination. Les filtres sont dans l'adresse de la page : un lien filtré se partage.
- Suppression vers une corbeille, restauration ou suppression définitive par un administrateur.

**Comptes et rôles**
- Inscription et connexion (jetons JWT), page « Mon compte » (profil, changement de mot de passe).
- Deux rôles :
  - **Utilisateur** : voit les tickets qu'il a créés ou qui lui sont assignés ; modifie ses propres tickets ; change le statut de ses tickets et de ceux qui lui sont assignés.
  - **Administrateur** : voit tout, assigne, supprime, gère les comptes (création, rôle, réinitialisation de mot de passe, suppression) et la corbeille.
- Le premier compte créé devient administrateur. Le dernier administrateur ne peut être ni supprimé ni rétrogradé.
- Changer ou réinitialiser un mot de passe ferme les autres sessions de l'utilisateur.

**Se mettre à la place d'un utilisateur (administrateurs)**
- Depuis Administration > Utilisateurs (icône œil) : l'administrateur voit et utilise Xchange comme la personne, pendant une heure au plus, avec un bandeau « Revenir à mon compte ».
- Les actions sont enregistrées au nom de la personne avec la mention « fait par » l'administrateur ; un journal garde chaque prise de contrôle, visible aussi par la personne dans « Mon compte ».
- Limites : jamais vers un autre administrateur ; demandes confidentielles masquées ; mot de passe, informations du compte et double authentification non modifiables ; le jeton tombe si l'administrateur perd son rôle ou change de mot de passe.

**Groupes d'affectation**
- Un administrateur crée des groupes (Administration > Groupes) et choisit leurs membres.
- Un ticket peut être affecté à un groupe dès sa création, par n'importe quel utilisateur. Les membres du groupe le voient, le prennent en charge, changent son statut, l'assignent à l'un d'eux ou le transfèrent à un autre groupe.
- Seul un membre du groupe peut être responsable d'un ticket affecté à ce groupe ; lors d'un transfert, le responsable qui n'est pas membre du nouveau groupe est retiré.
- Demandes d'adhésion : un utilisateur demande à rejoindre un groupe « ouvert aux demandes » depuis « Mon compte » ou dès l'inscription (avec un mot facultatif) ; un administrateur accepte ou refuse (avec motif) dans Administration > Groupes, et le tableau de bord signale les demandes en attente. Chacun peut quitter un groupe ou annuler sa demande. Un groupe peut être réservé « sur invitation » (Coordinateurs par défaut).
- Filtres « Mes groupes », « Sans groupe » ou par groupe dans la liste ; le tableau de bord signale les tickets de mes groupes sans responsable.

**Catalogue de formulaires**
- Page « Catalogue » : les formulaires publiés, classés par rubrique, avec recherche, et une « Demande libre » quand rien ne correspond.
- Constructeur de formulaires (Administration > Catalogue) avec aperçu en direct : texte court ou long, liste déroulante, boutons de choix, case à cocher, date, nombre, e-mail, pièce jointe ; question obligatoire, aide, exemple, ordre.
- Règles d'affichage : une question n'apparaît que si une question précédente a une valeur donnée, est cochée, remplie ou vide. Le serveur applique les mêmes règles et ignore les réponses masquées.
- Par formulaire : rubrique, description, groupe qui traite les demandes, priorité des tickets créés, visibilité (tout le monde ou certains groupes), publication. Duplication possible.
- L'envoi crée un ticket dont le titre reprend le nom du formulaire (et, au choix, une réponse) ; les réponses sont conservées avec le ticket, même si le formulaire est modifié ou supprimé ensuite.

**Contenu de départ**
- Au démarrage, Xchange ajoute une fois 15 catégories (informatique, téléphone, démarches, impôts, budget, carrière, logement, voiture, santé, droit, cuisine, événements, voyages, études, achats), 11 groupes d'entraide (Informaticiens, Fiscalistes, As de la paperasse, Conseillers budget, Coachs carrière, Bricoleurs, Mécanos, Cuisiniers, Organisateurs, Profs, Entraide santé) et 30 formulaires du catalogue. Depuis la version 2 du contenu : un groupe par catégorie (dont Experts mobiles, Conseillers juridiques, Globe-trotteurs, Chasseurs de bons plans), un groupe Coordinateurs (voit toutes les demandes non personnelles, modifie et répartit), et une règle de visibilité par catégorie : chaque catégorie est visible par son groupe et les Coordinateurs, les sujets personnels (impôts, budget, carrière, santé, droit) seulement par leur groupe.
- Rien d'existant n'est modifié : un groupe, une catégorie ou un formulaire du même nom est laissé tel quel, une règle ou un groupe d'affectation changé par l'administrateur est gardé ; ce qui est supprimé ensuite ne revient pas. `SEED_CONTENT=false` désactive cet ajout.

**Droits et visibilité (Administration > Paramètres)**
- Matrice : une ligne « Tous les utilisateurs » et une ligne par groupe ; colonnes « Voit les tickets » (les siens, ceux de son groupe, tous), Créer, Traiter, Assigner, Modifier, Supprimer. Une personne cumule la ligne « Tous les utilisateurs » et celles de ses groupes ; les droits s'appliquent aux tickets qu'elle voit.
- Visibilité par catégorie : les groupes cochés voient tous les tickets de la catégorie ; une catégorie réservée n'est plus visible par le droit « Tous » des autres groupes.
- Demande confidentielle (case à cocher à la création, modifiable par l'auteur) : visible seulement par l'auteur, le responsable et les membres du groupe d'affectation, administrateurs compris ; dans la corbeille, son contenu est masqué aux autres administrateurs.
- Chaque formulaire du catalogue peut fixer la catégorie des tickets créés.

**Paramètres (Administration > Paramètres)**
- Catégories : ajout, renommage, ordre, désactivation. Une catégorie désactivée ou retirée n'est plus proposée, mais les tickets qui l'utilisent la gardent.
- Priorités : toujours trois niveaux, avec nom, couleur et délai par défaut (en jours), qui remplit la date limite d'un nouveau ticket quand le demandeur n'en donne pas.
- Apparence : nom de l'application, logo (PNG, JPG ou WEBP, 512 Ko), couleur principale (refusée si le texte blanc des boutons devient illisible), titre et texte de la page d'accueil.

**Double authentification (obligatoire par défaut)**
- Code à 6 chiffres d'une appli d'authentification (Microsoft Authenticator, Google Authenticator, 2FAS…), norme TOTP. Chaque code ne sert qu'une fois.
- Configuration à la première connexion (QR code ou clé à saisir), puis 10 codes de secours à usage unique, téléchargeables et renouvelables depuis « Mon compte ».
- Un administrateur peut réinitialiser la double authentification d'un compte (téléphone perdu). Sur le PC serveur : `node --env-file=C:\Xchange\xchange.env scripts\reinitialiser-mfa.js <nom>` depuis `C:\Xchange\app\backend`, si plus aucun administrateur ne peut se connecter.
- Un administrateur peut dispenser un compte de double authentification (Administration > Utilisateurs, « Dispenser »), par exemple pour une personne sans smartphone : elle se connecte avec son seul mot de passe. « Exiger » annule la dispense ; dans les deux cas, ses sessions sont fermées.
- 10 codes faux de suite bloquent la vérification 15 minutes, comme pour le mot de passe.

**Sauvegardes à la demande (Administration > Sauvegardes)**
- Téléchargement d'une archive .zip (base et pièces jointes) ; sur Chrome et Edge, choix de l'emplacement (clé USB, disque externe).
- Écriture directe par le serveur sur un disque du PC qui l'héberge (lettres de lecteur sous Windows, ou dossiers listés dans `BACKUP_TARGETS`).
- Restauration d'une archive : `restaurer.ps1 -Fichier <archive.zip>`.
- Sauvegarde automatique faite par Xchange lui-même quand `BACKUP_DIR` est défini (hébergement sur un PC) : heure, nombre de sauvegardes gardées et copie .zip vers un autre dossier (par exemple `D:\Xchange-sauvegardes`) réglables dans l'onglet Sauvegardes, avec l'état de la dernière sauvegarde et un bouton « Sauvegarder maintenant ». Si le PC était éteint à l'heure prévue, la sauvegarde est faite au démarrage suivant.

**Notifications par e-mail**
- Envoyées par une boîte dédiée (SMTP, par exemple Orange : `smtp.orange.fr`, port 465) configurée dans les variables `SMTP_*`.
- Événements : nouvelle demande pour un groupe, transfert vers un groupe, demande confiée, nouveau message, changement de statut, demande d'adhésion à un groupe et réponse.
- Jamais à la personne qui a fait l'action. Demandes confidentielles : ni titre ni contenu dans l'e-mail, seulement un lien.
- Administration > Paramètres > Notifications : état de l'envoi et statistiques sur 7 jours, interrupteur général, chaque événement activable avec aperçu de l'e-mail, statuts qui déclenchent un e-mail, nom d'expéditeur, début de l'objet, contenu détaillé ou non, texte de bas de page, adresse publique pour les liens, comptes sans adresse e-mail, journal des 100 derniers envois et e-mail de test vers n'importe quelle adresse.
- « Mon compte » : chacun coupe tout ou choisit ce qu'il reçoit (ses demandes, demandes confiées, messages sur ce qu'il traite, nouvelles demandes de ses groupes, adhésions à valider pour les administrateurs).

**Pseudonyme seul**
- À l'inscription ou dans « Mon compte », chacun peut n'afficher que son nom d'utilisateur : prénom et nom sont cachés aux autres membres (demandes, messages, historique, groupes, e-mails). Les administrateurs les voient dans la gestion des comptes (badge « Pseudonyme seul »).

**Double authentification au choix**
- À l'inscription ou à la première connexion, une personne (pas un administrateur) peut refuser la double authentification : les risques sont expliqués, une case doit être cochée, et le choix est enregistré sur son compte avec sa date (« Refusée par la personne » dans la liste des utilisateurs, distinct d'une dispense donnée par un administrateur). Elle peut l'activer plus tard dans « Mon compte ».
- « Faire confiance à ce navigateur pendant 30 jours » à la saisie du code (`TRUSTED_DEVICE_DAYS`, 1 à 90). Le mot de passe reste demandé ; la confiance tombe à l'expiration, au changement de mot de passe ou à la réinitialisation de la double authentification. « Mon compte » liste les navigateurs de confiance (retrait un par un ou tous) et l'historique de sécurité du compte.

**RGPD** (Administration > Paramètres > RGPD)
- Données d'une personne : recherche d'un compte, export JSON de toutes ses données, anonymisation irréversible en conservant ses demandes (signées « Utilisateur supprimé n°X ») ou en les supprimant. Identité, e-mail, mot de passe, double authentification, sessions, pièces jointes déposées, groupes, demandes d'adhésion et journaux la concernant sont effacés dans les deux cas.
- Conservation : anonymisation automatique des comptes inactifs (24 mois par défaut, jamais les administrateurs), précédée d'un e-mail d'avertissement un mois avant (sauf compte sans adresse) et suppression des journaux anciens (12 mois), une fois par jour ; aperçu de la prochaine purge et lancement manuel.
- Textes juridiques modifiables : mentions légales, politique de confidentialité (durées de conservation remplies automatiquement), charte d'utilisation ; pages publiques `/mentions-legales`, `/confidentialite`, `/charte`, en lien en bas de chaque page.
- Case « J'accepte la charte et la politique de confidentialité » à l'inscription (désactivable). La charte est versionnée : chaque modification crée une version archivée telle quelle, et chacun doit relire et accepter la nouvelle version (bandeau) ; chaque acceptation est enregistrée avec sa version et sa date.
- « Mon compte » : téléchargement de ses propres données et formulaire de demande (anonymisation, suppression, correction, autre) ; les administrateurs sont prévenus par e-mail, voient les demandes avec le délai d'un mois dans l'onglet RGPD et les traitent en un clic (anonymisation, réponse ou refus motivé).

**Affichage**
- Mode clair, sombre ou automatique (suit le réglage de l'appareil), depuis le bouton de la barre de navigation ou « Mon compte ». Retenu sur chaque appareil.

**Tableau de bord**
- Compteurs (ouverts, en cours, en retard, délai moyen de résolution sur 90 jours), « Ma file » triée par priorité, activité récente, graphique créés/résolus sur 14 jours, répartition des tickets actifs par priorité.

## Guide de l'administrateur

Le guide PDF est téléchargeable dans Administration (bouton « Guide administrateur (PDF) », réservé aux administrateurs). Sa source est `docs/admin/guide.html` (captures dans `docs/admin/img/`). Après chaque évolution, mettre la source à jour puis régénérer le PDF, qui est versionné dans `backend/docs/` :

```bash
cd e2e
npm run guide
```

## Démarrage en local

Prérequis : Node.js 20 ou plus récent.

```bash
# API (port 4000)
cd backend
npm install
npm run dev

# Frontend (port 5173), dans un second terminal
cd frontend
npm install
npm run dev
```

Ouvrir http://localhost:5173 et créer un compte : c'est le premier, il sera administrateur. En développement, Vite redirige `/api` vers `http://localhost:4000`.

## Configuration

### API (`backend/`)

Toutes les variables sont facultatives ; voir `backend/.env.example`.

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `4000` |
| `JWT_SECRET` | Secret de signature des sessions. **À définir en production**, sinon un secret temporaire est généré et tout le monde est déconnecté à chaque redémarrage. `SESSION_SECRET` est accepté aussi. | secret aléatoire |
| `DATA_DIR` | Dossier des données (base `tickets.db` et dossier `uploads/`) | `database/` à la racine du dépôt |
| `DATABASE_PATH` / `UPLOADS_DIR` | Pour placer la base ou les fichiers ailleurs que dans `DATA_DIR` | |
| `CORS_ORIGIN` | Origines autorisées, séparées par des virgules | toutes |
| `ALLOW_REGISTRATION` | `false` pour fermer l'inscription libre (les comptes sont alors créés par un administrateur) | `true` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Crée ce compte administrateur au démarrage s'il n'existe pas, ou le promeut | |
| `MAX_UPLOAD_MB` | Taille maximale d'une pièce jointe | `10` |
| `JWT_EXPIRES_IN` | Durée de validité d'une session | `7d` |
| `MFA_REQUIRED` | `false` pour rendre la double authentification facultative (activable depuis « Mon compte ») | `true` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Serveur d'envoi des notifications ; sans `SMTP_HOST`, aucun e-mail n'est envoyé. SSL/TLS direct si le port est 465 | port `465` |
| `SMTP_USER` / `SMTP_PASSWORD` | Identifiant (adresse complète) et mot de passe de la boîte d'envoi | |
| `TRUSTED_DEVICE_DAYS` | Jours sans code de double authentification sur un navigateur de confiance (1 à 90) | `30` |
| `MAIL_FROM` | Expéditeur affiché | `SMTP_USER` |
| `APP_URL` | Adresse publique d'Xchange pour les liens des e-mails (modifiable aussi dans Administration > Paramètres) | |
| `BACKUP_TARGETS` | Dossiers proposés pour la sauvegarde écrite par le serveur, séparés par des virgules (en plus des lecteurs Windows) | |

Pièces jointes : 5 fichiers par envoi au plus ; les exécutables, scripts, HTML et SVG sont refusés. Les fichiers sont servis uniquement en téléchargement, après contrôle des droits sur le ticket.

### Frontend (`frontend/`)

| Variable | Rôle |
|---|---|
| `VITE_API_URL` | URL de l'API pour le build. Définie dans `frontend/.env.production` sur `https://xchange-backend-pasd.onrender.com`. À laisser vide si le frontend et l'API partagent le même domaine. |

## Déploiement

**API sur Render** : service web, dossier racine `backend`, build `npm install`, démarrage `npm start`.
- `JWT_SECRET` est défini dans l'onglet *Environment* du service (valeur générée par Render).
- Le disque d'un service Render gratuit est effacé à chaque redéploiement ou mise en veille : la base SQLite et les pièces jointes repartent de zéro. Pour les conserver, ajouter un disque persistant (offre payante) monté par exemple sur `/var/data` et définir `DATA_DIR=/var/data`.

**Frontend sur Vercel** : projet `xchange`, dossier racine `frontend`, préréglage Vite (build `npm run build`, sortie `dist`).
- `frontend/vercel.json` renvoie toutes les adresses vers `index.html`, pour que `/tickets/12` fonctionne au rechargement.
- L'URL de l'API vient de `frontend/.env.production`.

## Hébergement sur un PC Windows

Le dossier `deploy/windows/` installe Xchange sur un PC, de façon isolée : compte de service Windows « Service local » sans droits administrateur, dossier `C:\Xchange` réservé, écoute sur `127.0.0.1` uniquement, démarrage avec Windows et sauvegarde quotidienne faite par Xchange. L'accès depuis Internet passe par Tailscale Funnel, sans ouvrir de port sur la box.

| Script (Terminal administrateur) | Rôle |
|---|---|
| `installer.ps1` | Installe ou réinstalle (configuration et données conservées) |
| `mettre-a-jour.ps1` | Sauvegarde, récupère la dernière version, recompile, redémarre |
| `etat.ps1` | Affiche l'état : application, accès Internet, sauvegardes, journal |
| `redemarrer.ps1` | Redémarre Xchange (après une modification de `C:\Xchange\xchange.env`) |
| `restaurer.ps1` | Remet une sauvegarde choisie dans une liste, ou une archive avec `-Fichier` |
| `autoriser-dossier.ps1 -Dossier <chemin>` | Crée un dossier et autorise Xchange à y écrire (copie des sauvegardes sur un autre disque) |
| `desinstaller.ps1` | Coupe l'accès Internet, supprime tâches et compte (`-SupprimerDonnees` pour tout effacer) |

Chaque script se lance avec `powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\<script>`. En mode PC, l'API sert aussi le site (`SERVE_FRONTEND=true`, site compilé par `npm run build:pc`), la configuration est lue dans `C:\Xchange\xchange.env`, et un compte est verrouillé 15 minutes après 10 échecs de connexion (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`).

## Reprise d'une base existante

Au démarrage, l'API met à niveau une base de la première version sans perte : ajout des nouvelles colonnes, normalisation des anciennes valeurs (dates limites vides, priorités manquantes), import du fichier `logs/deleted-tickets.json` dans la corbeille (renommé ensuite en `.imported.json`). Les anciens mots de passe restent valables. S'il n'existe aucun administrateur, le plus ancien compte est promu.

## API

Toutes les routes sauf `/api/auth/register`, `/api/auth/login`, `/api/auth/config` et `/api/health` exigent l'en-tête `Authorization: Bearer <jeton>`. Les erreurs sont renvoyées sous la forme `{ "error": "message", "details": { "champ": "message" } }`.

| Méthode | Route | Accès |
|---|---|---|
| `POST` | `/api/auth/register`, `/api/auth/login` (renvoient une session, ou une étape `mfaToken` / `setupToken`) | public |
| `POST` | `/api/auth/mfa/verify`, `/api/auth/mfa/setup/start`, `/api/auth/mfa/setup/confirm` | jeton d'étape |
| `POST` | `/api/auth/mfa/recovery-codes` | connecté |
| `GET`, `PUT` | `/api/auth/me` | connecté |
| `GET` | `/api/tickets?status=&priority=&category=&assignee=&group=&scope=&overdue=&q=&sort=&order=&page=&pageSize=` | connecté |
| `POST` | `/api/tickets` | connecté |
| `GET`, `PATCH` | `/api/tickets/:id` | selon droits sur le ticket |
| `DELETE` | `/api/tickets/:id` (mise à la corbeille) | admin |
| `POST`, `DELETE` | `/api/tickets/:id/comments`, `/api/tickets/:id/comments/:commentId` | selon droits |
| `POST` | `/api/tickets/:id/attachments` (multipart, champ `files`) | selon droits |
| `GET`, `DELETE` | `/api/attachments/:id` | selon droits |
| `GET` | `/api/stats` | connecté |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/users`, `/api/users/:id` | admin |
| `POST` | `/api/users/:id/reset-password`, `/api/users/:id/reset-mfa`, `/api/users/:id/mfa-exempt` (`exempt` : true ou false) | admin |
| `GET` | `/api/groups` (groupes et membres) | connecté |
| `POST`, `PATCH`, `DELETE` | `/api/groups`, `/api/groups/:id` (`members` : liste des identifiants, `joinable`) | admin |
| `POST` | `/api/users/:id/impersonate` ; `GET` `/api/users/impersonations` | admin |
| `POST` | `/api/auth/impersonate/stop` ; `GET` `/api/auth/impersonations` (accès à mon compte) | connecté |
| `GET` | `/api/groups/self` ; `POST`, `DELETE` `/api/groups/:id/requests` ; `POST` `/api/groups/:id/leave` | connecté |
| `GET` | `/api/groups/requests` ; `POST` `/api/groups/requests/:id/approve`, `/api/groups/requests/:id/reject` | admin |
| `GET` | `/api/catalog`, `/api/catalog/:id` (formulaires proposés à l'utilisateur) | connecté |
| `POST` | `/api/catalog/:id/submit` (`answers` : réponses par identifiant de question) | connecté |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/admin/catalog`, `/api/admin/catalog/:id` ; `POST /api/admin/catalog/:id/duplicate` | admin |
| `GET` | `/api/settings` (nom, couleur, logo, catégories, priorités), `/api/settings/logo` | public |
| `GET`, `PUT` | `/api/admin/settings/access` (droits et règles par catégorie) | admin |
| `GET` | `/api/admin/settings` ; `PUT` `/api/admin/settings/lists`, `/api/admin/settings/appearance` ; `POST`, `DELETE` `/api/admin/settings/logo` | admin |
| `GET`, `PUT` | `/api/admin/backup/schedule` ; `POST` `/api/admin/backup/run`, `/api/admin/backup/test-dir` | admin |
| `GET` | `/api/admin/backup/download`, `/api/admin/backup/destinations` | admin |
| `POST` | `/api/admin/backup/write` | admin |
| `GET`, `DELETE` | `/api/admin/trash`, `/api/admin/trash/:id` | admin |
| `POST` | `/api/admin/trash/:id/restore` | admin |

## Tests et intégration continue

```bash
cd backend && npm test      # 31 tests : authentification, droits, tickets, pièces jointes, admin, migration
cd frontend && npm run lint && npm run build

# Parcours navigateur (Playwright) : démarre l'API sur une base jetable et le frontend compilé
cd e2e && npm install && npx playwright install chromium && npm test
```

Les tests navigateur couvrent l'inscription du premier administrateur, la création d'un ticket avec pièce jointe, les commentaires, le changement de statut, le téléchargement, la recherche et les filtres, le tableau de bord, la corbeille, la réinitialisation de mot de passe, les droits d'un utilisateur simple, et l'affichage sur mobile (aucun défilement horizontal).

GitHub Actions (`.github/workflows/ci.yml`) lance les trois niveaux de tests à chaque push et pull request. Render et Vercel attendent leur succès avant de déployer : un commit qui casse un test n'arrive pas en production.

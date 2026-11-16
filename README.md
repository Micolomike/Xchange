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

**Tableau de bord**
- Compteurs (ouverts, en cours, en retard, délai moyen de résolution sur 90 jours), « Ma file » triée par priorité, activité récente, graphique créés/résolus sur 14 jours, répartition des tickets actifs par priorité.

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

Le dossier `deploy/windows/` installe Xchange sur un PC, de façon isolée : compte Windows dédié sans droits administrateur, dossier `C:\Xchange` réservé, écoute sur `127.0.0.1` uniquement, démarrage avec Windows et sauvegarde chaque nuit. L'accès depuis Internet passe par Tailscale Funnel, sans ouvrir de port sur la box.

| Script (Terminal administrateur) | Rôle |
|---|---|
| `installer.ps1` | Installe ou réinstalle (configuration et données conservées) |
| `mettre-a-jour.ps1` | Sauvegarde, récupère la dernière version, recompile, redémarre |
| `etat.ps1` | Affiche l'état : application, accès Internet, sauvegardes, journal |
| `redemarrer.ps1` | Redémarre Xchange (après une modification de `C:\Xchange\xchange.env`) |
| `restaurer.ps1` | Remet une sauvegarde choisie dans une liste |
| `desinstaller.ps1` | Coupe l'accès Internet, supprime tâches et compte (`-SupprimerDonnees` pour tout effacer) |

Chaque script se lance avec `powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\<script>`. En mode PC, l'API sert aussi le site (`SERVE_FRONTEND=true`, site compilé par `npm run build:pc`), la configuration est lue dans `C:\Xchange\xchange.env`, et un compte est verrouillé 15 minutes après 10 échecs de connexion (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`).

## Reprise d'une base existante

Au démarrage, l'API met à niveau une base de la première version sans perte : ajout des nouvelles colonnes, normalisation des anciennes valeurs (dates limites vides, priorités manquantes), import du fichier `logs/deleted-tickets.json` dans la corbeille (renommé ensuite en `.imported.json`). Les anciens mots de passe restent valables. S'il n'existe aucun administrateur, le plus ancien compte est promu.

## API

Toutes les routes sauf `/api/auth/register`, `/api/auth/login`, `/api/auth/config` et `/api/health` exigent l'en-tête `Authorization: Bearer <jeton>`. Les erreurs sont renvoyées sous la forme `{ "error": "message", "details": { "champ": "message" } }`.

| Méthode | Route | Accès |
|---|---|---|
| `POST` | `/api/auth/register`, `/api/auth/login` | public |
| `GET`, `PUT` | `/api/auth/me` | connecté |
| `GET` | `/api/tickets?status=&priority=&category=&assignee=&scope=&overdue=&q=&sort=&order=&page=&pageSize=` | connecté |
| `POST` | `/api/tickets` | connecté |
| `GET`, `PATCH` | `/api/tickets/:id` | selon droits sur le ticket |
| `DELETE` | `/api/tickets/:id` (mise à la corbeille) | admin |
| `POST`, `DELETE` | `/api/tickets/:id/comments`, `/api/tickets/:id/comments/:commentId` | selon droits |
| `POST` | `/api/tickets/:id/attachments` (multipart, champ `files`) | selon droits |
| `GET`, `DELETE` | `/api/attachments/:id` | selon droits |
| `GET` | `/api/stats` | connecté |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/users`, `/api/users/:id` | admin |
| `POST` | `/api/users/:id/reset-password` | admin |
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

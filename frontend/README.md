# Xchange : frontend

Interface React 19 + Vite + Tailwind CSS 4. Voir le [README principal](../README.md) pour l'installation, la configuration et le déploiement.

```bash
npm install
npm run dev      # http://localhost:5173, /api redirigé vers http://localhost:4000
npm run lint
npm run build    # sortie dans dist/
```

Organisation :

- `src/lib/` : client API (`api.js`), libellés (`constants.js`), formats de date et de taille, notifications.
- `src/auth/` : contexte de session (jeton JWT stocké dans le navigateur).
- `src/components/` : barre de navigation, badges (statut, priorité, numéro de ticket), graphique, zone de dépôt de fichiers.
- `src/pages/` : tableau de bord, liste et fiche des tickets, création, administration, compte.

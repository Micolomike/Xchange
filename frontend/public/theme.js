// Applique le thème (clair, sombre ou celui du système) avant l'affichage, pour éviter un flash blanc.
(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('xchange.theme') || 'system';
  } catch {
    /* stockage indisponible : thème du système */
  }
  var dark = choice === 'dark' || (choice !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();

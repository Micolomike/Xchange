// Vérifie que le module natif SQLite est utilisable (code 0) ou non (code 1), sans bruit.
try {
  require('sqlite3');
  process.exit(0);
} catch {
  process.exit(1);
}

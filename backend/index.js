const { loadConfig } = require('./src/config');
const { openDatabase } = require('./src/db');
const { createApp, ensureAdmin } = require('./src/app');
const { startBackupScheduler } = require('./src/backupScheduler');

async function main() {
  const config = loadConfig();
  if (config.jwtSecretIsEphemeral) {
    console.warn(
      '⚠️  JWT_SECRET non défini : un secret temporaire est utilisé, les sessions seront perdues à chaque redémarrage.'
    );
  }

  const db = await openDatabase(config.databasePath, { legacyDeletedLogPath: config.legacyDeletedLogPath });
  await ensureAdmin(db, config);

  const app = createApp({ db, config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Xchange démarré sur http://${config.host || 'localhost'}:${config.port}`);
    console.log(`Base de données : ${config.databasePath}`);
    if (config.serveFrontend) console.log(`Site servi depuis : ${config.frontendDir}`);
  });

  // Journal horodaté pour les sauvegardes automatiques (C:\Xchange\journaux sur un PC).
  const stampLog = (fn) => (msg) => fn(`${new Date().toISOString()} ${msg}`);
  const stopBackups = startBackupScheduler({
    db,
    config,
    logger: { info: stampLog(console.log), error: stampLog(console.error) },
  });
  if (config.backupDir) console.log(`Sauvegardes automatiques dans : ${config.backupDir}`);

  const shutdown = () => {
    stopBackups();
    server.close(() => db.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Échec du démarrage :', err);
  process.exit(1);
});

const { loadConfig } = require('./src/config');
const { openDatabase } = require('./src/db');
const { createApp, ensureAdmin } = require('./src/app');

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
  const server = app.listen(config.port, () => {
    console.log(`Xchange API démarrée sur http://localhost:${config.port}`);
    console.log(`Base de données : ${config.databasePath}`);
  });

  const shutdown = () => {
    server.close(() => db.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Échec du démarrage :', err);
  process.exit(1);
});

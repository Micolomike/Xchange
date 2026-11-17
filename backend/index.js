const { upgradeProducers } = require('./src/ticketFields');
const { loadConfig } = require('./src/config');
const { openDatabase } = require('./src/db');
const { createApp, ensureAdmin } = require('./src/app');
const { startBackupScheduler } = require('./src/backupScheduler');
const { startRgpdScheduler } = require('./src/rgpd');
const { startReportScheduler } = require('./src/reportSchedules');
const { backfillSla, startSlaScheduler } = require('./src/sla');
const { applyContent } = require('./src/content');
const { syncTerms } = require('./src/terms');
const { createSystemLog } = require('./src/systemLog');
const { version } = require('./package.json');

async function main() {
  const config = loadConfig();
  const db = await openDatabase(config.databasePath, { legacyDeletedLogPath: config.legacyDeletedLogPath });
  // Journal système : console horodatée (C:\Xchange\journaux sur le PC) et onglet « Journal système ».
  const syslog = createSystemLog({ db, stamp: true });
  const log = (source) => syslog.for(source);
  if (config.jwtSecretIsEphemeral) log('serveur').warn('JWT_SECRET non défini : sessions perdues à chaque redémarrage.');
  await ensureAdmin(db, config, log('serveur'));
  if (config.seedContent) await applyContent(db);
  // Record producers : anciens réglages « compléter le titre » et réponses déjà envoyées vers la table des variables.
  const upgraded = await upgradeProducers(db);
  if (upgraded) log('catalogue').info(`Réponses de ${upgraded} demande(s) rangées dans la table des variables.`);
  // Version de la charte prête avant la première requête (comptes ayant déjà accepté : version 1).
  await syncTerms(db);

  const app = createApp({ db, config, syslog });
  const server = app.listen(config.port, config.host, () => {
    log('serveur').info(`Xchange ${version} démarré sur http://${config.host || 'localhost'}:${config.port}`);
    console.log(`Base de données : ${config.databasePath}`);
    if (config.serveFrontend) console.log(`Site servi depuis : ${config.frontendDir}`);
  });

  const stopBackups = startBackupScheduler({ db, config, logger: log('sauvegarde') });
  const stopPurge = startRgpdScheduler({ db, config, notifier: app.locals.notifier, logger: log('rgpd') });
  // SLA : échéances des demandes antérieures à leur mise en place, puis alertes toutes les 5 minutes.
  const filled = await backfillSla(db);
  if (filled) log('sla').info(`Échéances calculées pour ${filled} demande(s) existante(s).`);
  const stopSla = startSlaScheduler({ db, notifier: app.locals.notifier, logger: log('sla') });
  const stopReports = startReportScheduler({ db, mailer: app.locals.mailer, logger: log('rapports') });
  if (config.backupDir) console.log(`Sauvegardes automatiques dans : ${config.backupDir}`);

  const shutdown = async () => {
    await log('serveur').info('Arrêt de Xchange demandé.');
    stopBackups();
    stopPurge();
    stopReports();
    stopSla();
    server.close(() => db.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Échec du démarrage :', err);
  process.exit(1);
});

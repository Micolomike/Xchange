/**
 * Secours : remet à zéro la double authentification d'un compte (téléphone perdu sans codes de secours).
 * Usage (sur le PC, Terminal administrateur) :
 *   node --env-file=C:\Xchange\xchange.env scripts\reinitialiser-mfa.js <nom d'utilisateur>
 */
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { resetMfa } = require('../src/routes/users');

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Indiquez le nom d'utilisateur : node scripts/reinitialiser-mfa.js <nom>");
    process.exit(1);
  }
  const config = loadConfig();
  const db = await openDatabase(config.databasePath, { logger: { info() {}, warn() {}, error() {} } });
  try {
    const row = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
    if (!row) {
      console.error(`Aucun compte « ${username} ».`);
      process.exitCode = 1;
      return;
    }
    await resetMfa(db, row);
    console.log(`Double authentification remise à zéro pour « ${row.username} » : elle sera reconfigurée à la prochaine connexion.`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});

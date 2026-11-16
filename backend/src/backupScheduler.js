/**
 * Sauvegarde automatique faite par Xchange lui-même, à l'heure choisie dans l'Administration.
 * Si le PC était éteint à l'heure prévue, la sauvegarde est faite au démarrage suivant.
 */
const path = require('path');
const { localBackup, zipCopy } = require('./backup');
const { getSetting, setSetting } = require('./settings');

/** Dernier créneau prévu avant `now` (aujourd'hui à l'heure choisie, sinon hier), en heure locale du PC. */
function lastSlot(time, now = new Date()) {
  const [h, m] = time.split(':').map(Number);
  const slot = new Date(now);
  slot.setHours(h, m, 0, 0);
  if (slot > now) slot.setDate(slot.getDate() - 1);
  return slot;
}

function nextSlot(time, now = new Date()) {
  const slot = lastSlot(time, now);
  slot.setDate(slot.getDate() + 1);
  return slot;
}

async function runBackup({ db, config, logger = console, now = new Date() }) {
  const settings = await getSetting(db, 'backup');
  const state = await getSetting(db, 'backup_state');
  state.lastRunAt = now.toISOString();
  try {
    const r = await localBackup({ config, destination: config.backupDir, keep: settings.keep, now });
    Object.assign(state, { lastStatus: 'ok', lastError: null, lastFile: r.file });
    logger.info(`Sauvegarde OK : ${r.file} (${r.copied} fichier(s) joint(s) copié(s), ${r.removed} ancienne(s) supprimée(s))`);
  } catch (err) {
    Object.assign(state, { lastStatus: 'error', lastError: err.message });
    logger.error(`ÉCHEC de la sauvegarde : ${err.message}`);
  }
  if (settings.copyDir) {
    try {
      const c = await zipCopy({ config, directory: settings.copyDir, keep: settings.keep, now });
      Object.assign(state, { copyStatus: 'ok', copyError: null, copyFile: c.file });
      logger.info(`Copie OK : ${c.file}`);
    } catch (err) {
      Object.assign(state, { copyStatus: 'error', copyError: explainWriteError(err, settings.copyDir) });
      logger.error(`ÉCHEC de la copie vers ${settings.copyDir} : ${err.message}`);
    }
  } else {
    Object.assign(state, { copyStatus: null, copyError: null, copyFile: null });
  }
  await setSetting(db, 'backup_state', state);
  return state;
}

function explainWriteError(err, dir) {
  if (['EACCES', 'EPERM'].includes(err.code)) {
    return `Xchange n'a pas le droit d'écrire dans ${dir}. Autorisez ce dossier avec le script autoriser-dossier.ps1 (voir le guide).`;
  }
  if (err.code === 'ENOENT') return `Le disque ou le dossier ${path.parse(dir).root || dir} est introuvable (disque débranché ?).`;
  if (err.code === 'ENOSPC') return `Plus assez de place dans ${dir}.`;
  return err.message;
}

/** Vérifie chaque minute si une sauvegarde est due. Renvoie une fonction d'arrêt. */
function startBackupScheduler({ db, config, logger = console, intervalMs = 60_000 }) {
  if (!config.backupDir) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const settings = await getSetting(db, 'backup');
      if (!settings.enabled) return;
      const state = await getSetting(db, 'backup_state');
      const due = lastSlot(settings.time);
      if (!state.lastRunAt || new Date(state.lastRunAt) < due) await runBackup({ db, config, logger });
    } catch (err) {
      logger.error(`Planification des sauvegardes : ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  return () => clearInterval(timer);
}

module.exports = { startBackupScheduler, runBackup, lastSlot, nextSlot, explainWriteError };

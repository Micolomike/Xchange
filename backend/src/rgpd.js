/**
 * RGPD : anonymisation d'un compte, export des données d'une personne, purge des données trop anciennes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { HttpError, nowIso, displayName, parseNotifyPrefs } = require('./utils');
const { getSetting, setSetting } = require('./settings');

const monthsAgo = (months, now = new Date()) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
};

function removeFilesNow(uploadsDir, names) {
  for (const name of names) {
    try {
      fs.rmSync(path.join(uploadsDir, path.basename(name)), { force: true });
    } catch {
      /* fichier déjà absent */
    }
  }
}

async function countAdmins(db) {
  return (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND anonymized_at IS NULL")).n;
}

/**
 * Anonymise un compte. `mode` :
 * - 'keep' : ses demandes et messages restent, signés « Utilisateur supprimé n°X » ;
 * - 'delete' : ses demandes (avec leurs messages et fichiers) et ses messages ailleurs sont supprimés.
 * Dans les deux cas : identité, e-mail, mot de passe, double authentification, sessions, pièces jointes
 * qu'il a déposées, groupes, demandes d'adhésion, journal des e-mails et des impersonations le concernant.
 */
async function anonymizeUser(db, config, id, { mode = 'keep', actorId = null } = {}) {
  if (!['keep', 'delete'].includes(mode)) throw new HttpError(400, 'Choix invalide : conserver ou supprimer les demandes.');
  const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Utilisateur introuvable.');
  if (row.anonymized_at) throw new HttpError(400, 'Ce compte est déjà anonymisé.');
  if (actorId && id === actorId) throw new HttpError(400, 'Vous ne pouvez pas anonymiser votre propre compte.');
  if (row.role === 'admin' && (await countAdmins(db)) <= 1) {
    throw new HttpError(400, 'Impossible d’anonymiser le dernier administrateur.');
  }

  const files = [];
  const counts = { tickets: 0, comments: 0, attachments: 0 };
  const now = nowIso();
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  await db.exec('BEGIN');
  try {
    if (mode === 'delete') {
      const tickets = await db.all('SELECT id FROM tickets WHERE created_by = ?', [id]);
      if (tickets.length) {
        const ph = tickets.map(() => '?').join(',');
        const ids = tickets.map((t) => t.id);
        files.push(...(await db.all(`SELECT stored_name FROM attachments WHERE ticket_id IN (${ph})`, ids)).map((f) => f.stored_name));
        counts.tickets = (await db.run(`DELETE FROM tickets WHERE id IN (${ph})`, ids)).changes;
      }
      counts.comments = (await db.run('DELETE FROM comments WHERE author_id = ?', [id])).changes;
    }
    const own = await db.all('SELECT stored_name FROM attachments WHERE uploaded_by = ?', [id]);
    files.push(...own.map((f) => f.stored_name));
    counts.attachments = (await db.run('DELETE FROM attachments WHERE uploaded_by = ?', [id])).changes;

    await db.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [id]);
    await db.run('DELETE FROM group_members WHERE user_id = ?', [id]);
    await db.run('DELETE FROM group_requests WHERE user_id = ?', [id]);
    await db.run('DELETE FROM impersonations WHERE target_id = ?', [id]);
    await db.run('DELETE FROM mail_log WHERE user_id = ? OR (to_email IS NOT NULL AND to_email = ?)', [id, row.email || '']);
    await db.run(
      `UPDATE users SET username = ?, firstname = 'Utilisateur supprimé', lastname = ?, email = NULL, password = ?,
         role = 'user', token_version = token_version + 1, mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL,
         mfa_last_step = 0, mfa_exempt = 0, notify_email = 0, notify_prefs = NULL, last_seen_at = NULL,
         terms_accepted_at = NULL, anonymized_at = ?
       WHERE id = ?`,
      [`utilisateur-supprime-${id}`, `n°${id}`, unusable, now, id]
    );
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
  removeFilesNow(config.uploadsDir, files);
  return { mode, ...counts, files: files.length };
}

/** Toutes les données d'une personne, lisibles (droit d'accès et portabilité). */
async function exportUser(db, id) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
  const tickets = await db.all(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.due_date, t.confidential, t.form_answers,
            t.created_at, t.updated_at, t.resolved_at, t.deleted_at, g.name AS group_name
     FROM tickets t LEFT JOIN user_groups g ON g.id = t.assigned_group WHERE t.created_by = ? ORDER BY t.id`,
    [id]
  );
  for (const t of tickets) {
    t.confidential = Boolean(t.confidential);
    try {
      t.form_answers = t.form_answers ? JSON.parse(t.form_answers) : null;
    } catch {
      /* réponses illisibles : laissées telles quelles */
    }
    t.messages = (
      await db.all(
        `SELECT c.body, c.created_at, u.username, u.firstname, u.lastname FROM comments c
         LEFT JOIN users u ON u.id = c.author_id WHERE c.ticket_id = ? ORDER BY c.id`,
        [t.id]
      )
    ).map((c) => ({ author: c.username ? displayName(c) : 'Compte supprimé', body: c.body, created_at: c.created_at }));
    t.attachments = await db.all('SELECT original_name, mime_type, size, created_at FROM attachments WHERE ticket_id = ?', [t.id]);
    t.history = await db.all('SELECT type, from_value, to_value, created_at FROM ticket_events WHERE ticket_id = ? ORDER BY id', [t.id]);
  }
  const messagesElsewhere = await db.all(
    `SELECT c.ticket_id, c.body, c.created_at FROM comments c JOIN tickets t ON t.id = c.ticket_id
     WHERE c.author_id = ? AND t.created_by IS NOT ? ORDER BY c.id`,
    [id, id]
  );
  const prefs = parseNotifyPrefs(u.notify_prefs);
  return {
    exported_at: nowIso(),
    note: 'Export de vos données personnelles conservées par Xchange (RGPD, articles 15 et 20).',
    account: {
      id: u.id,
      username: u.username,
      firstname: u.firstname,
      lastname: u.lastname,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
      last_seen_at: u.last_seen_at,
      terms_accepted_at: u.terms_accepted_at,
      anonymized_at: u.anonymized_at,
      double_authentication: Boolean(u.mfa_enabled),
      email_notifications: Boolean(u.notify_email),
      notification_choices: prefs,
    },
    groups: (await db.all('SELECT g.name FROM group_members m JOIN user_groups g ON g.id = m.group_id WHERE m.user_id = ?', [id])).map((g) => g.name),
    group_requests: await db.all(
      `SELECT g.name AS group_name, r.status, r.message, r.created_at, r.decided_at FROM group_requests r
       JOIN user_groups g ON g.id = r.group_id WHERE r.user_id = ? ORDER BY r.id`,
      [id]
    ),
    requests: tickets,
    messages_on_other_requests: messagesElsewhere,
    assigned_requests: (await db.all('SELECT id, title, status FROM tickets WHERE assigned_to = ? ORDER BY id', [id])),
    attachments_uploaded: await db.all('SELECT ticket_id, original_name, size, created_at FROM attachments WHERE uploaded_by = ?', [id]),
    emails_sent: await db.all('SELECT created_at, event, subject, status FROM mail_log WHERE user_id = ? ORDER BY id', [id]),
    data_requests: await db.all('SELECT type, message, status, response, created_at, handled_at FROM rgpd_requests WHERE user_id = ? ORDER BY id', [id]),
    impersonations: await db.all(
      `SELECT i.started_at, i.ended_at, a.username AS by_admin FROM impersonations i LEFT JOIN users a ON a.id = i.admin_id
       WHERE i.target_id = ? ORDER BY i.id`,
      [id]
    ),
  };
}

/** Ce que la purge ferait (ou fait) avec les réglages actuels. */
async function purgeCandidates(db, settings, now = new Date()) {
  const result = { inactive: [], logs: { mail: 0, impersonations: 0, groupRequests: 0 }, trash: 0 };
  const trashDays = settings.trashDays ?? 30;
  if (trashDays > 0) {
    const limit = new Date(now.getTime() - trashDays * 86400_000).toISOString();
    result.trash = (await db.get('SELECT COUNT(*) AS n FROM tickets WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit])).n;
  }
  if (settings.inactiveMonths > 0) {
    const limit = monthsAgo(settings.inactiveMonths, now);
    result.inactive = (
      await db.all(
        `SELECT id, username, firstname, lastname, COALESCE(last_seen_at, created_at) AS last_seen FROM users
         WHERE anonymized_at IS NULL AND role <> 'admin' AND COALESCE(last_seen_at, created_at) < ? ORDER BY last_seen`,
        [limit]
      )
    ).map((u) => ({ id: u.id, name: displayName(u), last_seen: u.last_seen }));
  }
  if (settings.logMonths > 0) {
    const limit = monthsAgo(settings.logMonths, now);
    result.logs.mail = (await db.get('SELECT COUNT(*) AS n FROM mail_log WHERE created_at < ?', [limit])).n;
    result.logs.impersonations = (await db.get('SELECT COUNT(*) AS n FROM impersonations WHERE started_at < ?', [limit])).n;
    result.logs.groupRequests = (
      await db.get("SELECT COUNT(*) AS n FROM group_requests WHERE status <> 'pending' AND COALESCE(decided_at, created_at) < ?", [limit])
    ).n;
  }
  return result;
}

async function runPurge(db, config, { now = new Date(), logger = console } = {}) {
  const settings = await getSetting(db, 'rgpd');
  const todo = await purgeCandidates(db, settings, now);
  const done = { accounts: 0, mail: 0, impersonations: 0, groupRequests: 0, trash: 0 };
  for (const u of todo.inactive) {
    await anonymizeUser(db, config, u.id, { mode: 'keep' });
    done.accounts += 1;
  }
  if (settings.logMonths > 0) {
    const limit = monthsAgo(settings.logMonths, now);
    done.mail = (await db.run('DELETE FROM mail_log WHERE created_at < ?', [limit])).changes;
    done.impersonations = (await db.run('DELETE FROM impersonations WHERE started_at < ?', [limit])).changes;
    done.groupRequests = (
      await db.run("DELETE FROM group_requests WHERE status <> 'pending' AND COALESCE(decided_at, created_at) < ?", [limit])
    ).changes;
  }
  // Corbeille : les demandes supprimées sont effacées définitivement (avec leurs fichiers) après le délai.
  const trashDays = settings.trashDays ?? 30;
  if (trashDays > 0) {
    const limit = new Date(now.getTime() - trashDays * 86400_000).toISOString();
    const old = await db.all('SELECT id FROM tickets WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit]);
    if (old.length) {
      const ph = old.map(() => '?').join(',');
      const ids = old.map((t) => t.id);
      const files = (await db.all(`SELECT stored_name FROM attachments WHERE ticket_id IN (${ph})`, ids)).map((f) => f.stored_name);
      done.trash = (await db.run(`DELETE FROM tickets WHERE id IN (${ph})`, ids)).changes;
      removeFilesNow(config.uploadsDir, files);
    }
  }
  await setSetting(db, 'rgpd_state', { lastRunAt: now.toISOString(), lastResult: done, lastError: null });
  if (done.accounts || done.mail || done.impersonations || done.groupRequests || done.trash) {
    logger.info(
      `Purge RGPD : ${done.accounts} compte(s) inactif(s) anonymisé(s), ${done.mail + done.impersonations + done.groupRequests} ligne(s) de journal ` +
        `supprimée(s), ${done.trash} demande(s) de la corbeille effacée(s).`
    );
  }
  return done;
}

/** Purge une fois par jour (au démarrage puis toutes les 24 h). Renvoie une fonction d'arrêt. */
function startRgpdScheduler({ db, config, logger = console, intervalMs = 60 * 60_000 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const state = await getSetting(db, 'rgpd_state');
      if (!state.lastRunAt || Date.now() - new Date(state.lastRunAt).getTime() >= 24 * 3600_000) {
        await runPurge(db, config, { logger });
      }
    } catch (err) {
      logger.error(`Purge RGPD : ${err.message}`);
      const state = await getSetting(db, 'rgpd_state').catch(() => ({}));
      await setSetting(db, 'rgpd_state', { ...state, lastError: err.message }).catch(() => {});
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 30_000).unref();
  return () => clearInterval(timer);
}

module.exports = { anonymizeUser, exportUser, purgeCandidates, runPurge, startRgpdScheduler };

/**
 * RGPD : anonymisation d'un compte, export des données d'une personne, purge des données trop anciennes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { HttpError, nowIso, displayName, parseNotifyPrefs } = require('./utils');
const { getSetting, setSetting } = require('./settings');

/** Délai entre l'e-mail d'avertissement et l'anonymisation d'un compte inactif. */
const WARNING_DAYS = 30;

const addMonths = (iso, months) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};

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
  const counts = { tickets: 0, comments: 0, attachments: 0, chat: 0 };
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
      counts.chat = (await db.run('DELETE FROM chat_messages WHERE author_id = ?', [id])).changes;
      await db.run('DELETE FROM chat_reports WHERE author_id = ?', [id]);
    }
    // Analyses : ses rapports, tableaux de bord et envois programmés sont supprimés ; elle ne reçoit plus ceux des autres.
    await db.run('DELETE FROM reports WHERE owner_id = ?', [id]);
    await db.run('DELETE FROM dashboards WHERE owner_id = ?', [id]);
    await db.run('DELETE FROM report_schedule_users WHERE user_id = ?', [id]);
    // Discussions : la personne quitte ses conversations ; ses messages restent signés « Utilisateur supprimé » (mode conserver).
    await db.run('DELETE FROM chat_members WHERE user_id = ?', [id]);
    await db.run('DELETE FROM chat_reads WHERE user_id = ?', [id]);
    await db.run(
      "DELETE FROM chat_conversations WHERE kind IN ('direct', 'custom') AND id NOT IN (SELECT conversation_id FROM chat_members)"
    );
    const own = await db.all('SELECT stored_name FROM attachments WHERE uploaded_by = ?', [id]);
    files.push(...own.map((f) => f.stored_name));
    counts.attachments = (await db.run('DELETE FROM attachments WHERE uploaded_by = ?', [id])).changes;

    await db.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [id]);
    await db.run('DELETE FROM trusted_devices WHERE user_id = ?', [id]);
    await db.run('DELETE FROM security_events WHERE user_id = ?', [id]);
    await db.run('DELETE FROM terms_acceptances WHERE user_id = ?', [id]);
    await db.run('DELETE FROM group_members WHERE user_id = ?', [id]);
    await db.run('DELETE FROM group_requests WHERE user_id = ?', [id]);
    await db.run('DELETE FROM impersonations WHERE target_id = ?', [id]);
    await db.run('DELETE FROM mail_log WHERE user_id = ? OR (to_email IS NOT NULL AND to_email = ?)', [id, row.email || '']);
    await db.run(
      `UPDATE users SET username = ?, firstname = 'Utilisateur supprimé', lastname = ?, email = NULL, password = ?,
         role = 'user', token_version = token_version + 1, mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL,
         mfa_last_step = 0, mfa_exempt = 0, mfa_exempt_by = NULL, mfa_exempt_at = NULL, notify_email = 0, notify_prefs = NULL, last_seen_at = NULL,
         terms_accepted_at = NULL, terms_version = 0, inactivity_warned_at = NULL, hide_real_name = 0, chat_retention_days = 0, anonymized_at = ?
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

/** Conversations où la personne a écrit ou dont elle fait partie (pour l'export). */
async function chatConversations(db, id) {
  const rows = await db.all(
    `SELECT c.id, c.kind, c.name, g.name AS group_name, c.created_at FROM chat_conversations c LEFT JOIN user_groups g ON g.id = c.group_id
     WHERE c.id IN (SELECT conversation_id FROM chat_members WHERE user_id = ?) OR c.id IN (SELECT conversation_id FROM chat_messages WHERE author_id = ?)
     ORDER BY c.id`,
    [id, id]
  );
  const labels = { general: 'Salon général', group: 'Salon de groupe', direct: 'Message privé', custom: 'Conversation de groupe' };
  return rows.map((c) => ({ id: c.id, type: labels[c.kind] || c.kind, name: c.kind === 'group' ? c.group_name : c.name || null, created_at: c.created_at }));
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
        `SELECT c.body, c.created_at, u.username, CASE WHEN u.hide_real_name = 1 AND u.id <> ? THEN '' ELSE u.firstname END AS firstname, CASE WHEN u.hide_real_name = 1 AND u.id <> ? THEN '' ELSE u.lastname END AS lastname FROM comments c
         LEFT JOIN users u ON u.id = c.author_id WHERE c.ticket_id = ? ORDER BY c.id`,
        [id, id, t.id]
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
      double_authentication_declined: u.mfa_exempt ? { by: u.mfa_exempt_by === 'self' ? 'vous-même' : 'un administrateur', at: u.mfa_exempt_at } : null,
      email_notifications: Boolean(u.notify_email),
      notification_choices: prefs,
      shown_to_others_as: u.hide_real_name ? 'pseudonyme seul' : 'prénom et nom',
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
    charter_acceptances: await db.all('SELECT version, accepted_at FROM terms_acceptances WHERE user_id = ? ORDER BY id', [id]),
    trusted_browsers: await db.all('SELECT label, created_at, last_used_at, expires_at FROM trusted_devices WHERE user_id = ? ORDER BY id', [id]),
    security_history: await db.all('SELECT type, detail, created_at FROM security_events WHERE user_id = ? ORDER BY id', [id]),
    data_requests: await db.all('SELECT type, message, status, response, created_at, handled_at FROM rgpd_requests WHERE user_id = ? ORDER BY id', [id]),
    chat: {
      keep_messages: u.chat_retention_days ? `${u.chat_retention_days} jours` : 'tant que le compte existe',
      conversations: await chatConversations(db, id),
      messages: await db.all(
        `SELECT m.id, m.conversation_id, m.body, m.created_at, m.deleted_at FROM chat_messages m WHERE m.author_id = ? ORDER BY m.id`,
        [id]
      ),
      reports_made: await db.all('SELECT reason, snapshot AS message, status, created_at, handled_at FROM chat_reports WHERE reporter_id = ? ORDER BY id', [id]),
    },
    analyses: {
      reports: (await db.all('SELECT name, description, definition, visibility, created_at, updated_at FROM reports WHERE owner_id = ? ORDER BY id', [id])).map((r) => ({
        ...r,
        definition: JSON.parse(r.definition),
      })),
      dashboards: (await db.all('SELECT name, description, widgets, visibility, created_at, updated_at FROM dashboards WHERE owner_id = ? ORDER BY id', [id])).map((d) => ({
        ...d,
        widgets: JSON.parse(d.widgets),
      })),
      scheduled_sends: await db.all(
        `SELECT r.name AS report, s.frequency, s.weekday, s.monthday, s.time, s.active, s.created_at FROM report_schedules s JOIN reports r ON r.id = s.report_id
         WHERE s.owner_id = ? ORDER BY s.id`,
        [id]
      ),
      receives: (
        await db.all(
          `SELECT r.name FROM report_schedule_users x JOIN report_schedules s ON s.id = x.schedule_id JOIN reports r ON r.id = s.report_id WHERE x.user_id = ?`,
          [id]
        )
      ).map((r) => r.name),
    },
    impersonations: await db.all(
      `SELECT i.started_at, i.ended_at, a.username AS by_admin FROM impersonations i LEFT JOIN users a ON a.id = i.admin_id
       WHERE i.target_id = ? ORDER BY i.id`,
      [id]
    ),
  };
}

/** Ce que la purge ferait (ou fait) avec les réglages actuels. */
async function purgeCandidates(db, settings, now = new Date(), { canMail = false } = {}) {
  const result = { inactive: [], toWarn: [], warned: [], logs: { mail: 0, impersonations: 0, groupRequests: 0 }, trash: 0 };
  const trashDays = settings.trashDays ?? 30;
  if (trashDays > 0) {
    const limit = new Date(now.getTime() - trashDays * 86400_000).toISOString();
    result.trash = (await db.get('SELECT COUNT(*) AS n FROM tickets WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit])).n;
  }
  if (settings.inactiveMonths > 0) {
    // Un e-mail prévient la personne un mois avant ; sans adresse (ou sans envoi possible), pas d'avertissement.
    const limit = monthsAgo(settings.inactiveMonths, now);
    const warnFrom = new Date(new Date(limit).getTime() + WARNING_DAYS * 86400_000).toISOString();
    const warnedLongAgo = new Date(now.getTime() - WARNING_DAYS * 86400_000).toISOString();
    const rows = await db.all(
      `SELECT id, username, firstname, lastname, email, inactivity_warned_at, COALESCE(last_seen_at, created_at) AS last_seen FROM users
       WHERE anonymized_at IS NULL AND role <> 'admin' AND COALESCE(last_seen_at, created_at) < ? ORDER BY last_seen`,
      [warnFrom]
    );
    for (const u of rows) {
      const entry = { id: u.id, name: displayName(u), last_seen: u.last_seen };
      const canWarn = canMail && Boolean(u.email);
      const warned = Boolean(u.inactivity_warned_at && u.inactivity_warned_at > u.last_seen);
      const due = addMonths(u.last_seen, settings.inactiveMonths);
      if (u.last_seen < limit && (!canWarn || (warned && u.inactivity_warned_at <= warnedLongAgo))) {
        result.inactive.push({ ...entry, warned });
      } else if (canWarn && !warned) {
        const in30 = new Date(now.getTime() + WARNING_DAYS * 86400_000).toISOString();
        result.toWarn.push({ ...entry, row: u, deadline: due > in30 ? due : in30 });
      } else if (warned) {
        const after = new Date(new Date(u.inactivity_warned_at).getTime() + WARNING_DAYS * 86400_000).toISOString();
        result.warned.push({ ...entry, deadline: due > after ? due : after });
      }
    }
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

async function runPurge(db, config, { now = new Date(), logger = console, notifier = null } = {}) {
  const settings = await getSetting(db, 'rgpd');
  const canMail = notifier ? await notifier.canSend() : false;
  const todo = await purgeCandidates(db, settings, now, { canMail });
  const done = { warned: 0, accounts: 0, mail: 0, impersonations: 0, groupRequests: 0, assistant: 0, chatMessages: 0, chatReports: 0, reportRuns: 0, trash: 0 };
  for (const u of todo.toWarn) {
    if (await notifier.inactivityWarning(u.row, { lastSeen: u.last_seen, deadline: u.deadline })) {
      await db.run('UPDATE users SET inactivity_warned_at = ? WHERE id = ?', [now.toISOString(), u.id]);
      done.warned += 1;
    }
  }
  for (const u of todo.inactive) {
    await anonymizeUser(db, config, u.id, { mode: 'keep' });
    done.accounts += 1;
  }
  if (settings.logMonths > 0) {
    const limit = monthsAgo(settings.logMonths, now);
    done.mail = (await db.run('DELETE FROM mail_log WHERE created_at < ?', [limit])).changes;
    done.impersonations = (await db.run('DELETE FROM impersonations WHERE started_at < ?', [limit])).changes;
    done.assistant = (await db.run('DELETE FROM assistant_misses WHERE created_at < ?', [limit])).changes;
    done.reportRuns = (await db.run('DELETE FROM report_runs WHERE ran_at < ?', [limit])).changes;
    done.chatReports = (await db.run("DELETE FROM chat_reports WHERE status <> 'pending' AND COALESCE(handled_at, created_at) < ?", [limit])).changes;
    done.groupRequests = (
      await db.run("DELETE FROM group_requests WHERE status <> 'pending' AND COALESCE(decided_at, created_at) < ?", [limit])
    ).changes;
  }
  // Discussions : chaque personne choisit combien de temps ses messages sont gardés (0 : tant que le compte existe).
  done.chatMessages = (
    await db.run(
      `DELETE FROM chat_messages WHERE author_id IN (SELECT id FROM users WHERE chat_retention_days > 0)
       AND julianday(created_at) < julianday(?) - (SELECT chat_retention_days FROM users WHERE users.id = chat_messages.author_id)`,
      [now.toISOString()]
    )
  ).changes;
  // Messages supprimés par leur auteur ou la modération : la trace « Message supprimé » disparaît après 30 jours.
  done.chatMessages += (
    await db.run('DELETE FROM chat_messages WHERE deleted_at IS NOT NULL AND julianday(deleted_at) < julianday(?) - 30', [now.toISOString()])
  ).changes;
  // Navigateurs de confiance expirés : rien à garder.
  await db.run('DELETE FROM trusted_devices WHERE expires_at < ?', [now.toISOString()]);
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
  if (done.warned || done.accounts || done.mail || done.impersonations || done.groupRequests || done.trash || done.chatMessages) {
    logger.info(
      `Purge RGPD : ${done.warned} compte(s) inactif(s) prévenu(s) par e-mail, ${done.accounts} compte(s) inactif(s) anonymisé(s), ${done.mail + done.impersonations + done.groupRequests} ligne(s) de journal ` +
        `supprimée(s), ${done.chatMessages} message(s) de discussion effacé(s), ${done.trash} demande(s) de la corbeille effacée(s).`
    );
  }
  return done;
}

/** Purge une fois par jour (au démarrage puis toutes les 24 h). Renvoie une fonction d'arrêt. */
function startRgpdScheduler({ db, config, notifier = null, logger = console, intervalMs = 60 * 60_000 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const state = await getSetting(db, 'rgpd_state');
      if (!state.lastRunAt || Date.now() - new Date(state.lastRunAt).getTime() >= 24 * 3600_000) {
        await runPurge(db, config, { logger, notifier });
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

module.exports = { WARNING_DAYS, anonymizeUser, exportUser, purgeCandidates, runPurge, startRgpdScheduler };

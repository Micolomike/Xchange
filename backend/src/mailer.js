/**
 * Envoi des e-mails (SMTP, par exemple smtp.orange.fr:465). Les erreurs n'interrompent
 * jamais l'action de l'utilisateur : elles sont journalisées et visibles dans l'Administration.
 */
const nodemailer = require('nodemailer');
const { getSetting, setSetting } = require('./settings');

const LOG_KEEP = 1000; // lignes gardées dans le journal des envois

/** Nature de chaque e-mail, pour le journal système. */
const EVENT_LABELS = {
  ticket_created: 'nouvelle demande pour un groupe',
  ticket_transferred: 'demande transférée',
  comment: 'nouveau message sur une demande',
  status_changed: 'changement de statut',
  assigned: 'demande assignée',
  join_requested: "demande d'adhésion à un groupe",
  join_decided: "réponse à une demande d'adhésion",
  rgpd_request: 'demande RGPD',
  sla_warning: 'délai bientôt dépassé (SLA)',
  sla_breach: 'délai dépassé (SLA)',
  chat_report: 'message de discussion signalé',
  inactivity_warning: "avertissement d'inactivité",
  test: "e-mail d'essai",
  report: 'rapport programmé',
};

/** Ligne du journal système : nature de l'envoi et numéro de la demande ou du rapport, jamais l'adresse ni l'objet. */
function journalText(meta) {
  const what = EVENT_LABELS[meta.event] || meta.event || 'autre';
  const ref = meta.ticketId ? ` (demande n°${meta.ticketId})` : meta.reportId ? ` (rapport n°${meta.reportId})` : '';
  return `${what}${ref}`;
}

function createMailer({ db, config, logger = console, transport, journal = null } = {}) {
  const smtp = config.smtp;
  const sent = []; // gardés en mémoire pour les tests
  let transporter = transport || null;
  if (!transporter && smtp) {
    transporter =
      smtp.host === 'test'
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
            connectionTimeout: 15_000,
            greetingTimeout: 15_000,
          });
  }

  const configured = Boolean(transporter);

  async function log(meta, message, status, error = null) {
    try {
      await db.run(
        'INSERT INTO mail_log (created_at, event, user_id, to_email, subject, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [new Date().toISOString(), meta.event || 'autre', meta.userId || null, message.to, message.subject, status, error]
      );
      await db.run(`DELETE FROM mail_log WHERE id <= (SELECT id FROM mail_log ORDER BY id DESC LIMIT 1 OFFSET ${LOG_KEEP})`);
    } catch (err) {
      logger.error(`Journal des e-mails : ${err.message}`);
    }
  }

  async function send({ to, subject, text, html, attachments }, meta = {}) {
    if (!transporter) return { skipped: true };
    const { senderName } = await getSetting(db, 'mail');
    const name = (senderName || 'Xchange').replace(/["<>]/g, '');
    const message = { from: `"${name}" <${smtp.from}>`, to, subject, text, html, ...(attachments?.length ? { attachments } : {}) };
    try {
      const info = await transporter.sendMail(message);
      sent.push(message);
      const state = await getSetting(db, 'mail_state');
      await setSetting(db, 'mail_state', { ...state, lastSentAt: new Date().toISOString() });
      await log(meta, message, 'sent');
      // Journal système (base seulement) : le compte destinataire est le « compte concerné ».
      if (journal) await journal('info', `E-mail envoyé : ${journalText(meta)}`, { subjectId: meta.userId || null });
      return info;
    } catch (err) {
      // Pas d'adresse dans le journal du serveur (données personnelles) : le détail est dans le journal des envois.
      logger.error(`Envoi d'e-mail impossible : ${journalText(meta)} (compte n°${meta.userId ?? '?'}) : ${err.message}`, { subjectId: meta.userId || null });
      const state = await getSetting(db, 'mail_state');
      const reason = explain(err);
      await setSetting(db, 'mail_state', { ...state, lastErrorAt: new Date().toISOString(), lastError: reason });
      await log(meta, message, 'error', reason);
      throw err;
    }
  }

  return { configured, send, sent, from: smtp?.from || null, host: smtp?.host || null };
}

function explain(err) {
  const msg = String(err.message || err);
  if (err.code === 'EAUTH' || /auth/i.test(msg)) {
    return "Identifiants refusés par le serveur d'envoi : vérifiez SMTP_USER et SMTP_PASSWORD (chez Orange, un mot de passe dédié aux logiciels tiers peut être exigé).";
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(err.code)) {
    return `Serveur d'envoi injoignable (${err.code}) : vérifiez SMTP_HOST, SMTP_PORT et la connexion internet du PC.`;
  }
  return msg.slice(0, 300);
}

module.exports = { createMailer, explainMailError: explain, EVENT_LABELS, journalText };

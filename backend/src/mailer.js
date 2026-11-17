/**
 * Envoi des e-mails (SMTP, par exemple smtp.orange.fr:465). Les erreurs n'interrompent
 * jamais l'action de l'utilisateur : elles sont journalisées et visibles dans l'Administration.
 */
const nodemailer = require('nodemailer');
const { getSetting, setSetting } = require('./settings');

function createMailer({ db, config, logger = console, transport } = {}) {
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

  async function send({ to, subject, text, html }) {
    if (!transporter) return { skipped: true };
    const message = { from: `Xchange <${smtp.from}>`, to, subject, text, html };
    try {
      const info = await transporter.sendMail(message);
      sent.push(message);
      const state = await getSetting(db, 'mail_state');
      await setSetting(db, 'mail_state', { ...state, lastSentAt: new Date().toISOString() });
      return info;
    } catch (err) {
      logger.error(`Envoi d'e-mail impossible (${to}) : ${err.message}`);
      const state = await getSetting(db, 'mail_state');
      await setSetting(db, 'mail_state', { ...state, lastErrorAt: new Date().toISOString(), lastError: explain(err) });
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

module.exports = { createMailer, explainMailError: explain };

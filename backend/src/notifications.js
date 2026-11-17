/**
 * Notifications par e-mail : qui prévenir, et quoi lui écrire.
 * Les e-mails partent en arrière-plan ; une demande confidentielle n'en dévoile jamais le contenu.
 */
const { displayName } = require('./utils');
const { getSetting } = require('./settings');

const ticketNumber = (id) => `#${String(id).padStart(4, '0')}`;
const STATUS = { open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu', closed: 'Fermé' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function createNotifier({ db, config, mailer, logger = console }) {
  const pending = new Set();

  async function baseUrl() {
    const mail = await getSetting(db, 'mail');
    return (mail.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  }

  async function enabled() {
    return mailer.configured && (await getSetting(db, 'mail')).enabled;
  }

  /** Comptes à prévenir : adresse renseignée, notifications acceptées, jamais l'auteur de l'action. */
  async function recipients(ids, actorId) {
    const unique = [...new Set(ids.filter(Boolean))].filter((id) => id !== actorId);
    if (!unique.length) return [];
    return db.all(
      `SELECT id, username, firstname, lastname, email FROM users
       WHERE id IN (${unique.map(() => '?').join(',')}) AND notify_email = 1 AND email IS NOT NULL AND email <> ''`,
      unique
    );
  }

  async function compose({ to, subject, lines, link, linkLabel = 'Ouvrir dans Xchange' }) {
    const url = await baseUrl();
    const href = url && link ? `${url}${link}` : null;
    const hello = `Bonjour ${to.firstname || to.username},`;
    const footer = 'Vous recevez cet e-mail car vous utilisez Xchange. Pour ne plus en recevoir : « Mon compte », Notifications.';
    const text = [hello, '', ...lines, '', href ? `${linkLabel} : ${href}` : 'Ouvrez Xchange pour en savoir plus.', '', '--', footer].join('\n');
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1b2430;line-height:1.5;max-width:560px">
<p>${escapeHtml(hello)}</p>
${lines.map((l) => `<p style="white-space:pre-line">${escapeHtml(l)}</p>`).join('\n')}
${href ? `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#2f4bd8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">${escapeHtml(linkLabel)}</a></p>` : ''}
<p style="color:#626e7d;font-size:12px;border-top:1px solid #dde2e8;padding-top:10px">${escapeHtml(footer)}</p>
</div>`;
    return { to: to.email, subject: `[Xchange] ${subject}`, text, html };
  }

  function run(task) {
    const p = (async () => {
      try {
        if (!(await enabled())) return;
        await task();
      } catch (err) {
        logger.error(`Notification non envoyée : ${err.message}`);
      }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  }

  async function sendAll(messages) {
    for (const m of messages) {
      try {
        await mailer.send(m);
      } catch {
        /* erreur déjà journalisée par le mailer */
      }
    }
  }

  async function loadTicket(id) {
    return db.get(
      `SELECT t.*, g.name AS group_name FROM tickets t LEFT JOIN user_groups g ON g.id = t.assigned_group WHERE t.id = ?`,
      [id]
    );
  }

  const groupMembers = async (groupId) =>
    groupId ? (await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId])).map((r) => r.user_id) : [];

  const actorName = async (id) => {
    const row = id && (await db.get('SELECT username, firstname, lastname FROM users WHERE id = ?', [id]));
    return row ? displayName(row) : 'Quelqu’un';
  };

  /** Titre affichable : jamais celui d'une demande confidentielle. */
  const label = (t) => (t.confidential ? `${ticketNumber(t.id)} (demande confidentielle)` : `${ticketNumber(t.id)} ${t.title}`);

  return {
    /** Attend la fin des envois en cours (tests, arrêt propre). */
    idle: () => Promise.all([...pending]),

    ticketCreated(ticketId, actorId) {
      return run(async () => {
        const t = await loadTicket(ticketId);
        if (!t?.assigned_group) return;
        const who = await actorName(actorId);
        const list = await recipients(await groupMembers(t.assigned_group), actorId);
        await sendAll(
          await Promise.all(
            list.map((to) =>
              compose({
                to,
                subject: `Nouvelle demande pour ${t.group_name} : ${label(t)}`,
                lines: [`${who} a fait une demande que votre groupe « ${t.group_name} » peut traiter :`, t.confidential ? '(contenu confidentiel)' : t.title],
                link: `/tickets/${t.id}`,
                linkLabel: 'Voir la demande',
              })
            )
          )
        );
      });
    },

    commentAdded(ticketId, actorId, body) {
      return run(async () => {
        const t = await loadTicket(ticketId);
        if (!t) return;
        const who = await actorName(actorId);
        const ids = [t.created_by, t.assigned_to, ...(t.assigned_to ? [] : await groupMembers(t.assigned_group))];
        const list = await recipients(ids, actorId);
        const excerpt = body.length > 600 ? `${body.slice(0, 600)}…` : body;
        await sendAll(
          await Promise.all(
            list.map((to) =>
              compose({
                to,
                subject: `Nouveau message sur ${label(t)}`,
                lines: t.confidential ? [`${who} a écrit un message sur votre demande confidentielle ${ticketNumber(t.id)}.`] : [`${who} a écrit sur « ${t.title} » :`, excerpt],
                link: `/tickets/${t.id}`,
                linkLabel: 'Répondre',
              })
            )
          )
        );
      });
    },

    statusChanged(ticketId, actorId, status) {
      return run(async () => {
        const t = await loadTicket(ticketId);
        if (!t) return;
        const who = await actorName(actorId);
        const list = await recipients([t.created_by], actorId);
        const extra = status === 'resolved' ? 'Si le problème n’est pas réglé, vous pouvez rouvrir la demande.' : null;
        await sendAll(
          await Promise.all(
            list.map((to) =>
              compose({
                to,
                subject: `${label(t)} : ${STATUS[status] || status}`,
                lines: [`${who} a passé votre demande ${t.confidential ? ticketNumber(t.id) : `« ${t.title} »`} à « ${STATUS[status] || status} ».`, ...(extra ? [extra] : [])],
                link: `/tickets/${t.id}`,
              })
            )
          )
        );
      });
    },

    assigned(ticketId, actorId) {
      return run(async () => {
        const t = await loadTicket(ticketId);
        if (!t?.assigned_to) return;
        const who = await actorName(actorId);
        const list = await recipients([t.assigned_to], actorId);
        await sendAll(
          await Promise.all(
            list.map((to) =>
              compose({
                to,
                subject: `Demande assignée : ${label(t)}`,
                lines: [`${who} vous a confié la demande ${t.confidential ? ticketNumber(t.id) : `« ${t.title} »`}.`],
                link: `/tickets/${t.id}`,
                linkLabel: 'Voir la demande',
              })
            )
          )
        );
      });
    },

    /** Transfert à un groupe : ses membres sont prévenus comme pour une nouvelle demande. */
    groupChanged(ticketId, actorId) {
      return this.ticketCreated(ticketId, actorId);
    },

    joinRequested(requestId) {
      return run(async () => {
        const r = await db.get(
          `SELECT r.*, g.name AS group_name, u.username, u.firstname, u.lastname FROM group_requests r
           JOIN user_groups g ON g.id = r.group_id JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
          [requestId]
        );
        if (!r) return;
        const admins = (await db.all("SELECT id FROM users WHERE role = 'admin'")).map((a) => a.id);
        const list = await recipients(admins, r.user_id);
        const who = displayName(r);
        await sendAll(
          await Promise.all(
            list.map((to) =>
              compose({
                to,
                subject: `${who} souhaite rejoindre ${r.group_name}`,
                lines: [`${who} demande à rejoindre le groupe « ${r.group_name} ».`, ...(r.message ? [`Son message : « ${r.message} »`] : [])],
                link: '/admin?tab=groups',
                linkLabel: 'Valider ou refuser',
              })
            )
          )
        );
      });
    },

    joinDecided(requestId) {
      return run(async () => {
        const r = await db.get(
          'SELECT r.*, g.name AS group_name FROM group_requests r JOIN user_groups g ON g.id = r.group_id WHERE r.id = ?',
          [requestId]
        );
        if (!r) return;
        const list = await recipients([r.user_id], r.decided_by);
        const ok = r.status === 'approved';
        await sendAll(
          await Promise.all(
            list.map((to) =>
              compose({
                to,
                subject: ok ? `Bienvenue dans le groupe ${r.group_name}` : `Demande pour ${r.group_name} refusée`,
                lines: ok
                  ? [`Votre demande pour rejoindre « ${r.group_name} » est acceptée : vous recevrez désormais les demandes de ce groupe.`]
                  : [`Votre demande pour rejoindre « ${r.group_name} » n’a pas été retenue.`, ...(r.reason ? [`Motif : ${r.reason}`] : [])],
                link: ok ? '/tickets?group=mine' : '/profile',
              })
            )
          )
        );
      });
    },

    /** E-mail de test envoyé depuis l'Administration. */
    async test(user) {
      if (!mailer.configured) throw new Error("L'envoi d'e-mails n'est pas configuré (SMTP_HOST absent de xchange.env).");
      if (!user.email) throw new Error('Renseignez d’abord votre adresse e-mail dans « Mon compte ».');
      await mailer.send(
        await compose({
          to: user,
          subject: 'E-mail de test',
          lines: ['Les notifications par e-mail de Xchange fonctionnent.'],
          link: '/',
        })
      );
    },
  };
}

module.exports = { createNotifier, ticketNumber };

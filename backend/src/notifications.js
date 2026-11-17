/**
 * Notifications par e-mail : qui prévenir, et quoi lui écrire.
 *
 * Trois niveaux de réglage :
 * - l'administrateur active ou coupe chaque événement (Administration > Paramètres > Notifications) ;
 * - chaque personne choisit ce qu'elle reçoit (« Mon compte ») ;
 * - la personne qui a fait l'action n'est jamais prévenue.
 * Les e-mails partent en arrière-plan ; une demande confidentielle n'en dévoile jamais le contenu.
 */
const { displayName, parseNotifyPrefs: parsePrefs } = require('./utils');
const { getMailSettings } = require('./settings');

const ticketNumber = (id) => `#${String(id).padStart(4, '0')}`;
const STATUS = { open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu', closed: 'Fermé' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Titre affichable : jamais celui d'une demande confidentielle, ni aucun si le contenu est masqué. */
const label = (t, mail) => (t.confidential || !mail.includeContent ? ticketNumber(t.id) + (t.confidential ? ' (demande confidentielle)' : '') : `${ticketNumber(t.id)} ${t.title}`);
const named = (t, mail) => (t.confidential || !mail.includeContent ? ticketNumber(t.id) : `« ${t.title} »`);

/**
 * Contenu de chaque e-mail, à partir des données de l'événement.
 * Utilisé pour les vrais envois et pour l'aperçu de l'Administration.
 */
const BUILDERS = {
  ticket_created: ({ t, who }, mail) => ({
    subject: `Nouvelle demande pour ${t.group_name} : ${label(t, mail)}`,
    lines: [`${who} a fait une demande que votre groupe « ${t.group_name} » peut traiter : ${named(t, mail)}.`],
    link: `/tickets/${t.id}`,
    linkLabel: 'Voir la demande',
  }),
  ticket_transferred: ({ t, who }, mail) => ({
    subject: `Demande transférée à ${t.group_name} : ${label(t, mail)}`,
    lines: [`${who} a transféré la demande ${named(t, mail)} à votre groupe « ${t.group_name} ».`],
    link: `/tickets/${t.id}`,
    linkLabel: 'Voir la demande',
  }),
  comment: ({ t, who, body }, mail) => {
    const showBody = !t.confidential && mail.includeContent && body;
    const excerpt = showBody && body.length > 600 ? `${body.slice(0, 600)}…` : body;
    return {
      subject: `Nouveau message sur ${label(t, mail)}`,
      lines: showBody ? [`${who} a écrit sur ${named(t, mail)} :`, excerpt] : [`${who} a écrit un message sur la demande ${named(t, mail)}.`],
      link: `/tickets/${t.id}`,
      linkLabel: 'Répondre',
    };
  },
  status_changed: ({ t, who, status }, mail) => ({
    subject: `${label(t, mail)} : ${STATUS[status] || status}`,
    lines: [
      `${who} a passé votre demande ${named(t, mail)} à « ${STATUS[status] || status} ».`,
      ...(status === 'resolved' ? ['Si le problème n’est pas réglé, vous pouvez rouvrir la demande.'] : []),
    ],
    link: `/tickets/${t.id}`,
  }),
  assigned: ({ t, who }, mail) => ({
    subject: `Demande confiée : ${label(t, mail)}`,
    lines: [`${who} vous a confié la demande ${named(t, mail)}.`],
    link: `/tickets/${t.id}`,
    linkLabel: 'Voir la demande',
  }),
  join_requested: ({ who, group, message }) => ({
    subject: `${who} souhaite rejoindre ${group}`,
    lines: [`${who} demande à rejoindre le groupe « ${group} ».`, ...(message ? [`Son message : « ${message} »`] : [])],
    link: '/admin?tab=groups',
    linkLabel: 'Valider ou refuser',
  }),
  join_decided: ({ group, approved, reason }) => ({
    subject: approved ? `Bienvenue dans le groupe ${group}` : `Demande pour ${group} refusée`,
    lines: approved
      ? [`Votre demande pour rejoindre « ${group} » est acceptée : vous recevrez désormais les demandes de ce groupe.`]
      : [`Votre demande pour rejoindre « ${group} » n’a pas été retenue.`, ...(reason ? [`Motif : ${reason}`] : [])],
    link: approved ? '/tickets?group=mine' : '/profile',
  }),
  test: () => ({
    subject: 'E-mail de test',
    lines: ['Les notifications par e-mail de Xchange fonctionnent.'],
    link: '/',
  }),
};

/** Exemples affichés dans l'aperçu de l'Administration. */
const SAMPLE = {
  t: { id: 42, title: 'L’imprimante ne répond plus', group_name: 'Informaticiens', confidential: 0 },
  who: 'Francine Martin',
  body: 'Bonjour, j’ai redémarré l’imprimante mais rien ne sort. Pouvez-vous passer jeudi ?',
  status: 'resolved',
  group: 'Informaticiens',
  message: 'Je m’y connais un peu en réseau, je peux aider.',
  approved: true,
};

function createNotifier({ db, mailer, logger = console }) {
  const pending = new Set();

  async function baseUrl(mail) {
    return (mail.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  }

  /**
   * Comptes à prévenir. `entries` : [{ id, pref }] ; une personne présente à plusieurs titres
   * (demandeur et responsable) est prévenue une fois, si l'un des choix est accepté.
   */
  async function recipients(entries, actorId) {
    const byId = new Map();
    for (const e of entries) {
      if (!e.id || e.id === actorId) continue;
      byId.set(e.id, [...(byId.get(e.id) || []), e.pref]);
    }
    if (!byId.size) return [];
    const ids = [...byId.keys()];
    const rows = await db.all(
      `SELECT id, username, firstname, lastname, email, notify_prefs FROM users
       WHERE id IN (${ids.map(() => '?').join(',')}) AND notify_email = 1 AND email IS NOT NULL AND email <> ''`,
      ids
    );
    return rows.filter((u) => {
      const prefs = parsePrefs(u.notify_prefs);
      return byId.get(u.id).some((p) => prefs[p]);
    });
  }

  function compose(mail, to, { subject, lines, link, linkLabel = 'Ouvrir dans Xchange' }, url) {
    const href = url && link ? `${url}${link}` : null;
    const hello = `Bonjour ${to.firstname || to.username},`;
    const footer = [mail.footer, 'Pour choisir les e-mails que vous recevez : « Mon compte », Notifications.'].filter(Boolean).join('\n');
    const text = [hello, '', ...lines, '', href ? `${linkLabel} : ${href}` : 'Ouvrez Xchange pour en savoir plus.', '', '--', footer].join('\n');
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1b2430;line-height:1.5;max-width:560px">
<p>${escapeHtml(hello)}</p>
${lines.map((l) => `<p style="white-space:pre-line">${escapeHtml(l)}</p>`).join('\n')}
${href ? `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#2f4bd8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">${escapeHtml(linkLabel)}</a></p>` : ''}
<p style="color:#626e7d;font-size:12px;border-top:1px solid #dde2e8;padding-top:10px;white-space:pre-line">${escapeHtml(footer)}</p>
</div>`;
    const prefix = mail.subjectPrefix ? `${mail.subjectPrefix} ` : '';
    return { to: to.email, subject: `${prefix}${subject}`, text, html };
  }

  /** Envoie l'événement aux destinataires, en arrière-plan ; ne lève jamais d'erreur. */
  function run(event, task) {
    const p = (async () => {
      try {
        if (!mailer.configured) return;
        const mail = await getMailSettings(db);
        if (!mail.enabled || !mail.events[event]) return;
        const result = await task(mail);
        if (!result) return;
        const { list, data } = result;
        const url = await baseUrl(mail);
        for (const to of list) {
          try {
            await mailer.send(compose(mail, to, BUILDERS[event](data, mail), url), { event, userId: to.id });
          } catch {
            /* erreur déjà journalisée par le mailer */
          }
        }
      } catch (err) {
        logger.error(`Notification non envoyée : ${err.message}`);
      }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
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

  const groupEvent = (event) => (ticketId, actorId) =>
    run(event, async () => {
      const t = await loadTicket(ticketId);
      if (!t?.assigned_group) return null;
      const members = await groupMembers(t.assigned_group);
      return { list: await recipients(members.map((id) => ({ id, pref: 'group_new' })), actorId), data: { t, who: await actorName(actorId) } };
    });

  return {
    /** Attend la fin des envois en cours (tests, arrêt propre). */
    idle: () => Promise.all([...pending]),

    ticketCreated: groupEvent('ticket_created'),
    groupChanged: groupEvent('ticket_transferred'),

    commentAdded(ticketId, actorId, body) {
      return run('comment', async (mail) => {
        const t = await loadTicket(ticketId);
        if (!t) return null;
        const entries = [{ id: t.created_by, pref: 'mine' }];
        if (t.assigned_to) entries.push({ id: t.assigned_to, pref: 'handled' });
        else if (mail.commentToGroup) for (const id of await groupMembers(t.assigned_group)) entries.push({ id, pref: 'handled' });
        return { list: await recipients(entries, actorId), data: { t, who: await actorName(actorId), body } };
      });
    },

    statusChanged(ticketId, actorId, status) {
      return run('status_changed', async (mail) => {
        if (!mail.statuses.includes(status)) return null;
        const t = await loadTicket(ticketId);
        if (!t) return null;
        return { list: await recipients([{ id: t.created_by, pref: 'mine' }], actorId), data: { t, who: await actorName(actorId), status } };
      });
    },

    assigned(ticketId, actorId) {
      return run('assigned', async () => {
        const t = await loadTicket(ticketId);
        if (!t?.assigned_to) return null;
        return { list: await recipients([{ id: t.assigned_to, pref: 'assigned' }], actorId), data: { t, who: await actorName(actorId) } };
      });
    },

    joinRequested(requestId) {
      return run('join_requested', async () => {
        const r = await db.get(
          `SELECT r.*, g.name AS group_name, u.username, u.firstname, u.lastname FROM group_requests r
           JOIN user_groups g ON g.id = r.group_id JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
          [requestId]
        );
        if (!r) return null;
        const admins = await db.all("SELECT id FROM users WHERE role = 'admin'");
        return {
          list: await recipients(admins.map((a) => ({ id: a.id, pref: 'admin' })), r.user_id),
          data: { who: displayName(r), group: r.group_name, message: r.message },
        };
      });
    },

    joinDecided(requestId) {
      return run('join_decided', async () => {
        const r = await db.get(
          'SELECT r.*, g.name AS group_name FROM group_requests r JOIN user_groups g ON g.id = r.group_id WHERE r.id = ?',
          [requestId]
        );
        if (!r) return null;
        return {
          list: await recipients([{ id: r.user_id, pref: 'mine' }], r.decided_by),
          data: { group: r.group_name, approved: r.status === 'approved', reason: r.reason },
        };
      });
    },

    /** Aperçu d'un e-mail, avec des données d'exemple et les réglages enregistrés. */
    async preview(event, user) {
      if (!BUILDERS[event]) return null;
      const mail = await getMailSettings(db);
      const msg = compose(mail, user, BUILDERS[event](SAMPLE, mail), await baseUrl(mail));
      return { subject: msg.subject, html: msg.html, text: msg.text };
    },

    /** E-mail de test envoyé depuis l'Administration, à l'adresse de l'administrateur ou à une autre. */
    async test(user, address) {
      if (!mailer.configured) throw new Error("L'envoi d'e-mails n'est pas configuré (SMTP_HOST absent de xchange.env).");
      const email = address || user.email;
      if (!email) throw new Error('Renseignez d’abord votre adresse e-mail dans « Mon compte », ou saisissez une adresse.');
      const mail = await getMailSettings(db);
      await mailer.send(compose(mail, { ...user, email }, BUILDERS.test(), await baseUrl(mail)), { event: 'test', userId: user.id });
      return email;
    },
  };
}

module.exports = { createNotifier, ticketNumber };

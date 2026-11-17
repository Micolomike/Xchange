/**
 * Journal système : ce que fait Xchange (démarrage, tâches automatiques, erreurs) et ce que font les
 * administrateurs. Chaque message part aussi dans la console (et donc dans C:\Xchange\journaux sur le PC).
 * Les messages ne contiennent pas d'adresse e-mail ni de contenu de demande : des numéros de compte
 * ou de demande suffisent pour enquêter.
 */
const LEVELS = ['info', 'warn', 'error'];
const SOURCES = {
  serveur: 'Serveur',
  administration: 'Administration',
  utilisateurs: 'Utilisateurs',
  sauvegarde: 'Sauvegardes',
  'e-mail': 'E-mails',
  rgpd: 'RGPD',
  sla: 'Délais (SLA)',
  rapports: 'Rapports programmés',
  discussions: 'Discussions',
};
const MAX_MESSAGE = 1000;
const MAX_DETAILS = 8000;

async function insert(db, level, source, message, { actorId = null, subjectId = null, details = null } = {}) {
  await db.run('INSERT INTO system_logs (level, source, message, details, actor_id, subject_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    level,
    source,
    String(message).slice(0, MAX_MESSAGE),
    details ? String(details).slice(0, MAX_DETAILS) : null,
    actorId,
    subjectId,
    new Date().toISOString(),
  ]);
}

/**
 * Activité d'un compte (connexions, changements de profil, demandes...) : journal système seulement,
 * pas dans le fichier texte. `subjectId` : le compte concerné ; `actorId` : qui a agi (par défaut, lui).
 * Jamais d'adresse e-mail, d'adresse IP, de mot de passe ni de contenu de message.
 */
async function logUserEvent(db, message, { subjectId = null, actorId = subjectId, level = 'info', details = null } = {}) {
  try {
    await insert(db, level, 'utilisateurs', message, { subjectId, actorId, details });
  } catch {
    // Jamais bloquant.
  }
}

function toText(value) {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Crée le journal. `console` : sortie console (horodatée en production). `for(source)` donne un logger
 * { info, warn, error } compatible avec ceux déjà passés aux modules.
 */
function createSystemLog({ db, console: out = console, stamp = false }) {
  const print = (fn, msg) => fn(stamp ? `${new Date().toISOString()} ${msg}` : msg);

  async function write(level, source, message, opts = {}) {
    try {
      await insert(db, level, source, message, opts);
    } catch (err) {
      // Le journal ne doit jamais faire tomber l'application (base fermée, disque plein...).
      out.error?.(`Journal système indisponible : ${err.message}`);
    }
  }

  function forSource(source) {
    const log = (level, fn) => (value, extra = {}) => {
      const message = toText(value);
      print(fn, source === 'serveur' ? message : `[${SOURCES[source] || source}] ${message}`);
      const details = extra.details ?? (value instanceof Error && level === 'error' ? value.stack : null);
      return write(level, source, message, { ...extra, details });
    };
    return {
      info: log('info', (m) => (out.log || out.info).call(out, m)),
      warn: log('warn', (m) => (out.warn || out.error).call(out, m)),
      error: log('error', (m) => out.error.call(out, m)),
    };
  }

  return { write, for: forSource };
}

/**
 * Libellé lisible d'une action d'administration (requête réussie qui modifie quelque chose).
 * Les numéros suffisent : pas de nom ni d'adresse dans le journal.
 */
const ADMIN_ACTIONS = [
  [/^POST \/api\/users$/, () => 'Compte créé'],
  [/^PATCH \/api\/users\/(\d+)$/, (m) => `Compte n°${m[1]} modifié (rôle, droits ou état)`],
  [/^DELETE \/api\/users\/(\d+)$/, (m) => `Compte n°${m[1]} supprimé`],
  [/^POST \/api\/users\/(\d+)\/reset-password$/, (m) => `Mot de passe du compte n°${m[1]} réinitialisé`],
  [/^POST \/api\/users\/(\d+)\/reset-mfa$/, (m) => `Double authentification du compte n°${m[1]} réinitialisée`],
  [/^POST \/api\/users\/(\d+)\/mfa-exempt$/, (m) => `Exemption de double authentification changée pour le compte n°${m[1]}`],
  [/^POST \/api\/users\/(\d+)\/impersonate$/, (m) => `Prise de contrôle du compte n°${m[1]}`],
  [/^POST \/api\/groups$/, () => 'Groupe créé'],
  [/^PATCH \/api\/groups\/(\d+)$/, (m) => `Groupe n°${m[1]} modifié`],
  [/^DELETE \/api\/groups\/(\d+)$/, (m) => `Groupe n°${m[1]} supprimé`],
  [/^POST \/api\/groups\/requests\/(\d+)\/(approve|reject)$/, (m) => `Demande d'adhésion n°${m[1]} ${m[2] === 'approve' ? 'acceptée' : 'refusée'}`],
  [/^POST \/api\/admin\/catalog$/, () => 'Catalogue : formulaire créé'],
  [/^POST \/api\/admin\/catalog\/(\d+)\/duplicate$/, (m) => `Catalogue : formulaire n°${m[1]} dupliqué`],
  [/^PATCH \/api\/admin\/catalog\/(\d+)$/, (m) => `Catalogue : formulaire n°${m[1]} modifié`],
  [/^DELETE \/api\/admin\/catalog\/(\d+)$/, (m) => `Catalogue : formulaire n°${m[1]} supprimé`],
  [/^PUT \/api\/admin\/settings\/lists$/, () => 'Paramètres modifiés : catégories et priorités'],
  [/^PUT \/api\/admin\/settings\/access$/, () => 'Paramètres modifiés : droits et visibilité'],
  [/^PUT \/api\/admin\/settings\/mail$/, () => 'Paramètres modifiés : notifications par e-mail'],
  [/^POST \/api\/admin\/settings\/mail\/test$/, () => 'E-mail de test envoyé'],
  [/^PUT \/api\/admin\/settings\/appearance$/, () => 'Paramètres modifiés : apparence'],
  [/^(POST|DELETE) \/api\/admin\/settings\/logo$/, (m) => (m[1] === 'POST' ? 'Logo remplacé' : 'Logo retiré')],
  [/^PUT \/api\/admin\/sla$/, () => 'Réglages des délais (SLA) modifiés'],
  [/^POST \/api\/admin\/sla\/recalculate$/, () => 'Délais (SLA) recalculés pour les demandes en cours'],
  [/^PUT \/api\/admin\/rgpd\/settings$/, () => 'Réglages RGPD modifiés'],
  [/^PUT \/api\/admin\/rgpd\/legal$/, () => 'Textes juridiques modifiés'],
  [/^POST \/api\/admin\/rgpd\/users\/(\d+)\/anonymize$/, (m) => `Compte n°${m[1]} anonymisé`],
  [/^GET \/api\/admin\/rgpd\/users\/(\d+)\/export$/, (m) => `Données du compte n°${m[1]} exportées`],
  [/^POST \/api\/admin\/rgpd\/requests\/(\d+)\/close$/, (m) => `Demande RGPD n°${m[1]} clôturée`],
  [/^POST \/api\/admin\/rgpd\/purge$/, () => 'Purge RGPD lancée à la main'],
  [/^POST \/api\/admin\/trash\/(\d+)\/restore$/, (m) => `Demande n°${m[1]} restaurée depuis la corbeille`],
  [/^DELETE \/api\/admin\/trash\/(\d+)$/, (m) => `Demande n°${m[1]} supprimée définitivement`],
  [/^DELETE \/api\/admin\/trash$/, () => 'Corbeille vidée'],
  [/^GET \/api\/admin\/backup\/download$/, () => 'Sauvegarde téléchargée'],
  [/^POST \/api\/admin\/backup\/write$/, () => 'Sauvegarde écrite dans un dossier'],
  [/^POST \/api\/admin\/backup\/run$/, () => 'Sauvegarde lancée à la main'],
  [/^PUT \/api\/admin\/backup\/schedule$/, () => 'Réglages des sauvegardes modifiés'],
  [/^POST \/api\/admin\/chat\/reports\/(\d+)\/(remove|dismiss)$/, (m) => `Signalement n°${m[1]} : ${m[2] === 'remove' ? 'message retiré' : 'classé sans suite'}`],
  [/^POST \/api\/admin\/analytics\/schedules\/(\d+)\/disable$/, (m) => `Envoi programmé n°${m[1]} arrêté`],
  [/^DELETE \/api\/admin\/assistant\/misses$/, () => "Besoins non trouvés de l'assistant effacés"],
];

function adminActionLabel(method, path) {
  const key = `${method} ${path.replace(/\/+$/, '')}`;
  for (const [re, label] of ADMIN_ACTIONS) {
    const m = re.exec(key);
    if (m) {
      // Compte concerné, pour retrouver l'action depuis la fiche de la personne.
      const subject = /^\/api\/(?:users|admin\/rgpd\/users)\/(\d+)/.exec(path);
      return { label: label(m), subjectId: subject ? Number(subject[1]) : null };
    }
  }
  return null;
}

module.exports = { LEVELS, SOURCES, createSystemLog, adminActionLabel, logUserEvent };

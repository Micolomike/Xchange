/**
 * Assistant guidé, sans IA : questions fréquentes et recherche dans le catalogue par mots-clés.
 * Tout reste sur le serveur d'Xchange.
 */

/** Questions fréquentes sur l'utilisation d'Xchange. `keys` : mots qui déclenchent la réponse. */
const FAQ = [
  {
    q: 'Comment faire une demande ?',
    phrases: ['faire une demande', 'nouvelle demande', 'nouveau ticket', 'demander de l aide'],
    a: 'Ouvrez le Catalogue et choisissez le formulaire qui correspond à votre besoin : il pose les bonnes questions et envoie la demande au bon groupe. Si rien ne correspond, utilisez « Demande libre » (bouton « Nouveau ticket »).',
    keys: 'demande faire creer nouvelle ticket aide besoin poser question demander',
    link: '/catalogue',
  },
  {
    q: 'Où en est ma demande ?',
    phrases: ['ou en est', 'ou en sont', 'pas de reponse', 'toujours rien', 'statut de ma demande', 'suivre ma demande'],
    a: 'La page Tickets liste vos demandes avec leur statut : ouvert, en cours, résolu ou fermé. Ouvrez une demande pour voir son historique et les messages. Vous recevez aussi un e-mail à chaque réponse si vos notifications sont activées.',
    keys: 'suivi suivre statut avancement ou en est reponse attente delai mes demandes',
    link: '/tickets',
  },
  {
    q: 'Comment répondre ou ajouter une précision ?',
    phrases: ['ajouter une precision', 'repondre a', 'ajouter un fichier', 'ajouter une photo', 'piece jointe'],
    a: 'Ouvrez la demande depuis la page Tickets et écrivez dans « Ajouter un commentaire », en bas de l’activité. Vous pouvez aussi joindre des fichiers (photo d’écran, document).',
    keys: 'repondre commentaire message precision ajouter ecrire piece jointe photo fichier capture',
    link: '/tickets',
  },
  {
    q: 'Comment garder une demande confidentielle ?',
    phrases: ['demande confidentielle', 'que personne ne voie', 'rester discret'],
    a: 'Cochez « Demande confidentielle » en créant la demande, ou plus tard sur la demande. Elle n’est alors visible que par vous, la personne qui la traite et les membres du groupe concerné.',
    keys: 'confidentiel confidentielle prive privee secret discret cacher personne voir',
  },
  {
    q: 'Comment aider les autres ?',
    phrases: ['aider les autres', 'rejoindre un groupe', 'devenir benevole', 'je veux aider', 'je peux aider'],
    a: 'Dans « Mon compte », rubrique Groupes, demandez à rejoindre un groupe d’entraide (Informaticiens, Bricoleurs, Fiscalistes…). Un administrateur valide, puis vous recevez les demandes de ce groupe.',
    keys: 'aider aide benevole groupe rejoindre competence proposer participer',
    link: '/profile',
  },
  {
    q: 'Comment parler directement avec quelqu’un ?',
    phrases: ['parler avec', 'ecrire a', 'message prive', 'discuter avec', 'contacter quelqu un', 'chat', 'discussion', 'discussions', 'messagerie', 'salon general'],
    a: 'La page Discussions permet d’écrire en direct à une personne (message privé), à plusieurs (conversation de groupe), aux membres d’un de vos groupes (salon du groupe) ou à tout le monde (salon général). Bouton « Nouvelle conversation » en haut de la page.',
    keys: 'discuter discussion chat parler message prive direct contacter salon conversation',
    link: '/discussions',
  },
  {
    q: 'Comment signaler un message déplacé ?',
    phrases: ['signaler un message', 'message insultant', 'message deplace', 'harcelement', 'insulte'],
    a: 'Dans une discussion, survolez le message et cliquez sur le petit drapeau. Les administrateurs voient ce message seul, avec votre motif ; l’auteur ne sait pas qui l’a signalé.',
    keys: 'signaler signalement insulte harcelement moderation drapeau deplace abus',
    link: '/discussions',
  },
  {
    q: 'Combien de temps mes messages de discussion sont-ils gardés ?',
    phrases: ['effacer mes messages', 'supprimer mes messages', 'conservation des messages'],
    a: 'Vous choisissez dans « Mon compte », rubrique Discussions : tant que votre compte existe, 30 jours, 6 mois ou 1 an. Vous pouvez aussi effacer tous vos messages d’un coup, ou un seul message avec la corbeille à côté.',
    keys: 'conservation duree effacer supprimer messages discussion garder retention',
    link: '/profile',
  },
  {
    q: 'J’ai oublié mon mot de passe',
    phrases: ['mot de passe', 'me connecter', 'peux plus me connecter', 'pas me connecter'],
    a: 'Demandez à un administrateur de le réinitialiser : il vous donnera un mot de passe provisoire, à changer ensuite dans « Mon compte ».',
    keys: 'mot de passe oublie perdu connexion connecter identifiant',
  },
  {
    q: 'J’ai changé de téléphone (code de connexion)',
    phrases: ['code a 6 chiffres', 'double authentification', 'nouveau telephone', 'change de telephone', 'perdu mon telephone', 'code de secours'],
    a: 'Utilisez un de vos codes de secours pour vous connecter, ou demandez à un administrateur de réinitialiser votre double authentification : vous la configurerez à nouveau.',
    keys: 'telephone code authentification double perdu nouveau smartphone application authenticator',
  },
  {
    q: 'Comment ne plus recevoir d’e-mails ?',
    phrases: ['ne plus recevoir', 'trop de mails', 'trop d e mails', 'recevoir des mails'],
    a: 'Dans « Mon compte », rubrique Notifications par e-mail, choisissez ce que vous recevez ou coupez tout.',
    keys: 'mail email notification recevoir plus arreter desabonner trop',
    link: '/profile',
  },
  {
    q: 'Comment cacher mon nom ?',
    phrases: ['cacher mon nom', 'mon vrai nom', 'rester anonyme'],
    a: 'Dans « Mon compte », rubrique Informations, cochez « N’afficher que mon pseudonyme ». Les autres ne verront plus votre prénom ni votre nom.',
    keys: 'nom cacher pseudonyme anonyme prenom afficher identite',
    link: '/profile',
  },
  {
    q: 'Comment récupérer ou supprimer mes données ?',
    phrases: ['mes donnees', 'supprimer mon compte', 'effacer mon compte', 'droit a l oubli'],
    a: 'Dans « Mon compte », rubrique Mes données : téléchargez tout ce qu’Xchange garde sur vous, ou demandez l’anonymisation ou la suppression de votre compte.',
    keys: 'donnees rgpd supprimer compte effacer telecharger export anonymiser',
    link: '/profile',
  },
  {
    q: 'Passer en mode sombre',
    phrases: ['mode sombre', 'theme sombre', 'mode nuit', 'fond noir'],
    a: 'Le bouton en forme d’écran, de lune ou de soleil, en haut à droite, passe du mode clair au mode sombre puis automatique.',
    keys: 'sombre nuit clair theme couleur noir affichage',
  },
];

/** Mots vides, ignorés dans la recherche. */
const STOP = new Set(
  'a au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous c d j l m n s t y est suis ai as avez ont etre avoir fait faire veux voudrais besoin aide comment quoi quel quelle quels quelles bonjour merci svp plus tres bien tout tous toute toutes faut peut peux pouvez'.split(
    ' '
  )
);

/** Rapprochements courants entre les mots des gens et ceux du catalogue. */
const SYNONYMS = {
  ordi: 'ordinateur',
  pc: 'ordinateur',
  portable: 'ordinateur',
  wifi: 'internet',
  box: 'internet',
  reseau: 'internet',
  mobile: 'telephone',
  smartphone: 'telephone',
  tel: 'telephone',
  iphone: 'telephone',
  android: 'telephone',
  tablette: 'telephone',
  impot: 'impots',
  fiscal: 'impots',
  declaration: 'impots',
  revenus: 'impots',
  imprimante: 'imprimante',
  papiers: 'administratif',
  papier: 'administratif',
  demarche: 'administratif',
  demarches: 'administratif',
  caf: 'administratif',
  banque: 'budget',
  argent: 'budget',
  credit: 'budget',
  assurance: 'budget',
  voiture: 'voiture',
  auto: 'voiture',
  garage: 'voiture',
  panne: 'panne',
  cv: 'emploi',
  travail: 'emploi',
  job: 'emploi',
  boulot: 'emploi',
  entretien: 'emploi',
  appartement: 'logement',
  maison: 'logement',
  bricolage: 'logement',
  plomberie: 'logement',
  recette: 'cuisine',
  repas: 'cuisine',
  vacances: 'voyage',
  voyager: 'voyage',
  devoirs: 'etudes',
  ecole: 'etudes',
  avocat: 'juridique',
  litige: 'juridique',
  droit: 'juridique',
  medecin: 'sante',
  soins: 'sante',
};

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Mots utiles d'un texte, avec leurs rapprochements, sans pluriel simple. */
function tokens(text) {
  const out = new Set();
  for (const raw of normalize(text).split(' ')) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    const w = raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    out.add(w);
    if (SYNONYMS[raw]) out.add(SYNONYMS[raw]);
    if (SYNONYMS[w]) out.add(SYNONYMS[w]);
  }
  return out;
}

/** Score d'un texte : mots de la question retrouvés (début de mot accepté à partir de 4 lettres). */
function score(queryWords, text, weight) {
  const words = [...tokens(text)];
  let s = 0;
  for (const q of queryWords) {
    if (words.some((w) => w === q || (q.length >= 4 && (w.startsWith(q) || q.startsWith(w)) && w.length >= 4))) s += weight;
  }
  return s;
}

function searchFaq(query) {
  const q = tokens(query);
  const text = ` ${normalize(query)} `;
  const phrase = (f) => (f.phrases || []).reduce((n, p) => n + (text.includes(` ${p} `) ? 5 : 0), 0);
  if (!q.size && !text.trim()) return [];
  return FAQ.map((f) => ({ f, s: phrase(f) + score(q, f.q, 2) + score(q, f.keys, 1) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ f }) => ({ question: f.q, answer: f.a, link: f.link || null }));
}

function searchForms(query, items, categories = []) {
  const q = tokens(query);
  if (!q.size) return [];
  const label = (key) => categories.find((c) => c.key === key)?.label || '';
  return items
    .map((it) => {
      const fieldsText = (it.fields || []).map((f) => `${f.label} ${(f.options || []).join(' ')}`).join(' ');
      const s =
        score(q, it.name, 4) + score(q, it.section, 2) + score(q, label(it.category), 2) + score(q, it.description, 2) + score(q, fieldsText, 1);
      return { it, s };
    })
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    // Seulement les propositions proches de la meilleure.
    .filter((x, _i, all) => x.s * 2.5 >= all[0].s)
    .slice(0, 3)
    .map(({ it }) => ({ id: it.id, name: it.name, description: it.description, section: it.section }));
}

module.exports = { FAQ, searchFaq, searchForms, normalize, tokens };

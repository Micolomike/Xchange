/**
 * Contenu de départ : catégories, groupes d'entraide et formulaires du catalogue pour les
 * demandes courantes entre proches. Appliqué une seule fois par version de contenu, sans
 * jamais modifier ni supprimer ce qui existe déjà (même nom = déjà présent, laissé tel quel).
 */
const { nowIso } = require('./utils');
const { getSetting, setSetting } = require('./settings');

const CONTENT_VERSION = 4;

// Textes d'accueil adaptés à l'entraide ouverte à toutes les catégories (version 4).
const HOME_TITLE = "Besoin d'un coup de main ? Quelqu'un s'y connaît sûrement.";
const HOME_TEXT =
  "Ordinateur, papiers, impôts, logement, voiture, cuisine… Décrivez votre besoin avec vos mots : il arrive aux personnes qui s'y connaissent, et vous suivez où il en est, avec un e-mail à chaque réponse.\n\n" +
  "Vous avez des compétences à partager ? Rejoignez un groupe et aidez à votre tour. Une demande confidentielle n'est vue que par les personnes qui la traitent.";

const CATEGORIES = [
  ['informatique', 'Informatique et internet'],
  ['telephone', 'Téléphone et tablette'],
  ['administratif', 'Démarches administratives'],
  ['impots', 'Impôts et fiscalité'],
  ['argent', 'Budget, banque et assurances'],
  ['carriere', 'Carrière et emploi'],
  ['logement', 'Logement et bricolage'],
  ['vehicule', 'Voiture et mobilité'],
  ['sante', 'Santé et bien-être'],
  ['juridique', 'Droit et litiges'],
  ['cuisine', 'Cuisine et recettes'],
  ['evenements', 'Fêtes et événements'],
  ['voyages', 'Voyages et loisirs'],
  ['etudes', 'Études et devoirs'],
  ['achats', 'Achats et bons plans'],
];

const GROUPS = [
  ['Informaticiens', 'Ordinateurs, internet, téléphones et tablettes.'],
  ['Fiscalistes', 'Déclarations de revenus, avis d’imposition, taxes.'],
  ['As de la paperasse', 'Courriers, démarches en ligne, lettres et recours.'],
  ['Conseillers budget', 'Budget, banque, assurances, crédits et achats importants.'],
  ['Coachs carrière', 'CV, lettres de motivation, entretiens, reconversion.'],
  ['Bricoleurs', 'Réparations, travaux, déménagements.'],
  ['Mécanos', 'Voitures : pannes, entretien, achat ou vente.'],
  ['Cuisiniers', 'Recettes, menus, repas de fête.'],
  ['Organisateurs', 'Fêtes, événements et voyages.'],
  ['Profs', 'Devoirs, études et formation.'],
  ['Entraide santé', 'S’orienter dans les soins, rendez-vous, remboursements. Pas de diagnostic.'],
];

// Raccourcis pour décrire les questions.
const text = (label, extra = {}) => ({ type: 'text', label, ...extra });
const long = (label, extra = {}) => ({ type: 'textarea', label, ...extra });
const choice = (label, options, extra = {}) => ({ type: 'select', label, options, ...extra });
const radio = (label, options, extra = {}) => ({ type: 'radio', label, options, ...extra });
const yesno = (label, extra = {}) => ({ type: 'yesno', label, ...extra });
const date = (label, extra = {}) => ({ type: 'date', label, ...extra });
const number = (label, extra = {}) => ({ type: 'number', label, ...extra });
const file = (label, extra = {}) => ({ type: 'file', label, ...extra });
const req = { required: true };
// « Afficher seulement si la question précédente vaut Oui ».
const ifYes = (field) => ({ condition: { field, op: 'equals', value: 'Oui' } });

const NO_PASSWORD = 'N’écrivez jamais de mot de passe ni de code bancaire dans une demande.';

const FORMS = [
  // Informatique
  {
    name: 'Mon ordinateur est lent ou plante',
    section: 'Informatique',
    category: 'informatique',
    group: 'Informaticiens',
    description: 'Lenteurs, blocages, écran bleu, ordinateur qui ne démarre plus.',
    fields: [
      radio('Type d’ordinateur', ['PC Windows', 'Mac', 'Chromebook', 'Je ne sais pas'], req),
      choice('Depuis quand', ['Aujourd’hui', 'Quelques jours', 'Plusieurs semaines', 'Depuis toujours']),
      long('Que se passe-t-il ?', { ...req, help: 'Ce que vous faisiez, ce qui s’affiche, ce que vous avez déjà essayé.' }),
      yesno('Un message d’erreur s’affiche ?', { key: 'erreur' }),
      file('Photo ou capture du message', ifYes('erreur')),
      yesno('Cela vous empêche de travailler ?'),
    ],
  },
  {
    name: 'Virus, arnaque ou message suspect',
    section: 'Informatique',
    category: 'informatique',
    group: 'Informaticiens',
    priority: 'high',
    description: 'Un mail, un SMS, un appel ou une fenêtre qui vous semble louche. Mieux vaut demander avant de cliquer.',
    fields: [
      radio('Comment est-ce arrivé ?', ['E-mail', 'SMS', 'Appel', 'Site web', 'Fenêtre sur l’ordinateur'], req),
      yesno('Avez-vous cliqué, payé ou donné des informations ?', { ...req, key: 'clique' }),
      long('Qu’avez-vous fait ou donné ?', { ...req, ...ifYes('clique'), help: NO_PASSWORD }),
      file('Capture du message'),
    ],
  },
  {
    name: 'Mot de passe oublié ou compte bloqué',
    section: 'Informatique',
    category: 'informatique',
    group: 'Informaticiens',
    description: 'Messagerie, compte en ligne, application : on vous aide à récupérer l’accès.',
    fields: [
      text('Service concerné', { ...req, inTitle: true, placeholder: 'Gmail, Ameli, Facebook…' }),
      long('Ce qui bloque', { ...req, help: NO_PASSWORD }),
      yesno('Avez-vous encore accès à l’adresse e-mail ou au téléphone de secours ?'),
    ],
  },
  {
    name: 'Internet, Wi-Fi ou box',
    section: 'Informatique',
    category: 'informatique',
    group: 'Informaticiens',
    description: 'Plus d’internet, connexion lente, Wi-Fi qui ne passe pas dans une pièce.',
    fields: [
      choice('Opérateur', ['Orange', 'Free', 'SFR', 'Bouygues Telecom', 'Autre']),
      radio('Problème', ['Plus d’internet', 'Connexion lente', 'Coupures', 'Wi-Fi faible dans une pièce'], req),
      text('Couleur ou état des voyants de la box'),
      long('Précisions'),
    ],
  },
  {
    name: 'Imprimante ou scanner',
    section: 'Informatique',
    category: 'informatique',
    group: 'Informaticiens',
    description: 'L’imprimante n’imprime plus, n’est pas reconnue, ou il faut l’installer.',
    fields: [
      text('Marque et modèle', { ...req, inTitle: true, placeholder: 'HP DeskJet 2720…' }),
      long('Le problème', req),
      file('Photo du message ou de l’imprimante'),
    ],
  },
  {
    name: 'Installer ou configurer un logiciel',
    section: 'Informatique',
    category: 'informatique',
    group: 'Informaticiens',
    description: 'Installer une application, régler un logiciel, apprendre à s’en servir.',
    fields: [
      text('Logiciel ou application', { ...req, inTitle: true }),
      text('Sur quel appareil ?'),
      long('Ce que vous voulez faire', req),
    ],
  },
  {
    name: 'Conseil pour acheter un appareil',
    section: 'Informatique',
    category: 'achats',
    group: 'Informaticiens',
    description: 'Ordinateur, téléphone, tablette, imprimante, télévision : lequel choisir ?',
    fields: [
      choice('Appareil', ['Ordinateur portable', 'Ordinateur fixe', 'Smartphone', 'Tablette', 'Imprimante', 'Télévision', 'Autre'], req),
      number('Budget maximum (€)'),
      long('Pour quoi faire ?', { ...req, help: 'Internet et mails, photos, jeux, travail, études…' }),
      date('Pour quand ?'),
    ],
  },
  // Téléphone
  {
    name: 'Problème de smartphone ou de tablette',
    section: 'Téléphone et tablette',
    category: 'telephone',
    group: 'Informaticiens',
    description: 'Batterie, stockage plein, application, écran, appels ou SMS.',
    fields: [
      radio('Appareil', ['Android', 'iPhone', 'Tablette'], req),
      choice('Le problème', ['Batterie', 'Stockage plein', 'Une application', 'Écran', 'Appels ou SMS', 'Autre'], req),
      long('Détails', req),
    ],
  },
  {
    name: 'Sauvegarder ou transférer photos et contacts',
    section: 'Téléphone et tablette',
    category: 'telephone',
    group: 'Informaticiens',
    description: 'Changer de téléphone sans rien perdre, ou mettre ses photos à l’abri.',
    fields: [
      radio('Quoi ?', ['Photos', 'Contacts', 'Tout'], req),
      text('Depuis quel appareil ?', req),
      text('Vers quel appareil ou service ?', { placeholder: 'Nouveau téléphone, ordinateur, clé USB…' }),
    ],
  },
  // Démarches administratives
  {
    name: 'Comprendre un courrier administratif',
    section: 'Démarches administratives',
    category: 'administratif',
    group: 'As de la paperasse',
    description: 'Un courrier de la CAF, de la CPAM, de la mairie ou d’une banque à déchiffrer.',
    fields: [
      choice('Organisme', ['CAF', 'CPAM (Assurance maladie)', 'France Travail', 'Caisse de retraite', 'Mairie', 'Banque', 'Assurance', 'Autre'], req),
      date('Date limite de réponse', { help: 'Si le courrier en indique une.' }),
      file('Le courrier (photo ou PDF)', req),
      long('Votre question'),
    ],
  },
  {
    name: 'Faire une démarche en ligne',
    section: 'Démarches administratives',
    category: 'administratif',
    group: 'As de la paperasse',
    description: 'Carte grise, passeport, changement d’adresse, compte France Connect…',
    fields: [
      text('Démarche', { ...req, inTitle: true, placeholder: 'Renouvellement de passeport…' }),
      text('Site concerné', { placeholder: 'ants.gouv.fr, service-public.fr…' }),
      long('Où ça bloque ?', { ...req, help: NO_PASSWORD }),
    ],
  },
  {
    name: 'Rédiger une lettre ou un recours',
    section: 'Démarches administratives',
    category: 'administratif',
    group: 'As de la paperasse',
    description: 'Réclamation, résiliation, contestation, demande de remise gracieuse.',
    fields: [
      text('Destinataire', { ...req, inTitle: true }),
      long('Ce que vous voulez obtenir', req),
      date('Date limite'),
      file('Documents utiles'),
    ],
  },
  // Impôts
  {
    name: 'Aide à la déclaration de revenus',
    section: 'Impôts et fiscalité',
    category: 'impots',
    group: 'Fiscalistes',
    description: 'Remplir sa déclaration, vérifier les cases, ne rien oublier. Pensez à cocher « demande confidentielle ».',
    fields: [
      choice('Situation', ['Célibataire', 'Marié(e) ou pacsé(e)', 'Divorcé(e) ou séparé(e)', 'Veuf ou veuve'], req),
      number('Nombre d’enfants à charge'),
      yesno('Votre situation a changé cette année ?', { key: 'changement', help: 'Mariage, naissance, séparation, déménagement…' }),
      long('Qu’est-ce qui a changé ?', { ...req, ...ifYes('changement') }),
      yesno('Revenus particuliers ?', { key: 'particuliers', help: 'Indépendant, location, revenus de l’étranger, pension…' }),
      long('Lesquels ?', { ...req, ...ifYes('particuliers') }),
      long('Vos questions'),
    ],
  },
  {
    name: 'Comprendre un avis d’imposition ou une taxe',
    section: 'Impôts et fiscalité',
    category: 'impots',
    group: 'Fiscalistes',
    description: 'Impôt sur le revenu, taxe foncière, prélèvement à la source.',
    fields: [
      choice('Document', ['Avis d’impôt sur le revenu', 'Taxe foncière', 'Taux de prélèvement à la source', 'Autre'], req),
      file('Le document'),
      long('Votre question', req),
    ],
  },
  // Budget, banque, assurances
  {
    name: 'Faire un budget ou réduire ses dépenses',
    section: 'Budget, banque et assurances',
    category: 'argent',
    group: 'Conseillers budget',
    description: 'Y voir clair dans ses dépenses, épargner pour un projet, faire le tri dans les abonnements.',
    fields: [
      radio('Objectif', ['Équilibrer le budget', 'Épargner pour un projet', 'Réduire les abonnements'], req),
      long('Votre situation et ce que vous aimeriez', req),
    ],
  },
  {
    name: 'Comparer une assurance, une banque ou un contrat',
    section: 'Budget, banque et assurances',
    category: 'argent',
    group: 'Conseillers budget',
    description: 'Assurance auto ou habitation, mutuelle, banque, crédit, électricité : est-ce une bonne offre ?',
    fields: [
      choice('Type de contrat', ['Assurance auto', 'Assurance habitation', 'Mutuelle', 'Banque', 'Crédit', 'Électricité ou gaz', 'Autre'], req),
      long('Votre contrat actuel et l’offre proposée', req),
      file('Documents (devis, conditions)'),
    ],
  },
  // Carrière
  {
    name: 'Relecture de CV',
    section: 'Carrière et emploi',
    category: 'carriere',
    group: 'Coachs carrière',
    description: 'Un regard extérieur sur votre CV, pour un poste ou en général.',
    fields: [
      text('Poste visé', { ...req, inTitle: true }),
      text('Secteur'),
      file('Votre CV', req),
      long('Ce que vous voulez améliorer'),
    ],
  },
  {
    name: 'Lettre de motivation',
    section: 'Carrière et emploi',
    category: 'carriere',
    group: 'Coachs carrière',
    description: 'Écrire ou améliorer une lettre de motivation.',
    fields: [
      text('Entreprise et poste', { ...req, inTitle: true }),
      long('L’annonce (ou son lien)'),
      file('Votre brouillon, si vous en avez un'),
    ],
  },
  {
    name: 'Préparer un entretien',
    section: 'Carrière et emploi',
    category: 'carriere',
    group: 'Coachs carrière',
    description: 'Entretien d’embauche, entretien annuel : s’entraîner aux questions.',
    fields: [
      text('Poste ou type d’entretien', { ...req, inTitle: true }),
      date('Date de l’entretien', req),
      radio('Format', ['Téléphone', 'Visio', 'Sur place']),
      long('Ce qui vous inquiète'),
    ],
  },
  {
    name: 'Conseils de carrière, reconversion ou salaire',
    section: 'Carrière et emploi',
    category: 'carriere',
    group: 'Coachs carrière',
    description: 'Changer de métier, négocier une augmentation, demander une formation, quitter un poste.',
    fields: [
      choice('Sujet', ['Reconversion', 'Négocier un salaire', 'Demander une formation', 'Démission ou rupture conventionnelle', 'Autre'], req),
      long('Votre situation', req),
    ],
  },
  // Logement
  {
    name: 'Petit bricolage ou réparation',
    section: 'Logement et bricolage',
    category: 'logement',
    group: 'Bricoleurs',
    description: 'Fuite, prise, meuble à monter, étagère à fixer : conseil ou coup de main.',
    fields: [
      text('Pièce ou équipement', { placeholder: 'Salle de bain, chaudière…' }),
      long('Le problème', req),
      file('Photo'),
      yesno('C’est urgent ?', { help: 'Pour une fuite de gaz ou un risque électrique, appelez d’abord un professionnel ou les secours.' }),
    ],
  },
  {
    name: 'Aide pour un déménagement',
    section: 'Logement et bricolage',
    category: 'logement',
    group: 'Bricoleurs',
    description: 'Des bras, un véhicule, ou de l’aide pour les changements d’adresse.',
    fields: [
      date('Date du déménagement', req),
      text('Ville de départ et d’arrivée'),
      radio('Besoin', ['Des bras pour porter', 'Un véhicule', 'Les démarches (adresse, contrats)', 'Un peu de tout'], req),
      long('Précisions'),
    ],
  },
  // Voiture
  {
    name: 'Voiture : panne, entretien ou achat',
    section: 'Voiture et mobilité',
    category: 'vehicule',
    group: 'Mécanos',
    description: 'Bruit bizarre, voyant allumé, contrôle technique, achat d’occasion.',
    fields: [
      text('Véhicule', { ...req, inTitle: true, placeholder: 'Renault Clio 2018…' }),
      radio('Sujet', ['Panne ou bruit', 'Voyant allumé', 'Entretien ou contrôle technique', 'Achat ou vente'], req),
      long('Détails', req),
      file('Photo (voyant, devis…)'),
    ],
  },
  // Santé
  {
    name: 'S’orienter dans les soins',
    section: 'Santé et bien-être',
    category: 'sante',
    group: 'Entraide santé',
    description:
      'Trouver un médecin, prendre rendez-vous, comprendre un remboursement. Pas de diagnostic : pour une urgence, appelez le 15 ou le 112.',
    fields: [
      radio('Besoin', ['Trouver un professionnel', 'Prendre un rendez-vous', 'Comprendre un remboursement', 'Autre'], req),
      text('Ville ou secteur'),
      long('Précisions', { help: 'Cochez « demande confidentielle » si le sujet est personnel.' }),
    ],
  },
  // Droit
  {
    name: 'Litige avec une entreprise ou un voisin',
    section: 'Droit et litiges',
    category: 'juridique',
    group: 'As de la paperasse',
    description: 'Colis jamais livré, artisan qui ne termine pas, souci de voisinage. Des conseils entre proches, pas l’avis d’un avocat.',
    fields: [
      text('Avec qui ?', { ...req, inTitle: true }),
      long('La situation', req),
      file('Documents (contrat, factures, échanges)'),
    ],
  },
  // Cuisine
  {
    name: 'Idée de recette ou de menu',
    section: 'Cuisine et recettes',
    category: 'cuisine',
    group: 'Cuisiniers',
    description: 'Un plat pour ce soir, un menu de fête, quoi faire avec ce qui reste au frigo.',
    fields: [
      text('Occasion', { inTitle: true, placeholder: 'Repas de Noël, dîner rapide…' }),
      number('Nombre de personnes'),
      long('Contraintes', { help: 'Allergies, régime, budget, temps disponible, ingrédients à utiliser.' }),
    ],
  },
  // Événements et voyages
  {
    name: 'Organiser une fête ou un événement',
    section: 'Fêtes et événements',
    category: 'evenements',
    group: 'Organisateurs',
    description: 'Anniversaire, baptême, mariage, réunion de famille.',
    fields: [
      text('Événement', { ...req, inTitle: true }),
      date('Date'),
      number('Nombre d’invités'),
      long('Besoin d’aide pour', req),
    ],
  },
  {
    name: 'Préparer un voyage',
    section: 'Voyages et loisirs',
    category: 'voyages',
    group: 'Organisateurs',
    description: 'Idées de destination, itinéraire, réservations, papiers à prévoir.',
    fields: [
      text('Destination', { ...req, inTitle: true, placeholder: 'Ou « je ne sais pas encore »' }),
      text('Dates ou période'),
      number('Budget (€)'),
      long('Aide souhaitée', req),
    ],
  },
  // Études
  {
    name: 'Aide aux devoirs ou aux études',
    section: 'Études et devoirs',
    category: 'etudes',
    group: 'Profs',
    description: 'Un exercice, une notion à comprendre, une orientation à choisir.',
    fields: [
      choice('Niveau', ['Primaire', 'Collège', 'Lycée', 'Études supérieures', 'Formation adulte'], req),
      text('Matière', { ...req, inTitle: true }),
      long('La question', req),
      file('L’énoncé ou le document'),
    ],
  },
  // Achats
  {
    name: 'Avis avant un achat important',
    section: 'Achats et bons plans',
    category: 'achats',
    group: 'Conseillers budget',
    description: 'Électroménager, meuble, gros équipement : bonne affaire ou pas ?',
    fields: [
      text('Produit', { ...req, inTitle: true }),
      number('Budget (€)'),
      text('Lien ou référence'),
      long('Ce qui vous fait hésiter'),
    ],
  },
];

// Version 2 : un groupe par catégorie, des Coordinateurs, et une visibilité réglée pour chaque catégorie.
const GROUPS_V2 = [
  ['Experts mobiles', 'Smartphones et tablettes : réglages, applications, sauvegardes.'],
  ['Conseillers juridiques', 'Litiges, contrats, droits du consommateur. Des conseils entre proches, pas l’avis d’un avocat.'],
  ['Globe-trotteurs', 'Voyages, loisirs, sorties.'],
  ['Chasseurs de bons plans', 'Achats, comparatifs, promotions.'],
  ['Coordinateurs', 'Voient toutes les demandes non personnelles et répartissent le travail entre les groupes.'],
];

// Groupe responsable de chaque catégorie.
const CATEGORY_GROUP = {
  informatique: 'Informaticiens',
  telephone: 'Experts mobiles',
  administratif: 'As de la paperasse',
  impots: 'Fiscalistes',
  argent: 'Conseillers budget',
  carriere: 'Coachs carrière',
  logement: 'Bricoleurs',
  vehicule: 'Mécanos',
  sante: 'Entraide santé',
  juridique: 'Conseillers juridiques',
  cuisine: 'Cuisiniers',
  evenements: 'Organisateurs',
  voyages: 'Globe-trotteurs',
  etudes: 'Profs',
  achats: 'Chasseurs de bons plans',
};

// Sujets personnels : réservés à leur groupe (les Coordinateurs ne les voient pas).
const PERSONAL = ['impots', 'argent', 'carriere', 'sante', 'juridique'];

// Formulaires de la version 1 qui changent de groupe (seulement s'ils ont gardé le groupe d'origine).
const REASSIGN_V2 = {
  'Problème de smartphone ou de tablette': ['Informaticiens', 'Experts mobiles'],
  'Sauvegarder ou transférer photos et contacts': ['Informaticiens', 'Experts mobiles'],
  'Litige avec une entreprise ou un voisin': ['As de la paperasse', 'Conseillers juridiques'],
  'Préparer un voyage': ['Organisateurs', 'Globe-trotteurs'],
  'Avis avant un achat important': ['Conseillers budget', 'Chasseurs de bons plans'],
};

// Droits par défaut : chaque groupe d'entraide traite les demandes de sa catégorie ;
// les Coordinateurs voient tout (hors sujets personnels), modifient et répartissent.
const HELPER_RIGHTS = { view: 'group', create: true, work: true, assign: true, edit: false, delete: false };
const COORDINATOR_RIGHTS = { view: 'all', create: true, work: true, assign: true, edit: true, delete: false };

function slug(label) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
}

/** Donne un identifiant technique unique à chaque question (les règles d'affichage s'y réfèrent). */
function withKeys(fields) {
  const used = new Set();
  return fields.map((f) => {
    let key = f.key || slug(f.label) || 'question';
    for (let i = 2; used.has(key); i += 1) key = `${(f.key || slug(f.label)).slice(0, 34)}_${i}`;
    used.add(key);
    const out = { required: false, help: '', placeholder: '', inTitle: false, ...f, key };
    if (f.type === 'yesno') out.options = ['Oui', 'Non'];
    return out;
  });
}

async function findOrCreateGroup(db, name, description, now, added) {
  const row = await db.get('SELECT id FROM user_groups WHERE name = ? COLLATE NOCASE', [name]);
  if (row) return row.id;
  added.groups += 1;
  return (await db.run('INSERT INTO user_groups (name, description, created_at) VALUES (?, ?, ?)', [name, description, now])).lastID;
}

/** Version 1 : catégories, groupes d'entraide, formulaires. */
async function applyV1(db, now, added) {
  // Catégories : ajoutées si ni la clé ni le nom n'existent.
  const categories = await getSetting(db, 'categories');
  for (const [key, label] of CATEGORIES) {
    const exists = categories.some((c) => c.key === key || c.label.toLowerCase() === label.toLowerCase());
    if (!exists) {
      categories.push({ key, label, active: true });
      added.categories += 1;
    }
  }
  await setSetting(db, 'categories', categories);

  const groupId = {};
  for (const [name, description] of GROUPS) groupId[name] = await findOrCreateGroup(db, name, description, now, added);

  // Formulaires : ajoutés si aucun ne porte déjà ce nom.
  for (const form of FORMS) {
    const exists = await db.get('SELECT id FROM catalog_items WHERE name = ? COLLATE NOCASE', [form.name]);
    if (exists) continue;
    await db.run(
      `INSERT INTO catalog_items (name, description, section, priority, category, active, fulfillment_group, fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [form.name, form.description, form.section, form.priority || 'medium', categoryKey(categories, form.category),
        groupId[form.group] ?? null, JSON.stringify(withKeys(form.fields)), now, now]
    );
    added.forms += 1;
  }
}

function categoryKey(categories, key) {
  const label = CATEGORIES.find(([k]) => k === key)?.[1];
  return (categories.find((c) => c.key === key) || categories.find((c) => c.label.toLowerCase() === label?.toLowerCase()))?.key || '';
}

/** Version 2 : un groupe par catégorie, Coordinateurs, droits et visibilité par défaut. */
async function applyV2(db, now, added, { previousVersion }) {
  const categories = await getSetting(db, 'categories');
  const descriptions = Object.fromEntries([...GROUPS, ...GROUPS_V2]);
  const groupId = {};
  for (const name of new Set([...Object.values(CATEGORY_GROUP), 'Coordinateurs'])) {
    groupId[name] = await findOrCreateGroup(db, name, descriptions[name] || '', now, added);
  }

  const access = await getSetting(db, 'access');
  access.groups = access.groups || {};
  access.categories = access.categories || {};
  // Droits des groupes : seulement pour ceux qui n'ont pas encore de réglage enregistré.
  for (const name of Object.keys(groupId)) {
    const id = groupId[name];
    if (!access.groups[id]) {
      access.groups[id] = name === 'Coordinateurs' ? COORDINATOR_RIGHTS : HELPER_RIGHTS;
      added.rights += 1;
    }
  }
  // Visibilité par catégorie : une règle pour chaque catégorie qui n'en a pas, ou qui a encore
  // exactement celle posée par la version 1.
  const V1_RULES = { impots: ['Fiscalistes'], argent: ['Conseillers budget', 'Fiscalistes'], carriere: ['Coachs carrière'], sante: ['Entraide santé'] };
  for (const [cat, groupName] of Object.entries(CATEGORY_GROUP)) {
    const key = categoryKey(categories, cat);
    if (!key) continue;
    const current = access.categories[key] || [];
    const v1 = (V1_RULES[cat] || []).map((n) => groupId[n] ?? null);
    const untouched = !current.length || (previousVersion >= 1 && current.length === v1.length && current.every((id) => v1.includes(id)));
    if (!untouched) continue;
    const list = cat === 'argent' ? [groupId[groupName], groupId.Fiscalistes] : [groupId[groupName]];
    if (!PERSONAL.includes(cat)) list.push(groupId.Coordinateurs);
    access.categories[key] = [...new Set(list.filter(Boolean))];
    added.rules += 1;
  }
  await setSetting(db, 'access', access);

  // Formulaires à réaffecter, s'ils ont gardé le groupe d'origine.
  for (const [name, [from, to]] of Object.entries(REASSIGN_V2)) {
    const fromId = (await db.get('SELECT id FROM user_groups WHERE name = ? COLLATE NOCASE', [from]))?.id;
    if (!fromId) continue;
    const { changes } = await db.run(
      'UPDATE catalog_items SET fulfillment_group = ?, updated_at = ? WHERE name = ? COLLATE NOCASE AND fulfillment_group = ?',
      [groupId[to], now, name, fromId]
    );
    added.forms += changes;
  }
}

async function applyContent(db, { logger = console } = {}) {
  const done = await db.get("SELECT value FROM settings WHERE key = 'content_version'");
  const version = done ? Number(JSON.parse(done.value)) || 0 : 0;
  if (version >= CONTENT_VERSION) return { applied: false };
  const now = nowIso();
  const added = { categories: 0, groups: 0, forms: 0, rights: 0, rules: 0 };
  if (version < 1) await applyV1(db, now, added);
  if (version < 2) await applyV2(db, now, added, { previousVersion: version });
  // Version 3 : les Coordinateurs (droits étendus) ne sont pas ouverts aux demandes d'adhésion.
  if (version < 3) await db.run("UPDATE user_groups SET joinable = 0 WHERE name = 'Coordinateurs' COLLATE NOCASE");
  // Version 4 : textes d'accueil. Remplacés seulement s'ils sont vides ou encore ceux de la première version
  // (dépannage informatique) ; un texte personnalisé autrement n'est pas touché.
  if (version < 4) {
    const appearance = await getSetting(db, 'appearance');
    const oldTitle = !appearance.homeTitle || /^Un souci avec l.ordi/i.test(appearance.homeTitle);
    const oldText = !appearance.homeText || /^Décrivez votre problème avec vos mots/i.test(appearance.homeText);
    if (oldTitle && oldText) await setSetting(db, 'appearance', { ...appearance, homeTitle: HOME_TITLE, homeText: HOME_TEXT });
  }
  await setSetting(db, 'content_version', CONTENT_VERSION);
  logger.info(
    `Contenu mis à jour (version ${CONTENT_VERSION}) : ${added.categories} catégorie(s), ${added.groups} groupe(s), ` +
      `${added.forms} formulaire(s) ajouté(s) ou réaffecté(s), ${added.rights} groupe(s) avec droits, ${added.rules} règle(s) de visibilité.`
  );
  return { applied: true, added };
}

module.exports = { HOME_TITLE, HOME_TEXT, applyContent, applyV1, CONTENT_VERSION, FORMS, GROUPS, GROUPS_V2, CATEGORIES, CATEGORY_GROUP, withKeys };

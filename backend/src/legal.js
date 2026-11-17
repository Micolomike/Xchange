/**
 * Textes juridiques proposés par défaut (modifiables dans Administration > Paramètres > RGPD).
 * Mise en forme simple : « ## » pour un titre, « - » pour une liste, ligne vide entre deux paragraphes.
 * Les passages entre crochets sont à compléter par l'éditeur du site.
 */

const LEGAL_NOTICE = `## Éditeur du site
Xchange est un service d'entraide gratuit, édité à titre non professionnel par [Prénom Nom], [adresse postale]. Contact : [adresse e-mail].

Directeur de la publication : [Prénom Nom].

## Hébergement
Le site est hébergé par son éditeur, [Prénom Nom], [adresse postale], sur un ordinateur situé en France. Contact : [adresse e-mail].

Les connexions depuis Internet passent par le service de relais Tailscale Funnel (Tailscale Inc., Toronto, Canada). Ces relais transmettent les échanges chiffrés sans pouvoir en lire le contenu.

## Contenus publiés par les utilisateurs
Les demandes, les messages et les discussions sont rédigés par les utilisateurs, sous leur responsabilité, dans le respect de la charte d'utilisation. Pour signaler un contenu illicite ou contraire à la charte, utilisez le drapeau à côté d'un message de discussion, ou écrivez à [adresse e-mail] : il sera examiné et retiré si nécessaire.

## Données personnelles
Le traitement des données personnelles est décrit dans la politique de confidentialité.`;

const PRIVACY_POLICY = `## Qui est responsable de vos données ?
[Prénom Nom], éditeur de Xchange, [adresse postale]. Contact pour toute question ou demande : [adresse e-mail].

## Quelles données, et pourquoi ?
Xchange sert à demander de l'aide et à en proposer. Nous traitons :
- votre compte : identifiant, prénom, nom, adresse e-mail, mot de passe (stocké sous une forme hachée, illisible), réglages de double authentification (y compris, le cas échéant, votre choix de ne pas l'utiliser et sa date), navigateurs de confiance, préférences de notification, versions de la charte acceptées et leurs dates ;
- vos demandes et messages, vos réponses aux formulaires, leurs pièces jointes et l'historique de leur traitement ;
- vos messages dans les discussions (salons, messages privés, conversations de groupe), les conversations dont vous faites partie, ce que vous avez déjà lu, la durée de conservation que vous avez choisie et les messages que vous avez signalés ;
- vos rapports et tableaux de bord (leurs réglages, pas de copie des demandes), vos envois programmés, leurs destinataires et l'historique de ces envois ;
- vos groupes et vos demandes pour rejoindre un groupe ;
- vos demandes concernant vos données personnelles ;
- des journaux techniques : historique de sécurité de votre compte, e-mails de notification envoyés, actions faites par un administrateur à votre place, date de votre dernière activité.

Les questions posées à l'assistant d'aide qui n'ont trouvé aucune réponse sont gardées sans votre nom, pour améliorer le service. L'assistant ne fait appel à aucune intelligence artificielle ni à aucun service extérieur.

Ces données servent uniquement à faire fonctionner Xchange. Elles ne sont ni vendues, ni utilisées à des fins publicitaires, ni soumises à un profilage.

## Sur quelle base ?
- le service que vous demandez en créant un compte (article 6.1.b du RGPD) ;
- notre intérêt légitime à sécuriser le service, à modérer les messages signalés et à garder une trace des actions des administrateurs (article 6.1.f) : journaux techniques et signalements.

## Informations sensibles
N'indiquez pas d'informations de santé, de numéros de compte bancaire, de mots de passe ni de documents d'identité dans vos demandes ni dans les discussions. Si une aide en a besoin, échangez-les directement avec la personne qui vous aide, hors de Xchange.

## Qui voit vos données ?
- les membres du groupe qui traite votre demande et la personne qui s'en occupe ;
- les administrateurs du site ;
- une demande confidentielle n'est visible que par vous, la personne qui la traite et les administrateurs qui y participent ;
- un message de discussion n'est visible que par les participants de la conversation : tous les membres pour le salon général, les membres du groupe pour un salon de groupe, les personnes invitées pour un message privé ou une conversation de groupe.

Être administrateur ne donne aucun accès aux discussions : un administrateur ne lit que les conversations dont il fait partie, comme tout le monde. Quand un participant signale un message aux administrateurs, ils voient ce message seul, son auteur, la personne qui l'a signalé et le motif, puis le retirent ou le laissent en place. L'auteur ne sait pas qui l'a signalé.

Les rapports et tableaux de bord sont calculés avec les droits de la personne qui les consulte : les partager ne donne accès à aucune demande en plus. Un rapport envoyé par e-mail est calculé avec les droits de la personne qui l'a programmé, et n'est envoyé qu'aux destinataires qui voient eux-mêmes toutes les demandes qu'il contient. Les administrateurs voient la liste des envois programmés (qui envoie quoi, à qui, quand), sans leur contenu.

Vous pouvez choisir, à l'inscription ou dans « Mon compte », de n'afficher que votre pseudonyme : les autres membres ne voient alors ni votre prénom ni votre nom ; les administrateurs les voient toujours.

Pour vous aider, un administrateur peut agir à votre place. Chaque prise de contrôle est enregistrée, et elle ne donne accès ni aux demandes confidentielles ni aux discussions.

Prestataires techniques :
- Orange (Orange SA, France) achemine les e-mails de notification ;
- Tailscale (Tailscale Inc., Canada) relaie les connexions vers le site. Ses relais voient les adresses IP des connexions, mais pas leur contenu, qui reste chiffré.

## Où sont vos données ?
Sur l'ordinateur de l'éditeur, en France, et dans ses sauvegardes.

## Combien de temps ?
- votre compte : tant que vous l'utilisez ; après {{inactiveMonths}} sans connexion, il est anonymisé automatiquement, après un e-mail d'avertissement envoyé un mois avant ;
- vos demandes et messages : tant que votre compte existe, puis sans votre nom, sauf si vous demandez leur suppression ;
- une demande supprimée : {{trashDays}} dans la corbeille, puis effacée définitivement avec ses pièces jointes ;
- vos messages de discussion : tant que votre compte existe, ou la durée que vous choisissez dans « Mon compte » (30 jours, 6 mois ou 1 an) ; vous pouvez aussi les effacer à tout moment, un par un ou tous ensemble. Un message supprimé laisse la mention « Message supprimé » pendant 30 jours ;
- vos rapports, tableaux de bord et envois programmés : tant que vous les gardez ; ils sont supprimés avec votre compte ;
- les journaux techniques, les demandes d'adhésion et les signalements déjà traités, l'historique des envois de rapports, les questions de l'assistant restées sans réponse : {{logMonths}} ;
- l'historique de sécurité de votre compte : tant que votre compte existe ;
- un navigateur de confiance : 30 jours au plus, ou jusqu'à ce que vous le retiriez ou changiez de mot de passe ;
- vos demandes concernant vos données : gardées pour prouver qu'elles ont été traitées, sans votre nom une fois votre compte anonymisé ;
- les sauvegardes : seules les plus récentes sont gardées ; une donnée effacée en disparaît à leur renouvellement.

Quand un compte est anonymisé, le nom, l'adresse e-mail et l'identifiant sont remplacés par « Utilisateur supprimé », et la personne quitte toutes ses conversations ; ses messages de discussion restent sans son nom, ou sont supprimés si elle l'a demandé. Le texte des demandes et des messages conservés n'est pas modifié : un nom écrit dans un message n'est pas détecté automatiquement.

## Vos droits
Vous pouvez accéder à vos données, les corriger, les exporter, demander leur effacement, vous opposer à un traitement fondé sur notre intérêt légitime ou demander sa limitation.

Dans « Mon compte », vous pouvez :
- modifier votre profil et choisir les e-mails que vous recevez, y compris refuser les rapports programmés par d'autres personnes ;
- choisir combien de temps vos messages de discussion sont gardés, et les effacer ;
- télécharger toutes vos données (rubrique « Mes données ») ;
- demander l'anonymisation ou la suppression de votre compte, la correction d'une information, ou faire une autre demande.

Vous pouvez aussi écrire à [adresse e-mail]. Nous répondons dans un délai d'un mois.

Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (www.cnil.fr).

## Sécurité
Connexion chiffrée (HTTPS), double authentification, mots de passe hachés, droits d'accès par groupe, sauvegardes régulières. En cas de violation de données, la CNIL est prévenue dans les délais légaux, et vous êtes informé si le risque pour vous est élevé.

## Cookies
Xchange n'utilise ni cookie publicitaire ni mesure d'audience, et ne charge aucun service extérieur. Le navigateur garde seulement votre session de connexion, votre choix de thème et, si vous le demandez à la connexion, un identifiant de navigateur de confiance (30 jours au plus). Ces informations sont nécessaires au fonctionnement du site.`;

const CHARTER = `## Le principe
Xchange met en relation des personnes qui cherchent de l'aide et des personnes qui veulent aider. L'aide est bénévole, gratuite et sans garantie de résultat.

## Ce que vous vous engagez à respecter
- rester courtois : pas d'insulte, de vulgarité, de moquerie ni de propos discriminatoires ;
- décrire votre besoin honnêtement, sans demande illégale ;
- ne pas publier d'informations sensibles : santé, numéros de compte, mots de passe, documents d'identité ;
- respecter la vie privée des autres : ne pas diffuser ce que vous lisez dans une demande ou une conversation ;
- ne pas utiliser Xchange pour faire de la publicité ou du démarchage ;
- n'envoyer des rapports programmés qu'aux personnes qu'ils concernent, et arrêter un envoi dès qu'une personne ne souhaite plus le recevoir.

## Les discussions
Les discussions servent à s'entraider en direct. Les mêmes règles s'y appliquent, et en plus :
- pas de harcèlement : si une personne ne souhaite pas poursuivre un échange, laissez-la tranquille ;
- pas de messages répétés en masse ni de chaînes ;
- un message privé reste privé : ne le recopiez pas ailleurs sans l'accord de son auteur.

Les administrateurs ne lisent que les conversations dont ils font partie. Si un message vous choque, signalez-le avec le drapeau placé à côté : seul ce message leur est montré.

## En cas de problème
Un administrateur peut modifier ou supprimer un contenu qui ne respecte pas la charte, retirer un message signalé, arrêter un envoi programmé, et désactiver un compte. Pour signaler un contenu : le drapeau à côté d'un message de discussion, ou [adresse e-mail].

## Les conseils donnés
Les conseils sont donnés de bonne foi par des bénévoles. Pour une question médicale, juridique, fiscale ou financière importante, consultez un professionnel.`;

const LEGAL_DEFAULTS = { legalNotice: LEGAL_NOTICE, privacyPolicy: PRIVACY_POLICY, charter: CHARTER };

/** Remplace les durées de conservation réglées dans le texte de la politique de confidentialité. */
function fillRetention(text, { inactiveMonths, logMonths, trashDays = 30 }) {
  const months = (n) => (n >= 12 && n % 12 === 0 ? `${n / 12} an${n > 12 ? 's' : ''}` : `${n} mois`);
  return text
    .replaceAll('{{inactiveMonths}}', inactiveMonths ? months(inactiveMonths) : 'une durée fixée par l’administrateur')
    .replaceAll('{{logMonths}}', logMonths ? months(logMonths) : 'une durée limitée')
    .replaceAll('{{trashDays}}', trashDays ? `${trashDays} jours` : 'une durée fixée par l’administrateur');
}

module.exports = { LEGAL_DEFAULTS, fillRetention };

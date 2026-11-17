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
Les demandes et les messages sont rédigés par les utilisateurs, sous leur responsabilité, dans le respect de la charte d'utilisation. Pour signaler un contenu illicite ou contraire à la charte, écrivez à [adresse e-mail] : il sera examiné et retiré si nécessaire.

## Données personnelles
Le traitement des données personnelles est décrit dans la politique de confidentialité.`;

const PRIVACY_POLICY = `## Qui est responsable de vos données ?
[Prénom Nom], éditeur de Xchange, [adresse postale]. Contact pour toute question ou demande : [adresse e-mail].

## Quelles données, et pourquoi ?
Xchange sert à demander de l'aide et à en proposer. Nous traitons :
- votre compte : identifiant, prénom, nom, adresse e-mail, mot de passe (stocké sous une forme hachée, illisible), réglages de double authentification (y compris, le cas échéant, votre choix de ne pas l'utiliser et sa date), navigateurs de confiance, préférences de notification, date d'acceptation de la charte ;
- vos demandes et messages, vos réponses aux formulaires, leurs pièces jointes et l'historique de leur traitement ;
- vos groupes et vos demandes pour rejoindre un groupe ;
- vos demandes concernant vos données personnelles ;
- des journaux techniques : historique de sécurité de votre compte, e-mails de notification envoyés, actions faites par un administrateur à votre place, date de votre dernière activité.

Ces données servent uniquement à faire fonctionner Xchange. Elles ne sont ni vendues, ni utilisées à des fins publicitaires, ni soumises à un profilage.

## Sur quelle base ?
- le service que vous demandez en créant un compte (article 6.1.b du RGPD) ;
- notre intérêt légitime à sécuriser le service et à garder une trace des actions des administrateurs (article 6.1.f) : journaux techniques.

## Informations sensibles
N'indiquez pas d'informations de santé, de numéros de compte bancaire, de mots de passe ni de documents d'identité dans vos demandes. Si une aide en a besoin, échangez-les directement avec la personne qui vous aide, hors de Xchange.

## Qui voit vos données ?
- les membres du groupe qui traite votre demande et la personne qui s'en occupe ;
- les administrateurs du site ;
- une demande confidentielle n'est visible que par vous, la personne qui la traite et les administrateurs qui y participent.

Pour vous aider, un administrateur peut agir à votre place. Chaque prise de contrôle est enregistrée, et elle ne donne pas accès aux demandes confidentielles.

Prestataires techniques :
- Orange (Orange SA, France) achemine les e-mails de notification ;
- Tailscale (Tailscale Inc., Canada) relaie les connexions vers le site. Ses relais voient les adresses IP des connexions, mais pas leur contenu, qui reste chiffré.

## Où sont vos données ?
Sur l'ordinateur de l'éditeur, en France, et dans ses sauvegardes.

## Combien de temps ?
- votre compte : tant que vous l'utilisez ; après {{inactiveMonths}} sans connexion, il est anonymisé automatiquement ;
- vos demandes et messages : tant que votre compte existe, puis sans votre nom, sauf si vous demandez leur suppression ;
- une demande supprimée : {{trashDays}} dans la corbeille, puis effacée définitivement avec ses pièces jointes ;
- les journaux techniques et les demandes d'adhésion déjà traitées : {{logMonths}} ;
- l'historique de sécurité de votre compte : tant que votre compte existe ;
- un navigateur de confiance : 30 jours au plus, ou jusqu'à ce que vous le retiriez ou changiez de mot de passe ;
- vos demandes concernant vos données : gardées pour prouver qu'elles ont été traitées, sans votre nom une fois votre compte anonymisé ;
- les sauvegardes : seules les plus récentes sont gardées ; une donnée effacée en disparaît à leur renouvellement.

Quand un compte est anonymisé, le nom, l'adresse e-mail et l'identifiant sont remplacés par « Utilisateur supprimé ». Le texte des demandes et des messages conservés n'est pas modifié : un nom écrit dans un message n'est pas détecté automatiquement.

## Vos droits
Vous pouvez accéder à vos données, les corriger, les exporter, demander leur effacement, vous opposer à un traitement fondé sur notre intérêt légitime ou demander sa limitation.

Dans « Mon compte », vous pouvez :
- modifier votre profil et choisir les e-mails que vous recevez ;
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
- respecter la vie privée des autres : ne pas diffuser ce que vous lisez dans une demande ;
- ne pas utiliser Xchange pour faire de la publicité ou du démarchage.

## En cas de problème
Un administrateur peut modifier ou supprimer un contenu qui ne respecte pas la charte, et désactiver un compte. Pour signaler un contenu : [adresse e-mail].

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

/**
 * Textes juridiques proposés par défaut (modifiables dans Administration > Paramètres > RGPD).
 * Mise en forme simple : « ## » pour un titre, « - » pour une liste, ligne vide entre deux paragraphes.
 * Les passages entre crochets sont à compléter par l'éditeur du site.
 */

const LEGAL_NOTICE = `## Éditeur du site
Xchange est un service d'entraide édité à titre non professionnel par [Prénom Nom], [adresse postale ou « adresse communiquée sur demande »], contact : x.change@orange.fr.

Directeur de la publication : [Prénom Nom].

## Hébergement
Le site est hébergé par son éditeur, sur un ordinateur personnel situé en France. L'accès sécurisé depuis Internet passe par le service Tailscale (Tailscale Inc., Toronto, Canada), qui ne stocke pas les données du site.

## Contenus publiés par les utilisateurs
Les demandes et les messages sont rédigés par les utilisateurs, sous leur responsabilité. Ils doivent respecter la charte d'utilisation. Pour signaler un contenu, écrivez à x.change@orange.fr.

## Données personnelles
Le traitement des données personnelles est décrit dans la politique de confidentialité.`;

const PRIVACY_POLICY = `## Qui est responsable de vos données ?
[Prénom Nom], éditeur de Xchange. Contact pour toute question ou demande : x.change@orange.fr.

## Quelles données, et pourquoi ?
Xchange sert à demander de l'aide et à en proposer. Nous traitons :
- votre compte : identifiant, prénom, nom, adresse e-mail, mot de passe (stocké sous une forme hachée, illisible), réglages de double authentification ;
- vos demandes et messages, leurs pièces jointes et l'historique de leur traitement ;
- vos groupes et vos demandes pour rejoindre un groupe ;
- des journaux techniques : e-mails de notification envoyés, actions faites par un administrateur à votre place, date de dernière connexion.

Base légale : l'exécution du service que vous demandez en créant un compte (article 6.1.b du RGPD), et notre intérêt légitime à sécuriser le service (article 6.1.f) pour les journaux.

## Informations sensibles
N'indiquez pas d'informations de santé, de numéros de compte bancaire, de mots de passe ou de documents d'identité dans vos demandes. Si une aide en a besoin, échangez-les directement avec la personne qui vous aide, hors de Xchange.

## Qui voit vos données ?
- les membres du groupe qui traite votre demande et la personne qui s'en occupe ;
- les administrateurs du site ;
- une demande confidentielle n'est visible que par vous, la personne qui la traite et les administrateurs qui y participent.

Les e-mails de notification passent par la messagerie Orange (Orange SA, France). Aucune donnée n'est vendue ni utilisée à des fins publicitaires.

## Combien de temps ?
- votre compte : jusqu'à sa suppression, ou après {{inactiveMonths}} d'inactivité ; il est alors anonymisé automatiquement ;
- les journaux techniques : {{logMonths}} ;
- les sauvegardes : elles sont renouvelées régulièrement ; une donnée effacée disparaît des sauvegardes à leur rotation.

Quand un compte est anonymisé, le nom, l'adresse e-mail et l'identifiant sont remplacés par « Utilisateur supprimé ». Le texte des demandes et des messages conservés n'est pas modifié : un nom écrit dans un message n'est pas détecté automatiquement. Vous pouvez demander la suppression complète de vos demandes et messages.

## Vos droits
Vous pouvez accéder à vos données, les corriger, les exporter, demander leur effacement, vous opposer à un traitement ou demander sa limitation. Dans « Mon compte », rubrique « Mes données », vous pouvez modifier votre profil, télécharger vos données et demander l'anonymisation ou la suppression de votre compte, ou la correction d'une information. Vous pouvez aussi écrire à x.change@orange.fr. Nous répondons sous un mois.

Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (www.cnil.fr).

## Cookies
Xchange n'utilise ni cookie publicitaire ni mesure d'audience. Le navigateur garde seulement votre session de connexion et votre choix de thème, nécessaires au fonctionnement du site.`;

const CHARTER = `## Le principe
Xchange met en relation des personnes qui cherchent de l'aide et des personnes qui veulent aider. L'aide est bénévole et sans garantie de résultat.

## Ce que vous vous engagez à respecter
- rester courtois : pas d'insulte, de vulgarité, de moquerie ni de propos discriminatoires ;
- décrire votre besoin honnêtement, sans demande illégale ;
- ne pas publier d'informations sensibles : santé, numéros de compte, mots de passe, documents d'identité ;
- respecter la vie privée des autres : ne pas diffuser ce que vous lisez dans une demande ;
- ne pas utiliser Xchange pour faire de la publicité ou du démarchage.

## En cas de problème
Un administrateur peut modifier ou supprimer un contenu qui ne respecte pas la charte, et désactiver un compte. Pour signaler un contenu : x.change@orange.fr.

## Les conseils donnés
Les conseils sont donnés de bonne foi par des bénévoles. Pour une question médicale, juridique, fiscale ou financière importante, consultez un professionnel.`;

const LEGAL_DEFAULTS = { legalNotice: LEGAL_NOTICE, privacyPolicy: PRIVACY_POLICY, charter: CHARTER };

/** Remplace les durées de conservation réglées dans le texte de la politique de confidentialité. */
function fillRetention(text, { inactiveMonths, logMonths }) {
  const months = (n) => (n >= 12 && n % 12 === 0 ? `${n / 12} an${n > 12 ? 's' : ''}` : `${n} mois`);
  return text
    .replaceAll('{{inactiveMonths}}', inactiveMonths ? months(inactiveMonths) : 'une durée fixée par l’administrateur')
    .replaceAll('{{logMonths}}', logMonths ? months(logMonths) : 'une durée limitée');
}

module.exports = { LEGAL_DEFAULTS, fillRetention };

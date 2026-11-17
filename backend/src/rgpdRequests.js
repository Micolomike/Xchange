/** Demandes d'exercice des droits RGPD faites par les utilisateurs depuis « Mon compte ». */
const RGPD_TYPES = {
  anonymize: 'Anonymiser mon compte',
  erase: 'Supprimer mon compte, mes demandes et mes messages',
  rectify: 'Corriger des informations',
  other: 'Autre demande',
};

/** Délai légal de réponse : un mois. */
function dueDate(createdAt) {
  const d = new Date(createdAt);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

module.exports = { RGPD_TYPES, dueDate };

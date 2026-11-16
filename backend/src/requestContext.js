/**
 * Contexte de la requête en cours, accessible sans le passer partout : sert à tracer
 * l'administrateur qui agit à la place d'un utilisateur (impersonate).
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

const runWithContext = (context, fn) => storage.run(context, fn);
const currentImpersonatorId = () => storage.getStore()?.impersonatorId ?? null;

module.exports = { runWithContext, currentImpersonatorId };

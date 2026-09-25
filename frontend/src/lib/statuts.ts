/**
 * Ou un document s'efface vraiment, et ou il ne fait que s'annuler.
 *
 * UN BROUILLON N'A QUE DEUX ISSUES : on le complete, ou il disparait.
 * L'annuler en le laissant en base ne prouve rien — son numero n'a jamais rien
 * engage — et encombre durablement les listes et les etats d'un document mort
 * que personne ne sait plus pourquoi il est la.
 *
 * L'ANNULATION GARDE TOUT SON SENS PLUS LOIN. Des qu'un bon est VALIDE, son
 * numero est parti chez un fournisseur : l'effacer creerait dans la sequence un
 * trou qu'aucun controle ne saurait expliquer, et c'est exactement ce qu'un
 * auditeur cherche. La frontiere est donc EN_ATTENTE_VALIDATION.
 *
 * LE SERVEUR TIENT DEJA CETTE REGLE (`supprimer_bc`, backend/src/routes/stock.rs)
 * et refuse au-dela. Ce qui est ici n'a pas le dernier mot : c'est la politesse
 * de ne pas proposer un geste qui serait refuse, et la raison pour laquelle les
 * deux ecrans ne peuvent plus diverger.
 */

/** `string[]` ET NON `as const` : ces valeurs se comparent a un statut recu du
 *  serveur, donc a une `string`. Fige en tuple litteral, `includes` refuserait
 *  l'argument et obligerait a un transtypage a chaque appel. */
export const SUPPRIMABLES: string[] = ['BROUILLON', 'EN_ATTENTE_VALIDATION']

export const estSupprimable = (statut: string) => SUPPRIMABLES.includes(statut)

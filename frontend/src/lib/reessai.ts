/**
 * FAUT-IL REESSAYER UNE LECTURE EN ECHEC ? (17/10/2026)
 *
 * Un refus de droits ou une regle metier (4xx) ne changera pas en reessayant :
 * on s'arrete tout de suite. Une panne passagere (5xx, reseau) merite deux essais.
 *
 * SAUF DEUX CAS, QUI VEULENT DIRE « REVENEZ DANS UN INSTANT » :
 *   - 429 : la limitation de debit de nginx (audit C4) a vu une rafale ;
 *   - 503 : le serveur n'a pas obtenu de connexion a la base dans le delai
 *           (SERVEUR_OCCUPE) — sature, pas en panne, et rien n'a ete ecrit.
 * Reessayer apres le delai croissant de TanStack Query les fait passer ; les
 * traiter comme des erreurs ordinaires afficherait une panne pour une rafale.
 *
 * ET UNE EXCEPTION A L'EXCEPTION : le 429 de l'application a la connexion
 * (TROP_DE_TENTATIVES) verrouille pour plusieurs minutes. Reessayer dans la
 * seconde ne sert a rien — et compterait comme de nouvelles tentatives.
 *
 * Module PUR, sans React, pour etre teste par `node --test`.
 */
export function doitReessayer(echecs: number, erreur: unknown): boolean {
  const e = erreur as { statut?: number; code?: string } | null
  const statut = e?.statut
  if (e?.code === 'TROP_DE_TENTATIVES') return false
  if (statut === 429 || statut === 503) return echecs < 3
  if (statut && statut >= 400 && statut < 500) return false
  return echecs < 2
}

/**
 * L'identite de l'entreprise, lue une fois et partagee.
 *
 * POURQUOI ELLE VIENT DE LA BASE ET NON DU CODE. Une adresse change, un numero
 * de telephone change, une banque change. Les ecrire en dur obligerait a
 * recompiler et republier pour un chiffre — et, en pratique, personne ne le
 * fait : le document part avec l'ancien numero pendant des mois.
 *
 * POURQUOI UN SEUL ENDROIT. Ces informations paraissent a deux places qui
 * n'ont rien a voir — la barre de pied de l'application et l'entete de tout
 * document imprime. Deux lectures separees finissent toujours par diverger :
 * l'ecran affiche la nouvelle adresse, le bon de commande l'ancienne.
 *
 * LES COORDONNEES BANCAIRES PEUVENT MANQUER, et ce n'est pas une erreur : le
 * serveur ne les envoie qu'a qui traite les achats. Un changement de RIB
 * frauduleux sur des bons de commande est une escroquerie classique, dont la
 * premiere etape est la lecture.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface Entreprise {
  nom?: string
  /** La societe mere : Polyfashions est une filiale de Mazari Group. */
  groupe?: string | null
  adresse?: string | null
  telephone?: string | null
  fax?: string | null
  /** Les RIB, une banque par ligne. Absent si le role ne traite pas les achats. */
  banques?: string | null
  /** Registre du commerce. */
  rc?: string | null
  identifiant_fiscal?: string | null
  /** Taxe professionnelle, dite patente. */
  tp?: string | null
  cnss?: string | null
  /** Identifiant Commun de l'Entreprise — obligatoire sur une facture. */
  ice?: string | null
  capital?: number | null
  dirigeant?: string | null
  devise_base?: string
  logo_url?: string | null
}

/**
 * L'identite, ou un objet vide tant qu'elle n'est pas chargee.
 *
 * Elle ne change jamais en cours de session : une demi-heure de cache evite
 * autant d'allers-retours qu'il y a d'ecrans imprimables.
 */
export function useEntreprise(): Entreprise {
  const q = useQuery({
    queryKey: ['entreprise'],
    queryFn: () => api.get<Entreprise>('/api/entreprise'),
    staleTime: 30 * 60_000,
    // Une identite absente n'empeche pas de travailler : on n'insiste pas.
    retry: false,
  })
  return q.data ?? {}
}

/** Les mentions legales sur une ligne, pour un pied de document. */
export function mentionsLegales(e: Entreprise): string {
  return [
    e.rc && `RC ${e.rc}`,
    e.identifiant_fiscal && `IF ${e.identifiant_fiscal}`,
    e.ice && `ICE ${e.ice}`,
    e.tp && `TP ${e.tp}`,
    e.cnss && `CNSS ${e.cnss}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

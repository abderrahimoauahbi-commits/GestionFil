/**
 * LA SAISIE D'UNE REFERENCE, partout dans l'ERP.
 *
 * Chaque ecran de saisie avait sa propre facon de designer une matiere : un
 * `<datalist>` de deux mille options ici, une liste a cocher la, une fenetre
 * laterale ailleurs. Toutes chargeaient le CATALOGUE ENTIER pour filtrer dans
 * le navigateur — tenable sur 124 references, intenable sur mille : une seconde
 * d'attente a chaque ouverture d'ecran, et des listes que personne ne parcourt.
 * L'une d'elles tronquait meme a 500 sans le dire.
 *
 * Ici on TAPE, et le serveur cherche. Un seul composant, donc une seule facon
 * de chercher une matiere dans toute l'application : ce qu'on apprend sur un
 * ecran sert sur tous les autres.
 *
 * CE QU'IL MONTRE D'UNE REFERENCE. Son code, sa designation, et ce qui aide a
 * choisir au moment ou l'on choisit : le stock pour une sortie, le besoin pour
 * un achat. L'ecran appelant decide, par `mention`.
 */
import { useMemo } from 'react'
import { api } from '../api/client'
import { ChampRecherche, type Suggestion } from './ChampRecherche'

/** Ce qu'une reference doit porter pour etre proposee et convertie. */
export interface RefTrouvee extends Record<string, unknown> {
  code_reference: string
  designation?: string | null
  couleur?: string | null
  type_fil?: string | null
  unite_catalogue?: string | null
  code_fournisseur?: string | null
  fournisseur_nom?: string | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  densite_kg_ml?: number | null
  suivi_lot?: number | null
  prix_catalogue_kg?: number | null
  code_devise_catalogue?: string | null
}

/**
 * Cherche dans le catalogue, cote serveur.
 *
 * `recherche` cumule les mots en ET : « bleu 1500 » trouve
 * « PP-1500 Dtex-Bleu 6666 » sans qu'on respecte l'ordre des mots — qui n'est
 * jamais celui qu'on a en tete.
 */
export async function chercherCatalogue(
  motif: string,
  options: { fournisseur?: string; limite?: number } = {},
): Promise<RefTrouvee[]> {
  const p = new URLSearchParams({
    actif: '1',
    recherche: motif,
    limite: String(options.limite ?? 20),
  })
  if (options.fournisseur) p.set('code_fournisseur', options.fournisseur)
  return api.get<RefTrouvee[]>(`/api/catalogue?${p}`)
}

export function ChampReference({
  valeur,
  surChoix,
  fournisseur,
  dejaPrises,
  mention,
  placeholder,
  aide,
  surAucun,
  autoFocus,
  className,
  desactive,
  erreur,
  ariaLabel,
}: {
  valeur: string
  /** La reference RETENUE, entiere : l'ecran y lit le conditionnement. */
  surChoix: (r: RefTrouvee) => void
  /** Restreindre aux references de ce fournisseur. */
  fournisseur?: string
  /** Deja posees ailleurs : montrees barrees, non choisissables. */
  dejaPrises?: Set<string>
  /** Ce qui aide a choisir sur cet ecran-ci : un stock, un besoin, un prix. */
  mention?: (r: RefTrouvee) => { texte: string; ton?: Suggestion['ton'] } | null
  placeholder?: string
  aide?: string
  surAucun?: (motif: string) => React.ReactNode
  autoFocus?: boolean
  className?: string
  desactive?: boolean
  erreur?: boolean
  ariaLabel?: string
}) {
  const chercher = useMemo(
    () => async (motif: string): Promise<Suggestion[]> => {
      const refs = await chercherCatalogue(motif, { fournisseur })
      return refs.map((r) => {
        const m = mention?.(r)
        return {
          valeur: r.code_reference,
          titre: r.code_reference,
          detail:
            [r.designation, r.couleur, r.fournisseur_nom].filter(Boolean).join(' · ') || undefined,
          mention: m?.texte,
          ton: m?.ton,
          desactivee: dejaPrises?.has(r.code_reference),
          charge: r,
        }
      })
    },
    [fournisseur, dejaPrises, mention],
  )

  return (
    <ChampRecherche
      valeur={valeur}
      surChoix={(s) => surChoix(s.charge as RefTrouvee)}
      chercher={chercher}
      cleCache={['catalogue', fournisseur ?? '', dejaPrises?.size ?? 0]}
      placeholder={placeholder ?? 'Tapez une référence…'}
      aide={aide ?? 'Flèches pour parcourir, Entrée pour retenir.'}
      surAucun={surAucun}
      autoFocus={autoFocus}
      className={className}
      desactive={desactive}
      erreur={erreur}
      ariaLabel={ariaLabel ?? 'Référence'}
    />
  )
}

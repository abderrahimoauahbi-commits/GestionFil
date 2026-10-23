/**
 * LES INVENTAIRES OUVERTS ET CE QU'ILS GELENT (decisions du 23/10/2026).
 * Lus par les ecrans qui ecrivent du stock ; le bandeau est dans
 * composants/AvisInventaireOuvert.tsx. La base refuse de toute facon
 * (INVENTAIRE-OUVERT, migrations 2026-10-23g et 2026-10-24a) : ceci n'est que
 * l'avertissement.
 *
 * L'ETENDUE DU GEL SUIT LE TYPE (2026-10-24a, meme regle que la base) :
 *   - GLOBAL : tout le magasin — le gel touche la saisie des le choix du magasin ;
 *   - TOURNANT, CIBLE : les seules references de l'inventaire (ses lignes) dans
 *     son magasin — le gel ne touche la saisie que si une ligne porte l'une
 *     d'elles. Un tournant ou un cible encore sans ligne gele tout le magasin.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface InventaireOuvert {
  id_inventaire: string
  numero_inventaire: string
  code_magasin: string
  magasin_nom: string | null
  statut: string
  type_inventaire: string
  /** MAGASIN : tout le magasin ; REFERENCES : les seules `references_gelees`. */
  etendue_gel: 'MAGASIN' | 'REFERENCES'
  references_gelees: string[]
}

/** Un gel qui touche la saisie : l'inventaire, et les references saisies qu'il gele. */
export interface Gel extends InventaireOuvert {
  /** Les references saisies que l'inventaire gele (vide pour un gel du magasin entier). */
  touchees?: string[]
}

/** Une ligne saisie : le magasin ou elle ecrit, et sa reference. */
export interface LigneGel {
  magasin: string | null | undefined
  reference: string | null | undefined
}

export function useInventairesOuverts() {
  return useQuery({
    queryKey: ['inventaires', 'ouverts'],
    queryFn: ({ signal }) => api.get<InventaireOuvert[]>('/api/inventaires/ouverts', { signal }),
    staleTime: 10_000,
  })
}

/**
 * LES GELS QUI TOUCHENT UNE SAISIE. Un gel du magasin entier touche des que son
 * magasin est parmi `magasins` ; un gel par reference, seulement si une ligne de
 * ce magasin porte l'une de ses references.
 */
export function gelsTouches(
  inventaires: InventaireOuvert[],
  magasins: (string | null | undefined)[],
  lignes: LigneGel[] = [],
): Gel[] {
  const voulus = new Set(magasins.filter(Boolean))
  const res: Gel[] = []
  for (const i of inventaires) {
    if (i.etendue_gel !== 'REFERENCES') {
      if (voulus.has(i.code_magasin)) res.push({ ...i, touchees: [] })
      continue
    }
    const gelees = new Set(i.references_gelees ?? [])
    const touchees = [
      ...new Set(
        lignes
          .filter((l) => l.magasin === i.code_magasin && !!l.reference && gelees.has(l.reference))
          .map((l) => l.reference as string),
      ),
    ].sort()
    if (touchees.length > 0) res.push({ ...i, touchees })
  }
  return res
}

/** Les gels qui touchent la saisie en cours (magasins choisis, lignes saisies). */
export function useGelInventaire(magasins: (string | null | undefined)[], lignes: LigneGel[] = []): Gel[] {
  const q = useInventairesOuverts()
  const cleMagasins = magasins.filter(Boolean).join('|')
  const cleLignes = JSON.stringify(lignes.map((l) => [l.magasin ?? '', l.reference ?? '']))
  return useMemo(() => {
    const lues = (JSON.parse(cleLignes) as [string, string][]).map(([magasin, reference]) => ({ magasin, reference }))
    return gelsTouches(q.data ?? [], cleMagasins ? cleMagasins.split('|') : [], lues)
  }, [q.data, cleMagasins, cleLignes])
}

const TYPE: Record<string, string> = { GLOBAL: 'global', TOURNANT: 'tournant', CIBLE: 'ciblé' }

function liste(refs: string[]): string {
  const vues = refs.slice(0, 3).join(', ')
  return refs.length > 3 ? `${vues} et ${refs.length - 3} autre(s)` : vues
}

/** La phrase du gel, pour un bandeau ou la raison d'un bouton desactive. */
export function phraseGel(inventaires: Gel[], nommer = false): string | null {
  if (inventaires.length === 0) return null
  return inventaires
    .map((i) => {
      const ou = nommer ? `le magasin ${i.magasin_nom ?? i.code_magasin}` : 'ce magasin'
      const nom = `Inventaire ${i.numero_inventaire} (${TYPE[i.type_inventaire] ?? i.type_inventaire.toLowerCase()})`
      if (i.etendue_gel !== 'REFERENCES') {
        const sansLigne = i.type_inventaire !== 'GLOBAL' ? ', encore sans référence choisie,' : ''
        return `${nom} ouvert sur ${ou}${sansLigne} : aucun mouvement jusqu’à sa clôture.`
      }
      const refs = i.touchees ?? []
      if (refs.length === 0)
        return `${nom} ouvert sur ${ou} : les ${i.references_gelees.length} référence(s) de sa liste y sont gelées jusqu’à sa clôture ; les autres bougent librement.`
      return refs.length === 1
        ? `${nom} ouvert sur ${ou} : la référence ${refs[0]} y est gelée jusqu’à sa clôture.`
        : `${nom} ouvert sur ${ou} : les références ${liste(refs)} y sont gelées jusqu’à sa clôture.`
    })
    .join(' ')
}

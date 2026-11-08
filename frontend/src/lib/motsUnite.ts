/**
 * LE MOT DU CONDITIONNEMENT (06/11, 07/11/2026).
 *
 * Une reference ne se compte pas toujours en bobines : rouleaux, futs, sacs,
 * box, cuves… Le mot vient du conditionnement de sa fiche article
 * (`conditionnement.unite_singulier` / `unite_pluriel`, reglables dans
 * Configuration) ; a defaut, « bobine », le cas historique du fil.
 *
 * Les calculs ne changent pas : le compte s'appelle toujours `bobines` dans le
 * code et la base (« unites » du conditionnement) ; seul ce qu'on LIT change.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/** Les mots d'un conditionnement, prets a ecrire. */
export interface Mots {
  /** « bobine », « fût », « sac »… */
  un: string
  /** « bobines », « fûts », « sacs »… */
  des: string
  /** Le meme, avec une majuscule : en-tete, libelle de champ. */
  Un: string
  Des: string
  /** La forme courte d'une case etroite : « bob. », « fût », « sac ». */
  court: string
  /** Le pluriel anglais du document fournisseur : BOBBINS, DRUMS, BAGS… */
  anglais: string
  /** Faux pour le vrac : il se pese, il ne se compte pas. */
  seCompte: boolean
}

/** Ce qu'un conditionnement dit de lui (GET /api/conditionnements/mots). */
export interface MotsBruts {
  code_conditionnement?: string | null
  unite_singulier?: string | null
  unite_pluriel?: string | null
  se_compte?: number | null
}

const ANGLAIS: Record<string, string> = {
  BOBINE: 'BOBINS',
  ROULEAU: 'ROLLS',
  ROULEAU_PETIT: 'ROLLS',
  FUT: 'DRUMS',
  CUVE: 'IBC',
  SAC: 'BAGS',
  BOX: 'BOXES',
  CONTENEUR: 'CONTAINERS',
  VRAC: 'UNITS',
}

const majuscule = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** Les mots d'un conditionnement ; sans conditionnement, ceux de la bobine. */
export function motsDe(c?: MotsBruts | null): Mots {
  const un = (c?.unite_singulier ?? '').trim() || 'bobine'
  const des = (c?.unite_pluriel ?? '').trim() || (un === 'bobine' ? 'bobines' : `${un}s`)
  const code = (c?.code_conditionnement ?? '').trim().toUpperCase()
  return {
    un,
    des,
    Un: majuscule(un),
    Des: majuscule(des),
    court: un.length <= 5 ? un : `${un.slice(0, 3)}.`,
    anglais: ANGLAIS[code] ?? (code ? des.toUpperCase() : 'BOBINS'),
    seCompte: c?.se_compte == null ? true : Number(c.se_compte) === 1,
  }
}

/** Les mots de la bobine : le defaut. */
export const MOTS_BOBINE: Mots = motsDe(null)

/** Les mots communs a plusieurs lignes : les leurs s'ils sont tous les memes, sinon « unités ». */
export function motsCommuns(liste: Mots[]): Mots {
  if (liste.length === 0) return MOTS_BOBINE
  const premier = liste[0]
  return liste.every((m) => m.un === premier.un)
    ? premier
    : { ...premier, un: 'unité', des: 'unités', Un: 'Unité', Des: 'Unités', court: 'u.', anglais: 'UNITS' }
}

/** Le libelle d'une unite de saisie : « Bobine » devient le mot du conditionnement. */
export function libelleUnite(unite: string, m: Mots): string {
  return unite === 'Bobine' ? m.Un : unite
}

/**
 * LES MOTS DE CHAQUE REFERENCE, lus une fois (cent et quelques lignes) :
 * `motsDeReference(code)` rend ceux de sa fiche article, la bobine a defaut.
 */
export function useMotsUnite(): (codeReference: string | null | undefined) => Mots {
  const q = useQuery({
    queryKey: ['conditionnements-mots'],
    queryFn: ({ signal }) =>
      api.get<(MotsBruts & { code_reference: string })[]>('/api/conditionnements/mots', { signal }),
    staleTime: 5 * 60_000,
  })
  const parRef = new Map((q.data ?? []).map((r) => [r.code_reference, motsDe(r)]))
  return (code) => (code ? parRef.get(code) : undefined) ?? MOTS_BOBINE
}

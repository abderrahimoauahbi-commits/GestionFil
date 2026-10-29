/**
 * LE CHOIX D'UNE VALEUR DANS UNE LISTE QUI GRANDIT — un seul composant pour
 * toute l'application (24/10/2026).
 *
 * POURQUOI. Fournisseurs, lots, bons, OF, receptions se choisissaient dans des
 * `<select>` charges en entier : cinq cents lignes qu'on fait defiler, que le
 * serveur coupait sans le dire, et qu'aucun clavier ne fouille. Ici on TAPE :
 * le serveur cherche (`/api/recherche/{type}`), rend quelques lignes, et dit
 * s'il en reste — la liste invite alors a affiner.
 *
 * CE QU'IL MONTRE. « code — libelle », et UNE information utile a la decision
 * au moment ou l'on choisit : les kilos et la date d'un lot, ce qui reste a
 * recevoir d'un bon, la qualite et le statut d'un OF.
 *
 * CE QU'IL NE FAIT PAS. Il ne cree rien : creer un fournisseur ou un lot est
 * une operation metier, qui a son ecran. Les petites listes fixes (magasin,
 * devise, unite, motif, statut) restent des listes simples.
 *
 * Au clavier : on tape, ↑/↓ parcourent, Entree retient, Echap ferme ; le
 * moteur est celui de `ChampRecherche`, partage avec la saisie des references.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { libelleLot } from '../lib/lots'
import { fmt } from '../lib/utils'
import { ChampRecherche, type Resultat, type Suggestion } from './ChampRecherche'

/** Les types que le serveur sait chercher (backend/src/routes/recherche.rs). */
export type TypeChoix =
  | 'fournisseur'
  | 'reference'
  | 'reference-en-stock'
  | 'lot'
  | 'bc'
  | 'ligne-bc'
  | 'of'
  | 'qualite'
  | 'reception'
  | 'type-frais'

/** Une ligne rendue par le serveur : ses colonnes, telles quelles (masquage fait). */
export type LigneChoix = Record<string, unknown>

/** La reponse de `/api/recherche/{type}`. */
export interface ReponseRecherche<L = LigneChoix> {
  lignes: L[]
  total: number
  plus: boolean
  limite: number
}

export type FiltresChoix = Record<string, string | string[] | null | undefined>

const STATUTS: Record<string, string> = {
  BROUILLON: 'brouillon',
  EN_CONTROLE: 'en contrôle',
  DEMANDE_PRIX: 'demande de prix',
  EN_ATTENTE_VALIDATION: 'à valider',
  A_CONTROLER: 'à contrôler',
  VALIDE: 'validé',
  ENVOYE: 'envoyé',
  LIVRE_PARTIEL: 'livré en partie',
  CLOTURE: 'clôturé',
  ANNULE: 'annulé',
  PREVU: 'prévu',
  LANCE: 'lancé',
  TERMINE: 'terminé',
  ACTIVE: 'active',
  EN_COURS: 'en cours',
}
const statut = (s: unknown) => (s ? (STATUTS[String(s)] ?? String(s).toLowerCase()) : '')
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const kg = (v: unknown) => (typeof v === 'number' ? `${fmt.nombre(v, 0)} kg` : '')
const tiret = (code: unknown, libelle: unknown) =>
  libelle && String(libelle) !== String(code) ? `${txt(code)} — ${txt(libelle)}` : txt(code)

interface DefChoix {
  /** La colonne qui porte la valeur retenue. */
  cle: string
  /** « code — libelle ». */
  titre: (l: LigneChoix) => string
  /** L'information utile a la decision, en retrait. */
  info?: (l: LigneChoix) => string | undefined
  /** Une mention a droite, et son ton. */
  mention?: (l: LigneChoix) => { texte: string; ton?: Suggestion['ton'] } | null
  aucun: string
  placeholder: string
  aideFrappe: string
}

/** CE QUE CHAQUE TYPE MONTRE — un seul endroit, pour tous les ecrans. */
export const CHOIX: Record<TypeChoix, DefChoix> = {
  fournisseur: {
    cle: 'code_fournisseur',
    titre: (l) => tiret(l.code_fournisseur, l.nom),
    info: (l) => [l.ville, l.pays, l.code_devise].filter(Boolean).join(' · ') || undefined,
    mention: (l) => (l.actif === 0 ? { texte: 'désactivé', ton: 'alerte' } : null),
    aucun: 'Aucun fournisseur ne correspond',
    placeholder: 'Tapez un fournisseur…',
    aideFrappe: 'Tapez au moins deux caractères — le code ou le nom du fournisseur.',
  },
  reference: {
    cle: 'code_reference',
    titre: (l) => tiret(l.code_reference, l.designation),
    info: (l) => [l.couleur, l.fournisseur_nom].filter(Boolean).join(' · ') || undefined,
    mention: (l) => (l.actif === 0 ? { texte: 'désactivée', ton: 'alerte' } : null),
    aucun: 'Aucune référence ne correspond',
    placeholder: 'Tapez une référence…',
    aideFrappe: 'Tapez au moins deux caractères — le code, la désignation ou la couleur.',
  },
  'reference-en-stock': {
    cle: 'code_reference',
    titre: (l) => tiret(l.code_reference, l.designation),
    info: (l) => (kg(l.quantite_kg) ? `${kg(l.quantite_kg)} en stock` : undefined),
    aucun: 'Aucune référence en stock ne correspond',
    placeholder: 'Tapez une référence en stock…',
    aideFrappe: 'Tapez au moins deux caractères — le code ou la désignation.',
  },
  lot: {
    cle: 'lot_fournisseur',
    titre: (l) => libelleLot(txt(l.lot_fournisseur)),
    info: (l) =>
      [
        kg(l.quantite_kg),
        l.date_premiere_entree ? `entré le ${fmt.date(l.date_premiere_entree)}` : '',
        l.date_peremption ? `périme le ${fmt.date(l.date_peremption)}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    aucun: 'Aucun lot ne correspond',
    placeholder: 'Tapez un lot…',
    aideFrappe: 'Tapez au moins deux caractères — le numéro du lot.',
  },
  bc: {
    cle: 'id_bc',
    titre: (l) => tiret(l.numero_bc, l.fournisseur_nom),
    info: (l) =>
      [statut(l.statut), typeof l.reste_kg === 'number' ? `reste ${kg(l.reste_kg)} à recevoir` : '',
        typeof l.nb_lignes === 'number' ? `${l.nb_lignes} ligne(s)` : '']
        .filter(Boolean)
        .join(' · ') || undefined,
    aucun: 'Aucun bon de commande ne correspond',
    placeholder: 'Tapez un numéro de bon…',
    aideFrappe: 'Tapez au moins deux caractères — le numéro du bon ou le fournisseur.',
  },
  'ligne-bc': {
    cle: 'id_ligne_bc',
    titre: (l) => `${txt(l.numero_bc)} · ${tiret(l.code_reference, l.designation)}`,
    info: (l) => (typeof l.reste_kg === 'number' ? `reste ${kg(l.reste_kg)} à recevoir` : undefined),
    aucun: 'Aucune ligne de bon ne correspond',
    placeholder: 'Tapez un bon ou une référence…',
    aideFrappe: 'Tapez au moins deux caractères — le numéro du bon ou la référence.',
  },
  of: {
    cle: 'id_of',
    titre: (l) => txt(l.numero),
    info: (l) => [l.qualite_nom ?? l.code_qualite, statut(l.statut)].filter(Boolean).join(' · ') || undefined,
    aucun: 'Aucun OF ne correspond',
    placeholder: 'Tapez un numéro d’OF ou une qualité…',
    aideFrappe: 'Tapez au moins deux caractères — le numéro de l’OF ou la qualité.',
  },
  qualite: {
    cle: 'code_qualite',
    titre: (l) => tiret(l.code_qualite, l.qualite_nom),
    info: (l) => (l.statut ? statut(l.statut) : undefined),
    mention: (l) => (l.a_recette === false ? { texte: 'sans recette', ton: 'alerte' } : null),
    aucun: 'Aucune qualité ne correspond',
    placeholder: 'Tapez une qualité…',
    aideFrappe: 'Tapez au moins deux caractères — le code ou le nom de la qualité.',
  },
  reception: {
    cle: 'id_reception',
    titre: (l) => tiret(l.numero_reception, l.fournisseur_nom),
    info: (l) =>
      [l.date_reception ? fmt.date(l.date_reception) : '', statut(l.statut), kg(l.kg_recus)]
        .filter(Boolean)
        .join(' · ') || undefined,
    aucun: 'Aucune réception ne correspond',
    placeholder: 'Tapez un numéro de réception ou un fournisseur…',
    aideFrappe: 'Tapez au moins deux caractères — le numéro, le fournisseur ou le BL.',
  },
  'type-frais': {
    cle: 'id_frais',
    titre: (l) => tiret(l.id_frais, l.libelle),
    info: (l) => [l.categorie, l.methode_repartition].filter(Boolean).map(String).join(' · ') || undefined,
    aucun: 'Aucun type de frais ne correspond',
    placeholder: 'Tapez un type de frais…',
    aideFrappe: 'Tapez au moins deux caractères — le code ou le libellé.',
  },
}

/** Les filtres en parametres d'URL : une liste se repete (`statut=A&statut=B`). */
function parametres(filtres: FiltresChoix | undefined, extra: [string, string][] = []) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtres ?? {})) {
    if (v === null || v === undefined || v === '') continue
    for (const x of Array.isArray(v) ? v : [v]) if (x !== '') p.append(k, x)
  }
  for (const [k, v] of extra) p.append(k, v)
  return p
}

/**
 * CHERCHER SANS LE COMPOSANT — pour un ecran qui doit relire une valeur, ou
 * prendre la premiere qui convient (`limite: 1`).
 */
export function chercherChoix<L = LigneChoix>(
  type: TypeChoix,
  options: {
    recherche?: string
    filtres?: FiltresChoix
    limite?: number
    /** Relire ces valeurs-la (le filtre par defaut ne s'applique pas). */
    valeurs?: string[]
    exclure?: string[]
    /** Lever le filtre par defaut (actifs, ouverts, en stock). */
    tous?: boolean
    signal?: AbortSignal
  } = {},
): Promise<ReponseRecherche<L>> {
  const extra: [string, string][] = []
  if (options.recherche?.trim()) extra.push(['recherche', options.recherche.trim()])
  if (options.limite) extra.push(['limite', String(options.limite)])
  for (const v of options.valeurs ?? []) extra.push(['valeur', v])
  for (const v of options.exclure ?? []) extra.push(['exclure', v])
  if (options.tous) extra.push(['tous', '1'])
  return api.get<ReponseRecherche<L>>(`/api/recherche/${type}?${parametres(options.filtres, extra)}`, {
    signal: options.signal,
  })
}

/** La ligne d'UNE valeur, relue par sa cle (pour afficher ce qui est deja choisi). */
export function useLigneChoix(type: TypeChoix, valeur: string | null | undefined, filtres?: FiltresChoix) {
  return useQuery({
    queryKey: ['choix-ligne', type, valeur ?? '', JSON.stringify(filtres ?? {})],
    queryFn: async ({ signal }) =>
      (await chercherChoix(type, { valeurs: [valeur!], filtres, signal })).lignes[0] ?? null,
    enabled: !!valeur,
    staleTime: 60_000,
  })
}

/** Une option d'une liste deja chargee (mode local). */
export interface OptionChoix {
  valeur: string
  libelle: string
  info?: string
}

/** Sans accent ni casse : « categorie » trouve « Catégorie ». */
const plat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Le filtre local, meme regle que le serveur : chaque mot, n'importe ou. */
export function filtrerOptions(options: OptionChoix[], motif: string, limite = 20) {
  const mots = plat(motif).split(/\s+/).filter(Boolean)
  const trouvees = options.filter((o) => {
    const t = plat(`${o.valeur} ${o.libelle} ${o.info ?? ''}`)
    return mots.every((m) => t.includes(m))
  })
  return { lignes: trouvees.slice(0, limite), total: trouvees.length, plus: trouvees.length > limite }
}

export function ChoixRecherche({
  type,
  options,
  valeur,
  onChange,
  libelle,
  filtres,
  exclure,
  supplements,
  vide,
  id,
  ariaLabel,
  placeholder,
  invalide,
  desactive,
  className,
  autoFocus,
  limite = 20,
  classeChamp,
}: {
  /** Le type cherche par le serveur… */
  type?: TypeChoix
  /**
   * …ou une liste DEJA CHARGEE par l'ecran (les valeurs presentes dans ses
   * lignes, pour un filtre) : meme champ, meme clavier, filtre local.
   */
  options?: OptionChoix[]
  /** La valeur retenue, ou ''. */
  valeur: string
  /** La valeur et la ligne entiere (null pour une option locale, un supplement ou l'effacement). */
  onChange: (valeur: string, ligne: LigneChoix | null) => void
  /** Le libelle de la valeur courante, s'il est deja connu (evite une relecture). */
  libelle?: string | null
  /** Les filtres du type : `{ code_fournisseur }`, `{ statut: ['BROUILLON'] }`… */
  filtres?: FiltresChoix
  /** Valeurs a ne pas proposer. */
  exclure?: string[]
  /** Des choix ajoutes en fin de liste : « Sans lot », « Autre lot… ». */
  supplements?: OptionChoix[]
  /**
   * Le choix est FACULTATIF : ce texte s'affiche quand rien n'est choisi
   * (« Tous les fournisseurs », « Un nouveau bon »), et une croix efface.
   */
  vide?: string
  id?: string
  ariaLabel?: string
  placeholder?: string
  invalide?: boolean
  desactive?: boolean
  className?: string
  autoFocus?: boolean
  limite?: number
  /** Hauteur et taille du texte du champ (voir `classeDuChamp`). */
  classeChamp?: string
}) {
  const def = type ? CHOIX[type] : undefined
  const optionsCle = useMemo(() => JSON.stringify(options?.map((o) => o.valeur) ?? null), [options])
  const filtresCle = JSON.stringify(filtres ?? {})
  const exclureCle = (exclure ?? []).join('\u0001')
  const supplementsCle = JSON.stringify(supplements ?? [])

  // LA VALEUR DEJA CHOISIE SE RELIT par sa cle quand l'ecran n'en a pas le libelle.
  const relue = useLigneChoix(
    type ?? 'fournisseur',
    type && valeur && !libelle && !supplements?.some((s) => s.valeur === valeur) ? valeur : null,
    filtres,
  )
  const affichage = !valeur
    ? ''
    : (libelle ??
      supplements?.find((s) => s.valeur === valeur)?.libelle ??
      options?.find((o) => o.valeur === valeur)?.libelle ??
      (relue.data && def ? def.titre(relue.data) : valeur))

  const chercher = useMemo(
    () =>
      async (motif: string): Promise<Resultat> => {
        const extras: Suggestion[] = (supplements ?? []).map((s) => ({
          valeur: s.valeur,
          titre: s.libelle,
          detail: s.info,
        }))
        if (options) {
          const r = filtrerOptions(options, motif, limite)
          return {
            suggestions: [
              ...r.lignes.map((o) => ({ valeur: o.valeur, titre: o.libelle, detail: o.info })),
              ...extras,
            ],
            plus: r.plus,
            total: r.total,
          }
        }
        if (!type || !def) return { suggestions: extras }
        const r = await chercherChoix(type, { recherche: motif, filtres, exclure, limite })
        return {
          suggestions: [
            ...r.lignes.map((l) => {
              const m = def.mention?.(l)
              return {
                valeur: txt(l[def.cle]),
                titre: def.titre(l),
                detail: def.info?.(l),
                mention: m?.texte,
                ton: m?.ton,
                charge: l,
              }
            }),
            ...extras,
          ],
          plus: r.plus,
          total: r.total,
        }
      },
    // Les cles textuelles suffisent : un nouvel objet de meme contenu ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, optionsCle, filtresCle, exclureCle, supplementsCle, limite],
  )

  return (
    <ChampRecherche
      valeur={affichage}
      surChoix={(s) => onChange(s.valeur, (s.charge as LigneChoix | undefined) ?? null)}
      chercher={chercher}
      cleCache={['choix', type ?? 'local', optionsCle, filtresCle, exclureCle, supplementsCle, limite]}
      chercherAVide
      placeholder={affichage || vide || placeholder || def?.placeholder || 'Tapez pour chercher…'}
      aideFrappe={def?.aideFrappe ?? 'Tapez au moins deux caractères.'}
      messageAucun={def?.aucun ?? 'Aucun choix ne correspond'}
      aide="Flèches pour parcourir, Entrée pour retenir, Échap pour fermer."
      surEffacer={vide !== undefined ? () => onChange('', null) : undefined}
      libelleEffacer={vide ? `Effacer : ${vide}` : undefined}
      id={id}
      ariaLabel={ariaLabel}
      erreur={invalide}
      desactive={desactive}
      className={className}
      autoFocus={autoFocus}
      classeChamp={classeChamp}
    />
  )
}

/**
 * CE QUE LA CLASSE D'UN ANCIEN `<select>` DIT DU CHAMP LUI-MEME : sa hauteur et
 * son texte (un ecran tactile le voulait a 48 px). Le reste — largeur, marges —
 * vaut pour l'enveloppe ; le rembourrage, lui, appartient au champ de recherche
 * (son loupe a gauche), et ne se recopie pas.
 */
export const classeDuChamp = (className?: string) =>
  (className ?? '')
    .split(/\s+/)
    .filter((c) => /^(min-h-|h-|text-\[|text-(xs|sm|base|lg)$|font-mono$)/.test(c))
    .join(' ') || undefined

/**
 * …ET CE QU'ELLE DIT DE L'ENVELOPPE : largeur, marges, place dans la grille. Le
 * cadre (bordure, fond, rembourrage, texte) est celui du champ de recherche :
 * recopie sur l'enveloppe, il dessinerait une boite autour de la boite.
 */
export const classeEnveloppe = (className?: string) =>
  (className ?? '')
    .split(/\s+/)
    .filter((c) => c && !/^(border|bg-|rounded|p[xytrbl]?-|text-|font-|min-h-|h-|focus|outline|shadow|ring)/.test(c))
    .join(' ') || undefined

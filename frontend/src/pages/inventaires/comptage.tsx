/**
 * LE COMPTAGE D'UN INVENTAIRE, commun a sa page (13/10/2026) : les lignes,
 * leur saisie (kilos, bobines, palettes, motif), les calculs a la frappe, et
 * le lot trouve au comptage. Sorti de l'ancien ecran a liste et lignes sur la
 * meme page.
 */
import { useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ErreurApi } from '../../api/client'
import { Alerte, Badge, Bouton, Carte, CarteCorps, Champ, Chargement, EtatVide, Selecteur } from '../../composants/ui/base'
import { Aide } from '../../composants/ui/surcouches'
import { cn, fmt } from '../../lib/utils'
import { SANS_LOT, couleurEcart, libelleLot, useTolerancesLot } from '../../lib/lots'
import { lireNombre } from '../../lib/nombres'
import { type Conditionnement, conditionnementDuLot } from '../../lib/conditionnement'

export const MODULE = 'INVENTAIRE'

/** Une ligne telle que `GET /api/inventaires/:id/lignes` la renvoie. */
export interface LigneInv extends Record<string, unknown> {
  id_ligne_inv: string
  code_reference: string
  designation: string | null
  code_magasin: string
  lot_fournisseur: string | null
  /** Le derive compte (06/11/2026) : une ligne par derive quand le lot en a plusieurs. */
  code_derive?: string | null
  /** Pose par l'ecran (`marquerPlusieursDerives`) : une autre ligne du lot porte un autre derive. */
  plusieurs_derives?: boolean
  quantite_theorique_kg: number
  quantite_comptee_kg: number | null
  ecart_kg: number | null
  ecart_pct: number | null
  motif_ecart: string | null
  statut_ligne: string
  nb_bobines_theorique: number | null
  nb_bobines_comptees: number | null
  nb_palettes_comptees: number | null
  poids_unitaire_theorique_kg: number | null
  /** Le conditionnement de la fiche article. */
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  /** Le conditionnement du lot de la ligne (2026-10-24a) ; nul : la fiche article. */
  poids_bobine_lot_kg?: number | null
  bobines_par_palette_lot?: number | null
  categorie_libelle: string | null
}

/**
 * LA TOLERANCE AU-DELA DE LAQUELLE UN MOTIF DEVIENT OBLIGATOIRE.
 *
 * Elle etait codee en dur a 2 % ici, alors que la cloture, cote serveur, lit
 * `P_TolerEcartPesee` : la direction pouvait la changer sans que l'ecran le
 * sache, et l'on voyait « requis » la ou le serveur n'exigeait rien — ou
 * l'inverse, qui ne se decouvrait qu'au refus de la cloture. On lit donc le
 * meme reglage, avec le meme defaut que la graine.
 */
export function useToleranceMotif() {
  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: () =>
      api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres'),
    staleTime: 5 * 60_000,
  })
  const p = q.data?.find((x) => x.code_parametre === 'P_TolerEcartPesee')
  const n = p ? Number(p.valeur_courante) : NaN
  return Number.isFinite(n) ? n : 2
}

// --- La saisie d'une ligne -------------------------------------------------

/** Ce qu'on tape sur une ligne : des chaines, comme les champs. */
export interface Saisie {
  kg: string
  bobines: string
  palettes: string
  motif: string
}

type ChampSaisie = keyof Saisie

/** Un nombre lu dans un champ : vide = null, illisible = NaN. */
function lire(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  return (lireNombre(t) ?? 0)
}

const nombre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const positif = (v: unknown): number | null => {
  const n = nombre(v)
  return n !== null && n > 0 ? n : null
}

/**
 * LE CONDITIONNEMENT D'UNE LIGNE (2026-10-24a) : celui de son lot, sinon de la
 * fiche article — jamais un facteur 1. Meme regle que le serveur au comptage
 * (`fn_lot_poids_bobine`) ; le controle de colisage C43 et la derive d'un lot,
 * eux, restent au poids de la fiche.
 */
function conditionnementLigne(l: LigneInv): Conditionnement {
  return conditionnementDuLot(
    { poids_bobine_kg: positif(l.poids_bobine_kg), bobines_par_palette: positif(l.bobines_par_palette) },
    l.lot_fournisseur
      ? {
          // UN LOT EN PLUSIEURS DERIVES (06/11/2026) : le poids d'une unite DU
          // DERIVE de la ligne, que le serveur y a pose (`fn_derive_poids_unitaire`).
          poids_bobine_kg: (l.plusieurs_derives && positif(l.poids_unitaire_theorique_kg)) || l.poids_bobine_lot_kg,
          bobines_par_palette: l.bobines_par_palette_lot,
        }
      : null,
  )
}

const versChamp = (v: unknown) => {
  const n = nombre(v)
  return n === null ? '' : String(n)
}

/** La ligne telle que le serveur la connait, exprimee comme une saisie. */
export const saisieServeur = (l: LigneInv): Saisie => ({
  kg: l.quantite_comptee_kg == null ? '' : versChamp(l.quantite_comptee_kg),
  bobines: versChamp(l.nb_bobines_comptees),
  palettes: versChamp(l.nb_palettes_comptees),
  motif: l.motif_ecart ?? '',
})

/**
 * L'EMPREINTE D'UNE SAISIE : ce qui partirait au serveur, normalise. « 12 »,
 * « 12,0 » et « 12.00 » ont la meme. Une ligne n'est MODIFIEE que si son
 * empreinte differe de celle de la ligne chargee — retaper la meme valeur ne
 * marque rien.
 */
export const empreinte = (s: Saisie) =>
  JSON.stringify([lire(s.kg), lire(s.bobines), lire(s.palettes), s.motif.trim() || null])

const arrondi = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

/** Tout ce que l'ecran calcule d'une ligne a partir de sa saisie. */
interface Analyse {
  theoriqueKg: number
  /** Les kilos qui partiront : saisis, ou a defaut deduits des bobines. */
  kg: number | null
  kgDeduit: boolean
  bobines: number | null
  palettes: number | null
  ecartKg: number | null
  ecartPct: number | null
  /** Le poids d'une bobine qui convertit : du lot, sinon de la fiche article. */
  poidsTheorique: number | null
  /** D'ou vient ce poids. */
  poidsSource: 'lot' | 'fiche' | null
  poidsReel: number | null
  poidsPct: number | null
  motifRequis: boolean
  erreurs: string[]
}

/**
 * `enSaisie` : l'inventaire est en brouillon et l'on compte. Le poids d'une
 * bobine est alors celui du lot AUJOURD'HUI, celui que le serveur figera sur la
 * ligne a l'enregistrement ; hors saisie, celui que la ligne a fige.
 */
export function analyser(l: LigneInv, s: Saisie, tolMotif: number, enSaisie = false): Analyse {
  const erreurs: string[] = []
  const theoriqueKg = nombre(l.quantite_theorique_kg) ?? 0
  const vivant = positif(conditionnementLigne(l).poids_bobine_kg)
  const poidsTheorique = (enSaisie ? vivant : null) ?? positif(l.poids_unitaire_theorique_kg) ?? vivant
  const poidsLot = l.lot_fournisseur
    ? ((l.plusieurs_derives && positif(l.poids_unitaire_theorique_kg)) || positif(l.poids_bobine_lot_kg))
    : null
  const poidsSource: Analyse['poidsSource'] =
    poidsTheorique === null ? null : poidsLot !== null && poidsLot === poidsTheorique ? 'lot' : 'fiche'

  const kgLu = lire(s.kg)
  const bobLu = lire(s.bobines)
  const palLu = lire(s.palettes)

  let kgSaisi: number | null = null
  if (kgLu !== null) {
    if (!Number.isFinite(kgLu) || kgLu < 0) erreurs.push('kilos illisibles')
    else kgSaisi = kgLu
  }
  let bobines: number | null = null
  if (bobLu !== null) {
    if (!Number.isFinite(bobLu) || bobLu < 0 || !Number.isInteger(bobLu))
      erreurs.push('bobines : un nombre entier')
    else bobines = bobLu
  }
  let palettes: number | null = null
  if (palLu !== null) {
    if (!Number.isFinite(palLu) || palLu < 0) erreurs.push('palettes illisibles')
    else palettes = arrondi(palLu, 2)
  }

  /* ON COMPTE DES BOBINES, PAS DES KILOS. Quand l'allee ne rapporte que des
     bobines, le bureau convertit au poids d'une bobine DU LOT, sinon de la
     fiche article (2026-10-24a) — c'est ce que la feuille
     de comptage prevoit. Le poids est alors une deduction, et l'ecran le dit. */
  const kgDeduit = kgSaisi === null && bobines !== null && poidsTheorique !== null
  const kg = kgSaisi ?? (kgDeduit ? arrondi(bobines! * poidsTheorique!, 2) : null)

  const ecartKg = kg === null ? null : kg - theoriqueKg
  // Meme formule que la colonne generee `ligne_inventaire.ecart_pct`.
  const ecartPct = ecartKg === null || theoriqueKg === 0 ? null : (ecartKg / theoriqueKg) * 100
  // UN THEORIQUE NUL N'A PAS DE POURCENTAGE, mais trouver du stock la ou il n'y en
  // avait pas est un ecart qui s'explique (regle 10) : meme condition que le
  // serveur a la cloture, sinon l'ecran ne demande rien et la cloture refuse.
  const motifRequis =
    (ecartPct !== null && Math.abs(ecartPct) > tolMotif) || (theoriqueKg === 0 && kg !== null && kg > 0)

  const poidsReel = kgSaisi !== null && bobines !== null && bobines > 0 ? kgSaisi / bobines : null
  const poidsPct =
    poidsReel !== null && poidsTheorique !== null
      ? ((poidsReel - poidsTheorique) / poidsTheorique) * 100
      : null

  if (kg === null && (bobines !== null || palettes !== null || s.motif.trim()))
    erreurs.push('kilos à saisir')
  if (motifRequis && !s.motif.trim()) erreurs.push('motif requis')

  return {
    theoriqueKg,
    kg,
    kgDeduit,
    bobines,
    palettes,
    ecartKg,
    ecartPct,
    poidsTheorique,
    poidsSource,
    poidsReel,
    poidsPct,
    motifRequis,
    erreurs,
  }
}

/** Une ligne prete a l'affichage : la donnee serveur, la saisie, les calculs. */
export interface LigneVue {
  ligne: LigneInv
  saisie: Saisie
  analyse: Analyse
  modifiee: boolean
}

// --- Le tableau de comptage --------------------------------------------------

type Filtre = 'TOUTES' | 'A_COMPTER' | 'ECARTS' | 'MODIFIEES'

/**
 * UNE LIGNE = UN LOT, les champs sur la ligne. Le tableau ne pagine pas : on
 * compte une allee, on ne feuillette pas. Il suit l'ordre du magasin que
 * renvoie le serveur (matiere, puis famille), avec un intertitre par matiere.
 *
 * Entree passe au meme champ de la ligne suivante : on descend la colonne
 * comme on descend l'allee.
 */
export function TableComptage({
  vues,
  chargement,
  erreur,
  saisissable,
  tolMotif,
  setBrouillon,
}: {
  vues: LigneVue[]
  chargement: boolean
  erreur: unknown
  saisissable: boolean
  tolMotif: number
  setBrouillon: Dispatch<SetStateAction<Record<string, Saisie>>>
}) {
  const tolLot = useTolerancesLot()
  const conteneur = useRef<HTMLDivElement>(null)
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('TOUTES')

  /**
   * BOBINES ET PALETTES SE REPONDENT, par les bobines par palette du lot,
   * sinon de la reference (2026-10-24a). Le champ qu'on vient de taper commande et ne revient jamais
   * corrige ; l'autre suit. Les kilos, eux, ne suivent pas : c'est la pesee,
   * et c'est justement leur ecart au poids d'une bobine qu'on veut voir.
   */
  const maj = (l: LigneInv, champ: ChampSaisie, valeur: string) =>
    setBrouillon((b) => {
      const courant = b[l.id_ligne_inv] ?? saisieServeur(l)
      const suivant: Saisie = { ...courant, [champ]: valeur }
      const parPalette = positif(conditionnementLigne(l).bobines_par_palette)
      const n = lire(valeur)
      if (parPalette !== null && (champ === 'bobines' || champ === 'palettes')) {
        const autre = champ === 'bobines' ? 'palettes' : 'bobines'
        // Vide vide l'autre ; illisible le laisse tel quel ; lisible le recalcule.
        if (n === null) suivant[autre] = ''
        else if (Number.isFinite(n) && n >= 0)
          suivant[autre] =
            champ === 'bobines'
              ? String(arrondi(n / parPalette, 2))
              : String(Math.round(n * parPalette))
      }
      return { ...b, [l.id_ligne_inv]: suivant }
    })

  const descendre = (e: KeyboardEvent<HTMLInputElement>, champ: ChampSaisie, rang: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    conteneur.current
      ?.querySelector<HTMLInputElement>(`[data-comptage="${champ}:${rang + 1}"]`)
      ?.focus()
  }

  const motif = recherche.trim().toLowerCase()
  const visibles = vues.filter((v) => {
    const l = v.ligne
    if (
      motif &&
      ![l.code_reference, l.designation, l.lot_fournisseur, libelleLot(l.lot_fournisseur)].some(
        (x) => x?.toLowerCase().includes(motif),
      )
    )
      return false
    // Les filtres lisent ce qui est ENREGISTRE (sauf « modifiées ») : une
    // ligne ne doit pas disparaitre sous les doigts pendant qu'on la saisit.
    switch (filtre) {
      case 'A_COMPTER':
        return l.statut_ligne === 'A_TRAITER'
      case 'ECARTS':
        return l.ecart_pct != null && Math.abs(Number(l.ecart_pct)) > tolMotif
      case 'MODIFIEES':
        return v.modifiee
      default:
        return true
    }
  })

  if (chargement) return <Chargement />
  if (erreur)
    return (
      <Alerte ton="danger">
        {erreur instanceof ErreurApi ? erreur.message : 'Lignes du comptage illisibles.'}
      </Alerte>
    )
  if (vues.length === 0)
    return (
      <EtatVide
        titre="Aucune ligne"
        description="Cet inventaire n'a pas de lignes à compter."
      />
    )

  const cellule = 'px-1.5 py-1 align-top'
  const champNombre = 'h-8 text-right tabular-nums'

  return (
    <Carte>
      <CarteCorps className="space-y-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Champ
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher une référence ou un lot..."
            aria-label="Chercher une référence ou un lot"
            className="w-72"
          />
          <Selecteur
            value={filtre}
            onChange={(e) => setFiltre(e.target.value as Filtre)}
            aria-label="Lignes affichées"
            className="w-56"
          >
            <option value="TOUTES">Toutes les lignes</option>
            <option value="A_COMPTER">Encore à compter</option>
            <option value="ECARTS">Écarts hors tolérance</option>
            <option value="MODIFIEES">Modifiées, non enregistrées</option>
          </Selecteur>
          {saisissable && (
            <span className="text-[11px] text-attenue-texte">
              Entrée descend à la ligne suivante. Bobines et palettes se répondent.
            </span>
          )}
        </div>

        {/* PAS DE DEFILEMENT HORIZONTAL (10/10/2026) : des colonnes resserrees au
            lieu d'une largeur plancher de 1 180 px qui debordait a 1366. */}
        <div ref={conteneur}>
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                <th className="px-1.5 py-2 text-left">Référence · lot</th>
                <th className="w-28 px-1.5 py-2 text-right">Théorique</th>
                <th className="w-28 px-1.5 py-2 text-right">Compté kg</th>
                <th className="w-20 px-1.5 py-2 text-right">Bobines</th>
                <th className="w-20 px-1.5 py-2 text-right">Palettes</th>
                <th className="w-24 px-1.5 py-2 text-right">Poids / bob.</th>
                <th className="w-20 px-1.5 py-2 text-right">Écart</th>
                <th className="w-56 px-1.5 py-2 text-left">
                  Motif
                  <Aide>
                    Obligatoire au-delà de {fmt.nombre(tolMotif, 1)} % d’écart (réglage
                    « Tolérance écart de pesée ») : la clôture le refuse sinon. Le poids par
                    bobine se colore selon les tolérances de lot ({fmt.nombre(tolLot.orange, 1)} %
                    / {fmt.nombre(tolLot.rouge, 1)} %).
                  </Aide>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-attenue-texte">
                    Aucune ligne ne correspond.
                  </td>
                </tr>
              )}
              {visibles.map((v, rang) => {
                const { ligne: l, saisie: s, analyse: a } = v
                const categorie = l.categorie_libelle ?? 'Sans catégorie'
                const precedente = rang > 0 ? (visibles[rang - 1].ligne.categorie_libelle ?? 'Sans catégorie') : null
                const bobTheo = nombre(l.nb_bobines_theorique)
                const parPalette = positif(conditionnementLigne(l).bobines_par_palette)
                const couleurPoids = couleurEcart(a.poidsPct, tolLot)
                const motifManquant = a.motifRequis && !s.motif.trim()
                return [
                  categorie !== precedente && (
                    <tr key={`cat-${rang}`} className="bg-attenue/40">
                      <td
                        colSpan={8}
                        className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte"
                      >
                        {categorie}
                      </td>
                    </tr>
                  ),
                  <tr
                    key={l.id_ligne_inv}
                    className={cn(
                      'border-b border-bordure/60',
                      v.modifiee && 'bg-primaire/[0.05]',
                      v.modifiee && a.erreurs.length > 0 && 'bg-danger/[0.05]',
                    )}
                  >
                    <td className={cn(cellule, 'min-w-0', v.modifiee && 'border-l-2 border-l-primaire')}>
                      <div className="truncate font-medium">{l.code_reference}</div>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-attenue-texte">
                        {l.lot_fournisseur && (
                          <span
                            className={cn(
                              'shrink-0 rounded-sm px-1',
                              l.lot_fournisseur === SANS_LOT ? 'italic' : 'bg-attenue font-mono',
                            )}
                          >
                            {l.lot_fournisseur === SANS_LOT
                              ? 'Sans lot'
                              : `lot ${l.lot_fournisseur}${l.plusieurs_derives && l.code_derive ? ` · ${l.code_derive}` : ''}`}
                          </span>
                        )}
                        {l.designation && <span className="truncate">{l.designation}</span>}
                      </div>
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right tabular-nums')}>
                      <div>{fmt.nombre(a.theoriqueKg, 2)} kg</div>
                      {bobTheo !== null && (
                        <div className="text-[11px] text-attenue-texte">
                          {fmt.entier(bobTheo)} bob.
                        </div>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          inputMode="decimal"
                          value={s.kg}
                          onChange={(e) => maj(l, 'kg', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'kg', rang)}
                          data-comptage={`kg:${rang}`}
                          placeholder={a.kgDeduit && a.kg !== null ? `≈ ${fmt.nombre(a.kg, 2)}` : 'à compter'}
                          aria-label={`Kilos comptés, ${l.code_reference}`}
                          aria-invalid={a.erreurs.some((x) => x.startsWith('kilos')) || undefined}
                          className={champNombre}
                        />
                      ) : (
                        <div className="pt-1 text-right tabular-nums">
                          {a.kg === null ? (
                            <span className="text-attenue-texte">à compter</span>
                          ) : (
                            fmt.nombre(a.kg, 2)
                          )}
                        </div>
                      )}
                      {a.kgDeduit && a.kg !== null && (
                        <div className="mt-0.5 text-right text-[11px] text-attenue-texte" title={a.poidsSource === 'lot' ? 'Bobines × poids d’une bobine du lot' : 'Bobines × poids d’une bobine de la fiche article'}>
                          déduit des bobines
                        </div>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          inputMode="numeric"
                          value={s.bobines}
                          onChange={(e) => maj(l, 'bobines', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'bobines', rang)}
                          data-comptage={`bobines:${rang}`}
                          placeholder="bob."
                          aria-label={`Bobines comptées, ${l.code_reference}`}
                          aria-invalid={a.erreurs.some((x) => x.startsWith('bobines')) || undefined}
                          className={champNombre}
                        />
                      ) : (
                        <div className="pt-1 text-right tabular-nums">
                          {a.bobines === null ? '—' : fmt.entier(a.bobines)}
                        </div>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          inputMode="decimal"
                          value={s.palettes}
                          onChange={(e) => maj(l, 'palettes', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'palettes', rang)}
                          data-comptage={`palettes:${rang}`}
                          placeholder="pal."
                          aria-label={`Palettes comptées, ${l.code_reference}`}
                          aria-invalid={a.erreurs.some((x) => x.startsWith('palettes')) || undefined}
                          className={champNombre}
                        />
                      ) : (
                        <div className="pt-1 text-right tabular-nums">
                          {a.palettes === null ? '—' : fmt.nombre(a.palettes, 2)}
                        </div>
                      )}
                      {parPalette !== null && (
                        <div className="mt-0.5 text-right text-[11px] text-attenue-texte">
                          {fmt.entier(parPalette)} bob./pal.
                        </div>
                      )}
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right text-[12px] tabular-nums')}>
                      {a.poidsReel === null ? (
                        <span
                          className="text-attenue-texte"
                          title={
                            a.poidsTheorique !== null
                              ? `${a.poidsSource === 'lot' ? 'Lot' : 'Fiche article'} : ${fmt.nombre(a.poidsTheorique, 3)} kg`
                              : 'Pas de poids de bobine (ni lot, ni fiche article)'
                          }
                        >
                          {a.poidsTheorique !== null ? `${a.poidsSource === 'lot' ? 'lot' : 'fiche'} ${fmt.nombre(a.poidsTheorique, 3)}` : '—'}
                        </span>
                      ) : (
                        <div
                          title={
                            a.poidsTheorique !== null
                              ? `${a.poidsSource === 'lot' ? 'Lot' : 'Fiche article'} : ${fmt.nombre(a.poidsTheorique, 3)} kg`
                              : 'Pas de poids de bobine (ni lot, ni fiche article)'
                          }
                        >
                          <div className="font-medium">{fmt.nombre(a.poidsReel, 3)} kg</div>
                          {a.poidsPct !== null && (
                            <div
                              className={cn(
                                'text-[11px]',
                                couleurPoids === 'rouge'
                                  ? 'text-danger'
                                  : couleurPoids === 'orange'
                                    ? 'text-alerte'
                                    : 'text-succes',
                              )}
                            >
                              {a.poidsPct > 0 ? '+' : ''}
                              {fmt.nombre(a.poidsPct, 2)} % / {a.poidsSource === 'lot' ? 'lot' : 'fiche'} {fmt.nombre(a.poidsTheorique, 3)}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right tabular-nums')}>
                      {a.ecartKg === null ? (
                        <span className="text-attenue-texte">—</span>
                      ) : (
                        <>
                          <div
                            className={cn(
                              a.ecartKg > 0 ? 'text-succes' : a.ecartKg < 0 ? 'text-danger' : '',
                            )}
                          >
                            {a.ecartKg > 0 ? '+' : ''}
                            {fmt.nombre(a.ecartKg, 2)} kg
                          </div>
                          {a.ecartPct !== null ? (
                            <Badge ton={a.motifRequis ? 'danger' : a.ecartPct === 0 ? 'neutre' : 'succes'}>
                              {a.ecartPct > 0 ? '+' : ''}
                              {fmt.nombre(a.ecartPct, 1)} %
                            </Badge>
                          ) : (
                            a.theoriqueKg === 0 &&
                            a.kg !== null &&
                            a.kg > 0 && <Badge ton="info">trouvé</Badge>
                          )}
                        </>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          value={s.motif}
                          onChange={(e) => maj(l, 'motif', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'motif', rang)}
                          data-comptage={`motif:${rang}`}
                          placeholder={a.motifRequis ? 'motif requis' : '—'}
                          aria-label={`Motif de l'écart, ${l.code_reference}`}
                          aria-invalid={motifManquant || undefined}
                          className="h-8"
                        />
                      ) : (
                        <div className="truncate pt-1">
                          {s.motif ? (
                            s.motif
                          ) : motifManquant ? (
                            <span className="text-danger">requis</span>
                          ) : (
                            <span className="text-attenue-texte">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </CarteCorps>
    </Carte>
  )
}

/**
 * UN LOT TROUVE AU COMPTAGE (01/10/2026).
 *
 * Le rayon porte un lot que la base ne connait pas — le plus souvent du stock
 * « sans lot » qu'on identifie enfin. On le saisit ici : le serveur lui ouvre
 * sa ligne au theorique zero, et la cloture fait entrer ce lot tout en
 * soldant ce qui ne se retrouve plus (comptez alors « Sans lot » a ce qui
 * reste vraiment). Seulement pour une reference suivie par lot.
 */
export function LotTrouve({
  magasin, references, enCours, ajouter,
}: {
  magasin: string
  references: string[]
  enCours: boolean
  ajouter: (c: { code_reference: string; lot_fournisseur: string; quantite_comptee_kg: number }) => Promise<unknown>
}) {
  const [ref, setRef] = useState('')
  const [lot, setLot] = useState('')
  const [kg, setKg] = useState('')
  const pret = !!ref.trim() && !!lot.trim() && (lireNombre(kg) ?? 0) >= 0 && kg.trim() !== ''
  const champ = 'h-8 rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[12.5px]'
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-dashed border-bordure bg-attenue/20 p-2">
      <div className="w-full text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
        Lot trouvé au comptage — magasin {magasin}
      </div>
      <input list="refs-inventaire" value={ref} onChange={(e) => setRef(e.target.value)}
        placeholder="Référence" aria-label="Référence du lot trouvé" className={cn(champ, 'w-64')} />
      <datalist id="refs-inventaire">
        {references.map((r) => <option key={r} value={r} />)}
      </datalist>
      <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="N° de lot"
        aria-label="Numéro du lot trouvé" className={cn(champ, 'w-44')} />
      <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" placeholder="Compté (kg)"
        aria-label="Quantité comptée en kilos" className={cn(champ, 'w-32 text-right')} />
      <Bouton taille="sm" className="h-8" disabled={!pret} chargement={enCours}
        onClick={async () => {
          await ajouter({ code_reference: ref.trim(), lot_fournisseur: lot.trim(), quantite_comptee_kg: (lireNombre(kg) ?? 0) })
          setLot('')
          setKg('')
        }}>
        Ajouter le lot
      </Bouton>
    </div>
  )
}

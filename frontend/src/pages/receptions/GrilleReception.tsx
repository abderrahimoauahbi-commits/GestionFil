/**
 * LA GRILLE DE SAISIE D'UNE RECEPTION — au bureau, la meme pour la nouvelle
 * reception et pour celle qu'on reprend (24/10/2026).
 *
 * LE MODELE DU BON DE COMMANDE (`GrilleLignes`) : la ligne se saisit SUR LA
 * LIGNE, plus dans un panneau a onglets sous le tableau. La rangee principale
 * porte ce qui identifie et ce qui se pese — reference et bon (reste a
 * livrer), quantite annoncee au BL, quantite pesee, unite, ecart — et les
 * cases facultatives (palettes et bobines, lot, magasin, qualite,
 * observations, colis) s'y ajoutent tant que la largeur MESUREE le permet
 * (`lib/rangeeAdaptative`). Ce qui n'y tient pas, et ce qui n'apparait qu'au
 * besoin (derogation et son motif, substitution, prix d'une ligne hors
 * commande), passe sur la rangee « ↳ », juste dessous.
 *
 * LES DEUX DATES (fabrication, peremption), rarement saisies, vivent dans le
 * DETAIL de la ligne (26/10/2026, « le milieu ») : une rangee depliee sous la
 * ligne, fermee par defaut, ouverte au clic sur la ligne ou sur son chevron.
 * Il montre aussi, en lecture, le bon, le reste, le prix engage et la date
 * promise. Une date saisie reste visible sur la ligne (« fab. 12/10 »).
 * Rien de ce qui part au serveur ne change : les memes champs, par `poser`.
 *
 * UNE GRILLE PROPRE A LA RECEPTION, au meme rendu que celle du bon : la
 * reception a ses colonnes (BL, ecart a la tolerance du fournisseur) et ses
 * regles de figement (au controle, la pesee est figee), que la grille du bon
 * n'a pas a connaitre.
 *
 * ELLE NE CALCULE RIEN DE METIER : chaque ecran lui donne ses lignes, deja
 * lues, et recoit chaque frappe par `poser`. Le lien kilos / palettes /
 * bobines, l'envoi au serveur et ce que vaut chaque champ restent a l'ecran
 * qui la porte.
 *
 * Sous 768 px, chaque ligne devient une carte ou tous les champs s'empilent :
 * aucun tableau a faire defiler lateralement.
 */
import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Check, ChevronRight, CopyPlus, Link2, Pencil, Trash2, Unlink2 } from 'lucide-react'
import { Badge, Bouton, Champ, Selecteur } from '../../composants/ui/base'
import { AvisColisage } from '../../composants/AvisColisage'
import { AvisDerive } from '../../composants/AvisDerive'
import type { Conditionnement } from '../../lib/conditionnement'
import { useEstMobile } from '../../lib/mediaQuery'
import { repartirCases, useLargeurConteneur } from '../../lib/rangeeAdaptative'
import { codesStatut, libelleStatut } from '../../lib/statuts'
import { cn, fmt } from '../../lib/utils'
import { useDerivesLot, type DeriveLot } from '../../lib/derives'
import { autreParPalette, formeDe, nouvelleForme, type Forme } from '../../lib/formeDerive'
import { useParametreNombre } from '../../lib/parametres'

/** Ce que l'ecran montre et laisse saisir d'une ligne de reception. */
export interface VueLigneRec {
  cle: string
  /** Absent : pas de case « retenue » (reception deja enregistree). */
  retenue?: boolean
  /** La reference COMMANDEE. */
  code_reference: string
  /** La reference REELLEMENT recue (substitution par un equivalent). */
  code_recu: string
  designation: string
  numero_bc: string | null
  /** Ce que la ligne de bon attend encore, en kilos ; null hors commande. */
  reste_kg: number | null
  retard_jours?: number | null
  en_cours_kg?: number | null
  en_cours_dans?: string | null
  suivi_lot: boolean
  qteBl: string
  /** La pesee, TOUJOURS en kilos. */
  qte: string
  unite: string
  /** Les unites d'archivage que la reference sait convertir, en plus du kilo. */
  unites: string[]
  /** L'unite choisie se convertit-elle ? Sinon la ligne partirait en kilos. */
  convertible: boolean
  palettes: string
  bobines: string
  lie: boolean
  /** Le bouton lier / detacher est-il offert (une reference suivie au lot se compte) ? */
  liaisonOfferte: boolean
  lot: string
  /** Le derive du lot qui entre (06/11/2026) : vide, le seul du lot. */
  codeDerive?: string
  /** Un NOUVEAU derive, confirme par la personne : il nait a la validation. */
  deriveNouveau?: boolean
  magasin: string
  qualite: string
  derogation: boolean
  motifDerogation: string
  fabrication: string
  peremption: string
  notes: string
  /** Colis annonces au BL pour cette ligne. */
  colis: string
  equivalents: string[]
  motif_substitution: string
  /** Prix au kilo, saisissable sur une ligne hors commande seulement. */
  prix?: string
  devise?: string | null
  /** LECTURE SEULE, pour le detail : le prix au kilo engage par le bon, dans sa devise. */
  prix_engage?: number | null
  /** LECTURE SEULE, pour le detail : la date de livraison promise par le bon (AAAA-MM-JJ). */
  date_promise?: string | null
  /** Le conditionnement qui relie kilos, palettes et bobines (celui du lot s'il est connu). */
  cond: Conditionnement
  /** Rang de la ligne precedente du meme lot (les pesees s'additionneront), ou 0. */
  rangMemeLot?: number
  /** La premiere ligne du meme lot dans cette reception, sa forme (07/11/2026) ; null : celle-ci. */
  premiereDuLot?: { kg: number | null; bobines: string; palettes: string; rang: number } | null
  /** Validation a l'ecran (reception existante) : absent = pas de bouton ✓. */
  valide?: boolean
}

export type ChampRec =
  | 'retenue'
  | 'qteBl'
  | 'qte'
  | 'palettes'
  | 'bobines'
  | 'unite'
  | 'lie'
  | 'lot'
  | 'codeDerive'
  | 'deriveNouveau'
  | 'magasin'
  | 'qualite'
  | 'derogation'
  | 'motifDerogation'
  | 'fabrication'
  | 'peremption'
  | 'notes'
  | 'colis'
  | 'code_recu'
  | 'motif_substitution'
  | 'prix'

/** Les statuts qualite d'une ligne, libelles de la table commune (lib/statuts). */
export const QUALITES = codesStatut('statut_qualite').map((valeur) => ({
  valeur,
  libelle: libelleStatut('statut_qualite', valeur),
}))

/** L'ecart de la pesee au reste attendu, en %, ou null sans terme de comparaison. */
export function ecartPct(qte: string, reste: number | null): number | null {
  const kg = qte.trim() === '' ? null : Number(qte)
  return reste && reste > 0 && kg != null && Number.isFinite(kg) ? ((kg - reste) / reste) * 100 : null
}

/**
 * LE VERDICT D'UNE LIGNE, en chiffre + couleur + mot. L'EXCEDENT SEUL exige une
 * derogation (C10, 08/10/2026) ; un manque est une livraison partielle.
 */
export function verdictEcart(e: number | null, tolerance: number) {
  if (e == null) return null
  if (e > tolerance) return { ton: 'danger' as const, mot: 'hors tolérance' }
  if (e < -tolerance) return { ton: 'alerte' as const, mot: 'partielle' }
  return { ton: 'succes' as const, mot: 'conforme' }
}

/** L'identifiant DOM de la rangee d'une ligne : la barre du bas y mene. */
export const idLigneRec = (cle: string) => `rec-ligne-${cle.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** Mener a une ligne (depuis un indicateur) : elle se centre, sa derogation prend le focus. */
export function allerALaLigne(cle: string) {
  const el = document.getElementById(idLigneRec(cle))
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const cible =
    document.querySelector<HTMLElement>(`[data-derogation="${idLigneRec(cle)}"]`) ??
    el.querySelector<HTMLElement>('input[aria-label="Quantité pesée, en kilos"]:not([disabled])')
  cible?.focus({ preventScroll: true })
}

export interface ProprietesGrilleRec {
  lignes: VueLigneRec[]
  tolerancePct: number
  magasins: { code_magasin: string; nom: string }[]
  poser: (cle: string, champ: ChampRec, valeur: string | boolean) => void
  /** Retirer une ligne ; absent, pas de corbeille (au controle, rien ne se retire). */
  surRetirer?: (cle: string) => void
  /** Dedoubler une ligne (07/11/2026) : la meme ligne de bon recue en deux lots, ou en deux formes du meme lot. */
  surDedoubler?: (cle: string) => void
  /** Au controle (A_CONTROLER) : quantites, colis, lot, unite et derogation sont figes (regle 4). */
  peseeFigee?: boolean
  /** Valider / rouvrir une ligne a l'ecran (reception existante, comme le bon). */
  surBasculerValidation?: (cle: string) => void
  voitPrix?: boolean
}

/* LES LARGEURS, EN PIXELS (24/10/2026) : chaque case a la largeur de ce
   qu'elle attend ; la reference prend le reste. */
const L_RETENUE = 30
const L_NUMERO = 28
const L_REFERENCE_MIN = 190
const L_BL = 92
const L_PESEE = 100
const L_UNITE = 88
const L_ECART = 92

interface CaseRec {
  cle: string
  entete: string
  largeur: number
  droite?: boolean
  rendu: (l: VueLigneRec, verrouPesee: boolean) => ReactNode
}

const cellule = 'px-1 py-1 align-top'
const champCase = 'h-9 px-1.5'

export function GrilleReception(props: ProprietesGrilleRec) {
  const estMobile = useEstMobile()
  return estMobile ? <CartesReception {...props} /> : <TableauReception {...props} />
}

/** Les deux dates : sur le bureau, elles vivent dans le detail de la ligne. */
const CASES_DATES = new Set(['fabrication', 'peremption'])

/**
 * Les cases facultatives, dans l'ordre ou elles se placent sur la rangee
 * principale. `avecDates` : les cartes du telephone les gardent ; le tableau du
 * bureau les range dans le DETAIL de la ligne (26/10/2026).
 */
function casesFacultatives(props: ProprietesGrilleRec, avecDates = false): CaseRec[] {
  const toutes = toutesLesCases(props)
  return avecDates ? toutes : toutes.filter((c) => !CASES_DATES.has(c.cle))
}

function toutesLesCases({ magasins, poser }: ProprietesGrilleRec): CaseRec[] {
  return [
    {
      cle: 'colis',
      entete: 'Pal. · bob.',
      largeur: 150,
      rendu: (l, figee) => (
        <div className="flex items-center gap-1">
          <Champ
            type="number"
            min="0"
            value={l.palettes}
            disabled={figee}
            onChange={(e) => poser(l.cle, 'palettes', e.target.value)}
            className={cn(champCase, 'w-[3.25rem] text-right tabular-nums')}
            placeholder="pal."
            aria-label="Nombre de palettes"
          />
          <Champ
            type="number"
            min="0"
            value={l.bobines}
            disabled={figee}
            onChange={(e) => poser(l.cle, 'bobines', e.target.value)}
            className={cn(
              champCase,
              'w-[3.25rem] text-right tabular-nums',
              l.suivi_lot && l.retenue !== false && !(Number(l.bobines) > 0) && Number(l.cond.poids_bobine_kg) > 0 && 'border-alerte',
            )}
            placeholder="bob."
            aria-label="Nombre de bobines"
          />
          {l.liaisonOfferte && !figee && (
            <button
              type="button"
              onClick={() => poser(l.cle, 'lie', !l.lie)}
              title={
                l.lie
                  ? 'Pesée, palettes et bobines se répondent — cliquez pour saisir chacun séparément'
                  : 'Calcul détaché : chaque champ se saisit seul — cliquez pour relier'
              }
              aria-label={l.lie ? 'Détacher le calcul' : 'Relier le calcul'}
              className={cn(
                'shrink-0 rounded-[var(--radius)] p-1',
                l.lie ? 'text-primaire hover:bg-primaire/10' : 'text-alerte hover:bg-alerte/10',
              )}
            >
              {l.lie ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
            </button>
          )}
        </div>
      ),
    },
    {
      cle: 'lot',
      entete: 'Lot fournisseur',
      largeur: 124,
      rendu: (l, figee) => (
        <Champ
          value={l.lot}
          disabled={figee}
          onChange={(e) => poser(l.cle, 'lot', e.target.value)}
          className={champCase}
          title={
            l.lot ||
            (l.suivi_lot
              ? 'Référence suivie par lot. Vide : un lot interne sera généré à la validation, après confirmation.'
              : undefined)
          }
          placeholder={l.suivi_lot ? 'lot interne' : '—'}
          aria-label="Lot fournisseur"
        />
      ),
    },
    {
      cle: 'magasin',
      entete: 'Magasin',
      largeur: 120,
      rendu: (l) => (
        <Selecteur
          value={l.magasin}
          onChange={(e) => poser(l.cle, 'magasin', e.target.value)}
          className={cn(champCase, 'pr-6')}
          title={magasins.find((m) => m.code_magasin === l.magasin)?.nom ?? l.magasin}
          aria-label="Magasin destinataire"
        >
          {!magasins.some((m) => m.code_magasin === l.magasin) && <option value={l.magasin}>{l.magasin || '—'}</option>}
          {magasins.map((m) => (
            <option key={m.code_magasin} value={m.code_magasin}>
              {m.nom}
            </option>
          ))}
        </Selecteur>
      ),
    },
    {
      cle: 'qualite',
      entete: 'Qualité',
      largeur: 116,
      rendu: (l) => (
        <Selecteur
          value={l.qualite}
          onChange={(e) => poser(l.cle, 'qualite', e.target.value)}
          className={cn(champCase, 'pr-6', l.qualite !== 'CONFORME' && 'border-alerte')}
          title={l.qualite !== 'CONFORME' ? 'Une ligne non conforme doit être dirigée vers un magasin de quarantaine.' : undefined}
          aria-label="Statut qualité"
        >
          {QUALITES.map((q) => (
            <option key={q.valeur} value={q.valeur}>
              {q.libelle}
            </option>
          ))}
        </Selecteur>
      ),
    },
    {
      cle: 'fabrication',
      entete: 'Fabrication',
      largeur: 124,
      rendu: (l) => (
        <Champ
          type="date"
          value={l.fabrication}
          onChange={(e) => poser(l.cle, 'fabrication', e.target.value)}
          className={cn(champCase, 'px-1')}
          aria-label="Date de fabrication"
        />
      ),
    },
    {
      cle: 'peremption',
      entete: 'Péremption',
      largeur: 124,
      rendu: (l) => (
        <Champ
          type="date"
          value={l.peremption}
          onChange={(e) => poser(l.cle, 'peremption', e.target.value)}
          className={cn(champCase, 'px-1')}
          aria-label="Date de péremption"
        />
      ),
    },
    {
      cle: 'notes',
      entete: 'Observations',
      largeur: 144,
      rendu: (l) => (
        <Champ
          value={l.notes}
          onChange={(e) => poser(l.cle, 'notes', e.target.value)}
          className={champCase}
          title={l.notes || undefined}
          placeholder="Emballage abîmé…"
          aria-label="Observations"
        />
      ),
    },
    {
      cle: 'colisbl',
      entete: 'Colis BL',
      largeur: 76,
      droite: true,
      rendu: (l, figee) => (
        <Champ
          type="number"
          min="0"
          value={l.colis}
          disabled={figee}
          onChange={(e) => poser(l.cle, 'colis', e.target.value)}
          className={cn(champCase, 'text-right tabular-nums')}
          title={
            Number(l.colis) > 0 && Number(l.qte) > 0
              ? `${fmt.nombre(Number(l.qte) / Number(l.colis), 2)} kg par colis`
              : 'Nombre de colis annoncé au bon de livraison pour cette ligne'
          }
          aria-label="Nombre de colis de la ligne"
        />
      ),
    },
  ]
}

/** Ce qui n'apparait qu'au besoin : toujours sur la rangee « ↳ ». */
function Conditionnels({
  l,
  props,
  figee,
  ouvreEquivalent = false,
}: {
  l: VueLigneRec
  props: ProprietesGrilleRec
  figee: boolean
  /** Le choix de la reference recue est-il ouvert (lien « équivalent ? » de la ligne) ? */
  ouvreEquivalent?: boolean
}) {
  const { poser, tolerancePct, voitPrix } = props
  const ecart = ecartPct(l.qte, l.reste_kg)
  const hors = ecart != null && ecart > tolerancePct && l.retenue !== false
  const kg = l.qte.trim() === '' ? null : Number(l.qte)
  return (
    <>
      {hors && (
        <div className="flex items-center gap-1.5 rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-2 py-1">
          <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px]">
            <input
              type="checkbox"
              checked={l.derogation}
              disabled={figee}
              data-derogation={idLigneRec(l.cle)}
              onChange={(e) => poser(l.cle, 'derogation', e.target.checked)}
              className="size-4"
              aria-label="Dérogation à l’écart de pesée"
            />
            Dérogation : excédent au-delà de {fmt.nombre(tolerancePct, 1)} %
          </label>
          {l.derogation && (
            <Champ
              value={l.motifDerogation}
              disabled={figee}
              onChange={(e) => poser(l.cle, 'motifDerogation', e.target.value)}
              placeholder="Motif (ex. livraison partielle)"
              className={cn('h-8 w-56', !l.motifDerogation.trim() && 'border-danger')}
              aria-label="Motif de la dérogation"
            />
          )}
        </div>
      )}
      {l.equivalents.length > 0 && (ouvreEquivalent || l.code_recu !== l.code_reference) && (
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Reçu</span>
          <Selecteur
            value={l.code_recu}
            disabled={figee}
            onChange={(e) => poser(l.cle, 'code_recu', e.target.value)}
            className={cn('h-8 w-44 pr-6', l.code_recu !== l.code_reference && 'border-alerte')}
            aria-label="Référence reçue"
          >
            <option value={l.code_reference}>{l.code_reference}</option>
            {l.equivalents.map((e) => (
              <option key={e} value={e}>
                {e} (équivalent)
              </option>
            ))}
          </Selecteur>
          {l.code_recu !== l.code_reference && (
            <Champ
              value={l.motif_substitution}
              disabled={figee}
              onChange={(e) => poser(l.cle, 'motif_substitution', e.target.value)}
              placeholder="Motif de la substitution"
              className={cn('h-8 w-56', !l.motif_substitution.trim() && 'border-danger')}
              aria-label="Motif de la substitution"
            />
          )}
        </div>
      )}
      {voitPrix && l.prix !== undefined && !l.numero_bc && (
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">
            Prix {l.devise ?? 'MAD'}/kg
          </span>
          <Champ
            type="number"
            step="any"
            min="0"
            value={l.prix}
            onChange={(e) => poser(l.cle, 'prix', e.target.value)}
            className="h-8 w-24 text-right tabular-nums"
            title="Portera le bon de régularisation. À défaut, le prix catalogue."
            aria-label="Prix au kilo de la ligne hors commande"
          />
        </div>
      )}
      {(l.rangMemeLot ?? 0) > 0 && (
        <span className="text-[12px] text-alerte">
          même lot que la ligne {l.rangMemeLot} : les pesées seront additionnées
        </span>
      )}
      <AvisColisage className="max-w-[22rem]" kg={kg} bobines={l.bobines} palettes={l.palettes} cond={l.cond} />
      {l.suivi_lot && <AvisDerive className="max-w-[22rem]" kg={kg} bobines={l.bobines} cond={l.cond} />}
      {l.suivi_lot && l.lot.trim() !== '' && <PropositionDerive l={l} kg={kg} poser={poser} />}
    </>
  )
}

/**
 * LE DERIVE D'UNE LIGNE DE RECEPTION (06/11/2026). Pour un lot DEJA CONNU :
 * quand il a plusieurs derives, la personne dit lequel entre (le plus proche du
 * poids mesure est propose). Quand la forme de la ligne differe de toutes
 * celles du lot, l'ecran PROPOSE un nouveau derive — meme lot, autre forme
 * physique —, que la personne confirme ; rien d'automatique. Une forme differe
 * par le poids d'une unite (au-dela de P_SeuilDerivePoidsPct) ou, depuis le
 * 07/11/2026, par le nombre d'unites par palette (decision de l'utilisateur :
 * 16 palettes de 30 bobines et 2 de 100 font deux derives). Les formes
 * comparees : les derives connus du lot, et la premiere ligne du meme lot dans
 * cette reception — un lot qui arrive pour la premiere fois en deux formes.
 */
function PropositionDerive({
  l,
  kg,
  poser,
}: {
  l: VueLigneRec
  kg: number | null
  poser: ProprietesGrilleRec['poser']
}) {
  const q = useDerivesLot(l.code_recu, l.lot)
  const seuil = useParametreNombre('P_SeuilDerivePoidsPct', 5)
  const derives = q.data ?? []
  const forme = formeDe(kg, l.bobines, l.palettes)
  const unitaire = forme.unitaire
  // Les formes deja la : celles des derives du lot, et la premiere ligne du lot ici.
  const premiere = l.premiereDuLot ? formeDe(l.premiereDuLot.kg, l.premiereDuLot.bobines, l.premiereDuLot.palettes) : null
  const formes: Forme[] = [
    ...derives.map((d) => ({
      nom: d.code_derive,
      unitaire: Number(d.poids_unitaire_kg) > 0 ? Number(d.poids_unitaire_kg) : null,
      parPalette: Number(d.unites_par_palette) > 0 ? Number(d.unites_par_palette) : null,
    })),
    ...(premiere && l.premiereDuLot ? [{ ...premiere, nom: `ligne ${l.premiereDuLot.rang}` }] : []),
  ]
  const ecart = (d: DeriveLot) =>
    unitaire != null && Number(d.poids_unitaire_kg) > 0
      ? Math.abs(unitaire / Number(d.poids_unitaire_kg) - 1) * 100
      : null
  const proches = derives
    .map((d) => ({ d, e: ecart(d) }))
    .filter((x) => x.e != null && x.e <= seuil)
    .filter((x) => !autreParPalette(forme.parPalette, Number(x.d.unites_par_palette) || null))
    .sort((a, b) => (a.e as number) - (b.e as number))
  // Une forme differente de TOUTES celles qu'on peut comparer (07/11/2026).
  const aucunProche = nouvelleForme(forme, formes, seuil)
  const propose = derives.length > 1 ? (proches[0]?.d.code_derive ?? '') : ''
  const choisi = l.codeDerive || propose
  // Ce que l'ecran propose est ce qui part : la proposition entre dans la ligne.
  useEffect(() => {
    if (!l.codeDerive && !l.deriveNouveau && propose) poser(l.cle, 'codeDerive', propose)
  }, [l.cle, l.codeDerive, l.deriveNouveau, propose, poser])
  if (derives.length === 0 && !aucunProche && !l.deriveNouveau) return null
  return (
    <div className="flex max-w-[30rem] flex-col gap-1">
      {derives.length > 1 && !l.deriveNouveau && (
        <label className="flex items-center gap-1.5 text-[12px]">
          <span className="text-attenue-texte">Dérivé du lot</span>
          <select
            className={cn('h-7 rounded-[var(--radius)] border bg-surface px-1 text-[12px]', !choisi ? 'border-danger' : 'border-bordure')}
            value={choisi}
            onChange={(e) => poser(l.cle, 'codeDerive', e.target.value)}
            aria-label="Dérivé du lot qui entre"
          >
            <option value="">Choisir…</option>
            {derives.map((d) => (
              <option key={d.code_derive} value={d.code_derive}>
                {d.code_derive}
                {d.poids_unitaire_kg ? ` — ${fmt.nombre(Number(d.poids_unitaire_kg), 3)} kg` : ''}
                {d.conditionnement_libelle ? ` (${d.conditionnement_libelle})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {(aucunProche || l.deriveNouveau) && (
        <label className="flex items-start gap-1.5 rounded-[var(--radius)] border border-alerte/40 bg-alerte/5 px-2 py-1 text-[12px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!l.deriveNouveau}
            onChange={(e) => poser(l.cle, 'deriveNouveau', e.target.checked)}
          />
          <span>
            {(unitaire != null || forme.parPalette != null) && (
              <>
                Cette ligne : {unitaire != null ? `${fmt.nombre(unitaire, 3)} kg par unité` : ''}
                {unitaire != null && forme.parPalette != null ? ', ' : ''}
                {forme.parPalette != null ? `${fmt.nombre(forme.parPalette, 1)} unités par palette` : ''} — autre forme que{' '}
                {formes
                  .map(
                    (f) =>
                      `${f.nom} (${f.unitaire != null ? `${fmt.nombre(f.unitaire, 3)} kg` : '—'}${
                        f.parPalette != null ? `, ${fmt.nombre(f.parPalette, 1)} par palette` : ''
                      })`,
                  )
                  .join(', ')}
                .{' '}
              </>
            )}
            Créer un nouveau dérivé de ce lot (même lot, autre forme physique) ?
          </span>
        </label>
      )}
    </div>
  )
}

/** Un jour AAAA-MM-JJ en « 12/10 » (l'annee en plus si ce n'est pas la courante), sans fuseau. */
function jourCourt(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return v
  return m[1] === String(new Date().getFullYear()) ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1].slice(2)}`
}

/** Un jour AAAA-MM-JJ en « 12/10/2026 », sans fuseau. */
function jourLong(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

/** L'identifiant DOM du detail d'une ligne (aria-controls). */
const idDetailRec = (cle: string) => `${idLigneRec(cle)}-detail`

/** Ouvrir / fermer le detail d'une ligne (tableau du bureau seulement). */
interface BasculeDetail {
  ouvert: boolean
  basculer: () => void
}

/** La cellule « Référence » : ce qui est recu, contre quel bon, ce qui en reste. */
function CelluleReference({
  l,
  surEquivalent,
  detail,
}: {
  l: VueLigneRec
  surEquivalent?: () => void
  detail?: BasculeDetail
}) {
  // UNE DATE SAISIE NE SE CACHE PAS (26/10/2026) : le detail est ferme, la
  // ligne en garde un repere.
  const dates = [
    l.fabrication ? `fab. ${jourCourt(l.fabrication)}` : '',
    l.peremption ? `pér. ${jourCourt(l.peremption)}` : '',
  ].filter(Boolean)
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        {detail && (
          <button
            type="button"
            onClick={detail.basculer}
            aria-expanded={detail.ouvert}
            aria-controls={detail.ouvert ? idDetailRec(l.cle) : undefined}
            aria-label={detail.ouvert ? 'Fermer le détail de la ligne' : 'Ouvrir le détail de la ligne'}
            title="Détail : dates de fabrication et de péremption, bon, reste, prix engagé, date promise"
            className="-ml-0.5 shrink-0 rounded-[var(--radius)] p-0.5 text-attenue-texte hover:bg-attenue hover:text-texte"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', detail.ouvert && 'rotate-90')} />
          </button>
        )}
        <div className="min-w-0 truncate font-medium" title={`${l.code_recu} — ${l.designation}`}>
          {l.code_recu}
        {l.code_recu === l.code_reference && l.designation && l.designation !== l.code_recu && (
            <span className="font-normal text-attenue-texte"> · {l.designation}</span>
          )}
        </div>
      </div>
      <div className="truncate text-[11px] tabular-nums text-attenue-texte">
        {l.code_recu !== l.code_reference && <span className="text-alerte">commandé : {l.code_reference} · </span>}
        {l.numero_bc ? (
          <>
            {l.numero_bc} · reste {l.reste_kg == null ? '—' : fmt.nombre(l.reste_kg, 0)} kg
            {(l.retard_jours ?? 0) > 0 && <span className="text-danger"> · {l.retard_jours} j de retard</span>}
          </>
        ) : (
          <Badge ton="alerte">hors commande</Badge>
        )}
        {/* UN EQUIVALENT LIVRE A LA PLACE : le choix s'ouvre a la demande. */}
        {surEquivalent && l.equivalents.length > 0 && l.code_recu === l.code_reference && (
          <>
            {' · '}
            <button type="button" onClick={surEquivalent} className="underline hover:text-texte">
              équivalent reçu ?
            </button>
          </>
        )}
      </div>
      {/* LE SIGNAL : une autre reception pese deja cette ligne. */}
      {(l.en_cours_kg ?? 0) > 0 && (
        <div className="truncate text-[11px] text-alerte" title={`Déjà en cours dans ${l.en_cours_dans}`}>
          déjà en cours : {fmt.nombre(l.en_cours_kg ?? 0, 0)} kg dans {l.en_cours_dans}
        </div>
      )}
      {detail && dates.length > 0 && (
        <div className="truncate text-[11px] tabular-nums text-attenue-texte" title="Dates saisies dans le détail de la ligne">
          {dates.join(' · ')}
        </div>
      )}
    </div>
  )
}

/**
 * LE DETAIL D'UNE LIGNE (26/10/2026, « le milieu ») : sur la page, sous la
 * ligne, ferme par defaut. Les deux DATES, rarement saisies, y vivent ; il
 * montre aussi, en lecture, ce qui situe la ligne : bon, reste, prix engage,
 * date promise.
 */
function DetailLigne({ l, poser, voitPrix }: { l: VueLigneRec; poser: ProprietesGrilleRec['poser']; voitPrix?: boolean }) {
  const lecture: { libelle: string; valeur: ReactNode }[] = []
  if (l.numero_bc) {
    lecture.push({ libelle: 'Bon', valeur: l.numero_bc })
    if (l.code_recu !== l.code_reference) lecture.push({ libelle: 'Commandé', valeur: l.code_reference })
    lecture.push({ libelle: 'Reste', valeur: l.reste_kg == null ? '—' : `${fmt.nombre(l.reste_kg, 2)} kg` })
    if (voitPrix && l.prix_engage != null)
      lecture.push({ libelle: 'Prix engagé', valeur: `${fmt.nombre(l.prix_engage, 4)} ${l.devise ?? 'MAD'}/kg` })
    lecture.push({
      libelle: 'Livraison promise',
      valeur: l.date_promise ? (
        <>
          {jourLong(l.date_promise)}
          {(l.retard_jours ?? 0) > 0 && <span className="text-danger"> · {l.retard_jours} j de retard</span>}
        </>
      ) : (
        '—'
      ),
    })
  } else lecture.push({ libelle: 'Bon', valeur: 'hors commande' })
  const etiquette = 'text-[10.5px] uppercase tracking-wider text-attenue-texte'
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-[var(--radius)] bg-attenue/40 px-2 py-1.5">
      <label className="flex w-[8.5rem] flex-col gap-0.5">
        <span className={etiquette}>Fabrication</span>
        <Champ
          type="date"
          value={l.fabrication}
          onChange={(e) => poser(l.cle, 'fabrication', e.target.value)}
          className={cn(champCase, 'px-1')}
          aria-label="Date de fabrication"
        />
      </label>
      <label className="flex w-[8.5rem] flex-col gap-0.5">
        <span className={etiquette}>Péremption</span>
        <Champ
          type="date"
          value={l.peremption}
          onChange={(e) => poser(l.cle, 'peremption', e.target.value)}
          className={cn(champCase, 'px-1')}
          aria-label="Date de péremption"
        />
      </label>
      <dl className="flex flex-wrap items-end gap-x-4 gap-y-1 pb-1.5 text-[12px]">
        {lecture.map((x) => (
          <div key={x.libelle} className="flex flex-col gap-0.5">
            <dt className={etiquette}>{x.libelle}</dt>
            <dd className="tabular-nums">{x.valeur}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Un clic sur la ligne ouvre son detail — sauf sur ce qui se saisit ou se clique deja. */
function clicHorsSaisie(e: MouseEvent) {
  const t = e.target as HTMLElement
  // Un texte qu'on selectionne pour le copier n'ouvre rien.
  if ((window.getSelection()?.toString() ?? '') !== '') return false
  return !t.closest('input, select, textarea, button, a, label, [role="combobox"], [contenteditable="true"]')
}

function CelluleEcart({ l, tolerancePct }: { l: VueLigneRec; tolerancePct: number }) {
  const e = ecartPct(l.qte, l.reste_kg)
  const v = verdictEcart(e, tolerancePct)
  if (e == null || !v) return <span className="block pt-2 text-right text-attenue-texte">—</span>
  const couleur = v.ton === 'danger' ? 'text-danger' : v.ton === 'alerte' ? 'text-alerte' : 'text-succes'
  return (
    <div
      className={cn('pt-1 text-right tabular-nums', couleur)}
      title={`Écart à ce que le bon attend encore ; tolérance du fournisseur : ${fmt.nombre(tolerancePct, 1)} %`}
    >
      <div className="font-medium">
        {e > 0 ? '+' : ''}
        {fmt.nombre(e, 1)} %
      </div>
      <div className="text-[11px]">
        {v.ton === 'danger' && l.derogation && l.motifDerogation.trim() ? 'dérogation donnée' : v.mot}
      </div>
    </div>
  )
}

function TableauReception(props: ProprietesGrilleRec) {
  const { lignes, poser, surRetirer, surDedoubler, peseeFigee = false, surBasculerValidation, tolerancePct } = props
  const avecRetenue = lignes.some((l) => l.retenue !== undefined)
  const lActions = 8 + 28 * ((surRetirer ? 1 : 0) + (surDedoubler ? 1 : 0) + (surBasculerValidation ? 1 : 0))
  const fixe =
    (avecRetenue ? L_RETENUE : 0) + L_NUMERO + L_REFERENCE_MIN + L_BL + L_PESEE + L_UNITE + L_ECART + lActions
  const [ref, largeur] = useLargeurConteneur<HTMLDivElement>()
  const { enLigne, dessous } = repartirCases(fixe, casesFacultatives(props), largeur)
  const [equivalents, setEquivalents] = useState<Set<string>>(new Set())
  const ouvrirEquivalent = (cle: string) => setEquivalents((s) => new Set(s).add(cle))
  // LE DETAIL DE CHAQUE LIGNE, ferme par defaut ; il s'ouvre au clic sur la ligne.
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const basculer = (cle: string) =>
    setOuverts((s) => {
      const n = new Set(s)
      if (n.has(cle)) n.delete(cle)
      else n.add(cle)
      return n
    })
  const nbColonnes = (avecRetenue ? 1 : 0) + 7 + enLigne.length

  return (
    <div ref={ref}>
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          {avecRetenue && <col style={{ width: L_RETENUE }} />}
          <col style={{ width: L_NUMERO }} />
          <col />
          <col style={{ width: L_BL }} />
          <col style={{ width: L_PESEE }} />
          <col style={{ width: L_UNITE }} />
          <col style={{ width: L_ECART }} />
          {enLigne.map((c) => (
            <col key={c.cle} style={{ width: c.largeur }} />
          ))}
          <col style={{ width: lActions }} />
        </colgroup>
        <thead>
          <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
            {avecRetenue && (
              <th className="px-1 py-2" title="Ligne retenue pour cette réception">
                OK
              </th>
            )}
            <th className="px-1 py-2 text-right">#</th>
            <th className="px-1 py-2 text-left">Référence · bon · reste</th>
            <th className="px-1 py-2 text-right" title="Quantité annoncée au bon de livraison, en kilos">Qté BL</th>
            <th className="px-1 py-2 text-right" title="Quantité pesée, en kilos">Pesé (kg)</th>
            <th className="px-1 py-2 text-left" title="L’unité dans laquelle la réception est archivée">Unité</th>
            <th className="px-1 py-2 text-right">Écart</th>
            {enLigne.map((c) => (
              <th key={c.cle} className={cn('truncate px-1 py-2', c.droite ? 'text-right' : 'text-left')} title={c.entete}>
                {c.entete}
              </th>
            ))}
            <th className="px-1 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => {
            const verrou = !!surBasculerValidation && !!l.valide
            // VALIDEE, la ligne est figee par `inert` (comme sur le bon) ; AU
            // CONTROLE, la pesee l'est par `disabled`, qui se voit.
            const figee = peseeFigee
            const ecart = ecartPct(l.qte, l.reste_kg)
            const hors = ecart != null && ecart > tolerancePct
            const manqueQte = l.retenue !== false && !(Number(l.qte) > 0)
            const eteinte = l.retenue === false
            const ouvert = ouverts.has(l.cle)
            return (
              <Fragment key={l.cle}>
                <tr
                  id={idLigneRec(l.cle)}
                  onClick={(e) => clicHorsSaisie(e) && basculer(l.cle)}
                  className={cn('scroll-mt-24 cursor-pointer', verrou && 'bg-succes/[0.05]', eteinte && 'opacity-45')}
                >
                  {avecRetenue && (
                    <td className="px-1 py-1 pt-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={l.retenue}
                        onChange={(e) => poser(l.cle, 'retenue', e.target.checked)}
                        className="size-4"
                        aria-label={`Retenir ${l.code_reference}`}
                      />
                    </td>
                  )}
                  <td className="px-1 py-1 pt-2.5 text-right tabular-nums text-attenue-texte">{i + 1}</td>
                  <td className={cn(cellule, 'min-w-0')}>
                    <CelluleReference
                      l={l}
                      surEquivalent={peseeFigee ? undefined : () => ouvrirEquivalent(l.cle)}
                      detail={{ ouvert, basculer: () => basculer(l.cle) }}
                    />
                  </td>
                  <td className={cellule} inert={verrou}>
                    <Champ
                      type="number"
                      step="any"
                      min="0"
                      value={l.qteBl}
                      disabled={peseeFigee}
                      onChange={(e) => poser(l.cle, 'qteBl', e.target.value)}
                      className={cn(champCase, 'text-right tabular-nums')}
                      aria-label="Quantité du bon de livraison, en kilos"
                    />
                  </td>
                  <td className={cellule} inert={verrou}>
                    <Champ
                      type="number"
                      step="any"
                      min="0.0001"
                      value={l.qte}
                      disabled={peseeFigee}
                      onChange={(e) => poser(l.cle, 'qte', e.target.value)}
                      className={cn(
                        champCase,
                        'text-right text-[14px] font-medium tabular-nums',
                        (manqueQte || hors) && !peseeFigee && 'border-danger',
                      )}
                      placeholder="à peser"
                      aria-label="Quantité pesée, en kilos"
                    />
                    {l.qteBl.trim() !== '' && l.qte.trim() !== '' && Math.abs(Number(l.qte) - Number(l.qteBl)) > 0.001 && (
                      <div
                        className="mt-0.5 truncate text-right text-[11px] tabular-nums text-danger"
                        title="Écart entre la pesée et le bon de livraison : litige de transport"
                      >
                        {Number(l.qte) - Number(l.qteBl) > 0 ? '+' : ''}
                        {fmt.nombre(Number(l.qte) - Number(l.qteBl), 2)} / BL
                      </div>
                    )}
                  </td>
                  <td className={cellule} inert={verrou}>
                    <Selecteur
                      value={l.unite}
                      disabled={peseeFigee}
                      onChange={(e) => poser(l.cle, 'unite', e.target.value)}
                      className={cn(champCase, 'px-1 pr-5', !l.convertible && 'border-danger')}
                      title="Le poids ne change pas : seule son expression d’archivage change."
                      aria-label="Unité de saisie"
                    >
                      <option value="kg">kg</option>
                      {l.unites.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Selecteur>
                    {!l.convertible && <div className="mt-0.5 text-[11px] text-danger">non convertible</div>}
                  </td>
                  <td className={cellule}>
                    <CelluleEcart l={l} tolerancePct={tolerancePct} />
                  </td>
                  {enLigne.map((c) => (
                    <td key={c.cle} className={cellule} inert={verrou}>
                      {c.rendu(l, figee)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-1 py-1">
                    {surBasculerValidation && (
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className={verrou ? 'text-attenue-texte hover:bg-attenue' : 'text-succes hover:bg-succes/10'}
                        disabled={!verrou && !(Number(l.qte) > 0)}
                        aria-label={verrou ? 'Modifier la ligne' : 'Valider la ligne'}
                        title={
                          verrou
                            ? 'Ligne validée — cliquez pour la modifier'
                            : 'Valider cette ligne — elle partira avec « Enregistrer »'
                        }
                        onClick={() => surBasculerValidation(l.cle)}
                      >
                        {verrou ? <Pencil /> : <Check />}
                      </Bouton>
                    )}
                    {surDedoubler && !figee && (
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        onClick={() => surDedoubler(l.cle)}
                        aria-label="Autre lot ou autre forme"
                        title="Ajouter une ligne pour la même ligne de bon : un autre lot, ou une autre forme du même lot (autres palettes, autres fûts)"
                      >
                        <CopyPlus />
                      </Bouton>
                    )}
                    {surRetirer && (
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className="text-danger hover:bg-danger/10"
                        onClick={() => surRetirer(l.cle)}
                        aria-label="Supprimer la ligne"
                        title="Retirer la ligne de la réception"
                      >
                        <Trash2 />
                      </Bouton>
                    )}
                  </td>
                </tr>
                {/* LA RANGEE « ↳ » : ce qui ne tient pas sur la ligne, et ce qui
                    n'apparait qu'au besoin. Vide, elle ne prend aucune hauteur. */}
                <tr
                  className={cn(!ouvert && 'border-b border-bordure/60', verrou && 'bg-succes/[0.05]', eteinte && 'opacity-45')}
                >
                  <td colSpan={avecRetenue ? 2 : 1} className="p-0" />
                  <td colSpan={nbColonnes - (avecRetenue ? 2 : 1)} className="p-0" inert={verrou}>
                    <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5 px-1 pb-2 empty:hidden">
                      {dessous.map((c, k) => (
                        <div key={c.cle} className="flex flex-col gap-0.5" style={{ width: c.largeur }}>
                          <span className="truncate text-[10.5px] uppercase tracking-wider text-attenue-texte" title={c.entete}>
                            {k === 0 ? '↳ ' : ''}
                            {c.entete}
                          </span>
                          {c.rendu(l, figee)}
                        </div>
                      ))}
                      <Conditionnels l={l} props={props} figee={figee} ouvreEquivalent={equivalents.has(l.cle)} />
                    </div>
                  </td>
                </tr>
                {ouvert && (
                  <tr
                    id={idDetailRec(l.cle)}
                    className={cn('border-b border-bordure/60', verrou && 'bg-succes/[0.05]', eteinte && 'opacity-45')}
                  >
                    <td colSpan={avecRetenue ? 2 : 1} className="p-0" />
                    <td colSpan={nbColonnes - (avecRetenue ? 2 : 1)} className="px-1 pb-2" inert={verrou}>
                      <DetailLigne l={l} poser={poser} voitPrix={props.voitPrix} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Sous 768 px : une carte par ligne, tous les champs empiles, rien a faire defiler. */
function CartesReception(props: ProprietesGrilleRec) {
  const { lignes, poser, surRetirer, surDedoubler, peseeFigee = false, surBasculerValidation, tolerancePct } = props
  const cases = casesFacultatives(props, true)
  return (
    <ul className="space-y-2 p-2">
      {lignes.map((l, i) => {
        const verrou = !!surBasculerValidation && !!l.valide
        const figee = peseeFigee
        return (
          <li
            key={l.cle}
            id={idLigneRec(l.cle)}
            className={cn(
              'scroll-mt-24 rounded-[var(--radius)] border border-bordure bg-surface p-2.5',
              l.retenue === false && 'opacity-45',
            )}
          >
            <div className="flex items-start gap-2">
              {l.retenue !== undefined && (
                <input
                  type="checkbox"
                  checked={l.retenue}
                  onChange={(e) => poser(l.cle, 'retenue', e.target.checked)}
                  className="mt-1 size-4"
                  aria-label={`Retenir ${l.code_reference}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-attenue-texte">Ligne {i + 1}</span>
                <CelluleReference l={l} />
              </div>
              <div className="w-24 shrink-0">
                <CelluleEcart l={l} tolerancePct={tolerancePct} />
              </div>
              {surBasculerValidation && (
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  aria-label={verrou ? 'Modifier la ligne' : 'Valider la ligne'}
                  onClick={() => surBasculerValidation(l.cle)}
                >
                  {verrou ? <Pencil /> : <Check />}
                </Bouton>
              )}
              {surDedoubler && !figee && (
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  onClick={() => surDedoubler(l.cle)}
                  aria-label="Autre lot ou autre forme"
                >
                  <CopyPlus />
                </Bouton>
              )}
              {surRetirer && (
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  className="text-danger hover:bg-danger/10"
                  onClick={() => surRetirer(l.cle)}
                  aria-label="Supprimer la ligne"
                >
                  <Trash2 />
                </Bouton>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2" inert={verrou}>
              <label className="flex flex-col gap-0.5 text-[10.5px] uppercase tracking-wider text-attenue-texte">
                Qté BL (kg)
                <Champ
                  type="number"
                  step="any"
                  min="0"
                  value={l.qteBl}
                  disabled={peseeFigee}
                  onChange={(e) => poser(l.cle, 'qteBl', e.target.value)}
                  className="h-10 text-right text-[14px] normal-case tracking-normal tabular-nums"
                  aria-label="Quantité du bon de livraison, en kilos"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[10.5px] uppercase tracking-wider text-attenue-texte">
                Pesé (kg)
                <Champ
                  type="number"
                  step="any"
                  min="0.0001"
                  value={l.qte}
                  disabled={peseeFigee}
                  onChange={(e) => poser(l.cle, 'qte', e.target.value)}
                  className="h-10 text-right text-[15px] font-semibold normal-case tracking-normal tabular-nums"
                  aria-label="Quantité pesée, en kilos"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[10.5px] uppercase tracking-wider text-attenue-texte">
                Unité
                <Selecteur
                  value={l.unite}
                  disabled={peseeFigee}
                  onChange={(e) => poser(l.cle, 'unite', e.target.value)}
                  className="h-10 normal-case tracking-normal"
                  aria-label="Unité de saisie"
                >
                  <option value="kg">kg</option>
                  {l.unites.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Selecteur>
              </label>
              {cases.map((c) => (
                <div
                  key={c.cle}
                  className={cn(
                    'flex min-w-0 flex-col gap-0.5 [&_input]:w-full [&_select]:w-full',
                    c.cle === 'notes' && 'col-span-2',
                  )}
                >
                  <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">{c.entete}</span>
                  {c.rendu(l, figee)}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 empty:hidden" inert={verrou}>
              <Conditionnels l={l} props={props} figee={figee} ouvreEquivalent />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

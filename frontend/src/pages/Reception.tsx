/**
 * Reception — DOCUMENT : en-tete, pesees, controle qualite.
 *
 * La saisie propose ce qui est ATTENDU : les lignes du bon de commande encore a
 * livrer, avec ce qui reste du. Sans cela, le magasinier choisit une reference
 * dans le catalogue et saisit un poids sans savoir ce qui etait commande — c'est
 * ainsi qu'on receptionne la mauvaise couleur, ou deux fois la meme palette.
 *
 * Rien ne part au serveur pendant la saisie : pesees, corrections, retraits et
 * en-tete attendent l'enregistrement. Une pesee corrigee doit pouvoir l'etre
 * avant d'exister, pas apres.
 *
 * La VALIDATION, elle, est autre chose : c'est la cascade — stock, CMUP,
 * archive, historique de prix — et elle appartient au controle qualite, pas au
 * peseur (separation B4).
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Send, ShieldCheck, Tags, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { useToleranceFournisseur } from '../lib/lots'
import { EnTetePage } from '../composants/Coquille'
import { BoutonDevalider } from '../composants/BoutonDevalider'
import { StatutBadge } from '../composants/StatutBadge'
import { AvisInventaireOuvert } from '../composants/AvisInventaireOuvert'
import { phraseGel, useGelInventaire } from '../lib/inventairesOuverts'
import { ClotureFacture, CorrectionFacture } from './ReceptionCloture'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import {
  type LigneSaisie,
  type RefLigne,
  depuisReference,
  unitesDe,
} from '../composants/GrilleLignes'
import { ChampRecherche, type Suggestion } from '../composants/ChampRecherche'
import {
  type ChampColis,
  type Conditionnement,
  conditionnementDuLot,
  depuisChamp,
  depuisKg,
  facteurVersKg,
  pourChamp,
} from '../lib/conditionnement'
import { useEstMobile } from '../lib/mediaQuery'
import { useConditionnementsLots } from '../hooks/useConditionnementLots'
import {
  type ChampRec,
  type VueLigneRec,
  GrilleReception,
  allerALaLigne,
  ecartPct,
} from './receptions/GrilleReception'
import { BarreReception, type IndicateurRec, type MessageRec, texteEcartKg, tonEcartKg } from './receptions/BarreReception'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Etiq,
} from '../composants/ui/base'
import { Aide, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { MOTS_BOBINE, motsCommuns, useMotsUnite } from '../lib/motsUnite'
import { PeseesMobile, fondrePesee } from './receptions/PeseesMobile'
import { FraisApproche } from './receptions/FraisApproche'

const MODULE = 'RECEPTIONS'

interface Reception extends Record<string, unknown> {
  /** Compteur de concurrence, incremente par la base a chaque modification (A2). */
  version?: number
  id_reception: string
  numero_reception: string
  date_reception: string
  code_fournisseur: string
  fournisseur_nom: string
  code_devise?: string
  numero_bc: string | null
  id_bc: string | null
  /* L'ARRIVAGE D'IMPORT (ADR-003 phase A) : le dossier rattache porte la DUM,
     les conteneurs et le regime. Il ne remplace pas la commande. */
  id_dossier_import: string | null
  dossier_numero?: string | null
  numero_dum?: string | null
  conteneurs?: string | null
  num_bon_livraison: string | null
  numero_facture: string | null
  transporteur: string | null
  nombre_colis: number | null
  poids_total_brut_kg: number | null
  statut: string
  nb_lignes: number
  receptionnaire: string | null
  controleur: string | null
  date_controle: string | null
  // OTIF : produit de trois conditions, pas moyenne. A l'heure mais incomplet
  // vaut zero — c'est la seule lecture honnete d'une livraison.
  delai_reel_jours: number | null
  delai_prevu_jours: number | null
  retard_jours: number | null
  on_time: number | null
  in_full: number | null
  in_spec: number | null
}

interface LigneRec extends Record<string, unknown> {
  id_ligne_reception: string
  ligne_numero: number
  /* LE BON QUE CETTE LIGNE SERT (ADR-003 D2). Un arrivage en couvre plusieurs :
     le peg est porte par la LIGNE, pas par l'en-tete. */
  id_ligne_bc: string | null
  numero_bc: string | null
  /** 1 : la reference se suit par lot (le lot est exige a l'entree en stock). */
  suivi_lot?: number
  code_reference: string
  reference_designation: string
  unite_saisie: string
  quantite_pesee_unite: number
  quantite_stock_kg: number
  quantite_commandee_kg: number | null
  quantite_bl_kg: number | null
  ecart_pct: number | null
  ecart_bl_kg: number | null
  ecart_cmd_kg: number | null
  nb_colis_ligne: number | null
  /* CE QU'ON A COMPTE sur le quai, la ou nb_colis_ligne porte ce que le bon
     de livraison ANNONCE. L'ecart entre les deux est justement ce qu'on
     cherche a voir. */
  nb_palettes: number | null
  nb_bobines: number | null
  poids_moyen_colis_kg: number | null
  prix_kg_devise?: number
  code_devise?: string
  prix_kg_mad?: number
  lot_fournisseur: string | null
  statut_qualite: string
  code_magasin_dest: string
  derogation_ecart?: number | null
  motif_derogation?: string | null
  unite_catalogue?: string
  /* LE CONDITIONNEMENT DE LA FICHE, ajoute a la requete : sans lui, la grille
     ne sait pas convertir une pesee en palettes ni en bobines. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  bobines_par_lot?: number | null
  densite_kg_ml?: number | null
}

interface LigneAttendue extends Record<string, unknown> {
  id_ligne_bc: string
  code_reference: string
  designation: string
  unite_commande: string
  quantite_commandee_kg: number
  quantite_recue_kg: number
  quantite_restante_kg: number
  prix_kg_devise?: number
  code_devise?: string
  unite_catalogue: string
  suivi_lot: number
  deja_pesee_kg: number
  numero_bc: string
  /* Le conditionnement de la fiche : la grille en a besoin pour convertir. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  bobines_par_lot?: number | null
  densite_kg_ml?: number | null
  date_livraison_prevue: string | null
  retard_jours: number | null
  /* LE DOSSIER D'IMPORT SE DEDUIT (16/10/2026) : la ligne de bon mene a sa
     ligne de facture, donc a son dossier, sa DUM et son conteneur. Le
     magasinier choisit ses BONS, pas un numero de dossier. */
  id_bc: string
  id_dossier?: string | null
  dossier_numero?: string | null
  dossier_dum?: string | null
  dossier_conteneurs?: string | null
}


/**
 * Une ligne deja pesee entre dans la grille — la MEME que celle du bon de
 * commande.
 *
 * La reception saisit toujours des KILOS : c'est une pesee. La base, elle,
 * archive l'expression declaree (`quantite_pesee_unite` dans `unite_saisie`),
 * et la traduction se fait ici a la lecture, comme a l’envoi.
 *
 * `extra` PORTE CE QUE LA GRILLE NE CONNAIT PAS : lot, magasin, qualite,
 * quantite annoncee au bon de livraison, colis. La grille les range et les
 * rend ; c'est cet ecran qui sait ce qu'ils veulent dire.
 */
/**
 * LES LIGNES DEDOUBLEES D'UNE LIGNE DE BON (07/11/2026) : la meme ligne de bon
 * recue en deux lots ou deux formes fait deux lignes, mais un seul attendu. La
 * PREMIERE porte l'attendu du bon ; les autres n'en portent pas.
 */
function porteAttendu(l: LigneSaisie, ls: LigneSaisie[]): boolean {
  if (l.suggere_kg == null) return false
  const id = l.extra?.id_ligne_bc
  return !id || ls.find((x) => x.extra?.id_ligne_bc === id)?.cle === l.cle
}

/** L'attendu de la premiere ligne, net de ce que ses lignes dedoublees apportent ; null pour les autres. */
function attenduNet(l: LigneSaisie, ls: LigneSaisie[]): number | null {
  if (!porteAttendu(l, ls)) return null
  const id = l.extra?.id_ligne_bc
  const autres = id ? ls.filter((x) => x.extra?.id_ligne_bc === id && x.cle !== l.cle) : []
  return (l.suggere_kg ?? 0) - autres.reduce((s, x) => s + (Number(x.qte) || 0), 0)
}

/** La ligne compte-t-elle pour l'ecart au bon (elle, ou une ligne dedoublee de la meme ligne de bon) ? */
function rattacheeAuBon(l: LigneSaisie, ls: LigneSaisie[]): boolean {
  const id = l.extra?.id_ligne_bc
  return porteAttendu(l, ls) || (!!id && ls.some((x) => x.extra?.id_ligne_bc === id && porteAttendu(x, ls)))
}

function depuisLigneReception(l: LigneRec): LigneSaisie {
  const cond: Conditionnement = {
    poids_bobine_kg: l.poids_bobine_kg,
    bobines_par_palette: l.bobines_par_palette,
    bobines_par_lot: l.bobines_par_lot,
    densite_kg_ml: l.densite_kg_ml,
  }
  const colis = depuisKg(l.quantite_stock_kg, cond)
  return {
    cle: l.id_ligne_reception,
    idExistant: l.id_ligne_reception,
    nature: 'MARCHANDISE',
    code_reference: l.code_reference,
    intitule: l.reference_designation ?? l.code_reference,
    cond,
    unite_catalogue: l.unite_catalogue ?? 'kg',
    fournisseur_habituel: null,
    suggere_kg: l.quantite_commandee_kg,
    qte: pourChamp(l.quantite_stock_kg, 3),
    unite: l.unite_saisie,
    palettes: l.nb_palettes != null ? String(l.nb_palettes) : pourChamp(colis.palettes),
    // UNE LIGNE JAMAIS COMPTEE RESTE VIDE (10/10/2026). Le chiffre deduit des kilos
    // s'affichait comme un compte : retaper le meme nombre ne changeait rien a
    // l'ecran, rien ne partait, et la soumission restait refusee (« Comptez les
    // bobines ») sans issue. Le compte du quai se tape, il ne se devine pas.
    bobines: l.nb_bobines != null ? String(l.nb_bobines) : '',
    // DETACHEE DES QU'UN COLISAGE A ETE CONSTATE. Sur un quai, « 21 palettes
    // ET ce poids-la » est la regle plutot que l'exception : une palette
    // entamee ne se deduit d'aucune pesee. Relier d'office effacerait le
    // constat du receptionnaire a la premiere frappe.
    lie: l.nb_palettes == null && l.nb_bobines == null,
    prix: l.prix_kg_devise != null ? String(l.prix_kg_devise) : '',
    reference_fournisseur: '',
    couleur: '',
    code_couleur: '',
    // RELUE DEPUIS LA BASE, LA LIGNE ARRIVE VALIDEE — donc figee. On la rouvre
    // au crayon ; une frappe egaree ne la modifie pas en passant.
    valide: true,
    extra: {
      // LE PEG RELU DEPUIS LA BASE : une ligne corrigee garde la ligne de bon
      // qu'elle servait, et la carte affiche contre quelle commande on a pese.
      id_ligne_bc: l.id_ligne_bc ?? '',
      numero_bc: l.numero_bc ?? '',
      prix_mad: l.prix_kg_mad != null ? String(l.prix_kg_mad) : '',
      bl: l.quantite_bl_kg != null ? String(l.quantite_bl_kg) : '',
      colis: l.nb_colis_ligne != null ? String(l.nb_colis_ligne) : '',
      lot: l.lot_fournisseur ?? '',
      magasin: l.code_magasin_dest,
      qualite: l.statut_qualite,
      derog: l.derogation_ecart === 1 ? '1' : '',
      motif_derog: l.motif_derogation ?? '',
      // LES DATES ET LES OBSERVATIONS DE LA LIGNE (24/10/2026) : la route de
      // correction les accepte, meme au controle ; l'ecran ne les relisait pas.
      fabrication: jourDe(l.date_fabrication),
      peremption: jourDe(l.date_peremption),
      notes: typeof l.notes === 'string' ? l.notes : '',
      // Pour l'ecran seul (bobines a compter) : ne part pas au serveur.
      suivi_lot: l.suivi_lot === 1 ? '1' : '',
    },
  }
}

/** Une date relue (texte ISO ou jour), ramenee au jour pour un champ date. */
function jourDe(v: unknown): string {
  return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : ''
}

/**
 * KILOS, PALETTES ET BOBINES SE REPONDENT, sur une ligne liee : le champ tape
 * commande, les deux autres suivent le conditionnement donne — celui du LOT
 * s'il est connu (2026-10-23a), sinon la fiche article. Detachee, chaque champ
 * se saisit seul. La pesee reste ce qu'on a tape : elle ne revient jamais
 * arrondie par un compte.
 */
function lierColis(l: LigneSaisie, source: ChampColis, valeur: string, cond: Conditionnement): LigneSaisie {
  const champ = source === 'quantite' ? 'qte' : source
  if (!l.lie) return { ...l, [champ]: valeur }
  const r = depuisChamp(source, valeur, cond)
  return {
    ...l,
    saisiePar: source,
    qte: source === 'quantite' ? valeur : pourChamp(r.kg, 3),
    palettes: source === 'palettes' ? valeur : pourChamp(r.palettes),
    bobines: source === 'bobines' ? valeur : pourChamp(r.bobines),
  }
}

/** Ce que chaque case de la grille ecrit dans `extra`. */
const EXTRA_DE: Partial<Record<ChampRec, string>> = {
  qteBl: 'bl',
  colis: 'colis',
  lot: 'lot',
  magasin: 'magasin',
  qualite: 'qualite',
  motifDerogation: 'motif_derog',
  fabrication: 'fabrication',
  peremption: 'peremption',
  notes: 'notes',
}

/** Une ligne de la reception, reperee par son peg et son lot : deux pesees du meme lot s'additionnent. */
const cleLot = (l: LigneSaisie) => `${l.extra?.id_ligne_bc || l.code_reference}|${(l.extra?.lot ?? '').trim()}`

/**
 * Ce que le serveur attend pour UNE ligne de reception.
 *
 * LA PESEE EST EN KILOS, L'ARCHIVE DANS L'UNITE DECLAREE. Six decimales : la
 * colonne n'en garde que quatre, mais le serveur deduit les KILOS de ce nombre
 * avant que la base n'arrondisse. Arrondir ici deplacerait le poids RECU de
 * quelques grammes — et une reception fausse cree du stock qui n’existe pas.
 *
 * Facteur inconnu : on envoie des kilos plutot qu'un nombre faux dans une
 * unite qu'on ne sait pas convertir.
 */
/** Un compte de colis utilisable, ou rien. Une chaine vide n'est pas un zero. */
function nombreLigne(v: string, entier: boolean) {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n) || n < 0) return undefined
  // UNE BOBINE NE SE COUPE PAS ; une palette s'entame.
  return entier ? Math.round(n) : Number(n.toFixed(2))
}

function corpsReception(l: LigneSaisie) {
  const kg = Number(l.qte)
  const f = facteurVersKg(l.unite, l.cond)
  const e = l.extra ?? {}
  const nombre = (v: string | undefined) => {
    const n = Number(v)
    return v && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined
  }
  return {
    unite_saisie: f ? l.unite : 'kg',
    quantite_pesee_unite: f ? Number((kg / f).toFixed(6)) : kg,
    quantite_bl_kg: nombre(e.bl),
    // LES DEUX COMPTES PARTENT, lies ou detaches. Les retenir obligerait a
    // les rededuire a la lecture, et la deduction se trompe des que le
    // colisage reel s'ecarte du theorique — ce qui est la regle du quai.
    nb_palettes: nombreLigne(l.palettes, false),
    nb_bobines: nombreLigne(l.bobines, true),
    nb_colis_ligne: nombre(e.colis) != null ? Math.round(nombre(e.colis) as number) : undefined,
    lot_fournisseur: e.lot?.trim() || undefined,
    code_magasin_dest: e.magasin,
    statut_qualite: e.qualite,
    // LA DEROGATION SUR UNE LIGNE DEJA SAISIE (F11, 09/10/2026) : le refus
    // « ajoutez la derogation » menait nulle part sur une reception existante.
    derogation_ecart: e.derog === '1',
    motif_derogation: e.derog === '1' ? e.motif_derog?.trim() || undefined : undefined,
    // NOUVEAUX DANS LE CORPS (24/10/2026), seulement s'ils sont renseignes : la
    // route garde l'ancienne valeur pour un champ absent.
    date_fabrication: e.fabrication?.trim() || undefined,
    date_peremption: e.peremption?.trim() || undefined,
    notes: e.notes?.trim() || undefined,
  }
}
/**
 * LES TOTAUX DE LA RECEPTION : des QUANTITES, pas une facture.
 *
 * La reception est le document de celui qui compte sur le quai. Ses totaux
 * disent ce qui est arrive et de combien il s'ecarte de ce qu'on attendait —
 * du BL d'un cote, du bon de commande de l'autre. La TVA et le TTC n'ont rien
 * a faire ici : c'est la facture qui les porte, et elle releve de la
 * comptabilite. La seule valeur affichee est celle du STOCK entre, hors taxes.
 *
 * Les ecarts ne portent que sur les lignes qui ont un terme de comparaison :
 * une ligne sans quantite au BL ne doit pas creuser un faux ecart au BL.
 */
function TotauxReception({ lignes }: { lignes: LigneSaisie[] }) {
  const motsDeRef = useMotsUnite()
  if (lignes.length === 0) return null
  const n = (v?: string) => {
    const x = Number(v)
    return v != null && v.trim() !== '' && Number.isFinite(x) ? x : null
  }
  let kg = 0
  let palettes = 0
  let bobines = 0
  let bl = 0
  let kgAvecBl = 0
  let bc = 0
  let kgAvecBc = 0
  let valeur = 0
  let sansValeur = 0
  for (const l of lignes) {
    const k = n(l.qte) ?? 0
    kg += k
    palettes += n(l.palettes) ?? 0
    bobines += n(l.bobines) ?? 0
    const b = n(l.extra?.bl)
    if (b != null) {
      bl += b
      kgAvecBl += k
    }
    // Le bon une fois par ligne de bon ; ses lignes dedoublees pesent avec lui (07/11/2026).
    if (porteAttendu(l, lignes)) bc += l.suggere_kg ?? 0
    if (rattacheeAuBon(l, lignes)) kgAvecBc += k
    const pm = n(l.extra?.prix_mad)
    if (pm != null) valeur += k * pm
    else if (k > 0) sansValeur += 1
  }
  const ecart = (v: number) => (
    <span
      className={cn(
        'tabular-nums',
        Math.abs(v) > 0.001 && (v < 0 ? 'text-danger' : 'text-alerte'),
      )}
    >
      {v > 0 ? '+' : ''}
      {fmt.nombre(v, 2)} kg
    </span>
  )
  const cases: [string, ReactNode][] = [
    ['Poids reçu', <>{fmt.nombre(kg, 2)} kg</>],
    ['Palettes', fmt.nombre(palettes, 2)],
    [motsCommuns(lignes.map((l) => motsDeRef(l.code_reference))).Des, fmt.nombre(bobines, 0)],
    ['Annoncé au BL', bl ? <>{fmt.nombre(bl, 2)} kg · {ecart(kgAvecBl - bl)}</> : '—'],
    ['Attendu au BC', bc ? <>{fmt.nombre(bc, 2)} kg · {ecart(kgAvecBc - bc)}</> : '—'],
    ['Valeur du stock (HT)', fmt.mad(valeur)],
  ]
  return (
    <div className="border-t border-bordure px-3 py-2">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        {cases.map(([libelle, contenu]) => (
          <div key={libelle}>
            <dt className="text-[11px] uppercase tracking-wider text-attenue-texte">{libelle}</dt>
            <dd className="font-medium tabular-nums">{contenu}</dd>
          </div>
        ))}
      </dl>
      {sansValeur > 0 && (
        <p className="mt-1.5 text-[11px] text-attenue-texte">
          {sansValeur} ligne(s) pas encore enregistrée(s) : leur valeur sera connue après
          l’enregistrement, quand le serveur aura appliqué le prix du bon et le taux du jour.
        </p>
      )}
    </div>
  )
}


export function Reception() {
  const { id = '' } = useParams()
  /** Le mot du conditionnement de chaque reference (07/11/2026). */
  const motsDeRef = useMotsUnite()
  const droits = useDroits(MODULE)
  const { moi } = useAuth()
  const qc = useQueryClient()
  const naviguer = useNavigate()

  const [entete, setEntete] = useState({
    num_bon_livraison: '',
    numero_facture: '',
    transporteur: '',
    nombre_colis: '',
    poids_total_brut_kg: '',
    date_reception: '',
    id_dossier_import: '',
  })
  /*
   * UNE SEULE SOURCE POUR LES LIGNES, comme sur le bon de commande.
   *
   * `pesees` et `supprimees` tenaient chacun la moitie de la verite, et
   * l'enregistrement groupe devait les reconcilier. Sur le bon de commande, la
   * meme construction a fait disparaitre une ligne de 36 tonnes sans rien
   * signaler. Ici aussi elle supprimait puis recreait chaque ligne corrigee.
   */
  const [nouvelles, setNouvelles] = useState<LigneSaisie[]>([])
  const amorcee = useRef<string | null>(null)
  /** Ce que chaque ligne valait a son dernier enregistrement, par identifiant. */
  const [initiales, setInitiales] = useState<Map<string, string>>(new Map())
  /*
   * LES LIGNES DEJA ENREGISTREES QU’ON A RETIREES, et elles seules.
   *
   * On ne DEVINE plus une suppression a l'absence d'une ligne dans la grille :
   * c’est cette deduction qui a efface une ligne de 36 tonnes sur le bon de
   * commande. Une ligne n’est supprimee en base que si quelqu’un a clique sur
   * sa corbeille — et son identifiant est alors ecrit ici, noir sur blanc.
   */
  const [supprimees, setSupprimees] = useState<string[]>([])

  const qRec = useQuery({
    queryKey: ['receptions'],
    queryFn: ({ signal }) => api.get<Reception[]>('/api/receptions', { signal }),
  })
  const rec = qRec.data?.find((r) => r.id_reception === id) ?? null

  const qLignes = useQuery({
    queryKey: ['lignes-reception', id],
    queryFn: ({ signal }) => api.get<LigneRec[]>(`/api/receptions/${id}/lignes`, { signal }),
    enabled: !!id,
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['receptions'] })
    void qc.invalidateQueries({ queryKey: ['lignes-reception'] })
    void qc.invalidateQueries({ queryKey: ['lignes-attendues'] })
    void qc.invalidateQueries({ queryKey: ['stock-projete'] })
    void qc.invalidateQueries({ queryKey: ['bons-commande'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  useEffect(() => {
    if (!rec) return
    setEntete({
      num_bon_livraison: rec.num_bon_livraison ?? '',
      numero_facture: rec.numero_facture ?? '',
      transporteur: rec.transporteur ?? '',
      nombre_colis: rec.nombre_colis?.toString() ?? '',
      poids_total_brut_kg: rec.poids_total_brut_kg?.toString() ?? '',
      date_reception: rec.date_reception?.slice(0, 10) ?? '',
      id_dossier_import: rec.id_dossier_import ?? '',
    })
  }, [
    rec?.id_reception,
    rec?.num_bon_livraison,
    rec?.numero_facture,
    rec?.transporteur,
    rec?.nombre_colis,
    rec?.poids_total_brut_kg,
    rec?.date_reception,
    rec?.id_dossier_import,
  ])

  /* DECLARE AVANT L'EFFET QUI LE LIT. `const` n'est pas remonte : plus bas, il
     levait « used before its declaration » et la page entiere tombait. */
  const modifiable =
    !!droits.peutEcrire && (rec?.statut === 'BROUILLON' || rec?.statut === 'A_CONTROLER')

  const lignesServeur = useMemo(() => qLignes.data ?? [], [qLignes.data])

  /*
   * LES LIGNES PESEES ENTRENT DANS LA GRILLE, une fois par reception.
   *
   * On n'amorce que sur `isSuccess`, jamais sur « plus en chargement » : une
   * requete EN ERREUR n'est pas en chargement, et franchirait le garde avec
   * zero ligne — la grille resterait vide pour de bon, meme apres reparation.
   */
  useEffect(() => {
    if (!modifiable || !id || !qLignes.isSuccess) return
    if (amorcee.current === id) return
    amorcee.current = id
    const chargees = lignesServeur.map(depuisLigneReception)
    setInitiales(
      new Map(chargees.map((l) => [l.idExistant as string, JSON.stringify(corpsReception(l))])),
    )
    setNouvelles(chargees)
  }, [id, modifiable, qLignes.isSuccess, lignesServeur])

  const qMagasins = useQuery({
    queryKey: ['magasins'],
    queryFn: () =>
      api.get<{ code_magasin: string; nom: string; est_quarantaine: number }[]>(
        '/api/magasins',
      ),
  })

  /* AU BUREAU, LA GRILLE ; SOUS 768 PX, LES CARTES ET LA FEUILLE (24/10/2026). */
  const estMobile = useEstMobile()

  /* LE CONDITIONNEMENT DU LOT relie pesee, palettes et bobines a la frappe ;
     l'unite d'archivage reste convertie par la fiche article, comme au
     serveur (`vers_kg`). */
  const { condLot } = useConditionnementsLots(
    nouvelles.filter((l) => (l.extra?.lot ?? '').trim()).map((l) => l.code_reference),
  )
  const condLiaison = (l: LigneSaisie) =>
    conditionnementDuLot(l.cond, condLot(l.code_reference, l.extra?.lot ?? ''))
  const relier = (l: LigneSaisie, source: ChampColis, valeur: string) =>
    lierColis(l, source, valeur, condLiaison(l))

  /*
   * LES BONS DE COMMANDE DE CE CAMION (16/10/2026).
   *
   * On ne demande plus au magasinier quel DOSSIER d'import il vide : il ne le
   * connait pas. Il connait son BL, son conteneur et ses bons. C'est la
   * FACTURE qui relie l'importation au bon et a la reception, donc le dossier
   * se deduit des bons retenus — avec sa DUM et ses conteneurs.
   *
   * Liste vide = tous les bons en cours du fournisseur, c'est-a-dire le
   * comportement d'avant : un camion arrive avec ce qui etait pret.
   */
  const [bonsRetenus, setBonsRetenus] = useState<string[]>([])
  const basculerBon = (id_bc: string) =>
    setBonsRetenus((b) => (b.includes(id_bc) ? b.filter((x) => x !== id_bc) : [...b, id_bc]))

  /*
   * CE QUE LE BON DE COMMANDE ATTEND ENCORE, propose comme references.
   *
   * C'est l'equivalent du plan d'achat sur un bon : ce qui reste a livrer chez
   * ce fournisseur. Le catalogue entier reste accessible — une livraison hors
   * commande arrive, et la refuser ne la ferait pas disparaitre du quai.
   */
  const qAttendues = useQuery({
    queryKey: ['lignes-attendues', id, rec?.code_fournisseur],
    queryFn: () =>
      api.get<LigneAttendue[]>(
        `/api/lignes-attendues?id_reception=${id}&code_fournisseur=${encodeURIComponent(
          rec?.code_fournisseur ?? "",
        )}`,
      ),
    enabled: !!id && !!rec?.code_fournisseur,
  })

  const proposees = useMemo<RefLigne[]>(
    () =>
      (qAttendues.data ?? [])
        .filter((a) => a.quantite_restante_kg > 0.001)
        // CADRE PAR LES BONS DU CAMION : un fournisseur peut devoir dix bons,
        // le camion n'en porte qu'un ou deux. Aucun bon retenu = tout, pour ne
        // pas obliger a cocher avant de peser.
        .filter((a) => bonsRetenus.length === 0 || bonsRetenus.includes(a.id_bc))
        .map((a) => ({
          code_reference: a.code_reference,
          designation: a.designation,
          unite_catalogue: a.unite_catalogue,
          code_fournisseur: rec?.code_fournisseur ?? null,
          // LE PEG (ADR-003 D2) : la pesee sert CETTE ligne de bon. Sans lui,
          // la ligne entrait sans engagement et le serveur devait inventer un
          // bon de regularisation pour une marchandise bel et bien commandee.
          id_ligne_bc: a.id_ligne_bc,
          numero_bc: a.numero_bc,
          poids_bobine_kg: a.poids_bobine_kg,
          bobines_par_palette: a.bobines_par_palette,
          bobines_par_lot: a.bobines_par_lot,
          densite_kg_ml: a.densite_kg_ml,
          // Le RESTE a livrer sert de proposition : c’est ce qu’on attend,
          // et c’est presque toujours ce qui arrive.
          qte_a_commander_kg: a.quantite_restante_kg,
          prix_suggere_devise: a.prix_kg_devise,
          // Pour l'ecran seul : une reference suivie au lot se compte en bobines.
          suivi_lot: a.suivi_lot,
        })),
    [qAttendues.data, rec?.code_fournisseur, bonsRetenus],
  )

  /* Les bons que ce fournisseur doit encore, tires des lignes attendues
     elles-memes : pas d'appel supplementaire pour peupler le choix. */
  const bonsAttendus = useMemo(() => {
    const parBon = new Map<
      string,
      {
        id_bc: string
        numero_bc: string
        date_livraison_prevue: string | null
        lignes: number
        reste_kg: number
        dossier_numero?: string | null
        dossier_conteneurs?: string | null
      }
    >()
    for (const a of qAttendues.data ?? []) {
      if (a.quantite_restante_kg <= 0.001) continue
      const v = parBon.get(a.id_bc)
      if (v) {
        v.lignes += 1
        v.reste_kg += a.quantite_restante_kg
      } else {
        parBon.set(a.id_bc, {
          id_bc: a.id_bc,
          numero_bc: a.numero_bc,
          date_livraison_prevue: a.date_livraison_prevue,
          lignes: 1,
          reste_kg: a.quantite_restante_kg,
          dossier_numero: a.dossier_numero,
          dossier_conteneurs: a.dossier_conteneurs,
        })
      }
    }
    return [...parBon.values()]
  }, [qAttendues.data])

  /* LE DOSSIER DEDUIT des bons retenus. Plusieurs dossiers = on ne devine pas,
     on les montre tous : le serveur ne rattachera rien plutot que de se
     tromper, et c'est a l'ecran de le dire. */
  const dossiersDeduits = useMemo(() => {
    const vus = new Map<string, { numero: string; dum?: string | null; conteneurs?: string | null }>()
    for (const a of qAttendues.data ?? []) {
      if (!a.id_dossier || !a.dossier_numero) continue
      if (bonsRetenus.length > 0 && !bonsRetenus.includes(a.id_bc)) continue
      vus.set(a.id_dossier, {
        numero: a.dossier_numero,
        dum: a.dossier_dum,
        conteneurs: a.dossier_conteneurs,
      })
    }
    return [...vus.values()]
  }, [qAttendues.data, bonsRetenus])

  const chercherCatalogue = async (motif: string): Promise<RefLigne[]> => {
    const q = new URLSearchParams({
      code_fournisseur: rec?.code_fournisseur ?? '',
      toutes: '1',
      recherche: motif,
      limite: '25',
    })
    return api.get<RefLigne[]>(`/api/references-commandables?${q}`)
  }

  /** Retirer une ligne : de l'ecran tout de suite, de la base a l'enregistrement. */
  const retirerLigne = (ligne: LigneSaisie) => {
    if (ligne.idExistant) setSupprimees((s) => [...s, ligne.idExistant as string])
    setNouvelles((ls) => ls.filter((x) => x.cle !== ligne.cle))
  }

  /* LA SAISIE SUR LA LIGNE, AU BUREAU (24/10/2026) : chaque case de la grille
     ecrit ici, dans la meme `LigneSaisie` que la feuille du telephone. */
  const poserLigne = (cle: string, champ: ChampRec, v: string | boolean) =>
    setNouvelles((ls) =>
      ls.map((l) => {
        if (l.cle !== cle) return l
        if (champ === 'qte') return relier(l, 'quantite', String(v))
        if (champ === 'palettes' || champ === 'bobines') return relier(l, champ, String(v))
        if (champ === 'unite') return { ...l, unite: String(v) }
        if (champ === 'lie') return { ...l, lie: !!v }
        if (champ === 'derogation') return { ...l, extra: { ...l.extra, derog: v ? '1' : '' } }
        const k = EXTRA_DE[champ]
        return k ? { ...l, extra: { ...l.extra, [k]: String(v) } } : l
      }),
    )

  /* VALIDER UNE LIGNE A L'ECRAN, comme sur le bon (validation par ligne) : elle
     se fige jusqu'au crayon. Une NOUVELLE pesee du meme lot qu'une ligne deja
     la s'y additionne (une ligne par reference et par lot, 21/10/2026). */
  const basculerValidation = (cle: string) => {
    const l = nouvelles.find((x) => x.cle === cle)
    if (!l) return
    if (!l.valide && !l.idExistant) {
      const meme = nouvelles.find((x) => x.cle !== cle && cleLot(x) === cleLot(l))
      if (meme) {
        setNouvelles((ls) =>
          ls.filter((x) => x.cle !== cle).map((x) => (x.cle === meme.cle ? fondrePesee(x, l) : x)),
        )
        toast.info(
          `${l.code_reference} : même lot que la ligne ${nouvelles.indexOf(meme) + 1}, la pesée s’y ajoute (une ligne par lot).`,
        )
        return
      }
    }
    setNouvelles((ls) => ls.map((x) => (x.cle === cle ? { ...x, valide: !x.valide } : x)))
  }

  /* AJOUTER UNE LIGNE : ce que les bons attendent d'abord, puis tout le
     catalogue (livraison hors commande). Meme ligne que sur le telephone :
     magasin hors quarantaine par defaut, qualite conforme. */
  const ajouterLigne = (ref: RefLigne) => {
    const nl = depuisReference(ref)
    const parDefaut = qMagasins.data?.find((m) => m.est_quarantaine !== 1)?.code_magasin ?? ''
    setNouvelles((ls) => [
      ...ls,
      {
        ...nl,
        extra: { ...nl.extra, magasin: parDefaut, qualite: 'CONFORME', suivi_lot: ref.suivi_lot === 1 ? '1' : '' },
      },
    ])
    setTimeout(() => allerALaLigne(nl.cle), 60)
  }
  const chercherAjout = async (motif: string): Promise<Suggestion[]> => {
    const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
    const pesees = new Set(nouvelles.map((l) => l.extra?.id_ligne_bc).filter(Boolean))
    const attendues = proposees.filter((p) =>
      mots.every((m) => `${p.code_reference} ${p.designation ?? ''} ${p.numero_bc ?? ''}`.toLowerCase().includes(m)),
    )
    const catalogue = motif.trim().length >= 2 ? await chercherCatalogue(motif) : []
    const attenduesCodes = new Set(proposees.map((p) => p.code_reference))
    return [
      ...attendues.map((p) => ({
        valeur: p.id_ligne_bc ?? p.code_reference,
        titre: `${p.code_reference}${p.numero_bc ? ` · ${p.numero_bc}` : ''}`,
        detail: p.designation,
        mention: pesees.has(p.id_ligne_bc ?? '')
          ? 'déjà pesée — même lot : s’ajoute'
          : `reste ${fmt.nombre(p.qte_a_commander_kg ?? 0, 0)} kg`,
        ton: (pesees.has(p.id_ligne_bc ?? '') ? 'alerte' : 'primaire') as Suggestion['ton'],
        charge: p,
      })),
      ...catalogue
        .filter((r) => !attenduesCodes.has(r.code_reference))
        .map((r) => ({
          valeur: r.code_reference,
          titre: r.code_reference,
          detail: r.designation,
          mention: 'hors commande',
          ton: 'neutre' as const,
          charge: r,
        })),
    ]
  }

  const enteteModifie =
    !!rec &&
    (entete.num_bon_livraison !== (rec.num_bon_livraison ?? '') ||
      entete.numero_facture !== (rec.numero_facture ?? '') ||
      entete.transporteur !== (rec.transporteur ?? '') ||
      entete.nombre_colis !== (rec.nombre_colis?.toString() ?? '') ||
      entete.poids_total_brut_kg !== (rec.poids_total_brut_kg?.toString() ?? '') ||
      entete.date_reception !== (rec.date_reception?.slice(0, 10) ?? '') ||
      entete.id_dossier_import !== (rec.id_dossier_import ?? ''))

  const lignes = qLignes.data ?? []
  /* UN MAGASIN DE DESTINATION GELE PAR UN INVENTAIRE OUVERT (23/10/2026) : la
     validation, qui fait entrer le stock, sera refusee par la base — tout le
     magasin pour un global, ses seules references pour un tournant ou un cible
     (2026-10-24a). */
  const gel = useGelInventaire(
    lignes.map((l) => l.code_magasin_dest),
    lignes.map((l) => ({ magasin: l.code_magasin_dest, reference: l.code_reference })),
  )

  /* CE QUI PARTIRA A L'ENREGISTREMENT, calcule a partir de la grille seule. */
  const aCreer = nouvelles.filter((n) => !n.idExistant)
  const aCorriger = nouvelles.filter(
    (n) => n.idExistant && JSON.stringify(corpsReception(n)) !== initiales.get(n.idExistant),
  )
  const nonValidees = nouvelles.filter((n) => !n.valide)
  const aEnregistrer =
    enteteModifie || supprimees.length > 0 || aCreer.length > 0 || aCorriger.length > 0

  /**
   * LA VERSION SUR LAQUELLE REPOSE LA SAISIE (verrou optimiste, 17/10/2026).
   * Meme regle que le bon de commande : sans modification en attente, on suit
   * la derniere version ; des qu'une modification attend, elle se fige. Envoyer
   * `rec.version` au moment d'enregistrer desarmerait le verrou, la liste se
   * relisant toute seule.
   */
  const [versionLue, setVersionLue] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (rec?.version != null && !aEnregistrer) setVersionLue(rec.version)
  }, [rec?.version, aEnregistrer])

  /**
   * L'EN-TETE ET LES LIGNES PARTENT ENSEMBLE, sur le bouton du bas.
   *
   * Le petit bouton de chaque ligne ne fait que la VALIDER a l'ecran. Rien
   * n'est ecrit en base avant ce clic-ci — et il refuse de partir tant qu'une
   * ligne n'est pas validee, pour qu'on n'enregistre jamais une ligne a moitie
   * relue.
   *
   * UNE SEULE SOURCE : la grille. Les suppressions viennent du registre ecrit
   * par la corbeille, jamais d'une deduction. Les corrections passent par le
   * PATCH, qui garde le numero de la ligne et n'inscrit pas une suppression au
   * journal pour une virgule deplacee.
   */
  const enregistrer = useMutation({
    mutationFn: async () => {
      // LA VERSION S'ENCHAINE (19/10/2026) : en-tete puis lignes, chacun sous le
      // verrou du document ; chaque reponse rend la version que le suivant presente.
      let v = versionLue
      const suivre = (r: { version?: number }) => { v = r.version ?? v }
      if (enteteModifie) {
        suivre(await api.patch<{ version?: number }>(`/api/receptions/${id}`, {
          version: v,
          num_bon_livraison: entete.num_bon_livraison || undefined,
          numero_facture: entete.numero_facture || undefined,
          transporteur: entete.transporteur || undefined,
          nombre_colis: entete.nombre_colis ? Number(entete.nombre_colis) : undefined,
          poids_total_brut_kg: entete.poids_total_brut_kg
            ? Number(entete.poids_total_brut_kg)
            : undefined,
          date_reception: entete.date_reception || undefined,
          // VIDE = DETACHER, absent = ne pas y toucher. Sans ce signe, un
          // dossier rattache par erreur ne pourrait plus s'enlever.
          id_dossier_import:
            entete.id_dossier_import !== (rec?.id_dossier_import ?? '')
              ? entete.id_dossier_import
              : undefined,
        }))
      }
      for (const ligne of supprimees) {
        suivre(await api.delete<{ version?: number }>(`/api/receptions/${id}/lignes/${ligne}?version=${v ?? ''}`))
      }
      for (const n of aCorriger) {
        suivre(await api.patch<{ version?: number }>(`/api/receptions/${id}/lignes/${n.idExistant}`, { ...corpsReception(n), version: v }))
      }
      for (const n of aCreer) {
        suivre(await api.post<{ version?: number }>(`/api/receptions/${id}/lignes`, {
          ...corpsReception(n),
          code_reference: n.code_reference,
          id_ligne_bc: n.extra?.id_ligne_bc,
          version: v,
        }))
      }
      return { crees: aCreer.length, corrigees: aCorriger.length, retirees: supprimees.length }
    },
    onSuccess: (r) => {
      const parts = [
        r.crees ? `${r.crees} ajoutée(s)` : null,
        r.corrigees ? `${r.corrigees} corrigée(s)` : null,
        r.retirees ? `${r.retirees} retirée(s)` : null,
      ].filter(Boolean)
      toast.success('Réception enregistrée', {
        description: parts.length ? `Lignes : ${parts.join(' · ')}.` : undefined,
      })
      setSupprimees([])
      // La grille se recharge depuis le serveur : c'est lui qui detient
      // desormais les identifiants des lignes qu'on vient de creer.
      amorcee.current = null
      rafraichir()
    },
    onError: echec,
  })

  /* LE RENVOI AU MAGASINIER (regle 4, 09/10/2026), saisi sur la page : au
     controle, la pesee est figee ; une erreur se renvoie avec ce qu'il faut
     corriger, elle ne se corrige pas par celui qui validera. */
  const [renvoi, setRenvoi] = useState<string | null>(null)
  const changerStatut = useMutation({
    mutationFn: (c: { statut: string; motif?: string }) => api.put(`/api/receptions/${id}/statut`, c),
    onSuccess: (_r, c) => {
      toast.success(c.statut === 'BROUILLON' ? 'Réception renvoyée au magasinier' : 'Réception soumise au contrôle qualité')
      setRenvoi(null)
      rafraichir()
    },
    onError: echec,
  })

  const confirmation = useConfirmation()
  const valider = useMutation({
    mutationFn: () => api.post(`/api/receptions/${id}/valider`),
    onSuccess: () => {
      toast.success('Réception validée', {
        description: 'Stock, CMUP, archive et historique de prix mis à jour en une transaction.',
      })
      rafraichir()
    },
    onError: echec,
  })

  /*
   * PLUS DE FUSION ENTRE LE SERVEUR ET UN BROUILLON LOCAL.
   *
   * L'ecran melangeait les lignes du serveur et les pesees pas encore
   * envoyees, en fabriquant pour celles-ci de faux identifiants « pesee: » et
   * de faux ecarts calcules a la main. Deux verites coexistaient, et les
   * ecarts affiches n'etaient pas ceux que le serveur calculerait.
   *
   * Desormais la grille tient les lignes modifiables et le tableau n'affiche
   * que ce que le serveur a vraiment enregistre.
   */
  const lignesAffichees: LigneRec[] = lignes
  /** Un EXCEDENT au-dela exige une derogation motivee (C10) ; un manque, non. Tolerance du fournisseur. */
  const TOLERANCE_PCT = useToleranceFournisseur(rec?.code_fournisseur)

  const horsTolerance = useMemo(
    () => lignesAffichees.filter((l) => (l.ecart_pct ?? 0) > TOLERANCE_PCT).length,
    [lignesAffichees, TOLERANCE_PCT],
  )

  const colonnes: ColonneDT<LigneRec>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{l.code_reference}</div>
          <div className="truncate text-[11px] text-attenue-texte">{l.reference_designation}</div>
        </div>
      ),
    },
    {
      champ: 'quantite_pesee_unite',
      entete: 'Pesee',
      numerique: true,
      largeur: '140px',
      rendu: (l) => (
        <div className="text-right">
          <div className="tabular-nums font-medium">
            {fmt.nombre(l.quantite_pesee_unite, 2)} {l.unite_saisie}
          </div>
          {l.unite_saisie !== 'kg' && (
            <div className="text-[11px] text-attenue-texte tabular-nums">
              {fmt.nombre(l.quantite_stock_kg, 2)} kg
            </div>
          )}
        </div>
      ),
    },
    {
      // Ce que le fournisseur DECLARE sur son bon de livraison. L'ecart avec la
      // pesee est un litige de transport ou de declaration — il n'a rien a voir
      // avec l'ecart de commande, qui mesure un reliquat.
      champ: 'quantite_bl_kg',
      entete: 'Annonce BL',
      numerique: true,
      largeur: '130px',
      rendu: (l) =>
        l.quantite_bl_kg == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right">
            <div className="tabular-nums">{fmt.nombre(l.quantite_bl_kg, 2)} kg</div>
            {l.ecart_bl_kg != null && Math.abs(l.ecart_bl_kg) > 0.001 && (
              <div className="text-[11px] tabular-nums text-danger">
                {l.ecart_bl_kg > 0 ? '+' : ''}
                {fmt.nombre(l.ecart_bl_kg, 2)} kg pese
              </div>
            )}
          </div>
        ),
    },
    {
      champ: 'quantite_commandee_kg',
      entete: 'Attendu',
      numerique: true,
      largeur: '120px',
      rendu: (l) =>
        l.quantite_commandee_kg == null ? (
          <span className="text-attenue-texte">hors commande</span>
        ) : (
          <span className="tabular-nums">{fmt.nombre(l.quantite_commandee_kg, 0)} kg</span>
        ),
    },
    {
      // LES COLIS COMPTES AU QUAI (24/10/2026) : ils manquaient a la table de
      // la reception validee, alors qu'ils entrent au stock avec le lot.
      champ: 'nb_palettes',
      entete: 'Pal. · unités',
      numerique: true,
      largeur: '110px',
      rendu: (l) =>
        l.nb_palettes == null && l.nb_bobines == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right tabular-nums">
            <div>{l.nb_palettes == null ? '—' : fmt.nombre(l.nb_palettes, 2)} pal.</div>
            <div className="text-[11px] text-attenue-texte">
              {l.nb_bobines == null ? '—' : fmt.nombre(l.nb_bobines, 0)} {motsDeRef(l.code_reference).court}
            </div>
          </div>
        ),
    },
    {
      champ: 'ecart_pct',
      entete: 'Écart',
      numerique: true,
      largeur: '110px',
      rendu: (l) => {
        if (l.ecart_pct == null) return <span className="text-attenue-texte">—</span>
        const hors = l.ecart_pct > TOLERANCE_PCT
        return (
          <span className={cn('tabular-nums', hors && 'font-medium text-danger')}>
            {l.ecart_pct > 0 ? '+' : ''}
            {fmt.nombre(l.ecart_pct, 1)} %
          </span>
        )
      },
    },
    {
      champ: 'ecart_cmd_kg',
      entete: 'Écart commande',
      numerique: true,
      largeur: '130px',
      secondaire: true,
      rendu: (l) =>
        l.ecart_cmd_kg == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className={cn('tabular-nums', l.ecart_cmd_kg < 0 && 'text-alerte')}>
            {l.ecart_cmd_kg > 0 ? '+' : ''}
            {fmt.nombre(l.ecart_cmd_kg, 2)} kg
          </span>
        ),
    },
    {
      // Un poids par colis inhabituel revele un conditionnement different de
      // celui negocie : c'est ce qui se voit avant que le stock ne l'absorbe.
      champ: 'nb_colis_ligne',
      entete: 'Colis (BL)',
      numerique: true,
      largeur: '110px',
      secondaire: true,
      rendu: (l) =>
        l.nb_colis_ligne == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right">
            <div className="tabular-nums">{fmt.entier(l.nb_colis_ligne)}</div>
            {l.poids_moyen_colis_kg != null && (
              <div className="text-[11px] tabular-nums text-attenue-texte">
                {fmt.nombre(l.poids_moyen_colis_kg, 2)} kg/colis
              </div>
            )}
          </div>
        ),
    },
    {
      champ: 'lot_fournisseur',
      entete: 'Lot',
      largeur: '150px',
      rendu: (l) => l.lot_fournisseur ?? <span className="text-attenue-texte">—</span>,
    },
    {
      champ: 'code_magasin_dest',
      entete: 'Magasin',
      largeur: '110px',
      rendu: (l) => l.code_magasin_dest,
    },
    {
      champ: 'statut_qualite',
      entete: 'Qualité',
      largeur: '140px',
      rendu: (l) => (
        <StatutBadge entite="statut_qualite" code={l.statut_qualite} />
      ),
    },
    {
      champ: 'prix_kg_mad',
      entete: 'Prix MAD/kg',
      numerique: true,
      largeur: '120px',
      rendu: (l) =>
        l.prix_kg_mad == null ? (
          <span className="text-attenue-texte">a la validation</span>
        ) : (
          fmt.nombre(l.prix_kg_mad, 4)
        ),
    },
    /* LA COLONNE « ETAT » A DISPARU. Elle distinguait « nouvelle », « a
       retirer » et « enregistree » — trois etats qui n'existaient que le temps
       d'un brouillon local. Maintenant qu'une ligne part au serveur au moment
       ou on la valide, ce tableau ne montre que des lignes enregistrees : la
       colonne n'aurait plus qu'un seul mot a dire. */
  ]

  if (qRec.isLoading) return <Chargement />
  if (!rec) {
    return (
      <div>
        <EnTetePage titre="Réception" description="Introuvable." />
        <Alerte ton="alerte">
          Cette reception n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/receptions')}>
            Revenir à la liste
          </button>
        </Alerte>
      </div>
    )
  }

  /* B4 : celui qui a pese EN DERNIER ne valide pas (regle 4) — la base le
     refuse ; l'ecran le dit avant. */
  const estPeseur = rec.id_utilisateur_pesee
    ? rec.id_utilisateur_pesee === moi?.id
    : rec.receptionnaire === moi?.login

  /* AU CONTROLE, LA PESEE EST FIGEE (regle 4, 09/10/2026) — c'est le serveur
     qui le dit : la correction d'une ligne A_CONTROLER refuse tout changement
     de quantite, d'unite, de BL, de colis, de palettes, de bobines, de lot ou
     de derogation (PESEE_FIGEE) ; l'ajout et le retrait d'une ligne y sont
     refuses. Restent la qualite, le magasin, les dates et les observations de
     chaque ligne, et l'en-tete. L'ecran fige donc ce que le serveur fige. */
  const peseeFigee = rec.statut === 'A_CONTROLER'
  const enBrouillon = rec.statut === 'BROUILLON'

  /* LE LOT INTERNE, ANNONCE AVANT D'ETRE POSE (01/10/2026). Une reference
     suivie sans lot recoit a la validation un lot FOURNISSEUR-JJMMAA-NN
     (domain/reception.rs). On fait confirmer : on peut encore saisir le vrai
     lot a la place. */
  const lancerValidation = () => {
    const aGenerer = lignes.filter((l) => l.suivi_lot === 1 && !(l.lot_fournisseur ?? '').trim())
    const [aa, mm, jj] = (rec.date_reception ?? '').slice(0, 10).split('-')
    const prefixeLot = `${(rec.fournisseur_nom ?? '').trim().split(' ')[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase()}-${jj ?? ''}${mm ?? ''}${(aa ?? '').slice(2)}`
    if (aGenerer.length === 0) return valider.mutate()
    confirmation.demander({
      titre: `${aGenerer.length} ligne(s) sans lot fournisseur`,
      libelleConfirmer: 'Générer les lots et valider',
      description: (
        <>
          Le fournisseur n’a pas mis de lot : chaque ligne recevra un lot interne, pour
          que cette livraison ne se mélange pas aux autres.
          <ul className="mt-2 space-y-0.5 font-mono text-[12px]">
            {aGenerer.map((l) => (
              <li key={l.id_ligne_reception}>
                {l.code_reference} → {prefixeLot}-NN
              </li>
            ))}
          </ul>
          <span className="mt-2 block">Pour saisir le vrai lot à la place, annulez et corrigez la ligne.</span>
        </>
      ),
      action: () => valider.mutate(),
    })
  }

  /* LA GRILLE DU BUREAU : ce que montre chaque ligne, lu de la saisie. */
  const attenduesParLigne = new Map((qAttendues.data ?? []).map((a) => [a.id_ligne_bc, a]))
  const vues: VueLigneRec[] = nouvelles.map((l) => {
    const e = l.extra ?? {}
    // En lecture, pour le detail de la ligne : ce que son bon engage et promet.
    const a = e.id_ligne_bc ? attenduesParLigne.get(e.id_ligne_bc) : undefined
    return {
      cle: l.cle,
      code_reference: l.code_reference,
      code_recu: l.code_reference,
      designation: l.intitule,
      numero_bc: e.numero_bc || null,
      // Net des lignes dedoublees de la meme ligne de bon (07/11/2026).
      reste_kg: attenduNet(l, nouvelles),
      suivi_lot: e.suivi_lot === '1',
      qteBl: e.bl ?? '',
      qte: l.qte,
      unite: l.unite,
      unites: unitesDe(l),
      convertible: l.unite === 'kg' || facteurVersKg(l.unite, l.cond) !== null,
      palettes: l.palettes,
      bobines: l.bobines,
      lie: l.lie,
      liaisonOfferte: true,
      lot: e.lot ?? '',
      magasin: e.magasin ?? '',
      qualite: e.qualite ?? 'CONFORME',
      derogation: e.derog === '1',
      motifDerogation: e.motif_derog ?? '',
      fabrication: e.fabrication ?? '',
      peremption: e.peremption ?? '',
      notes: e.notes ?? '',
      colis: e.colis ?? '',
      equivalents: [],
      motif_substitution: '',
      cond: condLiaison(l),
      mots: motsDeRef(l.code_reference),
      valide: !!l.valide,
      devise: a?.code_devise ?? null,
      // Sans la ligne attendue (pas encore lue), rien : une devise devinee tromperait.
      prix_engage: a?.prix_kg_devise ?? null,
      date_promise: a?.date_livraison_prevue ?? null,
    }
  })

  /* LES INDICATEURS DE LA BARRE (24/10/2026), sur la saisie en cours — ou,
     pour qui ne fait que valider, sur les lignes enregistrees. */
  const saisie = modifiable ? nouvelles : lignesServeur.map(depuisLigneReception)
  const nombreDe = (v?: string) => {
    const x = Number(v)
    return v != null && v.trim() !== '' && Number.isFinite(x) ? x : null
  }
  const kgL = (l: LigneSaisie) => nombreDe(l.qte) ?? 0
  const avecBl = saisie.filter((l) => nombreDe(l.extra?.bl) != null)
  const ecartBl = avecBl.reduce((s, l) => s + kgL(l) - (nombreDe(l.extra?.bl) ?? 0), 0)
  // Une ligne de bon compte une fois ; ses lignes dedoublees pesent avec elle (07/11/2026).
  const avecBc = saisie.filter((l) => porteAttendu(l, saisie))
  const totalBc = avecBc.reduce((s, l) => s + (l.suggere_kg ?? 0), 0)
  const ecartBc = saisie.filter((l) => rattacheeAuBon(l, saisie)).reduce((s, l) => s + kgL(l), 0) - totalBc
  const palettesComptees = saisie.reduce((s, l) => s + (nombreDe(l.palettes) ?? 0), 0)
  const bobinesComptees = saisie.reduce((s, l) => s + (nombreDe(l.bobines) ?? 0), 0)
  const motsBarre = saisie.length ? motsCommuns(saisie.map((l) => motsDeRef(l.code_reference))) : MOTS_BOBINE
  const palettesAttendues = avecBc.reduce((s, l) => s + (depuisKg(l.suggere_kg, condLiaison(l)).palettes ?? 0), 0)
  const bobinesAttendues = avecBc.reduce((s, l) => s + (depuisKg(l.suggere_kg, condLiaison(l)).bobines ?? 0), 0)
  const aCompter = saisie.filter(
    (l) => l.extra?.suivi_lot === '1' && Number(l.cond.poids_bobine_kg) > 0 && !(nombreDe(l.bobines) ?? 0),
  )
  const rangDe = (l: LigneSaisie) => saisie.findIndex((x) => x.cle === l.cle) + 1
  const noms = (ls: LigneSaisie[]) => ls.map((l) => `L${rangDe(l)} ${l.code_reference}`).join(', ')
  const lignesHors = saisie
    .filter((l) => (ecartPct(l.qte, attenduNet(l, saisie)) ?? 0) > TOLERANCE_PCT)
    .map((l) => ({
      cle: l.cle,
      rang: rangDe(l),
      code: l.code_reference,
      derogee: l.extra?.derog === '1' && !!(l.extra?.motif_derog ?? '').trim(),
    }))
  const indicateurs: IndicateurRec[] = [
    { libelle: 'Lignes', valeur: saisie.length, mot: 'pesée(s)', ton: saisie.length ? 'neutre' : 'alerte' },
    { libelle: 'Pesé', valeur: `${fmt.nombre(saisie.reduce((s, l) => s + kgL(l), 0), 2)} kg` },
    ...(avecBl.length
      ? [{
          libelle: 'BL',
          secondaire: true,
          valeur: texteEcartKg(ecartBl),
          mot: Math.abs(ecartBl) <= 0.001 ? 'conforme' : 'écart',
          ton: tonEcartKg(ecartBl),
          titre: 'Écart de la pesée à ce que le bon de livraison annonce (litige de transport)',
        }]
      : []),
    ...(avecBc.length
      ? [{
          libelle: 'Bon',
          secondaire: true,
          valeur: `${fmt.nombre(totalBc, 2)} kg · ${texteEcartKg(ecartBc)}`,
          mot: Math.abs(ecartBc) <= 0.001 ? 'soldé' : ecartBc < 0 ? 'reliquat' : 'excédent',
          ton: tonEcartKg(ecartBc),
          titre: 'Ce que les bons attendaient au moment de la pesée, et l’écart',
        }]
      : []),
    {
      libelle: 'Palettes',
      secondaire: true,
      valeur: `${fmt.nombre(palettesComptees, 2)} / ${fmt.nombre(palettesAttendues, 0)}`,
      mot: palettesAttendues ? (Math.abs(palettesComptees - palettesAttendues) < 0.005 ? 'conforme' : 'écart') : 'comptées',
      ton: palettesAttendues ? (Math.abs(palettesComptees - palettesAttendues) < 0.005 ? 'succes' : 'alerte') : 'neutre',
      titre: 'Palettes comptées / attendues au bon (déduites de l’attendu par le conditionnement)',
    },
    {
      libelle: motsBarre.Des,
      secondaire: true,
      valeur: `${fmt.nombre(bobinesComptees, 0)} / ${fmt.nombre(bobinesAttendues, 0)}`,
      mot: aCompter.length
        ? `${aCompter.length} à compter`
        : bobinesAttendues
          ? Math.abs(bobinesComptees - bobinesAttendues) < 0.5 ? 'conforme' : 'écart'
          : 'comptées',
      ton: aCompter.length
        ? 'alerte'
        : bobinesAttendues
          ? Math.abs(bobinesComptees - bobinesAttendues) < 0.5 ? 'succes' : 'alerte'
          : 'neutre',
      titre: `${motsBarre.Des} comptés / attendus au bon (déduits de l’attendu par le conditionnement)`,
    },
  ]
  const sansQte = saisie.filter((l) => !(Number(l.qte) > 0))
  const sansDerogation = lignesHors.filter((h) => !h.derogee)
  const blocages: MessageRec[] = [
    ...(nonValidees.length
      ? [{
          texte: estMobile
            ? `${nonValidees.length} ligne(s) à valider avec « Valider la ligne » avant d’enregistrer.`
            : `${nonValidees.length} ligne(s) à valider avec le bouton ✓ de la ligne avant d’enregistrer.`,
          cle: nonValidees[0].cle,
        }]
      : []),
    ...(sansQte.length ? [{ texte: `quantité pesée manquante — ${noms(sansQte)}.`, cle: sansQte[0].cle }] : []),
    ...(enBrouillon && !aEnregistrer && nouvelles.length === 0 ? [{ texte: 'aucune ligne pesée : rien à soumettre au contrôle.' }] : []),
    ...(rec.statut === 'A_CONTROLER' && !aEnregistrer && droits.peutValider && estPeseur
      ? [{ texte: 'B4 : vous avez pesé ou corrigé cette réception — un autre compte la valide.' }]
      : []),
    ...(rec.statut === 'A_CONTROLER' && !aEnregistrer && droits.peutValider && gel.length > 0
      ? [{ texte: phraseGel(gel, true) ?? 'un inventaire ouvert gèle un magasin de destination.' }]
      : []),
  ]
  const avis: MessageRec[] = [
    ...(sansDerogation.length
      ? [{
          texte: `excédent au-delà de la tolérance (${fmt.nombre(TOLERANCE_PCT, 1)} %) sans dérogation motivée — ${sansDerogation.map((h) => `L${h.rang} ${h.code}`).join(', ')} : le serveur refusera la soumission.`,
          cle: sansDerogation[0].cle,
        }]
      : []),
    ...(aCompter.length
      ? [{
          texte: `${aCompter.length} ligne(s) suivie(s) au lot sans ${motsBarre.des} comptés : à compter avant la soumission au contrôle — ${noms(aCompter)}.`,
          cle: aCompter[0].cle,
        }]
      : []),
    ...(aEnregistrer
      ? [{
          texte: `${[
            enteteModifie ? 'en-tête modifié' : null,
            aCreer.length ? `${aCreer.length} ligne(s) ajoutée(s)` : null,
            aCorriger.length ? `${aCorriger.length} corrigée(s)` : null,
            supprimees.length ? `${supprimees.length} retirée(s)` : null,
          ]
            .filter(Boolean)
            .join(' · ')} — rien n’est encore enregistré.`,
        }]
      : []),
  ]
  const annulerModifications = () => {
    setEntete({
      num_bon_livraison: rec.num_bon_livraison ?? '',
      numero_facture: rec.numero_facture ?? '',
      transporteur: rec.transporteur ?? '',
      nombre_colis: rec.nombre_colis?.toString() ?? '',
      poids_total_brut_kg: rec.poids_total_brut_kg?.toString() ?? '',
      date_reception: rec.date_reception?.slice(0, 10) ?? '',
      id_dossier_import: rec.id_dossier_import ?? '',
    })
    setSupprimees([])
    setNouvelles(lignesServeur.map(depuisLigneReception))
  }
  /* LA BARRE DU BAS : au brouillon et au controle, pour qui peut y agir. */
  const avecBarre =
    (enBrouillon && droits.peutEcrire) || (rec.statut === 'A_CONTROLER' && (droits.peutEcrire || droits.peutValider))
  const modifs = aEnregistrer || nonValidees.length > 0

  return (
    <div>
      <EnTetePage
        titre={`${rec.numero_reception} — ${rec.fournisseur_nom}`}
        description={`${fmt.date(rec.date_reception)}${rec.numero_bc ? ` · bon ${rec.numero_bc}` : ' · hors commande'}${rec.receptionnaire ? ` · pesée par ${rec.receptionnaire}` : ''}`}
        actions={
          <>
            <Bouton variante="contour" onClick={() => naviguer('/receptions')}>
              <ArrowLeft />
              Retour
            </Bouton>
            {/* LES ETIQUETTES DE LOT (19/10/2026) : a coller au quai, des la pesee. */}
            {rec.statut !== 'ANNULE' && lignes.length > 0 && (
              <Bouton
                variante="contour"
                onClick={() => naviguer(`/etats/receptions/${encodeURIComponent(rec.id_reception)}/etiquettes`)}
                title="Une étiquette code-barres par bobine ou par palette"
              >
                <Tags />
                Étiquettes
              </Bouton>
            )}
            {confirmation.element}
            {/* ROUVRIR LE CONTROLE. Le serveur refusera tant que les entrees de
                stock nees de cette reception vivent encore : le papier ne
                recule pas pendant que la marchandise avance. */}
            <BoutonDevalider
              document="receptions"
              id={id}
              statut={rec.statut}
              taille="md"
              consequence="Les lignes redeviendront modifiables et devront être contrôlées à nouveau."
            />
          </>
        }
      />

      {(rec.statut === 'BROUILLON' || rec.statut === 'A_CONTROLER') && (
        <AvisInventaireOuvert inventaires={gel} nommer className="mb-3" />
      )}

      {renvoi !== null && (
        <Carte className="mb-3">
          <CarteCorps className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Etiq obligatoire htmlFor="ch-reception-1">Ce que le magasinier doit corriger</Etiq>
              <Champ id="ch-reception-1"
                autoFocus
                value={renvoi}
                onChange={(e) => setRenvoi(e.target.value)}
                placeholder="Ex. : repeser la ligne 3, le poids ne correspond pas au BL"
              />
            </div>
            <Bouton variante="contour" onClick={() => setRenvoi(null)}>
              Annuler
            </Bouton>
            <Bouton
              disabled={renvoi.trim().length < 5}
              chargement={changerStatut.isPending}
              onClick={() => changerStatut.mutate({ statut: 'BROUILLON', motif: renvoi.trim() })}
            >
              Renvoyer
            </Bouton>
          </CarteCorps>
        </Carte>
      )}
      {rec.statut === 'BROUILLON' && typeof rec.motif_renvoi === 'string' && rec.motif_renvoi && (
        <Alerte ton="alerte" titre="Renvoyée au magasinier" className="mb-3">
          {String(rec.motif_renvoi)}
          {rec.renvoye_par ? ` — ${String(rec.renvoye_par)}` : ''}
          {rec.date_renvoi ? `, ${fmt.date(String(rec.date_renvoi))}` : ''}. Corrigez la pesée, puis
          soumettez de nouveau au contrôle.
        </Alerte>
      )}
      {rec.statut === 'A_CONTROLER' && (
        <Alerte ton="info" className="mb-3">
          Au contrôle, la pesée est figée : quantités, bon de livraison, colis, palettes, bobines, lot
          et dérogation restent ceux du magasinier, et aucune ligne ne s’ajoute ni ne se retire. Se
          modifient encore : la qualité, le magasin, les dates de fabrication et de péremption et les
          observations de chaque ligne, ainsi que l’en-tête. Une erreur de pesée se renvoie au
          magasinier.
        </Alerte>
      )}
      {!modifiable && !['ANNULE'].includes(rec.statut) && rec.statut !== 'A_CONTROLER' && (
        <Alerte ton={rec.statut === 'VALIDE' || rec.statut === 'CLOTURE' ? 'succes' : 'info'} className="mb-3">
          {rec.statut === 'CLOTURE'
            ? `Réception clôturée avec la facture${rec.numero_facture ? ` ${rec.numero_facture}` : ''} : la valeur définitive est au stock. Une correction passe par un avoir.`
            : rec.statut === 'VALIDE'
              ? 'Réception validée au prix du bon (valeur provisoire) : le stock, le CMUP et l’historique de prix ont été mis à jour. La facture la rendra définitive.'
              : 'Réception figée.'}
        </Alerte>
      )}
      {/* LES FRAIS D'APPROCHE AVANT LA CLOTURE (ADR-003 phase C) : c'est elle
          qui les porte au CMUP, chacun selon sa cle. L'ordre de l'ecran suit
          l'ordre du geste — on saisit ce qu'on a paye, puis on cloture. */}
      {(rec.statut === 'VALIDE' || rec.statut === 'CLOTURE') && (
        <div className="mb-3">
          <FraisApproche idReception={id!} statut={rec.statut} />
        </div>
      )}
      {/* LA VALEUR DEFINITIVE (regle 6) : la facture, puis la cloture. */}
      {rec.statut === 'VALIDE' && droits.peutValider && (
        <div className="mb-3">
          <ClotureFacture idReception={id!} numeroFacture={rec.numero_facture} surCloture={rafraichir} />
        </div>
      )}
      {/* Cloturee, elle se corrige par un avoir ou une facture complementaire (regle 8). */}
      {rec.statut === 'CLOTURE' && droits.peutValider && (
        <div className="mb-3">
          <CorrectionFacture idReception={id!} surCorrection={rafraichir} />
        </div>
      )}

      {horsTolerance > 0 && (
        <Alerte ton="alerte" titre="Écart de pesée" className="mb-3">
          {horsTolerance} ligne(s) dépassent de plus de {TOLERANCE_PCT} % la quantité attendue.
          Un tel excédent exige une dérogation motivée. Un manque dans la tolérance solde la ligne du bon ; au-delà,
          il laisse un reliquat à recevoir.
        </Alerte>
      )}

      {rec.on_time != null && (
        <Carte className="mb-3">
          <CarteEntete>
            <CarteTitre>Performance de livraison (OTIF)</CarteTitre>
            <Badge
              ton={
                rec.on_time === 1 && rec.in_full !== 0 && rec.in_spec !== 0 ? 'succes' : 'danger'
              }
            >
              {rec.on_time === 1 && rec.in_full !== 0 && rec.in_spec !== 0
                ? 'OTIF respecté'
                : 'OTIF manqué'}
            </Badge>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Indicateur libelle="Délai réel" valeur={rec.delai_reel_jours} suffixe=" j" />
            <Indicateur libelle="Délai promis" valeur={rec.delai_prevu_jours} suffixe=" j" />
            <Indicateur
              libelle="Retard"
              valeur={rec.retard_jours}
              suffixe=" j"
              alerte={(rec.retard_jours ?? 0) > 0}
            />
            <Critere libelle="À l'heure" ok={rec.on_time} />
            <Critere libelle="Complet" ok={rec.in_full} />
            <Critere libelle="Conforme" ok={rec.in_spec} />
          </CarteCorps>
          <CarteCorps className="pt-0">
            <p className="text-[11px] text-attenue-texte">
              L'OTIF est le produit des trois critères, pas leur moyenne : une livraison à l'heure
              mais incomplète ne vaut rien pour l'atelier qui l'attend.
            </p>
          </CarteCorps>
        </Carte>
      )}

      <div className="space-y-3">
        <Carte repliable="reception.1">
          <CarteEntete>
            <CarteTitre>En-tête</CarteTitre>
            {/* LE STATUT EN LIBELLE, tire de la table commune (lib/statuts). */}
            <StatutBadge entite="reception" code={rec.statut} />
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            <div>
              <Etiq htmlFor="bl">Bon de livraison</Etiq>
              <Champ
                id="bl"
                value={entete.num_bon_livraison}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, num_bon_livraison: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="fact">
                N° de facture
                <Aide>Souvent absente à la livraison : elle se saisit plus tard.</Aide>
              </Etiq>
              <Champ
                id="fact"
                value={entete.numero_facture}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, numero_facture: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="tr">Transporteur</Etiq>
              <Champ
                id="tr"
                value={entete.transporteur}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, transporteur: e.target.value })}
              />
            </div>
            {/* LA DATE DE RECEPTION : celle de l'arrivee, que l'OTIF compare a
                la livraison promise — pas celle de la frappe. */}
            <div>
              <Etiq htmlFor="date-reception">Date de réception</Etiq>
              <Champ
                id="date-reception"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={entete.date_reception}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, date_reception: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="colis">Nombre de colis</Etiq>
              <Champ
                id="colis"
                type="number"
                min="0"
                value={entete.nombre_colis}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, nombre_colis: e.target.value })}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq htmlFor="brut">
                Poids brut (kg)
                <Aide>Relevé au pont-bascule, emballage compris.</Aide>
              </Etiq>
              <Champ
                id="brut"
                type="number"
                step="any"
                min="0"
                value={entete.poids_total_brut_kg}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, poids_total_brut_kg: e.target.value })}
                className="text-right tabular-nums"
              />
            </div>
            {rec.code_devise && rec.code_devise !== 'MAD' && (
              <div>
                <Etiq>
                  Devise de l’arrivage
                  <Aide>
                    Celle des lignes, prise à leur ligne de bon. Le stock entre en dirhams,
                    au taux du jour de la réception.
                  </Aide>
                </Etiq>
                <p className="pt-1.5 text-[13px] font-medium">{rec.code_devise}</p>
              </div>
            )}
          </CarteCorps>

          {/* LES BONS DU CAMION, sur leur propre rangee pleine largeur (16/10/2026). */}
          {bonsAttendus.length > 0 && (
            <CarteCorps className="border-t border-bordure pt-3">
              <Etiq>
                Bons de commande de cet arrivage
                <Aide>
                  Cochez les bons que ce camion livre : seules leurs lignes seront proposées à la
                  pesée. Rien de coché = tout ce que le fournisseur doit encore.
                </Aide>
              </Etiq>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {bonsAttendus.map((b) => {
                  const retenu = bonsRetenus.includes(b.id_bc)
                  return (
                    <button
                      key={b.id_bc}
                      type="button"
                      disabled={!modifiable || peseeFigee}
                      onClick={() => basculerBon(b.id_bc)}
                      className={cn(
                        'rounded-[var(--radius)] border px-3 py-2 text-left text-[13px] transition-colors',
                        retenu
                          ? 'border-primaire bg-primaire/10'
                          : 'border-bordure hover:bg-attenue/40',
                        (!modifiable || peseeFigee) && 'opacity-60',
                      )}
                    >
                      <div className="font-medium">{b.numero_bc}</div>
                      <div className="text-[12px] tabular-nums text-attenue-texte">
                        {b.lignes} ligne{b.lignes > 1 ? 's' : ''} · {fmt.nombre(b.reste_kg, 0)} kg
                        {' restants'}
                      </div>
                      {b.dossier_conteneurs && (
                        <div className="text-[12px] text-attenue-texte">{b.dossier_conteneurs}</div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* LE DOSSIER NE SE SAISIT PLUS : il se lit sur les bons retenus. */}
              <p className="mt-3 text-[13px]">
                <span className="text-attenue-texte">Dossier d’import déduit : </span>
                {dossiersDeduits.length === 0 ? (
                  <span>aucun — achat local</span>
                ) : (
                  dossiersDeduits.map((d, i) => (
                    <span key={d.numero}>
                      {i > 0 && ', '}
                      <span className="font-medium tabular-nums">{d.numero}</span>
                      {d.dum && <span className="text-attenue-texte"> · DUM {d.dum}</span>}
                      {d.conteneurs && <span className="text-attenue-texte"> · {d.conteneurs}</span>}
                    </span>
                  ))
                )}
                {dossiersDeduits.length > 1 && (
                  <span className="ml-1 text-danger">
                    — plusieurs dossiers : précisez les bons, sinon l’arrivage n’en portera aucun.
                  </span>
                )}
              </p>
            </CarteCorps>
          )}
        </Carte>

        <Carte repliable="reception.2">
          <CarteEntete>
            <CarteTitre>Pesées</CarteTitre>
            {modifiable && !estMobile && (
              <span className="text-[11px] text-attenue-texte">
                {peseeFigee
                  ? 'Au contrôle : qualité, magasin, dates et observations se corrigent sur la ligne (crayon), puis « Enregistrer ».'
                  : 'Chaque ligne se saisit sur place ; ✓ la valide, « Enregistrer » envoie l’en-tête et les lignes ensemble.'}
              </span>
            )}
          </CarteEntete>
          <CarteCorps className="p-0">
            {modifiable && estMobile ? (
              /* SOUS 768 PX : cartes + feuille plein ecran (14/10/2026), meme etat
                 que la grille du bureau. */
              <PeseesMobile
                lignes={nouvelles}
                setLignes={setNouvelles}
                proposees={proposees}
                chercherCatalogue={chercherCatalogue}
                magasins={qMagasins.data ?? []}
                tolerancePct={TOLERANCE_PCT}
                brouillon={enBrouillon}
                peseeFigee={peseeFigee}
                relier={relier}
                surRetirer={retirerLigne}
              />
            ) : modifiable ? (
              <>
                {/* AJOUTER UNE LIGNE (brouillon seulement : au controle, le
                    serveur refuse tout ajout). La liste propose d'abord ce que
                    les bons attendent, puis tout le catalogue. */}
                {enBrouillon && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-bordure px-3 py-2">
                    <div className="min-w-0 max-w-xl flex-1">
                      <ChampRecherche
                        valeur=""
                        chercher={chercherAjout}
                        cleCache={['reception-ajout', id, bonsRetenus.join(','), nouvelles.length, proposees.length]}
                        chercherAVide
                        surChoix={(s) => ajouterLigne(s.charge as RefLigne)}
                        placeholder="Ajouter une ligne — ce que les bons attendent, ou tout le catalogue…"
                        aide="Flèches pour parcourir, Entrée pour retenir."
                        ariaLabel="Ajouter une ligne pesée"
                      />
                    </div>
                    <span className="text-[11px] text-attenue-texte">
                      {proposees.length} ligne(s) attendue(s) sur les bons
                      {bonsRetenus.length > 0 ? ' retenus' : ''}.
                    </span>
                  </div>
                )}
                {nouvelles.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-attenue-texte">
                    Aucune ligne pesée. Ajoutez ce que le camion a livré, article par article.
                  </div>
                ) : (
                  <GrilleReception
                    lignes={vues}
                    tolerancePct={TOLERANCE_PCT}
                    magasins={qMagasins.data ?? []}
                    poser={poserLigne}
                    peseeFigee={peseeFigee}
                    voitPrix={droits.visible('prix_kg_devise')}
                    surBasculerValidation={basculerValidation}
                    surRetirer={
                      peseeFigee
                        ? undefined
                        : (cle) => {
                            const l = nouvelles.find((x) => x.cle === cle)
                            if (l) retirerLigne(l)
                          }
                    }
                  />
                )}
              </>
            ) : (
              <>
                <DataTable<LigneRec>
                  exportable="lignes-de-reception"
                  imprimable="Lignes de réception"
                  module={MODULE}
                  colonnes={colonnes}
                  lignes={lignesAffichees}
                  chargement={qLignes.isLoading}
                  erreur={qLignes.error}
                  cle={(l) => l.id_ligne_reception}
                  recherche={false}
                  pagination={false}
                  tailleParDefaut={500}
                  titreCarte={(l) => l.code_reference}
                  videTitre="Aucune pesée"
                  videDescription="Cette réception ne porte aucune ligne."
                />
                <TotauxReception lignes={lignesServeur.map(depuisLigneReception)} />
              </>
            )}
          </CarteCorps>
        </Carte>
      </div>

      {avecBarre && (
        <BarreReception
          indicateurs={indicateurs}
          horsTolerance={lignesHors}
          tolerancePct={TOLERANCE_PCT}
          blocages={blocages}
          avis={avis}
          enAttente={aEnregistrer}
          actions={
            modifs ? (
              /* DES MODIFICATIONS ATTENDENT : l'action principale est de les
                 enregistrer (ou de les abandonner). */
              <>
                <Bouton variante="contour" onClick={annulerModifications}>
                  <Undo2 />
                  Annuler les modifications
                </Bouton>
                <Bouton
                  onClick={() => enregistrer.mutate()}
                  chargement={enregistrer.isPending}
                  disabled={!aEnregistrer || nonValidees.length > 0}
                  title={blocages[0] ? `Bloquant : ${blocages[0].texte}` : undefined}
                >
                  <Save />
                  Enregistrer
                </Bouton>
              </>
            ) : enBrouillon ? (
              <Bouton
                onClick={() => changerStatut.mutate({ statut: 'A_CONTROLER' })}
                chargement={changerStatut.isPending}
                disabled={lignes.length === 0 || enteteModifie}
                title={lignes.length === 0 ? 'Aucune ligne pesée' : undefined}
              >
                <Send />
                Soumettre au contrôle
              </Bouton>
            ) : (
              <>
                {droits.peutEcrire && renvoi === null && (
                  <Bouton variante="contour" onClick={() => setRenvoi('')}>
                    <ArrowLeft />
                    Renvoyer au magasinier
                  </Bouton>
                )}
                {droits.peutValider && (
                  <Bouton
                    onClick={lancerValidation}
                    chargement={valider.isPending}
                    disabled={estPeseur || gel.length > 0}
                    title={
                      gel.length > 0
                        ? (phraseGel(gel, true) ?? undefined)
                        : estPeseur
                          ? 'B4 : vous avez pesé ou corrigé cette réception — un autre la valide'
                          : 'Entrée en stock, CMUP, archive et historique de prix'
                    }
                  >
                    <ShieldCheck />
                    Valider le contrôle
                  </Bouton>
                )}
              </>
            )
          }
        />
      )}
    </div>
  )
}


/** Un chiffre de l'OTIF, avec son libelle. */
function Indicateur({
  libelle,
  valeur,
  suffixe = '',
  alerte = false,
}: {
  libelle: string
  valeur: number | null
  suffixe?: string
  alerte?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] text-attenue-texte">{libelle}</div>
      <div className={cn('text-lg font-semibold tabular-nums', alerte && 'text-danger')}>
        {valeur == null ? '—' : `${fmt.entier(valeur)}${suffixe}`}
      </div>
    </div>
  )
}

/** Un des trois criteres OTIF. `null` = non mesurable, ce qui n'est pas un echec. */
function Critere({ libelle, ok }: { libelle: string; ok: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-attenue-texte">{libelle}</div>
      <Badge ton={ok == null ? 'neutre' : ok === 1 ? 'succes' : 'danger'}>
        {ok == null ? 'non mesurable' : ok === 1 ? 'oui' : 'non'}
      </Badge>
    </div>
  )
}

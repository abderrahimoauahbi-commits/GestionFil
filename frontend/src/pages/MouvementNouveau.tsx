/**
 * SAISIR UN MOUVEMENT — un ecran, pas une fenetre.
 *
 * Un mouvement est un DOCUMENT : un en-tete — type, motif, magasin, date, qui
 * remet la marchandise — et des lignes. Il se saisissait jusqu'ici dans une
 * fenetre modale, ou ni l'en-tete ni la grille ne tiennent : on ne relit pas ce
 * qu'on tape, et l'on valide sans avoir vu l'ensemble. Tous les autres
 * documents de l'ERP ont leur ecran ; celui-ci le rejoint.
 *
 * LES LIGNES SE SAISISSENT SUR LA GRILLE COMMUNE (02/10/2026), celle du bon de
 * commande et de la reception. Les cartes empilees propres a cet ecran
 * refaisaient a leur facon la reference cherchee dans la ligne, les trois colis
 * qui se repondent, le calcul lie ou detache : une seconde saisie pour un meme
 * geste, qui finissait toujours par diverger de la premiere. Le mouvement n'y
 * ajoute que ce qui lui est propre — le lot, le disponible du magasin, le motif
 * de ligne — par les colonnes supplementaires.
 *
 * LA QUANTITE SE SAISIT EN KILOS, L'UNITE DIT COMMENT ELLE S'ARCHIVE — bobine,
 * palette, metre lineaire. Le facteur ne vient pas de l'ecran : il est porte
 * par la REFERENCE, dans son poids de bobine et ses bobines par palette. Une
 * reference qui ne les porte pas ne s'archive qu'en kilos.
 *
 * RIEN NE PART AU SERVEUR AVANT LE CLIC FINAL. En-tete et lignes voyagent
 * ensemble : un mouvement a moitie enregistre n'aurait aucun sens au grand
 * livre, que R03 rend immuable.
 */
import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api, ErreurApi } from '../api/client'
import { ChampLot } from '../composants/ChampLot'
import { EnTetePage } from '../components/Layout'
import { chercherCatalogue as chercherAuCatalogue } from '../composants/ChampReference'
import {
  GrilleLignes,
  depuisReference,
  kgDe,
  ligneVide,
  type ColonneGrille,
  type LigneSaisie,
  type RefLigne,
} from '../composants/GrilleLignes'
import { Alerte, Bouton, Champ, Selecteur } from '../composants/ui/base'
import { type Conditionnement, depuisKg, facteurVersKg, pourChamp, saisieExacte } from '../lib/conditionnement'
import { useTolerancesLot } from '../lib/lots'
import { cn, fmt } from '../lib/utils'
import { useGardeSaisie } from '../hooks/useGardeSaisie'
import { PanneRequetes } from '../composants/PanneRequetes'


/* REGLE 12 : ajustements et dechets. La sortie production n'est plus qu'un
   dechet (motif R4 pose par le serveur) ; le retour de production passe par une
   fiche machine ; le retour fournisseur reste, voie de correction (regle 8).
   REGLE 1 (09/10/2026) : la sortie hors machine (atelier, echantillon, essai,
   reparation, pret a une autre usine), avec un motif par ligne et un OF libre,
   et le retour du pret, en nature. */
const TYPES_SAISIE_LIBRE = [
  'SORTIE_PROD', 'SORTIE_HORS_MACHINE', 'RETOUR_PRET', 'RETOUR_FOURN', 'AJUST_INV_POS', 'AJUST_INV_NEG', 'STOCK_INIT',
]
const LIBELLE_SAISIE: Record<string, string> = {
  SORTIE_PROD: 'Déchet (rebut, chute non réutilisable)',
  SORTIE_HORS_MACHINE: 'Sortie hors machine (atelier, échantillon, essai, réparation, prêt)',
  RETOUR_PRET: 'Retour d’un prêt (fil rendu par une autre usine)',
}
/** Les motifs de ligne d'une sortie hors machine ; ils ne servent qu'a elle. */
const estMotifHorsMachine = (code: string) => code.startsWith('HM_')

interface TypeMvt {
  code_type_mvt: string
  libelle: string
  signe: number
  exige_prix: number
  impacte_cmup: number
  exige_of: number
  exige_motif_ligne: number
}

/** Une ligne de `GET /api/stock?code_magasin=` : le stock d'une reference dans le magasin. */
interface StockMagasin {
  code_reference: string
  designation: string
  quantite_kg: number
  unite_catalogue: string | null
  suivi_lot: number | null
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  bobines_par_lot: number | null
  densite_kg_ml: number | null
}

/**
 * LES UNITES D'UN MOUVEMENT, en plus du kilo.
 *
 * La base refuse le LOT sur un mouvement : un bain de teinture se compte a
 * l'achat, pas au magasin, ou l'on sort des bobines et des palettes.
 */
const UNITES_MOUVEMENT = ['Bobine', 'Palette', 'ml']

/** La date du jour, au format d'un `<input type="date">` et en heure locale. */
function aujourdhui(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/** L'unite d'archive par defaut d'une reference : la plus grosse que le mouvement accepte. */
function uniteMouvement(c: Conditionnement): string {
  if (facteurVersKg('Palette', c)) return 'Palette'
  if (facteurVersKg('Bobine', c)) return 'Bobine'
  return 'kg'
}

/**
 * CE QUE LA GRILLE NE SAIT PAS, ET QUE LE MOUVEMENT EXIGE — remis en ordre a
 * chaque changement de ligne.
 *
 * L'UNITE. La grille propose d'emblee la plus grosse unite de la reference, le
 * lot s'il porte son bain : un mouvement en « Lot » serait refuse par la base.
 * Une unite que la reference ne sait pas convertir retombe de meme.
 *
 * LE LOT SUIT SA REFERENCE. `extra.lot_de` retient la reference pour laquelle
 * le lot a ete choisi ; changer de reference efface le lot, sans quoi le lot de
 * l'ancienne partirait en silence sous le code de la nouvelle.
 */
function normaliser(l: LigneSaisie): LigneSaisie {
  let n = l
  if (
    n.nature === 'MARCHANDISE' &&
    n.unite !== 'kg' &&
    (!UNITES_MOUVEMENT.includes(n.unite) || !facteurVersKg(n.unite, n.cond))
  ) {
    n = { ...n, unite: uniteMouvement(n.cond) }
  }
  const e = n.extra ?? {}
  const lot = e.lot ?? ''
  const de = e.lot_de ?? ''
  if (!lot && de) n = { ...n, extra: { ...e, lot_de: '' } }
  else if (lot && !de) n = { ...n, extra: { ...e, lot_de: n.code_reference } }
  else if (lot && de !== n.code_reference) n = { ...n, extra: { ...e, lot: '', lot_de: '' } }
  return n
}

/** Un compte de colis utilisable, ou rien. Une chaine vide n'est pas un zero. */
function compte(v: string, entier: boolean) {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n) || n < 0) return null
  // UNE BOBINE NE SE COUPE PAS ; une palette s'entame — deux decimales.
  return entier ? Math.round(n) : Number(n.toFixed(2))
}

/**
 * Ce qui part au serveur pour UNE ligne de mouvement.
 *
 * L'ECRAN SAISIT DES KILOS ; LA BASE ARCHIVE L'EXPRESSION DECLAREE — trois
 * palettes, cinq bobines, un poids. Les deux ont leur raison d'etre : le stock
 * se compte au kilo, mais le bon que releve le cariste porte le compte de
 * colis. La traduction se fait ICI, une fois.
 *
 * SIX DECIMALES, ET NON QUATRE. La colonne n'en garde que quatre, mais le
 * serveur deduit les KILOS de ce nombre AVANT que la base n'arrondisse : un
 * arrondi trop tot ici deplacerait le poids reel de quelques grammes, et le
 * stock ne se rattrape pas.
 *
 * FACTEUR INCONNU : on n'invente pas une expression. On envoie des kilos, que
 * la base recoit toujours, plutot qu'un nombre faux dans une unite qu'on ne
 * sait pas convertir.
 *
 * LES COLIS PARTENT TELS QU'AFFICHES, lies ou detaches : le poids theorique et
 * l'ecart de poids, c'est la base qui les calcule.
 */
function corpsMouvement(l: LigneSaisie) {
  const kg = Number(l.qte)
  const f = facteurVersKg(l.unite, l.cond)
  const e = l.extra ?? {}
  // LE PRIX AU KILO : celui de la grille quand le type l'exige, celui de la
  // colonne facultative quand il ne fait que valoriser.
  const prix = Number(l.prix || e.prix || 0)
  return {
    code_reference: l.code_reference,
    ...saisieExacte(kg, l.unite, f),
    prix_kg_mad: prix > 0 ? prix : null,
    nb_palettes: compte(l.palettes, false),
    nb_bobines: compte(l.bobines, true),
    lot_fournisseur: e.lot?.trim() || null,
    code_motif_ligne: e.motif_ligne || null,
  }
}

/** La classe d'un champ place dans une cellule de la grille. */
const champCellule =
  'h-9 w-full rounded-[var(--radius)] border border-champ bg-surface px-2 text-[13px] outline-none focus:border-anneau'

/**
 * La liste des mouvements, UN DOCUMENT PAR LIGNE.
 *
 * POURQUOI ELLE EXISTE A COTE DU GRAND LIVRE. Le livre montre une ligne par
 * reference : c'est la vue de l'auditeur, qui cherche ce qu'est devenue une
 * matiere. Ce n'est pas celle du magasin, qui manipule des camions et des
 * equipes. Devant le livre seul, il fallait additionner de tete les lignes d'un
 * meme bon pour savoir combien de kilos etaient sortis — et personne ne le
 * faisait.
 *
 * Les deux vues restent, parce que les deux lectures sont legitimes.
 */
export function MouvementNouveau() {
  const naviguer = useNavigate()
  // Le retour et la reussite menent au meme endroit : le grand livre, ou l'on
  // verifie que le mouvement est bien entre.
  const surFermeture = () => naviguer('/mouvements')
  const surSucces = () => naviguer('/mouvements')
  const [entete, setEntete] = useState({
    code_type_mvt: '',
    code_magasin: '',
    code_motif: '',
    // LA DATE DU FAIT, pre-remplie a aujourd'hui. Elle etait imposee par la
    // base a l'instant de l'enregistrement, ce qui obligeait a tout saisir le
    // jour meme sous peine de fausser le journal.
    date_mouvement: aujourdhui(),
    responsable: '',
    reference_document: '',
    numero_of: '',
    /** L'usine du pret et de son retour. */
    tiers: '',
    observations_globales: '',
  })
  const [lignes, setLignes] = useState<LigneSaisie[]>(() => [ligneVide()])
  const [erreur, setErreur] = useState<string | null>(null)
  const tolerances = useTolerancesLot()

  /* TOUTE ECRITURE DE LA GRILLE PASSE PAR LA REMISE EN ORDRE : unite permise,
     lot attache a sa reference. La grille ne connait pas ces regles ; elle
     n'a pas a les connaitre. */
  const majLignes: Dispatch<SetStateAction<LigneSaisie[]>> = (action) =>
    setLignes((prev) => (typeof action === 'function' ? action(prev) : action).map(normaliser))

  const qTypes = useQuery({
    queryKey: ['types-mouvement'],
    queryFn: async () => {
      // Le registre n'expose pas les types : ils viennent du referentiel.
      const r = await api.get<TypeMvt[]>('/api/types-mouvement')
      /* SEULS LES TYPES QUI SE SAISISSENT A LA MAIN (06/10/2026) : les autres
         naissent d'un document (reception, transfert, fusion, fiche machine) et
         le serveur les refuse ici. */
      return r.filter((t) => TYPES_SAISIE_LIBRE.includes(t.code_type_mvt))
    },
    retry: false,
  })
  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })
  const qMotifs = useQuery({
    queryKey: ['motifs-mouvement'],
    queryFn: () => api.get<{ code_motif: string; libelle: string }[]>('/api/motifs-mouvement'),
    retry: false,
  })

  const typeActif = useMemo(
    () => qTypes.data?.find((t) => t.code_type_mvt === entete.code_type_mvt),
    [qTypes.data, entete.code_type_mvt],
  )
  const sortie = (typeActif?.signe ?? 1) < 0
  const exigeMotif = typeActif?.exige_motif_ligne === 1
  /* LE PRIX S'OFFRE DES QU'IL PEUT VALORISER. Obligatoire sur une reception :
     la grille l'affiche et refuse de valider la ligne sans lui. Facultatif sur
     un stock initial, qui peut entrer sans prix — il prend alors le prix
     catalogue : une colonne a part, que la validation de ligne n'exige pas. */
  const prixGrille = typeActif?.exige_prix === 1
  /* LE PRIX EST IMPOSE (regle 12, 08/10/2026) : toute saisie libre entre ou sort
     au CMUP en cours, que le serveur applique. Seul le stock d'ouverture peut
     porter un prix, pour une reference qui n'a encore jamais ete recue. */
  const prixOption = !prixGrille && typeActif?.code_type_mvt === 'STOCK_INIT'
  const { moi, peut } = useAuth()

  const qMotifsLigne = useQuery({
    queryKey: ['motifs-ligne'],
    queryFn: () =>
      api.get<{ code_motif_ligne: string; libelle: string }[]>('/api/motifs-ligne'),
    enabled: exigeMotif,
    retry: false,
  })
  const horsMachine = typeActif?.code_type_mvt === 'SORTIE_HORS_MACHINE'
  /* Une sortie hors machine ne propose que ses motifs ; les autres types, jamais eux. */
  const motifsLigne = (qMotifsLigne.data ?? []).filter((m) =>
    horsMachine ? estMotifHorsMachine(m.code_motif_ligne) : !estMotifHorsMachine(m.code_motif_ligne),
  )
  const pret = entete.code_type_mvt === 'RETOUR_PRET'
  /* LES PRETS EN COURS : l'usine a qui l'on a prete, ce qu'elle doit rendre. */
  const qPrets = useQuery({
    queryKey: ['prets-en-cours'],
    queryFn: () =>
      api.get<{ tiers: string; code_reference: string; designation: string; reste_kg: number; jours: number }[]>(
        '/api/prets-en-cours',
      ),
    enabled: pret || horsMachine,
    retry: false,
  })
  const usinesConnues = [...new Set((qPrets.data ?? []).map((p) => p.tiers))]
  /* LE SEUIL VIENT DU PARAMETRE, comme au serveur (P_DechetSeuilValiderKg). */
  const qSeuil = useQuery({
    queryKey: ['parametres'],
    queryFn: () => api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres'),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const seuilKg =
    Number(qSeuil.data?.find((p) => p.code_parametre === 'P_DechetSeuilValiderKg')?.valeur_courante) || 50

  /*
   * LE STOCK DU MAGASIN CHOISI, et lui seul.
   *
   * Sur une SORTIE, c'est lui qui dit si la saisie passera : R02 refuse un
   * stock negatif, et decouvrir le refus a l'enregistrement fait perdre tout
   * le formulaire. Il porte aussi le conditionnement et le suivi par lot des
   * references qu'il tient : la liste deroulante s'ouvre sur lui.
   */
  const qStock = useQuery({
    queryKey: ['stock-magasin', entete.code_magasin],
    queryFn: () =>
      api.get<StockMagasin[]>(
        `/api/stock?code_magasin=${encodeURIComponent(entete.code_magasin)}&limite=2000`,
      ),
    enabled: !!entete.code_magasin,
  })
  const stockPar = useMemo(() => {
    const m = new Map<string, StockMagasin>()
    for (const s of qStock.data ?? []) {
      const deja = m.get(s.code_reference)
      m.set(
        s.code_reference,
        deja ? { ...deja, quantite_kg: deja.quantite_kg + (s.quantite_kg ?? 0) } : { ...s },
      )
    }
    return m
  }, [qStock.data])
  const dispoDe = (code: string) => stockPar.get(code)?.quantite_kg ?? 0

  /* LE SUIVI PAR LOT DES REFERENCES VENUES DU CATALOGUE. Le stock du magasin
     le porte pour ce qu'il tient ; une reference trouvee au catalogue — une
     entree de ce qui n'est pas encore la — l'apporte avec sa suggestion, et on
     le garde ici au moment ou la recherche le rend. */
  const [suiviCatalogue, setSuiviCatalogue] = useState<Map<string, number>>(new Map())
  const suiviDe = (code: string): number | null =>
    stockPar.get(code)?.suivi_lot ?? suiviCatalogue.get(code) ?? null

  /** La mention de stock d'une suggestion : ce que le magasin tient, ou rien. */
  const mentionStock = (code: string): string | null => {
    if (!entete.code_magasin) return null
    const q = dispoDe(code)
    return q > 0.001 ? `${fmt.nombre(q, 0)} kg en magasin` : sortie ? 'RUPTURE' : null
  }

  const proposees = useMemo<RefLigne[]>(
    () =>
      [...stockPar.values()]
        .filter((s) => s.quantite_kg > 0.001)
        .map((s) => ({
          code_reference: s.code_reference,
          designation: s.designation,
          unite_catalogue: s.unite_catalogue ?? 'kg',
          poids_bobine_kg: s.poids_bobine_kg,
          bobines_par_palette: s.bobines_par_palette,
          bobines_par_lot: s.bobines_par_lot,
          densite_kg_ml: s.densite_kg_ml,
          // LE STOCK DU MAGASIN EN MENTION. La grille parle de « projeté » ;
          // ici, c'est le disponible du magasin, et c'est ce qu'il faut lire.
          statut_stock: `${fmt.nombre(s.quantite_kg, 0)} kg en magasin`,
        })),
    [stockPar],
  )

  /**
   * ON TAPE, LE SERVEUR CHERCHE — la recherche de `ChampReference`, celle que
   * l'ecran utilisait deja. Le fournisseur est retire de la suggestion : un
   * mouvement ne s'achete chez personne, et la grille annoncerait sinon
   * « habituellement chez » sur chaque reference.
   */
  const chercherCatalogue = async (motif: string): Promise<RefLigne[]> => {
    const trouvees = await chercherAuCatalogue(motif, { limite: 25 })
    setSuiviCatalogue((m) => {
      const n = new Map(m)
      for (const r of trouvees) if (r.suivi_lot != null) n.set(r.code_reference, Number(r.suivi_lot))
      return n
    })
    return trouvees.map((r) => ({
      ...r,
      designation: r.designation ?? r.code_reference,
      unite_catalogue: r.unite_catalogue ?? 'kg',
      code_fournisseur: null,
      fournisseur_nom: null,
      statut_stock: mentionStock(r.code_reference),
    }))
  }

  /* LES LIGNES QUI COMPTENT. Une ligne vide, laissee en bas pour la suivante,
     ne bloque rien et ne part pas. */
  const utiles = lignes.filter(
    (l) => l.nature !== 'MARCHANDISE' || !!l.code_reference || l.qte.trim() !== '',
  )
  const horsCatalogue = utiles.filter((l) => l.nature !== 'MARCHANDISE')
  // Une saisie en cours ne se perd pas d'un clic dans le menu (audit v4).
  useGardeSaisie(utiles.length > 0)
  const nonValidees = utiles.filter((l) => !l.valide)
  const lotsManquants = utiles.filter(
    (l) => suiviDe(l.code_reference) === 1 && !(l.extra?.lot ?? '').trim(),
  )
  const motifsManquants = exigeMotif ? utiles.filter((l) => !l.extra?.motif_ligne) : []
  const totalKg = utiles.reduce((s, l) => s + (kgDe(l) ?? 0), 0)

  /** Ce que les lignes demandent, par reference — la meme peut revenir, un lot par ligne. */
  const demandePar = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lignes)
      if (l.code_reference) m.set(l.code_reference, (m.get(l.code_reference) ?? 0) + (kgDe(l) ?? 0))
    return m
  }, [lignes])
  const manqueDe = (code: string) => {
    if (!sortie || !entete.code_magasin || !code) return null
    const d = (demandePar.get(code) ?? 0) - dispoDe(code)
    return d > 0.0005 ? d : null
  }

  /*
   * LES COLONNES QUE LE MOUVEMENT AJOUTE A LA GRILLE.
   *
   * La grille ne sait pas ce qu'est un lot ni un magasin : elle les range dans
   * `extra` et les rend par ces descriptions.
   */
  const colonnes: ColonneGrille[] = [
    {
      cle: 'lot',
      entete: 'Lot',
      largeur: 'w-56',
      rendu: (l, poser) =>
        l.code_reference && suiviDe(l.code_reference) === 1 ? (
          /* LE LOT SE CHOISIT dans ce que le magasin tient, le plus ancien
             d'abord ; « Autre lot… » pour une entree. Obligatoire : la base
             refuse un mouvement de reference suivie sans lot. */
          <ChampLot
            reference={l.code_reference}
            magasin={entete.code_magasin}
            valeur={l.extra?.lot ?? ''}
            onChange={poser}
            className={champCellule}
            invalide={!(l.extra?.lot ?? '').trim()}
          />
        ) : (
          <span
            className="block pt-2 text-[11px] text-attenue-texte"
            title={l.code_reference ? 'Référence non suivie par lot' : undefined}
          >
            —
          </span>
        ),
    },
    {
      cle: 'dispo',
      entete: 'Dispo magasin',
      largeur: 'w-32',
      alignement: 'right',
      rendu: (l) => {
        if (!l.code_reference) return <span className="block pt-2 text-attenue-texte">—</span>
        if (!entete.code_magasin)
          return (
            <span className="block pt-2 text-[11px] text-attenue-texte" title="Choisissez le magasin">
              magasin ?
            </span>
          )
        const manque = manqueDe(l.code_reference)
        return (
          <div className="pt-2 text-[12px] tabular-nums">
            <div className={cn('font-medium', manque != null && 'text-danger')}>
              {fmt.nombre(dispoDe(l.code_reference), 0)} kg
            </div>
            {manque != null && (
              <div className="text-[11px] text-danger">manque {fmt.nombre(manque, 0)} kg</div>
            )}
          </div>
        )
      },
    },
    ...(prixOption
      ? [
          {
            cle: 'prix',
            entete: 'Prix MAD/kg',
            largeur: 'w-32',
            alignement: 'right' as const,
            rendu: (l: LigneSaisie, poser: (v: string) => void) => (
              <Champ
                type="number"
                step="any"
                min="0"
                value={l.extra?.prix ?? ''}
                onChange={(e) => poser(e.target.value)}
                placeholder="catalogue"
                title="Facultatif. Vide : les kilos entrent au prix catalogue, converti au taux en vigueur."
                className="h-9 text-right tabular-nums"
                aria-label="Prix MAD par kg, facultatif"
              />
            ),
          },
        ]
      : []),
    ...(exigeMotif
      ? [
          {
            cle: 'motif_ligne',
            entete: 'Motif',
            largeur: 'w-44',
            rendu: (l: LigneSaisie, poser: (v: string) => void) => (
              <Selecteur
                value={l.extra?.motif_ligne ?? ''}
                onChange={(e) => poser(e.target.value)}
                className={cn('h-9', !l.extra?.motif_ligne && 'border-danger')}
                aria-label="Motif de la ligne"
              >
                <option value="">—</option>
                {motifsLigne.map((m) => (
                  <option key={m.code_motif_ligne} value={m.code_motif_ligne}>
                    {horsMachine ? m.libelle : `${m.code_motif_ligne} · ${m.libelle}`}
                  </option>
                ))}
              </Selecteur>
            ),
          },
        ]
      : []),
  ]

  /**
   * REMPLACER LA REFERENCE D'UNE LIGNE PAR UN EQUIVALENT, en gardant le poids.
   *
   * L'equivalent vient du stock du magasin quand il y est, du catalogue sinon.
   * La ligne se rouvre : ce n'est plus celle qu'on avait validee.
   */
  const remplacerReference = async (cle: string, code: string) => {
    let r = proposees.find((x) => x.code_reference === code)
    if (!r) r = (await chercherCatalogue(code)).find((x) => x.code_reference === code)
    if (!r) {
      setErreur(`Référence ${code} introuvable au catalogue.`)
      return
    }
    const ref = r
    majLignes((ls) =>
      ls.map((l) => {
        if (l.cle !== cle) return l
        const n = depuisReference(ref, l.cle)
        const colis = depuisKg(l.qte, n.cond)
        return {
          ...n,
          qte: l.qte,
          palettes: pourChamp(colis.palettes),
          bobines: pourChamp(colis.bobines),
          extra: { ...(l.extra ?? {}), lot: '', lot_de: '' },
          valide: false,
        }
      }),
    )
  }

  /* CE QUE L'ECRAN NE MONTRE PAS NE PART PAS. Un prix saisi puis masque par un
     changement de type, un lot sur une reference non suivie : rien de cela ne
     doit atteindre la base sans avoir ete relu. */
  const pourEnvoi = (l: LigneSaisie): LigneSaisie => ({
    ...l,
    prix: prixGrille ? l.prix : '',
    extra: {
      lot: suiviDe(l.code_reference) === 1 ? (l.extra?.lot ?? '') : '',
      motif_ligne: exigeMotif ? (l.extra?.motif_ligne ?? '') : '',
      prix: prixOption ? (l.extra?.prix ?? '') : '',
    },
  })

  const enregistrer = useMutation({
    mutationFn: () =>
      api.post('/api/mouvements', {
        ...entete,
        responsable: entete.responsable.trim() || null,
        reference_document: entete.reference_document.trim() || null,
        numero_of: entete.numero_of || null,
        tiers: entete.tiers.trim() || null,
        observations_globales: entete.observations_globales.trim() || null,
        lignes: utiles.map((l) => corpsMouvement(pourEnvoi(l))),
      }),
    onSuccess: surSucces,
    onError: (e) =>
      setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  const bloquant =
    utiles.length === 0
      ? 'Saisissez au moins une ligne.'
      : horsCatalogue.length > 0
        ? `Un mouvement ne porte que des références du catalogue : retirez la ligne « ${horsCatalogue[0].intitule} ».`
        : nonValidees.length > 0
          ? `${nonValidees.length} ligne(s) à valider avec le bouton ✓ de la ligne avant d’enregistrer.`
          : lotsManquants.length > 0
            ? `${lotsManquants.length} ligne(s) sans lot : la référence est suivie par lot.`
            : motifsManquants.length > 0
              ? `${motifsManquants.length} ligne(s) sans motif : ce type de mouvement l’exige.`
              : null

  const champ =
    'w-full rounded-lg border border-champ px-3 py-2 text-sm outline-none focus:border-anneau'

  return (
    <>
      <EnTetePage
        titre="Saisir un mouvement"
        sous_titre="La quantité est convertie en kilogrammes avant enregistrement, par les paramètres de la référence."
      />
      <PanneRequetes requetes={[['Les types de mouvement', qTypes], ['Les magasins', qMag], ['Les motifs', qMotifs], ['Le stock du magasin', qStock]]} />
      {/* LE FORMULAIRE NE PORTE QUE L'EN-TETE. Les boutons de la grille ne
          declarent pas de type : places dans un formulaire, chacun —
          valider une ligne, en ajouter une — l'aurait soumis. Le bouton du bas
          s'y rattache par `form`, et la validation des champs obligatoires de
          l'en-tete reste celle du navigateur. */}
      <form
        id="form-mouvement"
        onSubmit={(e) => {
          e.preventDefault()
          if (bloquant) return
          setErreur(null)
          enregistrer.mutate()
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Type de mouvement <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={entete.code_type_mvt}
              onChange={(e) => setEntete({ ...entete, code_type_mvt: e.target.value })}
              className={champ}
            >
              <option value="">—</option>
              {/* REGLE 12 : l'ajustement demande le droit de valider, le stock
                  initial est a l'administrateur — l'ecran ne propose que ce que
                  le serveur acceptera. */}
              {qTypes.data?.filter((t) =>
                t.code_type_mvt === 'STOCK_INIT' ? moi?.role === 'ADMIN'
                  : t.code_type_mvt.startsWith('AJUST_INV') ? peut('INVENTAIRE', 'VALIDER')
                  // Rendre au fournisseur defait une reception (decision 5).
                  : t.code_type_mvt === 'RETOUR_FOURN' ? peut('RECEPTIONS', 'VALIDER')
                  : true).map((t) => (
                <option key={t.code_type_mvt} value={t.code_type_mvt}>
                  {t.signe > 0 ? '+ ' : '− '}
                  {LIBELLE_SAISIE[t.code_type_mvt] ?? t.libelle}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Magasin <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={entete.code_magasin}
              onChange={(e) => setEntete({ ...entete, code_magasin: e.target.value })}
              className={champ}
            >
              <option value="">—</option>
              {qMag.data?.map((m) => (
                <option key={m.code_magasin} value={m.code_magasin}>
                  {m.nom}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Motif <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={entete.code_motif}
              onChange={(e) => setEntete({ ...entete, code_motif: e.target.value })}
              className={champ}
            >
              <option value="">—</option>
              {qMotifs.data?.map((m) => (
                <option key={m.code_motif} value={m.code_motif}>
                  {m.libelle}
                </option>
              ))}
            </select>
          </div>

          {(typeActif?.exige_of === 1 || horsMachine) && (
            <div>
              <label className="mb-1 block text-sm font-medium text-texte">
                Numero d ordre de fabrication {typeActif?.exige_of === 1 && <span className="text-danger">*</span>}
              </label>
              <input
                required={typeActif?.exige_of === 1}
                value={entete.numero_of}
                onChange={(e) => setEntete({ ...entete, numero_of: e.target.value })}
                placeholder={horsMachine ? 'Facultatif, texte libre' : undefined}
                className={champ}
              />
            </div>
          )}

          {(horsMachine || pret) && (
            <div>
              <label className="mb-1 block text-sm font-medium text-texte">
                Usine {pret ? 'qui rend le fil' : 'qui emprunte (pour un prêt)'}
                {pret && <span className="text-danger"> *</span>}
              </label>
              <input
                list="usines-pret"
                required={pret}
                value={entete.tiers}
                onChange={(e) => setEntete({ ...entete, tiers: e.target.value })}
                placeholder="Nom de l’usine"
                className={champ}
              />
              <datalist id="usines-pret">
                {usinesConnues.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              {pret && entete.tiers.trim() && (
                <p className="mt-0.5 text-[11px] text-attenue-texte">
                  {(qPrets.data ?? []).filter((p) => p.tiers === entete.tiers.trim()).length === 0
                    ? 'Aucun prêt en cours pour cette usine.'
                    : 'À rendre : ' +
                      (qPrets.data ?? [])
                        .filter((p) => p.tiers === entete.tiers.trim())
                        .map((p) => `${p.code_reference} ${fmt.nombre(p.reste_kg, 1)} kg`)
                        .join(' · ')}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Date du mouvement <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              max={aujourdhui()}
              value={entete.date_mouvement}
              onChange={(e) => setEntete({ ...entete, date_mouvement: e.target.value })}
              className={champ}
            />
            <p className="mt-0.5 text-[11px] text-attenue-texte">
              La date du fait, qui peut differer du jour de saisie. Jamais dans le futur.
            </p>
          </div>

          {/* DEUX RESPONSABLES, ET C'EST VOULU. Le compte connecte dit qui a
              TAPE ; ce champ dit qui a REMIS ou RECU. Le magasinier saisit
              souvent pour un chef d'equipe ou un chauffeur, et c'est ce dernier
              qu'on cherche quand un ecart apparait trois jours plus tard. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Responsable de la marchandise
            </label>
            <input
              value={entete.responsable}
              onChange={(e) => setEntete({ ...entete, responsable: e.target.value })}
              placeholder="Qui remet ou recoit"
              className={champ}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Document de reference
            </label>
            <input
              value={entete.reference_document}
              onChange={(e) => setEntete({ ...entete, reference_document: e.target.value })}
              required={entete.code_type_mvt === 'RETOUR_FOURN'}
              placeholder={entete.code_type_mvt === 'RETOUR_FOURN' ? 'N° de la réception d’origine (REC-… ou RIM-…)' : 'N BL, bon de commande, OF...'}
              className={champ}
            />
            {entete.code_type_mvt === 'RETOUR_FOURN' && (
              <p className="mt-0.5 text-[11px] text-attenue-texte">
                Obligatoire : on ne rend pas plus que cette réception n’a fait entrer.
              </p>
            )}
            {(entete.code_type_mvt === 'SORTIE_PROD' || horsMachine) && (
              <p className="mt-0.5 text-[11px] text-attenue-texte">
                Au-delà de {fmt.nombre(seuilKg, 0)} kg sortis le même jour pour une référence (déchets et sorties
                hors machine cumulés), la sortie demande le droit de valider l’inventaire.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-texte">Observations</label>
          <textarea
            rows={2}
            value={entete.observations_globales}
            onChange={(e) => setEntete({ ...entete, observations_globales: e.target.value })}
            className={champ}
          />
        </div>
      </form>

      {/* --- Lignes ------------------------------------------------------ */}
      <div className="mt-4 space-y-2">
        <span className="text-sm font-medium text-texte">Lignes</span>
        {/* LA MEME GRILLE QUE LE BON DE COMMANDE. Pas de source a choisir : la
            frappe cherche d'abord dans le stock du magasin, puis au catalogue.
            La meme reference peut revenir sur plusieurs lignes, une par lot.

            LE CODE FOURNISSEUR SERT ICI DE CLE DE CACHE. La recherche de la
            grille garde ses resultats trente secondes sous ce code : vide, le
            stock d'un autre magasin — ou celui d'un autre ecran de stock —
            reviendrait dans la liste. Aucune reference proposee ne porte de
            fournisseur, il n'est donc compare a rien d'autre. */}
        <GrilleLignes
          codeFournisseur={`MVT:${entete.code_magasin}`}
          devise="MAD"
          lignes={lignes}
          setLignes={majLignes}
          mode="CATALOGUE"
          setMode={() => {}}
          proposees={proposees}
          chercherCatalogue={chercherCatalogue}
          sansSource
          sansFournisseur
          sansPrix={!prixGrille}
          validationLocale
          doublonsReference
          unitesAutorisees={UNITES_MOUVEMENT}
          libelles={{ reference: 'Référence', unite: 'Unité' }}
          poidsBobine={tolerances}
          colonnesSupplementaires={colonnes}
        />

        {/* LES EQUIVALENTS, SOUS LA GRILLE. La ligne n'a pas la place de les
            montrer ; chacun rappelle a quelle ligne il se rapporte. */}
        {lignes.map((l, i) => {
          const manque = l.code_reference && (kgDe(l) ?? 0) > 0 ? manqueDe(l.code_reference) : null
          return manque != null ? (
            <div key={l.cle}>
              <div className="text-[12px] font-medium text-texte">
                Ligne {i + 1} — {l.code_reference}
              </div>
              <EquivalentsDispo
                reference={l.code_reference}
                manque={manque}
                surChoix={(code) => void remplacerReference(l.cle, code)}
              />
            </div>
          ) : null
        })}
      </div>

      {erreur && (
        <Alerte ton="danger" className="mt-3">
          {erreur}
        </Alerte>
      )}

      {/* L'EN-TETE ET LES LIGNES S'ENREGISTRENT ICI, ENSEMBLE. Le bouton de
          chaque ligne la valide a l'ecran ; celui-ci ecrit tout en base. Il
          reste toujours visible, desactive tant que quelque chose manque — et
          il dit quoi. */}
      <div
        className={cn(
          'sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
          bloquant ? 'border-bordure' : 'border-primaire',
        )}
      >
        <span className="text-[13px]">
          {bloquant ? (
            <span className="text-alerte">{bloquant}</span>
          ) : (
            <>
              <span className="font-medium">
                {utiles.length} ligne(s) · total{' '}
                <span className="tabular-nums">{fmt.nombre(totalKg, 3)} kg</span>
              </span>
              <span className="text-alerte"> — rien n’est encore enregistré.</span>
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <Bouton type="button" variante="contour" onClick={surFermeture}>
            Annuler
          </Bouton>
          <Bouton
            type="submit"
            form="form-mouvement"
            chargement={enregistrer.isPending}
            disabled={!!bloquant}
            title={bloquant ?? undefined}
          >
            <Save />
            {enregistrer.isPending ? 'Enregistrement...' : 'Enregistrer le mouvement'}
          </Bouton>
        </div>
      </div>
    </>
  )
}

/**
 * Les equivalents disponibles, quand le stock demande manque.
 *
 * L'ecran PROPOSE, il ne contourne rien : R02 reste porte par les triggers, et
 * une sortie superieure au stock sera refusee quoi qu'il arrive. Ce qui change,
 * c'est le moment ou l'atelier l'apprend — devant le formulaire, avec la
 * solution a portee de clic, plutot qu'apres un refus sec.
 *
 * Le stock affiche est le TOTAL toutes zones MRP confondues. Il ne garantit pas
 * que la matiere soit dans le magasin choisi : c'est une piste, pas une
 * promesse, et le dire evite de faire croire a une reservation.
 */
function EquivalentsDispo({
  reference,
  manque,
  surChoix,
}: {
  reference: string
  manque: number
  surChoix: (code: string) => void
}) {
  const q = useQuery({
    queryKey: ['equivalences', reference],
    queryFn: () =>
      api.get<
        {
          equivalent_reference: string
          equivalent_designation: string
          equivalent_stock_kg: number
          interchangeable: number
        }[]
      >(`/api/equivalences?code_reference=${encodeURIComponent(reference)}`),
    enabled: !!reference,
  })

  const utiles = (q.data ?? []).filter(
    (e) => e.interchangeable === 1 && e.equivalent_stock_kg > 0,
  )

  return (
    <div className="mt-1 rounded-lg border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
      <div className="text-[12px] font-medium text-red-700 dark:text-red-300">
        Stock insuffisant dans le magasin : il manque {fmt.nombre(manque, 0)} kg.
      </div>

      {utiles.length === 0 ? (
        <div className="mt-1 text-[11px] text-attenue-texte">
          Aucune reference equivalente ne dispose de stock. La sortie sera refusee (R02) :
          reduisez la quantite, ou approvisionnez d'abord.
        </div>
      ) : (
        <>
          <div className="mt-1 text-[11px] text-attenue-texte">
            Ces references sont declarees interchangeables avec celle-ci et ont du stock. Le total
            est toutes zones confondues : verifiez qu'il est bien dans votre magasin.
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {utiles.map((e) => (
              <button
                key={e.equivalent_reference}
                type="button"
                onClick={() => surChoix(e.equivalent_reference)}
                className="rounded border border-bordure bg-surface px-2 py-1 text-left text-[11px] hover:border-primaire"
                title={e.equivalent_designation}
              >
                <span className="font-medium">{e.equivalent_reference}</span>
                <span className="ml-1.5 tabular-nums text-attenue-texte">
                  {fmt.nombre(e.equivalent_stock_kg, 0)} kg
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

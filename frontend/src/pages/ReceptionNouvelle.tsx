/**
 * Nouvelle reception — saisie en cascade, dans la forme des ERP du marche.
 *
 * La disposition suit MIGO (SAP) et les pages de reception d'Oracle, parce que
 * c'est celle qui tient au quai :
 *
 *   1. une BARRE DE REPRISE ou l'on appelle un bon de commande ; ses lignes
 *      s'AJOUTENT a la grille sans effacer les precedentes, donc un camion qui
 *      porte deux bons se saisit en une fois ;
 *   2. une GRILLE dense, une ligne par article, avec le drapeau « retenue » de
 *      MIGO : on decoche ce qui n'est pas descendu du camion plutot que de le
 *      supprimer, et l'on garde sous les yeux ce qui etait attendu ;
 *   3. LA SAISIE SUR LA LIGNE (24/10/2026), au modele du bon de commande :
 *      reference et bon, BL, pesee, unite, ecart sur la rangee principale ;
 *      palettes, bobines, lot, magasin, qualite, dates, observations s'y
 *      ajoutent tant que la largeur le permet, le reste passe sur la rangee
 *      « ↳ » (`receptions/GrilleReception`). Le panneau a onglets n'est plus.
 *
 * L'arrivage SANS COMMANDE se saisit ici aussi : la marchandise est au quai, la
 * refuser n'est pas une option. Le serveur cree alors le bon manquant en
 * brouillon ; la reception ne se validera qu'une fois ce bon regularise.
 *
 * Rien ne part au serveur avant le clic final : en-tete, lignes et bon de
 * regularisation partent dans une seule transaction.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCheck, Plus, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
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
import { Aide } from '../composants/ui/surcouches'
import { ChampReference, chercherCatalogue } from '../composants/ChampReference'
import { fmt } from '../lib/utils'
import {
  type Conditionnement,
  conditionnementDuLot,
  depuisBobines,
  depuisKg,
  depuisPalettes,
  facteurVersKg,
  pourChamp,
} from '../lib/conditionnement'
import { ChoixRecherche } from '../composants/ChoixRecherche'
import { useConditionnementsLots } from '../hooks/useConditionnementLots'
import { useToleranceFournisseur } from '../lib/lots'
import { type ChampRec, GrilleReception, type VueLigneRec, allerALaLigne } from './receptions/GrilleReception'
import { BarreReception, type IndicateurRec, type MessageRec, texteEcartKg, tonEcartKg } from './receptions/BarreReception'
import { useGardeSaisie } from '../hooks/useGardeSaisie'
import { PanneRequetes } from '../composants/PanneRequetes'
import { AvisInventaireOuvert } from '../composants/AvisInventaireOuvert'
import { useGelInventaire } from '../lib/inventairesOuverts'
import { nouvelIdentifiant } from '../lib/identifiant'

const MODULE = 'RECEPTIONS'

interface LigneAttendue extends Record<string, unknown> {
  id_ligne_bc: string
  id_bc: string
  numero_bc: string
  date_livraison_prevue: string | null
  retard_jours: number | null
  code_reference: string
  designation: string
  quantite_commandee_kg: number
  quantite_recue_kg: number
  quantite_restante_kg: number
  /** Deja pese sur cette ligne par d'autres receptions en cours (19/10/2026). */
  en_cours_kg?: number | null
  en_cours_dans?: string | null
  prix_kg_devise?: number
  code_devise?: string
  unite_catalogue: string
  suivi_lot: number
  /** References que le fournisseur peut legitimement livrer a la place. */
  equivalents_recevables: string | null
}

interface RefCatalogue extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  suivi_lot: number
  prix_catalogue_kg?: number
  code_devise_catalogue?: string
  /** Le conditionnement : ce qui permet de peser en palettes ou en bobines. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  densite_kg_ml?: number | null
}

/** Conditionnement neutre : aucune conversion n'est possible, et on le dit. */
const SANS_CONDITIONNEMENT: Conditionnement = {}

/** Une ligne de la grille. `retenue` est le drapeau « OK » de MIGO. */
interface Ligne {
  cle: string
  retenue: boolean
  id_ligne_bc: string | null
  id_bc: string | null
  numero_bc: string | null
  date_livraison_prevue: string | null
  retard_jours: number | null
  en_cours_kg?: number | null
  en_cours_dans?: string | null
  code_reference: string
  designation: string
  reste_kg: number | null
  unite_catalogue: string
  suivi_lot: number
  devise: string | null
  /** Reference REELLEMENT recue : elle peut differer de celle commandee. */
  code_recu: string
  equivalents: string[]
  motif_substitution: string
  /**
   * LA DEROGATION D'ECART (controle C10). Au-dela de la tolerance, la base
   * refuse la ligne sans derogation nominative et motivee. L'ecran l'annoncait
   * sans jamais permettre de la donner : une livraison partielle ne pouvait
   * donc pas s'enregistrer (constate le 28/09/2026).
   */
  derogation: boolean
  motifDerogation: string
  qte: string
  qteBl: string
  unite: string
  colis: string
  /**
   * CE QU'ON A COMPTE AU QUAI, a cote de ce qu'on a pese.
   *
   * Au camion on compte des palettes, sur la machine des bobines, a la bascule
   * des kilos : trois facons de dire la meme quantite. Les trois se repondent
   * par les parametres de la reference — on saisit celui qu'on a sous les yeux.
   */
  palettes: string
  bobines: string
  /**
   * LE CALCUL EST-IL LIE SUR CETTE LIGNE ?
   *
   * Detache, chaque champ se saisit seul : une palette entamee reste une
   * palette a manutentionner, et un poids pese ne se deduit pas d'un compte.
   * C'est l'operateur qui le sait, pas la formule.
   */
  lie: boolean
  lot: string
  fabrication: string
  peremption: string
  magasin: string
  qualite: string
  prix: string
  notes: string
}

export function ReceptionNouvelle() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()

  // Le jour, en heure locale (toISOString donnerait la veille apres minuit UTC).
  const aujourdhui = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [entete, setEntete] = useState({
    code_fournisseur: '',
    // LA DATE DU FAIT (10/10/2026) : le jour de la livraison, pas celui de la
    // saisie ; l'entree en stock la prend. Jamais dans le futur.
    date_reception: aujourdhui(),
    num_bon_livraison: '',
    numero_facture: '',
    transporteur: '',
    nombre_colis: '',
    poids_total_brut_kg: '',
  })
  const [lignes, setLignes] = useState<Ligne[]>([])
  // Une pesee en cours ne se perd pas d'un clic dans le menu (audit v4).
  const quitter = useGardeSaisie(lignes.length > 0)
  /** Le nom du fournisseur retenu, rendu par la recherche (titre de la reprise). */
  const [nomFournisseur, setNomFournisseur] = useState('')
  const [horsCommande, setHorsCommande] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const voitPrix = droits.visible('prix_kg_devise')

  /** Un EXCEDENT au-dela exige une derogation motivee (C10) ; un manque, non.
   *  Tolerance du fournisseur (regle 14), a defaut le parametre — comme le
   *  serveur (`fn_tolerance_fournisseur`) et l'ecran de la reception enregistree. */
  const TOLERANCE_PCT = useToleranceFournisseur(entete.code_fournisseur || null)

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: ({ signal }) => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1', { signal }),
  })

  /* LE DOSSIER D'IMPORT NE SE CHOISIT PLUS (16/10/2026) : c'est la FACTURE
     qui relie l'importation au bon de commande et a la reception. Le
     magasinier retient ses BONS sur la fiche, et le dossier s'en deduit
     avec sa DUM et ses conteneurs. */
  const magasinDefaut = qMag.data?.[0]?.code_magasin ?? 'MP-01'

  /**
   * LE CONDITIONNEMENT DES REFERENCES EN JEU, et d'elles seules.
   *
   * L'ecran chargeait le CATALOGUE ENTIER pour connaitre le poids d'une bobine :
   * deux mille lignes en memoire pour convertir la dizaine de references d'un
   * camion. Les lignes reprises d'un bon apportent desormais leur
   * conditionnement avec elles, et celles ajoutees hors commande le portent
   * depuis la liste deroulante qui les a proposees.
   */
  const [refsRetenues, setRefsRetenues] = useState<Map<string, RefCatalogue>>(new Map())
  const parReference = refsRetenues
  const retenir = (refs: RefCatalogue[]) =>
    setRefsRetenues((m) => {
      const n = new Map(m)
      refs.forEach((r) => n.set(r.code_reference, r))
      return n
    })
  /** Le conditionnement de la reference REELLEMENT recue — pas de celle commandee. */
  const condDe = (l: Ligne): Conditionnement =>
    parReference.get(l.code_recu) ?? parReference.get(l.code_reference) ?? SANS_CONDITIONNEMENT

  /*
   * LE CONDITIONNEMENT DU LOT POUR RELIER PESEE, PALETTES ET BOBINES
   * (2026-10-23a). Un lot deja connu du registre (une seconde livraison du meme
   * bain) porte son poids de bobine et ses bobines par palette : c'est lui qui
   * relie les trois champs a la frappe, et qui juge le colisage. L'UNITE
   * D'ARCHIVAGE, elle, se convertit toujours par la fiche article (`condDe`) :
   * c'est ce que fait le serveur (`vers_kg`), et une autre base changerait les
   * kilos entres en stock. Un lot nouveau : la fiche article.
   */
  const { condLot } = useConditionnementsLots(
    lignes.filter((l) => l.lot.trim()).map((l) => l.code_recu),
  )
  const condLiaison = (l: Ligne): Conditionnement =>
    conditionnementDuLot(condDe(l), condLot(l.code_recu, l.lot))

  /**
   * Les unites de pesee que la REFERENCE autorise, en plus du kilo.
   *
   * Proposer « Palette » a une reference qui ne dit pas combien de bobines elle
   * porte, c'est promettre une conversion que le serveur refusera (R01) — apres
   * que tout ait ete saisi. La liste ne montre que ce qui passera.
   */
  const uniteesDe = (l: Ligne): string[] => {
    const c = condDe(l)
    const u: string[] = []
    if (facteurVersKg('Bobine', c)) u.push('Bobine')
    if (facteurVersKg('Palette', c)) u.push('Palette')
    if (facteurVersKg('ml', c)) u.push('ml')
    // L'unite du catalogue et celle deja choisie restent offertes, sans quoi le
    // selecteur afficherait une case vide devant une saisie bien reelle.
    for (const autre of [l.unite_catalogue, l.unite])
      if (autre && autre !== 'kg' && !u.includes(autre)) u.push(autre)
    return u
  }

  const qAtt = useQuery({
    queryKey: ['lignes-attendues-frs', entete.code_fournisseur],
    queryFn: () =>
      api.get<LigneAttendue[]>(
        `/api/lignes-attendues?code_fournisseur=${encodeURIComponent(entete.code_fournisseur)}`,
      ),
    enabled: !!entete.code_fournisseur,
  })

  const attendues = useMemo(
    () => (qAtt.data ?? []).filter((l) => l.quantite_restante_kg > 0.001),
    [qAtt.data],
  )

  /** Bons reprenables, avec ce qu'il reste a en tirer une fois la grille servie. */
  const bonsDisponibles = useMemo(() => {
    const prises = new Set(lignes.map((l) => l.id_ligne_bc).filter(Boolean))
    const m = new Map<string, { numero: string; restantes: number; total: number; reste_kg: number }>()
    for (const a of attendues) {
      const e = m.get(a.numero_bc) ?? { numero: a.numero_bc, restantes: 0, total: 0, reste_kg: 0 }
      e.total += 1
      if (!prises.has(a.id_ligne_bc)) {
        e.restantes += 1
        e.reste_kg += a.quantite_restante_kg
      }
      m.set(a.numero_bc, e)
    }
    return [...m.values()].sort((a, b) => a.numero.localeCompare(b.numero))
  }, [attendues, lignes])

  const bonsRepris = useMemo(
    () => [...new Set(lignes.map((l) => l.numero_bc).filter(Boolean) as string[])].sort(),
    [lignes],
  )

  /** Les colis que representerait un poids donne, pour pre-remplir une ligne. */
  const colisAttendus = (code: string, kg: number) =>
    depuisKg(kg, parReference.get(code) ?? SANS_CONDITIONNEMENT)

  /**
   * LE CONDITIONNEMENT DES LIGNES REPRISES D'UN BON.
   *
   * Elles ne passent pas par la liste deroulante : elles viennent du bon de
   * commande. On demande donc au serveur les seules references concernees —
   * une dizaine, jamais le catalogue.
   */
  const qCondBon = useQuery({
    queryKey: ['cond-bon', entete.code_fournisseur],
    queryFn: () =>
      chercherCatalogue('', { fournisseur: entete.code_fournisseur, limite: 500 }),
    enabled: !!entete.code_fournisseur,
  })
  useEffect(() => {
    if (qCondBon.data?.length) retenir(qCondBon.data as unknown as RefCatalogue[])
  }, [qCondBon.data])

  const reprendre = (numeroBc: string) => {
    const prises = new Set(lignes.map((l) => l.id_ligne_bc).filter(Boolean))
    const nouvelles = attendues
      .filter((a) => a.numero_bc === numeroBc && !prises.has(a.id_ligne_bc))
      .map<Ligne>((a) => ({
        cle: `bc:${a.id_ligne_bc}`,
        retenue: true,
        id_ligne_bc: a.id_ligne_bc,
        id_bc: a.id_bc,
        numero_bc: a.numero_bc,
        date_livraison_prevue: a.date_livraison_prevue,
        retard_jours: a.retard_jours,
        en_cours_kg: a.en_cours_kg ?? null,
        en_cours_dans: a.en_cours_dans ?? null,
        code_reference: a.code_reference,
        designation: a.designation,
        code_recu: a.code_reference,
        equivalents: (a.equivalents_recevables ?? '').split(',').filter(Boolean),
        motif_substitution: '',
        derogation: false,
        motifDerogation: '',
        reste_kg: a.quantite_restante_kg,
        unite_catalogue: a.unite_catalogue,
        suivi_lot: a.suivi_lot,
        devise: a.code_devise ?? null,
        // Le reste a livrer sert de proposition : c'est ce qu'on attend, et
        // c'est presque toujours ce qui arrive.
        qte: String(Math.round(a.quantite_restante_kg * 1000) / 1000),
        qteBl: String(Math.round(a.quantite_restante_kg * 1000) / 1000),
        unite: 'kg',
        colis: '',
        // Les colis attendus pour ce reste : le cariste sait tout de suite
        // combien de places il doit trouver dans l'allee.
        palettes: pourChamp(colisAttendus(a.code_reference, a.quantite_restante_kg).palettes),
        // SUIVIE AU LOT, LA BOBINE SE COMPTE (regle 13) : pas de deduction des
        // kilos, le champ attend le compte du quai.
        bobines: a.suivi_lot === 1 ? '' : pourChamp(colisAttendus(a.code_reference, a.quantite_restante_kg).bobines),
        lie: a.suivi_lot !== 1,
        lot: '',
        fabrication: '',
        peremption: '',
        magasin: magasinDefaut,
        qualite: 'CONFORME',
        prix: a.prix_kg_devise != null ? String(a.prix_kg_devise) : '',
        notes: '',
      }))
    if (nouvelles.length === 0) {
      toast.info(`${numeroBc} : toutes ses lignes sont deja dans la grille.`)
      return
    }
    setLignes((l) => [...l, ...nouvelles])
    // La premiere ligne reprise se presente : le curseur attend sa pesee.
    setTimeout(() => allerALaLigne(nouvelles[0].cle), 60)
  }

  const retirerBon = (numeroBc: string) =>
    setLignes((l) => l.filter((x) => x.numero_bc !== numeroBc))

  const ajouterHorsCommande = (refs: { ref: RefCatalogue; qte: number }[]) => {
    // La reference apporte son conditionnement : c'est lui qui permettra de
    // convertir palettes et bobines sur la ligne qu'on vient d'ajouter.
    retenir(refs.map((r) => r.ref))
    const t = Date.now()
    // La premiere ligne ajoutee se presente : elle se saisit sur place.
    if (refs.length > 0) setTimeout(() => allerALaLigne(`hors:${t}:0`), 60)
    setLignes((l) => [
      ...l,
      ...refs.map<Ligne>(({ ref, qte }, i) => ({
        cle: `hors:${t}:${i}`,
        retenue: true,
        id_ligne_bc: null,
        id_bc: null,
        numero_bc: null,
        date_livraison_prevue: null,
        retard_jours: null,
        code_reference: ref.code_reference,
        designation: ref.designation,
        code_recu: ref.code_reference,
        equivalents: [],
        motif_substitution: '',
        derogation: false,
        motifDerogation: '',
        reste_kg: null,
        unite_catalogue: ref.unite_catalogue,
        suivi_lot: ref.suivi_lot,
        // SANS BON DE COMMANDE, LE SERVEUR ENREGISTRE LE PRIX EN MAD, au taux 1.
        // Annoncer la devise du catalogue faisait saisir des euros enregistres
        // comme des dirhams.
        devise: 'MAD',
        qte: String(qte),
        qteBl: String(qte),
        unite: 'kg',
        colis: '',
        palettes: pourChamp(depuisKg(qte, ref).palettes),
        bobines: ref.suivi_lot === 1 ? '' : pourChamp(depuisKg(qte, ref).bobines),
        lie: ref.suivi_lot !== 1,
        lot: '',
        fabrication: '',
        peremption: '',
        magasin: magasinDefaut,
        qualite: 'CONFORME',
        prix: ref.prix_catalogue_kg != null ? String(ref.prix_catalogue_kg) : '',
        notes: '',
      })),
    ])
  }

  const maj = (cle: string, champ: keyof Ligne, v: string | boolean) =>
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, [champ]: v } : x)))

  /**
   * LES TROIS COLIS SE REPONDENT : palettes, bobines, quantite pesee.
   *
   * On saisit celui qu'on a sous les yeux — au camion des palettes, a la
   * bascule des kilos — et les deux autres se calculent par les PARAMETRES DE
   * LA REFERENCE, jamais par un facteur invente ici. Obliger le receptionnaire
   * a convertir de tete, c'est garantir l'erreur au moment ou elle coute le
   * plus cher : la valeur du stock entre par cette porte.
   *
   * Les champs calcules restent MODIFIABLES, et l'interrupteur de la ligne
   * detache le calcul quand le camion ne suit pas la theorie.
   */
  const majColis = (cle: string, source: 'quantite' | 'palettes' | 'bobines', valeur: string) =>
    setLignes((ls) =>
      ls.map((l) => {
        if (l.cle !== cle) return l
        // Le lot connu relie par SON conditionnement ; sinon la fiche article.
        const c0 = condLiaison(l)
        if (!l.lie) {
          const champ =
            source === 'quantite' ? 'qte' : source === 'palettes' ? 'palettes' : 'bobines'
          return { ...l, [champ]: valeur }
        }
        const c =
          source === 'palettes'
            ? depuisPalettes(valeur, c0)
            : source === 'bobines'
              ? depuisBobines(valeur, c0)
              : depuisKg(valeur, c0)

        /* LE POIDS PESE EST TOUJOURS EN KILOS. Exprime dans l'unite de la
           ligne, il obligeait le receptionnaire a choisir son unite avant de
           poser la marchandise sur la bascule, et changer d'unite reecrivait
           le nombre. Or c'est une PESEE : elle est en kilos par nature.
           L'unite ne dit plus que dans quoi la reception sera archivee. */
        return {
          ...l,
          qte: source === 'quantite' ? valeur : pourChamp(c.kg, 3),
          palettes: source === 'palettes' ? valeur : pourChamp(c.palettes),
          bobines: source === 'bobines' ? valeur : pourChamp(c.bobines),
        }
      }),
    )

  /**
   * Changer d'unite ne change PAS la marchandise : le poids reste, son
   * expression change. Reporter tel quel un nombre de kilos dans une case
   * « palettes » multiplierait la reception par mille.
   */
  const majUnite = (cle: string, unite: string) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, unite } : l)))

  /**
   * Ce qui part au serveur pour la quantite d'une ligne.
   *
   * LE QUAI PESE DES KILOS ; LA BASE ARCHIVE L'EXPRESSION DECLAREE. SIX
   * DECIMALES : la colonne n'en garde que quatre, mais le serveur deduit les
   * KILOS de ce nombre avant que la base n'arrondisse. Arrondir ici
   * deplacerait le poids RECU de quelques grammes par ligne — et une
   * reception fausse cree du stock qui n'existe pas.
   *
   * Facteur inconnu : on envoie des kilos plutot qu'un nombre faux dans une
   * unite qu'on ne sait pas convertir. Le garde ci-dessous l'annonce deja au
   * receptionnaire, mais mieux vaut une donnee juste qu'un refus tardif.
   */
  const quantitePourServeur = (l: Ligne) => {
    const kg = Number(l.qte)
    const f = facteurVersKg(l.unite, condDe(l))
    return f
      ? { unite_saisie: l.unite, quantite_pesee_unite: Number((kg / f).toFixed(6)) }
      : { unite_saisie: 'kg', quantite_pesee_unite: kg }
  }

  /** Ce que la ligne pese : le champ lui-meme, sans rien a deduire. */
  const kgDe = (l: Ligne) => (l.qte.trim() === '' ? null : Number(l.qte))

  const retenues = lignes.filter((l) => l.retenue)
  const nbHorsCommande = retenues.filter((l) => !l.id_ligne_bc).length
  const totalKg = retenues.reduce((s, l) => s + (kgDe(l) ?? 0), 0)
  const sansQte = retenues.filter((l) => !(Number(l.qte) > 0))
  /* L'UNITE D'ARCHIVAGE DOIT ETRE CONVERTIBLE. Le poids est pese, il ne peut
     plus manquer — mais si la reference ne sait pas dire ce que vaut une
     palette, on ne peut pas archiver « 3 palettes », et le serveur refuse
     (R01, aucun repli sur un facteur de 1). Autant le dire au quai plutot
     qu'apres avoir tout saisi. */
  const sansFacteur = retenues.filter(
    (l) => Number(l.qte) > 0 && facteurVersKg(l.unite, condDe(l)) === null,
  )
  const sansLot = retenues.filter((l) => l.suivi_lot === 1 && !l.lot.trim())
  // Les bobines comptees, exigees a la soumission au controle (regle 13).
  const sansBobines = retenues.filter(
    (l) => l.suivi_lot === 1 && Number(condDe(l).poids_bobine_kg) > 0 && !(Number(l.bobines) > 0),
  )
  // Une substitution sans motif serait acceptee par la base mais illisible dans
  // six mois : c'est l'ecran qui exige l'explication, au moment ou on l'a.
  const sansMotif = retenues.filter(
    (l) => l.code_recu !== l.code_reference && !l.motif_substitution.trim(),
  )
  const pret =
    !!entete.code_fournisseur &&
    retenues.length > 0 &&
    !sansQte.length &&
    // UN LOT VIDE NE BLOQUE PLUS : un lot interne sera genere a la validation.
    !sansMotif.length &&
    !sansFacteur.length

  const ecartDe = (l: Ligne) => {
    const kg = kgDe(l)
    return l.reste_kg && l.reste_kg > 0 && kg !== null
      ? ((kg - l.reste_kg) / l.reste_kg) * 100
      : null
  }
  /**
   * UNE LIGNE PAR REFERENCE ET PAR LOT (21/10/2026) : le rang (1, 2…) de la
   * ligne retenue PRECEDENTE qui porte la meme ligne de bon, la meme reference
   * recue et le meme lot — ses pesees et celles-ci seront additionnees par le
   * serveur — ou 0. Deux lots differents restent deux lignes.
   */
  const memeLot = (l: Ligne) => {
    const cle = (x: Ligne) => `${x.id_ligne_bc ?? ''}|${x.code_recu}|${x.lot.trim()}`
    const i = lignes.findIndex((x) => x.retenue && cle(x) === cle(l))
    return i >= 0 && lignes[i].cle !== l.cle ? i + 1 : 0
  }
  const nbMemeLot = retenues.filter((l) => memeLot(l) > 0).length

  // L'EXCEDENT SEUL (08/10/2026) : un manque est une livraison partielle, le
  // bon reste LIVRE_PARTIEL. Seul ce qui depasse la tolerance se justifie.
  const horsTolerance = (l: Ligne) => {
    const e = ecartDe(l)
    return e != null && e > TOLERANCE_PCT
  }
  // Hors tolerance, la derogation cochee ET motivee : c'est ce que la base exige.
  const sansDerogation = retenues.filter(
    (l) => horsTolerance(l) && (!l.derogation || !l.motifDerogation.trim()),
  )

  // L'identifiant du document, tire a l'ouverture : un second envoi du meme
  // formulaire rend le meme document (audit P3, 19/10/2026).
  const [idDocument] = useState(nouvelIdentifiant)
  const creer = useMutation({
    mutationFn: () =>
      api.post<{
        id_reception: string
        numero_reception: string
        lignes: number
        numero_bc_regularisation: string | null
        fusions?: string[]
      }>('/api/receptions', {
        id_document: idDocument,
        // Toutes les lignes du meme bon : la reception s'y rattache. Sinon on la
        // laisse sans bon d'entete — chaque ligne garde le sien, et pretendre
        // qu'elle n'en couvre qu'un serait faux.
        id_bc:
          bonsRepris.length === 1 && nbHorsCommande === 0
            ? (retenues.find((l) => l.id_bc)?.id_bc ?? undefined)
            : undefined,
        code_fournisseur: entete.code_fournisseur,
        date_reception: entete.date_reception || undefined,
        num_bon_livraison: entete.num_bon_livraison || undefined,
        numero_facture: entete.numero_facture || undefined,
        transporteur: entete.transporteur || undefined,
        nombre_colis: entete.nombre_colis ? Number(entete.nombre_colis) : undefined,
        poids_total_brut_kg: entete.poids_total_brut_kg
          ? Number(entete.poids_total_brut_kg)
          : undefined,
        lignes: retenues.map((l) => ({
          // C'est la reference REELLEMENT descendue du camion qui entre en
          // stock, pas celle du bon. Envoyer celle du bon creerait du stock sur
          // une matiere qui n'est jamais arrivee.
          code_reference: l.code_recu,
          id_ligne_bc: l.id_ligne_bc ?? undefined,
          substitution_acceptee: l.code_recu !== l.code_reference ? true : undefined,
          motif_substitution:
            l.code_recu !== l.code_reference ? l.motif_substitution.trim() : undefined,
          ...quantitePourServeur(l),
          quantite_bl_kg: l.qteBl ? Number(l.qteBl) : undefined,
          nb_colis_ligne: l.colis ? Number(l.colis) : undefined,
          // LE COLISAGE COMPTE SUR LE QUAI part avec la pesee (10/10/2026). Il
          // s'affichait, et se perdait a l'enregistrement : la soumission au
          // controle refusait ensuite une ligne « sans bobines comptees ».
          nb_palettes: Number(l.palettes) > 0 ? Number(l.palettes) : undefined,
          nb_bobines: Number(l.bobines) > 0 ? Math.round(Number(l.bobines)) : undefined,
          code_magasin_dest: l.magasin,
          lot_fournisseur: l.lot || undefined,
          date_fabrication: l.fabrication || undefined,
          date_peremption: l.peremption || undefined,
          statut_qualite: l.qualite,
          derogation_ecart: horsTolerance(l) && l.derogation ? true : undefined,
          motif_derogation:
            horsTolerance(l) && l.derogation ? l.motifDerogation.trim() : undefined,
          // Le prix n'accompagne que les lignes hors commande : ailleurs c'est
          // le prix ENGAGE du bon qui fait foi, et le renvoyer l'ecraserait.
          prix_kg_devise: !l.id_ligne_bc && l.prix ? Number(l.prix) : undefined,
          notes: l.notes || undefined,
        })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.numero_reception} enregistree`, {
        description: r.numero_bc_regularisation
          ? `${r.lignes} pesee(s). Bon de regularisation ${r.numero_bc_regularisation} cree en brouillon : a valider et envoyer avant le controle.`
          : `${r.lignes} pesee(s) · en saisie, rien n'est encore entre en stock.` +
            (r.fusions?.length ? ` Une ligne par lot : ${r.fusions.join(' ')}` : ''),
        duration: r.numero_bc_regularisation ? 12000 : undefined,
      })
      void qc.invalidateQueries({ queryKey: ['receptions'] })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      naviguer(`/receptions/${r.id_reception}`)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  /* UN MAGASIN DE DESTINATION GELE PAR UN INVENTAIRE OUVERT (23/10/2026) : la
     pesee s'enregistre (rien n'entre en stock), la validation sera refusee —
     tout le magasin pour un global, ses seules references pour un tournant ou
     un cible (2026-10-24a). */
  const gel = useGelInventaire(
    lignes.map((l) => l.magasin),
    lignes.map((l) => ({ magasin: l.magasin, reference: l.code_reference })),
  )

  /*
   * LA SAISIE SUR LA LIGNE (24/10/2026) : chaque ligne se saisit dans la
   * grille, au modele du bon de commande — plus de panneau a onglets en bas.
   * La grille recoit ce qu'elle montre ; chaque frappe revient ici, ou le lien
   * kilos / palettes / bobines et l'unite gardent leurs regles.
   */
  const poser = (cle: string, champ: ChampRec, v: string | boolean) => {
    if (champ === 'qte') return majColis(cle, 'quantite', String(v))
    if (champ === 'palettes' || champ === 'bobines') return majColis(cle, champ, String(v))
    if (champ === 'unite') return majUnite(cle, String(v))
    maj(cle, champ, v)
  }
  const vues: VueLigneRec[] = lignes.map((l) => ({
    cle: l.cle,
    retenue: l.retenue,
    code_reference: l.code_reference,
    code_recu: l.code_recu,
    designation: l.designation,
    numero_bc: l.numero_bc,
    reste_kg: l.reste_kg,
    retard_jours: l.retard_jours,
    en_cours_kg: l.en_cours_kg,
    en_cours_dans: l.en_cours_dans,
    suivi_lot: l.suivi_lot === 1,
    qteBl: l.qteBl,
    qte: l.qte,
    unite: l.unite,
    unites: uniteesDe(l),
    convertible: l.unite === 'kg' || facteurVersKg(l.unite, condDe(l)) !== null,
    palettes: l.palettes,
    bobines: l.bobines,
    lie: l.lie,
    // SUIVIE AU LOT, LA BOBINE SE COMPTE (regle 13) : pas de liaison offerte.
    liaisonOfferte: l.suivi_lot !== 1,
    lot: l.lot,
    magasin: l.magasin,
    qualite: l.qualite,
    derogation: l.derogation,
    motifDerogation: l.motifDerogation,
    fabrication: l.fabrication,
    peremption: l.peremption,
    notes: l.notes,
    colis: l.colis,
    equivalents: l.equivalents,
    motif_substitution: l.motif_substitution,
    prix: l.id_ligne_bc ? undefined : l.prix,
    devise: l.devise,
    // En lecture, pour le detail de la ligne : ce que le bon engage et promet.
    prix_engage: l.id_ligne_bc && l.prix.trim() !== '' ? Number(l.prix) : null,
    date_promise: l.date_livraison_prevue,
    cond: condLiaison(l),
    rangMemeLot: l.retenue ? memeLot(l) : 0,
  }))

  /* LES INDICATEURS DE LA BARRE (24/10/2026) : des quantites, chacune avec sa
     couleur et son mot. Les ecarts ne portent que sur les lignes qui ont un
     terme de comparaison : une ligne sans BL ne creuse pas un faux ecart au BL. */
  const rang = (l: Ligne) => lignes.findIndex((x) => x.cle === l.cle) + 1
  const avecBl = retenues.filter((l) => l.qteBl.trim() !== '')
  const totalBl = avecBl.reduce((s, l) => s + Number(l.qteBl), 0)
  const peseAvecBl = avecBl.reduce((s, l) => s + (kgDe(l) ?? 0), 0)
  const avecBc = retenues.filter((l) => l.reste_kg != null)
  const totalBc = avecBc.reduce((s, l) => s + (l.reste_kg ?? 0), 0)
  const peseAvecBc = avecBc.reduce((s, l) => s + (kgDe(l) ?? 0), 0)
  const somme = (ls: Ligne[], f: (l: Ligne) => number | null) => ls.reduce((s, l) => s + (f(l) ?? 0), 0)
  const palettesComptees = somme(retenues, (l) => (l.palettes.trim() === '' ? 0 : Number(l.palettes)))
  const bobinesComptees = somme(retenues, (l) => (l.bobines.trim() === '' ? 0 : Number(l.bobines)))
  const palettesAttendues = somme(avecBc, (l) => depuisKg(l.reste_kg, condLiaison(l)).palettes)
  const bobinesAttendues = somme(avecBc, (l) => depuisKg(l.reste_kg, condLiaison(l)).bobines)
  const indicateurs: IndicateurRec[] = [
    {
      libelle: 'Lignes',
      valeur: `${retenues.length}/${lignes.length}`,
      mot: 'retenue(s)',
      ton: retenues.length ? 'neutre' : 'alerte',
    },
    { libelle: 'Pesé', valeur: `${fmt.nombre(totalKg, 2)} kg` },
    ...(avecBl.length
      ? [{
          libelle: 'BL',
          secondaire: true,
          valeur: `${fmt.nombre(totalBl, 2)} kg · ${texteEcartKg(peseAvecBl - totalBl)}`,
          mot: Math.abs(peseAvecBl - totalBl) <= 0.001 ? 'conforme' : 'écart',
          ton: tonEcartKg(peseAvecBl - totalBl),
          titre: 'Ce que le bon de livraison annonce, et l’écart de la pesée (litige de transport)',
        }]
      : []),
    ...(avecBc.length
      ? [{
          libelle: 'Bon',
          secondaire: true,
          valeur: `${fmt.nombre(totalBc, 2)} kg · ${texteEcartKg(peseAvecBc - totalBc)}`,
          mot: Math.abs(peseAvecBc - totalBc) <= 0.001 ? 'soldé' : peseAvecBc < totalBc ? 'reliquat' : 'excédent',
          ton: tonEcartKg(peseAvecBc - totalBc),
          titre: 'Ce que les bons attendent encore sur ces lignes, et l’écart de la pesée',
        }]
      : []),
    {
      libelle: 'Palettes',
      secondaire: true,
      valeur: `${fmt.nombre(palettesComptees, 2)} / ${fmt.nombre(palettesAttendues, 0)}`,
      mot: palettesAttendues ? (Math.abs(palettesComptees - palettesAttendues) < 0.005 ? 'conforme' : 'écart') : 'comptées',
      ton: palettesAttendues ? (Math.abs(palettesComptees - palettesAttendues) < 0.005 ? 'succes' : 'alerte') : 'neutre',
      titre: 'Palettes comptées / attendues au bon (déduites du reste par le conditionnement)',
    },
    {
      libelle: 'Bobines',
      secondaire: true,
      valeur: `${fmt.nombre(bobinesComptees, 0)} / ${fmt.nombre(bobinesAttendues, 0)}`,
      mot: sansBobines.length
        ? `${sansBobines.length} à compter`
        : bobinesAttendues
          ? Math.abs(bobinesComptees - bobinesAttendues) < 0.5 ? 'conforme' : 'écart'
          : 'comptées',
      ton: sansBobines.length
        ? 'alerte'
        : bobinesAttendues
          ? Math.abs(bobinesComptees - bobinesAttendues) < 0.5 ? 'succes' : 'alerte'
          : 'neutre',
      titre: 'Bobines comptées / attendues au bon (déduites du reste par le conditionnement)',
    },
  ]
  const lignesHors = retenues
    .filter((l) => horsTolerance(l))
    .map((l) => ({ cle: l.cle, rang: rang(l), code: l.code_recu, derogee: l.derogation && !!l.motifDerogation.trim() }))
  const noms = (ls: Ligne[]) => ls.map((l) => `L${rang(l)} ${l.code_recu}`).join(', ')
  const blocages: MessageRec[] = [
    ...(!entete.code_fournisseur ? [{ texte: 'choisissez le fournisseur.' }] : []),
    ...(entete.code_fournisseur && retenues.length === 0
      ? [{ texte: 'aucune ligne retenue : reprenez un bon, ou ajoutez un article hors commande.' }]
      : []),
    ...(sansQte.length ? [{ texte: `quantité pesée manquante — ${noms(sansQte)}.`, cle: sansQte[0].cle }] : []),
    ...(sansDerogation.length
      ? [{
          texte: `excédent au-delà de la tolérance (${fmt.nombre(TOLERANCE_PCT, 1)} %) : cochez « Dérogation » et donnez le motif — ${noms(sansDerogation)}.`,
          cle: sansDerogation[0].cle,
        }]
      : []),
    ...(sansMotif.length
      ? [{ texte: `motif de substitution manquant — ${noms(sansMotif)}.`, cle: sansMotif[0].cle }]
      : []),
    ...(sansFacteur.length
      ? [{
          texte: `conversion impossible en ${sansFacteur[0].unite} — ${noms(sansFacteur)} : renseignez le conditionnement sur la référence, ou archivez en kg.`,
          cle: sansFacteur[0].cle,
        }]
      : []),
    ...(!droits.peutEcrire ? [{ texte: 'vous n’avez pas le droit d’écrire une réception.' }] : []),
  ]
  const avis: MessageRec[] = [
    ...(sansBobines.length
      ? [{
          texte: `${sansBobines.length} ligne(s) suivie(s) au lot sans bobines comptées : à compter avant la soumission au contrôle — ${noms(sansBobines)}.`,
          cle: sansBobines[0].cle,
        }]
      : []),
    ...(nbHorsCommande
      ? [{ texte: `${nbHorsCommande} ligne(s) sans commande : un bon de régularisation sera créé en brouillon, à valider et envoyer avant le contrôle.` }]
      : []),
    ...(nbMemeLot
      ? [{ texte: `${nbMemeLot} ligne(s) du même lot qu’une autre : les pesées seront additionnées (une ligne par lot).` }]
      : []),
    ...(sansLot.length
      ? [{ texte: `${sansLot.length} ligne(s) suivie(s) au lot sans lot : un lot interne sera généré à la validation.` }]
      : []),
  ]

  return (
    <div>
      <EnTetePage
        titre="Nouvelle réception"
        description="Reprenez un ou plusieurs bons du fournisseur, saisissez les pesées sur leurs lignes, enregistrez l'ensemble en une fois."
        actions={
          <Bouton variante="contour" onClick={() => quitter(() => naviguer('/receptions'))}>
            <ArrowLeft />
            Retour
          </Bouton>
        }
      />
      <PanneRequetes requetes={[['Les magasins', qMag], ['Les lignes attendues', qAtt]]} />
      <AvisInventaireOuvert inventaires={gel} nommer className="mb-3" />

      {erreur && (
        <Alerte ton="danger" titre="Enregistrement refusé" className="mb-3">
          {erreur}
        </Alerte>
      )}

      <div className="space-y-3">
        {/* ---- En-tête ---------------------------------------------------- */}
        <Carte repliable="receptionnouvelle.1">
          <CarteEntete>
            <CarteTitre>En-tête</CarteTitre>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            <div className="sm:col-span-2">
              <Etiq htmlFor="frs" obligatoire>
                Fournisseur
                <Aide>Changer de fournisseur vide la grille : ses lignes viennent de ses bons.</Aide>
              </Etiq>
              {/* LE FOURNISSEUR SE CHERCHE (24/10/2026) : on tape, le serveur cherche. */}
              <ChoixRecherche
                type="fournisseur"
                id="frs"
                ariaLabel="Fournisseur"
                valeur={entete.code_fournisseur}
                libelle={nomFournisseur ? `${entete.code_fournisseur} — ${nomFournisseur}` : undefined}
                onChange={(code, ligne) => {
                  if (code === entete.code_fournisseur) return
                  setEntete({ ...entete, code_fournisseur: code })
                  setNomFournisseur(ligne?.nom ? String(ligne.nom) : '')
                  setLignes([])
                }}
              />
            </div>
            <div>
              <Etiq htmlFor="date-rec" obligatoire>
                Date de réception
                <Aide>Le jour où la marchandise est arrivée (un BL du samedi saisi le lundi garde le samedi). Jamais dans le futur, jamais avant le bon de commande.</Aide>
              </Etiq>
              <Champ
                id="date-rec"
                type="date"
                max={aujourdhui()}
                value={entete.date_reception}
                onChange={(e) => setEntete({ ...entete, date_reception: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="bl">Bon de livraison</Etiq>
              <Champ
                id="bl"
                value={entete.num_bon_livraison}
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
                onChange={(e) => setEntete({ ...entete, numero_facture: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="tr">Transporteur</Etiq>
              <Champ
                id="tr"
                value={entete.transporteur}
                onChange={(e) => setEntete({ ...entete, transporteur: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="colis">Nombre de colis</Etiq>
              <Champ
                id="colis"
                type="number"
                min="0"
                value={entete.nombre_colis}
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
                onChange={(e) => setEntete({ ...entete, poids_total_brut_kg: e.target.value })}
                className="text-right tabular-nums"
              />
            </div>
          </CarteCorps>
        </Carte>

        {!entete.code_fournisseur ? (
          <Alerte ton="info">
            Choisissez un fournisseur : ses bons en attente de livraison deviendront reprenables,
            un par un, et leurs lignes s'ajouteront à la grille de saisie.
          </Alerte>
        ) : (
          <Carte repliable="receptionnouvelle.3">
            <CarteEntete>
              <CarteTitre>
                Lignes de la réception
                {lignes.length > 0 && ` (${retenues.length}/${lignes.length})`}
              </CarteTitre>
              {lignes.length > 0 && (
                <div className="flex items-center gap-1">
                  <Bouton
                    variante="discret"
                    taille="sm"
                    onClick={() => setLignes((l) => l.map((x) => ({ ...x, retenue: true })))}
                  >
                    <CheckCheck />
                    Tout retenir
                  </Bouton>
                  <Bouton
                    variante="discret"
                    taille="sm"
                    onClick={() => setLignes((l) => l.map((x) => ({ ...x, retenue: false })))}
                  >
                    Tout décocher
                  </Bouton>
                </div>
              )}
            </CarteEntete>
            {/* ---- La reprise des bons, au-dessus de la grille ------------- */}
            <CarteCorps className="space-y-2 border-b border-bordure">
              {qAtt.isLoading ? (
                <Chargement texte="Lecture des bons de commande…" />
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1 basis-72">
                    <Etiq htmlFor="bon">
                      Reprendre un bon de {nomFournisseur || entete.code_fournisseur}
                      <Aide>Choisir un bon ajoute ses lignes à la grille, sans effacer les précédentes : un camion qui porte deux bons se saisit en une fois.</Aide>
                    </Etiq>
                    {/* LE BON SE CHERCHE dans ceux qui attendent encore de la
                        marchandise de ce fournisseur ; le choisir reprend ses lignes. */}
                    <ChoixRecherche
                      id="bon"
                      ariaLabel="Bon de commande"
                      valeur=""
                      options={bonsDisponibles
                        .filter((b) => b.restantes > 0)
                        .map((b) => ({
                          valeur: b.numero,
                          libelle: b.numero,
                          info: `${b.restantes} ligne(s) à reprendre sur ${b.total} · reste ${fmt.nombre(b.reste_kg, 0)} kg`,
                        }))}
                      placeholder={
                        bonsDisponibles.some((b) => b.restantes > 0)
                          ? 'Tapez ou choisissez un bon à reprendre…'
                          : 'Aucun bon en attente de livraison'
                      }
                      onChange={(numero) => numero && reprendre(numero)}
                    />
                  </div>
                  <Bouton variante="contour" onClick={() => setHorsCommande(true)}>
                    <Plus />
                    Article hors commande
                  </Bouton>
                  {bonsRepris.length > 0 && (
                    <div className="flex basis-full flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-attenue-texte">Bons repris :</span>
                      {bonsRepris.map((b) => (
                        <span
                          key={b}
                          className="inline-flex items-center gap-1 rounded-full border border-bordure px-2 py-0.5 text-[11px] tabular-nums"
                        >
                          {b}
                          <button
                            type="button"
                            onClick={() => retirerBon(b)}
                            className="text-attenue-texte hover:text-danger"
                            aria-label={`Retirer ${b}`}
                            title="Retirer toutes ses lignes de la grille"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SUR LA PAGE, PAS EN FENETRE (audit v5, F20) : un article de
                  plus au document se saisit dans le document. */}
              {horsCommande && (
                <PanneauHorsCommande
                  voitPrix={voitPrix}
                  surFermeture={() => setHorsCommande(false)}
                  surAjout={(refs) => {
                    ajouterHorsCommande(refs)
                    setHorsCommande(false)
                  }}
                />
              )}

              {nbHorsCommande > 0 && (
                <Alerte ton="alerte" titre="Marchandise sans commande">
                  {nbHorsCommande} ligne(s) n'ont aucun bon derrière elles. À l'enregistrement, un
                  bon de commande sera créé en brouillon pour les couvrir. La réception ne pourra
                  être <strong>contrôlée</strong> qu'une fois ce bon validé puis envoyé — c'est ce
                  qui évite qu'une marchandise entre en stock sans engagement.
                </Alerte>
              )}
            </CarteCorps>
            <CarteCorps className="p-0">
              {lignes.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-attenue-texte">
                  Reprenez un bon de commande, ou ajoutez un article hors commande.
                </div>
              ) : (
                <GrilleReception
                  lignes={vues}
                  tolerancePct={TOLERANCE_PCT}
                  magasins={qMag.data ?? []}
                  poser={poser}
                  surRetirer={(cle) => setLignes((x) => x.filter((y) => y.cle !== cle))}
                  voitPrix={voitPrix}
                />
              )}
            </CarteCorps>
          </Carte>
        )}
      </div>

      <BarreReception
        indicateurs={indicateurs}
        horsTolerance={lignesHors}
        tolerancePct={TOLERANCE_PCT}
        blocages={blocages}
        avis={avis}
        actions={
          <>
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/receptions'))}>
              Annuler
            </Bouton>
            <Bouton
              onClick={() => {
                setErreur(null)
                creer.mutate()
              }}
              chargement={creer.isPending}
              disabled={!pret || sansDerogation.length > 0 || !droits.peutEcrire}
              title={blocages[0] ? `Bloquant : ${blocages[0].texte}` : undefined}
            >
              <Save />
              Enregistrer la réception
            </Bouton>
          </>
        }
      />
    </div>
  )
}

/**
 * Ajout d'un article qu'aucun bon ne couvre.
 *
 * Le cas est reel : reliquat, remplacement, envoi anticipe. On saisit ce qui est
 * la, et le serveur cree le bon manquant — la marchandise entre dans le systeme,
 * mais l'anomalie reste visible jusqu'a sa regularisation.
 */
function PanneauHorsCommande({
  voitPrix,
  surFermeture,
  surAjout,
}: {
  voitPrix: boolean
  surFermeture: () => void
  surAjout: (refs: { ref: RefCatalogue; qte: number }[]) => void
}) {
  /**
   * ON TAPE, LE SERVEUR CHERCHE.
   *
   * Ce panneau chargeait le catalogue entier pour en montrer quarante lignes,
   * filtrees dans le navigateur. A mille references, c'est une seconde
   * d'attente pour ajouter UN article au quai — le moment ou l'on a le moins
   * de temps.
   */
  const [choisies, setChoisies] = useState<{ ref: RefCatalogue; qte: string }[]>([])

  const retenues = choisies.filter((c) => Number(c.qte) > 0)

  return (
    <div className="rounded-[var(--radius)] border border-primaire/40 bg-primaire/[0.04] p-3">
        <div className="mb-2">
          <div className="text-[13px] font-semibold">Article hors commande</div>
          <p className="m-0 text-[12px] text-attenue-texte">
            La marchandise est au quai sans bon derrière elle. Saisissez-la : le bon manquant sera créé.
          </p>
        </div>
        <ChampReference
          valeur=""
          surChoix={(r) =>
            setChoisies((c) =>
              c.some((x) => x.ref.code_reference === r.code_reference)
                ? c
                : [...c, { ref: r as unknown as RefCatalogue, qte: '' }],
            )
          }
          dejaPrises={new Set(choisies.map((c) => c.ref.code_reference))}
          placeholder="Référence — tapez pour chercher…"
          ariaLabel="Référence hors commande"
          autoFocus
        />

        {choisies.length === 0 && (
          <Alerte ton="info" className="mt-3">
            Tapez le début d’un code, d’une désignation ou d’une couleur. Les références retenues
            s’ajoutent ci-dessous, avec leur poids.
          </Alerte>
        )}

        <div className="mt-3 space-y-1">
          {choisies.map((c, i) => (
            <div
              key={c.ref.code_reference}
              className="flex items-center gap-2 rounded-[var(--radius)] border border-bordure p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{c.ref.code_reference}</span>
                  {c.ref.suivi_lot === 1 && <Badge ton="info">lot obligatoire</Badge>}
                </div>
                <div className="truncate text-[11px] text-attenue-texte">
                  {c.ref.designation}
                  {voitPrix && c.ref.prix_catalogue_kg != null && (
                    <> · catalogue {fmt.nombre(c.ref.prix_catalogue_kg, 4)}{' '}
                      {c.ref.code_devise_catalogue}/kg</>
                  )}
                </div>
              </div>
              <Champ
                type="number"
                step="any"
                min="0"
                value={c.qte}
                onChange={(e) =>
                  setChoisies((ls) =>
                    ls.map((x, k) => (k === i ? { ...x, qte: e.target.value } : x)),
                  )
                }
                placeholder="kg"
                className="h-8 w-28 text-right tabular-nums"
                aria-label={`Quantite pour ${c.ref.code_reference}`}
              />
              <Bouton
                variante="discret"
                taille="icone-xs"
                className="text-danger hover:bg-danger/10"
                aria-label="Retirer"
                onClick={() => setChoisies((ls) => ls.filter((_, k) => k !== i))}
              >
                <X />
              </Bouton>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-bordure pt-3">
          <span className="text-[11px] text-attenue-texte">
            {retenues.length} référence(s) — ajoutées au document, rien n’est enregistré
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton
              disabled={!retenues.length}
              onClick={() =>
                surAjout(retenues.map((c) => ({ ref: c.ref, qte: Number(c.qte) })))
              }
            >
              <Plus />
              Ajouter {retenues.length || ''}
            </Bouton>
          </div>
        </div>
    </div>
  )
}

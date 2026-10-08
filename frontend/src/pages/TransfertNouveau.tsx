/**
 * Saisie d'un transfert — en-tete ET lignes ensemble, a la creation comme a la
 * reprise.
 *
 * Un transfert est un DOCUMENT : deux magasins, une date, un responsable, et ce
 * qu'on charge. Le creer vide puis lui ajouter des lignes une par une laissait
 * des transferts sans contenu au milieu de la numerotation, et obligeait a
 * revenir dessus pour comprendre ce qu'ils portaient.
 *
 * Le meme ecran REPREND un brouillon : tant que rien n'est parti, une quantite
 * mal comptee ou une palette oubliee se corrigent ici. Passe l'expedition,
 * l'ecran devient consultatif — les mouvements sont au grand livre, que R03
 * rend immuable.
 *
 * LA GRILLE EST CELLE DU BON DE COMMANDE (02/10/2026). La reference se choisit
 * DANS la ligne, parmi ce que le magasin source detient ; kilos, palettes et
 * bobines se repondent comme partout ailleurs. Le panneau lateral « Charger des
 * references » a disparu : un document ne se saisit jamais dans une fenetre
 * surgissante, et deux chemins pour un meme geste font deux endroits a corriger
 * le jour ou la regle change.
 *
 * Les lignes portent le CONDITIONNEMENT reellement charge — bobines, palettes —
 * en plus du poids. Ce n'est pas une conversion du kg : un camion emporte trois
 * palettes completes et quatre bobines isolees, et c'est ce decompte que le
 * magasin destinataire verifiera au dechargement.
 *
 * Rien ne part au serveur avant le clic final.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Save, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { ChampLot } from '../composants/ChampLot'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  GrilleLignes,
  type ColonneGrille,
  type LigneSaisie,
  type RefLigne,
} from '../composants/GrilleLignes'
import {
  Alerte,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { libelleLot, useTolerancesLot } from '../lib/lots'
import {
  type Conditionnement,
  depuisKg,
  facteurVersKg,
  pourChamp, saisieExacte } from '../lib/conditionnement'
import { useGardeSaisie } from '../hooks/useGardeSaisie'

const MODULE = 'MOUVEMENTS'

/** La base refuse le lot comme unite de transfert : c'est une unite d'achat. */
const UNITES_TRANSFERT = ['Bobine', 'Palette', 'ml']

/** Une ligne du stock du magasin source, avec le conditionnement de la reference. */
interface RefStock extends Record<string, unknown> {
  code_reference: string
  designation: string
  code_magasin: string
  quantite_kg: number
  unite_catalogue?: string | null
  suivi_lot?: number | boolean | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  densite_kg_ml?: number | null
}

/** Un lot que le magasin source tient d'une reference. */
interface LotMagasin {
  lot_fournisseur: string
  quantite_kg: number
  nb_bobines: number | null
  date_premiere_entree: string
}

interface DossierLigne extends Record<string, unknown> {
  ligne_numero: number
  code_reference: string
  designation: string
  quantite_kg: number
  quantite_saisie: number | null
  unite_saisie: string | null
  nb_bobines: number | null
  nb_palettes: number | null
  lot_fournisseur: string | null
}

interface DossierEntete extends Record<string, unknown> {
  numero_transfert: string
  statut: string
  code_magasin_source: string
  code_magasin_dest: string
  date_transfert: string
  responsable: string | null
  transporteur: string | null
  observations: string | null
}

/**
 * Le conditionnement d'une reference, lu dans le stock du magasin source.
 *
 * SANS LE BAIN (`bobines_par_lot`). La grille prend la plus grosse unite que la
 * reference sait exprimer, et le lot passerait devant la palette — or la base
 * refuse le lot sur un transfert. Le retirer ici laisse la palette en tete.
 */
const condDuStock = (s: RefStock | undefined): Conditionnement =>
  s
    ? {
        poids_bobine_kg: s.poids_bobine_kg,
        bobines_par_palette: s.bobines_par_palette,
        densite_kg_ml: s.densite_kg_ml,
      }
    : {}

/** Le suivi par lot, quelle que soit la forme que la base lui donne. */
const estSuiviLot = (s: RefStock | undefined) => {
  const v = s?.suivi_lot
  return v === true || Number(v) === 1
}

/** Un nombre lu du serveur — numeric peut arriver en texte. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Une ligne du brouillon revient dans la grille.
 *
 * RELUE EN KILOS : la base garde la quantite dans l'unite declaree, la grille
 * saisit toujours des kilos. Le colisage enregistre prime sur le calcul — il a
 * ete compte par quelqu'un — et la ligne revient alors DETACHEE, pour que la
 * premiere frappe ne le recalcule pas en silence. Elle arrive VALIDEE : on la
 * rouvre au crayon.
 */
function depuisLigneTransfert(l: DossierLigne, fiche: RefStock | undefined): LigneSaisie {
  const cond = condDuStock(fiche)
  const kg = num(l.quantite_kg) ?? 0
  const palettes = num(l.nb_palettes)
  const bobines = num(l.nb_bobines)
  const colis = depuisKg(kg, cond)
  return {
    cle: `t:${l.ligne_numero}`,
    nature: 'MARCHANDISE',
    code_reference: l.code_reference,
    intitule: l.designation ?? l.code_reference,
    cond,
    unite_catalogue: fiche?.unite_catalogue ?? 'kg',
    fournisseur_habituel: null,
    suggere_kg: null,
    qte: pourChamp(kg, 3),
    unite: l.unite_saisie ?? 'kg',
    palettes: palettes != null ? String(palettes) : pourChamp(colis.palettes),
    bobines: bobines != null ? String(bobines) : pourChamp(colis.bobines),
    lie: palettes == null && bobines == null,
    valide: true,
    prix: '',
    reference_fournisseur: '',
    couleur: '',
    code_couleur: '',
    extra: { lot: l.lot_fournisseur ?? '' },
  }
}

/** Un compte de colis utilisable, ou rien. Une chaine vide n'est pas un zero. */
function nombreColis(v: string, entier: boolean) {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n) || n < 0) return undefined
  // UNE BOBINE NE SE COUPE PAS ; une palette s'entame.
  return entier ? Math.round(n) : Number(n.toFixed(2))
}

/**
 * Ce que le serveur attend pour UNE ligne de transfert.
 *
 * L'ecran saisit des kilos ; la base archive l'expression declaree. SIX
 * DECIMALES : la colonne n'en garde que quatre, mais le serveur deduit les
 * KILOS de ce nombre avant que la base n'arrondisse. Arrondir ici deplacerait
 * le poids transfere de quelques grammes par ligne.
 *
 * Facteur inconnu : on envoie des kilos plutot qu'un nombre faux dans une
 * unite qu'on ne sait pas convertir.
 */
function corpsTransfert(l: LigneSaisie) {
  const kg = Number(l.qte)
  const f = facteurVersKg(l.unite, l.cond)
  return {
    code_reference: l.code_reference,
    ...saisieExacte(kg, l.unite, f),
    lot_fournisseur: l.extra?.lot?.trim() || undefined,
    nb_palettes: nombreColis(l.palettes, false),
    nb_bobines: nombreColis(l.bobines, true),
  }
}

/** Une ligne laissee vide — ajoutee puis jamais remplie — ne compte pas. */
const estRemplie = (l: LigneSaisie) => !!l.code_reference || !!l.intitule.trim()

export function TransfertNouveau() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const confirmation = useConfirmation()
  const tolerances = useTolerancesLot()
  const { id } = useParams()
  const reprise = !!id

  const [entete, setEntete] = useState({
    code_magasin_source: '',
    code_magasin_dest: '',
    date_transfert: new Date().toISOString().slice(0, 10),
    responsable: '',
    transporteur: '',
    observations: '',
  })
  const [lignes, setLignes] = useState<LigneSaisie[]>([])
  // Un transfert en cours de saisie ne se perd pas d'un clic dans le menu (audit v4).
  useGardeSaisie(lignes.length > 0)
  const [erreur, setErreur] = useState<string | null>(null)

  // --- Reprise d'un brouillon ---------------------------------------------
  const qDossier = useQuery({
    queryKey: ['dossier-transfert', id],
    queryFn: () =>
      api.get<{ entete: DossierEntete; lignes: DossierLigne[] }>(`/api/transferts/${id}`),
    enabled: reprise,
    // Un document en cours de saisie ne se relit pas sous les doigts de celui
    // qui le remplit : un retour sur la fenetre relancerait la requete et
    // ecraserait ce qu'il vient de taper.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })

  // Ce que le magasin source a REELLEMENT en stock : on ne transfere pas ce
  // qu'on n'a pas, et R02 le refuserait de toute facon a l'expedition. Le
  // conditionnement et le suivi de lot voyagent avec chaque ligne.
  const qStock = useQuery({
    queryKey: ['stock-magasin', entete.code_magasin_source],
    queryFn: () =>
      api.get<RefStock[]>(
        `/api/stock?code_magasin=${encodeURIComponent(entete.code_magasin_source)}&limite=2000`,
      ),
    enabled: !!entete.code_magasin_source,
  })

  /** Le stock de la source, par reference. */
  const parRef = useMemo(() => {
    const m = new Map<string, RefStock>()
    for (const r of qStock.data ?? []) m.set(r.code_reference, r)
    return m
  }, [qStock.data])

  // Le formulaire se remplit UNE FOIS depuis le serveur, a l'ouverture du
  // document. Le relier a chaque arrivee de donnees ferait de la saisie un
  // combat : chaque rafraichissement rendrait au champ sa valeur d'origine, et
  // la correction d'une faute de frappe semblerait simplement impossible.
  //
  // EN DEUX TEMPS : l'en-tete d'abord, qui designe le magasin source ; les
  // lignes ensuite, une fois le stock de ce magasin lu — c'est lui qui porte le
  // conditionnement sans lequel une ligne en palettes ne se relit pas en kilos.
  const enteteRempli = useRef<string | null>(null)
  const lignesRemplies = useRef<string | null>(null)

  useEffect(() => {
    const d = qDossier.data
    if (!d?.entete || enteteRempli.current === id) return
    enteteRempli.current = id ?? null
    setEntete({
      code_magasin_source: d.entete.code_magasin_source ?? '',
      code_magasin_dest: d.entete.code_magasin_dest ?? '',
      date_transfert: (d.entete.date_transfert ?? '').slice(0, 10),
      responsable: d.entete.responsable ?? '',
      transporteur: d.entete.transporteur ?? '',
      observations: d.entete.observations ?? '',
    })
  }, [qDossier.data, id])

  const stockLu = qStock.isSuccess || qStock.isError
  useEffect(() => {
    const d = qDossier.data
    if (!d?.entete || lignesRemplies.current === id) return
    // Le stock lu doit etre celui de la source du document, pas d'un autre.
    if (entete.code_magasin_source !== d.entete.code_magasin_source || !stockLu) return
    lignesRemplies.current = id ?? null
    setLignes(d.lignes.map((l) => depuisLigneTransfert(l, parRef.get(l.code_reference))))
  }, [qDossier.data, id, entete.code_magasin_source, stockLu, parRef])

  const statut = qDossier.data?.entete?.statut
  const parti = reprise && !!statut && statut !== 'BROUILLON'
  const modifiable = !parti && droits.peutEcrire

  const disponibles = useMemo(
    () => (qStock.data ?? []).filter((s) => s.quantite_kg > 0.001),
    [qStock.data],
  )

  /*
   * CE QUE LA LISTE DEROULANTE PROPOSE : le stock de la source, et lui seul.
   *
   * Le stock disponible s'affiche en mention de la suggestion — c'est ce que
   * le cariste veut lire avant de choisir. Le champ `statut_stock` ne sert a la
   * grille qu'a cet affichage.
   */
  const proposees = useMemo<RefLigne[]>(
    () =>
      disponibles.map((s) => ({
        code_reference: s.code_reference,
        designation: s.designation,
        unite_catalogue: s.unite_catalogue ?? 'kg',
        ...condDuStock(s),
        bobines_par_lot: null,
        statut_stock: `${fmt.nombre(s.quantite_kg, 0)} kg en stock`,
      })),
    [disponibles],
  )

  /** On ne transfere que ce que la source detient : la recherche reste locale. */
  const chercherStock = async (motif: string): Promise<RefLigne[]> => {
    const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
    return proposees.filter((r) =>
      mots.every((m) => `${r.code_reference} ${r.designation ?? ''}`.toLowerCase().includes(m)),
    )
  }

  const dispoDe = (code: string) => parRef.get(code)?.quantite_kg ?? 0

  /*
   * LES LOTS DE LA SOURCE, pour chaque reference posee sur le document.
   *
   * Meme cle que le selecteur de lot : la liste n'est lue qu'une fois, et la
   * colonne « Dispo » montre ce que le lot choisi contient vraiment.
   */
  const refsPosees = useMemo(
    () => [...new Set(lignes.map((l) => l.code_reference).filter(Boolean))],
    [lignes],
  )
  const qLots = useQueries({
    queries: refsPosees.map((ref) => ({
      queryKey: ['lots-reference-magasin', ref, entete.code_magasin_source],
      queryFn: () =>
        api.get<LotMagasin[]>(
          `/api/stock/lots?code_reference=${encodeURIComponent(ref)}&code_magasin=${encodeURIComponent(entete.code_magasin_source)}&limite=200`,
        ),
      enabled: !!entete.code_magasin_source,
    })),
  })
  const lotsParRef = new Map<string, LotMagasin[]>()
  refsPosees.forEach((ref, i) => lotsParRef.set(ref, qLots[i]?.data ?? []))
  const lotDe = (ref: string, lot: string) =>
    lot ? lotsParRef.get(ref)?.find((x) => x.lot_fournisseur === lot) : undefined

  const remplies = lignes.filter(estRemplie)
  const kgDeLigne = (l: LigneSaisie) => Number(l.qte) || 0

  /** Ce que le document demande d'une reference, toutes lignes confondues. */
  const demandeRef = (ref: string) =>
    remplies.filter((l) => l.code_reference === ref).reduce((s, l) => s + kgDeLigne(l), 0)
  /** Ce que le document demande d'un lot precis. */
  const demandeLot = (ref: string, lot: string) =>
    remplies
      .filter((l) => l.code_reference === ref && (l.extra?.lot ?? '').trim() === lot)
      .reduce((s, l) => s + kgDeLigne(l), 0)

  /** La ligne demande-t-elle plus que la source n'a — de la reference, ou du lot choisi ? */
  const depasse = (l: LigneSaisie) => {
    if (!l.code_reference) return false
    if (demandeRef(l.code_reference) > dispoDe(l.code_reference) + 0.001) return true
    const lot = (l.extra?.lot ?? '').trim()
    const s = lotDe(l.code_reference, lot)
    return !!s && demandeLot(l.code_reference, lot) > s.quantite_kg + 0.001
  }

  const manqueLot = (l: LigneSaisie) =>
    !!l.code_reference && estSuiviLot(parRef.get(l.code_reference)) && !(l.extra?.lot ?? '').trim()

  /*
   * LES COLONNES QUE LE TRANSFERT AJOUTE A LA GRILLE : le lot qui part, et ce
   * que la source en detient.
   */
  const colonnesTransfert: ColonneGrille[] = [
    {
      cle: 'lot',
      entete: 'Lot',
      largeur: 'w-52',
      rendu: (l, poser) =>
        !l.code_reference ? (
          <span className="block pt-2 text-[11px] text-attenue-texte">—</span>
        ) : (
          /* LE LOT SUIT LA MATIERE : on choisit parmi ceux du magasin SOURCE,
             le plus ancien d'abord. Obligatoire si la reference se suit par lot. */
          <ChampLot
            reference={l.code_reference}
            magasin={entete.code_magasin_source}
            valeur={l.extra?.lot ?? ''}
            onChange={poser}
            className="h-9 w-full rounded-[var(--radius-sm)] border border-bordure bg-fond px-1.5 text-[12.5px]"
            invalide={manqueLot(l)}
          />
        ),
    },
    {
      cle: 'dispo',
      entete: 'Dispo',
      largeur: 'w-32',
      alignement: 'right',
      rendu: (l) => {
        if (!l.code_reference) return <span className="text-attenue-texte">—</span>
        const lot = (l.extra?.lot ?? '').trim()
        const s = lotDe(l.code_reference, lot)
        const dispo = s ? s.quantite_kg : dispoDe(l.code_reference)
        const demande = s ? demandeLot(l.code_reference, lot) : demandeRef(l.code_reference)
        const trop = demande > dispo + 0.001
        return (
          <div
            className="pt-1.5 text-[12px] tabular-nums"
            title={`Demandé sur le document : ${fmt.nombre(demande, 2)} kg`}
          >
            <div className={cn('font-medium', trop && 'text-danger')}>
              {fmt.nombre(dispo, 0)} kg
            </div>
            <div className={cn('text-[11px]', trop ? 'text-danger' : 'text-attenue-texte')}>
              {trop
                ? 'dépassé'
                : s
                  ? `lot ${libelleLot(lot)}${s.nb_bobines != null ? ` · ${fmt.nombre(s.nb_bobines, 0)} bob.` : ''}`
                  : lot
                    ? 'lot absent de la source'
                    : 'toute la référence'}
            </div>
          </div>
        )
      },
    },
  ]

  const totalKg = remplies.reduce((s, l) => s + kgDeLigne(l), 0)
  const totalBobines = remplies.reduce((s, l) => s + (Number(l.bobines) || 0), 0)
  const totalPalettes = remplies.reduce((s, l) => s + (Number(l.palettes) || 0), 0)

  /* CE QUI BLOQUE L'ENREGISTREMENT — dit en clair dans la barre du bas. */
  const horsStock = remplies.filter((l) => l.nature !== 'MARCHANDISE')
  const nonValidees = remplies.filter((l) => !l.valide)
  const sansLot = remplies.filter(manqueLot)
  const auDela = remplies.filter(depasse)
  const memeMagasin =
    !!entete.code_magasin_source && entete.code_magasin_source === entete.code_magasin_dest

  const pret =
    modifiable &&
    !!entete.code_magasin_source &&
    !!entete.code_magasin_dest &&
    !memeMagasin &&
    remplies.length > 0 &&
    !horsStock.length &&
    !nonValidees.length &&
    !sansLot.length &&
    !auDela.length

  const charge = () => ({
    code_magasin_source: entete.code_magasin_source,
    code_magasin_dest: entete.code_magasin_dest,
    date_transfert: entete.date_transfert || undefined,
    responsable: entete.responsable || undefined,
    transporteur: entete.transporteur || undefined,
    observations: entete.observations || undefined,
    lignes: remplies.map(corpsTransfert),
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['transferts'] })
    if (id) void qc.invalidateQueries({ queryKey: ['dossier-transfert', id] })
  }

  const echec = (e: unknown) =>
    setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.')

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_transfert: string; numero_transfert: string; lignes: number }>(
        '/api/transferts',
        charge(),
      ),
    onSuccess: (r) => {
      toast.success(`${r.numero_transfert} cree`, {
        description:
          `${r.lignes} ligne(s). Rien n'a encore bouge : la marchandise quittera le magasin ` +
          `source a l'expedition.`,
        duration: 8000,
      })
      rafraichir()
      naviguer('/transferts')
    },
    onError: echec,
  })

  // LA MODIFICATION REMPLACE TOUTES LES LIGNES : le serveur recoit le document
  // entier, il n'y a rien a reconcilier ligne par ligne.
  const enregistrer = useMutation({
    mutationFn: () => api.put<{ lignes: number }>(`/api/transferts/${id}`, charge()),
    onSuccess: (r) => {
      toast.success(`${qDossier.data?.entete.numero_transfert} mis a jour`, {
        description: `${r.lignes} ligne(s). Le document reste en preparation.`,
        duration: 6000,
      })
      rafraichir()
      naviguer('/transferts')
    },
    onError: echec,
  })

  const abandonner = useMutation({
    mutationFn: () => api.delete(`/api/transferts/${id}`),
    onSuccess: () => {
      toast.success('Transfert abandonne', {
        description:
          `Le document garde son numero, marque « annule » : un trou dans la ` +
          `numerotation ne se comprend plus des semaines apres.`,
        duration: 8000,
      })
      rafraichir()
      naviguer('/transferts')
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Abandon impossible.'),
  })

  if (reprise && qDossier.isLoading) return <Chargement texte="Lecture du transfert…" />
  if (reprise && !qDossier.data?.entete) {
    return (
      <div>
        <EnTetePage titre="Transfert" description="Introuvable." />
        <Alerte ton="alerte">
          Ce transfert n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/transferts')}>
            Revenir a la liste
          </button>
        </Alerte>
      </div>
    )
  }

  const enCours = creer.isPending || enregistrer.isPending
  const codes = (ls: LigneSaisie[]) =>
    [...new Set(ls.map((l) => l.code_reference || l.intitule))].join(', ')

  return (
    <div>
      <EnTetePage
        titre={reprise ? `Transfert ${qDossier.data?.entete.numero_transfert}` : 'Nouveau transfert'}
        description={
          parti
            ? "Ce transfert est parti : son contenu ne se modifie plus."
            : "En-tete et lignes saisis ensemble. Le document ne bouge aucun stock : c'est l'expedition qui sort la marchandise."
        }
        actions={
          <>
            {reprise && modifiable && (
              <Bouton
                variante="contour"
                className="text-danger"
                onClick={() =>
                  confirmation.demander({
                    titre: 'Abandonner ce transfert ?',
                    description:
                      "Le document restera visible, marque « annule ». Aucun stock n'a bouge, " +
                      "rien n'est donc a rattraper.",
                    libelleConfirmer: 'Abandonner',
                    destructif: true,
                    action: () => abandonner.mutate(),
                  })
                }
              >
                <XCircle />
                Abandonner
              </Bouton>
            )}
            <Bouton variante="contour" onClick={() => naviguer('/transferts')}>
              <ArrowLeft />
              Retour
            </Bouton>
          </>
        }
      />

      {parti && (
        <Alerte ton="info" titre="Document fige" className="mb-3">
          La marchandise a quitte le magasin source : ses mouvements sont inscrits au grand livre,
          que R03 rend immuable. Un ecart constate a l'arrivee se regularise par un inventaire, pas
          en retouchant le bon.
        </Alerte>
      )}

      {erreur && (
        <Alerte ton="danger" titre="Enregistrement refusé" className="mb-3">
          {erreur}
        </Alerte>
      )}

      {/* FIGE, LE DOCUMENT SE LIT SANS SE TOUCHER. Le fieldset desactive aussi
          les champs de la grille, que sa propriete `modifiable` laisse ouverts. */}
      <fieldset disabled={!modifiable} className="contents">
        <div className="space-y-3">
          <Carte repliable="transfertnouveau.1">
            <CarteEntete>
              <CarteTitre>En-tete</CarteTitre>
            </CarteEntete>
            <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Etiq htmlFor="src" obligatoire>
                  Magasin source
                </Etiq>
                <Selecteur
                  id="src"
                  value={entete.code_magasin_source}
                  onChange={(e) => {
                    // Changer de magasin source invalide ce qui a ete charge :
                    // ces references ne sont pas forcement en stock ailleurs.
                    setEntete({ ...entete, code_magasin_source: e.target.value })
                    setLignes([])
                  }}
                >
                  <option value="">Choisir…</option>
                  {qMag.data?.map((m) => (
                    <option key={m.code_magasin} value={m.code_magasin}>
                      {m.nom}
                    </option>
                  ))}
                </Selecteur>
              </div>
              <div>
                <Etiq htmlFor="dst" obligatoire>
                  Magasin destinataire
                </Etiq>
                <Selecteur
                  id="dst"
                  value={entete.code_magasin_dest}
                  onChange={(e) => setEntete({ ...entete, code_magasin_dest: e.target.value })}
                  className={cn(memeMagasin && 'border-danger')}
                >
                  <option value="">Choisir…</option>
                  {qMag.data?.map((m) => (
                    <option key={m.code_magasin} value={m.code_magasin}>
                      {m.nom}
                    </option>
                  ))}
                </Selecteur>
                {memeMagasin && (
                  <p className="mt-1 text-[11px] text-danger">
                    Source et destination doivent differer.
                  </p>
                )}
              </div>
              <div>
                <Etiq htmlFor="dt">Date du document</Etiq>
                <Champ
                  id="dt"
                  type="date"
                  value={entete.date_transfert}
                  onChange={(e) => setEntete({ ...entete, date_transfert: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-attenue-texte">
                  La date de sortie sera celle de l'expedition, la date d'arrivee celle de la
                  reception.
                </p>
              </div>
              <div>
                <Etiq htmlFor="resp">Responsable</Etiq>
                <Champ
                  id="resp"
                  value={entete.responsable}
                  onChange={(e) => setEntete({ ...entete, responsable: e.target.value })}
                  placeholder="Qui repond de la marchandise en route"
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
                <Etiq htmlFor="obs">Observations</Etiq>
                <Champ
                  id="obs"
                  value={entete.observations}
                  onChange={(e) => setEntete({ ...entete, observations: e.target.value })}
                />
              </div>
            </CarteCorps>
          </Carte>

          {!entete.code_magasin_source ? (
            <Alerte ton="info">
              Choisissez le magasin source : seules ses references en stock pourront etre chargees.
            </Alerte>
          ) : (
            <Carte repliable="transfertnouveau.2">
              <CarteEntete>
                <CarteTitre>
                  Lignes{remplies.length > 0 && ` (${remplies.length})`}
                  {entete.code_magasin_dest && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[12px] font-normal text-attenue-texte">
                      {entete.code_magasin_source}
                      <ArrowRight className="size-3" />
                      {entete.code_magasin_dest}
                    </span>
                  )}
                </CarteTitre>
                <span className="text-[11px] text-attenue-texte">
                  {qStock.isLoading
                    ? 'Lecture du stock de la source…'
                    : `${disponibles.length} référence(s) en stock à la source`}
                </span>
              </CarteEntete>
              <CarteCorps className="space-y-3">
                {/* LA MEME GRILLE QUE LE BON DE COMMANDE. La reference se
                    choisit dans la ligne, parmi le stock de la source ; le prix
                    et les champs fournisseur n'ont rien a faire entre deux
                    magasins a nous. Une meme reference peut revenir sur
                    plusieurs lignes : un lot par ligne. */}
                <GrilleLignes
                  codeFournisseur={`stock:${entete.code_magasin_source}`}
                  devise="MAD"
                  lignes={lignes}
                  setLignes={setLignes}
                  mode="CATALOGUE"
                  setMode={() => {}}
                  proposees={proposees}
                  chercherCatalogue={chercherStock}
                  modifiable={modifiable}
                  sansSource
                  sansPrix
                  sansFournisseur
                  validationLocale
                  doublonsReference
                  unitesAutorisees={UNITES_TRANSFERT}
                  libelles={{
                    reference: 'Référence',
                    unite: 'Unité',
                    recherche: 'Référence — stock du magasin source…',
                    aide: 'La liste ne propose que ce que le magasin source a en stock.',
                  }}
                  poidsBobine={tolerances}
                  colonnesSupplementaires={colonnesTransfert}
                />
                {remplies.length > 0 && (
                  <dl className="grid grid-cols-3 gap-x-6 border-t border-bordure pt-2 text-[13px] sm:max-w-md">
                    {(
                      [
                        ['Poids chargé', `${fmt.nombre(totalKg, 2)} kg`],
                        ['Palettes', fmt.nombre(totalPalettes, 2)],
                        ['Bobines', fmt.nombre(totalBobines, 0)],
                      ] as const
                    ).map(([libelle, valeur]) => (
                      <div key={libelle}>
                        <dt className="text-[11px] uppercase tracking-wider text-attenue-texte">
                          {libelle}
                        </dt>
                        <dd className="font-medium tabular-nums">{valeur}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CarteCorps>
            </Carte>
          )}
        </div>
      </fieldset>

      {entete.code_magasin_source && modifiable && (
        <div
          className={cn(
            'sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            pret ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="text-[13px]">
            {remplies.length === 0 ? (
              <span className="text-attenue-texte">
                Aucune ligne chargee. Ajoutez une ligne et tapez une référence du stock.
              </span>
            ) : (
              <>
                <span className="font-medium">{remplies.length} ligne(s)</span>
                <span className="text-attenue-texte"> · </span>
                <span className="font-semibold tabular-nums">{fmt.nombre(totalKg, 1)} kg</span>
                {nonValidees.length > 0 && (
                  <span className="text-alerte">
                    {' '}
                    — {nonValidees.length} ligne(s) à valider avec le bouton ✓ de la ligne
                  </span>
                )}
                {sansLot.length > 0 && (
                  <span className="text-danger"> — lot obligatoire : {codes(sansLot)}</span>
                )}
                {auDela.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    — au-dela du stock disponible : {codes(auDela)}
                  </span>
                )}
                {horsStock.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    — sans référence, ne se transfère pas : {codes(horsStock)}
                  </span>
                )}
              </>
            )}
          </span>
          <Bouton
            onClick={() => {
              setErreur(null)
              if (reprise) enregistrer.mutate()
              else creer.mutate()
            }}
            chargement={enCours}
            disabled={!pret}
            title={
              nonValidees.length > 0
                ? 'Validez d’abord chaque ligne avec son bouton ✓'
                : sansLot.length > 0
                  ? 'Choisissez le lot des références suivies par lot'
                  : undefined
            }
          >
            <Save />
            Enregistrer le transfert
          </Bouton>
        </div>
      )}

      {confirmation.element}
    </div>
  )
}

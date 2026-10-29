/**
 * L'ecran d'une facture du dossier — ajout et modification.
 *
 * De haut en bas : l'en-tete de la facture, ses lignes (chacune dit de quel bon
 * de commande elle vient, s'il y en a un) avec la part de frais qu'elle porte,
 * puis les totaux, compares a ce qui est imprime sur la facture.
 *
 * ENREGISTREMENT GLOBAL. On saisit l'en-tete et les lignes, puis on enregistre
 * le tout : une faute de frappe dans une cellule n'est pas deja en base au
 * moment ou l'on s'en apercoit.
 *
 * UNE LIGNE DEJA RECUE EST FIGEE : elle est entree en stock a ce prix. La
 * changer apres coup ferait diverger la facture du stock sans que rien ne le
 * dise ; on solde, on ne corrige pas. FIGEE TOUT ENTIERE A L'ECRAN (24/10/2026) :
 * lot, couleur, bobines et palettes aussi — sur une ligne liee, toucher les
 * bobines recalculait le poids net, que la base refuse (IMPORT-FIGEE).
 *
 * UNE LIGNE, UNE RANGEE (24/10/2026). Quand la largeur mesuree du tableau le
 * permet (1366 px barre laterale ouverte, et au-dela), TOUS les champs d'une
 * ligne tiennent sur sa rangee : reference, bon, lot, couleur, unite, poids,
 * bobines, palettes, prix, remise, montant et le RAPPROCHEMENT (prix contre le
 * bon, poids contre le recu) ; chaque case a la largeur de son contenu, la
 * reference prend le reste. Trop etroit seulement, la rangee complementaire ↳
 * (lot, couleur, unite, colis, remise, cout) revient ; elle ne s'ouvre
 * d'elle-meme que pour une ligne en saisie ou incomplete.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Link2,
  Lock,
  Plus,
  Save,
  Trash2,
  Unlink2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
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
  Selecteur,
} from '../../composants/ui/base'
import { useConfirmation } from '../../composants/ui/surcouches'
import { useOuvrirVue } from '../../lib/navigation'
import { ChampReference } from '../../composants/ChampReference'
import { cn, fmt } from '../../lib/utils'
import {
  type Conditionnement,
  controleColisage,
  depuisBobines,
  depuisKg,
  depuisPalettes,
  pourChamp,
} from '../../lib/conditionnement'
import { AvisColisage } from '../../composants/AvisColisage'
import { useTolerancesColisage } from '../../lib/lots'
import { useGardeSaisie } from '../../hooks/useGardeSaisie'
import { echec, nombre, useRafraichir } from './dialogues'
import { UNITE, type DossierComplet, type Ligne } from './types'

const MODULE = 'IMPORT'
const th = 'px-1.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-1.5 py-1'
const champ = 'h-7 px-1.5 text-[12.5px]'
/* SUR UNE SEULE RANGEE (24/10/2026) : des cases a la largeur de leur contenu. */
const th1 = 'px-1 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td1 = 'px-1 py-1'
const champ1 = 'h-7 px-1 text-[12px]'
/**
 * La largeur de chaque colonne, en pixels, rembourrage compris : poids et prix
 * ~8 caracteres, bobines et palettes ~5, lot ~12, codes couleur courts, le bon
 * par son numero. La reference prend le reste, jamais moins de REF_MIN.
 */
const COL = {
  num: 24, bc: 124, lot: 104, codeCouleur: 48, couleur: 84, unite: 50, poids: 70,
  bobines: 50, palettes: 42, prix: 64, remise: 44, montant: 80, controle: 76, actions: 54,
}
const REF_MIN = 150
const SEUIL_UNE_RANGEE = Object.values(COL).reduce((t, x) => t + x, 0) + REF_MIN

/**
 * La largeur d'un element, suivie a chaque redimensionnement (fenetre, barre
 * laterale). Par une ref-fonction : le tableau n'existe qu'une fois la facture
 * lue, apres le premier rendu.
 */
function useLargeur() {
  const [largeur, setLargeur] = useState(0)
  const observateur = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    observateur.current?.disconnect()
    observateur.current = null
    if (!el) return
    setLargeur(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(() => setLargeur(el.clientWidth))
    o.observe(el)
    observateur.current = o
  }, [])
  return [ref, largeur] as const
}

interface RefCatalogue {
  code_reference: string
  designation: string
  code_fournisseur: string
  code_couleur?: string | null
  couleur?: string | null
  /** Le conditionnement : ce qui relie le poids net aux bobines et palettes. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  densite_kg_ml?: number | null
}

interface LigneBcOuverte {
  id_ligne_bc: string
  numero_bc: string
  ligne_numero: number
  code_reference: string
  quantite_restante_kg: number
  prix_kg_devise: number
  /** La devise du bon : le prix ne se compare qu'a devise egale. */
  code_devise?: string
}

/**
 * Une ligne telle que le serveur la rend, avec le prix et la devise de sa
 * ligne de bon, meme soldee (24/10/2026). Le prix est masque selon les droits.
 */
type LigneServeur = Ligne & { prix_kg_devise?: number | null; devise_bc?: string | null }

/** Une ligne telle qu'on la saisit : des chaines, comme les champs. */
interface LigneEdit {
  cle: string
  id_ligne?: string
  type_ligne: 'ERP' | 'HORS_ERP'
  code_reference: string
  libelle: string
  id_ligne_bc: string
  numero_bc: string
  lot_fournisseur: string
  code_couleur: string
  libelle_couleur: string
  unite: 'kg' | 'ml' | 'piece'
  poids_net_kg: string
  quantite: string
  nb_bobines: string
  nb_palettes: string
  /**
   * LE CALCUL EST-IL LIE SUR CETTE LIGNE ?
   *
   * Lie, poids net, bobines et palettes se repondent par les parametres de la
   * reference. Detache, chacun se saisit seul — parce que c'est la FACTURE du
   * fournisseur qu'on recopie : si elle annonce 3 palettes pour un poids qui
   * n'en fait que 2,7, c'est elle qui fait foi, et l'ecart se discute.
   */
  lie: boolean
  prix_unitaire_devise: string
  /** La remise du fournisseur, en % du prix brut. Le prix reste brut. */
  remise: string
  supprimee: boolean
  recue: boolean
}

const texte = (v: unknown) => (v == null ? '' : String(v))

function versEdition(l: Ligne): LigneEdit {
  return {
    cle: l.id_ligne,
    id_ligne: l.id_ligne,
    type_ligne: l.type_ligne,
    code_reference: texte(l.code_reference),
    libelle: l.type_ligne === 'HORS_ERP' ? texte(l.designation) : '',
    id_ligne_bc: texte(l.id_ligne_bc),
    numero_bc: texte(l.numero_bc),
    lot_fournisseur: texte(l.lot_fournisseur),
    code_couleur: texte(l.code_couleur),
    libelle_couleur: texte(l.libelle_couleur),
    unite: l.unite,
    poids_net_kg: texte(l.poids_net_kg),
    quantite: texte(l.quantite),
    nb_bobines: texte(l.nb_bobines),
    nb_palettes: texte(l.nb_palettes),
    // Une ligne deja enregistree garde ses comptes tels quels : les relier les
    // recalculerait en silence, alors qu'ils viennent de la facture.
    lie: l.nb_bobines == null && l.nb_palettes == null,
    prix_unitaire_devise: texte(l.prix_unitaire_devise),
    remise: l.remise_pct ? String(Number(l.remise_pct)) : '',
    supprimee: false,
    recue: l.quantite_recue_kg > 0,
  }
}

let compteur = 0
function ligneVide(type: 'ERP' | 'HORS_ERP' = 'ERP'): LigneEdit {
  compteur += 1
  return {
    cle: `n-${compteur}`, type_ligne: type, code_reference: '', libelle: '', id_ligne_bc: '', numero_bc: '',
    lot_fournisseur: '', code_couleur: '', libelle_couleur: '', unite: type === 'ERP' ? 'kg' : 'piece', poids_net_kg: '', quantite: '',
    nb_bobines: '', nb_palettes: '', lie: true, prix_unitaire_devise: '', remise: '', supprimee: false, recue: false,
  }
}

/** La quantite qui multiplie le prix : le poids net quand on facture au kg. */
const quantiteFacturee = (l: LigneEdit) =>
  l.type_ligne === 'ERP' && l.unite === 'kg' ? nombre(l.poids_net_kg) : nombre(l.quantite)
/** Le montant BRUT, avant remise. */
const brutLigne = (l: LigneEdit) => Math.round(quantiteFacturee(l) * nombre(l.prix_unitaire_devise) * 100) / 100
/**
 * Le montant NET, celui que la base calcule et qui valorise le stock. Meme
 * formule qu'elle — quantite x prix x (1 - remise), arrondie au centime — pour
 * que l'ecran et le cout de revient ne different jamais d'un centime.
 */
const montantLigne = (l: LigneEdit) =>
  Math.round(quantiteFacturee(l) * nombre(l.prix_unitaire_devise) * (1 - nombre(l.remise) / 100) * 100) / 100
const ligneComplete = (l: LigneEdit) =>
  l.type_ligne === 'ERP'
    ? !!l.code_reference && nombre(l.poids_net_kg) > 0 && nombre(l.prix_unitaire_devise) > 0 &&
      (l.unite === 'kg' || nombre(l.quantite) > 0)
    : !!l.libelle.trim() && nombre(l.quantite) > 0 && nombre(l.prix_unitaire_devise) > 0

function corpsLigne(l: LigneEdit) {
  const erp = l.type_ligne === 'ERP'
  return {
    type_ligne: l.type_ligne,
    code_reference: erp ? l.code_reference : null,
    libelle: erp ? null : l.libelle.trim(),
    id_ligne_bc: erp ? l.id_ligne_bc : null,
    lot_fournisseur: l.lot_fournisseur,
    code_couleur: l.code_couleur,
    libelle_couleur: l.libelle_couleur,
    unite: erp ? l.unite : 'piece',
    quantite: erp && l.unite === 'kg' ? null : nombre(l.quantite),
    poids_net_kg: erp ? nombre(l.poids_net_kg) : null,
    nb_bobines: l.nb_bobines ? nombre(l.nb_bobines) : 0,
    nb_palettes: l.nb_palettes ? nombre(l.nb_palettes) : 0,
    prix_unitaire_devise: nombre(l.prix_unitaire_devise),
    remise_pct: nombre(l.remise),
  }
}

export function FactureImport() {
  const { id: idDossier = '', idFacture = 'nouvelle' } = useParams()
  const nouvelle = idFacture === 'nouvelle'
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const rafraichir = useRafraichir(idDossier)
  const confirmation = useConfirmation()

  const q = useQuery({
    queryKey: ['import-dossier', idDossier],
    queryFn: ({ signal }) => api.get<DossierComplet>(`/api/import/dossiers/${idDossier}`, { signal }),
    enabled: !!idDossier,
  })
  const d = q.data
  const facture = nouvelle ? null : d?.factures.find((f) => f.id_facture === idFacture) ?? null
  const lignesServeur = useMemo(
    () => (d?.lignes ?? []).filter((l) => l.id_facture === idFacture).sort((a, b) => a.ligne_numero - b.ligne_numero),
    [d, idFacture],
  )

  // ---- L'etat de saisie, recharge a chaque version du serveur -------------
  const enteteInitial = () => ({
    code_fournisseur: facture?.code_fournisseur ?? '',
    numero_facture: facture?.numero_facture ?? '',
    date_facture: facture?.date_facture?.slice(0, 10) ?? '',
    // EN GROUPAGE, LA DEVISE EST CELLE DE LA FACTURE : celle de la fiche
    // fournisseur par defaut, posee au choix du fournisseur (01/10/2026).
    code_devise: facture?.code_devise ?? '',
    taux_change: texte(facture?.taux_change ?? ''),
    montant_devise: texte(facture?.montant_devise),
    nb_palettes: texte(facture?.nb_palettes),
    nb_bobines: texte(facture?.nb_bobines),
    id_engagement: facture?.id_engagement ?? '',
  })
  const [entete, setEntete] = useState(enteteInitial)
  const [lignes, setLignes] = useState<LigneEdit[]>([])
  const [toutes, setToutes] = useState(false)
  const [ouverte, setOuverte] = useState<string | null>(null)
  /** La rangee ↳ ouverte ou fermee a la main ; sans choix, elle suit la ligne. */
  const [deplies, setDeplies] = useState<Record<string, boolean>>({})
  const tolerances = useTolerancesColisage()
  // UNE LIGNE, UNE RANGEE quand la largeur mesuree du tableau le permet.
  const [refTableau, largeurTableau] = useLargeur()
  const uneRangee = largeurTableau >= SEUIL_UNE_RANGEE
  useEffect(() => {
    if (!d) return
    setEntete(enteteInitial())
    const l = lignesServeur.map(versEdition)
    setLignes(nouvelle ? [ligneVide()] : l.length ? l : [ligneVide()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, idFacture])

  const clos = d?.dossier.statut === 'CLOTURE'
  const ecrire = droits.peutEcrire && !clos

  const qFournisseurs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: ({ signal }) => api.get<{ code_fournisseur: string; nom: string; code_devise?: string }[]>('/api/fournisseurs?actif=1&limite=500', { signal }),
  })
  const qDevises = useQuery({ queryKey: ['devises'], queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }) })
  const qBc = useQuery({
    queryKey: ['import-lignes-bc', entete.code_fournisseur],
    queryFn: ({ signal }) => api.get<LigneBcOuverte[]>(`/api/import/lignes-bc?fournisseur=${encodeURIComponent(entete.code_fournisseur)}`, { signal }),
    enabled: !!entete.code_fournisseur,
  })

  /**
   * LE TAUX DE REFERENCE du jour de la facture (05/10/2026) : cours Bank
   * Al-Maghrib, a defaut le taux de l'ERP. Il preremplit le champ quand il est
   * vide, et repere le taux qui s'en eloigne trop. Une facture en devise passee
   * au taux 1 entrait en stock au cours du dirham, sans un mot.
   */
  const enDevise = !!entete.code_devise && entete.code_devise !== 'MAD'
  const qTaux = useQuery({
    queryKey: ['taux-reference', entete.code_devise, entete.date_facture],
    queryFn: () =>
      api.get<{ reference: number | null; source: string | null; ecart_max_pct: number }>(
        `/api/import/taux-reference?devise=${encodeURIComponent(entete.code_devise)}&date=${entete.date_facture}`,
      ),
    enabled: enDevise && !!entete.date_facture,
  })
  const reference = enDevise ? (qTaux.data?.reference ?? null) : null
  useEffect(() => {
    if (enDevise && reference && entete.taux_change === '')
      setEntete((x) => ({ ...x, taux_change: String(reference) }))
  }, [enDevise, reference, entete.taux_change])
  const tauxSaisi = nombre(entete.taux_change)
  const tauxDirham = enDevise && Math.abs(tauxSaisi - 1) < 1e-9
  const ecartTaux = reference && tauxSaisi > 0 ? tauxSaisi / reference - 1 : 0
  const tauxEloigne = Math.abs(ecartTaux) * 100 > (qTaux.data?.ecart_max_pct ?? 3)
  // La confirmation vaut pour CE taux : le changer la retire.
  const [tauxConfirme, setTauxConfirme] = useState<string | null>(null)
  const tauxConfirmeOk = tauxEloigne && tauxConfirme === entete.taux_change

  /**
   * LES REFERENCES RETENUES SUR CETTE FACTURE, et elles seules.
   *
   * L'ecran chargeait le catalogue entier pour peupler un menu deroulant par
   * ligne — tenable a 124 references, intenable a mille. On tape desormais, le
   * serveur cherche, et l'on garde ce qu'on retient : c'est tout ce dont la
   * ligne a besoin pour connaitre sa couleur et son conditionnement.
   */
  const [refsRetenues, setRefsRetenues] = useState<Map<string, RefCatalogue>>(new Map())

  // ---- Modifications -------------------------------------------------------
  const majLigne = (cle: string, patch: Partial<LigneEdit>) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))

  /** Le conditionnement de la reference d'une ligne — vide si elle n'en porte pas. */
  const condDe = (code: string): Conditionnement => refsRetenues.get(code) ?? {}

  /**
   * POIDS NET, BOBINES ET PALETTES SE REPONDENT.
   *
   * Une facture d'import annonce souvent les trois, et ils doivent concorder :
   * c'est sur ce poids que se repartissent les frais d'approche, donc le cout
   * de revient. Saisir celui qu'on lit sur le document, voir les deux autres se
   * poser, et comparer avec ce que le document annonce — c'est la que se
   * reperent les erreurs de recopie.
   */
  const majColis = (l: LigneEdit, source: 'poids' | 'palettes' | 'bobines', valeur: string) => {
    // Une ligne recue ne bouge plus, pas meme par le calcul lie.
    if (l.recue) return
    const champ =
      source === 'poids' ? 'poids_net_kg' : source === 'palettes' ? 'nb_palettes' : 'nb_bobines'
    if (!l.lie) return majLigne(l.cle, { [champ]: valeur })
    const c = condDe(l.code_reference)
    const r =
      source === 'palettes'
        ? depuisPalettes(valeur, c)
        : source === 'bobines'
          ? depuisBobines(valeur, c)
          : depuisKg(valeur, c)
    majLigne(l.cle, {
      poids_net_kg: source === 'poids' ? valeur : r.kg !== null ? pourChamp(r.kg, 3) : l.poids_net_kg,
      nb_palettes: source === 'palettes' ? valeur : pourChamp(r.palettes),
      nb_bobines: source === 'bobines' ? valeur : pourChamp(r.bobines),
    })
  }
  const choisirReference = (l: LigneEdit, r: RefCatalogue) => {
    setRefsRetenues((m) => new Map(m).set(r.code_reference, r))
    majLigne(l.cle, {
      code_reference: r.code_reference, id_ligne_bc: '', numero_bc: '',
      code_couleur: r.code_couleur ?? l.code_couleur,
      libelle_couleur: r.couleur ?? l.libelle_couleur,
    })
  }
  // Choisir la ligne de BC reprend sa reference et son prix : c'est ce qui a
  // ete commande, la facture ne fait que le confirmer.
  const choisirBc = (l: LigneEdit, idBc: string) => {
    const b = qBc.data?.find((x) => x.id_ligne_bc === idBc)
    majLigne(l.cle, {
      id_ligne_bc: idBc,
      numero_bc: b?.numero_bc ?? '',
      code_reference: b ? b.code_reference : l.code_reference,
      prix_unitaire_devise: b && !l.prix_unitaire_devise ? String(b.prix_kg_devise) : l.prix_unitaire_devise,
    })
  }

  const enteteModifie = JSON.stringify(entete) !== JSON.stringify(enteteInitial())
  const lignesModifiees = lignes.filter((l) => {
    if (l.supprimee) return !!l.id_ligne
    if (!l.id_ligne) return ligneComplete(l)
    const o = lignesServeur.find((x) => x.id_ligne === l.id_ligne)
    return !!o && JSON.stringify(corpsLigne(versEdition(o))) !== JSON.stringify(corpsLigne(l))
  })
  const incompletes = lignes.filter((l) => !l.supprimee && !ligneComplete(l) && (l.id_ligne || l.code_reference || l.libelle || l.prix_unitaire_devise))
  const modifie = nouvelle || enteteModifie || lignesModifiees.length > 0
  const enteteComplet = entete.code_fournisseur && entete.numero_facture.trim() && entete.date_facture && entete.code_devise && nombre(entete.taux_change) > 0
    && !tauxDirham && (!tauxEloigne || tauxConfirmeOk)
  /* CE QUI EMPECHE D'ENREGISTRER, ECRIT EN CLAIR dans la barre du bas : un
     bouton grise sans raison laisse chercher. */
  const raisonBlocage = !modifie
    ? 'Rien à enregistrer.'
    : !entete.code_fournisseur
      ? 'Choisissez le fournisseur.'
      : !entete.numero_facture.trim()
        ? 'Saisissez le n° de facture.'
        : !entete.date_facture
          ? 'Saisissez la date de la facture.'
          : !entete.code_devise
            ? 'Choisissez la devise.'
            : !(nombre(entete.taux_change) > 0)
              ? 'Saisissez le taux de change.'
              : tauxDirham
                ? `Taux 1 refusé : c’est le taux du dirham, pas celui du ${entete.code_devise}.`
                : tauxEloigne && !tauxConfirmeOk
                  ? 'Taux éloigné de la référence : confirmez-le dans l’en-tête.'
                  : !enteteComplet
                    ? 'En-tête incomplet.'
                  : incompletes.length > 0
                    ? `${incompletes.length} ligne(s) incomplète(s) : référence, poids et prix.`
                    : null
  // LA GARDE DE SAISIE : une facture commencee ne se perd pas d'un clic.
  const touche = enteteModifie || lignesModifiees.length > 0 || incompletes.length > 0
  const quitter = useGardeSaisie(ecrire && touche)

  /** L'identifiant d'une facture creee pendant l'enregistrement en cours. */
  const creeeRef = useRef<string | null>(null)
  const enregistrer = useMutation({
    mutationFn: async () => {
      creeeRef.current = null
      const corpsEntete = {
        code_fournisseur: entete.code_fournisseur,
        numero_facture: entete.numero_facture.trim(),
        date_facture: entete.date_facture,
        code_devise: entete.code_devise,
        taux_change: nombre(entete.taux_change),
        montant_devise: entete.montant_devise ? nombre(entete.montant_devise) : null,
        nb_palettes: entete.nb_palettes ? nombre(entete.nb_palettes) : null,
        nb_bobines: entete.nb_bobines ? nombre(entete.nb_bobines) : null,
        id_engagement: entete.id_engagement,
        taux_confirme: tauxConfirmeOk,
      }
      let id = idFacture
      // LE VERROU OPTIMISTE (20/10/2026). La facture et ses lignes passent par
      // la version de la FACTURE, lue avec ce que l'ecran affiche (le formulaire
      // se recharge avec elle) ; chaque reponse rend celle que l'enregistrement
      // suivant presente. Une facture nouvelle se cree sous la version du DOSSIER.
      type AvecVersion = { version?: number }
      let v = facture?.version
      const suivre = (r: AvecVersion) => {
        v = r.version ?? v
      }
      if (nouvelle) {
        const r = await api.post<{ id_facture: string; version?: number }>(`/api/import/dossiers/${idDossier}/factures`, {
          ...corpsEntete,
          version: d?.dossier.version,
        })
        id = r.id_facture
        v = r.version
        creeeRef.current = id
      } else if (enteteModifie) {
        suivre(await api.patch<AvecVersion>(`/api/import/factures/${id}`, { ...corpsEntete, version: v }))
      }
      // Les suppressions d'abord : une ligne retiree ne doit pas bloquer le
      // controle des totaux des suivantes.
      for (const l of lignesModifiees.filter((x) => x.supprimee))
        suivre(await api.delete<AvecVersion>(`/api/import/lignes/${l.id_ligne}?version=${v ?? ''}`))
      for (const l of lignesModifiees.filter((x) => !x.supprimee)) {
        if (l.id_ligne) suivre(await api.patch<AvecVersion>(`/api/import/lignes/${l.id_ligne}`, { ...corpsLigne(l), version: v }))
        else suivre(await api.post<AvecVersion>(`/api/import/factures/${id}/lignes`, { ...corpsLigne(l), version: v }))
      }
      return id
    },
    onSuccess: (id) => {
      toast.success('Facture enregistrée — frais répartis')
      rafraichir()
      void qc.invalidateQueries({ queryKey: ['import-lignes-bc'] })
      if (nouvelle) naviguer(`/import/${idDossier}/factures/${id}`, { replace: true })
    },
    onError: (e) => {
      echec(e)
      rafraichir()
      // L'EN-TETE EST DEJA CREE si c'est une ligne qui a echoue. Rester sur
      // « nouvelle » ferait recreer la facture au prochain clic — et buter sur
      // son propre numero. On passe sur la facture creee, ou l'on corrige.
      if (nouvelle && creeeRef.current) naviguer(`/import/${idDossier}/factures/${creeeRef.current}`, { replace: true })
    },
  })

  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/import/factures/${idFacture}?version=${facture?.version ?? ''}`),
    onSuccess: () => {
      toast.success('Facture supprimée')
      rafraichir()
      ouvrir(`/import/${idDossier}?onglet=factures`)
    },
    // Un refus (409 compris) relit la facture : ses changements s'affichent.
    onError: (e) => {
      echec(e)
      rafraichir()
    },
  })

  if (q.isLoading) return <Chargement texte="Lecture de la facture…" />
  if (!d) return <Alerte ton="alerte">Dossier introuvable.</Alerte>
  if (!nouvelle && !facture) return <Alerte ton="alerte">Facture introuvable dans ce dossier.</Alerte>

  // ---- Totaux et repartition -----------------------------------------------
  const visibles = lignes.filter((l) => !l.supprimee)
  const totalDevise = visibles.reduce((t, l) => t + montantLigne(l), 0)
  const totalBrut = visibles.reduce((t, l) => t + brutLigne(l), 0)
  const taux = nombre(entete.taux_change)
  const totalPoids = visibles.reduce((t, l) => t + (l.type_ligne === 'ERP' ? nombre(l.poids_net_kg) : 0), 0)
  const totalBobines = visibles.reduce((t, l) => t + nombre(l.nb_bobines || 0), 0)
  const totalPalettes = visibles.reduce((t, l) => t + nombre(l.nb_palettes || 0), 0)
  const serveur = (cle: string) => lignesServeur.find((x) => x.id_ligne === cle)
  const coutVisible = lignesServeur.some((l) => l.frais_alloues_dhs !== undefined)
  const totalFrais = lignesServeur.reduce((t, l) => t + (l.frais_alloues_dhs ?? 0), 0)
  const totalValeur = lignesServeur.reduce((t, l) => t + l.valeur_achat_dhs, 0)
  const fraisInclus = d.frais.filter((f) => f.inclus_dans_cout === 1)
  const partDe = (idLigne: string, idFrais: string) =>
    d.repartition.find((a) => a.id_article_dossier === idLigne && a.id_ligne_frais === idFrais)
  const ecartMontant = entete.montant_devise !== '' && Math.abs(nombre(entete.montant_devise) - totalDevise) > 0.005
  const maj = (k: keyof typeof entete) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEntete((x) => ({ ...x, [k]: e.target.value }))

  const ecartImprime = entete.montant_devise !== '' ? totalDevise - nombre(entete.montant_devise) : null
  const ecartColis = (entete.nb_palettes !== '' && nombre(entete.nb_palettes) !== totalPalettes) || (entete.nb_bobines !== '' && nombre(entete.nb_bobines) !== totalBobines)
  const totalRecu = lignesServeur.reduce((t, l) => t + l.quantite_recue_kg, 0)
  /* UNE FACTURE QUI A FAIT ENTRER DE LA MARCHANDISE garde son fournisseur, sa
     devise, son taux et son montant : la base refuse d'y toucher (IMPORT-FIGEE).
     L'ecran ne les offre donc plus. */
  const factureRecue = lignesServeur.some((l) => l.quantite_recue_kg > 0)
  const titreFige = factureRecue ? 'Facture déjà reçue : fournisseur, devise, taux et montant ne bougent plus.' : undefined
  const supprimable = ecrire && !nouvelle && !factureRecue
  const nbAjoutees = lignesModifiees.filter((l) => !l.id_ligne).length
  const nbRetirees = lignesModifiees.filter((l) => l.supprimee).length
  const nbCorrigees = lignesModifiees.length - nbAjoutees - nbRetirees

  /**
   * LE RAPPROCHEMENT DE LA LIGNE, sur sa rangee : le prix facture contre celui
   * du bon, le poids facture contre le poids recu (des qu'il y a une
   * reception). Rien ne bloque : l'ecart se lit avant d'enregistrer, comme sur
   * la facture fournisseur.
   *
   * LE PRIX DU BON VIENT DU SERVEUR (24/10/2026) : chaque ligne enregistree
   * porte celui de sa ligne de bon, meme soldee — l'ecart ne disparait plus
   * quand le bon est servi. Une ligne en saisie, ou rattachee a un autre bon
   * que celui enregistre, le lit dans les lignes de bon ouvertes.
   */
  const controleLigne = (l: LigneEdit, s?: LigneServeur) => {
    const duServeur = s && l.id_ligne_bc && s.id_ligne_bc === l.id_ligne_bc && typeof s.prix_kg_devise === 'number'
      ? { prix_kg_devise: s.prix_kg_devise, code_devise: s.devise_bc ?? undefined }
      : undefined
    const bc = duServeur ?? (l.id_ligne_bc ? qBc.data?.find((b) => b.id_ligne_bc === l.id_ligne_bc) : undefined)
    const prix = nombre(l.prix_unitaire_devise)
    const memeDevise = !bc?.code_devise || bc.code_devise === entete.code_devise
    const prixBc = bc && typeof bc.prix_kg_devise === 'number' && l.unite === 'kg' && memeDevise ? bc.prix_kg_devise : null
    const ecartPrix = prixBc && prix > 0 ? (prix / prixBc - 1) * 100 : null
    const recu = s && s.quantite_recue_kg > 0 ? s.quantite_recue_kg : null
    const ecartKg = recu != null ? nombre(l.poids_net_kg) - recu : null
    return { prixBc, ecartPrix, recu, ecartKg }
  }

  return (
    <div className="space-y-3 pb-4">
      <EnTetePage
        titre={nouvelle ? 'Nouvelle facture' : `Facture ${facture!.numero_facture}`}
        description={`Dossier ${d.dossier.numero}${facture ? ` · ${facture.fournisseur_nom}` : ''}`}
        actions={
          <Bouton variante="contour" onClick={() => quitter(() => ouvrir(`/import/${idDossier}?onglet=factures`))}>
            <ArrowLeft />
            Factures du dossier {d.dossier.numero}
          </Bouton>
        }
      />
      {clos && <Alerte ton="succes">Dossier clôturé : la facture est en lecture seule.</Alerte>}

      {/* ================= En-tete ============================================ */}
      <Carte>
        <CarteEntete>
          <CarteTitre>En-tête de la facture</CarteTitre>
          {facture && <Badge ton={facture.statut_reception === 'RECUE' ? 'succes' : facture.statut_reception === 'PARTIELLE' ? 'alerte' : 'neutre'}>
            {facture.statut_reception === 'RECUE' ? 'Reçue' : facture.statut_reception === 'PARTIELLE' ? 'Réception partielle' : 'Non reçue'}
          </Badge>}
        </CarteEntete>
        <CarteCorps>
          {/* DEUX RANGEES : le document (qui, quel numero, quand, en quoi), puis
              ce qu'il imprime (engagement, montant, colis). */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <div className="col-span-2">
              <Etiq obligatoire htmlFor="ch-factureimport-1">Fournisseur</Etiq>
              <Selecteur id="ch-factureimport-1" value={entete.code_fournisseur}
                onChange={(e) => {
                  const code = e.target.value
                  const devise = qFournisseurs.data?.find((x) => x.code_fournisseur === code)?.code_devise
                  // Changer de fournisseur change d'engagement ; la devise suit sa fiche.
                  // UNE AUTRE DEVISE, UN AUTRE TAUX : l'ancien est vide, la
                  // reference du jour vient le remplacer.
                  setEntete((x) => ({ ...x, code_fournisseur: code, id_engagement: '', code_devise: devise ?? x.code_devise,
                    taux_change: devise === 'MAD' ? '1' : devise && devise !== x.code_devise ? '' : x.taux_change }))
                }}
                disabled={!ecrire || factureRecue} title={titreFige}>
                <option value="">Choisir…</option>
                {(qFournisseurs.data ?? []).map((x) => (
                  <option key={x.code_fournisseur} value={x.code_fournisseur}>{x.nom}</option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq obligatoire htmlFor="ch-factureimport-2">N° de facture</Etiq>
              <Champ id="ch-factureimport-2" value={entete.numero_facture} onChange={maj('numero_facture')} disabled={!ecrire} placeholder="IHR2026000000243" />
            </div>
            <div>
              <Etiq obligatoire htmlFor="ch-factureimport-3">Date</Etiq>
              <Champ id="ch-factureimport-3" type="date" value={entete.date_facture} onChange={maj('date_facture')} disabled={!ecrire} />
            </div>
            <div>
              <Etiq htmlFor="ch-factureimport-4">Devise</Etiq>
              <Selecteur id="ch-factureimport-4" value={entete.code_devise} disabled={!ecrire || factureRecue} title={titreFige}
                onChange={(e) => setEntete((x) => ({ ...x, code_devise: e.target.value,
                  taux_change: e.target.value === 'MAD' ? '1' : e.target.value === x.code_devise ? x.taux_change : '' }))}>
                <option value="">Choisir…</option>
                {(qDevises.data ?? (entete.code_devise ? [{ code_devise: entete.code_devise }] : [])).map((x) => (
                  <option key={x.code_devise}>{x.code_devise}</option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq obligatoire htmlFor="ch-factureimport-6">Taux de change</Etiq>
              <Champ id="ch-factureimport-6" inputMode="decimal" value={entete.taux_change} onChange={maj('taux_change')} disabled={!ecrire || factureRecue} title={titreFige}
                className={cn('text-right tabular-nums', (tauxDirham || (tauxEloigne && !tauxConfirmeOk)) && 'border-alerte')} />
              {tauxDirham ? (
                <p className="mt-1 text-[11px] text-danger">Taux 1 : c’est le taux du dirham, pas celui du {entete.code_devise}.</p>
              ) : reference ? (
                <p className={cn('mt-1 text-[11px] tabular-nums', tauxEloigne ? 'text-alerte' : 'text-attenue-texte')}>
                  {qTaux.data?.source} : {fmt.nombre(reference, 4)}
                  {tauxSaisi > 0 && Math.abs(ecartTaux) > 0.00005 && ` · écart ${ecartTaux > 0 ? '+' : ''}${fmt.nombre(ecartTaux * 100, 1)} %`}
                </p>
              ) : null}
            </div>
            <div className="col-span-2">
              <Etiq htmlFor="ch-factureimport-5">Engagement d’importation</Etiq>
              <Selecteur id="ch-factureimport-5" value={entete.id_engagement} onChange={maj('id_engagement')} disabled={!ecrire || !entete.code_fournisseur}>
                <option value="">Sans engagement</option>
                {(d.engagements ?? [])
                  .filter((e) => !e.code_fournisseur || e.code_fournisseur === entete.code_fournisseur)
                  .map((e) => (
                    <option key={e.id_engagement} value={e.id_engagement}>
                      {e.numero_ei}{e.code_devise ? ` · ${e.code_devise}` : ''}{e.banque ? ` · ${e.banque}` : ''}
                    </option>
                  ))}
              </Selecteur>
            </div>
            <div>
              <Etiq htmlFor="ch-factureimport-7">Montant imprimé ({entete.code_devise})</Etiq>
              <Champ id="ch-factureimport-7" inputMode="decimal" className="text-right tabular-nums" value={entete.montant_devise} onChange={maj('montant_devise')} disabled={!ecrire || factureRecue} title={titreFige} />
            </div>
            <div>
              <Etiq htmlFor="ch-factureimport-8">Palettes imprimées</Etiq>
              <Champ id="ch-factureimport-8" inputMode="numeric" className="text-right tabular-nums" value={entete.nb_palettes} onChange={maj('nb_palettes')} disabled={!ecrire} />
            </div>
            <div>
              <Etiq htmlFor="ch-factureimport-9">Bobines imprimées</Etiq>
              <Champ id="ch-factureimport-9" inputMode="numeric" className="text-right tabular-nums" value={entete.nb_bobines} onChange={maj('nb_bobines')} disabled={!ecrire} />
            </div>
          </div>
          {tauxEloigne && !tauxDirham && reference && (
            <Alerte ton="alerte" className="mt-3" titre={`Taux éloigné de la référence (${ecartTaux > 0 ? '+' : ''}${fmt.nombre(ecartTaux * 100, 1)} %)`}>
              <p>
                Le taux saisi, {fmt.nombre(tauxSaisi, 4)}, s’écarte de plus de {fmt.nombre(qTaux.data?.ecart_max_pct ?? 3, 0)} % du{' '}
                {qTaux.data?.source} ({fmt.nombre(reference, 4)}). Une facture de{' '}
                {fmt.nombre(nombre(entete.montant_devise || 0) || 10000, 0)} {entete.code_devise} entrerait en stock pour{' '}
                {fmt.nombre((nombre(entete.montant_devise || 0) || 10000) * tauxSaisi, 0)} DH au lieu de{' '}
                {fmt.nombre((nombre(entete.montant_devise || 0) || 10000) * reference, 0)} DH.
              </p>
              {ecrire && (
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={tauxConfirmeOk}
                    onChange={(e) => setTauxConfirme(e.target.checked ? entete.taux_change : null)} />
                  Je confirme ce taux : c’est le taux réel appliqué par la banque
                </label>
              )}
            </Alerte>
          )}
        </CarteCorps>
      </Carte>

      {/* ================= Lignes ============================================= */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Lignes de la facture</CarteTitre>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11.5px] text-attenue-texte">
              <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} />
              toutes les références
            </label>
            {ecrire && (
              <>
                <Bouton taille="sm" variante="contour" onClick={() => setLignes((ls) => [...ls, ligneVide('HORS_ERP')])}>
                  <Plus />
                  Ligne hors ERP
                </Bouton>
                <Bouton taille="sm" variante="contour" onClick={() => setLignes((ls) => [...ls, ligneVide()])}>
                  <Plus />
                  Ligne
                </Bouton>
              </>
            )}
          </div>
        </CarteEntete>
        <CarteCorps className="p-0">
          {!entete.code_fournisseur && (
            <p className="px-3 pt-2 text-[12px] text-alerte">Choisissez d'abord le fournisseur : il décide des références et des bons proposés.</p>
          )}
          {/* PAS DE DEFILEMENT HORIZONTAL (10/10/2026). UNE LIGNE, UNE RANGEE
              QUAND ELLE Y TIENT (24/10/2026) : chaque case a la largeur de ce
              qu'elle attend, la reference prend le reste ; la largeur MESUREE
              du tableau decide. Trop etroit : le secondaire passe sur la rangee
              ↳, repliee pour une ligne complete. */}
          <div ref={refTableau}>
          <table className="w-full table-fixed text-[12.5px]">
            {uneRangee ? (
              <colgroup>
                <col style={{ width: COL.num }} />
                <col />
                <col style={{ width: COL.bc }} />
                <col style={{ width: COL.lot }} />
                <col style={{ width: COL.codeCouleur }} />
                <col style={{ width: COL.couleur }} />
                <col style={{ width: COL.unite }} />
                <col style={{ width: COL.poids }} />
                <col style={{ width: COL.bobines }} />
                <col style={{ width: COL.palettes }} />
                <col style={{ width: COL.prix }} />
                <col style={{ width: COL.remise }} />
                <col style={{ width: COL.montant }} />
                <col style={{ width: COL.controle }} />
                <col style={{ width: COL.actions }} />
              </colgroup>
            ) : (
              <colgroup>
                <col className="w-8" />
                <col />
                <col className="w-56" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-28" />
                <col className="w-40" />
                <col className="w-16" />
              </colgroup>
            )}
            <thead>
              {uneRangee ? (
                <tr className="border-b border-bordure">
                  <th className={cn(th1, 'text-right')}>#</th>
                  <th className={cn(th1, 'text-left')}>Référence / désignation</th>
                  <th className={cn(th1, 'text-left')}>Bon de commande</th>
                  <th className={cn(th1, 'text-left')}>Lot</th>
                  <th className={cn(th1, 'text-left')} title="Code couleur">Code</th>
                  <th className={cn(th1, 'text-left')} title="Libellé couleur">Coul.</th>
                  <th className={cn(th1, 'text-left')} title="Unité facturée">Unité</th>
                  <th className={cn(th1, 'text-right')} title="Poids net en kg (et quantité facturée hors kg)">Poids kg</th>
                  <th className={cn(th1, 'text-right')} title="Bobines">Bob.</th>
                  <th className={cn(th1, 'text-right')} title="Palettes">Pal.</th>
                  <th className={cn(th1, 'text-right')}>Prix unit.</th>
                  <th className={cn(th1, 'text-right')} title="Remise du fournisseur, en %">Rem. %</th>
                  <th className={cn(th1, 'text-right')}>Montant</th>
                  <th className={cn(th1, 'text-left')} title="Prix facturé contre le bon ; poids facturé contre le reçu">Contrôle</th>
                  <th className={th1} />
                </tr>
              ) : (
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'text-right')}>#</th>
                  <th className={cn(th, 'text-left')}>Référence / désignation</th>
                  <th className={cn(th, 'text-left')}>Bon de commande</th>
                  <th className={cn(th, 'text-right')}>Poids net kg</th>
                  <th className={cn(th, 'text-right')}>Prix unit.</th>
                  <th className={cn(th, 'text-right')}>Montant</th>
                  <th className={cn(th, 'text-left')} title="Prix facturé contre le bon ; poids facturé contre le reçu">Contrôle</th>
                  <th className={th} />
                </tr>
              )}
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                if (l.supprimee) return null
                const s = l.id_ligne ? serveur(l.id_ligne) : undefined
                const fige = !ecrire || l.recue
                const erp = l.type_ligne === 'ERP'
                const bcOptions = (qBc.data ?? []).filter((b) => !l.code_reference || b.code_reference === l.code_reference)
                const bcConnu = !l.id_ligne_bc || bcOptions.some((b) => b.id_ligne_bc === l.id_ligne_bc)
                const bcChoisi = bcOptions.find((b) => b.id_ligne_bc === l.id_ligne_bc)
                const detail = ouverte === l.cle && s && coutVisible
                const colis = controleColisage(l.poids_net_kg, l.nb_bobines, l.nb_palettes, condDe(l.code_reference), tolerances)
                // LA RANGEE ↳ S'OUVRE D'ELLE-MEME pour une ligne en saisie, incomplete
                // ou dont le colisage cloche ; le choix de l'utilisateur prime.
                // Sur une seule rangee, il n'y en a plus.
                const deplie = !uneRangee && (deplies[l.cle] ?? (!fige && (!l.id_ligne || !ligneComplete(l) || colis.niveau !== 'ok')))
                const c = controleLigne(l, s)
                const calcule = [
                  s?.pct_dossier != null && `${fmt.nombre(s.pct_dossier, 2)} % du dossier`,
                  coutVisible && s?.cout_revient_unitaire_dhs != null &&
                    `revient ${fmt.nombre(s.cout_revient_unitaire_dhs, 4)} DH/${s.type_ligne === 'HORS_ERP' ? 'pce' : UNITE[s.unite]}`,
                ]
                const resume = (uneRangee ? calcule : [
                  l.lot_fournisseur && `lot ${l.lot_fournisseur}`,
                  [l.code_couleur, l.libelle_couleur].filter(Boolean).join(' '),
                  erp && l.unite !== 'kg' && `${l.quantite || '—'} ${UNITE[l.unite]}`,
                  (nombre(l.nb_bobines) > 0 || nombre(l.nb_palettes) > 0) &&
                    `${fmt.entier(nombre(l.nb_bobines))} bob. · ${fmt.entier(nombre(l.nb_palettes))} pal.`,
                  nombre(l.remise) > 0 && `remise ${fmt.nombre(nombre(l.remise), 2)} %`,
                  ...calcule,
                ]).filter(Boolean) as string[]
                const tdx = uneRangee ? td1 : td
                const chp = uneRangee ? champ1 : champ

                // ---- Les cases, une fois : sur la rangee principale ou sur ↳ ----
                const caseLot = (
                  <Champ className={chp} aria-label="Lot de la ligne" value={l.lot_fournisseur} disabled={fige}
                    title={l.lot_fournisseur || undefined} onChange={(e) => majLigne(l.cle, { lot_fournisseur: e.target.value })} />
                )
                const caseCodeCouleur = (
                  <Champ className={chp} aria-label="Code couleur de la ligne" value={l.code_couleur} disabled={fige || !erp} placeholder="7612"
                    title={l.code_couleur || undefined} onChange={(e) => majLigne(l.cle, { code_couleur: e.target.value })} />
                )
                const caseCouleur = (
                  <Champ className={chp} aria-label="Libellé couleur de la ligne" value={l.libelle_couleur} disabled={fige || !erp} placeholder="RED"
                    title={l.libelle_couleur || undefined} onChange={(e) => majLigne(l.cle, { libelle_couleur: e.target.value })} />
                )
                const caseUnite = erp ? (
                  <Selecteur className={chp} value={l.unite} disabled={fige} aria-label="Unité facturée"
                    onChange={(e) => majLigne(l.cle, { unite: e.target.value as LigneEdit['unite'] })}>
                    <option value="kg">kg</option>
                    <option value="ml">{uneRangee ? 'm' : 'mètre'}</option>
                    <option value="piece">{uneRangee ? 'pce' : 'pièce'}</option>
                  </Selecteur>
                ) : (
                  <span className="block pt-1 text-[12px] text-attenue-texte">{uneRangee ? 'pce' : 'pièce'}</span>
                )
                const caseQuantite = (
                  <Champ className={cn(chp, 'text-right')} inputMode="decimal" aria-label="Quantité facturée" value={l.quantite} disabled={fige}
                    placeholder={uneRangee && erp ? `qté ${UNITE[l.unite]}` : undefined}
                    onChange={(e) => majLigne(l.cle, { quantite: e.target.value })} />
                )
                const casePoids = (
                  <Champ className={cn(chp, 'text-right')} inputMode="decimal" aria-label="Poids net en kilos" value={l.poids_net_kg} disabled={fige}
                    onChange={(e) => majColis(l, 'poids', e.target.value)} />
                )
                const caseBobines = (
                  <Champ className={cn(chp, 'text-right')} inputMode="numeric" aria-label="Bobines de la ligne" value={l.nb_bobines} disabled={fige}
                    onChange={(e) => majColis(l, 'bobines', e.target.value)} />
                )
                const casePalettes = (
                  <Champ className={cn(chp, 'text-right')} inputMode="numeric" aria-label="Palettes de la ligne" value={l.nb_palettes} disabled={fige}
                    onChange={(e) => majColis(l, 'palettes', e.target.value)} />
                )
                const boutonLien = !fige && (
                  <button type="button" onClick={() => majLigne(l.cle, { lie: !l.lie })}
                    title={l.lie
                      ? 'Poids, bobines et palettes se repondent — cliquez pour saisir chacun separement'
                      : 'Calcul detache — cliquez pour relier les trois'}
                    aria-label={l.lie ? 'Détacher le calcul' : 'Relier le calcul'}
                    className={cn('shrink-0 rounded-[var(--radius)] p-1',
                      l.lie ? 'text-primaire hover:bg-primaire/10' : 'text-alerte hover:bg-alerte/10')}>
                    {l.lie ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
                  </button>
                )
                const caseRemise = (
                  <Champ className={cn(chp, 'text-right')} inputMode="decimal" value={l.remise} disabled={fige} placeholder="0"
                    aria-label="Remise du fournisseur en pourcentage"
                    onChange={(e) => majLigne(l.cle, { remise: e.target.value })} />
                )
                const boutonRetirer = ecrire && !l.recue && (
                  <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10" aria-label="Retirer la ligne"
                    onClick={() => (l.id_ligne ? majLigne(l.cle, { supprimee: true }) : setLignes((ls) => ls.filter((x) => x.cle !== l.cle)))}>
                    <Trash2 />
                  </Bouton>
                )
                const nbColonnes = uneRangee ? 15 : 8
                return (
                  <Fragment key={l.cle}>
                    <tr className={cn('align-top', !deplie && !detail && !(uneRangee && colis.niveau !== 'ok') && 'border-b border-bordure/60',
                      !ligneComplete(l) && (l.code_reference || l.libelle) && 'bg-alerte/5')}>
                      <td className={cn(tdx, 'pt-2 text-right tabular-nums text-attenue-texte')}>
                        {i + 1}
                        {l.recue && <Lock className="ml-auto mt-1 size-3" aria-label="Déjà reçue" />}
                      </td>
                      <td className={cn(tdx, 'min-w-0')}>
                        {erp ? (
                          /* LES REFERENCES DU FOURNISSEUR D'ABORD : proposer
                             tout le catalogue pour une facture Hasirci, c'est
                             inviter a choisir le Red d'Ozkaralar. La case
                             « toutes » ouvre le reste quand il le faut. */
                          <ChampReference
                            valeur={l.code_reference}
                            fournisseur={toutes ? undefined : entete.code_fournisseur}
                            surChoix={(r) => choisirReference(l, r as RefCatalogue)}
                            desactive={fige}
                            placeholder="Référence — tapez…"
                            ariaLabel="Référence de la ligne"
                          />
                        ) : (
                          <Champ className={chp} value={l.libelle} disabled={fige} placeholder="Hors ERP — pièce, autre…"
                            aria-label="Désignation de la ligne hors ERP"
                            onChange={(e) => majLigne(l.cle, { libelle: e.target.value })} />
                        )}
                        {/* Repliee, la rangee ↳ laisse son resume sous la reference ;
                            sur une seule rangee, il ne reste que le calcule. */}
                        {!deplie && resume.length > 0 && (
                          <div className="mt-0.5 truncate text-[11px] text-attenue-texte" title={resume.join(' · ')}>
                            {uneRangee ? '' : '↳ '}{resume.join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className={tdx}>
                        {erp ? (
                          <Selecteur className={cn(chp, 'w-full')} value={l.id_ligne_bc} disabled={fige} aria-label="Bon de commande de la ligne"
                            title={bcChoisi ? `${bcChoisi.numero_bc} · ligne ${bcChoisi.ligne_numero} · reste ${fmt.nombre(bcChoisi.quantite_restante_kg, 0)} kg` : l.numero_bc || undefined}
                            onChange={(e) => choisirBc(l, e.target.value)}>
                            <option value="">Libre — sans BC</option>
                            {!bcConnu && <option value={l.id_ligne_bc}>{l.numero_bc || 'bon lié'}</option>}
                            {bcOptions.map((b) => (
                              <option key={b.id_ligne_bc} value={b.id_ligne_bc}>
                                {/* Sur une rangee, le bon choisi ne montre que son numero
                                    (le reste est dans la bulle) ; la liste garde le reste. */}
                                {uneRangee && b.id_ligne_bc === l.id_ligne_bc
                                  ? b.numero_bc
                                  : `${b.numero_bc} · l.${b.ligne_numero} · reste ${fmt.nombre(b.quantite_restante_kg, 0)} kg`}
                              </option>
                            ))}
                          </Selecteur>
                        ) : (
                          <span className="block pt-1.5 text-[11px] italic text-attenue-texte" title="Une ligne hors ERP porte sa part de frais">
                            {uneRangee ? 'hors ERP' : 'porte sa part de frais'}
                          </span>
                        )}
                      </td>
                      {uneRangee && (
                        <>
                          <td className={tdx}>{caseLot}</td>
                          <td className={tdx}>{caseCodeCouleur}</td>
                          <td className={tdx}>{caseCouleur}</td>
                          <td className={tdx}>{caseUnite}</td>
                        </>
                      )}
                      <td className={tdx}>
                        {erp ? (
                          uneRangee && l.unite !== 'kg' ? (
                            /* Facturee hors kg (rare) : le poids, puis la quantite facturee. */
                            <div className="space-y-1">
                              {casePoids}
                              {caseQuantite}
                            </div>
                          ) : casePoids
                        ) : uneRangee ? caseQuantite : <span className="block pt-1.5 text-right text-attenue-texte">—</span>}
                      </td>
                      {uneRangee && (
                        <>
                          <td className={tdx}>{caseBobines}</td>
                          <td className={tdx}>{casePalettes}</td>
                        </>
                      )}
                      <td className={tdx}>
                        <Champ className={cn(chp, 'text-right')} inputMode="decimal" aria-label="Prix unitaire en devise" value={l.prix_unitaire_devise} disabled={fige}
                          onChange={(e) => majLigne(l.cle, { prix_unitaire_devise: e.target.value })} />
                      </td>
                      {uneRangee && <td className={tdx}>{caseRemise}</td>}
                      <td className={cn(tdx, 'pt-2 text-right font-medium tabular-nums')}>{fmt.nombre(montantLigne(l), 2)}</td>
                      <td className={cn(tdx, 'pt-1.5 text-[11px] leading-snug tabular-nums')}>
                        {c.prixBc == null && c.recu == null ? (
                          <span className="text-attenue-texte">—</span>
                        ) : (
                          <>
                            {c.prixBc != null && (
                              <div title={`Prix du bon : ${fmt.nombre(c.prixBc, 4)} ${entete.code_devise}/kg`}>
                                <span className="text-attenue-texte">{uneRangee ? 'BC ' : 'prix / BC '}</span>
                                {c.ecartPrix == null ? (
                                  <span className="text-attenue-texte">{fmt.nombre(c.prixBc, 4)}</span>
                                ) : Math.abs(c.ecartPrix) < 0.005 ? (
                                  <span className="font-medium text-succes">=</span>
                                ) : (
                                  <span className={cn('font-medium', c.ecartPrix > 0 ? 'text-alerte' : 'text-succes')}>
                                    {c.ecartPrix > 0 ? '+' : ''}{fmt.nombre(c.ecartPrix, 2)} %
                                  </span>
                                )}
                              </div>
                            )}
                            {c.recu != null && c.ecartKg != null && (
                              <div title={`Reçu : ${fmt.nombre(c.recu, 2)} kg`}>
                                <span className="text-attenue-texte">reçu{uneRangee ? ' ' : ` ${fmt.nombre(c.recu, 2)} `}</span>
                                {Math.abs(c.ecartKg) <= 0.001 ? (
                                  <span className="font-medium text-succes">=</span>
                                ) : (
                                  <span className="font-medium text-alerte">{c.ecartKg > 0 ? '+' : ''}{fmt.nombre(c.ecartKg, 2)}</span>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className={cn(tdx, 'pt-1')}>
                        <div className="flex justify-end gap-0.5">
                          {uneRangee ? (
                            <>
                              {erp && boutonLien}
                              {s && coutVisible && (
                                <Bouton taille="icone-xs" variante="discret" aria-expanded={!!detail}
                                  aria-label={detail ? 'Replier la répartition des frais' : 'Voir la répartition des frais'}
                                  title={`Frais ${fmt.nombre(s.frais_alloues_dhs ?? 0, 2)} DH — voir la répartition par frais`}
                                  onClick={() => setOuverte(ouverte === l.cle ? null : l.cle)}>
                                  {detail ? <ChevronDown /> : <ChevronRight />}
                                </Bouton>
                              )}
                            </>
                          ) : (
                            <Bouton taille="icone-xs" variante="discret" aria-expanded={deplie}
                              aria-label={deplie ? 'Replier le détail de la ligne' : 'Déplier le détail de la ligne'}
                              title={deplie ? 'Replier : lot, couleur, colis, remise' : 'Déplier : lot, couleur, colis, remise'}
                              onClick={() => setDeplies((x) => ({ ...x, [l.cle]: !deplie }))}>
                              {deplie ? <ChevronUp /> : <ChevronDown />}
                            </Bouton>
                          )}
                          {boutonRetirer}
                        </div>
                      </td>
                    </tr>
                    {/* SUR UNE RANGEE, l'avis de colisage seul passe dessous, et
                        seulement quand il y a quelque chose a dire. */}
                    {uneRangee && colis.niveau !== 'ok' && (
                      <tr className={cn(!detail && 'border-b border-bordure/60')}>
                        <td />
                        <td colSpan={nbColonnes - 1} className={cn(tdx, 'pt-0 pb-1.5')}>
                          <AvisColisage className="mt-0" kg={l.poids_net_kg} bobines={l.nb_bobines}
                            palettes={l.nb_palettes} cond={condDe(l.code_reference)} />
                        </td>
                      </tr>
                    )}
                    {/* LA LIGNE COMPLEMENTAIRE de la ligne de facture, quand la rangee ne suffit pas. */}
                    {deplie && (
                      <tr className={cn('align-top', !detail && 'border-b border-bordure/60')}>
                        <td />
                        <td colSpan={7} className={cn(td, 'pb-2')}>
                          <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
                            <div className="flex w-28 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">↳ Lot</span>
                              {caseLot}
                            </div>
                            <div className="flex w-20 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Code coul.</span>
                              {caseCodeCouleur}
                            </div>
                            <div className="flex w-24 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Couleur</span>
                              {caseCouleur}
                            </div>
                            <div className="flex w-20 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Unité</span>
                              {caseUnite}
                            </div>
                            <div className="flex w-16 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Qté</span>
                              {erp && l.unite === 'kg' ? (
                                <span className="block pt-1 text-right tabular-nums text-attenue-texte">= poids</span>
                              ) : caseQuantite}
                            </div>
                            <div className="flex w-16 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Bobines</span>
                              {caseBobines}
                            </div>
                            <div className="flex w-28 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Palettes</span>
                              <div className="flex items-center gap-1">
                                {casePalettes}
                                {boutonLien}
                              </div>
                            </div>
                            <div className="flex w-16 flex-col gap-0.5">
                              <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Remise %</span>
                              {caseRemise}
                            </div>
                            {/* Ce que le serveur a calcule : une ligne pas encore enregistree n'en a pas. */}
                            {s && !coutVisible && (
                              <div className="flex w-20 flex-col gap-0.5">
                                <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">% dossier</span>
                                <span className="pt-1 tabular-nums text-attenue-texte">{s.pct_dossier == null ? '—' : `${fmt.nombre(s.pct_dossier, 2)} %`}</span>
                              </div>
                            )}
                            {s && coutVisible && (
                              <div className="flex w-36 flex-col gap-0.5">
                                <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Frais DH (% dossier)</span>
                                <button type="button" className="inline-flex items-center gap-0.5 pt-1 font-medium tabular-nums text-primaire hover:underline"
                                  onClick={() => setOuverte(ouverte === l.cle ? null : l.cle)} title="Voir la répartition par frais">
                                  {fmt.nombre(s.frais_alloues_dhs ?? 0, 2)}
                                  <span className="font-normal text-attenue-texte">{s.pct_dossier == null ? '' : ` (${fmt.nombre(s.pct_dossier, 2)} %)`}</span>
                                  {detail ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                </button>
                              </div>
                            )}
                            {s && coutVisible && (
                              <div className="flex w-24 flex-col gap-0.5">
                                <span className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Revient /u</span>
                                <span className="pt-1 tabular-nums">{s.cout_revient_unitaire_dhs == null ? '—' : (
                                  <>
                                    {fmt.nombre(s.cout_revient_unitaire_dhs, 4)}
                                    <span className="text-[10.5px] text-attenue-texte"> /{s.type_ligne === 'HORS_ERP' ? 'pce' : UNITE[s.unite]}</span>
                                  </>
                                )}</span>
                              </div>
                            )}
                          </div>
                          <AvisColisage className="max-w-[36rem]" kg={l.poids_net_kg} bobines={l.nb_bobines}
                            palettes={l.nb_palettes} cond={condDe(l.code_reference)} />
                        </td>
                      </tr>
                    )}
                    {/* LA REPARTITION DE LA LIGNE : la part de chaque frais. */}
                    {detail && (
                      <tr className="border-b border-bordure/60 bg-attenue/25">
                        <td />
                        <td colSpan={nbColonnes - 1} className="px-2 py-2">
                          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                            <span className="text-attenue-texte">
                              Valeur d'achat <strong className="text-texte tabular-nums">{fmt.nombre(s!.valeur_achat_dhs, 2)} DH</strong>
                            </span>
                            <span className="text-attenue-texte">
                              Frais <strong className="text-texte tabular-nums">{fmt.nombre(s!.frais_alloues_dhs ?? 0, 2)} DH</strong>
                              {s!.pct_dossier != null && <span className="tabular-nums"> ({fmt.nombre(s!.pct_dossier, 2)} % du dossier)</span>}
                            </span>
                            {fraisInclus.map((f) => {
                              const p = partDe(s!.id_ligne, f.id_ligne_frais)
                              return (
                                <span key={f.id_ligne_frais} className="text-attenue-texte">
                                  {f.frais_libelle}{' '}
                                  <strong className="text-texte tabular-nums">{p ? fmt.nombre(p.montant_alloue_dhs ?? 0, 2) : '—'}</strong>
                                  {p && <span className="tabular-nums"> ({fmt.nombre(p.pourcentage, 2)} %)</span>}
                                </span>
                              )
                            })}
                            <span className="text-attenue-texte">
                              Coût de revient <strong className="text-texte tabular-nums">{fmt.nombre(s!.cout_revient_dhs ?? 0, 2)} DH</strong>
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          </div>
          {lignes.some((l) => l.recue) && (
            <p className="border-t border-bordure px-3 py-2 text-[11.5px] text-attenue-texte">
              <Lock className="mr-1 inline size-3" />
              Les lignes déjà reçues sont entrées en stock à leur prix : elles ne se modifient plus. Une correction passe par le solde
              de la ligne, les frais du dossier, ou la contre-passation de la réception avant la DUM.
            </p>
          )}
        </CarteCorps>
      </Carte>

      {/* ================= Totaux ============================================= */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Totaux de la facture</CarteTitre>
        </CarteEntete>
        <CarteCorps>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] md:grid-cols-4">
            {totalBrut - totalDevise > 0.005 && (
              <>
                <Total libelle={`Montant brut (${entete.code_devise})`} valeur={fmt.nombre(totalBrut, 2)} />
                <Total libelle={`Remise (${entete.code_devise})`} valeur={`− ${fmt.nombre(totalBrut - totalDevise, 2)}`} />
              </>
            )}
            <Total libelle={`Montant net (${entete.code_devise})`} valeur={fmt.nombre(totalDevise, 2)}
              controle={ecartImprime == null ? undefined : ecartMontant
                ? `imprimé ${fmt.nombre(nombre(entete.montant_devise), 2)} · écart ${ecartImprime > 0 ? '+' : ''}${fmt.nombre(ecartImprime, 2)}`
                : `= imprimé ${fmt.nombre(nombre(entete.montant_devise), 2)}`}
              alerte={ecartMontant} ok={ecartImprime != null && !ecartMontant} />
            <Total libelle="Valeur (DH)" valeur={fmt.nombre(taux > 0 ? totalDevise * taux : 0, 2)}
              controle={`au taux ${fmt.nombre(taux, 4)}${reference ? ` · réf. ${fmt.nombre(reference, 4)}` : ''}`}
              alerte={tauxDirham || tauxEloigne} />
            <Total libelle="Poids net (kg)" valeur={fmt.nombre(totalPoids, 2)}
              controle={totalRecu > 0 ? `reçu ${fmt.nombre(totalRecu, 2)}${Math.abs(totalPoids - totalRecu) > 0.001 ? ` · écart ${totalPoids - totalRecu > 0 ? '+' : ''}${fmt.nombre(totalPoids - totalRecu, 2)}` : ''}` : undefined}
              alerte={totalRecu > 0 && Math.abs(totalPoids - totalRecu) > 0.001} ok={totalRecu > 0 && Math.abs(totalPoids - totalRecu) <= 0.001} />
            <Total libelle="Palettes / bobines" valeur={`${fmt.entier(totalPalettes)} / ${fmt.entier(totalBobines)}`}
              controle={entete.nb_palettes || entete.nb_bobines ? `${ecartColis ? '' : '= '}imprimé ${entete.nb_palettes || '—'} / ${entete.nb_bobines || '—'}` : undefined}
              alerte={ecartColis} ok={!!(entete.nb_palettes || entete.nb_bobines) && !ecartColis} />
            {coutVisible && !nouvelle && (
              <>
                <Total libelle="Frais alloués (DH)" valeur={fmt.nombre(totalFrais, 2)}
                  controle={totalValeur > 0 ? `${fmt.nombre((totalFrais * 100) / totalValeur, 2)} % de la valeur` : undefined} />
                <Total libelle="Coût de revient (DH)" valeur={fmt.nombre(totalValeur + totalFrais, 2)} fort />
              </>
            )}
          </div>
          {ecartMontant && (
            <Alerte ton="alerte" className="mt-3">
              La somme des lignes ne fait pas le montant imprimé : une ligne manque ou un prix est faux.
            </Alerte>
          )}
          {lignesModifiees.length > 0 && !nouvelle && (
            <p className="mt-3 text-[11.5px] text-attenue-texte">
              {lignesModifiees.length} ligne(s) modifiée(s) : la répartition des frais sera recalculée à l'enregistrement.
            </p>
          )}
        </CarteCorps>
      </Carte>

      {/* UNE SEULE ACTION PRINCIPALE, COLLANTE (regle d'ecran du 10/10) :
          Enregistrer reste visible tant que la facture se modifie, grise avec
          sa raison quand il n'y a rien a ecrire ou qu'il manque quelque chose. */}
      {ecrire && (
        <div
          className={cn(
            'sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            modifie && !raisonBlocage ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="min-w-0 text-[13px]">
            {modifie && !raisonBlocage ? (
              <>
                <span className="font-medium">
                  {nouvelle
                    ? `nouvelle facture · ${visibles.filter(ligneComplete).length} ligne(s)`
                    : [
                        enteteModifie ? 'en-tête modifié' : null,
                        nbAjoutees ? `${nbAjoutees} ligne(s) ajoutée(s)` : null,
                        nbCorrigees ? `${nbCorrigees} corrigée(s)` : null,
                        nbRetirees ? `${nbRetirees} retirée(s)` : null,
                      ].filter(Boolean).join(' · ')}
                </span>
                <span className="text-alerte"> — rien n’est encore enregistré.</span>
              </>
            ) : (
              <span className={modifie ? 'text-alerte' : 'text-attenue-texte'}>{raisonBlocage}</span>
            )}
            <span className="ml-2 tabular-nums">
              <span className="text-attenue-texte">net </span>
              <span className="font-medium">{fmt.nombre(totalDevise, 2)} {entete.code_devise}</span>
              {ecartImprime != null && (
                <span className={ecartMontant ? 'text-alerte' : 'text-succes'}>
                  {ecartMontant ? ` · écart à l’imprimé ${ecartImprime > 0 ? '+' : ''}${fmt.nombre(ecartImprime, 2)}` : ' · = imprimé'}
                </span>
              )}
            </span>
          </span>
          <div className="flex items-center gap-2">
            {supprimable && (
              <Bouton variante="discret" className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: `Supprimer la facture ${facture!.numero_facture} ?`,
                    destructif: true,
                    libelleConfirmer: 'Supprimer',
                    description: 'Ses lignes sont supprimées et les frais du dossier répartis à nouveau.',
                    action: () => supprimer.mutate(),
                  })
                }>
                <Trash2 />
                Supprimer la facture
              </Bouton>
            )}
            <Bouton disabled={!!raisonBlocage} title={raisonBlocage ?? undefined} chargement={enregistrer.isPending}
              onClick={() => enregistrer.mutate()}>
              <Save />
              Enregistrer la facture
            </Bouton>
          </div>
        </div>
      )}
      {confirmation.element}
    </div>
  )
}

function Total({
  libelle,
  valeur,
  controle,
  alerte,
  ok,
  fort,
}: {
  libelle: string
  valeur: React.ReactNode
  controle?: string
  alerte?: boolean
  /** Le controle concorde : il se lit en vert, pas en gris. */
  ok?: boolean
  fort?: boolean
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-attenue-texte">{libelle}</div>
      <div className={cn('tabular-nums', fort ? 'text-[16px] font-semibold' : 'text-[15px] font-medium', alerte && 'text-alerte')}>{valeur}</div>
      {controle && <div className={cn('text-[11px] tabular-nums', alerte ? 'text-alerte' : ok ? 'text-succes' : 'text-attenue-texte')}>{controle}</div>}
    </div>
  )
}

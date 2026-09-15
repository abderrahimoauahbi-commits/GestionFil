/**
 * Nouveau bon de commande — en-tete ET lignes saisis ensemble.
 *
 * UNE GRILLE, ET DANS CHAQUE LIGNE UNE LISTE DEROULANTE AVEC RECHERCHE.
 *
 * L'ecran proposait auparavant toutes les references du fournisseur en cases a
 * cocher, et chargeait le catalogue entier pour cela. Sur 124 references cela
 * passait ; sur mille c'est illisible, et le chargement coute une seconde a
 * chaque ouverture. On designe desormais ce qu'on commande LA OU ON LE
 * COMMANDE : dans la cellule « reference » de la ligne. On y clique, la liste
 * s'ouvre ; on tape, elle se resserre. Le serveur cherche, jamais le navigateur.
 *
 * CE QUE LA LISTE PROPOSE — un interrupteur, deux positions :
 *
 *   « Du plan d'achat » : ce que le MRP reclame chez ce fournisseur, et rien
 *   d'autre. C'est le cas courant, et s'y tenir evite de commander par megarde
 *   une reference dont on a deja trois mois de stock.
 *
 *   « Tout le catalogue » : quand on achete pour une autre raison — un prix,
 *   un delai, une anticipation, un fil qu'on prend d'habitude ailleurs.
 *
 * LA GRILLE S'OUVRE VIDE. Le plan PROPOSE, il ne decide pas : verser ses
 * propositions dans le bon des l'arrivee obligerait a retirer une a une celles
 * qu'on ne veut pas, alors que le travail reel consiste a ajouter ce qu'on
 * commande.
 *
 * ET SI LA REFERENCE N'EXISTE PAS ? La liste ne dit pas seulement non : elle
 * propose de l'ajouter au catalogue, ou de garder la ligne telle quelle. Une
 * ligne sans reference n'est pas une ligne d'un type particulier — c'est
 * simplement une ligne dont ce qu'on commande n'est pas au catalogue :
 * echantillon, type nouveau, transport. Elle ne se convertit pas en kilos,
 * n'entre pas en stock et ne compte dans aucune statistique de matiere, faute
 * de reference sous laquelle la ranger.
 *
 * Tout part en UNE transaction. Un bon a moitie cree — numero attribue, aucune
 * ligne — serait un document fantome que personne ne saurait interpreter, et
 * qui fausserait la numerotation autant que les etats.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Link2, Plus, Save, Trash2, Unlink2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { useParamVue } from '../lib/navigation'
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
  Selecteur,
} from '../composants/ui/base'
import { ChampRecherche, type Suggestion } from '../composants/ChampRecherche'
import { cn, fmt } from '../lib/utils'
import {
  type Conditionnement,
  depuisBobines,
  depuisKg,
  depuisPalettes,
  depuisUnite,
  facteurVersKg,
  pourChamp,
} from '../lib/conditionnement'

const MODULE = 'BONS_COMMANDE'

interface RefCommandable extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  /** Le fournisseur HABITUEL de cette reference — pas une exclusivite. */
  code_fournisseur?: string | null
  fournisseur_nom?: string | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  densite_kg_ml?: number | null
  reference_fournisseur?: string | null
  couleur?: string | null
  code_couleur?: string | null
  classe_abc: string | null
  moq_kg: number | null
  multiple_achat_kg: number | null
  stock_projete_kg: number | null
  stock_min_kg: number | null
  besoin_12m_kg: number | null
  deja_commande_kg: number | null
  jours_couverture: number | null
  statut_stock: string | null
  qte_a_commander_kg: number | null
  prix_suggere_devise?: number
  prix_mad_suggere?: number
  source_prix?: string
  risque_sourcing: string | null
  delai_livraison_jours: number | null
  tier: string | null
  deja_sur_le_bon: number
  /** Cette reference est l'equivalent d'une reference en tension. */
  equivalent_de: string | null
  besoin_equivalent_kg: number | null
  nb_equivalents: number
}

interface Fournisseur {
  code_fournisseur: string
  nom: string
  code_devise?: string
  delai_livraison_jours?: number
  pays?: string
}

/**
 * LA NATURE D'UNE LIGNE, et ce qu'elle implique jusqu'au quai.
 *
 * MARCHANDISE : une reference du catalogue. Elle se convertit en kilos, se
 * pese a la reception, entre en stock et pese sur le cout de revient.
 *
 * LIBRE : de la marchandise SANS reference — echantillon, type nouveau,
 * article que le fournisseur n'a pas encore. Elle se commande et peut etre
 * constatee a l'arrivee, mais n'entre jamais en stock : il n'y a aucune
 * reference sous laquelle la ranger, donc aucun CMUP a alimenter.
 *
 * SERVICE : ce qui n'est pas de la marchandise du tout — fret, commission,
 * montage. Rien n'arrive au quai.
 */
type Nature = 'MARCHANDISE' | 'LIBRE' | 'SERVICE'

/** Les unites d'une ligne sans reference : rien ne s'y pese. */
const UNITES_LIBRES = ['Forfait', 'Unite', 'Heure'] as const

interface LigneSaisie {
  cle: string
  nature: Nature
  /** Vide sur une ligne libre ou une prestation. */
  code_reference: string
  /** Ce qui nomme la ligne : la designation du catalogue, ou l'intitule saisi. */
  intitule: string
  /** Le conditionnement de la reference, fige au moment du choix. */
  cond: Conditionnement
  unite_catalogue: string
  fournisseur_habituel: string | null
  /** Ce que le plan reclamait, pour afficher l'ecart si l'on s'en ecarte. */
  suggere_kg: number | null
  qte: string
  unite: string
  palettes: string
  bobines: string
  /** Lie, les trois se repondent ; detache, chacun se saisit seul. */
  lie: boolean
  /** Au KILO pour une marchandise, a l'unite saisie sinon. */
  prix: string
  /**
   * CE QUE LE FOURNISSEUR RECONNAIT.
   *
   * Le bon part chez lui : il y lit SON code article et SON code couleur, pas
   * les notres. Ces trois-la appartiennent a la REFERENCE — ce ne sont pas des
   * proprietes de la commande — mais c'est en preparant la commande qu'on
   * s'apercoit qu'ils manquent. On les corrige donc ici, et la correction
   * remonte a la fiche de la reference, la ou l'information a sa place.
   */
  reference_fournisseur: string
  couleur: string
  code_couleur: string
}

let compteur = 0

/**
 * UNE LIGNE NEUVE, en attente de ce qu'on va taper dedans.
 *
 * Elle naît en MARCHANDISE : c'est ce qu'on commande neuf fois sur dix. Elle ne
 * bascule en ligne libre que si l'on retient un intitule qui ne correspond a
 * aucune reference — ce n'est donc pas un type qu'on choisit d'avance, mais le
 * constat que ce qu'on commande n'est pas au catalogue.
 */
function ligneVide(): LigneSaisie {
  compteur += 1
  return {
    cle: `l-${compteur}`,
    nature: 'MARCHANDISE',
    code_reference: '',
    intitule: '',
    cond: {},
    unite_catalogue: 'kg',
    fournisseur_habituel: null,
    suggere_kg: null,
    qte: '',
    unite: 'kg',
    palettes: '',
    bobines: '',
    lie: true,
    prix: '',
    reference_fournisseur: '',
    couleur: '',
    code_couleur: '',
  }
}

/** Une ligne part au serveur quand elle porte de quoi etre comprise. */
const estPrete = (l: LigneSaisie) =>
  Number(l.qte) > 0 &&
  Number(l.prix) > 0 &&
  (l.nature === 'MARCHANDISE' ? !!l.code_reference : !!l.intitule.trim())

/** Une ligne commencee mais incomplete : elle bloque l'enregistrement. */
const estEbauche = (l: LigneSaisie) =>
  !estPrete(l) && (!!l.code_reference || !!l.intitule.trim() || Number(l.prix) > 0)

export function BonCommandeNouveau() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()

  const [entete, setEntete] = useState({
    code_fournisseur: '',
    date_bc: new Date().toISOString().slice(0, 10),
    date_livraison_prevue: '',
    motif_creation: 'MRP',
    notes: '',
  })
  /**
   * OU LA FRAPPE VA CHERCHER.
   *
   * Le plan par defaut : neuf commandes sur dix ne sortent pas de ce que le MRP
   * reclame, et l'y restreindre evite de commander par megarde une reference
   * dont on a deja trois mois de stock. On l'ouvre au catalogue entier quand on
   * achete pour une autre raison — un prix, un delai, une anticipation.
   */
  const [mode, setMode] = useState<'PLAN' | 'CATALOGUE'>('PLAN')
  const [lignes, setLignes] = useState<LigneSaisie[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [aCreer, setACreer] = useState<string | null>(null)

  const refDemandee = useParamVue('reference')
  const dejaAmorce = useRef(false)

  const qRefDemandee = useQuery({
    queryKey: ['catalogue', refDemandee],
    queryFn: () =>
      api.get<{ code_reference: string; code_fournisseur: string | null }>(
        `/api/catalogue/${encodeURIComponent(refDemandee)}`,
      ),
    enabled: !!refDemandee,
  })

  const qFrs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: () => api.get<Fournisseur[]>('/api/fournisseurs?actif=1&limite=500'),
  })
  const fournisseur = qFrs.data?.find((f) => f.code_fournisseur === entete.code_fournisseur)
  const devise = fournisseur?.code_devise ?? 'MAD'

  /**
   * CE QUE LE PLAN RECLAME CHEZ CE FOURNISSEUR.
   *
   * Cette liste-la reste bornee par nature : c'est ce qui manque, pas le
   * catalogue. On la charge donc entiere, et elle sert a deux choses — remplir
   * la grille d'emblee, et nourrir la frappe en mode « plan ».
   */
  const qPlan = useQuery({
    queryKey: ['refs-plan', entete.code_fournisseur],
    queryFn: () =>
      api.get<RefCommandable[]>(
        `/api/references-commandables?code_fournisseur=${encodeURIComponent(entete.code_fournisseur)}`,
      ),
    enabled: !!entete.code_fournisseur,
  })
  const proposees = useMemo(
    () => (qPlan.data ?? []).filter((r) => (r.qte_a_commander_kg ?? 0) > 0),
    [qPlan.data],
  )
  // La fiche telle que le serveur l'a rendue : elle sert de point de
  // comparaison pour ne remonter au catalogue QUE ce qui a change.
  const parPlan = useMemo(
    () => new Map((qPlan.data ?? []).map((r) => [r.code_reference, r])),
    [qPlan.data],
  )

  const condDe = (r: RefCommandable): Conditionnement => ({
    poids_bobine_kg: r.poids_bobine_kg,
    bobines_par_palette: r.bobines_par_palette,
    densite_kg_ml: r.densite_kg_ml,
  })

  /**
   * Une reference retenue remplit la ligne : sa designation, son
   * conditionnement, ce que le plan reclame et le prix qu'il propose.
   */
  const depuisReference = (r: RefCommandable, cle?: string): LigneSaisie => {
    const c = condDe(r)
    const kg = r.qte_a_commander_kg ?? 0
    const colis = depuisKg(kg, c)
    compteur += 1
    return {
      cle: cle ?? `l-${compteur}`,
      nature: 'MARCHANDISE',
      code_reference: r.code_reference,
      intitule: r.designation ?? r.code_reference,
      cond: c,
      unite_catalogue: r.unite_catalogue ?? 'kg',
      fournisseur_habituel: r.code_fournisseur ?? null,
      suggere_kg: kg > 0 ? kg : null,
      qte: kg > 0 ? String(kg) : '',
      unite: 'kg',
      palettes: pourChamp(colis.palettes),
      bobines: pourChamp(colis.bobines),
      lie: true,
      prix: r.prix_suggere_devise != null ? String(r.prix_suggere_devise) : '',
      reference_fournisseur: r.reference_fournisseur ?? '',
      couleur: r.couleur ?? '',
      code_couleur: r.code_couleur ?? '',
    }
  }

  /* --- Arrivee ciblee : /bons-commande/nouveau?reference=X --------------- */
  useEffect(() => {
    const code = qRefDemandee.data?.code_fournisseur
    if (code && !entete.code_fournisseur) setEntete((e) => ({ ...e, code_fournisseur: code }))
  }, [qRefDemandee.data, entete.code_fournisseur])

  useEffect(() => {
    if (dejaAmorce.current || !refDemandee) return
    const r = qPlan.data?.find((x) => x.code_reference === refDemandee)
    if (!r) return
    dejaAmorce.current = true
    setLignes((ls) => (ls.some((l) => l.code_reference === r.code_reference) ? ls : [...ls, depuisReference(r)]))
  }, [qPlan.data, refDemandee])

  /**
   * LA GRILLE S'OUVRE SUR UNE LIGNE VIDE, jamais remplie d'office.
   *
   * Le plan PROPOSE ; il ne decide pas a la place de l'acheteur. Verser ses
   * vingt-deux propositions dans le bon des l'arrivee obligeait a retirer une a
   * une celles qu'on ne voulait pas — c'est l'inverse du travail reel, ou l'on
   * ajoute ce qu'on commande. Les propositions s'affichent dans la liste
   * deroulante, des qu'on entre dans le champ.
   */
  useEffect(() => {
    if (!entete.code_fournisseur) return
    setLignes((ls) => (ls.length > 0 ? ls : [ligneVide()]))
  }, [entete.code_fournisseur])

  /* --- La liste deroulante ------------------------------------------------ */

  const dejaPrises = useMemo(
    () => new Set(lignes.map((l) => l.code_reference).filter(Boolean)),
    [lignes],
  )

  const chercher = useMemo(
    () => async (motif: string): Promise<Suggestion[]> => {
      // EN MODE PLAN on ne sort pas de ce que le MRP reclame : la liste est
      // deja en memoire, inutile d'interroger le serveur.
      if (mode === 'PLAN') {
        const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
        return proposees
          .filter((r) =>
            mots.every((m) =>
              `${r.code_reference} ${r.designation ?? ''}`.toLowerCase().includes(m),
            ),
          )
          .slice(0, 25)
          .map((r) => versSuggestion(r))
      }
      const p = new URLSearchParams({
        code_fournisseur: entete.code_fournisseur,
        toutes: '1',
        recherche: motif,
        limite: '25',
      })
      const refs = await api.get<RefCommandable[]>(`/api/references-commandables?${p}`)
      return refs.map((r) => versSuggestion(r))
    },
    [mode, proposees, entete.code_fournisseur, dejaPrises],
  )

  const versSuggestion = (r: RefCommandable): Suggestion => {
    const suggere = r.qte_a_commander_kg ?? 0
    const etranger = !!r.code_fournisseur && r.code_fournisseur !== entete.code_fournisseur
    return {
      valeur: r.code_reference,
      titre: r.code_reference,
      detail:
        [
          r.designation,
          r.stock_projete_kg != null ? `projeté ${fmt.nombre(r.stock_projete_kg, 0)} kg` : null,
          etranger ? `habituellement chez ${r.fournisseur_nom ?? r.code_fournisseur}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      mention:
        suggere > 0
          ? `plan : ${fmt.nombre(suggere, 0)} kg`
          : r.statut_stock && r.statut_stock !== 'OK'
            ? r.statut_stock
            : undefined,
      ton: suggere > 0 ? 'primaire' : r.statut_stock === 'RUPTURE' ? 'alerte' : 'neutre',
      desactivee: dejaPrises.has(r.code_reference),
      charge: r,
    }
  }

  /* --- Les lignes -------------------------------------------------------- */

  const maj = (cle: string, patch: Partial<LigneSaisie>) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))

  /**
   * CORRIGER LA FICHE DE LA REFERENCE DEPUIS LA COMMANDE.
   *
   * La reference du fournisseur, sa couleur et son code couleur appartiennent
   * a la REFERENCE, pas a la ligne de commande. Mais c'est en preparant la
   * commande qu'on s'apercoit qu'ils manquent — 23 references du catalogue
   * n'ont aucun code couleur fournisseur. Les corriger ici les ecrit la ou
   * elles ont leur place, une fois pour toutes : la commande suivante les
   * trouvera deja renseignes.
   *
   * L'ecriture part a la SORTIE du champ, pas a chaque frappe : sinon chaque
   * lettre deviendrait un enregistrement.
   */
  const corrigerReference = useMutation({
    mutationFn: ({ code, champ, valeur }: { code: string; champ: string; valeur: string }) =>
      api.patch(`/api/catalogue/${encodeURIComponent(code)}`, { [champ]: valeur }),
    onSuccess: () => {
      toast.success('Fiche de la référence corrigée')
      void qc.invalidateQueries({ queryKey: ['refs-plan'] })
    },
    onError: (e) =>
      toast.error(e instanceof ErreurApi ? e.message : 'Correction impossible.'),
  })

  /** Le poids d'une ligne de marchandise, quelle que soit l'unite saisie. */
  const kgDe = (l: LigneSaisie) =>
    l.nature === 'MARCHANDISE' ? depuisUnite(l.qte, l.unite, l.cond).kg : null

  /** Ce que la ligne coute : au kilo pour la marchandise, au forfait sinon. */
  const totalDe = (l: LigneSaisie) =>
    l.nature === 'MARCHANDISE'
      ? (kgDe(l) ?? 0) * Number(l.prix || 0)
      : Number(l.qte || 0) * Number(l.prix || 0)

  /** Les unites que la REFERENCE autorise, en plus du kilo. */
  const unitesDe = (l: LigneSaisie): string[] => {
    const u: string[] = []
    if (facteurVersKg('Bobine', l.cond)) u.push('Bobine')
    if (facteurVersKg('Palette', l.cond)) u.push('Palette')
    if (facteurVersKg('ml', l.cond)) u.push('ml')
    return u
  }

  /**
   * LES TROIS EXPRESSIONS SE REPONDENT — palettes, bobines, quantite.
   *
   * On saisit celle qu'on a en tete au moment de negocier, les deux autres
   * suivent les parametres de la reference. Detache, chacune se saisit seule :
   * un fournisseur livre parfois une palette entamee.
   */
  const majColis = (cle: string, source: 'quantite' | 'palettes' | 'bobines', valeur: string) =>
    setLignes((ls) =>
      ls.map((l) => {
        if (l.cle !== cle) return l
        if (!l.lie || l.nature !== 'MARCHANDISE') {
          const champ =
            source === 'quantite' ? 'qte' : source === 'palettes' ? 'palettes' : 'bobines'
          return { ...l, [champ]: valeur }
        }
        const r =
          source === 'palettes'
            ? depuisPalettes(valeur, l.cond)
            : source === 'bobines'
              ? depuisBobines(valeur, l.cond)
              : depuisUnite(valeur, l.unite, l.cond)
        const quantite =
          source === 'quantite'
            ? valeur
            : l.unite === 'Palette'
              ? pourChamp(r.palettes)
              : l.unite === 'Bobine'
                ? pourChamp(r.bobines)
                : (() => {
                    const f = facteurVersKg(l.unite, l.cond)
                    return r.kg !== null && f ? pourChamp(r.kg / f, 3) : l.qte
                  })()
        return {
          ...l,
          qte: quantite,
          palettes: source === 'palettes' ? valeur : pourChamp(r.palettes),
          bobines: source === 'bobines' ? valeur : pourChamp(r.bobines),
        }
      }),
    )

  /** Changer d'unite ne change pas la marchandise : seule son expression change. */
  const majUnite = (cle: string, unite: string) =>
    setLignes((ls) =>
      ls.map((l) => {
        if (l.cle !== cle) return l
        if (l.nature !== 'MARCHANDISE') return { ...l, unite }
        const kg = depuisUnite(l.qte, l.unite, l.cond).kg
        const f = facteurVersKg(unite, l.cond)
        if (!l.lie || kg === null || !f) return { ...l, unite }
        return { ...l, unite, qte: pourChamp(kg / f, unite === 'kg' ? 3 : 0) }
      }),
    )

  /* --- L'enregistrement --------------------------------------------------- */

  const pretes = lignes.filter(estPrete)
  const ebauches = lignes.filter(estEbauche)
  // Une unite que la reference ne sait pas convertir sera REFUSEE par le serveur
  // (R01, jamais de repli sur un facteur de 1). Autant le dire tout de suite.
  const sansFacteur = pretes.filter((l) => l.nature === 'MARCHANDISE' && kgDe(l) === null)
  const total = pretes.reduce((s, l) => s + totalDe(l), 0)
  const pret =
    !!entete.code_fournisseur &&
    !!entete.date_bc &&
    pretes.length > 0 &&
    ebauches.length === 0 &&
    sansFacteur.length === 0

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_bc: string; numero_bc: string; lignes: number }>('/api/bons-commande', {
        ...entete,
        lignes: pretes.map((l) =>
          l.nature === 'MARCHANDISE'
            ? {
                type_ligne: 'MARCHANDISE',
                code_reference: l.code_reference,
                unite_commande: l.unite,
                quantite_commandee_unite: Number(l.qte),
                // LE PRIX SE SAISIT AU KILO, le bon l'enregistre par unite
                // commandee. C'est au kilo que les offres se comparent ; c'est
                // par palette que le fournisseur facture.
                prix_unitaire_devise:
                  Number(l.prix) * (facteurVersKg(l.unite, l.cond) ?? 1),
              }
            : {
                type_ligne: l.nature,
                libelle: l.intitule.trim(),
                unite_commande: l.unite,
                quantite_commandee_unite: Number(l.qte),
                prix_unitaire_devise: Number(l.prix),
              },
        ),
      }),
    onSuccess: (r) => {
      toast.success(`${r.numero_bc} cree`, {
        description: `${r.lignes} ligne(s) · brouillon, rien n'est encore engage.`,
      })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
      naviguer(`/bons-commande/${r.id_bc}`)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Création impossible.'),
  })

  /* --- Rendu -------------------------------------------------------------- */

  const cellule = 'px-1.5 py-1 align-top'

  return (
    <div>
      <EnTetePage
        titre="Nouveau bon de commande"
        description="Choisissez le fournisseur : ce que le plan d'achat lui reclame s'affiche aussitot. Tapez pour ajouter une ligne."
        actions={
          <Bouton variante="contour" onClick={() => naviguer('/bons-commande')}>
            <ArrowLeft />
            Retour
          </Bouton>
        }
      />

      {erreur && (
        <Alerte ton="danger" titre="Création refusee" className="mb-3">
          {erreur}
        </Alerte>
      )}

      <div className="space-y-3">
        <Carte repliable="boncommandenouveau.1">
          <CarteEntete>
            <CarteTitre>En-tete</CarteTitre>
            {fournisseur && (
              <span className="text-[11px] text-attenue-texte">
                Devise {devise}
                {fournisseur.delai_livraison_jours != null &&
                  ` · delai annonce ${fournisseur.delai_livraison_jours} j`}
                {fournisseur.pays && ` · ${fournisseur.pays}`}
              </span>
            )}
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Etiq htmlFor="frs" obligatoire>
                Fournisseur
              </Etiq>
              <Selecteur
                id="frs"
                value={entete.code_fournisseur}
                onChange={(e) => {
                  setEntete({ ...entete, code_fournisseur: e.target.value })
                  setLignes([])
                }}
              >
                <option value="">Choisir…</option>
                {qFrs.data?.map((f) => (
                  <option key={f.code_fournisseur} value={f.code_fournisseur}>
                    {f.nom}
                  </option>
                ))}
              </Selecteur>
              <p className="mt-1 text-[11px] text-attenue-texte">
                Changer de fournisseur remet la saisie a zero : la devise et les prix en dependent.
              </p>
            </div>
            <div>
              <Etiq htmlFor="datebc" obligatoire>
                Date du bon
              </Etiq>
              <Champ
                id="datebc"
                type="date"
                value={entete.date_bc}
                onChange={(e) => setEntete({ ...entete, date_bc: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="livr">Livraison prévue</Etiq>
              <Champ
                id="livr"
                type="date"
                value={entete.date_livraison_prevue}
                onChange={(e) => setEntete({ ...entete, date_livraison_prevue: e.target.value })}
              />
            </div>
            <div className="lg:col-span-2">
              <Etiq htmlFor="notes">Observations</Etiq>
              <Champ
                id="notes"
                value={entete.notes}
                onChange={(e) => setEntete({ ...entete, notes: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="motif">Motif</Etiq>
              <Selecteur
                id="motif"
                value={entete.motif_creation}
                onChange={(e) => setEntete({ ...entete, motif_creation: e.target.value })}
              >
                <option value="MRP">Issu du MRP</option>
                <option value="MANUEL">Manuel</option>
                <option value="OPPORTUNITE_PRIX">Opportunite de prix</option>
                <option value="ANTICIPATION_RISQUE">Anticipation de risque</option>
              </Selecteur>
            </div>
          </CarteCorps>
        </Carte>

        {!entete.code_fournisseur && (
          <Alerte ton="info">
            Choisissez un fournisseur : ce que le plan d'achat lui reclame s'affichera ici, avec la
            quantite proposee et le prix.
          </Alerte>
        )}

        {entete.code_fournisseur && (
          <Carte repliable="boncommandenouveau.2">
            <CarteEntete>
              <CarteTitre>Lignes du bon</CarteTitre>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-attenue-texte">
                  {qPlan.isLoading
                    ? 'lecture du plan…'
                    : `${proposees.length} proposition(s) du plan`}
                </span>
                {/* L'INTERRUPTEUR : ce que la liste deroulante propose. */}
                <div className="flex overflow-hidden rounded-[var(--radius)] border border-bordure">
                  {(
                    [
                      ['PLAN', 'Du plan d’achat'],
                      ['CATALOGUE', 'Tout le catalogue'],
                    ] as const
                  ).map(([m, libelle]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        'px-2.5 py-1 text-[12px]',
                        mode === m
                          ? 'bg-primaire/10 font-medium text-primaire'
                          : 'text-attenue-texte hover:bg-attenue/50',
                      )}
                    >
                      {libelle}
                    </button>
                  ))}
                </div>
              </div>
            </CarteEntete>
            <CarteCorps className="space-y-3">
              {qPlan.isLoading && <Chargement texte="Lecture du plan d'achat…" />}

              {/* ---- La grille ------------------------------------------- */}
              {lignes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-[13px]">
                    <thead>
                      <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                        <th className="w-8 px-1 py-2 text-right">#</th>
                        <th className="px-1.5 py-2 text-left" title="Le code interne de la maison">
                          Notre référence
                        </th>
                        <th className="w-28 px-1.5 py-2 text-right">Quantité</th>
                        <th className="w-32 px-1.5 py-2 text-left" title="Le code que le fournisseur emploie, tel qu'il figure sur sa facture">
                          Réf. frs
                        </th>
                        <th className="w-28 px-1.5 py-2 text-left">Couleur</th>
                        <th className="w-28 px-1.5 py-2 text-left" title="Le code que CE fournisseur donne a cette couleur">
                          Code coul. frs
                        </th>
                        <th className="w-24 px-1.5 py-2 text-left">Unité</th>
                        <th className="w-36 px-1.5 py-2 text-center">Pal. / Bob.</th>
                        <th className="w-28 px-1.5 py-2 text-right">Prix {devise}</th>
                        <th className="w-28 px-1.5 py-2 text-right">Total</th>
                        <th className="w-8 px-1 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l, i) => {
                        const kg = kgDe(l)
                        const marchandise = l.nature === 'MARCHANDISE'
                        const ecart =
                          l.suggere_kg && kg != null ? kg - l.suggere_kg : null
                        return (
                          <tr key={l.cle} className="border-b border-bordure/60">
                            <td className="px-1 py-1 text-right tabular-nums text-attenue-texte">
                              {i + 1}
                            </td>
                            {/* LA LISTE DEROULANTE EST DANS LA LIGNE, a la place
                                meme de la reference. C'est la qu'on la cherche :
                                un champ d'ajout pose ailleurs oblige a faire un
                                aller-retour pour chaque article. */}
                            <td className={cn(cellule, 'min-w-0')}>
                              {l.code_reference || (l.nature !== 'MARCHANDISE' && l.intitule) ? (
                                <>
                                  <div className="flex items-start gap-1.5">
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-medium">
                                        {l.code_reference || l.intitule}
                                      </div>
                                      <div className="truncate text-[11px] text-attenue-texte">
                                        {marchandise ? (
                                          <>
                                            {/* LA DESIGNATION NE SE REPETE PAS.
                                                Dans ce catalogue elle est le
                                                plus souvent IDENTIQUE au code :
                                                l'afficher dessous montrait deux
                                                fois la meme chaine, juste a cote
                                                des codes du fournisseur — on ne
                                                savait plus lequel etait lequel. */}
                                            {l.intitule !== l.code_reference && (
                                              <span>{l.intitule} · </span>
                                            )}
                                            <span>notre code</span>
                                            {l.fournisseur_habituel &&
                                              l.fournisseur_habituel !==
                                                entete.code_fournisseur && (
                                                <span className="text-alerte">
                                                  {' '}
                                                  · habituellement chez {l.fournisseur_habituel}
                                                </span>
                                              )}
                                          </>
                                        ) : (
                                          <Badge ton="alerte">hors catalogue</Badge>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        maj(l.cle, {
                                          nature: 'MARCHANDISE',
                                          code_reference: '',
                                          intitule: '',
                                          cond: {},
                                          suggere_kg: null,
                                        })
                                      }
                                      className="shrink-0 pt-0.5 text-[11px] text-attenue-texte underline hover:text-texte"
                                      aria-label="Changer la référence"
                                    >
                                      changer
                                    </button>
                                  </div>
                                  {ecart != null && Math.abs(ecart) > 0.5 && (
                                    <div className="text-[11px] text-alerte">
                                      {ecart > 0 ? '+' : ''}
                                      {fmt.nombre(ecart, 0)} kg par rapport au plan
                                    </div>
                                  )}
                                </>
                              ) : (
                                <ChampRecherche
                                  valeur=""
                                  chercher={chercher}
                                  cleCache={[mode, entete.code_fournisseur, dejaPrises.size]}
                                  chercherAVide
                                  surChoix={(s) =>
                                    maj(l.cle, depuisReference(s.charge as RefCommandable, l.cle))
                                  }
                                  placeholder={
                                    mode === 'PLAN'
                                      ? 'Référence — le plan propose…'
                                      : 'Référence — tout le catalogue…'
                                  }
                                  aide="Flèches pour parcourir, Entrée pour retenir."
                                  ariaLabel="Référence de la ligne"
                                  surAucun={(motif) => (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {mode === 'PLAN' && (
                                        <Bouton
                                          variante="contour"
                                          taille="sm"
                                          onClick={() => setMode('CATALOGUE')}
                                        >
                                          Chercher dans tout le catalogue
                                        </Bouton>
                                      )}
                                      <Bouton
                                        variante="contour"
                                        taille="sm"
                                        onClick={() => setACreer(motif)}
                                      >
                                        <Plus />
                                        Ajouter au catalogue
                                      </Bouton>
                                      <Bouton
                                        variante="contour"
                                        taille="sm"
                                        onClick={() =>
                                          maj(l.cle, {
                                            nature: 'LIBRE',
                                            intitule: motif,
                                            unite: 'Forfait',
                                            qte: '1',
                                          })
                                        }
                                      >
                                        Garder « {motif} » sans référence
                                      </Bouton>
                                    </div>
                                  )}
                                />
                              )}
                            </td>
                            <td className={cellule}>
                              <Champ
                                type="number"
                                step="any"
                                min="0.0001"
                                value={l.qte}
                                onChange={(e) => majColis(l.cle, 'quantite', e.target.value)}
                                className="h-8 text-right tabular-nums"
                                aria-label="Quantité"
                              />
                              {marchandise && l.unite !== 'kg' && (
                                <div className="mt-0.5 text-right text-[11px] tabular-nums text-attenue-texte">
                                  {kg === null ? (
                                    <span className="text-danger">non convertible</span>
                                  ) : (
                                    <>= {fmt.nombre(kg, 0)} kg</>
                                  )}
                                </div>
                              )}
                            </td>
                            {/* CE QUE LE FOURNISSEUR RECONNAIT. Modifiable :
                                la correction remonte a la fiche de la
                                reference, la ou l'information a sa place. */}
                            {(['reference_fournisseur', 'couleur', 'code_couleur'] as const).map(
                              (champ) => (
                                <td className={cellule} key={champ}>
                                  {marchandise ? (
                                    <Champ
                                      value={l[champ]}
                                      onChange={(e) => maj(l.cle, { [champ]: e.target.value })}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim()
                                        const initial =
                                          (parPlan.get(l.code_reference)?.[champ] as string) ?? ''
                                        if (v !== initial && l.code_reference) {
                                          corrigerReference.mutate({
                                            code: l.code_reference,
                                            champ,
                                            valeur: v,
                                          })
                                        }
                                      }}
                                      className="h-8"
                                      placeholder={
                                        champ === 'reference_fournisseur'
                                          ? 'Ssl2279'
                                          : champ === 'couleur'
                                            ? 'Cream'
                                            : 'RED 7612'
                                      }
                                      aria-label={
                                        champ === 'reference_fournisseur'
                                          ? 'Référence chez le fournisseur'
                                          : champ === 'couleur'
                                            ? 'Couleur'
                                            : 'Code couleur du fournisseur'
                                      }
                                    />
                                  ) : (
                                    <span className="block text-center text-[11px] text-attenue-texte">
                                      —
                                    </span>
                                  )}
                                </td>
                              ),
                            )}
                            <td className={cellule}>
                              <Selecteur
                                value={l.unite}
                                onChange={(e) => majUnite(l.cle, e.target.value)}
                                className="h-8"
                                aria-label="Unité"
                              >
                                {marchandise ? (
                                  <>
                                    <option value="kg">kg</option>
                                    {unitesDe(l).map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </>
                                ) : (
                                  UNITES_LIBRES.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))
                                )}
                              </Selecteur>
                            </td>
                            <td className={cellule}>
                              {marchandise ? (
                                <div className="flex items-center gap-1">
                                  <Champ
                                    type="number"
                                    min="0"
                                    value={l.palettes}
                                    onChange={(e) => majColis(l.cle, 'palettes', e.target.value)}
                                    className="h-8 w-14 text-right tabular-nums"
                                    placeholder="pal."
                                    aria-label="Nombre de palettes"
                                  />
                                  <Champ
                                    type="number"
                                    min="0"
                                    value={l.bobines}
                                    onChange={(e) => majColis(l.cle, 'bobines', e.target.value)}
                                    className="h-8 w-16 text-right tabular-nums"
                                    placeholder="bob."
                                    aria-label="Nombre de bobines"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => maj(l.cle, { lie: !l.lie })}
                                    title={
                                      l.lie
                                        ? 'Les trois se repondent — cliquez pour saisir chacun separement'
                                        : 'Calcul detache — cliquez pour relier les trois'
                                    }
                                    aria-label={l.lie ? 'Détacher le calcul' : 'Relier le calcul'}
                                    className={cn(
                                      'shrink-0 rounded-[var(--radius)] p-1',
                                      l.lie
                                        ? 'text-primaire hover:bg-primaire/10'
                                        : 'text-alerte hover:bg-alerte/10',
                                    )}
                                  >
                                    {l.lie ? (
                                      <Link2 className="size-3.5" />
                                    ) : (
                                      <Unlink2 className="size-3.5" />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <span className="block text-center text-[11px] text-attenue-texte">
                                  —
                                </span>
                              )}
                            </td>
                            <td className={cellule}>
                              <Champ
                                type="number"
                                step="any"
                                min="0.0001"
                                value={l.prix}
                                onChange={(e) => maj(l.cle, { prix: e.target.value })}
                                className={cn(
                                  'h-8 text-right tabular-nums',
                                  !(Number(l.prix) > 0) && estEbauche(l) && 'border-danger',
                                )}
                                aria-label={marchandise ? `Prix ${devise} par kg` : `Prix ${devise}`}
                              />
                              {marchandise && (
                                <div className="mt-0.5 text-right text-[11px] text-attenue-texte">
                                  par kg
                                </div>
                              )}
                            </td>
                            <td className={cn(cellule, 'pt-2 text-right font-medium tabular-nums')}>
                              {fmt.nombre(totalDe(l), 2)}
                            </td>
                            <td className="px-1 py-1">
                              <Bouton
                                variante="discret"
                                taille="icone-xs"
                                className="text-danger hover:bg-danger/10"
                                aria-label="Retirer la ligne"
                                onClick={() =>
                                  setLignes((ls) => ls.filter((x) => x.cle !== l.cle))
                                }
                              >
                                <Trash2 />
                              </Bouton>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* UNE LIGNE DE PLUS, et rien d'autre. Ce qu'on commande se
                  designe DANS la ligne, pas dans un champ pose a cote. */}
              <div className="flex flex-wrap items-center gap-2">
                <Bouton
                  variante="contour"
                  taille="sm"
                  onClick={() => setLignes((ls) => [...ls, ligneVide()])}
                >
                  <Plus />
                  Ajouter une ligne
                </Bouton>
                <span className="text-[11px] text-attenue-texte">
                  {mode === 'PLAN'
                    ? 'La liste propose ce que le plan d’achat réclame chez ce fournisseur.'
                    : 'La liste propose tout le catalogue — le rattachement à un fournisseur est une habitude d’achat, pas une exclusivité.'}
                </span>
              </div>

              {aCreer && (
                <Alerte ton="info" titre="Créer une référence au catalogue">
                  La fiche complète — code, désignation, catégorie, unité, conditionnement, prix —
                  se saisit à l’écran Catalogue. Ouvrez-le dans un autre onglet, créez la
                  référence, puis revenez ici : elle sera trouvée à la frappe.
                  <div className="mt-2 flex gap-2">
                    <Bouton
                      variante="contour"
                      taille="sm"
                      onClick={() => window.open('/catalogue', '_blank')}
                    >
                      Ouvrir le catalogue
                    </Bouton>
                    <Bouton variante="discret" taille="sm" onClick={() => setACreer(null)}>
                      Fermer
                    </Bouton>
                  </div>
                </Alerte>
              )}
            </CarteCorps>
          </Carte>
        )}
      </div>

      {entete.code_fournisseur && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            {pretes.length === 0 ? (
              <span className="text-attenue-texte">Aucune ligne saisie.</span>
            ) : (
              <>
                <span className="font-medium">{pretes.length} ligne(s)</span>
                <span className="text-attenue-texte"> · total </span>
                <span className="font-semibold tabular-nums">
                  {fmt.nombre(total, 2)} {devise}
                </span>
                {sansFacteur.length > 0 ? (
                  <span className="text-danger">
                    {' '}
                    — conversion impossible sur{' '}
                    {sansFacteur.map((l) => l.code_reference).join(', ')} : renseignez le
                    conditionnement sur la référence, ou commandez en kg
                  </span>
                ) : (
                  ebauches.length > 0 && (
                    <span className="text-danger">
                      {' '}
                      — {ebauches.length} ligne(s) incomplète(s) : intitulé, quantité ou prix
                    </span>
                  )
                )}
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={() => naviguer('/bons-commande')}>
              Annuler
            </Bouton>
            <Bouton
              onClick={() => {
                setErreur(null)
                creer.mutate()
              }}
              chargement={creer.isPending}
              disabled={!pret || !droits.peutEcrire}
            >
              <Save />
              Creer le bon
            </Bouton>
          </div>
        </div>
      )}
    </div>
  )
}

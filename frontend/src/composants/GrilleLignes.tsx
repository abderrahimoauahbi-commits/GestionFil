/**
 * La grille de saisie des lignes — UNE SEULE, pour tous les documents.
 *
 * POURQUOI ELLE EXISTE. Chaque famille de document avait deux saisies : celle
 * de l'ecran « nouveau », riche — reference cherchee dans la ligne, unite selon
 * le conditionnement, palettes et bobines qui se repondent, codes du
 * fournisseur — et celle de l'ecran de modification, pauvre : une liste a
 * cocher, une quantite, un prix, et l'unite FIGEE EN KILOS. Ajouter une ligne
 * apres coup ne donnait donc pas le meme resultat que l'avoir saisie d'emblee.
 * Deux saisies pour un meme article, c'est une de trop.
 *
 * CE QU'ELLE PORTE, ET QUE L'ANCIENNE SAISIE PAR LISTE N'AVAIT PAS :
 *
 *   LE CHOIX DE LA SOURCE. « Du plan d'achat » — ce que le MRP reclame chez ce
 *   fournisseur — ou « tout le catalogue », quand on achete pour un prix, un
 *   delai, une anticipation. La liste a cocher n'offrait que l'un des deux.
 *
 *   L'UNITE EN PREMIER. Elle est le premier champ apres la reference, parce
 *   qu'elle donne leur sens aux deux suivants : saisir une quantite avant de
 *   dire de quoi, c'est saisir un nombre sans unite.
 *
 *   LE PRIX A QUATRE DECIMALES. La base les stocke (numeric(18,4)) ; les
 *   arrondir a l'ecran faisait disparaitre le quatrieme chiffre d'un prix
 *   negocie au millieme.
 */
import type { Dispatch, SetStateAction } from 'react'
import { Link2, Plus, Trash2, Unlink2 } from 'lucide-react'
import { Badge, Bouton, Champ, Selecteur } from './ui/base'
import { ChampRecherche, type Suggestion } from './ChampRecherche'
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

/**
 * LA NATURE D'UNE LIGNE, et ce qu'elle implique jusqu'au quai.
 *
 * MARCHANDISE : une reference du catalogue. Elle se convertit en kilos, se pese
 * a la reception, entre en stock et pese sur le cout de revient.
 *
 * LIBRE : de la marchandise SANS reference — echantillon, type nouveau. Elle se
 * commande et se constate, mais n'entre jamais en stock : aucune reference sous
 * laquelle la ranger, donc aucun CMUP a alimenter.
 *
 * SERVICE : ce qui n'est pas de la marchandise — fret, commission, montage.
 */
export type Nature = 'MARCHANDISE' | 'LIBRE' | 'SERVICE'

/** Les unites d'une ligne sans reference : rien ne s'y pese. */
export const UNITES_LIBRES = ['Forfait', 'Unite', 'Heure'] as const

/** Le prix se saisit et s'affiche au millieme pres. */
export const DECIMALES_PRIX = 4

export interface RefLigne extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  code_fournisseur?: string | null
  fournisseur_nom?: string | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  bobines_par_lot?: number | null
  densite_kg_ml?: number | null
  reference_fournisseur?: string | null
  couleur?: string | null
  code_couleur?: string | null
  stock_projete_kg?: number | null
  statut_stock?: string | null
  qte_a_commander_kg?: number | null
  prix_suggere_devise?: number
}

export interface LigneSaisie {
  cle: string
  /**
   * L'identifiant de la ligne DEJA ENREGISTREE, quand il y en a un.
   *
   * C'est lui qui distingue une correction d'un ajout : presente, la ligne se
   * met a jour ; absente, elle se cree. Sans cette distinction, modifier une
   * reference deja saisie creerait un doublon et laisserait l'ancienne en
   * place.
   */
  idExistant?: string
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
  reference_fournisseur: string
  couleur: string
  code_couleur: string
}

let compteur = 0

/** Une ligne neuve, en attente de ce qu'on va taper dedans. */
export function ligneVide(): LigneSaisie {
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

/**
 * Une ligne DEJA ENREGISTREE, ramenee dans la grille de saisie.
 *
 * POURQUOI ELLE Y REVIENT ENTIERE. Les lignes existantes ne se corrigeaient
 * qu'au travers de deux cellules editables — quantite et prix. Changer la
 * reference, l'unite, le nombre de palettes ou un code fournisseur etait
 * impossible : il fallait supprimer la ligne et la ressaisir. Une correction
 * ne devrait jamais couter plus cher que la saisie initiale.
 *
 * LE PRIX REDEVIENT UN PRIX AU KILO. Il est enregistre par unite commandee ;
 * la grille le montre au kilo, comme a la saisie. Sans cette division, ouvrir
 * une ligne en palettes afficherait un prix cent fois trop grand.
 */
export function depuisLigneEnregistree(
  l: {
    id_ligne_bc: string
    type_ligne?: string
    code_reference: string | null
    libelle?: string | null
    reference_designation: string
    unite_commande: string
    quantite_commandee_unite: number
    prix_unitaire_devise?: number
    couleur?: string | null
    poids_bobine_kg?: number | null
    bobines_par_palette?: number | null
    /* Le colisage TEL QU'IL A ETE SAISI. Present, il prime sur le calcul :
       c'est le sens meme de l'avoir enregistre. */
    nb_palettes?: number | null
    nb_bobines?: number | null
  },
  fiche?: RefLigne,
): LigneSaisie {
  const cond: Conditionnement = fiche
    ? condDe(fiche)
    : {
        poids_bobine_kg: l.poids_bobine_kg,
        bobines_par_palette: l.bobines_par_palette,
      }
  const marchandise = (l.type_ligne ?? 'MARCHANDISE') === 'MARCHANDISE' && !!l.code_reference
  const f = facteurVersKg(l.unite_commande, cond) ?? 1
  const colis = depuisUnite(String(l.quantite_commandee_unite), l.unite_commande, cond)
  return {
    cle: l.id_ligne_bc,
    idExistant: l.id_ligne_bc,
    nature: marchandise ? 'MARCHANDISE' : ((l.type_ligne as Nature) ?? 'LIBRE'),
    code_reference: l.code_reference ?? '',
    intitule: l.libelle ?? l.reference_designation ?? l.code_reference ?? '',
    cond,
    unite_catalogue: fiche?.unite_catalogue ?? 'kg',
    fournisseur_habituel: fiche?.code_fournisseur ?? null,
    suggere_kg: null,
    qte: String(l.quantite_commandee_unite),
    unite: l.unite_commande,
    palettes: l.nb_palettes != null ? String(l.nb_palettes) : pourChamp(colis.palettes),
    bobines: l.nb_bobines != null ? String(l.nb_bobines) : pourChamp(colis.bobines),
    // DETACHE DES QU'UN COLISAGE A ETE ENREGISTRE : le relier d'office
    // recalculerait les deux autres champs et effacerait ce qu'on avait
    // constate, a la premiere frappe.
    lie: l.nb_palettes == null && l.nb_bobines == null,
    prix:
      l.prix_unitaire_devise == null
        ? ''
        : String(Number((l.prix_unitaire_devise / (marchandise ? f : 1)).toFixed(DECIMALES_PRIX))),
    reference_fournisseur: fiche?.reference_fournisseur ?? '',
    couleur: l.couleur ?? fiche?.couleur ?? '',
    code_couleur: fiche?.code_couleur ?? '',
  }
}

export const condDe = (r: RefLigne): Conditionnement => ({
  poids_bobine_kg: r.poids_bobine_kg,
  bobines_par_palette: r.bobines_par_palette,
  bobines_par_lot: r.bobines_par_lot,
  densite_kg_ml: r.densite_kg_ml,
})

/**
 * L'UNITE DANS LAQUELLE ON COMMANDE, et non celle dans laquelle on stocke.
 *
 * On prend la PLUS GROSSE unite que la reference sait exprimer : le lot s'il
 * porte son bain, sinon la palette, sinon la bobine, le kilo en dernier
 * recours. Le fournisseur turc ne produit pas 8 601,6 kg : il produit deux
 * bains de 1344 bobines.
 */
export const uniteDeCommande = (c: Conditionnement): string => {
  if (facteurVersKg('Lot', c)) return 'Lot'
  if (facteurVersKg('Palette', c)) return 'Palette'
  if (facteurVersKg('Bobine', c)) return 'Bobine'
  return 'kg'
}

/** Les unites que la REFERENCE autorise, en plus du kilo. */
export const unitesDe = (l: LigneSaisie): string[] => {
  const u: string[] = []
  if (facteurVersKg('Bobine', l.cond)) u.push('Bobine')
  if (facteurVersKg('Palette', l.cond)) u.push('Palette')
  if (facteurVersKg('Lot', l.cond)) u.push('Lot')
  if (facteurVersKg('ml', l.cond)) u.push('ml')
  return u
}

/** Une reference retenue remplit la ligne. */
export function depuisReference(r: RefLigne, cle?: string): LigneSaisie {
  const c = condDe(r)
  const kg = r.qte_a_commander_kg ?? 0
  const colis = depuisKg(kg, c)
  const unite = uniteDeCommande(c)
  const f = facteurVersKg(unite, c)
  const qte = kg > 0 && f ? kg / f : kg
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
    qte: qte > 0 ? String(Number(qte.toFixed(unite === 'kg' ? 2 : 3))) : '',
    unite,
    palettes: pourChamp(colis.palettes),
    bobines: pourChamp(colis.bobines),
    lie: true,
    // LE PRIX N'EST PAS ARRONDI A L'ENTREE. Un prix negocie au millieme
    // perdrait son dernier chiffre avant meme d'avoir ete relu.
    prix: r.prix_suggere_devise != null ? String(r.prix_suggere_devise) : '',
    reference_fournisseur: r.reference_fournisseur ?? '',
    couleur: r.couleur ?? '',
    code_couleur: r.code_couleur ?? '',
  }
}

/** Le poids d'une ligne de marchandise, quelle que soit l'unite saisie. */
export const kgDe = (l: LigneSaisie) =>
  l.nature === 'MARCHANDISE' ? depuisUnite(l.qte, l.unite, l.cond).kg : null

/** Ce que la ligne coute : au kilo pour la marchandise, au forfait sinon. */
export const totalDe = (l: LigneSaisie) =>
  l.nature === 'MARCHANDISE'
    ? (kgDe(l) ?? 0) * Number(l.prix || 0)
    : Number(l.qte || 0) * Number(l.prix || 0)

/** Une ligne part au serveur quand elle porte de quoi etre comprise. */
export const estPrete = (l: LigneSaisie) =>
  Number(l.qte) > 0 &&
  Number(l.prix) > 0 &&
  (l.nature === 'MARCHANDISE' ? !!l.code_reference : !!l.intitule.trim())

/** Une ligne commencee mais incomplete : elle bloque l'enregistrement. */
export const estEbauche = (l: LigneSaisie) =>
  !estPrete(l) && (!!l.code_reference || !!l.intitule.trim() || Number(l.prix) > 0)

/**
 * Le corps que le serveur attend, pour UNE ligne.
 *
 * LE PRIX SE SAISIT AU KILO, le document l'enregistre par unite commandee :
 * c'est au kilo que les offres se comparent, c'est par palette que le
 * fournisseur facture. La conversion se fait ICI, au seul endroit ou les deux
 * ecrans peuvent etre d'accord.
 */
export function corpsLigne(l: LigneSaisie) {
  /* LES TROIS EXPRESSIONS PARTENT TOUTES, liees ou detachees.
     Quantite, palettes et bobines disent la meme marchandise de trois facons.
     Seule la quantite partait : les deux autres etaient recalculees a la
     lecture, et le detachement — celui qui sert a declarer une palette
     entamee — ne survivait donc pas au rechargement. */
  const nombre = (v: string, arrondi: boolean) => {
    const n = Number(v)
    if (v.trim() === '' || !Number.isFinite(n) || n < 0) return null
    // UNE BOBINE NE SE COUPE PAS ; une palette s'entame. D'ou l'arrondi sur
    // l'une et deux decimales sur l'autre : le calcul rend 21,64 palettes pour
    // 22 638 kg, et l'arrondir changerait un chiffre que l'ecran affiche.
    return arrondi ? Math.round(n) : Number(n.toFixed(2))
  }
  return l.nature === 'MARCHANDISE'
    ? {
        type_ligne: 'MARCHANDISE',
        code_reference: l.code_reference,
        unite_commande: l.unite,
        quantite_commandee_unite: Number(l.qte),
        nb_palettes: nombre(l.palettes, false),
        nb_bobines: nombre(l.bobines, true),
        prix_unitaire_devise: Number(
          (Number(l.prix) * (facteurVersKg(l.unite, l.cond) ?? 1)).toFixed(DECIMALES_PRIX),
        ),
      }
    : {
        type_ligne: l.nature,
        libelle: l.intitule.trim(),
        unite_commande: l.unite,
        quantite_commandee_unite: Number(l.qte),
        prix_unitaire_devise: Number(Number(l.prix).toFixed(DECIMALES_PRIX)),
      }
}

const cellule = 'px-1.5 py-1 align-top'

export interface ProprietesGrille {
  codeFournisseur: string
  devise: string
  lignes: LigneSaisie[]
  setLignes: Dispatch<SetStateAction<LigneSaisie[]>>
  /** Ou la frappe va chercher : le plan, ou tout le catalogue. */
  mode: 'PLAN' | 'CATALOGUE'
  setMode: (m: 'PLAN' | 'CATALOGUE') => void
  /** Ce que le plan reclame chez ce fournisseur, deja en memoire. */
  proposees: RefLigne[]
  /** La recherche au catalogue, quand on sort du plan. */
  chercherCatalogue: (motif: string) => Promise<RefLigne[]>
  /** Les references deja posees ailleurs sur le document. */
  dejaPrises?: Set<string>
  /** Corriger la fiche de la reference depuis la commande. */
  surCorrection?: (code: string, champ: string, valeur: string) => void
  /** La valeur d'origine d'un champ fournisseur, pour ne remonter que le change. */
  valeurOrigine?: (code: string, champ: string) => string
  surCreerReference?: (motif: string) => void
  modifiable?: boolean
}

export function GrilleLignes({
  codeFournisseur,
  devise,
  lignes,
  setLignes,
  mode,
  setMode,
  proposees,
  chercherCatalogue,
  dejaPrises,
  surCorrection,
  valeurOrigine,
  surCreerReference,
  modifiable = true,
}: ProprietesGrille) {
  const prises = dejaPrises ?? new Set(lignes.map((l) => l.code_reference).filter(Boolean))

  const maj = (cle: string, patch: Partial<LigneSaisie>) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))

  /**
   * LES TROIS EXPRESSIONS SE REPONDENT — palettes, bobines, quantite. On saisit
   * celle qu'on a en tete au moment de negocier. Detache, chacune se saisit
   * seule : un fournisseur livre parfois une palette entamee.
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

  const versSuggestion = (r: RefLigne): Suggestion => {
    const suggere = r.qte_a_commander_kg ?? 0
    const etranger = !!r.code_fournisseur && r.code_fournisseur !== codeFournisseur
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
      desactivee: prises.has(r.code_reference),
      charge: r,
    }
  }

  const chercher = async (motif: string): Promise<Suggestion[]> => {
    // EN MODE PLAN on ne sort pas de ce que le MRP reclame : la liste est deja
    // en memoire, inutile d'interroger le serveur.
    if (mode === 'PLAN') {
      const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
      return proposees
        .filter((r) =>
          mots.every((m) => `${r.code_reference} ${r.designation ?? ''}`.toLowerCase().includes(m)),
        )
        .slice(0, 25)
        .map(versSuggestion)
    }
    return (await chercherCatalogue(motif)).map(versSuggestion)
  }

  return (
    <div className="space-y-3">
      {/* L'INTERRUPTEUR : ce que la liste deroulante propose. Il manquait
          entierement a l'ecran de modification, ou l'on ne pouvait ajouter que
          des references du fournisseur, sans jamais voir ce que le plan
          reclamait ni sortir vers le reste du catalogue. */}
      <div className="flex flex-wrap items-center gap-2">
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
        <span className="text-[11px] text-attenue-texte">
          {proposees.length} proposition(s) du plan
        </span>
      </div>

      {lignes.length > 0 && (
        <div className="overflow-x-auto">
          {/* LES COLONNES DES NOMBRES SONT LARGES. Elles faisaient 7 rem : une
              quantite de six chiffres y arrivait tronquee, et un prix a quatre
              decimales n'y tenait pas du tout. */}
          <table className="w-full min-w-[1180px] text-[13px]">
            <thead>
              <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                <th className="w-8 px-1 py-2 text-right">#</th>
                <th className="px-1.5 py-2 text-left">Notre référence</th>
                {/* L'UNITE AVANT LA QUANTITE : elle donne son sens au nombre. */}
                <th className="w-28 px-1.5 py-2 text-left">Unité</th>
                <th className="w-36 px-1.5 py-2 text-right">Quantité</th>
                <th className="w-40 px-1.5 py-2 text-center">Pal. / Bob.</th>
                <th className="w-36 px-1.5 py-2 text-right">Prix {devise}</th>
                <th className="w-36 px-1.5 py-2 text-right">Total</th>
                <th className="w-32 px-1.5 py-2 text-left">Réf. frs</th>
                <th className="w-28 px-1.5 py-2 text-left">Couleur</th>
                <th className="w-28 px-1.5 py-2 text-left">Code coul. frs</th>
                <th className="w-8 px-1 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const kg = kgDe(l)
                const marchandise = l.nature === 'MARCHANDISE'
                const ecart = l.suggere_kg && kg != null ? kg - l.suggere_kg : null
                return (
                  <tr key={l.cle} className="border-b border-bordure/60">
                    <td className="px-1 py-1 text-right tabular-nums text-attenue-texte">{i + 1}</td>

                    {/* LA LISTE DEROULANTE EST DANS LA LIGNE, a la place meme de
                        la reference : un champ d'ajout pose ailleurs oblige a un
                        aller-retour par article. */}
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
                                    {l.intitule !== l.code_reference && <span>{l.intitule} · </span>}
                                    <span>notre code</span>
                                    {l.fournisseur_habituel &&
                                      l.fournisseur_habituel !== codeFournisseur && (
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
                            {modifiable && (
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
                            )}
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
                          cleCache={[mode, codeFournisseur, prises.size]}
                          chercherAVide
                          surChoix={(s) => maj(l.cle, depuisReference(s.charge as RefLigne, l.cle))}
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
                              {surCreerReference && (
                                <Bouton
                                  variante="contour"
                                  taille="sm"
                                  onClick={() => surCreerReference(motif)}
                                >
                                  <Plus />
                                  Ajouter au catalogue
                                </Bouton>
                              )}
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
                      <Selecteur
                        value={l.unite}
                        onChange={(e) => majUnite(l.cle, e.target.value)}
                        className="h-9"
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
                      <Champ
                        type="number"
                        step="any"
                        min="0.0001"
                        value={l.qte}
                        onChange={(e) => majColis(l.cle, 'quantite', e.target.value)}
                        className="h-9 text-right text-[14px] tabular-nums"
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

                    <td className={cellule}>
                      {marchandise ? (
                        <div className="flex items-center gap-1">
                          <Champ
                            type="number"
                            min="0"
                            value={l.palettes}
                            onChange={(e) => majColis(l.cle, 'palettes', e.target.value)}
                            className="h-9 w-20 text-right tabular-nums"
                            placeholder="pal."
                            aria-label="Nombre de palettes"
                          />
                          <Champ
                            type="number"
                            min="0"
                            value={l.bobines}
                            onChange={(e) => majColis(l.cle, 'bobines', e.target.value)}
                            className="h-9 w-20 text-right tabular-nums"
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
                            {l.lie ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <span className="block text-center text-[11px] text-attenue-texte">—</span>
                      )}
                    </td>

                    <td className={cellule}>
                      <Champ
                        type="number"
                        // `any` ET NON `0.01` : la base garde quatre decimales,
                        // un pas au centime interdirait de les saisir.
                        step="any"
                        min="0.0001"
                        value={l.prix}
                        onChange={(e) => maj(l.cle, { prix: e.target.value })}
                        className={cn(
                          'h-9 text-right text-[14px] tabular-nums',
                          !(Number(l.prix) > 0) && estEbauche(l) && 'border-danger',
                        )}
                        aria-label={marchandise ? `Prix ${devise} par kg` : `Prix ${devise}`}
                      />
                      {marchandise && (
                        <div className="mt-0.5 text-right text-[11px] text-attenue-texte">par kg</div>
                      )}
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right font-medium tabular-nums')}>
                      {fmt.nombre(totalDe(l), 2)}
                    </td>

                    {/* CE QUE LE FOURNISSEUR RECONNAIT. La correction remonte a
                        la fiche de la reference, la ou l'information a sa place. */}
                    {(['reference_fournisseur', 'couleur', 'code_couleur'] as const).map((champ) => (
                      <td className={cellule} key={champ}>
                        {marchandise ? (
                          <Champ
                            value={l[champ]}
                            onChange={(e) => maj(l.cle, { [champ]: e.target.value })}
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              const initial = valeurOrigine?.(l.code_reference, champ) ?? ''
                              if (v !== initial && l.code_reference && surCorrection) {
                                surCorrection(l.code_reference, champ, v)
                              }
                            }}
                            className="h-9"
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
                          <span className="block text-center text-[11px] text-attenue-texte">—</span>
                        )}
                      </td>
                    ))}

                    <td className="px-1 py-1">
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className="text-danger hover:bg-danger/10"
                        aria-label="Retirer la ligne"
                        onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))}
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

      <div className="flex flex-wrap items-center gap-2">
        <Bouton
          variante="contour"
          taille="sm"
          onClick={() => setLignes((ls) => [...ls, ligneVide()])}
          disabled={!modifiable}
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
    </div>
  )
}

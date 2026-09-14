/**
 * Nouveau bon de commande — en-tete ET lignes saisis ensemble.
 *
 * Le fournisseur choisi, l'ecran affiche immediatement ce qu'il faut lui
 * commander : les references issues du plan d'achat qui ne sont pas deja dans
 * un bon, avec pour chacune la quantite proposee, le besoin, le risque,
 * l'importance, le prix, le delai et l'urgence.
 *
 * Tout part en UNE transaction. Un bon a moitie cree — numero attribue, aucune
 * ligne — serait un document fantome que personne ne saurait interpreter, et
 * qui fausserait la numerotation autant que les etats.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Link2, Plus, Save, Search, Trash2, Unlink2 } from 'lucide-react'
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

/** Conditionnement neutre : aucune conversion n'est possible, et on le dit. */
const SANS_CONDITIONNEMENT: Conditionnement = {}

/**
 * CE QU'ON COMMANDE, dans l'unite ou on le commande.
 *
 * Le fournisseur facture au kilo, mais on negocie en palettes : « deux palettes
 * de l'ivoire ». Le bon doit pouvoir dire les deux — la quantite dans l'unite
 * choisie, le prix toujours ramene au kilo, parce que c'est ainsi que se
 * comparent les offres et que se calcule le cout de revient.
 */
interface Choix {
  qte: string
  unite: string
  palettes: string
  bobines: string
  /** Lie, les trois se repondent ; detache, chacun se saisit seul. */
  lie: boolean
  /** Toujours par KILO, quelle que soit l'unite de commande. */
  prix: string
}

/**
 * UNE PRESTATION : ce qui se commande sans entrer en stock.
 *
 * Transport, commission d'agent, piece detachee, montage. Cela se commande, se
 * facture, et doit figurer sur le bon envoye au fournisseur comme au montant
 * engage — mais rien n'en sera pese au quai. Faute de pouvoir le porter, il
 * fallait inventer une fausse reference au catalogue, qui entrait ensuite en
 * stock et faussait le cout de revient de la matiere.
 *
 * Elle n'a ni reference, ni poids, ni conversion : un intitule, une quantite
 * dans son unite a elle, un prix unitaire.
 */
interface Prestation {
  cle: string
  libelle: string
  unite: string
  quantite: string
  prix: string
}

/** Les unites d'une prestation : rien ne s'y pese. */
const UNITES_PRESTATION = ['Forfait', 'Unite', 'Heure'] as const

/** Une prestation part au serveur quand elle porte un intitule, un compte et un prix. */
const estPrete = (p: Prestation) =>
  !!p.libelle.trim() && Number(p.quantite) > 0 && Number(p.prix) > 0

/** Une prestation commencee mais incomplete : elle bloque l'enregistrement. */
const estEbauche = (p: Prestation) =>
  !estPrete(p) && (!!p.libelle.trim() || Number(p.prix) > 0)

let compteurPrestation = 0
function prestationVide(): Prestation {
  compteurPrestation += 1
  return {
    cle: `p-${compteurPrestation}`,
    libelle: '',
    unite: 'Forfait',
    quantite: '1',
    prix: '',
  }
}

interface RefCommandable extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  /** Le fournisseur HABITUEL de cette reference — pas une exclusivite. */
  code_fournisseur?: string | null
  fournisseur_nom?: string | null
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

const TON_STOCK: Record<string, 'danger' | 'alerte' | 'succes' | 'neutre'> = {
  RUPTURE: 'danger',
  CRITIQUE: 'danger',
  ATTENTION: 'alerte',
  OK: 'succes',
}

const TON_TIER: Record<string, 'danger' | 'alerte' | 'info' | 'neutre'> = {
  'TIER 1': 'danger',
  'TIER 2': 'alerte',
  'TIER 3': 'info',
  'TIER 4': 'neutre',
}

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
  const [choix, setChoix] = useState<Record<string, Choix>>({})
  const [filtre, setFiltre] = useState('')
  /**
   * OUVRIR LE BON AU RESTE DU CATALOGUE.
   *
   * Par defaut l'ecran montre les references rattachees a ce fournisseur : neuf
   * commandes sur dix ne sortent pas de la. Mais le rattachement du catalogue
   * est une HABITUDE D'ACHAT, pas une exclusivite — un fournisseur qui propose
   * un meilleur prix ou un delai plus court sur un fil qu'on achete ailleurs
   * doit pouvoir etre commande. Sans cette porte, il fallait modifier la fiche
   * de la reference pour passer une commande : on maquillait le referentiel
   * pour contourner l'ecran.
   */
  const [toutCatalogue, setToutCatalogue] = useState(false)
  const [prestations, setPrestations] = useState<Prestation[]>([])
  const [erreur, setErreur] = useState<string | null>(null)

  /* --- Arrivee ciblee : /bons-commande/nouveau?reference=X ----------------
     Depuis le menu contextuel d'un ecran de stock, l'acheteur a deja designe
     CE qu'il veut commander. L'ecran doit donc arriver sur le bon fournisseur,
     la reference cochee, plutot que sur un formulaire vide ou il faudrait la
     retrouver. Le fournisseur se lit sur la fiche : le deduire du nom affiche
     ailleurs marcherait jusqu'au premier homonyme. */
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

  // Des le fournisseur choisi : ce qu'il faut lui commander. Pas d'etape
  // intermediaire, pas de document vide a ouvrir d'abord.
  const qRefs = useQuery({
    queryKey: ['refs-commandables', entete.code_fournisseur, toutCatalogue],
    queryFn: () =>
      api.get<RefCommandable[]>(
        `/api/references-commandables?code_fournisseur=${encodeURIComponent(entete.code_fournisseur)}` +
          (toutCatalogue ? '&toutes=1' : ''),
      ),
    enabled: !!entete.code_fournisseur,
  })

  // LE CONDITIONNEMENT vient du catalogue, pas de l'ecran : c'est lui qui dit
  // combien pese une bobine et combien une palette en porte. Sans lui, commander
  // « deux palettes » ne voudrait rien dire.
  const qCat = useQuery({
    queryKey: ['catalogue-saisie'],
    queryFn: () =>
      api.get<(Conditionnement & { code_reference: string })[]>(
        '/api/catalogue?actif=1&limite=2000',
      ),
  })
  const parReference = useMemo(
    () => new Map((qCat.data ?? []).map((r) => [r.code_reference, r as Conditionnement])),
    [qCat.data],
  )
  const condDe = (code: string): Conditionnement =>
    parReference.get(code) ?? SANS_CONDITIONNEMENT

  /** Les unites de commande que la reference autorise, en plus du kilo. */
  const unitesDe = (code: string): string[] => {
    const c = condDe(code)
    const u: string[] = []
    if (facteurVersKg('Bobine', c)) u.push('Bobine')
    if (facteurVersKg('Palette', c)) u.push('Palette')
    if (facteurVersKg('ml', c)) u.push('ml')
    return u
  }

  /** Le poids commande, quelle que soit l'unite saisie. */
  const kgDe = (code: string, v: Choix) => depuisUnite(v.qte, v.unite, condDe(code)).kg

  /**
   * LES TROIS EXPRESSIONS SE REPONDENT — palettes, bobines, quantite.
   *
   * On saisit celle qu'on a en tete au moment de negocier, les deux autres
   * suivent les parametres de la reference. Detache, chacune se saisit seule :
   * un fournisseur livre parfois une palette entamee, et la formule ne le sait
   * pas.
   */
  const majColis = (code: string, source: 'quantite' | 'palettes' | 'bobines', valeur: string) =>
    setChoix((c) => {
      const v = c[code]
      if (!v) return c
      const cond = condDe(code)
      if (!v.lie) {
        const champ =
          source === 'quantite' ? 'qte' : source === 'palettes' ? 'palettes' : 'bobines'
        return { ...c, [code]: { ...v, [champ]: valeur } }
      }
      const r =
        source === 'palettes'
          ? depuisPalettes(valeur, cond)
          : source === 'bobines'
            ? depuisBobines(valeur, cond)
            : depuisUnite(valeur, v.unite, cond)
      const quantite =
        source === 'quantite'
          ? valeur
          : v.unite === 'Palette'
            ? pourChamp(r.palettes)
            : v.unite === 'Bobine'
              ? pourChamp(r.bobines)
              : (() => {
                  const f = facteurVersKg(v.unite, cond)
                  return r.kg !== null && f ? pourChamp(r.kg / f, 3) : v.qte
                })()
      return {
        ...c,
        [code]: {
          ...v,
          qte: quantite,
          palettes: source === 'palettes' ? valeur : pourChamp(r.palettes),
          bobines: source === 'bobines' ? valeur : pourChamp(r.bobines),
        },
      }
    })

  /** Changer d'unite ne change pas la marchandise : seule son expression change. */
  const majUnite = (code: string, unite: string) =>
    setChoix((c) => {
      const v = c[code]
      if (!v) return c
      const cond = condDe(code)
      const kg = depuisUnite(v.qte, v.unite, cond).kg
      const f = facteurVersKg(unite, cond)
      if (!v.lie || kg === null || !f) return { ...c, [code]: { ...v, unite } }
      return {
        ...c,
        [code]: { ...v, unite, qte: pourChamp(kg / f, unite === 'kg' ? 3 : 0) },
      }
    })

  // Le fournisseur d'abord : c'est lui qui declenche le chargement des
  // references commandables.
  useEffect(() => {
    const code = qRefDemandee.data?.code_fournisseur
    if (code && !entete.code_fournisseur) {
      setEntete((e) => ({ ...e, code_fournisseur: code }))
      setFiltre(refDemandee)
    }
  }, [qRefDemandee.data, entete.code_fournisseur, refDemandee])

  // La reference ensuite, une seule fois. Sans le garde, decocher la ligne la
  // recocherait au rendu suivant : l'ecran refuserait la decision de l'acheteur.
  useEffect(() => {
    if (dejaAmorce.current || !refDemandee) return
    const r = qRefs.data?.find((x) => x.code_reference === refDemandee)
    if (!r) return
    dejaAmorce.current = true
    basculer(r)
  }, [qRefs.data, refDemandee])

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_bc: string; numero_bc: string; lignes: number }>('/api/bons-commande', {
        ...entete,
        lignes: [
          ...prestations.filter(estPrete).map((p) => ({
            type_ligne: 'SERVICE',
            libelle: p.libelle.trim(),
            unite_commande: p.unite,
            quantite_commandee_unite: Number(p.quantite),
            prix_unitaire_devise: Number(p.prix),
          })),
          ...Object.entries(choix).map(([code, v]) => ({
          type_ligne: 'MARCHANDISE',
          code_reference: code,
          unite_commande: v.unite,
          quantite_commandee_unite: Number(v.qte),
          // LE PRIX SE SAISIT AU KILO, le bon l'enregistre par unite commandee.
          // C'est au kilo que les offres se comparent et que le cout de revient
          // se calcule ; c'est par palette que le fournisseur facture. La
          // conversion se fait ici, une fois, plutot que de tete a chaque ligne.
          prix_unitaire_devise:
            Number(v.prix) * (facteurVersKg(v.unite, condDe(code)) ?? 1),
          })),
        ],
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

  const refs = useMemo(() => {
    const l = qRefs.data ?? []
    const f = filtre.toLowerCase()
    return l.filter(
      (r) =>
        !f ||
        r.code_reference.toLowerCase().includes(f) ||
        (r.designation ?? '').toLowerCase().includes(f),
    )
  }, [qRefs.data, filtre])

  // Trois sections, dans l'ordre ou l'acheteur decide.
  //
  // La deuxieme est la nouveaute : une reference que CE fournisseur livre, sans
  // besoin propre, mais equivalente a une reference en tension achetee ailleurs.
  // Elle tombait auparavant dans « les autres references », ou personne ne
  // faisait le rapprochement — c'est-a-dire au moment precis ou il aurait servi.
  //
  // La quatrieme n'apparait que si l'on a ouvert le catalogue entier : les
  // references d'un AUTRE fournisseur, qu'on peut commander a celui-ci en le
  // sachant. Elle reste a part, et jamais melangee aux siennes.
  const duFournisseur = refs.filter(
    (r) => !r.code_fournisseur || r.code_fournisseur === entete.code_fournisseur,
  )
  const dAilleurs = refs.filter(
    (r) => !!r.code_fournisseur && r.code_fournisseur !== entete.code_fournisseur,
  )
  const aCommander = duFournisseur.filter((r) => (r.qte_a_commander_kg ?? 0) > 0)
  const equivalentes = duFournisseur.filter(
    (r) => !((r.qte_a_commander_kg ?? 0) > 0) && !!r.equivalent_de,
  )
  const autres = duFournisseur.filter(
    (r) => !((r.qte_a_commander_kg ?? 0) > 0) && !r.equivalent_de,
  )

  const basculer = (r: RefCommandable) =>
    setChoix((c) => {
      if (c[r.code_reference]) {
        const { [r.code_reference]: _, ...reste } = c
        return reste
      }
      const kg = r.qte_a_commander_kg ?? 0
      const colis = depuisKg(kg, condDe(r.code_reference))
      return {
        ...c,
        [r.code_reference]: {
          qte: String(r.qte_a_commander_kg ?? ''),
          unite: 'kg',
          // Ce que la quantite proposee represente au quai : l'acheteur voit
          // tout de suite s'il commande un camion complet ou une palette seule.
          palettes: pourChamp(colis.palettes),
          bobines: pourChamp(colis.bobines),
          lie: true,
          prix: r.prix_suggere_devise != null ? String(r.prix_suggere_devise) : '',
        },
      }
    })

  const pretes = prestations.filter(estPrete)
  const ebauches = prestations.filter(estEbauche)
  const nb = Object.keys(choix).length + pretes.length
  const complet =
    Object.entries(choix).every(
      ([code, v]) => Number(v.qte) > 0 && Number(v.prix) > 0 && kgDe(code, v) !== null,
    ) && ebauches.length === 0
  const total =
    Object.entries(choix).reduce(
      (s, [code, v]) => s + (kgDe(code, v) ?? 0) * Number(v.prix),
      0,
    ) + pretes.reduce((s, p) => s + Number(p.quantite) * Number(p.prix), 0)
  // Une unite que la reference ne sait pas convertir sera REFUSEE par le serveur
  // (R01, jamais de repli sur un facteur de 1). Autant le dire tout de suite.
  const sansFacteur = Object.entries(choix).filter(
    ([code, v]) => Number(v.qte) > 0 && kgDe(code, v) === null,
  )
  const pret = !!entete.code_fournisseur && !!entete.date_bc && nb > 0 && complet

  const Ligne = ({ r }: { r: RefCommandable }) => {
    const coche = !!choix[r.code_reference]
    const deja = r.deja_sur_le_bon > 0
    return (
      <div
        className={cn(
          'rounded-[var(--radius)] border p-2',
          coche ? 'border-primaire bg-primaire/5' : 'border-bordure',
        )}
      >
        <label className={cn('flex items-start gap-2', deja ? 'opacity-60' : 'cursor-pointer')}>
          <input
            type="checkbox"
            checked={coche}
            disabled={deja}
            onChange={() => basculer(r)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{r.code_reference}</span>
              {r.statut_stock && (
                <Badge ton={TON_STOCK[r.statut_stock] ?? 'neutre'}>{r.statut_stock}</Badge>
              )}
              {r.tier && <Badge ton={TON_TIER[r.tier] ?? 'neutre'}>{r.tier}</Badge>}
              {r.classe_abc && <Badge ton="contour">ABC {r.classe_abc}</Badge>}
              {r.risque_sourcing === 'MONO-SOURCE' && <Badge ton="alerte">mono-source</Badge>}
              {r.equivalent_de && <Badge ton="info">equivalent</Badge>}
              {/* LE CHOIX DOIT ETRE DELIBERE : on ne glisse pas la reference
                  d'un autre fournisseur sur un bon sans que ce soit visible. */}
              {!!r.code_fournisseur && r.code_fournisseur !== entete.code_fournisseur && (
                <Badge ton="alerte">habituellement chez {r.fournisseur_nom ?? r.code_fournisseur}</Badge>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-attenue-texte">
              {r.designation}
            </span>
            {r.equivalent_de && (
              <span className="mt-1 block text-[11px] text-primaire">
                Remplace <strong>{r.equivalent_de}</strong>
                {r.besoin_equivalent_kg != null && (
                  <> — besoin de {fmt.nombre(r.besoin_equivalent_kg, 0)} kg non couvert</>
                )}
              </span>
            )}
            <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
              <span>
                Besoin{' '}
                <span className="tabular-nums text-texte">
                  {fmt.nombre(r.besoin_12m_kg ?? 0, 0)} kg
                </span>
              </span>
              <span>
                Projete{' '}
                <span className="tabular-nums text-texte">
                  {fmt.nombre(r.stock_projete_kg ?? 0, 0)} kg
                </span>
              </span>
              {(r.deja_commande_kg ?? 0) > 0 && (
                <span>
                  Deja commande{' '}
                  <span className="tabular-nums text-texte">
                    {fmt.nombre(r.deja_commande_kg ?? 0, 0)} kg
                  </span>
                </span>
              )}
              {r.jours_couverture != null && (
                <span>
                  Couverture{' '}
                  <span className="tabular-nums text-texte">
                    {fmt.nombre(r.jours_couverture, 0)} j
                  </span>
                </span>
              )}
              {r.delai_livraison_jours != null && <span>Delai {r.delai_livraison_jours} j</span>}
              {(r.qte_a_commander_kg ?? 0) > 0 && (
                <span>
                  Suggere{' '}
                  <span className="font-medium tabular-nums text-texte">
                    {fmt.nombre(r.qte_a_commander_kg ?? 0, 0)} kg
                  </span>
                </span>
              )}
              {r.prix_suggere_devise != null && (
                <span>
                  Prix{' '}
                  <span className="tabular-nums text-texte">
                    {fmt.nombre(r.prix_suggere_devise, 4)} {devise}
                  </span>
                </span>
              )}
              {r.source_prix === 'CATALOGUE' && (
                <span className="text-alerte">prix catalogue, jamais paye</span>
              )}
              {r.moq_kg != null && <span>MOQ {fmt.nombre(r.moq_kg, 0)} kg</span>}
              {deja && <span>déjà sur un bon</span>}
            </span>
          </span>
        </label>

        {coche && (
          <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <Etiq>Quantité</Etiq>
              <Champ
                type="number"
                step="any"
                min="0.0001"
                value={choix[r.code_reference].qte}
                onChange={(e) => majColis(r.code_reference, 'quantite', e.target.value)}
                className="text-right tabular-nums"
              />
              {choix[r.code_reference].unite !== 'kg' && (
                <p className="mt-1 text-[11px] tabular-nums text-attenue-texte">
                  {kgDe(r.code_reference, choix[r.code_reference]) === null ? (
                    <span className="text-danger">conversion impossible</span>
                  ) : (
                    <>= {fmt.nombre(kgDe(r.code_reference, choix[r.code_reference]), 0)} kg</>
                  )}
                </p>
              )}
            </div>
            <div>
              <Etiq>Unité</Etiq>
              <Selecteur
                value={choix[r.code_reference].unite}
                onChange={(e) => majUnite(r.code_reference, e.target.value)}
              >
                <option value="kg">kg</option>
                {unitesDe(r.code_reference).map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq>Palettes</Etiq>
              <Champ
                type="number"
                min="0"
                value={choix[r.code_reference].palettes}
                onChange={(e) => majColis(r.code_reference, 'palettes', e.target.value)}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq>Bobines</Etiq>
              <div className="flex items-center gap-1">
                <Champ
                  type="number"
                  min="0"
                  value={choix[r.code_reference].bobines}
                  onChange={(e) => majColis(r.code_reference, 'bobines', e.target.value)}
                  className="text-right tabular-nums"
                />
                <button
                  type="button"
                  onClick={() =>
                    setChoix((c) => ({
                      ...c,
                      [r.code_reference]: {
                        ...c[r.code_reference],
                        lie: !c[r.code_reference].lie,
                      },
                    }))
                  }
                  title={
                    choix[r.code_reference].lie
                      ? 'Les trois se repondent — cliquez pour saisir chacun separement'
                      : 'Calcul detache — cliquez pour relier les trois'
                  }
                  aria-label={
                    choix[r.code_reference].lie ? 'Détacher le calcul' : 'Relier le calcul'
                  }
                  className={cn(
                    'shrink-0 rounded-[var(--radius)] p-1.5',
                    choix[r.code_reference].lie
                      ? 'text-primaire hover:bg-primaire/10'
                      : 'text-alerte hover:bg-alerte/10',
                  )}
                >
                  {choix[r.code_reference].lie ? (
                    <Link2 className="size-4" />
                  ) : (
                    <Unlink2 className="size-4" />
                  )}
                </button>
              </div>
            </div>
            <div>
              <Etiq>Prix {devise}/kg</Etiq>
              <Champ
                type="number"
                step="any"
                min="0.0001"
                value={choix[r.code_reference].prix}
                onChange={(e) =>
                  setChoix((c) => ({
                    ...c,
                    [r.code_reference]: { ...c[r.code_reference], prix: e.target.value },
                  }))
                }
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq>Total ligne</Etiq>
              <div className="flex h-8 items-center justify-end rounded-[var(--radius)] border border-bordure bg-attenue px-2 text-[13px] tabular-nums">
                {fmt.nombre(
                  (kgDe(r.code_reference, choix[r.code_reference]) ?? 0) *
                    Number(choix[r.code_reference].prix),
                  2,
                )}{' '}
                {devise}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <EnTetePage
        titre="Nouveau bon de commande"
        description="Choisissez le fournisseur : ce qu'il faut lui commander s'affiche aussitot. Tout s'enregistre en une fois."
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
                  setChoix({})
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
                Changer de fournisseur remet la selection a zero : la devise et les prix en
                dependent.
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
            Choisissez un fournisseur : les references a lui commander s'afficheront ici, avec
            leur besoin, leur urgence et le prix propose.
          </Alerte>
        )}

        {entete.code_fournisseur && (
          <Carte repliable="boncommandenouveau.2">
            <CarteEntete>
              <CarteTitre>A commander chez {fournisseur?.nom}</CarteTitre>
              <div className="flex items-center gap-3">
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-[12px] text-attenue-texte"
                  title="Le catalogue dit chez qui on achète d'habitude, pas chez qui on a le droit d'acheter."
                >
                  <input
                    type="checkbox"
                    checked={toutCatalogue}
                    onChange={(e) => setToutCatalogue(e.target.checked)}
                    className="size-3.5"
                  />
                  Tout le catalogue
                </label>
                <div className="flex items-center gap-2">
                  <Search className="size-3.5 text-attenue-texte" />
                  <Champ
                    placeholder="Filtrer…"
                    value={filtre}
                    onChange={(e) => setFiltre(e.target.value)}
                    className="h-7 w-48"
                  />
                </div>
              </div>
            </CarteEntete>
            <CarteCorps>
              {qRefs.isLoading && <Chargement texte="Lecture du plan d'achat…" />}

              {!qRefs.isLoading && aCommander.length > 0 && (
                <>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Proposees par le plan d'achat ({aCommander.length})
                  </div>
                  <div className="space-y-1.5">
                    {aCommander.map((r) => (
                      <Ligne key={r.code_reference} r={r} />
                    ))}
                  </div>
                </>
              )}

              {!qRefs.isLoading && aCommander.length === 0 && (
                <Alerte ton="info" className="mb-3">
                  Le plan d'achat ne propose rien pour ce fournisseur : son stock projete couvre les
                  besoins. Vous pouvez tout de meme commander en choisissant ci-dessous.
                </Alerte>
              )}

              {equivalentes.length > 0 && (
                <>
                  <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Equivalentes a une reference en tension ({equivalentes.length})
                  </div>
                  <p className="mb-2 text-[11px] text-attenue-texte">
                    Ce fournisseur livre ces references, et chacune peut remplacer une reference
                    dont le stock projete ne couvre plus le besoin. Le MRP ne les propose pas — il
                    calcule par reference et ne mutualise jamais le stock d'un groupe — mais elles
                    couvriraient le manque.
                  </p>
                  <div className="space-y-1.5">
                    {equivalentes.map((r) => (
                      <Ligne key={r.code_reference} r={r} />
                    ))}
                  </div>
                </>
              )}

              {autres.length > 0 && (
                <>
                  <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Autres references du fournisseur ({autres.length})
                  </div>
                  <div className="space-y-1.5">
                    {autres.map((r) => (
                      <Ligne key={r.code_reference} r={r} />
                    ))}
                  </div>
                </>
              )}

              {/* ---- Le reste du catalogue, sur demande --------------------- */}
              {!toutCatalogue ? (
                <p className="mt-4 text-[11px] text-attenue-texte">
                  Une référence que ce fournisseur peut livrer mais qu'on achète d'habitude
                  ailleurs ? Cochez <span className="font-medium">Tout le catalogue</span> en haut
                  de cette carte.
                </p>
              ) : (
                dAilleurs.length > 0 && (
                  <>
                    <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                      Achetées d'habitude ailleurs ({dAilleurs.length})
                    </div>
                    <p className="mb-2 text-[11px] text-attenue-texte">
                      Le catalogue dit chez qui on achète d'ordinaire ; il n'interdit pas d'acheter
                      ailleurs. Ces références partiront sur ce bon, au nom de{' '}
                      {fournisseur?.nom} — leur fournisseur habituel reste affiché pour que le choix
                      soit délibéré.
                    </p>
                    <div className="space-y-1.5">
                      {dAilleurs.map((r) => (
                        <Ligne key={r.code_reference} r={r} />
                      ))}
                    </div>
                  </>
                )
              )}
            </CarteCorps>
          </Carte>
        )}

        {/* ---- Ce qui se commande sans entrer en stock ------------------- */}
        {entete.code_fournisseur && (
          <Carte className="mt-3">
            <CarteEntete>
              <CarteTitre>Prestations et frais</CarteTitre>
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => setPrestations((p) => [...p, prestationVide()])}
              >
                <Plus />
                Ajouter une prestation
              </Bouton>
            </CarteEntete>
            <CarteCorps>
              {prestations.length === 0 ? (
                <p className="text-[11px] text-attenue-texte">
                  Transport, commission d'agent, pièce détachée, montage : ce qui se commande et se
                  facture sans jamais entrer en stock. Ces lignes figurent sur le bon envoyé au
                  fournisseur et dans le montant engagé, mais rien n'en sera pesé au quai.
                </p>
              ) : (
                <div className="space-y-2">
                  {prestations.map((p, i) => (
                    <div
                      key={p.cle}
                      className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_6rem_8rem_8rem_2rem]"
                    >
                      <div>
                        {i === 0 && <Etiq obligatoire>Intitulé</Etiq>}
                        <Champ
                          value={p.libelle}
                          placeholder="Fret maritime Izmir — Tanger"
                          onChange={(e) =>
                            setPrestations((ps) =>
                              ps.map((x) =>
                                x.cle === p.cle ? { ...x, libelle: e.target.value } : x,
                              ),
                            )
                          }
                          className={cn(
                            !p.libelle.trim() && Number(p.prix) > 0 && 'border-danger',
                          )}
                        />
                      </div>
                      <div>
                        {i === 0 && <Etiq>Unité</Etiq>}
                        <Selecteur
                          value={p.unite}
                          onChange={(e) =>
                            setPrestations((ps) =>
                              ps.map((x) => (x.cle === p.cle ? { ...x, unite: e.target.value } : x)),
                            )
                          }
                        >
                          {UNITES_PRESTATION.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </Selecteur>
                      </div>
                      <div>
                        {i === 0 && <Etiq>Nombre</Etiq>}
                        <Champ
                          type="number"
                          step="any"
                          min="0.0001"
                          value={p.quantite}
                          onChange={(e) =>
                            setPrestations((ps) =>
                              ps.map((x) =>
                                x.cle === p.cle ? { ...x, quantite: e.target.value } : x,
                              ),
                            )
                          }
                          className="text-right tabular-nums"
                        />
                      </div>
                      <div>
                        {i === 0 && <Etiq obligatoire>Prix {devise}</Etiq>}
                        <Champ
                          type="number"
                          step="any"
                          min="0.0001"
                          value={p.prix}
                          onChange={(e) =>
                            setPrestations((ps) =>
                              ps.map((x) => (x.cle === p.cle ? { ...x, prix: e.target.value } : x)),
                            )
                          }
                          className={cn(
                            'text-right tabular-nums',
                            !(Number(p.prix) > 0) && !!p.libelle.trim() && 'border-danger',
                          )}
                        />
                      </div>
                      <div>
                        {i === 0 && <Etiq>Total</Etiq>}
                        <div className="flex h-8 items-center justify-end rounded-[var(--radius)] border border-bordure bg-attenue px-2 text-[13px] tabular-nums">
                          {fmt.nombre(Number(p.quantite) * Number(p.prix), 2)}
                        </div>
                      </div>
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className="mb-1 text-danger hover:bg-danger/10"
                        aria-label="Retirer la prestation"
                        onClick={() =>
                          setPrestations((ps) => ps.filter((x) => x.cle !== p.cle))
                        }
                      >
                        <Trash2 />
                      </Bouton>
                    </div>
                  ))}
                  <p className="text-[11px] text-attenue-texte">
                    Ces lignes n'entrent pas en stock et ne se réceptionnent pas : elles n'ont ni
                    référence, ni poids. Pour un transport dont le coût doit peser sur le prix de
                    revient de la matière, passez plutôt par les frais d'approche du dossier
                    d'import — ils s'y répartissent au poids.
                  </p>
                </div>
              )}
            </CarteCorps>
          </Carte>
        )}
      </div>

      {entete.code_fournisseur && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            {nb === 0 ? (
              <span className="text-attenue-texte">Aucune référence selectionnee.</span>
            ) : (
              <>
                <span className="font-medium">{nb} ligne(s)</span>
                <span className="text-attenue-texte"> · total </span>
                <span className="font-semibold tabular-nums">
                  {fmt.nombre(total, 2)} {devise}
                </span>
                {sansFacteur.length > 0 ? (
                  <span className="text-danger">
                    {' '}
                    — conversion impossible sur {sansFacteur.map(([code]) => code).join(', ')} :
                    renseignez le conditionnement sur la référence, ou commandez en kg
                  </span>
                ) : (
                  !complet && (
                    <span className="text-danger"> — quantité ou prix manquant sur une ligne</span>
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

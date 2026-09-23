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
import { ArrowLeft, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { useParamVue } from '../lib/navigation'
import { EnTetePage } from '../composants/Coquille'
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
import { Aide } from '../composants/ui/surcouches'
import { fmt } from '../lib/utils'
import {
  GrilleLignes,
  corpsLigne,
  depuisReference,
  estEbauche,
  estPrete,
  kgDe,
  ligneVide,
  totalDe,
  type LigneSaisie,
} from '../composants/GrilleLignes'

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
  /** Le bain de production du fournisseur, en bobines. */
  bobines_par_lot?: number | null
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

/** Une ligne commencee mais incomplete : elle bloque l'enregistrement. */
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

  const chercherCatalogue = async (motif: string): Promise<RefCommandable[]> => {
    const p = new URLSearchParams({
      code_fournisseur: entete.code_fournisseur,
      toutes: '1',
      recherche: motif,
      limite: '25',
    })
    return api.get<RefCommandable[]>(`/api/references-commandables?${p}`)
  }

  /* --- Les lignes -------------------------------------------------------- */

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

  /** Ce que la ligne coute : au kilo pour la marchandise, au forfait sinon. */
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
        lignes: pretes.map(corpsLigne),
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

    return (
<<<<<<< HEAD
=======
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
          <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-3">
            <div>
              <Etiq>Quantité (kg)</Etiq>
              <Champ
                type="number"
                step="any"
                min="0.0001"
                value={choix[r.code_reference].qte}
                onChange={(e) =>
                  setChoix((c) => ({
                    ...c,
                    [r.code_reference]: { ...c[r.code_reference], qte: e.target.value },
                  }))
                }
                className="text-right tabular-nums"
              />
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
                  Number(choix[r.code_reference].qte) * Number(choix[r.code_reference].prix),
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
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
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
                <Aide>
                  Changer de fournisseur remet la saisie a zero : la devise, les prix et les
                  propositions du plan en dependent tous.
                </Aide>
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
            </CarteEntete>
            <CarteCorps className="space-y-3">
              {qPlan.isLoading && <Chargement texte="Lecture du plan d'achat…" />}

              {/* LA MEME GRILLE QUE L'ECRAN DE MODIFICATION. Elle vivait ici,
                  en clair ; l'ecran de modification en avait une autre, plus
                  pauvre. Deux saisies pour un meme article, c'etait une de
                  trop — elles divergeaient sans que rien ne le signale. */}
              <GrilleLignes
                codeFournisseur={entete.code_fournisseur}
                devise={devise}
                lignes={lignes}
                setLignes={setLignes}
                mode={mode}
                setMode={setMode}
                proposees={proposees}
                chercherCatalogue={chercherCatalogue}
                surCorrection={(code, champ, valeur) =>
                  corrigerReference.mutate({ code, champ, valeur })
                }
                valeurOrigine={(code, champ) => (parPlan.get(code)?.[champ] as string) ?? ''}
                surCreerReference={setACreer}
              />

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
<<<<<<< HEAD
            {pretes.length === 0 ? (
              <span className="text-attenue-texte">Aucune ligne saisie.</span>
=======
            {nb === 0 ? (
              <span className="text-attenue-texte">Aucune référence selectionnee.</span>
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
            ) : (
              <>
                <span className="font-medium">{pretes.length} ligne(s)</span>
                <span className="text-attenue-texte"> · total </span>
                <span className="font-semibold tabular-nums">
                  {fmt.nombre(total, 2)} {devise}
                </span>
<<<<<<< HEAD
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
=======
                {!complet && (
                  <span className="text-danger"> — quantité ou prix manquant sur une ligne</span>
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
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

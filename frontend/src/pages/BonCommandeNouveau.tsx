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
  fusionnerParReference,
  kgDe,
  ligneVide,
  totalDe,
  type LigneSaisie,
} from '../composants/GrilleLignes'
import { TotauxCommande } from '../composants/TotauxCommande'
import { useGardeSaisie } from '../hooks/useGardeSaisie'
import { ChoixRecherche, useLigneChoix } from '../composants/ChoixRecherche'
import { nouvelIdentifiant } from '../lib/identifiant'

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
    /** Au choix ; celle de la fiche fournisseur par defaut (01/10/2026). */
    code_devise: '',
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
  // Un bon en cours de saisie ne se perd pas d'un clic dans le menu (audit v4).
  const quitter = useGardeSaisie(lignes.length > 0)
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

  // LE FOURNISSEUR CHOISI, relu par sa cle (24/10/2026) : la liste entiere des
  // fournisseurs n'est plus chargee — on la cherche en tapant.
  const qFrs = useLigneChoix('fournisseur', entete.code_fournisseur)
  const fournisseur = (qFrs.data ?? undefined) as Fournisseur | undefined
  const devise = entete.code_devise || fournisseur?.code_devise || 'MAD'
  const qDevises = useQuery({ queryKey: ['devises'], queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }) })

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
    mutationFn: ({ code, champ, valeur, version }: { code: string; champ: string; valeur: string; version?: number | null }) =>
      api.patch<{ version: number }>(`/api/catalogue/${encodeURIComponent(code)}`, { [champ]: valeur, version }),
    onSuccess: (r, v) => {
      // La fiche a change de version : la correction suivante presentera la nouvelle.
      setLignes((ls) => ls.map((l) => (l.code_reference === v.code ? { ...l, version_reference: r.version } : l)))
      toast.success('Fiche de la référence corrigée')
      void qc.invalidateQueries({ queryKey: ['refs-plan'] })
    },
    onError: (e) =>
      toast.error(e instanceof ErreurApi ? e.message : 'Correction impossible.'),
  })

  /** Ce que la ligne coute : au kilo pour la marchandise, au forfait sinon. */
  /* --- L'enregistrement --------------------------------------------------- */

  // `(l) => estPrete(l)` ET NON `estPrete` : `filter` passe l’index en second
  // argument, qui deviendrait `sansPrix`. Des la deuxieme ligne, le controle du
  // prix aurait saute sans rien dire.
  const pretes = lignes.filter((l) => estPrete(l))
  const ebauches = lignes.filter((l) => estEbauche(l))
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

  // L'identifiant du document, tire a l'ouverture : un second envoi du meme
  // formulaire rend le meme document (audit P3, 19/10/2026).
  const [idDocument] = useState(nouvelIdentifiant)
  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_bc: string; numero_bc: string; lignes: number }>('/api/bons-commande', {
        id_document: idDocument,
        ...entete,
        // UNE LIGNE PAR REFERENCE (21/10/2026) : la reference saisie deux fois
        // part en une ligne, quantites additionnees (le serveur fait de meme).
        lignes: fusionnerParReference(pretes).lignes.map(corpsLigne),
      }),
    onSuccess: (r) => {
      const fusions = fusionnerParReference(pretes).fusions
      toast.success(`${r.numero_bc} cree`, {
        description:
          `${r.lignes} ligne(s) · brouillon, rien n'est encore engage.` +
          (fusions.length ? ` Une ligne par référence : ${fusions.join(' ; ')}.` : ''),
      })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
      naviguer(`/bons-commande/${r.id_bc}`)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Création impossible.'),
  })

  /* --- Rendu -------------------------------------------------------------- */

    return (
    <div>
      <EnTetePage
        titre="Nouveau bon de commande"
        description="Choisissez le fournisseur : ce que le plan d'achat lui réclame s'affiche aussitôt. Tapez pour ajouter une ligne."
        actions={
          <Bouton variante="contour" onClick={() => quitter(() => naviguer('/bons-commande'))}>
            <ArrowLeft />
            Retour
          </Bouton>
        }
      />

      {erreur && (
        <Alerte ton="danger" titre="Création refusée" className="mb-3">
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
                  propositions du plan en dépendent tous.
                </Aide>
              </Etiq>
              <ChoixRecherche
                type="fournisseur"
                id="frs"
                ariaLabel="Fournisseur"
                valeur={entete.code_fournisseur}
                onChange={(code, ligne) => {
                  if (code === entete.code_fournisseur) return
                  setEntete({
                    ...entete,
                    code_fournisseur: code,
                    code_devise: String(ligne?.code_devise ?? ''),
                  })
                  setLignes([])
                }}
              />
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
              <Etiq htmlFor="devise">
                Devise
                <Aide>Celle de la fiche fournisseur par défaut. Le taux engagé est celui en vigueur pour la devise choisie.</Aide>
              </Etiq>
              <Selecteur
                id="devise"
                value={devise}
                disabled={!entete.code_fournisseur}
                onChange={(e) => setEntete({ ...entete, code_devise: e.target.value })}
              >
                {(qDevises.data ?? [{ code_devise: devise }]).map((d) => (
                  <option key={d.code_devise}>{d.code_devise}</option>
                ))}
              </Selecteur>
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
            quantité proposée et le prix.
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
                controleColisage
                codeFournisseur={entete.code_fournisseur}
                devise={devise}
                lignes={lignes}
                setLignes={setLignes}
                mode={mode}
                setMode={setMode}
                proposees={proposees}
                chercherCatalogue={chercherCatalogue}
                surCorrection={(code, champ, valeur, version) =>
                  corrigerReference.mutate({ code, champ, valeur, version })
                }
                valeurOrigine={(code, champ) => (parPlan.get(code)?.[champ] as string) ?? ''}
                surCreerReference={setACreer}
                avecRemise
                fusionParReference
              />
              {/* LES MEMES TOTAUX QU'EN MODIFICATION : brut, remise, net HT. Pas
                  d'equivalent en dirhams ici — le taux n'est engage qu'a la
                  creation du bon, et un montant au taux du jour mentirait. */}
              <TotauxCommande lignes={pretes} devise={devise} />

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
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/bons-commande'))}>
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
              Créer le bon
            </Bouton>
          </div>
        </div>
      )}
    </div>
  )
}

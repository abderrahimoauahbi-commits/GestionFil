/**
 * Cockpit — le poste de travail.
 *
 * Deux questions, dans cet ordre, parce que c'est l'ordre dans lequel on les
 * pose en arrivant le matin :
 *
 *   1. QU'EST-CE QUI M'ATTEND ? Une bande de tuiles-compteurs, chacune une file
 *      qui se vide quand quelqu'un fait son travail, chacune menant a la liste
 *      deja filtree. Un chiffre qui ne mene nulle part n'a rien a faire ici.
 *
 *   2. EST-CE QUE JE TIENS LE PLAN ? Le mur de risques : mois par mois, les
 *      references qui ne passent pas les douze prochains mois, triees par le
 *      temps qu'il reste REELLEMENT pour agir — echeance moins delai
 *      fournisseur. Une rupture lointaine chez un fournisseur rapide n'est pas
 *      une urgence ; une tension le mois prochain chez un mono-source a 90
 *      jours en est une.
 *
 * Deux regles de composition, tenues partout :
 *
 *   * une tuile n'apparait que si le role a le droit de VOIR le champ ET la
 *     permission d'AGIR dessus. Afficher « 3 bons a valider » a qui ne peut pas
 *     valider n'est pas une information, c'est du bruit ;
 *   * une file vide disparait. Un ecran couvert de zeros apprend a ne plus etre
 *     lu, et le jour ou un compteur monte, personne ne le voit.
 */
import { useMemo } from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { OngletsTableauDeBord } from './tableau-de-bord/Onglets'
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileCheck2,
  FileClock,
  FileSearch,
  Moon,
  Lock,
  PackageX,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  Truck,
  MessagesSquare,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { CockpitAnalyse, type VueCockpit } from './CockpitAnalyse'
import { EnTetePage } from '../composants/Coquille'
import {
  Alerte,
  Badge,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Squelette,
} from '../composants/ui/base'
import { Infobulle } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { BarresEmpilees, BarresRangees } from '../composants/graphiques/Graphiques'
import { Layers, ShoppingCart, Sparkles } from 'lucide-react'
import { BarreRepartition, CarteStat } from '../composants/CarteStat'
import { Pareto } from '../composants/graphiques/Pareto'
import { BullesFournisseurs, type Fournisseur } from '../composants/graphiques/BullesFournisseurs'

const MODULE = 'COCKPIT'

interface Kpi {
  [k: string]: unknown
}

interface Controle {
  code: string
  controle: string
  criticite: string
  anomalies: number
}

interface MoisRisque {
  annee_mois: string
  rang_mois: number
  besoin_kg: number
  entrees_kg: number
  stock_fin_kg: number
  stock_min_kg: number
  /** L'état du mois au moteur de couverture (27/10/2026). */
  statut: 'COUVERT' | 'SOUS_SECURITE' | 'PLAN_NON_COUVERT'
}

interface Risque {
  code_reference: string
  designation: string
  classe_abc: string | null
  fournisseur_nom: string | null
  delai_livraison_jours: number | null
  risque_sourcing: string
  stock_initial_kg: number
  stock_min_kg: number
  nb_mois_rupture: number
  nb_mois_tendu: number
  premier_mois_risque: string | null
  marge_decision_jours: number | null
  equivalent_dispo_kg: number | null
  equivalent_reference: string | null
  mois: MoisRisque[]
}

type Ton = 'danger' | 'alerte' | 'succes' | 'neutre'

/**
 * LES DOMAINES DU TABLEAU DE BORD.
 *
 * Ils reprennent le decoupage du menu — achats, stock, production, qualite —
 * parce qu'une personne travaille dans UN de ces domaines et pas dans les
 * autres. Un acheteur qui ouvre le poste de travail veut ses commandes, pas
 * les ecarts d'inventaire ; lui faire traverser tout l'ecran chaque matin,
 * c'est lui apprendre a ne plus le lire.
 *
 * LE FILTRE NE CACHE PAS UNE ALERTE, il la met de cote : on revient a « Tous »
 * d'un clic, et le compteur de chaque domaine reste visible dans le
 * selecteur — on sait donc toujours qu'il se passe quelque chose ailleurs.
 */
export type Domaine = 'ACHATS' | 'STOCK' | 'PRODUCTION' | 'QUALITE'

const DOMAINES: { cle: Domaine; libelle: string }[] = [
  { cle: 'ACHATS', libelle: 'Achats' },
  { cle: 'STOCK', libelle: 'Stock' },
  { cle: 'PRODUCTION', libelle: 'Production' },
  { cle: 'QUALITE', libelle: 'Qualité' },
]

interface Tuile {
  champ: string
  libelle: string
  valeur: number
  affichage?: string
  detail?: string
  ton: Ton
  Icone: React.ComponentType<{ className?: string }>
  vers?: string
  /**
   * LE DOMAINE METIER de cette file.
   *
   * Il sert au selecteur du haut : un acheteur veut voir ses commandes sans
   * traverser les ruptures de stock, un magasinier l'inverse. Sans domaine,
   * le filtre n'aurait rien sur quoi mordre.
   */
  domaine: Domaine
  /** Faux si le role ne peut rien faire de ce compteur : la tuile disparait. */
  actionnable?: boolean
  /** Une tuile d'ETAT reste visible a zero ; une FILE vide s'efface. */
  toujours?: boolean
  /**
   * Compteur lu HORS de la grille de champs du cockpit (les lots, sous le
   * module STOCK) : il n'a pas de ligne dans `champ_configurable` COCKPIT, et
   * `visible` le dirait donc masque. Sa permission de module suffit.
   */
  horsGrille?: boolean
}

const TEINTE: Record<Ton, string> = {
  danger: 'text-danger',
  alerte: 'text-alerte',
  succes: 'text-succes',
  neutre: 'text-texte',
}

export function Cockpit() {
  const droits = useDroits(MODULE)
  const { peut } = useAuth()

  const qKpi = useQuery({ queryKey: ['cockpit'], queryFn: ({ signal }) => api.get<Kpi>('/api/cockpit', { signal }) })
  const qCtl = useQuery({
    queryKey: ['controles'],
    queryFn: ({ signal }) => api.get<Controle[]>('/api/controles', { signal }),
  })
  const qRisques = useQuery({
    queryKey: ['cockpit-risques'],
    queryFn: ({ signal }) => api.get<Risque[]>('/api/cockpit/risques', { signal }),
  })

  const k = qKpi.data ?? {}
  const n = (champ: string) => Number(k[champ] ?? 0)

  /* LES FILES DES LOTS (02/10/2026). Elles se lisent sous le module STOCK,
     comme le registre : un role qui ne lit pas le stock n'a pas a les voir. */
  const lisStock = peut('STOCK', 'LIRE')
  const qLots = useQuery({
    queryKey: ['cockpit-lots'],
    queryFn: ({ signal }) => api.get<Record<string, number | null>>('/api/cockpit/lots', { signal }),
    enabled: lisStock,
  })
  const nl = (champ: string) => Number(qLots.data?.[champ] ?? 0)

  const files: Tuile[] = [
    {
      champ: 'nb_propositions_a_traiter',
      domaine: 'ACHATS',
      libelle: 'Propositions a arbitrer',
      valeur: n('nb_propositions_a_traiter'),
      detail: 'plan d achat',
      ton: 'alerte',
      Icone: FileClock,
      vers: '/plan-achat',
      actionnable: peut('PLAN_ACHAT', 'ECRIRE'),
    },
    /* LES DEUX ATTENTES DU CIRCUIT DU BON (21/10/2026) : le controle par un
       autre compte, puis la reponse du fournisseur a la demande de prix. Le
       clic ouvre la liste filtree sur le statut. */
    {
      champ: 'nb_bc_au_controle',
      domaine: 'ACHATS',
      libelle: 'Bons au contrôle',
      valeur: n('nb_bc_au_controle'),
      detail: 'quantités et fournisseur à vérifier',
      ton: 'alerte',
      Icone: FileSearch,
      vers: '/bons-commande?statut=EN_CONTROLE',
      actionnable: peut('BONS_COMMANDE', 'LIRE'),
    },
    {
      champ: 'nb_bc_demande_prix',
      domaine: 'ACHATS',
      libelle: 'Demandes de prix en attente',
      valeur: n('nb_bc_demande_prix'),
      detail: 'réponse du fournisseur à saisir',
      ton: 'alerte',
      Icone: MessagesSquare,
      vers: '/bons-commande?statut=DEMANDE_PRIX',
      actionnable: peut('BONS_COMMANDE', 'LIRE'),
    },
    {
      champ: 'nb_bc_a_valider',
      domaine: 'ACHATS',
      libelle: 'Bons à valider',
      valeur: n('nb_bc_a_valider'),
      detail: droits.visible('montant_bc_a_valider_mad')
        ? `${fmt.compact(n('montant_bc_a_valider_mad'))} MAD engages`
        : undefined,
      ton: 'alerte',
      Icone: FileCheck2,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'VALIDER'),
    },
    {
      champ: 'nb_bc_a_envoyer',
      domaine: 'ACHATS',
      libelle: 'Bons a envoyer',
      valeur: n('nb_bc_a_envoyer'),
      detail: 'valides, pas encore partis',
      ton: 'alerte',
      Icone: Send,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'ECRIRE'),
    },
    {
      champ: 'nb_livraisons_en_retard',
      domaine: 'ACHATS',
      libelle: 'Livraisons en retard',
      valeur: n('nb_livraisons_en_retard'),
      detail: n('retard_max_jours') > 0 ? `jusqu a ${n('retard_max_jours')} j` : undefined,
      ton: 'danger',
      Icone: Clock,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'LIRE'),
    },
    {
      champ: 'nb_receptions_a_controler',
      domaine: 'QUALITE',
      libelle: 'Réceptions à contrôler',
      valeur: n('nb_receptions_a_controler'),
      detail: 'en attente du contrôle qualité',
      ton: 'alerte',
      Icone: ClipboardCheck,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'VALIDER'),
    },
    {
      champ: 'nb_receptions_en_saisie',
      domaine: 'STOCK',
      libelle: 'Réceptions en saisie',
      valeur: n('nb_receptions_en_saisie'),
      detail: 'pesees non soumises',
      ton: 'neutre',
      Icone: Truck,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'ECRIRE'),
    },
    {
      champ: 'nb_receptions_a_regulariser',
      domaine: 'STOCK',
      libelle: 'À régulariser',
      valeur: n('nb_receptions_a_regulariser'),
      detail: 'bon non envoye : contrôle bloque',
      ton: 'danger',
      Icone: ShieldAlert,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'LIRE'),
    },
    {
      champ: 'nb_lignes_non_conformes',
      domaine: 'QUALITE',
      libelle: 'Lignes non conformes',
      valeur: n('nb_lignes_non_conformes'),
      detail: 'quarantaine ou refus',
      ton: 'danger',
      Icone: PackageX,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'LIRE'),
    },
    /* « Sous le stock minimum » ne figure plus ici : ce n'est pas une file
       d'attente mais un ETAT, et il disait le meme chiffre que « A engager »
       au-dessus. Ce qu'il y a a faire de ces references se lit au plan
       d'achat, ou la tuile « Propositions a arbitrer » mene deja. */
    {
      champ: 'nb_lots_peremption_proche',
      domaine: 'QUALITE',
      libelle: 'Lots a moins de 90 j',
      valeur: n('nb_lots_peremption_proche'),
      detail: 'péremption proche',
      ton: 'alerte',
      Icone: Clock,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
    },
    {
      champ: 'nb_refs_dormantes',
      domaine: 'STOCK',
      libelle: 'Références dormantes',
      valeur: n('nb_refs_dormantes'),
      detail: droits.visible('valeur_dormante_mad')
        ? `${fmt.compact(n('valeur_dormante_mad'))} MAD immobilises`
        : undefined,
      ton: 'alerte',
      Icone: Moon,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
    },
    {
      champ: 'lots_a_basculer',
      domaine: 'STOCK',
      libelle: 'Lots à basculer',
      valeur: nl('lots_a_basculer'),
      detail: 'Projet passés sous le seuil des Restes',
      ton: 'alerte',
      Icone: ArrowDownUp,
      vers: '/lots?vue=a_basculer',
      actionnable: peut('STOCK', 'ECRIRE'),
      horsGrille: true,
    },
    {
      champ: 'lots_dormants',
      domaine: 'STOCK',
      libelle: 'Lots dormants',
      valeur: nl('lots_dormants'),
      detail: 'sans activité : à décider',
      ton: 'alerte',
      Icone: Moon,
      vers: '/lots?vue=dormants',
      actionnable: peut('STOCK', 'VALIDER'),
      horsGrille: true,
    },
    {
      champ: 'lots_bloques',
      domaine: 'QUALITE',
      libelle: 'Lots bloqués',
      valeur: nl('lots_bloques'),
      detail: 'en attente d’une décision qualité',
      ton: 'danger',
      Icone: Lock,
      vers: '/lots?vue=bloques',
      actionnable: peut('STOCK', 'VALIDER'),
      horsGrille: true,
    },
    {
      champ: 'lots_en_derive',
      domaine: 'QUALITE',
      libelle: 'Lots en dérive de poids',
      valeur: nl('lots_en_derive'),
      detail: 'écart cumulé hors tolérance',
      ton: 'alerte',
      Icone: Scale,
      vers: '/lots?vue=derive',
      actionnable: lisStock,
      horsGrille: true,
    },
    {
      champ: 'autorisations_en_attente',
      domaine: 'STOCK',
      libelle: 'Autorisations à donner',
      valeur: nl('autorisations_en_attente'),
      detail: 'demandes en attente de décision',
      ton: 'danger',
      Icone: ShieldCheck,
      vers: '/autorisations',
      actionnable: peut('STOCK', 'VALIDER'),
      horsGrille: true,
    },
    {
      champ: 'nb_controles_bloquants',
      domaine: 'QUALITE',
      libelle: 'Contrôles bloquants',
      valeur: n('nb_controles_bloquants'),
      detail: 'coherence du referentiel',
      ton: 'danger',
      Icone: AlertTriangle,
      actionnable: true,
    },
  ]

  // UNE TUILE N'APPARAIT QUE SI ELLE MENE QUELQUE PART. Le role doit pouvoir
  // VOIR le champ et AGIR dessus ; une file vide s'efface, parce qu'un ecran
  // couvert de zeros apprend a ne plus etre lu.
  const garder = (t: Tuile) =>
    (t.horsGrille || droits.visible(t.champ)) &&
    t.actionnable !== false &&
    (t.toujours || t.valeur > 0)

  /* LE DOMAINE CHOISI SE RETIENT POUR LA SESSION. Un acheteur qui a mis
     « Achats » le retrouve en revenant ; il n'a pas a le reposer dix fois par
     jour. `sessionStorage` et non `localStorage` : c'est une preference de
     journee, pas d'annee. */
  const [domaine, setDomaineBrut] = useState<Domaine | ''>(() => {
    try {
      const v = sessionStorage.getItem('cockpit.domaine')
      return v === 'ACHATS' || v === 'STOCK' || v === 'PRODUCTION' || v === 'QUALITE' ? v : ''
    } catch {
      return ''
    }
  })
  const setDomaine = (d: Domaine | '') => {
    setDomaineBrut(d)
    try {
      sessionStorage.setItem('cockpit.domaine', d)
    } catch {
      /* navigation privee : le choix ne se retient pas, l'ecran marche quand meme */
    }
  }

  const toutesMesFiles = files.filter(garder)
  const mesFiles = domaine
    ? toutesMesFiles.filter((f) => f.domaine === domaine)
    : toutesMesFiles

  const bloquants = (qCtl.data ?? []).filter((c) => c.criticite === 'BLOQUANT' && c.anomalies > 0)
  const autres = (qCtl.data ?? []).filter((c) => c.criticite !== 'BLOQUANT' && c.anomalies > 0)

  /* LA VUE EST UNE ADRESSE, plus un etat cache.
     Elle vivait dans `sessionStorage` : les quatre vues du tableau de bord ne
     se distinguaient donc ni dans la barre d'adresse, ni dans le menu, ni dans
     un signet — quatre ecrans de travail differents partageaient une seule
     porte. C'est la critique qui a ete faite, et elle est juste : un tableau
     de bord qui melange la synthese, l'analytique et les opportunites sous une
     entree unique oblige a chercher a chaque fois.
     Chaque vue a maintenant son chemin, donc sa ligne de menu — comme les
     pages d'un espace Fiori ou les entrees « Vue d'ensemble / Analyse » d'une
     application Odoo. */
  const { vue: vueUrl } = useParams<{ vue?: string }>()
  const vue: VueCockpit =
    vueUrl === 'analyse' || vueUrl === 'opportunites' || vueUrl === 'matiere'
      ? vueUrl
      : 'situation'

  const risques = qRisques.data ?? []
  /** Les mois de l'horizon, pris sur la premiere frise : toutes sont alignees. */
  const colonnes = useMemo(() => risques[0]?.mois?.map((m) => m.annee_mois) ?? [], [risques])

  return (
    <div>
      <EnTetePage
        titre="Poste de travail"
        description="Ce qui attend une décision, et ce qui menace le plan de production. Tout est recalculé a l'ouverture."
        actions={
          <label className="flex items-center gap-2 text-[12px] text-attenue-texte">
            Domaine
            <select
              value={domaine}
              onChange={(e) => setDomaine(e.target.value as Domaine | '')}
              className="rounded-[var(--radius-sm)] border border-bordure bg-surface px-2.5 py-1.5
                         text-[12px] text-texte outline-none focus:border-primaire/60"
            >
              {/* LE COMPTEUR EST DANS LE LIBELLE : on voit ce qui attend
                  ailleurs sans changer de vue, donc on ne rate rien en
                  filtrant. */}
              <option value="">Tous ({toutesMesFiles.length})</option>
              {DOMAINES.map((d) => {
                const n = toutesMesFiles.filter((f) => f.domaine === d.cle).length
                return (
                  <option key={d.cle} value={d.cle}>
                    {d.libelle} ({n})
                  </option>
                )
              })}
            </select>
          </label>
        }
      />

      <ChiffresCles />

      {qKpi.isLoading ? (
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Squelette key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {mesFiles.length > 0 && (
            <>
              <TitreBande texte="À traiter" />
              {/* UNE BARRE, PAS DES TUILES.
                  Ni la grille ni la rangee souple ne tenaient. En grille, une
                  file unique s'etirait sur mille quatre cents pixels pour trois
                  mots ; en rangee, elle devenait un carre de deux cent quarante
                  pixels perdu a gauche, avec tout le vide a sa droite. Le
                  defaut n'etait pas la largeur de la tuile : c'est qu'une
                  TUILE suppose qu'il y en aura plusieurs.
                  Les files vont de une a six selon le role et selon le jour.
                  Ce qui tient a tous les comptes, c'est une BARRE : une bande
                  d'un seul tenant, divisee en autant de parts qu'il y a de
                  files. A une, elle fait une ligne pleine largeur qui se lit
                  comme une phrase ; a six, six parts egales. La largeur est
                  toujours remplie, et la rangee ne montre jamais du vide.
                  C'est la « To-Do » de Fiori et le bandeau d'activites
                  d'Odoo — pour la meme raison. */}
              <BarreFiles files={mesFiles} />
            </>
          )}

          {mesFiles.length === 0 && (
            <Alerte ton="succes" titre="Rien n'attend de décision">
              Aucune file en cours pour votre role. Les compteurs reapparaitront des qu'un bon, une
              réception ou une proposition demandera votre intervention.
            </Alerte>
          )}

          {/* LA GRILLE « SITUATION » A DISPARU, et c'est le point de la
              refonte. Elle reprenait, en sept tuiles de meme taille, ce que la
              bande du haut venait de dire : ruptures, critiques, attention,
              sur-stock, ecarts, valeur du stock, engage chez les fournisseurs.
              Les memes references y etaient comptees trois fois sous trois
              noms. Un tableau de bord qui se repete apprend a ne plus etre lu ;
              ce qui restait unique — le sur-stock, les ecarts — est passe dans
              la ligne discrete sous les quatre chiffres, ou il avertit sans
              concurrencer. */}
        </>
      )}

      {bloquants.length > 0 && (
        <div className="mt-6">
          <Alerte ton="danger" titre="Anomalies bloquantes">
            <ul className="mt-1 space-y-0.5">
              {bloquants.map((c) => (
                <li key={c.code}>
                  <span className="font-mono text-xs">{c.code}</span> — {c.controle} :{' '}
                  <strong>{c.anomalies}</strong>
                </li>
              ))}
            </ul>
          </Alerte>
        </div>
      )}

      {/* ---- Fraicheur du raisonnement -------------------------------------
          Le stock est VIVANT, les besoins sont FIGES au dernier calcul MRP.
          Sans cette ligne, un tableau tout vert peut n'etre que le reflet d'un
          calcul qu'on n'a pas relance depuis que le plan a change — et l'erreur
          va toujours dans le sens rassurant : un plan revu a la hausse laisse
          les besoins bas, donc la projection haute, donc l'alerte verte. */}
      {n('besoins_perimes') > 0 ? (
        <Alerte ton="danger" titre="Les alertes reposent sur des besoins périmés">
          Le plan, une recette ou une densité a changé depuis le dernier calcul MRP
          {k.besoins_calcules_le
            ? ` du ${fmt.dateHeure(k.besoins_calcules_le as string)}`
            : ''}
          . Les couvertures affichées ci-dessous raisonnent sur des besoins qui ne
          correspondent plus aux recettes d’aujourd’hui. Relancez le calcul avant de
          décider quoi que ce soit.
        </Alerte>
      ) : k.besoins_calcules_le ? (
        <p className="text-[11px] text-attenue-texte">
          Besoins calcules le {fmt.dateHeure(k.besoins_calcules_le as string)} — le stock est lu en
          direct, les besoins datent de ce calcul.
        </p>
      ) : null}

      {/* ---- LES VUES, PLUTOT QU'UN ROULEAU ---------------------------------
          Tout ce qui suit tenait sur la meme page : quatre mille deux cents
          pixels, dix hauteurs d'ecran. On y trouvait tout, et c'est justement
          le probleme — une vue qu'on parcourt n'est plus une vue qu'on compare.
          Les quatre onglets reprennent l'ordre du classeur : ce qui brule, ce
          que disent les chiffres, ce qu'on pourrait gagner, ou part la matiere. */}
      <OngletsTableauDeBord className="mt-6" />

      {vue === 'situation' && <CockpitAnalyse vue="situation" />}

      {vue === 'analyse' && (
        <>
          <CockpitAnalyse vue="analyse" />
          <TitreBande texte="Concentration et dépendances" />
          <Concentration />
        </>
      )}

      {vue === 'opportunites' && <CockpitAnalyse vue="opportunites" />}

      {vue === 'matiere' && (
        <>
          <TitreBande texte="Ou part la matière" />
          <TableauDeBord />
        </>
      )}

      {/* ---- Mur de risques ------------------------------------------------
          IL RESTE DANS LA VUE « SITUATION », et nulle part ailleurs : c'est le
          seul ecran qui montre QUAND la rupture arrive, mois par mois. Le
          releguer dans une vue d'analyse reviendrait a le reserver a ceux qui
          cherchent, alors qu'il s'adresse a ceux qui decident.

          L'horizon vient du plan, jamais d'une constante : un plan de six mois
          affiche six colonnes, et annoncer « 12 mois » au-dessus serait faux. */}
      {vue === 'situation' && (
      <>
      <TitreBande
        texte={
          colonnes.length
            ? `Risque de rupture sur ${colonnes.length} mois`
            : 'Risque de rupture'
        }
      />
      <Carte repliable="cockpit.1">
        <CarteEntete>
          <CarteTitre>Tenue du plan de production</CarteTitre>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-attenue-texte">
            <Legende ton="bg-succes/25" texte="couvert" />
            <Legende ton="bg-alerte" texte="sous la sécurité" />
            <Legende ton="bg-danger" texte="plan non couvert" />
          </div>
        </CarteEntete>
        <CarteCorps className="p-0">
          {qRisques.isLoading ? (
            <div className="space-y-2 p-4">
              <Squelette className="h-6" />
              <Squelette className="h-6" />
              <Squelette className="h-6" />
            </div>
          ) : risques.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-succes">
              <CheckCircle2 className="size-4 shrink-0" />
              Aucune référence ne passe sous sa sécurité sur l’horizon du plan, arrivages comptés à leur
              date compris (moteur de couverture).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-bordure bg-attenue/50 text-[11px] font-medium uppercase tracking-[0.05em] text-attenue-texte">
                    <th className="px-3 py-2 text-left">Référence</th>
                    <th className="w-28 px-2 py-2 text-left">Sourcing</th>
                    <th className="w-20 px-2 py-2 text-right">Délai</th>
                    {colonnes.map((m) => (
                      <th key={m} className="w-9 px-0.5 py-2 text-center font-normal">
                        {m.slice(5)}
                        <div className="text-[9px] opacity-60">{m.slice(2, 4)}</div>
                      </th>
                    ))}
                    <th className="w-32 px-2 py-2 text-left">Equivalent</th>
                    <th className="w-28 px-2 py-2 text-right">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {risques.map((r) => (
                    <tr key={r.code_reference} className="border-b border-bordure/60">
                      <td className="max-w-56 px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{r.code_reference}</span>
                          {r.classe_abc && (
                            <Badge ton={r.classe_abc === 'A' ? 'danger' : 'neutre'}>
                              {r.classe_abc}
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {r.fournisseur_nom ?? 'sans fournisseur'}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {r.risque_sourcing === 'MONO-SOURCE' ? (
                          <Badge ton="danger">mono</Badge>
                        ) : (
                          <span className="text-[11px] text-attenue-texte">multi</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-attenue-texte">
                        {r.delai_livraison_jours == null ? '—' : `${r.delai_livraison_jours} j`}
                      </td>
                      {r.mois.map((m) => (
                        <td key={m.annee_mois} className="px-0.5 py-1.5">
                          <Infobulle
                            contenu={`${m.annee_mois} · plan ${fmt.nombre(m.besoin_kg, 0)} kg · arrivages ${fmt.nombre(m.entrees_kg, 0)} kg · fin de mois ${fmt.nombre(m.stock_fin_kg, 0)} kg (sécurité ${fmt.nombre(m.stock_min_kg, 0)})`}
                          >
                            <div
                              className={cn(
                                'mx-auto h-6 w-full rounded-[3px]',
                                m.statut === 'PLAN_NON_COUVERT'
                                  ? 'bg-danger'
                                  : m.statut === 'SOUS_SECURITE'
                                    ? 'bg-alerte'
                                    // Couvert reste en retrait : le regard doit
                                    // tomber sur les mois tendus et en rupture.
                                    : 'bg-succes/25',
                              )}
                            />
                          </Infobulle>
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        {(r.equivalent_dispo_kg ?? 0) > 0 ? (
                          <div>
                            <Badge ton="info">{fmt.compact(r.equivalent_dispo_kg)} kg</Badge>
                            <div className="truncate text-[10px] text-attenue-texte">
                              {r.equivalent_reference}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-attenue-texte">aucun</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <MargeDecision jours={r.marge_decision_jours} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                La marge est le nombre de jours restants avant le premier mois tendu,{' '}
                <strong>délai fournisseur deduit</strong>. Negative, il est deja trop tard pour
                commander a temps : il reste a arbitrer, substituer ou decaler la production.{' '}
                Une ligne avec un <strong>equivalent en stock</strong> se resout par un arbitrage
                depuis le plan d'achat, sans attendre de livraison.
              </p>
            </div>
          )}
        </CarteCorps>
      </Carte>
      </>
      )}

      {/* ---- Par famille ----------------------------------------------------
           L'atelier compte par famille, comme les classeurs : une feuille par
           famille, les couleurs en colonnes. Le tableau de bord en donne la
           tete — les cinq plus lourdes — et renvoie a la statistique complete.
           Le detail n'a pas sa place ici : on vient au cockpit pour decider,
           pas pour depouiller.                                                */}
      {vue === 'matiere' && peut('MOUVEMENTS', 'LIRE') && <BlocFamilles />}

      {/* ---- Controles de coherence ----------------------------------------
           La sante du referentiel accompagne la matiere : les deux repondent a
           « nos donnees disent-elles vrai ? », pas a « que faire aujourd'hui ». */}
      {vue === 'matiere' && (
      <>
      <TitreBande texte="Santé du référentiel" />
      <Carte repliable="cockpit.2">
        <CarteEntete>
          <CarteTitre>Contrôles métier</CarteTitre>
          <Badge ton={autres.length ? 'alerte' : 'succes'}>
            {autres.length ? `${autres.length} a traiter` : 'tout est vert'}
          </Badge>
        </CarteEntete>
        <CarteCorps className="p-0">
          {qCtl.isLoading ? (
            <div className="space-y-2 p-4">
              <Squelette className="h-6" />
              <Squelette className="h-6" />
            </div>
          ) : autres.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-succes">
              <CheckCircle2 className="size-4" />
              Aucune anomalie détectée.
            </div>
          ) : (
            <ul className="divide-y divide-bordure">
              {autres.map((c) => (
                <li
                  key={c.code}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertTriangle
                      className={cn(
                        'size-3.5 shrink-0',
                        c.criticite === 'CRITIQUE' ? 'text-danger' : 'text-alerte',
                      )}
                    />
                    <Infobulle contenu={`Controle ${c.code}`}>
                      <span className="truncate">{c.controle}</span>
                    </Infobulle>
                  </div>
                  <Badge ton={c.criticite === 'CRITIQUE' ? 'danger' : 'alerte'}>{c.anomalies}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CarteCorps>
      </Carte>
      </>
      )}
    </div>
  )
}

/**
 * LA PHRASE DU JOUR — ce que le classeur appelle « Insights du jour ».
 *
 * Un tableau de bord qui n'aligne que des nombres laisse a chacun le soin de
 * les relier, et deux personnes en tirent deux conclusions. La phrase tranche :
 * elle dit ce qui presse, en francais, avant que l'oeil n'ait a comparer quoi
 * que ce soit. Tous les cockpits des grands ERP s'ouvrent ainsi.
 *
 * ELLE SE CONSTRUIT DES MEMES CHIFFRES QUE LES TUILES, jamais d'une source
 * parallele : une phrase qui contredirait le nombre affiche a cote d'elle
 * ruinerait les deux.
 */
function phraseDuJour(
  k: Record<string, unknown>,
  economiesMad: number,
  nbOpportunites: number,
  nbMonoSource: number,
): string {
  const n = (c: string) => Number(k[c] ?? 0)
  const bouts: string[] = []

  // L'AVERTISSEMENT PASSE DEVANT. Si les besoins sont perimes, tout le reste de
  // la phrase raisonne sur des chiffres qui ne valent plus.
  if (n('besoins_perimes') > 0) {
    bouts.push(
      'Le plan, une recette ou une densité a changé depuis le dernier calcul : relancez-le avant de décider.',
    )
  }

  // LE MOTEUR DE COUVERTURE (27/10/2026) : une rupture prevue sur l'horizon du
  // plan, et ce qu'il faut commander aujourd'hui pour la couvrir.
  const alerte = n('nb_plan_non_couvert')
  if (alerte > 0) {
    bouts.push(
      `${alerte} référence(s) sur ${n('nb_references')} ont un plan non couvert sur l'horizon` +
        (n('nb_a_commander_aujourdhui') > 0 ? `, ${n('nb_a_commander_aujourdhui')} à commander aujourd'hui` : '') +
        (n('budget_a_engager_mad') > 0
          ? ` ; ${fmt.compact(n('budget_a_engager_mad'))} MAD de propositions à engager.`
          : '.'),
    )
  } else {
    bouts.push(`Aucune rupture prévue sur les ${n('nb_references')} références suivies.`)
  }

  if (economiesMad > 0) {
    bouts.push(
      `${fmt.compact(economiesMad)} MAD par an d'économies identifiées sur ` +
        `${nbOpportunites} référence(s), à qualité égale.`,
    )
  }
  // LA FRAGILITE DE FOND, qui ne se voit dans aucun compteur : une reference en
  // tension dont un seul fournisseur sait faire n'a pas de solution de repli.
  if (nbMonoSource > 0) {
    bouts.push(`${nbMonoSource} référence(s) en tension n'ont qu'une seule source.`)
  }
  if (n('nb_controles_bloquants') > 0) {
    bouts.push(`${n('nb_controles_bloquants')} contrôle(s) bloquant(s) à lever.`)
  }
  return bouts.join(' ')
}

/**
 * LE TITRE DE SECTION SEPARE VRAIMENT.
 *
 * Il etait un petit libelle gris perdu entre deux grilles : sur une page de
 * quatre mille pixels, rien ne disait ou finissait une idee et ou commencait la
 * suivante. Un filet et un peu d'air suffisent — c'est le decoupage qui manque,
 * pas la decoration.
 */
function TitreBande({ texte }: { texte: string }) {
  return (
    <h2
      className="mb-3 mt-8 flex items-center gap-3 text-[11px] font-semibold uppercase
                 tracking-wider text-attenue-texte first:mt-0"
    >
      <span className="whitespace-nowrap">{texte}</span>
      <span className="h-px flex-1 bg-bordure" />
    </h2>
  )
}

function Legende({ ton, texte }: { ton: string; texte: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('size-2.5 rounded-[2px]', ton)} />
      {texte}
    </span>
  )
}

/**
 * La barre des files a traiter.
 *
 * ELLE REMPLIT TOUJOURS LA LARGEUR, quel que soit le nombre de files, parce
 * qu'une bande divisee en parts egales n'a pas de « colonne manquante ». A une
 * seule file, la part unique occupe toute la bande et la file se lit en une
 * ligne : le compte, ce qu'il designe, et ou aller. A cinq, cinq parts.
 *
 * LE COMPTE VIENT EN PREMIER, gros et aligne sur les chiffres, parce que c'est
 * lui qu'on cherche du regard ; le libelle le suit, le detail sous lui. Une
 * part qui mene quelque part se comporte en lien : tout le rectangle est
 * cliquable, pas seulement trois mots en bas.
 */
function BarreFiles({ files }: { files: Tuile[] }) {
  return (
    <div
      className="grid divide-y divide-bordure overflow-hidden rounded-[var(--radius)]
                 border border-bordure bg-surface
                 sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0"
    >
      {files.map((t) => {
        const corps = (
          <div className="flex h-full items-center gap-3 px-4 py-3">
            <t.Icone className={cn('size-5 shrink-0', TEINTE[t.ton])} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={cn('text-2xl font-semibold leading-none tabular-nums', TEINTE[t.ton])}>
                  {t.affichage ?? t.valeur}
                </span>
                <span className="truncate text-[12.5px] font-medium text-texte">{t.libelle}</span>
              </div>
              {t.detail && (
                <div className="mt-0.5 truncate text-[11px] leading-snug text-attenue-texte">
                  {t.detail}
                </div>
              )}
            </div>
            {t.vers && <ArrowRight className="size-4 shrink-0 text-attenue-texte" />}
          </div>
        )
        return t.vers ? (
          <Link
            key={t.champ}
            to={t.vers}
            className="block transition-colors hover:bg-attenue/40"
          >
            {corps}
          </Link>
        ) : (
          <div key={t.champ}>{corps}</div>
        )
      })}
    </div>
  )
}

/**
 * Jours restants pour commander a temps.
 *
 * Negatif, ce n'est plus une alerte mais un constat : le delai fournisseur
 * depasse ce qui reste avant le manque. Le dire franchement vaut mieux que de
 * l'afficher en orange comme si commander suffisait encore.
 */
function MargeDecision({ jours }: { jours: number | null }) {
  if (jours == null) return <span className="text-attenue-texte">—</span>
  if (jours < 0) {
    return (
      <div>
        <div className="font-semibold tabular-nums text-danger">{jours} j</div>
        <div className="text-[10px] text-danger">trop tard</div>
      </div>
    )
  }
  return (
    <div>
      <div
        className={cn('font-semibold tabular-nums', jours <= 15 ? 'text-alerte' : 'text-texte')}
      >
        +{jours} j
      </div>
      <div className="text-[10px] text-attenue-texte">pour commander</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tableau de bord                                                             */
/* -------------------------------------------------------------------------- */

interface StatQualite {
  code_qualite: string
  qualite_nom: string
  statut: string
  cout_matiere_m2_mad: number | null
  kg_m2_total: number | null
  taux_realisation_pct: number | null
}

interface StatRole {
  code_qualite: string
  code_role: string
  role_libelle: string
  cout_m2_mad: number | null
}

/**
 * Deux graphiques, et deux seulement.
 *
 * Le premier classe les qualites par cout matiere : c'est la question que pose
 * un directeur devant une gamme de dix-huit produits. Le second decompose ce
 * cout entre les trois roles qui pesent le plus — poil, trame, chaine — parce
 * que savoir *qu'une* qualite coute cher ne dit pas *ou* passe l'argent.
 *
 * Pas de troisieme graphique tant qu'aucune sortie de production n'est saisie :
 * un camembert de consommation sur zero mouvement ne montrerait que du vide.
 */
export function TableauDeBord() {
  const { peut } = useAuth()
  const q = useQuery({
    queryKey: ['stats', 'qualites'],
    queryFn: () =>
      api.get<{ qualites: StatQualite[]; roles: StatRole[] }>('/api/stats/qualites'),
    enabled: peut('QUALITES', 'LIRE'),
    staleTime: 5 * 60_000,
  })

  const qualites = q.data?.qualites ?? []
  const roles = q.data?.roles ?? []

  const couts = useMemo(
    () =>
      qualites
        .filter((x) => (x.cout_matiere_m2_mad ?? 0) > 0)
        .map((x) => ({
          cle: x.code_qualite,
          libelle: x.qualite_nom || x.code_qualite,
          valeur: x.cout_matiere_m2_mad as number,
        })),
    [qualites],
  )

  /* Les trois roles les plus lourds, tous produits confondus : ce sont eux qui
     serviront de series. Les choisir globalement, et non qualite par qualite,
     garde la meme couleur pour le meme role d'une barre a l'autre. */
  const composition = useMemo(() => {
    const poids = new Map<string, { libelle: string; total: number }>()
    for (const r of roles) {
      const v = r.cout_m2_mad ?? 0
      const e = poids.get(r.code_role) ?? { libelle: r.role_libelle || r.code_role, total: 0 }
      e.total += v
      poids.set(r.code_role, e)
    }
    const majeurs = [...poids.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3)
      .map(([cle, v]) => ({ cle, libelle: v.libelle }))

    const parQualite = new Map<string, Record<string, number>>()
    for (const r of roles) {
      if (!majeurs.some((m) => m.cle === r.code_role)) continue
      const parts = parQualite.get(r.code_qualite) ?? {}
      parts[r.code_role] = (parts[r.code_role] ?? 0) + (r.cout_m2_mad ?? 0)
      parQualite.set(r.code_qualite, parts)
    }

    const donnees = [...parQualite.entries()]
      .map(([code, parts]) => ({
        cle: code,
        libelle: qualites.find((x) => x.code_qualite === code)?.qualite_nom || code,
        parts,
      }))
      .filter((d) => Object.values(d.parts).some((v) => v > 0))

    return { series: majeurs, donnees }
  }, [roles, qualites])

  if (q.isLoading) return <Squelette className="h-56 w-full" />
  if (!couts.length) {
    return (
      <Alerte ton="info" titre="Pas encore de coût matière">
        Le cout par metre carre se calcule a partir du CMUP des composants. Il apparaitra des la
        première réception valorisée sur chaque référence de recette.
      </Alerte>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <BarresRangees
        titre="Coût matière par qualité"
        sousTitre="CMUP des composants, rapporte au metre carre"
        unite="MAD/m2"
        donnees={couts}
      />
      {composition.donnees.length > 0 && (
        <BarresEmpilees
          titre="Ou passe le coût"
          sousTitre="Les trois rôles les plus lourds de la gamme"
          unite="MAD/m2"
          series={composition.series}
          donnees={composition.donnees}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Concentration de la valeur et dependance fournisseur                        */
/* -------------------------------------------------------------------------- */

/** Une ligne du stock projeté (moteur de couverture) : ici, pour la valeur du stock. */
interface LigneProjetee {
  code_reference: string
  designation: string | null
  valeur_totale_mad: number | null
  classe_abc: string | null
  statut: string | null
  jours_couverture: number | null
  fournisseur_nom: string | null
}

/**
 * Deux questions de direction, cote a cote : sur quelles references l'argent
 * est-il immobilise, et de qui depend-on pour le racheter.
 */
export function Concentration() {
  const { peut } = useAuth()
  const client = useQueryClient()
  const [calcul, setCalcul] = useState(false)

  const qStock = useQuery({
    queryKey: ['stock-projete-cockpit'],
    queryFn: ({ signal }) => api.get<LigneProjetee[]>('/api/stock/projete?limite=2000', { signal }),
    enabled: peut('STOCK', 'LIRE'),
    staleTime: 60_000,
  })
  const qFour = useQuery({
    queryKey: ['fournisseurs-scorecard'],
    queryFn: ({ signal }) => api.get<Fournisseur[]>('/api/fournisseurs/scorecard', { signal }),
    enabled: peut('FOURNISSEURS', 'LIRE'),
    staleTime: 5 * 60_000,
  })

  const lignes = qStock.data ?? []
  const classeCalculee = lignes.some((l) => l.classe_abc)

  const lancerClassification = async () => {
    setCalcul(true)
    try {
      await api.post('/api/classification', {})
      await client.invalidateQueries()
      toast.success('Classification ABC / XYZ calculée')
    } catch (e) {
      toast.error('Classification refusée', { description: String(e) })
    } finally {
      setCalcul(false)
    }
  }

  if (qStock.isLoading) return <Squelette className="h-64 w-full" />

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Pareto
        titre="Concentration de la valeur"
        sousTitre="Part cumulée du stock valorise, références triees par valeur"
        unite="MAD"
        donnees={lignes.map((l) => ({
          cle: l.code_reference,
          libelle: l.code_reference,
          valeur: l.valeur_totale_mad ?? 0,
        }))}
        action={
          classeCalculee ? undefined : (
            <div className="border-t border-ligne pt-2 text-[11px] text-attenue-texte">
              Les classes A, B et C ne sont pas encore attribuees : la courbe montre la
              concentration réelle, mais aucune référence ne porte sa classe.
              {peut('CATALOGUE', 'ECRIRE') && (
                <button
                  type="button"
                  onClick={() => void lancerClassification()}
                  disabled={calcul}
                  className="ml-2 rounded-[3px] border border-bordure px-2 py-0.5 text-[11px]
                             text-texte hover:bg-attenue disabled:opacity-50"
                >
                  {calcul ? 'Calcul en cours...' : 'Calculer la classification'}
                </button>
              )}
            </div>
          )
        }
      />
      {qFour.data && <BullesFournisseurs donnees={qFour.data} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Chiffres cles                                                               */
/* -------------------------------------------------------------------------- */

/**
 * La premiere rangee du poste de travail : cinq chiffres, lisibles de loin.
 *
 * Chacun porte une seconde ligne factuelle plutot qu'une variation. Le systeme
 * ne garde pas d'historique de ces indicateurs : afficher « +8 % » sous un
 * chiffre qu'on ne sait pas comparer a hier serait une invention, et un tableau
 * de bord qui invente une fois n'est plus cru sur le reste.
 */
function ChiffresCles() {
  const { peut } = useAuth()
  const naviguer = useNavigate()

  const q = useQuery({
    queryKey: ['cockpit'],
    queryFn: ({ signal }) => api.get<Record<string, number | string | null>>('/api/cockpit', { signal }),
    enabled: peut('COCKPIT', 'LIRE'),
  })

  // LES ECONOMIES NE SONT PAS DANS `/api/cockpit`. Elles vivent dans les
  // indicateurs de l'analyse, et la tuile affichait donc un zero franc a cote
  // d'un constat annoncant 3,9 millions — deux chiffres contradictoires a deux
  // centimetres l'un de l'autre. Meme cle de cache que `CockpitAnalyse` : la
  // requete est deja faite, celle-ci ne coute rien.
  const qa = useQuery({
    queryKey: ['cockpit-analyse'],
    queryFn: () =>
      api.get<{
        indicateurs?: { economies_total_mad?: number; nb_opportunites?: number }
        mono_source?: unknown[]
      }>('/api/cockpit/analyse'),
    enabled: peut('COCKPIT', 'LIRE'),
  })
  const eco = qa.data?.indicateurs
  const nbMonoSource = qa.data?.mono_source?.length ?? 0

  const k = q.data
  if (q.isLoading) {
    return (
      <div className="mb-3 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Squelette key={i} className="h-[68px]" />
        ))}
      </div>
    )
  }
  if (!k) return null

  const n = (c: string) => Number(k[c] ?? 0)
  // L'ETAT DES REFERENCES AU MOTEUR DE COUVERTURE (27/10/2026).
  const couvert = n('nb_couvert')
  const sousSecurite = n('nb_sous_securite')
  const planNonCouvert = n('nb_plan_non_couvert')
  const aujourdhui = n('nb_a_commander_aujourdhui')
  const bloquants = n('nb_controles_bloquants') + n('nb_controles_critiques')

  return (
    <div className="mb-3 flex flex-col gap-3">
      {/* ---- LA SITUATION, EN UNE PHRASE PUIS QUATRE CHIFFRES ---------------
          L'ecran commencait par quatorze tuiles de meme poids : cinq ici, deux
          sous « A traiter », sept sous « Situation ». L'oeil n'avait aucun
          point d'entree, et les memes references y etaient comptees trois fois
          sous trois noms — « A commander 106 », « Sous le stock minimum 106 »,
          « Ruptures 59 » deux fois. Un tableau de bord qui repete ses chiffres
          apprend a ne plus les lire.

          Les cockpits des grands ERP ouvrent tous de la meme facon : UNE PHRASE
          qui dit ou on en est, puis TROIS OU QUATRE nombres, et ces nombres
          parlent ARGENT. Un compte de references ne se compare a rien ; des
          dirhams se comparent entre eux et se hierarchisent tout seuls. Le
          classeur ne fait pas autre chose avec sa « Zone 1 — Insights du jour ».

          Les comptes n'ont pas disparu : ils sont devenus la PRECISION sous le
          chiffre, la ou ils expliquent au lieu de concurrencer. */}
      {/* LA PHRASE DU JOUR SE LIT COMME UN CHAPEAU D'ARTICLE, pas comme une
          alerte : un filet laiton a gauche, un corps plus grand, aucune boite.
          Encadree et teintee, elle ressemblait a un avertissement, et l'oeil
          la sautait comme on saute les bandeaux. */}
      <p className="max-w-[110ch] border-l-2 border-or pl-3 text-[14.5px] leading-relaxed text-texte">
        {phraseDuJour(k, eco?.economies_total_mad ?? 0, eco?.nb_opportunites ?? 0, nbMonoSource)}
      </p>

      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4">
        <CarteStat
          Icone={CircleDollarSign}
          libelle="Valeur du stock"
          valeur={fmt.compact(n('valeur_stock_mad'))}
          unite="MAD"
          precision={`${fmt.nombre(n('nb_references'), 0)} références suivies · ${couvert} couvertes`}
          ton="primaire"
          surClic={() => naviguer('/valorisation')}
          aide="Au CMUP, tous magasins confondus."
        />
        <CarteStat
          Icone={ShoppingCart}
          libelle="À engager"
          valeur={fmt.compact(n('budget_a_engager_mad'))}
          unite="MAD"
          precision={`${n('nb_propositions_a_traiter')} proposition(s) · ${fmt.compact(
            n('montant_bc_ouverts_mad'),
          )} deja engages`}
          ton="primaire"
          surClic={() => naviguer('/plan-achat')}
        />
        {/* LE PLAN NON COUVERT AU MOTEUR DE COUVERTURE (27/10/2026) : une rupture
            prevue sur l'horizon du plan ; la precision dit ce qui est a commander
            aujourd'hui et ce qui passe sous la securite sans rupture. */}
        <CarteStat
          Icone={TrendingDown}
          libelle="Plan non couvert"
          valeur={fmt.nombre(planNonCouvert, 0)}
          precision={`${aujourdhui} à commander aujourd’hui · ${sousSecurite} sous la sécurité`}
          ton={planNonCouvert > 0 ? 'danger' : sousSecurite > 0 ? 'alerte' : 'succes'}
          surClic={() => naviguer('/plan-achat')}
          aide="Moteur de couverture : le plan projeté jour par jour, stock compté et arrivages à leur date ; une rupture prévue sur l’horizon du plan."
        />
        <CarteStat
          Icone={Sparkles}
          libelle="Économies identifiées"
          valeur={fmt.compact(eco?.economies_total_mad ?? 0)}
          unite="MAD/an"
          precision={`${eco?.nb_opportunites ?? 0} référence(s) au-dessus du prix du groupe`}
          ton={(eco?.economies_total_mad ?? 0) > 0 ? 'succes' : 'neutre'}
          surClic={() => naviguer('/matrice-prix')}
          aide="A qualité égale : le même titrage, achete moins cher ailleurs dans le catalogue."
        />
      </div>

      {/* Les deux chiffres de VERACITE restent visibles, mais en retrait : ils
          ne pilotent pas, ils avertissent. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-attenue-texte">
        <button
          type="button"
          onClick={() => naviguer('/controles')}
          className={cn('inline-flex items-center gap-1.5 hover:text-texte',
            n('nb_controles_bloquants') > 0 && 'font-medium text-danger')}
        >
          <AlertTriangle className="size-3.5" />
          {bloquants} contrôle(s) en anomalie
          {n('nb_controles_bloquants') > 0 && ` dont ${n('nb_controles_bloquants')} bloquant(s)`}
        </button>
        {n('nb_classe_a_en_rupture') > 0 && (
          <button
            type="button"
            onClick={() => naviguer('/stock')}
            className="inline-flex items-center gap-1.5 font-medium text-danger hover:text-texte"
          >
            <Layers className="size-3.5" />
            {n('nb_classe_a_en_rupture')} référence(s) de classe A au plan non couvert
          </button>
        )}
      </div>

      {couvert + sousSecurite + planNonCouvert > 0 && (
        <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-attenue-texte">
            État du catalogue suivi
          </p>
          <BarreRepartition
            parts={[
              { libelle: 'Couvert', valeur: couvert, ton: 'succes' },
              { libelle: 'Sous la sécurité', valeur: sousSecurite, ton: 'alerte' },
              { libelle: 'Plan non couvert', valeur: planNonCouvert, ton: 'danger' },
            ]}
          />
        </div>
      )}
    </div>
  )
}


/**
 * Les familles qui portent le plus de stock, et ce qui est entre cette annee.
 *
 * POURQUOI LA FAMILLE ET NON LA REFERENCE. Une liste de references ne se lit
 * pas d'un coup d'oeil ; l'atelier raisonne par famille — « combien de 1500
 * dtex » — et c'est la forme des classeurs depuis toujours.
 *
 * CE QUI N'EST PAS CLASSE APPARAIT AUSSI, sous « Sans famille » : l'ecarter
 * donnerait un total faux et ferait croire le catalogue plus propre qu'il
 * n'est. Cette ligne-la est une invitation a completer le catalogue.
 */
export function BlocFamilles() {
  const naviguer = useNavigate()
  const droits = useDroits('MOUVEMENTS')
  const q = useQuery({
    queryKey: ['stats', 'familles'],
    queryFn: ({ signal }) => api.get<Record<string, Record<string, unknown>[]>>('/api/stats/familles', { signal }),
    staleTime: 5 * 60_000,
  })

  const familles = q.data?.familles ?? []
  // Une ligne par (famille, annee) : on garde la plus recente de chaque famille.
  const tete = useMemo(() => {
    const par = new Map<string, Record<string, unknown>>()
    for (const f of familles) {
      const cle = String(f.code_famille ?? '')
      const vue = par.get(cle)
      if (!vue || String(f.annee ?? '') > String(vue.annee ?? '')) par.set(cle, f)
    }
    return [...par.values()]
      .sort((x, y) => Number(y.stock_kg ?? 0) - Number(x.stock_kg ?? 0))
      .slice(0, 6)
  }, [familles])

  const total = tete.reduce((s, f) => s + Number(f.stock_kg ?? 0), 0)
  const voitValeur = droits.visible('valeur_dhs')

  if (q.isLoading) {
    return (
      <>
        <TitreBande texte="Par famille" />
        <Carte>
          <CarteCorps className="space-y-2 p-4">
            <Squelette className="h-6" />
            <Squelette className="h-6" />
          </CarteCorps>
        </Carte>
      </>
    )
  }
  if (tete.length === 0) return null

  return (
    <>
      <TitreBande texte="Par famille" />
      <Carte repliable="cockpit.familles">
        <CarteEntete>
          <CarteTitre>Ce que chaque famille porte</CarteTitre>
          <button
            type="button"
            onClick={() => naviguer('/statistiques')}
            className="text-[11.5px] font-medium text-primaire hover:underline"
          >
            Toutes les familles et leurs couleurs
          </button>
        </CarteEntete>
        <CarteCorps className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[13px] lg:min-w-0">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Famille</th>
                  <th className="w-28 px-2 py-2 text-right">Stock</th>
                  <th className="w-32 px-3 py-2 text-left">Part</th>
                  <th className="w-28 px-2 py-2 text-right">Entrees</th>
                  {voitValeur && <th className="w-32 px-2 py-2 text-right">Valeur</th>}
                </tr>
              </thead>
              <tbody>
                {tete.map((f, i) => {
                  const stock = Number(f.stock_kg ?? 0)
                  const sansFamille = String(f.code_famille ?? '') === '(sans famille)'
                  return (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="max-w-56 px-3 py-1.5">
                        <div className="truncate font-medium">{String(f.famille_libelle ?? '')}</div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {sansFamille
                            ? 'a classer dans le catalogue'
                            : String(f.categorie_libelle ?? '')}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {stock > 0 ? `${fmt.nombre(stock, 0)} kg` : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-bordure/60">
                          <div
                            className={cn('h-full rounded-full', sansFamille ? 'bg-alerte' : 'bg-primaire')}
                            style={{ width: `${Math.max(1, total > 0 ? (stock / total) * 100 : 0)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-succes">
                        {Number(f.entrees_kg ?? 0) > 0 ? fmt.nombre(Number(f.entrees_kg), 0) : '—'}
                      </td>
                      {voitValeur && (
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt.nombre(Number(f.valeur_dhs ?? 0), 0)}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CarteCorps>
      </Carte>
    </>
  )
}

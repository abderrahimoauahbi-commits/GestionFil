/**
 * Plans de production — document maitre-detail sur periode glissante.
 *
 * Le plan ne se saisit pas mois par mois : il se DEDUIT de trois choses, comme
 * la feuille `Production_Plan` du classeur.
 *
 *   1. l'entete : quelles qualites on produit, et sur quelle base mensuelle ;
 *   2. la saisonnalite : un profil ANNUEL de douze coefficients par qualite,
 *      qui se repete d'une annee sur l'autre ;
 *   3. la croissance annuelle, COMPOSEE sur le temps ecoule.
 *
 *   annees_ecoulees = rang / 12
 *   facteur         = (1 + croissance)^annees_ecoulees
 *   m2(qualite, k)  = ARRONDI(base x coefficient[mois calendaire] x facteur, 0)
 *
 * La croissance est composee, pas lineaire : sur trois ans a 10 %/an, l'ecart
 * depasse 2 %. Et le resultat est un ENTIER — on ne produit pas un demi-tapis.
 *
 * La grille du bas n'est donc pas une zone de saisie mais un resultat : elle se
 * recalcule a chaque frappe, et le serveur la reconstruit a l'enregistrement.
 * Saisir les m2 a la main les ferait diverger de leur propre formule des que
 * l'un des trois termes change.
 *
 * Une qualite ne peut appartenir qu'a UN plan actif : deux plans produisant la
 * meme qualite additionneraient leurs besoins sur les memes matieres. Clore un
 * plan libere ses qualites et retire ses besoins du calcul d'achat.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Calculator,
  Camera,
  FileText,
  Layers,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { CelluleEditable } from '../composants/CelluleEditable'
import { DataTable, type ColonneDT } from '../composants/DataTable'
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
import { Aide, Dialogue, DialogueContenu, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'PLANS'

const MOIS_COURT = [
  'Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jui',
  'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec',
]
const MOIS_LONG = [
  'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
]

type Statut = 'BROUILLON' | 'SIMULATION' | 'EN_COURS' | 'CLOTURE'

interface Plan extends Record<string, unknown> {
  id_plan: string
  annee: number
  numero_version: number
  libelle: string
  scenario_nom: string | null
  statut: Statut
  actif: number
  date_debut: string
  date_fin: string
  mois_horizon: number
  croissance_annuelle_pct: number
  nb_lignes: number
  nb_qualites: number
  nb_qualites_perimees: number
  nb_besoins: number
  m2_total: number
  date_creation: string
  date_modification: string | null
  date_validation: string | null
  date_cloture: string | null
  cree_par: string | null
  modifie_par: string | null
  valide_par: string | null
  cloture_par: string | null
}

interface QualiteDispo {
  code_qualite: string
  nom: string
  poids_commercial_m2: number
  nb_composition: number
  deja_dans_plan: string | null
}

interface EnteteApi {
  qualites: {
    code_qualite: string
    qualite_nom: string
    qualite_statut: string
    poids_commercial_m2: number
    nb_composition: number
    m2_base_mensuel: number
  }[]
  saisonnalite: { code_qualite: string; mois: number; coefficient: number }[]
}

/** Une qualite retenue par le plan, telle qu'on l'edite. */
interface LigneEntete extends Record<string, unknown> {
  code_qualite: string
  qualite_nom: string
  qualite_statut: string
  nb_composition: number
  m2_base_mensuel: number | null
}

interface Entete {
  id_plan: string | null
  libelle: string
  scenario_nom: string
  /** Mois de depart, format AAAA-MM (champ <input type="month">). */
  date_debut: string
  mois_horizon: number
  croissance_annuelle_pct: string
}

const TON_STATUT: Record<Statut, 'neutre' | 'info' | 'succes' | 'contour'> = {
  BROUILLON: 'neutre',
  SIMULATION: 'info',
  EN_COURS: 'succes',
  CLOTURE: 'contour',
}

/** Libelle lisible : le statut brut sert de cle, pas d'affichage. */
const LIBELLE_STATUT: Record<Statut, string> = {
  BROUILLON: 'Brouillon',
  SIMULATION: 'Simulation',
  EN_COURS: 'En cours',
  CLOTURE: 'Cloture',
}

/** Statuts dans lesquels l'entete reste modifiable. */
const MODIFIABLE: Statut[] = ['BROUILLON', 'SIMULATION']

const moisCourant = () => new Date().toISOString().slice(0, 7)

const enteteVide = (): Entete => ({
  id_plan: null,
  libelle: '',
  scenario_nom: '',
  date_debut: moisCourant(),
  mois_horizon: 12,
  croissance_annuelle_pct: '0',
})

export function Plans() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const confirmation = useConfirmation()

  const [edition, setEdition] = useState<string | null>(null)
  const [enCreation, setEnCreation] = useState(false)
  const [entete, setEntete] = useState<Entete>(enteteVide())
  const [lignes, setLignes] = useState<LigneEntete[]>([])
  /** Coefficients locaux : cle `qualite|mois`. */
  const [coefs, setCoefs] = useState<Record<string, number>>({})
  /**
   * Selection GROUPEE : on ouvre un panneau, on coche les qualites voulues, puis
   * on ajoute le lot d'un coup. Un plan compte souvent quinze qualites — les
   * ajouter une par une, c'est quinze allers-retours.
   */
  const [panneauOuvert, setPanneauOuvert] = useState(false)
  const [choix, setChoix] = useState<Record<string, boolean>>({})
  const [erreur, setErreur] = useState<string | null>(null)

  const qPlans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<Plan[]>('/api/plans'),
  })

  const courant = enCreation ? undefined : qPlans.data?.find((p) => p.id_plan === edition)

  const qEntete = useQuery({
    queryKey: ['plan-entete', edition],
    queryFn: () => api.get<EnteteApi>(`/api/plans/${edition}/entete`),
    enabled: !!edition,
  })

  const qDispo = useQuery({
    queryKey: ['qualites-disponibles', edition],
    queryFn: () =>
      api.get<QualiteDispo[]>(
        `/api/plans/qualites-disponibles${edition ? `?id_plan=${edition}` : ''}`,
      ),
    enabled: edition !== null,
  })

  // La grille se remplit UNE FOIS depuis le serveur, a l'ouverture du plan.
  // Sans ce garde-fou, toute relecture du dossier — retour sur la fenetre,
  // invalidation d'une autre requete — rendait a chaque case sa valeur
  // d'origine : la correction d'un chiffre semblait tout simplement refusee.
  const rempli = useRef<string | null>(null)

  useEffect(() => {
    if (!qEntete.data || rempli.current === edition) return
    rempli.current = edition
    setLignes(
      qEntete.data.qualites.map((q) => ({
        code_qualite: q.code_qualite,
        qualite_nom: q.qualite_nom,
        qualite_statut: q.qualite_statut,
        nb_composition: q.nb_composition,
        m2_base_mensuel: q.m2_base_mensuel,
      })),
    )
    const c: Record<string, number> = {}
    for (const s of qEntete.data.saisonnalite) c[`${s.code_qualite}|${s.mois}`] = s.coefficient
    setCoefs(c)
  }, [qEntete.data, edition])

  // --- Navigation ------------------------------------------------------------

  function ouvrirCreation() {
    rempli.current = null
    setEdition('')
    setEnCreation(true)
    setEntete(enteteVide())
    setLignes([])
    setCoefs({})
    setErreur(null)
  }

  function ouvrir(p: Plan) {
    rempli.current = null
    setEdition(p.id_plan)
    setEnCreation(false)
    setEntete({
      id_plan: p.id_plan,
      libelle: p.libelle,
      scenario_nom: p.scenario_nom ?? '',
      date_debut: (p.date_debut ?? '').slice(0, 7),
      mois_horizon: p.mois_horizon ?? 12,
      croissance_annuelle_pct: String(p.croissance_annuelle_pct ?? 0),
    })
    setLignes([])
    setCoefs({})
    setErreur(null)
  }

  function fermer() {
    rempli.current = null
    setEdition(null)
    setEnCreation(false)
    setErreur(null)
  }

  // --- Mutations -------------------------------------------------------------

  const enregistrement = useMutation({
    mutationFn: () =>
      api.put<{ id_plan: string; cree: boolean; lignes_generees: number; m2_total: number }>(
        '/api/plans',
        {
          id_plan: enCreation ? null : entete.id_plan,
          libelle: entete.libelle.trim(),
          scenario_nom: entete.scenario_nom.trim() || null,
          date_debut: entete.date_debut,
          mois_horizon: entete.mois_horizon,
          croissance_annuelle_pct: Number(entete.croissance_annuelle_pct) || 0,
          qualites: lignes.map((l) => ({
            code_qualite: l.code_qualite,
            m2_base_mensuel: l.m2_base_mensuel ?? 0,
          })),
          // Le profil annuel entier, pour toutes les qualites retenues : douze
          // coefficients chacune, meme si le plan ne couvre que six mois.
          saisonnalite: lignes.flatMap((l) =>
            Array.from({ length: 12 }, (_, i) => ({
              code_qualite: l.code_qualite,
              mois: i + 1,
              coefficient: coef(l.code_qualite, i + 1),
            })),
          ),
        },
      ),
    onSuccess: async (r) => {
      toast.success(r.cree ? 'Plan cree' : 'Plan mis a jour', {
        description: `${r.lignes_generees} case(s) deployee(s) · ${fmt.entier(r.m2_total)} m² sur la periode`,
      })
      setErreur(null)
      await qc.invalidateQueries({ queryKey: ['plans'] })
      void qc.invalidateQueries({ queryKey: ['plan-entete'] })
      void qc.invalidateQueries({ queryKey: ['qualites-disponibles'] })
      if (enCreation) {
        setEdition(r.id_plan)
        setEnCreation(false)
        setEntete((s) => ({ ...s, id_plan: r.id_plan }))
      }
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : String(e)),
  })

  const transition = useMutation({
    mutationFn: (v: { id: string; statut: Statut }) =>
      api.put(`/api/plans/${v.id}/statut`, { statut: v.statut }),
    onSuccess: (_r, v) => {
      toast.success(`Plan passe en ${LIBELLE_STATUT[v.statut].toLowerCase()}`)
      void qc.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  const etape = useMutation({
    mutationFn: (v: { id: string; chemin: string }) =>
      api.post<Record<string, unknown>>(`/api/plans/${v.id}/${v.chemin}`),
    onSuccess: (r, v) => {
      const messages: Record<string, string> = {
        'figer-recettes': `${r.recettes_figees} qualite(s) figee(s)`,
        mrp: `${r.lignes_generees} besoin(s) · ${fmt.nombre(r.total_kg as number, 2)} kg`,
        snapshot: `${r.lignes_figees} ligne(s) archivee(s)`,
      }
      toast.success(messages[v.chemin] ?? 'Operation effectuee')
      void qc.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  /**
   * Recalcul serveur : redeploie la grille a partir des bases et coefficients
   * REELLEMENT enregistres, et recharge ce que la base contient. C'est le moyen
   * de lever un doute entre l'apercu affiche et le contenu stocke.
   */
  const recalcul = useMutation({
    mutationFn: (id: string) =>
      api.post<{ lignes_generees: number; m2_total: number }>(`/api/plans/${id}/recalculer`),
    onSuccess: async (r) => {
      toast.success('Grille recalculee', {
        description: `${r.lignes_generees} case(s) · ${fmt.entier(r.m2_total)} m² sur la periode`,
      })
      await qc.invalidateQueries({ queryKey: ['plans'] })
      await qc.invalidateQueries({ queryKey: ['plan-entete'] })
      await qc.invalidateQueries({ queryKey: ['plan-lignes'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  const cloture = useMutation({
    mutationFn: (id: string) =>
      api.post<{ qualites_liberees: number }>(`/api/plans/${id}/cloturer`),
    onSuccess: (r) => {
      toast.success('Plan cloture', {
        description: `${r.qualites_liberees} qualite(s) liberee(s) · ses besoins sortent du plan d'achat`,
      })
      void qc.invalidateQueries({ queryKey: ['plans'] })
      void qc.invalidateQueries({ queryKey: ['qualites-disponibles'] })
      fermer()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  const suppression = useMutation({
    mutationFn: (id: string) => api.delete(`/api/plans/${id}`),
    onSuccess: () => {
      toast.success('Plan supprime')
      void qc.invalidateQueries({ queryKey: ['plans'] })
      fermer()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  // --- Grille locale ---------------------------------------------------------

  const coef = (q: string, mois: number) => coefs[`${q}|${mois}`] ?? 1
  const majCoef = (q: string, mois: number, v: number) =>
    setCoefs((c) => ({ ...c, [`${q}|${mois}`]: v }))

  const croissance = Number(entete.croissance_annuelle_pct) || 0

  /** Mois de la periode : rang, mois calendaire (1..12), libelle date. */
  const periode = useMemo(() => {
    const [an, mo] = entete.date_debut.split('-').map(Number)
    if (!an || !mo) return []
    return Array.from({ length: entete.mois_horizon }, (_, k) => {
      const total = an * 12 + (mo - 1) + k
      const annee = Math.floor(total / 12)
      const mois = (total % 12) + 1
      return { rang: k, mois, annee, libelle: `${MOIS_COURT[mois - 1]} ${String(annee).slice(2)}` }
    })
  }, [entete.date_debut, entete.mois_horizon])

  /**
   * La saisonnalite est un profil ANNUEL : douze coefficients par qualite, quelle
   * que soit la duree du plan. Un plan de trois ans repasse trois fois sur les
   * memes douze valeurs.
   *
   * Toute case manquante est amorcee a 1,00 — un mois a pleine charge, valeur
   * neutre et visible — plutot que laissee vide : le serveur refuse une grille
   * trouee, et un blanc dans un tableau ne dit pas s'il vaut zero ou un.
   */
  useEffect(() => {
    if (!lignes.length) return
    setCoefs((actuels) => {
      const complet = { ...actuels }
      let ajouts = 0
      for (const l of lignes) {
        for (let mois = 1; mois <= 12; mois++) {
          const cle = `${l.code_qualite}|${mois}`
          if (complet[cle] === undefined) {
            complet[cle] = 1
            ajouts++
          }
        }
      }
      return ajouts ? complet : actuels
    })
  }, [lignes])

  /**
   * Meme formule que le serveur : l'ecran montre ce qui sera enregistre.
   *
   *   facteur = (1 + croissance)^(rang / 12)   <- COMPOSEE, pas lineaire
   *   m2      = ARRONDI(base x coefficient x facteur, 0)
   */
  const m2 = (l: LigneEntete, rang: number, mois: number) =>
    Math.round(
      (l.m2_base_mensuel ?? 0) * coef(l.code_qualite, mois) * (1 + croissance / 100) ** (rang / 12),
    )

  const totalPeriode = lignes.reduce(
    (s, l) => s + periode.reduce((t, p) => t + m2(l, p.rang, p.mois), 0),
    0,
  )

  /**
   * Qualites que ce plan peut encore prendre.
   *
   * Deduites des recettes disponibles, et non de la liste des qualites : une
   * qualite sans recette validee libre ne serait proposee que pour aboutir a un
   * choix impossible a l'etape suivante.
   */
  const qualitesDisponibles = useMemo(
    () =>
      (qDispo.data ?? [])
        .filter((q) => !lignes.some((l) => l.code_qualite === q.code_qualite))
        .sort((a, b) => a.code_qualite.localeCompare(b.code_qualite)),
    [qDispo.data, lignes],
  )

  function ouvrirPanneau() {
    setChoix({})
    setPanneauOuvert(true)
  }

  const nbCoches = Object.values(choix).filter(Boolean).length

  const basculerQualite = (code: string) =>
    setChoix((c) => ({ ...c, [code]: !c[code] }))

  /** Ajoute d'un coup toutes les qualites cochees. */
  function ajouterSelection() {
    const nouvelles: LigneEntete[] = []
    for (const [code, coche] of Object.entries(choix)) {
      if (!coche) continue
      // Garde-fou : la meme qualite ne peut pas entrer deux fois. Le serveur le
      // refuse aussi, mais autant ne pas construire un lot voue au rejet.
      const q = qDispo.data?.find((x) => x.code_qualite === code)
      if (!q || lignes.some((l) => l.code_qualite === code)) continue
      nouvelles.push({
        code_qualite: q.code_qualite,
        qualite_nom: q.nom,
        qualite_statut: 'ACTIF',
        nb_composition: q.nb_composition,
        m2_base_mensuel: null,
      })
    }
    if (!nouvelles.length) {
      toast.error('Aucune qualite cochee.')
      return
    }
    setLignes((ls) => [...ls, ...nouvelles])
    setPanneauOuvert(false)
    setChoix({})
    toast.success(`${nouvelles.length} qualite(s) ajoutee(s) au plan`)
  }

  // --- Verifications locales --------------------------------------------------

  const problemes: string[] = []
  if (!entete.libelle.trim()) problemes.push('le libelle est obligatoire')
  if (!/^\d{4}-\d{2}$/.test(entete.date_debut)) problemes.push('le mois de depart est obligatoire')
  if (!lignes.length) problemes.push('aucune qualite retenue')
  if (lignes.some((l) => l.m2_base_mensuel === null))
    problemes.push('chaque qualite doit porter une base mensuelle')
  const trous = lignes.reduce(
    (n, l) =>
      n +
      Array.from({ length: 12 }, (_, i) => i + 1).filter(
        (mois) => coefs[`${l.code_qualite}|${mois}`] === undefined,
      ).length,
    0,
  )
  if (trous > 0) problemes.push(`${trous} coefficient(s) de saisonnalite manquant(s)`)
  const perimees = lignes.filter((l) => l.qualite_statut !== 'ACTIF')

  // ==========================================================================
  // Rendu : liste
  // ==========================================================================

  if (edition === null) {
    const colonnes: ColonneDT<Plan>[] = [
      {
        champ: 'libelle',
        entete: 'Plan',
        filtre: 'texte',
        rendu: (p) => (
          <div className="min-w-0">
            <div className="font-medium">{p.libelle}</div>
            <div className="text-[11px] text-attenue-texte">
              v{p.numero_version}
              {p.scenario_nom ? ` · ${p.scenario_nom}` : ''}
            </div>
          </div>
        ),
      },
      {
        champ: 'date_debut',
        entete: 'Periode',
        largeur: '180px',
        rendu: (p) => (
          <span className="tabular-nums">
            {fmt.date(p.date_debut)} → {fmt.date(p.date_fin)}
          </span>
        ),
      },
      {
        champ: 'mois_horizon',
        entete: 'Mois',
        numerique: true,
        largeur: '70px',
        secondaire: true,
      },
      {
        champ: 'statut',
        entete: 'Statut',
        largeur: '120px',
        filtre: 'liste',
        rendu: (p) => (
          <div className="flex items-center gap-1">
            <Badge ton={TON_STATUT[p.statut]}>{LIBELLE_STATUT[p.statut]}</Badge>
            {p.statut === 'EN_COURS' && <Lock className="size-3 text-attenue-texte" />}
          </div>
        ),
      },
      {
        champ: 'nb_qualites',
        entete: 'Qualites',
        numerique: true,
        largeur: '110px',
        rendu: (p) =>
          p.nb_qualites_perimees > 0 ? (
            <Badge ton="danger">{p.nb_qualites_perimees} perimee(s)</Badge>
          ) : (
            fmt.entier(p.nb_qualites)
          ),
      },
      {
        champ: 'm2_total',
        entete: 'm² periode',
        numerique: true,
        largeur: '120px',
        rendu: (p) => fmt.entier(p.m2_total),
      },
      {
        champ: 'nb_besoins',
        entete: 'Besoins',
        numerique: true,
        largeur: '90px',
        rendu: (p) =>
          p.statut === 'CLOTURE' ? (
            <span className="text-attenue-texte" title="Un plan cloture n'alimente plus le plan d'achat">
              hors calcul
            </span>
          ) : (
            fmt.entier(p.nb_besoins)
          ),
      },
      {
        champ: 'date_cloture',
        entete: 'Cloture le',
        largeur: '140px',
        secondaire: true,
        rendu: (p) => fmt.dateHeure(p.date_cloture),
      },
    ]

    return (
      <div>
        <EnTetePage
          titre="Plans de production"
          description="Periode glissante : base mensuelle par recette, saisonnalite par mois, croissance au prorata."
          actions={
            droits.peutEcrire && (
              <Bouton onClick={ouvrirCreation}>
                <Plus />
                Nouveau plan
              </Bouton>
            )
          }
        />

        <DataTable
          module={MODULE}
          colonnes={colonnes}
          lignes={qPlans.data}
          chargement={qPlans.isLoading}
          cle={(p) => p.id_plan}
          surClic={ouvrir}
          placeholderRecherche="Libelle, scenario, statut..."
          titreCarte={(p) => `${p.libelle} (v${p.numero_version})`}
          videTitre="Aucun plan"
          videDescription="Un plan valide est la seule source de besoins pour le MRP et le plan d'achat."
          videAction={
            droits.peutEcrire && (
              <Bouton onClick={ouvrirCreation}>
                <Plus />
                Nouveau plan
              </Bouton>
            )
          }
          actions={(p) => (
            <div className="flex justify-end gap-0.5">
              <Bouton
                variante="discret"
                taille="icone-xs"
                onClick={() => ouvrir(p)}
                aria-label="Ouvrir"
                title={MODIFIABLE.includes(p.statut) ? 'Modifier' : 'Consulter'}
              >
                <Pencil />
              </Bouton>
              {droits.peutEcrire && p.statut !== 'CLOTURE' && (
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  onClick={() =>
                    confirmation.demander({
                      titre: `Cloturer ${p.libelle} ?`,
                      destructif: true,
                      libelleConfirmer: 'Cloturer',
                      description:
                        "Ses besoins sortiront du plan d'achat et ses recettes redeviendront " +
                        'disponibles pour un autre plan. Le plan reste consultable.',
                      action: () => cloture.mutate(p.id_plan),
                    })
                  }
                  aria-label="Cloturer"
                  title="Cloturer"
                  className="text-alerte hover:bg-alerte/10"
                >
                  <Undo2 />
                </Bouton>
              )}
              {droits.peutEcrire && MODIFIABLE.includes(p.statut) && (
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  onClick={() =>
                    confirmation.demander({
                      titre: `Supprimer ${p.libelle} ?`,
                      destructif: true,
                      description: "Ce plan n'a jamais ete valide : il sera efface.",
                      action: () => suppression.mutate(p.id_plan),
                    })
                  }
                  aria-label="Supprimer"
                  className="text-danger hover:bg-danger/10"
                >
                  <Trash2 />
                </Bouton>
              )}
            </div>
          )}
        />
        {confirmation.element}
      </div>
    )
  }

  // ==========================================================================
  // Rendu : document
  // ==========================================================================

  const statut: Statut = courant?.statut ?? 'BROUILLON'
  const modifiable = droits.peutEcrire && (enCreation || MODIFIABLE.includes(statut))
  const champModifiable = (champ: string) => modifiable && droits.modifiable(champ)

  const colonnesEntete: ColonneDT<LigneEntete>[] = [
    {
      champ: 'code_qualite',
      entete: 'Qualite',
      largeur: '200px',
      rendu: (l) => (
        <div className="min-w-0">
          <span className="font-medium">{l.code_qualite}</span>
          <span className="ml-1.5 text-[11px] text-attenue-texte">{l.qualite_nom}</span>
        </div>
      ),
    },
    {
      champ: 'nb_composition',
      entete: 'Composition',
      largeur: '180px',
      rendu: (l) => (
        <div className="flex items-center gap-1.5">
          <span className="text-attenue-texte">{l.nb_composition} ligne(s)</span>
          {l.qualite_statut !== 'ACTIF' && <Badge ton="danger">{l.qualite_statut}</Badge>}
        </div>
      ),
    },
    {
      champ: 'm2_total',
      entete: 'Total periode',
      numerique: true,
      largeur: '140px',
      valeurTri: (l) => periode.reduce((t, p) => t + m2(l, p.rang, p.mois), 0),
      rendu: (l) => (
        <span className="tabular-nums font-medium">
          {fmt.entier(periode.reduce((t, p) => t + m2(l, p.rang, p.mois), 0))}
        </span>
      ),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre={enCreation ? 'Nouveau plan' : entete.libelle || 'Plan'}
        description={
          courant
            ? `v${courant.numero_version} · ${fmt.date(courant.date_debut)} → ${fmt.date(courant.date_fin)} · cree le ${fmt.dateHeure(courant.date_creation)}${courant.cree_par ? ` par ${courant.cree_par}` : ''}`
            : "Choisissez les recettes, leur base mensuelle et la saisonnalite : la grille se deduit."
        }
        actions={
          <>
            <Bouton variante="contour" onClick={fermer}>
              <ArrowLeft />
              Retour
            </Bouton>
            {courant && droits.peutEcrire && (
              <>
                {statut === 'BROUILLON' && (
                  <Bouton
                    variante="contour"
                    onClick={() => transition.mutate({ id: courant.id_plan, statut: 'SIMULATION' })}
                    disabled={problemes.length > 0}
                  >
                    <Sparkles />
                    Passer en simulation
                  </Bouton>
                )}
                {statut === 'SIMULATION' && (
                  <>
                    <Bouton
                      variante="contour"
                      onClick={() =>
                        etape.mutate({ id: courant.id_plan, chemin: 'figer-recettes' })
                      }
                    >
                      <Lock />
                      Figer les recettes
                    </Bouton>
                    {droits.peutValider && (
                      <Bouton
                        onClick={() => transition.mutate({ id: courant.id_plan, statut: 'EN_COURS' })}
                      >
                        <ShieldCheck />
                        Valider
                      </Bouton>
                    )}
                  </>
                )}
                {statut === 'EN_COURS' && (
                  <>
                    <Bouton
                      variante="contour"
                      onClick={() => etape.mutate({ id: courant.id_plan, chemin: 'mrp' })}
                    >
                      <Calculator />
                      Calculer le MRP
                    </Bouton>
                    <Bouton
                      variante="contour"
                      onClick={() => etape.mutate({ id: courant.id_plan, chemin: 'snapshot' })}
                    >
                      <Camera />
                      Archiver
                    </Bouton>
                  </>
                )}
              </>
            )}
            {modifiable && (
              <Bouton
                onClick={() => enregistrement.mutate()}
                chargement={enregistrement.isPending}
                disabled={problemes.length > 0}
              >
                <Save />
                Enregistrer entete et grille
              </Bouton>
            )}
          </>
        }
      />

      {erreur && (
        <Alerte ton="danger" titre="Enregistrement refuse" className="mb-3">
          {erreur}
        </Alerte>
      )}

      {!enCreation && !MODIFIABLE.includes(statut) && (
        <Alerte ton={statut === 'EN_COURS' ? 'info' : 'alerte'} className="mb-3">
          {statut === 'EN_COURS'
            ? "Plan en service : il alimente le MRP et le plan d'achat, et n'est plus modifiable. Creez une nouvelle version pour le reviser."
            : "Plan cloture : ses besoins sont sortis du plan d'achat et ses recettes ont ete liberees."}
        </Alerte>
      )}

      {perimees.length > 0 && (
        <Alerte ton="danger" titre="Qualites plus actives" className="mb-3">
          {perimees.map((l) => `${l.code_qualite} (${l.qualite_statut})`).join(', ')}. Remplacez-les
          avant de figer : un plan ne peut entrer en service que sur des qualites actives.
        </Alerte>
      )}

      <div className="space-y-3">
        {/* --- Entete ------------------------------------------------------ */}
        <Carte>
          <CarteEntete>
            <CarteTitre className="flex items-center gap-1.5">
              <FileText className="size-3.5" />
              Entete — periode glissante
            </CarteTitre>
            <div className="flex items-center gap-2 text-[11px] text-attenue-texte">
              {courant && (
                <>
                  <span>
                    Modifie{' '}
                    {courant.date_modification
                      ? `${fmt.dateHeure(courant.date_modification)}${courant.modifie_par ? ` (${courant.modifie_par})` : ''}`
                      : 'jamais'}
                  </span>
                  {courant.date_cloture && (
                    <>
                      <span className="text-bordure">|</span>
                      <span>
                        Cloture {fmt.dateHeure(courant.date_cloture)}
                        {courant.cloture_par ? ` (${courant.cloture_par})` : ''}
                      </span>
                    </>
                  )}
                  <span className="text-bordure">|</span>
                </>
              )}
              <Badge ton={TON_STATUT[statut]}>{LIBELLE_STATUT[statut]}</Badge>
            </div>
          </CarteEntete>

          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <Etiq obligatoire>Libelle</Etiq>
              <Champ
                value={entete.libelle}
                onChange={(e) => setEntete((s) => ({ ...s, libelle: e.target.value }))}
                disabled={!champModifiable('libelle')}
                placeholder="ex. Plan glissant 2026-2027"
              />
            </div>
            <div>
              <Etiq>Scenario</Etiq>
              <Champ
                value={entete.scenario_nom}
                onChange={(e) => setEntete((s) => ({ ...s, scenario_nom: e.target.value }))}
                disabled={!champModifiable('scenario_nom')}
                placeholder="BASE, HAUT, BAS..."
              />
            </div>
            <div>
              <Etiq obligatoire>Mois de depart</Etiq>
              <Champ
                type="month"
                value={entete.date_debut}
                onChange={(e) => setEntete((s) => ({ ...s, date_debut: e.target.value }))}
                disabled={!champModifiable('date_debut')}
              />
            </div>
            <div>
              <Etiq>Horizon</Etiq>
              <Selecteur
                value={String(entete.mois_horizon)}
                onChange={(e) =>
                  setEntete((s) => ({ ...s, mois_horizon: Number(e.target.value) }))
                }
                disabled={!champModifiable('mois_horizon')}
              >
                {[3, 6, 9, 12, 18, 24, 36, 48, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} mois{n >= 24 ? ` (${n / 12} ans)` : n === 12 ? ' (1 an)' : ''}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq>
                Croissance annuelle %
                <Aide>Appliquee au prorata des mois ecoules : (1 + taux)^(rang / 12).</Aide>
              </Etiq>
              <Champ
                type="number"
                step="any"
                value={entete.croissance_annuelle_pct}
                onChange={(e) =>
                  setEntete((s) => ({ ...s, croissance_annuelle_pct: e.target.value }))
                }
                disabled={!champModifiable('croissance_annuelle_pct')}
                className="text-right tabular-nums"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Etiq>Periode couverte</Etiq>
              <div className="flex h-8 items-center gap-2 rounded-[var(--radius)] border border-bordure bg-attenue px-2 text-[12px]">
                {periode.length > 0 ? (
                  <>
                    <span className="font-medium tabular-nums">{periode[0].libelle}</span>
                    <span className="text-attenue-texte">→</span>
                    <span className="font-medium tabular-nums">
                      {periode[periode.length - 1].libelle}
                    </span>
                    <Badge ton="contour">{periode.length} mois</Badge>
                    {periode.length > 12 && (
                      <Badge ton="info">
                        {Math.round((periode.length / 12) * 10) / 10} ans
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-attenue-texte">Choisissez un mois de depart</span>
                )}
              </div>
            </div>
          </CarteCorps>
        </Carte>

        {/* --- Recettes retenues ------------------------------------------- */}
        <Carte>
          <CarteEntete>
            <CarteTitre className="flex items-center gap-1.5">
              <Layers className="size-3.5" />
              Qualites produites
              <Aide>
                Seules apparaissent les qualites <strong>actives</strong> qu'aucun autre plan actif
                ne produit deja. Clore un plan libere les siennes.
              </Aide>
            </CarteTitre>
            {modifiable && (
              <Bouton
                variante="contour"
                taille="sm"
                onClick={ouvrirPanneau}
                disabled={!qualitesDisponibles.length}
                title={
                  qualitesDisponibles.length
                    ? 'Cocher plusieurs qualites et les ajouter en une fois'
                    : 'Aucune qualite disponible : toutes sont deja au plan ou sans recette validee libre'
                }
              >
                <Plus />
                Choisir des qualites
                {qualitesDisponibles.length > 0 && (
                  <span className="rounded bg-attenue px-1 text-[10px]">
                    {qualitesDisponibles.length}
                  </span>
                )}
              </Bouton>
            )}
          </CarteEntete>

          <CarteCorps>
            {edition !== '' && qEntete.isLoading ? (
              <Chargement texte="Chargement de l'entete..." />
            ) : (
              <DataTable
                module={MODULE}
                colonnes={colonnesEntete}
                lignes={lignes}
                cle={(l) => l.code_qualite}
                recherche={false}
                pagination={false}
                tailleParDefaut={500}
                titreCarte={(l) => `${l.code_qualite} — ${l.qualite_nom}`}
                videTitre="Aucune qualite retenue"
                videDescription="Un plan produit des qualites actives : choisissez-en au moins une."
                actions={
                  modifiable
                    ? (l) => (
                        <Bouton
                          variante="discret"
                          taille="icone-xs"
                          className="text-danger hover:bg-danger/10"
                          onClick={() =>
                            setLignes((ls) => ls.filter((x) => x.code_qualite !== l.code_qualite))
                          }
                          aria-label="Retirer du plan"
                        >
                          <Trash2 />
                        </Bouton>
                      )
                    : undefined
                }
              />
            )}
          </CarteCorps>
        </Carte>

        {/* --- Saisonnalite ------------------------------------------------ */}
        {lignes.length > 0 && (
          <Carte>
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                Saisonnalite — profil annuel
                <Aide>
                  Douze coefficients par qualite, un par mois de l'annee : c'est un profil qui se
                  <strong> repete</strong> d'une annee sur l'autre, independamment de la duree du
                  plan. Coefficient &gt; 1 = mois haut, &lt; 1 = mois bas, 0 = arret de production.
                  La grille est complete : toute case non saisie est amorcee a 1,00.
                </Aide>
              </CarteTitre>
              {modifiable && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-attenue-texte">
                    12 mois x {lignes.length} qualite(s)
                  </span>
                  <Bouton
                    variante="discret"
                    taille="xs"
                    onClick={() =>
                      setCoefs(() => {
                        const c: Record<string, number> = {}
                        for (const l of lignes)
                          for (let mois = 1; mois <= 12; mois++) c[`${l.code_qualite}|${mois}`] = 1
                        return c
                      })
                    }
                    title="Remettre tous les coefficients a 1,00"
                  >
                    <RotateCcw />
                    Tout a 1,00
                  </Bouton>
                </div>
              )}
            </CarteEntete>
            <CarteCorps className="p-0">
              <div className="defilement-x">
                <table className="grille w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue">
                      <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                        Mois de l'annee
                      </th>
                      {lignes.map((l) => (
                        <th
                          key={l.code_qualite}
                          className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte"
                        >
                          {l.code_qualite}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Les DOUZE mois de l'annee, toujours : la saisonnalite ne
                        depend pas de la periode du plan, elle la traverse. Les
                        mois hors periode restent modifiables — ils serviront a
                        la prochaine version du plan. */}
                    {MOIS_LONG.map((nom, i) => {
                      const mois = i + 1
                      const couvert = periode.some((p) => p.mois === mois)
                      return (
                        <tr key={mois} className="hover:bg-attenue/60">
                          <td className="px-2.5 py-[5px] whitespace-nowrap">
                            {nom}
                            {!couvert && (
                              <span className="ml-1.5 text-[10px] text-attenue-texte">
                                hors periode
                              </span>
                            )}
                          </td>
                          {lignes.map((l) => (
                            <td key={l.code_qualite} className="px-2.5 py-[5px] text-right">
                              <CelluleEditable
                                valeur={coef(l.code_qualite, mois)}
                                affichage={fmt.nombre(coef(l.code_qualite, mois), 2)}
                                type="nombre"
                                min={0}
                                aligneDroite
                                modifiable={champModifiable('coefficient')}
                                surValider={(v) =>
                                  majCoef(l.code_qualite, mois, v === null ? 1 : Number(v))
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CarteCorps>
          </Carte>
        )}

        {/* --- Grille deduite ---------------------------------------------- */}
        {lignes.length > 0 && periode.length > 0 && (
          <Carte>
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                Plan deploye — m² par mois
                <Aide>
                  m² = ARRONDI(base mensuelle × coefficient du mois × (1 + croissance)
                  <sup>rang/12</sup> ; 0). La croissance est <strong>composee</strong> : sur trois
                  ans a 10 %/an, l'ecart avec un calcul lineaire depasse 2 %. Seule la base se
                  saisit : les colonnes mensuelles se recalculent a chaque frappe, et le serveur les
                  reconstruit a l'enregistrement.
                </Aide>
              </CarteTitre>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-attenue-texte">
                  Total periode :{' '}
                  <span className="font-semibold tabular-nums text-texte">
                    {fmt.entier(totalPeriode)} m²
                  </span>
                </span>
                {courant && modifiable && (
                  <Bouton
                    variante="contour"
                    taille="sm"
                    onClick={() => recalcul.mutate(courant.id_plan)}
                    chargement={recalcul.isPending}
                    title="Refaire le calcul cote serveur a partir des bases et coefficients enregistres"
                  >
                    <RefreshCw />
                    Recalculer
                  </Bouton>
                )}
              </div>
            </CarteEntete>
            <CarteCorps className="p-0">
              <div className="defilement-x">
                <table className="grille w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue">
                      <th className="sticky left-0 z-10 bg-attenue px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                        Qualite
                      </th>
                      <th className="bg-attenue px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte whitespace-nowrap">
                        Base / mois
                      </th>
                      {periode.map((p) => (
                        <th
                          key={p.rang}
                          className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte whitespace-nowrap"
                        >
                          {p.libelle}
                        </th>
                      ))}
                      <th className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => (
                      <tr key={l.code_qualite} className="hover:bg-attenue/60">
                        <td className="sticky left-0 z-10 bg-surface px-2.5 py-1 whitespace-nowrap">
                          <span className="font-medium">{l.code_qualite}</span>
                          <span className="ml-1.5 text-[11px] text-attenue-texte">
                            {l.qualite_nom}
                          </span>
                        </td>
                        {/* Seule case saisissable de la grille : tout le reste
                            en decoule. */}
                        <td className="px-2.5 py-[5px] text-right">
                          <CelluleEditable
                            valeur={l.m2_base_mensuel}
                            affichage={
                              l.m2_base_mensuel === null ? (
                                <span className="text-danger">a saisir</span>
                              ) : (
                                fmt.entier(l.m2_base_mensuel)
                              )
                            }
                            type="nombre"
                            min={0}
                            aligneDroite
                            modifiable={champModifiable('m2_base_mensuel')}
                            surValider={(v) =>
                              setLignes((ls) =>
                                ls.map((x) =>
                                  x.code_qualite === l.code_qualite
                                    ? { ...x, m2_base_mensuel: v === null ? null : Number(v) }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                        {periode.map((p) => (
                          <td key={p.rang} className="px-2.5 py-[5px] text-right tabular-nums">
                            {fmt.entier(m2(l, p.rang, p.mois))}
                          </td>
                        ))}
                        <td className="px-2.5 py-1 text-right font-semibold tabular-nums">
                          {fmt.entier(periode.reduce((t, p) => t + m2(l, p.rang, p.mois), 0))}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-bordure bg-attenue/40 font-semibold">
                      <td className="sticky left-0 z-10 bg-attenue px-2.5 py-1.5">TOTAL m²/mois</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {fmt.entier(lignes.reduce((t, l) => t + (l.m2_base_mensuel ?? 0), 0))}
                      </td>
                      {periode.map((p) => (
                        <td key={p.rang} className="px-2.5 py-1.5 text-right tabular-nums">
                          {fmt.entier(lignes.reduce((t, l) => t + m2(l, p.rang, p.mois), 0))}
                        </td>
                      ))}
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {fmt.entier(totalPeriode)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CarteCorps>
          </Carte>
        )}

        {/* --- Pied -------------------------------------------------------- */}
        {modifiable && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bordure bg-surface px-3 py-2 shadow-sm">
            <div className="min-w-0 text-[12px]">
              {problemes.length > 0 ? (
                <span className="text-danger">A corriger : {problemes.join(' · ')}</span>
              ) : (
                <span className="text-attenue-texte">
                  {lignes.length} qualite(s) · {periode.length} mois ·{' '}
                  {fmt.entier(totalPeriode)} m² sur la periode
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Bouton variante="contour" onClick={fermer}>
                Annuler
              </Bouton>
              <Bouton
                onClick={() => enregistrement.mutate()}
                chargement={enregistrement.isPending}
                disabled={problemes.length > 0}
              >
                <Save />
                Enregistrer entete et grille
              </Bouton>
            </div>
          </div>
        )}
      </div>

      {/* --- Selection groupee des qualites -------------------------------- */}
      <Dialogue open={panneauOuvert} onOpenChange={setPanneauOuvert}>
        <DialogueContenu
          cote="droite"
          titre="Qualites a planifier"
          description="Cochez les qualites a produire, puis ajoutez le lot d'un coup."
        >
          <div className="space-y-1.5">
            {qualitesDisponibles.map((q) => {
              const coche = !!choix[q.code_qualite]
              return (
                <label
                  key={q.code_qualite}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border p-2 transition-colors',
                    coche ? 'border-primaire bg-primaire/5' : 'border-bordure',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={coche}
                    onChange={() => basculerQualite(q.code_qualite)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{q.code_qualite}</span>
                    <span className="ml-1.5 text-[12px] text-attenue-texte">{q.nom}</span>
                    <span className="mt-0.5 block text-[11px] text-attenue-texte">
                      {q.nb_composition} ligne(s) de composition ·{' '}
                      {fmt.nombre(q.poids_commercial_m2, 3)} kg/m²
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-bordure bg-surface px-4 pt-3">
            <div className="flex items-center gap-1.5">
              <Bouton
                variante="discret"
                taille="xs"
                onClick={() =>
                  setChoix(
                    Object.fromEntries(qualitesDisponibles.map((q) => [q.code_qualite, true])),
                  )
                }
              >
                Tout cocher
              </Bouton>
              <Bouton variante="discret" taille="xs" onClick={() => setChoix({})}>
                Tout decocher
              </Bouton>
              <span className="text-[11px] text-attenue-texte">{nbCoches} selectionnee(s)</span>
            </div>
            <div className="flex items-center gap-2">
              <Bouton variante="contour" onClick={() => setPanneauOuvert(false)}>
                Annuler
              </Bouton>
              <Bouton onClick={ajouterSelection} disabled={!nbCoches}>
                <Plus />
                Ajouter {nbCoches || ''}
              </Bouton>
            </div>
          </div>
        </DialogueContenu>
      </Dialogue>

      {confirmation.element}
    </div>
  )
}

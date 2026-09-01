/**
 * Qualites — document complet.
 *
 * Une qualite = une composition. Il n'y a pas de versionnement : si la
 * composition change, on cree une NOUVELLE qualite (SH1, SH2, SH3...). Le
 * document reunit donc les trois blocs qui la definissent :
 *
 *   1. l'entete   — code, nom, statut, parametres de planification ;
 *   2. les densites par role — COMBIEN de matiere par m2 (kg/m2 ou ml/m2) ;
 *   3. la composition        — LAQUELLE : reference, role, pourcentage.
 *
 * Un seul bouton valide l'ensemble. Tant qu'il n'a pas ete presse, rien n'est
 * parti au serveur : on peut ajouter trois lignes, en corriger une, en retirer
 * une autre, puis decider que le tout est bon.
 *
 * La mise en service (statut ACTIF) declenche les controles : somme des
 * pourcentages a 100 % par role (R07), densite presente pour chaque role
 * compose, densite kg/ml sur les references des roles en ml/m2. Une qualite
 * produite par le plan en service voit sa composition verrouillee — c'est le
 * pendant de « pas de versionnement ».
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Boxes,
  Copy,
  FileText,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Save,
  Trash2,
  Printer,
} from 'lucide-react'
import { toast } from 'sonner'
import { useOuvrirVue } from '../lib/navigation'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { CelluleEditable } from '../composants/CelluleEditable'
import { SelecteurReference } from '../composants/SelecteurReference'
import { CoherenceRecettes } from '../composants/CoherenceRecettes'
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
  Zone,
} from '../composants/ui/base'
import { Aide, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'QUALITES'

type Statut = 'BROUILLON' | 'ACTIF' | 'CLOTURE'
type Unite = 'kg_m2' | 'ml_m2'

interface Qualite extends Record<string, unknown> {
  code_qualite: string
  nom: string
  description: string | null
  statut: Statut
  actif: number
  poids_commercial_m2: number
  poids_calcule_m2: number | null
  marge_securite_pct: number
  couv_min_mois: number
  taux_perte_pct: number
  seuil_alerte_jours: number
  seuil_critique_jours: number
  stock_securite_jours: number
  nb_roles: number
  nb_composition: number
  nb_roles_composes: number
  nb_roles_hors_100: number
  nb_lignes_plan: number
  date_creation: string
  date_modification: string | null
  date_cloture: string | null
  cree_par: string | null
  modifie_par: string | null
}

interface DensiteApi {
  code_role: string
  role_libelle: string
  densite: number
  unite_densite: Unite
  entre_poids_commercial: number
}

interface RoleBom {
  code_role: string
  libelle: string
  actif: number
}

interface RefCatalogue {
  code_reference: string
  designation: string
  code_categorie: string
  categorie_libelle: string | null
  type_fil: string | null
  couleur: string | null
  fournisseur_nom: string | null
  code_devise_catalogue: string | null
  /** Prix au kg ramene en MAD : CMUP reel s'il existe, sinon catalogue converti. */
  prix_kg_mad: number | null
  actif: number
}

interface CompositionApi {
  ligne_numero: number
  code_reference: string
  designation: string
  code_role: string
  role_libelle: string
  pourcentage_composition: number
  couleur: string | null
  kg_m2: number | null
}

interface Categorie {
  code_categorie: string
  libelle: string
  code_role_defaut: string | null
}

/** Ligne de composition en cours de saisie. */
interface LigneCompo extends Record<string, unknown> {
  cle: string
  code_reference: string
  code_role: string
  pourcentage_composition: number | null
  couleur: string | null
}

interface Parametre {
  code_parametre: string
  valeur_courante: string
}

/**
 * Correspondance parametre general -> parametre local de la qualite.
 *
 * A la CREATION seulement : la valeur generale est recopiee dans le document,
 * puis vit sa vie. Une qualite creee en mars doit rester calculable a
 * l'identique si la marge generale change en juin (B3).
 */
const PARAMETRES_GENERAUX = [
  { champ: 'marge_securite_pct', libelle: 'Marge securite %', code: 'P_MargeSecurite' },
  { champ: 'taux_perte_pct', libelle: 'Taux de perte %', code: 'P_TauxPerte' },
  { champ: 'couv_min_mois', libelle: 'Couverture min. (mois)', code: 'P_CouvMinMois' },
  { champ: 'seuil_alerte_jours', libelle: 'Seuil alerte (j)', code: 'P_SeuilAlerte' },
  { champ: 'seuil_critique_jours', libelle: 'Seuil critique (j)', code: 'P_SeuilCritique' },
  { champ: 'stock_securite_jours', libelle: 'Securite (j)', code: 'P_SecuriteA' },
] as const satisfies readonly { champ: keyof Entete; libelle: string; code: string }[]

/** Ligne en cours de saisie. `cle` est locale : elle survit au changement de role. */
interface LigneLocale extends Record<string, unknown> {
  cle: string
  code_role: string
  densite: number | null
  unite_densite: Unite
}

interface Entete {
  code_qualite: string
  nom: string
  description: string
  statut: Statut
  marge_securite_pct: string
  couv_min_mois: string
  taux_perte_pct: string
  seuil_alerte_jours: string
  seuil_critique_jours: string
  stock_securite_jours: string
}

const ENTETE_VIDE: Entete = {
  code_qualite: '',
  nom: '',
  description: '',
  statut: 'BROUILLON',
  marge_securite_pct: '',
  couv_min_mois: '',
  taux_perte_pct: '',
  seuil_alerte_jours: '',
  seuil_critique_jours: '',
  stock_securite_jours: '',
}

const TON_STATUT: Record<Statut, 'neutre' | 'succes' | 'contour'> = {
  BROUILLON: 'neutre',
  ACTIF: 'succes',
  CLOTURE: 'contour',
}

let compteur = 0
const nouvelleCle = () => `l${++compteur}`

/** Chaine vide -> undefined : le serveur applique alors le parametre global. */
const nombreOuRien = (v: string) => (v.trim() === '' ? undefined : Number(v))

export function Qualites() {
  const droits = useDroits(MODULE)
  const ouvrirEtat = useOuvrirVue()
  const qc = useQueryClient()
  const confirmation = useConfirmation()

  /**
   * `null` = liste. Sinon le code de la qualite SOURCE : celle dont on charge
   * les lignes. Il est distinct de `enCreation` pour que la duplication puisse
   * lire les lignes d'une qualite existante tout en visant un nouveau code.
   */
  const [edition, setEdition] = useState<string | null>(null)
  const [enCreation, setEnCreation] = useState(false)
  const [entete, setEntete] = useState<Entete>(ENTETE_VIDE)
  const [lignes, setLignes] = useState<LigneLocale[]>([])
  const [composition, setComposition] = useState<LigneCompo[]>([])
  /**
   * Le selecteur de matiere ne propose, par defaut, que les references dont la
   * categorie est destinee au role de la ligne : 12 plastiques au lieu de 124
   * references. Le filtre se leve — employer une matiere hors de son role
   * habituel reste possible, cela ne doit simplement pas etre le cas ordinaire.
   */
  /** Ligne dont on est en train de choisir la matiere ; `null` = panneau ferme. */
  const [choixMatiere, setChoixMatiere] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const qQualites = useQuery({
    queryKey: ['qualites'],
    queryFn: () => api.get<Qualite[]>('/api/qualites'),
  })

  const qRoles = useQuery({
    queryKey: ['roles-bom'],
    queryFn: () => api.get<RoleBom[]>('/api/roles-bom'),
    staleTime: 5 * 60_000,
  })

  const qParametres = useQuery({
    queryKey: ['parametres'],
    queryFn: () => api.get<Parametre[]>('/api/parametres'),
    staleTime: 5 * 60_000,
  })

  const qCatalogue = useQuery({
    queryKey: ['catalogue'],
    queryFn: () => api.get<RefCatalogue[]>('/api/catalogue'),
    staleTime: 5 * 60_000,
  })

  const qCategories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Categorie[]>('/api/categories'),
    staleTime: 5 * 60_000,
  })

  const valeurGenerale = (code: string) =>
    qParametres.data?.find((x) => x.code_parametre === code)?.valeur_courante

  /** Les seuls parametres locaux, tels que le general les fixe aujourd'hui. */
  function valeursGenerales(): Partial<Entete> {
    const e: Partial<Entete> = {}
    for (const p of PARAMETRES_GENERAUX) {
      const v = valeurGenerale(p.code)
      if (v !== undefined) e[p.champ] = v
    }
    return e
  }

  /** Entete neuve, parametres generaux du moment deja recopies. */
  const enteteNeuve = (): Entete => ({ ...ENTETE_VIDE, ...valeursGenerales() })

  const courante = enCreation
    ? undefined
    : qQualites.data?.find((q) => q.code_qualite === edition)

  // Chargement des lignes existantes a l'ouverture d'une qualite.
  const qDensites = useQuery({
    queryKey: ['densites', edition],
    queryFn: () => api.get<DensiteApi[]>(`/api/qualites/${edition}/densites`),
    enabled: !!edition,
  })

  const qComposition = useQuery({
    queryKey: ['composition', edition],
    queryFn: () => api.get<CompositionApi[]>(`/api/qualites/${edition}/composition`),
    enabled: !!edition,
  })

  // Densites et composition se chargent UNE FOIS, a l'ouverture de la qualite.
  // Les relier a chaque arrivee de donnees rendait a chaque champ sa valeur
  // d'origine des qu'une requete se rejouait : corriger un chiffre paraissait
  // impossible, alors que la frappe etait simplement effacee.
  const rempli = useRef<string | null>(null)

  useEffect(() => {
    if (!qDensites.data || rempli.current === edition) return
    setLignes(
      qDensites.data.map((d) => ({
        cle: nouvelleCle(),
        code_role: d.code_role,
        densite: d.densite,
        unite_densite: d.unite_densite,
      })),
    )
  }, [qDensites.data, edition])

  useEffect(() => {
    if (!qComposition.data || rempli.current === edition) return
    // Les deux dossiers arrivent separement : le marqueur ne se pose qu'ici,
    // une fois la composition recue, sinon les densites bloqueraient sa lecture.
    rempli.current = edition
    setComposition(
      qComposition.data.map((c) => ({
        cle: nouvelleCle(),
        code_reference: c.code_reference,
        code_role: c.code_role,
        pourcentage_composition: c.pourcentage_composition,
        couleur: c.couleur,
      })),
    )
  }, [qComposition.data, edition])

  // --- Actions de navigation -----------------------------------------------

  function ouvrirCreation() {
    rempli.current = null
    setEdition('')
    setEnCreation(true)
    setEntete(enteteNeuve())
    setLignes([])
    setComposition([])
    setErreur(null)
  }

  function ouvrir(q: Qualite) {
    rempli.current = null
    setEdition(q.code_qualite)
    setEnCreation(false)
    setEntete({
      code_qualite: q.code_qualite,
      nom: q.nom,
      description: q.description ?? '',
      statut: q.statut,
      marge_securite_pct: String(q.marge_securite_pct ?? ''),
      couv_min_mois: String(q.couv_min_mois ?? ''),
      taux_perte_pct: String(q.taux_perte_pct ?? ''),
      seuil_alerte_jours: String(q.seuil_alerte_jours ?? ''),
      seuil_critique_jours: String(q.seuil_critique_jours ?? ''),
      stock_securite_jours: String(q.stock_securite_jours ?? ''),
    })
    setLignes([])
    setComposition([])
    setErreur(null)
  }

  /** Duplique l'entete, les densites et la composition sous un nouveau code.
   *  C'est le geste normal quand la composition doit changer : on ne modifie pas
   *  la qualite en service, on en cree une derivee. */
  function dupliquer(q: Qualite) {
    ouvrir(q)
    setEnCreation(true)
    setEntete((e) => ({ ...e, code_qualite: '', statut: 'BROUILLON' }))
  }

  function fermer() {
    rempli.current = null
    setEdition(null)
    setEnCreation(false)
    setErreur(null)
  }

  // --- Enregistrement --------------------------------------------------------

  const enregistrement = useMutation({
    mutationFn: () =>
      api.put<{ code_qualite: string; cree: boolean; poids_commercial_m2: number }>(
        '/api/qualites',
        {
          code_qualite: entete.code_qualite.trim().toUpperCase(),
          nom: entete.nom.trim(),
          description: entete.description.trim() || null,
          statut: entete.statut,
          marge_securite_pct: nombreOuRien(entete.marge_securite_pct),
          couv_min_mois: nombreOuRien(entete.couv_min_mois),
          taux_perte_pct: nombreOuRien(entete.taux_perte_pct),
          seuil_alerte_jours: nombreOuRien(entete.seuil_alerte_jours),
          seuil_critique_jours: nombreOuRien(entete.seuil_critique_jours),
          stock_securite_jours: nombreOuRien(entete.stock_securite_jours),
          lignes: lignes.map((l) => ({
            code_role: l.code_role,
            densite: l.densite ?? 0,
            unite_densite: l.unite_densite,
          })),
          composition: composition.map((c) => ({
            code_reference: c.code_reference,
            code_role: c.code_role,
            pourcentage_composition: c.pourcentage_composition ?? 0,
            couleur: c.couleur,
          })),
        },
      ),
    onSuccess: (r) => {
      toast.success(
        r.cree ? `Qualite ${r.code_qualite} creee` : `Qualite ${r.code_qualite} mise a jour`,
        {
          description:
            `${lignes.length} densite(s) · ${composition.length} ligne(s) de composition · ` +
            `${fmt.nombre(r.poids_commercial_m2, 3)} kg/m²`,
        },
      )
      void qc.invalidateQueries({ queryKey: ['qualites'] })
      void qc.invalidateQueries({ queryKey: ['densites'] })
      void qc.invalidateQueries({ queryKey: ['composition'] })
      setErreur(null)
      fermer()
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : String(e)),
  })

  const suppression = useMutation({
    mutationFn: (code: string) =>
      api.delete<{ mode: string; raison?: string }>(`/api/qualites/${code}`),
    onSuccess: (r) => {
      toast.success(
        r.mode === 'SUPPRESSION' ? 'Qualite supprimee' : 'Qualite cloturee',
        { description: r.raison },
      )
      void qc.invalidateQueries({ queryKey: ['qualites'] })
      fermer()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  function demanderSuppression(q: Qualite) {
    const liee = q.nb_lignes_plan > 0
    confirmation.demander({
      titre: liee ? `Cloturer ${q.code_qualite} ?` : `Supprimer ${q.code_qualite} ?`,
      destructif: true,
      libelleConfirmer: liee ? 'Cloturer' : 'Supprimer',
      description: liee
        ? `${q.nb_lignes_plan} ligne(s) de plan la referencent : ` +
          `elle sera cloturee pour preserver ces liens, pas effacee.`
        : "Rien ne la reference : elle sera effacee, avec ses densites et sa composition.",
      action: () => suppression.mutate(q.code_qualite),
    })
  }

  // --- Manipulation des lignes ----------------------------------------------

  const rolesDisponibles = useMemo(
    () => (qRoles.data ?? []).filter((r) => r.actif === 1),
    [qRoles.data],
  )
  const libelleRole = (code: string) =>
    rolesDisponibles.find((r) => r.code_role === code)?.libelle ?? code

  function ajouterLigne() {
    const pris = new Set(lignes.map((l) => l.code_role))
    const libre = rolesDisponibles.find((r) => !pris.has(r.code_role))
    if (!libre) {
      toast.error('Tous les roles BOM sont deja presents dans cette qualite.')
      return
    }
    setLignes((ls) => [
      ...ls,
      { cle: nouvelleCle(), code_role: libre.code_role, densite: null, unite_densite: 'kg_m2' },
    ])
  }

  function majLigne(cle: string, champ: keyof LigneLocale, valeur: unknown) {
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)))
  }

  const poidsCalcule = lignes
    .filter((l) => l.unite_densite === 'kg_m2')
    .reduce((s, l) => s + (l.densite ?? 0), 0)

  // --- Composition -----------------------------------------------------------

  const references = useMemo(
    () => (qCatalogue.data ?? []).filter((r) => r.actif !== 0),
    [qCatalogue.data],
  )
  const designation = (code: string) =>
    references.find((r) => r.code_reference === code)?.designation ?? ''

  /**
   * Categories destinees a chaque role, d'apres le referentiel.
   *
   * C'est la seule source du filtre : il n'y a plus de repli silencieux sur tout
   * le catalogue quand un role ne ramene rien. Le panneau de choix le dit et
   * offre de lever le filtre — un filtre qui s'annule tout seul ne filtre pas.
   */
  const categoriesParRole = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of qCategories.data ?? []) {
      if (!c.code_role_defaut) continue
      if (!m.has(c.code_role_defaut)) m.set(c.code_role_defaut, new Set())
      m.get(c.code_role_defaut)!.add(c.code_categorie)
    }
    return m
  }, [qCategories.data])

  const categoriesDuRole = (role: string) => categoriesParRole.get(role) ?? new Set<string>()

  const refCatalogue = (code: string) =>
    references.find((r) => r.code_reference === code)

  function ajouterCompo() {
    // Le role vient des densites saisies : composer un role sans densite
    // produirait un besoin nul en silence, ce que le serveur refuse a
    // l'activation.
    const role = lignes[0]?.code_role
    if (!role) {
      toast.error("Definissez d'abord une densite de role : la composition s'y rattache.")
      return
    }
    // Une matiere ne figure qu'une fois dans la qualite : on amorce sur la
    // premiere encore libre, dans le domaine du role.
    const prises = new Set(composition.map((c) => c.code_reference))
    const domaine = categoriesDuRole(role)
    const ref =
      references.find((r) => domaine.has(r.code_categorie) && !prises.has(r.code_reference)) ??
      references.find((r) => !prises.has(r.code_reference))
    if (!ref) {
      toast.error('Toutes les references du catalogue sont deja employees par cette qualite.')
      return
    }
    setComposition((cs) => [
      ...cs,
      {
        cle: nouvelleCle(),
        code_reference: ref.code_reference,
        code_role: role,
        pourcentage_composition: null,
        couleur: null,
      },
    ])
  }

  function majCompo(cle: string, champ: keyof LigneCompo, valeur: unknown) {
    setComposition((cs) => cs.map((c) => (c.cle === cle ? { ...c, [champ]: valeur } : c)))
  }

  /** Somme des % par role : c'est ce que R07 controlera a la mise en service. */
  const sommesParRole = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of composition)
      m.set(c.code_role, (m.get(c.code_role) ?? 0) + (c.pourcentage_composition ?? 0))
    return m
  }, [composition])

  const rolesHors100 = [...sommesParRole.entries()].filter(([, s]) => Math.abs(s - 100) > 0.5)

  /**
   * Cout matiere du m2 : somme des lignes dont le prix est connu.
   *
   * `null` si aucune n'est chiffrable — afficher 0,000 laisserait croire a une
   * matiere gratuite alors qu'on ne sait simplement pas.
   */
  const coutTotalM2 = useMemo(() => {
    const couts = composition.map(coutM2).filter((v): v is number => v !== null)
    return couts.length ? couts.reduce((a, b) => a + b, 0) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, lignes, references])

  /**
   * Cout d'une ligne au m2 : consommation x prix au kg, en MAD.
   *
   * Le prix vient du catalogue selon la meme regle que le plan d'achat — CMUP
   * reel s'il existe, sinon prix catalogue converti. Il reste vide pour les
   * roles en ml/m2, dont la consommation depend de la densite kg/ml et n'est
   * connue qu'apres enregistrement.
   */
  function coutM2(c: LigneCompo): number | null {
    const kg = kgM2(c)
    const prix = refCatalogue(c.code_reference)?.prix_kg_mad
    return kg === null || typeof prix !== 'number' ? null : kg * prix
  }

  /** Consommation en kg/m² d'une ligne, avec la densite de son role. */
  function kgM2(c: LigneCompo): number | null {
    const d = lignes.find((l) => l.code_role === c.code_role)
    if (!d || d.densite === null || c.pourcentage_composition === null) return null
    // Les roles en ml/m2 passent par la densite kg/ml de la reference, que la
    // liste du catalogue ne porte pas : le serveur reste la source du chiffre.
    if (d.unite_densite !== 'kg_m2') return null
    return (d.densite * c.pourcentage_composition) / 100
  }

  // Verifications locales : inutile de solliciter le serveur pour les detecter.
  const codeSaisi = entete.code_qualite.trim()
  const problemes: string[] = []
  if (!codeSaisi) problemes.push('le code qualite est obligatoire')
  if (!entete.nom.trim()) problemes.push('le nom est obligatoire')
  if (new Set(lignes.map((l) => l.code_role)).size !== lignes.length)
    problemes.push('un role apparait deux fois')
  if (lignes.some((l) => l.densite === null || l.densite <= 0))
    problemes.push('chaque densite doit etre strictement positive')
  if (composition.some((c) => !c.pourcentage_composition || c.pourcentage_composition <= 0))
    problemes.push('chaque ligne de composition doit porter un pourcentage')
  // Tous roles confondus : deux lignes sur la meme matiere additionneraient
  // leurs pourcentages sans qu'on sache laquelle corriger.
  const refsEnDouble = [
    ...new Set(
      composition
        .map((c) => c.code_reference)
        .filter((r, i, t) => t.indexOf(r) !== i),
    ),
  ]
  if (refsEnDouble.length)
    problemes.push(`reference(s) en double : ${refsEnDouble.join(', ')}`)
  const rolesSansDensite = [...new Set(composition.map((c) => c.code_role))].filter(
    (r) => !lignes.some((l) => l.code_role === r),
  )
  if (rolesSansDensite.length)
    problemes.push(`role(s) composes sans densite : ${rolesSansDensite.join(', ')}`)
  // La mise en service exige une composition complete : autant le dire avant
  // l'envoi plutot que de laisser le serveur refuser.
  if (entete.statut === 'ACTIF') {
    if (!composition.length) problemes.push('une qualite active exige une composition')
    else if (rolesHors100.length)
      problemes.push(
        `R07 : ${rolesHors100.map(([r, s]) => `${libelleRole(r)} a ${fmt.nombre(s, 2)} %`).join(', ')}`,
      )
  }
  if (
    enCreation &&
    qQualites.data?.some((q) => q.code_qualite === codeSaisi.toUpperCase())
  )
    problemes.push('ce code existe deja')

  // ==========================================================================
  // Rendu : liste
  // ==========================================================================

  if (edition === null) {
    const colonnes: ColonneDT<Qualite>[] = [
      {
        champ: 'code_qualite',
        entete: 'Code',
        largeur: '110px',
        filtre: 'texte',
        rendu: (q) => <span className="font-medium">{q.code_qualite}</span>,
      },
      { champ: 'nom', entete: 'Nom', filtre: 'texte' },
      {
        champ: 'description',
        entete: 'Description',
        secondaire: true,
        rendu: (q) => (
          <span className="text-attenue-texte">{fmt.texte(q.description)}</span>
        ),
      },
      {
        champ: 'statut',
        entete: 'Statut',
        largeur: '110px',
        filtre: 'liste',
        rendu: (q) => <Badge ton={TON_STATUT[q.statut]}>{q.statut}</Badge>,
      },
      {
        champ: 'nb_roles',
        entete: 'Lignes',
        numerique: true,
        largeur: '80px',
        rendu: (q) => fmt.entier(q.nb_roles),
      },
      {
        champ: 'poids_commercial_m2',
        entete: 'kg/m²',
        numerique: true,
        largeur: '100px',
        rendu: (q) => fmt.nombre(q.poids_commercial_m2, 3),
      },
      {
        champ: 'taux_perte_pct',
        entete: 'Perte %',
        numerique: true,
        largeur: '90px',
        secondaire: true,
        rendu: (q) => fmt.nombre(q.taux_perte_pct, 1),
      },
      {
        champ: 'nb_composition',
        entete: 'Composition',
        largeur: '150px',
        valeurTri: (q) => q.nb_composition,
        rendu: (q) =>
          q.nb_composition === 0 ? (
            <Badge ton="alerte">aucune ligne</Badge>
          ) : q.nb_roles_hors_100 > 0 ? (
            <Badge ton="danger">{q.nb_roles_hors_100} role(s) hors 100 %</Badge>
          ) : (
            <Badge ton="succes">
              {q.nb_composition} ligne(s) · {q.nb_roles_composes} role(s)
            </Badge>
          ),
      },
      {
        champ: 'date_modification',
        entete: 'Modifiee le',
        secondaire: true,
        largeur: '140px',
        valeurTri: (q) => q.date_modification ?? q.date_creation,
        rendu: (q) => fmt.dateHeure(q.date_modification ?? q.date_creation),
      },
    ]

    return (
      <div>
        <EnTetePage
          titre="Qualites"
          description="Densite de matiere par role BOM, exprimee en kg/m² ou ml/m²."
          actions={
            droits.peutEcrire && (
              <Bouton onClick={ouvrirCreation}>
                <Plus />
                Nouvelle qualite
              </Bouton>
            )
          }
        />

        {/* Le controle du classeur, avant la liste : on regarde ce qui cloche
            avant d'ouvrir une qualite au hasard. */}
        <div className="mb-3">
          <CoherenceRecettes />
        </div>

        <DataTable
          exportable="composition-qualite"
          imprimable="Composition qualite"
          module={MODULE}
          colonnes={colonnes}
          lignes={qQualites.data}
          chargement={qQualites.isLoading}
          cle={(q) => q.code_qualite}
          surClic={ouvrir}
          placeholderRecherche="Code, nom, description..."
          titreCarte={(q) => `${q.code_qualite} — ${q.nom}`}
          videTitre="Aucune qualite"
          videDescription="Creez une qualite pour decrire la consommation de matiere par m²."
          videAction={
            droits.peutEcrire && (
              <Bouton onClick={ouvrirCreation}>
                <Plus />
                Nouvelle qualite
              </Bouton>
            )
          }
          actions={(q) => (
            <div className="flex justify-end gap-0.5">
            <Bouton
              variante="discret"
              taille="icone-xs"
              onClick={() => ouvrirEtat(`/etats/qualite/${q.code_qualite}`)}
              aria-label="Imprimer"
              title="Imprimer la fiche qualite"
            >
              <Printer />
            </Bouton>
              <Bouton
                variante="discret"
                taille="icone-xs"
                onClick={() => ouvrir(q)}
                aria-label="Modifier"
                title="Modifier"
              >
                <Pencil />
              </Bouton>
              {droits.peutEcrire && (
                <>
                  <Bouton
                    variante="discret"
                    taille="icone-xs"
                    onClick={() => dupliquer(q)}
                    aria-label="Dupliquer"
                    title="Dupliquer"
                  >
                    <Copy />
                  </Bouton>
                  <Bouton
                    variante="discret"
                    taille="icone-xs"
                    onClick={() => demanderSuppression(q)}
                    aria-label="Supprimer"
                    title={
                      q.nb_lignes_plan > 0 ? 'Cloturer (planifiee ailleurs)' : 'Supprimer'
                    }
                    className="text-danger hover:bg-danger/10"
                  >
                    <Trash2 />
                  </Bouton>
                </>
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

  const modifiable = droits.peutEcrire && entete.statut !== 'CLOTURE'
  const champModifiable = (champ: string) => modifiable && droits.modifiable(champ)

  const colonnesLignes: ColonneDT<LigneLocale>[] = [
    {
      champ: 'code_role',
      entete: 'Role BOM',
      largeur: '40%',
      rendu: (l) => (
        <CelluleEditable
          valeur={l.code_role}
          affichage={
            <span className="font-medium">
              {libelleRole(l.code_role)}
              <span className="ml-1.5 text-[11px] text-attenue-texte">{l.code_role}</span>
            </span>
          }
          type="liste"
          modifiable={champModifiable('code_role')}
          options={rolesDisponibles
            .filter((r) => r.code_role === l.code_role || !lignes.some((x) => x.code_role === r.code_role))
            .map((r) => ({ valeur: r.code_role, libelle: `${r.code_role} — ${r.libelle}` }))}
          surValider={(v) => {
            if (!v) throw new Error('role obligatoire')
            majLigne(l.cle, 'code_role', String(v))
          }}
        />
      ),
    },
    {
      champ: 'densite',
      entete: 'Densite',
      numerique: true,
      largeur: '160px',
      rendu: (l) => (
        <CelluleEditable
          valeur={l.densite}
          affichage={l.densite === null ? <span className="text-danger">a saisir</span> : fmt.nombre(l.densite, 4)}
          type="nombre"
          min={0}
          aligneDroite
          modifiable={champModifiable('densite')}
          surValider={(v) => majLigne(l.cle, 'densite', v === null ? null : Number(v))}
        />
      ),
    },
    {
      champ: 'unite_densite',
      entete: 'Unite',
      largeur: '150px',
      rendu: (l) => (
        <CelluleEditable
          valeur={l.unite_densite}
          affichage={
            <Badge ton={l.unite_densite === 'ml_m2' ? 'info' : 'neutre'}>
              {l.unite_densite === 'ml_m2' ? 'ml/m²' : 'kg/m²'}
            </Badge>
          }
          type="liste"
          modifiable={champModifiable('unite_densite')}
          options={[
            { valeur: 'kg_m2', libelle: 'kg/m² — entre dans le poids' },
            { valeur: 'ml_m2', libelle: 'ml/m² — hors poids commercial' },
          ]}
          surValider={(v) => {
            if (v !== 'kg_m2' && v !== 'ml_m2') throw new Error('unite invalide')
            majLigne(l.cle, 'unite_densite', v)
          }}
        />
      ),
    },
    {
      champ: 'entre_poids_commercial',
      entete: 'Poids commercial',
      largeur: '150px',
      secondaire: true,
      valeurTri: (l) => (l.unite_densite === 'kg_m2' ? 'inclus' : 'hors poids'),
      rendu: (l) => (
        <span className="text-attenue-texte">
          {l.unite_densite === 'kg_m2' ? 'inclus' : 'hors poids'}
        </span>
      ),
    },
  ]

  const colonnesCompo: ColonneDT<LigneCompo>[] = [
    {
      champ: 'code_role',
      entete: 'Role BOM',
      largeur: '190px',
      rendu: (c) => (
        <CelluleEditable
          valeur={c.code_role}
          affichage={<span className="font-medium">{libelleRole(c.code_role)}</span>}
          type="liste"
          modifiable={champModifiable('code_role')}
          // Seuls les roles qui portent une densite : composer ailleurs
          // donnerait un besoin nul en silence.
          options={lignes.map((l) => ({
            valeur: l.code_role,
            libelle: `${l.code_role} — ${libelleRole(l.code_role)}`,
          }))}
          surValider={(v) => {
            if (!v) throw new Error('role obligatoire')
            majCompo(c.cle, 'code_role', String(v))
          }}
        />
      ),
    },
    {
      champ: 'code_reference',
      entete: 'Reference',
      largeur: '230px',
      rendu: (c) => (
        // Pas de menu deroulant : le catalogue se compte en centaines de
        // references. Un panneau avec recherche est le seul choix tenable.
        <button
          type="button"
          disabled={!champModifiable('code_reference')}
          onClick={() => setChoixMatiere(c.cle)}
          className={cn(
            'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left',
            champModifiable('code_reference')
              ? 'transition-colors hover:bg-attenue'
              : 'cursor-default',
          )}
          title={champModifiable('code_reference') ? 'Choisir une matiere' : undefined}
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium">{c.code_reference}</span>
            <span className="ml-1.5 text-[11px] text-attenue-texte">
              {designation(c.code_reference)}
            </span>
          </span>
          {champModifiable('code_reference') && (
            <Search className="size-3 shrink-0 text-attenue-texte" />
          )}
        </button>
      ),
    },
    {
      champ: 'type_fil',
      entete: 'Type',
      largeur: '110px',
      secondaire: true,
      valeurTri: (c) => refCatalogue(c.code_reference)?.type_fil ?? '',
      rendu: (c) => fmt.texte(refCatalogue(c.code_reference)?.type_fil),
    },
    {
      champ: 'fournisseur',
      entete: 'Fournisseur',
      largeur: '150px',
      secondaire: true,
      valeurTri: (c) => refCatalogue(c.code_reference)?.fournisseur_nom ?? '',
      rendu: (c) => fmt.texte(refCatalogue(c.code_reference)?.fournisseur_nom),
    },
    {
      champ: 'pourcentage_composition',
      entete: '%',
      numerique: true,
      largeur: '130px',
      rendu: (c) => (
        <CelluleEditable
          valeur={c.pourcentage_composition}
          affichage={
            c.pourcentage_composition === null ? (
              <span className="text-danger">a saisir</span>
            ) : (
              fmt.nombre(c.pourcentage_composition, 2)
            )
          }
          type="nombre"
          min={0}
          max={100}
          aligneDroite
          modifiable={champModifiable('pourcentage_composition')}
          surValider={(v) =>
            majCompo(c.cle, 'pourcentage_composition', v === null ? null : Number(v))
          }
        />
      ),
    },
    {
      champ: 'kg_m2',
      entete: 'kg/m²',
      numerique: true,
      largeur: '110px',
      valeurTri: (c) => kgM2(c),
      rendu: (c) => {
        const v = kgM2(c)
        return v === null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className="tabular-nums">{fmt.nombre(v, 5)}</span>
        )
      },
    },
    {
      champ: 'prix_kg_mad',
      entete: 'Prix MAD/kg',
      numerique: true,
      largeur: '110px',
      valeurTri: (c) => refCatalogue(c.code_reference)?.prix_kg_mad ?? null,
      rendu: (c) => {
        const p = refCatalogue(c.code_reference)?.prix_kg_mad
        return typeof p === 'number' ? fmt.nombre(p, 2) : <span className="text-attenue-texte">—</span>
      },
    },
    {
      champ: 'code_devise_catalogue',
      entete: 'Devise',
      largeur: '80px',
      secondaire: true,
      valeurTri: (c) => refCatalogue(c.code_reference)?.code_devise_catalogue ?? '',
      rendu: (c) => fmt.texte(refCatalogue(c.code_reference)?.code_devise_catalogue),
    },
    {
      champ: 'cout_m2_mad',
      entete: 'Cout MAD/m²',
      numerique: true,
      largeur: '120px',
      valeurTri: (c) => coutM2(c),
      rendu: (c) => {
        const v = coutM2(c)
        return v === null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className="font-medium tabular-nums">{fmt.nombre(v, 4)}</span>
        )
      },
    },
    {
      champ: 'couleur',
      entete: 'Couleur',
      largeur: '130px',
      secondaire: true,
      rendu: (c) => (
        <CelluleEditable
          valeur={c.couleur}
          modifiable={champModifiable('couleur')}
          surValider={(v) => majCompo(c.cle, 'couleur', v === null ? null : String(v))}
        />
      ),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre={enCreation ? 'Nouvelle qualite' : `Qualite ${entete.code_qualite}`}
        description={
          enCreation
            ? "Saisissez l'entete puis les lignes de composition ; tout est enregistre en une fois."
            : courante
              ? `Creee le ${fmt.dateHeure(courante.date_creation)}${courante.cree_par ? ` par ${courante.cree_par}` : ''}`
              : undefined
        }
        actions={
          <>
            <Bouton variante="contour" onClick={fermer}>
              <ArrowLeft />
              Retour
            </Bouton>
            {modifiable && (
              <Bouton
                onClick={() => enregistrement.mutate()}
                chargement={enregistrement.isPending}
                disabled={problemes.length > 0}
              >
                <Save />
                Enregistrer la qualite
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

      {entete.statut === 'CLOTURE' && (
        <Alerte ton="alerte" className="mb-3">
          Qualite cloturee : elle reste consultable et conserve son historique, mais ne peut plus
          etre modifiee. Repassez son statut a ACTIF pour la rouvrir.
        </Alerte>
      )}

      <div className="@container space-y-3">
        {/* Deux colonnes quand il y a la place : la composition a gauche, les
            parametres a droite.

            La composition est le plan de travail de cet ecran — on y ajoute et
            retire des lignes, elle merite la largeur. L'entete et les densites
            se consultent, s'ajustent, et se laissent : 430 px leur suffisent.

            DEUX PIEGES, QUI SE PAYENT TOUS LES DEUX SUR PETIT ECRAN.

            Le premier est l'ORDRE DU DOM. En une seule colonne, la grille suit
            l'ordre d'ecriture : mettre la composition en premier renvoyait
            l'entete SOUS le tableau, c'est-a-dire hors de l'ecran sur un
            telephone. L'entete est donc ecrite en premier, et c'est le
            placement explicite (`col-start`) qui la ramene a droite quand la
            largeur revient. L'ordre de lecture etroit ne depend plus de la
            mise en page large.

            Le second est le CHOIX DE L'UNITE. `xl:` mesure la FENETRE, pas le
            conteneur. Dans l'atelier, deux panneaux cote a cote sur un ecran de
            1920 px font 950 px chacun : `xl:` se declencherait quand meme et
            comprimerait la composition a 520 px. La requete porte donc sur le
            conteneur (`@5xl`, 1024 px), qui est la seule largeur reellement
            disponible. Le seuil laisse ~580 px a la composition : en dessous,
            son tableau se mettrait a defiler horizontalement dans sa carte. */}
        {/* Trois cadres, deux etages.

            L'ENTETE EN HAUT, sur toute la largeur. C'est ce qu'on lit et ce
            qu'on remplit en premier ; la reléguer dans une colonne de 430 px
            comprimait quinze champs en accordeon, et sur telephone la renvoyait
            SOUS le tableau de composition.

            EN DESSOUS, les densites par role a gauche et la composition a
            droite : le pourcentage d'une ligne se lit contre la densite de son
            role, les avoir cote a cote evite l'aller-retour.

            La bascule porte sur le CONTENEUR (`@5xl`), pas sur la fenetre :
            dans l'atelier, deux panneaux cote a cote sur un ecran de 1920 px
            font 950 px chacun, et un `xl:` se declencherait quand meme. */}
          <Carte repliable="qualites.1">
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <FileText className="size-3.5" />
                Entete
              </CarteTitre>
              <div className="flex items-center gap-2 text-[11px] text-attenue-texte">
                {!enCreation && courante && (
                  <>
                    <span>Creee {fmt.dateHeure(courante.date_creation)}</span>
                    <span className="text-bordure">|</span>
                    <span>
                      Modifiee{' '}
                      {courante.date_modification
                        ? `${fmt.dateHeure(courante.date_modification)}${courante.modifie_par ? ` (${courante.modifie_par})` : ''}`
                        : 'jamais'}
                    </span>
                  </>
                )}
                <Badge ton={TON_STATUT[entete.statut]}>{entete.statut}</Badge>
              </div>
            </CarteEntete>

            {/* Deux colonnes dans la carte : identite et description a gauche,
                parametres de planification a droite. Ils ne se lisent pas dans le
                meme mouvement — on nomme la qualite une fois, on ajuste ses
                parametres separement — et les empiler allongeait la carte sans
                raison. */}
            <CarteCorps className="@container grid gap-x-4 gap-y-2.5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
              {/* --- Colonne gauche : identite et description ---------------- */}
              <div className="grid content-start gap-2.5 @lg:grid-cols-2 @3xl:grid-cols-[140px_minmax(0,1fr)_130px]">
                <div>
                  <Etiq obligatoire>
                    Code qualite
                    {!enCreation && (
                      <Aide>
                        Le code identifie la qualite dans les compositions et les plans : il ne se
                        renomme pas.
                      </Aide>
                    )}
                  </Etiq>
                  <Champ
                    value={entete.code_qualite}
                    onChange={(e) =>
                      setEntete((s) => ({ ...s, code_qualite: e.target.value.toUpperCase() }))
                    }
                    disabled={!enCreation || !droits.peutEcrire}
                    placeholder="ex. SHAGGY-30"
                    className="font-medium"
                  />
                </div>

                <div>
                  <Etiq obligatoire>Nom</Etiq>
                  <Champ
                    value={entete.nom}
                    onChange={(e) => setEntete((s) => ({ ...s, nom: e.target.value }))}
                    disabled={!champModifiable('nom')}
                    placeholder="Designation commerciale"
                  />
                </div>

                <div>
                  <Etiq>Statut</Etiq>
                  <Selecteur
                    value={entete.statut}
                    onChange={(e) => setEntete((s) => ({ ...s, statut: e.target.value as Statut }))}
                    disabled={!droits.peutEcrire}
                  >
                    <option value="BROUILLON">Brouillon</option>
                    <option value="ACTIF">Actif</option>
                    <option value="CLOTURE">Cloture</option>
                  </Selecteur>
                </div>

                <div className="sm:col-span-3">
                  <Etiq>Description</Etiq>
                  <Zone
                    value={entete.description}
                    onChange={(e) => setEntete((s) => ({ ...s, description: e.target.value }))}
                    disabled={!champModifiable('description')}
                    rows={3}
                    className="min-h-20"
                    placeholder="Usage, machine, particularites de fabrication..."
                  />
                </div>
              </div>

              {/* --- Colonne droite : parametres de planification ------------
                  Embarques a la creation depuis les parametres globaux (B3),
                  ajustables ensuite qualite par qualite. */}
              <div className="rounded-[var(--radius-sm)] border border-bordure bg-attenue p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Parametres de planification
                    <Aide>
                      {enCreation
                        ? "Recopies des parametres generaux a la creation. Ils n'en dependent plus ensuite : une qualite creee aujourd'hui reste calculable a l'identique si le parametre general change demain."
                        : 'Figes a la creation de la qualite ; les modifier ici ne touche pas les parametres generaux.'}
                    </Aide>
                  </p>
                  {enCreation && (
                    <Bouton
                      variante="discret"
                      taille="icone-xs"
                      onClick={() => setEntete((s) => ({ ...s, ...valeursGenerales() }))}
                      aria-label="Reprendre les parametres generaux"
                      title="Reprendre les parametres generaux"
                    >
                      <RotateCcw />
                    </Bouton>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {PARAMETRES_GENERAUX.map(({ champ, libelle, code }) => (
                    <div key={champ}>
                      <Etiq>
                        {libelle}
                        {enCreation && (
                          <Aide>
                            Parametre general {code} = {valeurGenerale(code) ?? '—'}
                          </Aide>
                        )}
                      </Etiq>
                      <Champ
                        type="number"
                        step="any"
                        min={0}
                        value={entete[champ]}
                        onChange={(e) =>
                          setEntete((s): Entete => ({ ...s, [champ]: e.target.value }))
                        }
                        disabled={!champModifiable(champ)}
                        className="bg-surface text-right tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CarteCorps>

          </Carte>

        <div className="grid items-start gap-3 @5xl:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
          <Carte repliable="qualites.2">
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <Layers className="size-3.5" />
                Densite par role
                <Aide>
                  Les roles exprimes en <strong>ml/m²</strong> consomment de la matiere sans entrer
                  dans le poids commercial du tapis : leur conversion en kg passe par la densite kg/ml
                  de la reference. Le poids commercial affiche ici est la somme des seules lignes en
                  kg/m² ; il est recalcule par le serveur a l'enregistrement.
                </Aide>
              </CarteTitre>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-attenue-texte">
                  Poids commercial :{' '}
                  <span className="font-semibold tabular-nums text-texte">
                    {fmt.nombre(poidsCalcule, 4)} kg/m²
                  </span>
                </span>
                {modifiable && (
                  <Bouton variante="contour" taille="sm" onClick={ajouterLigne}>
                    <Plus />
                    Ajouter une ligne
                  </Bouton>
                )}
              </div>
            </CarteEntete>
            <CarteCorps>
              {edition !== '' && qDensites.isLoading ? (
                <Chargement texte="Chargement de la composition..." />
              ) : (
                <DataTable
                  module={MODULE}
                  colonnes={colonnesLignes}
                  lignes={lignes}
                  cle={(l) => l.cle}
                  recherche={false}
                  pagination={false}
                  tailleParDefaut={500}
                  titreCarte={(l) => libelleRole(l.code_role)}
                  videTitre="Aucune ligne"
                  videDescription="Une qualite sans ligne consomme zero matiere : le MRP ne generera aucun besoin."
                  videAction={
                    modifiable && (
                      <Bouton variante="contour" onClick={ajouterLigne}>
                        <Plus />
                        Ajouter une ligne
                      </Bouton>
                    )
                  }
                  actions={
                    modifiable
                      ? (l) => (
                          <Bouton
                            variante="discret"
                            taille="icone-xs"
                            className="text-danger hover:bg-danger/10"
                            onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))}
                            aria-label="Retirer la ligne"
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
        <Carte repliable="qualites.3">
          <CarteEntete>
            <CarteTitre className="flex items-center gap-1.5">
              <Boxes className="size-3.5" />
              Composition
              <Aide>
                <strong>Une qualite = une composition.</strong> Pas de versionnement : si la
                composition doit changer, dupliquez la qualite sous un nouveau code (SH1, SH2...)
                plutot que de modifier celle-ci. Une matiere ne figure qu'une seule fois, tous roles
                confondus. Le selecteur ne propose que les matieres dont la categorie est destinee
                au role — decochez la case pour voir tout le catalogue. La colonne kg/m² applique la
                densite du role ; elle reste vide pour les roles en ml/m², dont la conversion depend
                de la densite kg/ml de chaque reference.
              </Aide>
            </CarteTitre>
            <div className="flex flex-wrap items-center gap-2">
              {[...sommesParRole.entries()].map(([role, somme]) => (
                <Badge
                  key={role}
                  ton={Math.abs(somme - 100) > 0.5 ? 'danger' : 'succes'}
                  title="R07 : la somme doit valoir 100 % par role, a 0,5 point pres"
                >
                  {libelleRole(role)} {fmt.nombre(somme, 2)} %
                </Badge>
              ))}
              {coutTotalM2 !== null && (
                <span className="text-[11px] text-attenue-texte">
                  Cout matiere :{' '}
                  <span className="font-semibold tabular-nums text-texte">
                    {fmt.nombre(coutTotalM2, 3)} MAD/m²
                  </span>
                </span>
              )}
              {modifiable && (
                <Bouton variante="contour" taille="sm" onClick={ajouterCompo}>
                  <Plus />
                  Ajouter une matiere
                </Bouton>
              )}
            </div>
          </CarteEntete>
          <CarteCorps>
            {edition !== '' && qComposition.isLoading ? (
              <Chargement texte="Chargement de la composition..." />
            ) : (
              <DataTable
                module={MODULE}
                colonnes={colonnesCompo}
                lignes={composition}
                cle={(c) => c.cle}
                recherche={false}
                pagination={false}
                tailleParDefaut={500}
                titreCarte={(c) => `${libelleRole(c.code_role)} · ${c.code_reference}`}
                videTitre="Aucune composition"
                videDescription="Une qualite sans composition ne peut pas etre mise en service : le MRP ne saurait quelle matiere consommer."
                videAction={
                  modifiable && (
                    <Bouton variante="contour" onClick={ajouterCompo}>
                      <Plus />
                      Ajouter une matiere
                    </Bouton>
                  )
                }
                actions={
                  modifiable
                    ? (c) => (
                        <Bouton
                          variante="discret"
                          taille="icone-xs"
                          className="text-danger hover:bg-danger/10"
                          onClick={() =>
                            setComposition((cs) => cs.filter((x) => x.cle !== c.cle))
                          }
                          aria-label="Retirer la matiere"
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

        </div>

        {/* --- Pied : verifications et validation unique -------------------- */}
        {modifiable && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bordure bg-surface px-3 py-2 shadow-sm">
            <div className="min-w-0 text-[12px]">
              {problemes.length > 0 ? (
                <span className="text-danger">A corriger : {problemes.join(' · ')}</span>
              ) : (
                <span className="text-attenue-texte">
                  {lignes.length} densite(s) · {composition.length} ligne(s) de composition ·{' '}
                  {fmt.nombre(poidsCalcule, 4)} kg/m² · pret a enregistrer
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
                Enregistrer la qualite
              </Bouton>
            </div>
          </div>
        )}
      </div>

      {/* --- Choix d'une matiere ------------------------------------------ */}
      {(() => {
        const ligne = composition.find((c) => c.cle === choixMatiere)
        if (!ligne) return null
        return (
          <SelecteurReference
            ouvert
            surOuvert={(o) => !o && setChoixMatiere(null)}
            references={references}
            role={ligne.code_role}
            libelleRole={libelleRole(ligne.code_role)}
            categoriesDuRole={categoriesDuRole(ligne.code_role)}
            dejaPrises={new Set(composition.map((c) => c.code_reference))}
            courante={ligne.code_reference}
            prixVisibles={droits.visible('prix_kg_mad')}
            surChoisir={(code) => majCompo(ligne.cle, 'code_reference', code)}
          />
        )
      })()}

      {confirmation.element}
    </div>
  )
}

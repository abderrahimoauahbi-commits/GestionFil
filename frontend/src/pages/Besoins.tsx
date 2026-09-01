/**
 * Production & Besoins — la feuille `📊 Production_Besoins` du classeur.
 *
 * Deux tableaux qui partagent la meme ossature de mois, celle de la periode
 * glissante du plan :
 *
 *   1. PRODUCTION  — m² par qualite et par mois, rappel de ce que le plan a
 *      deploye ;
 *   2. BESOINS     — kg par reference et par mois, explosion de la production
 *      par les recettes figees.
 *
 *   besoin(ref, mois) = (1 + taux de perte) x Σ_qualites (kg/m² x m² prevus)
 *
 * Cet ecran ne calcule rien : il affiche `besoin_mrp`, materialise par le
 * serveur. Le recalculer ici en JavaScript donnerait une deuxieme verite, qui
 * finirait par diverger de celle qui commande les achats.
 *
 * Les colonnes mensuelles viennent du plan, jamais d'un M01..M12 suppose : un
 * plan sur six mois affiche six colonnes.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Calculator, Download, Factory, Package } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  dansPeriode,
  SelecteurPeriode,
  type Periode,
} from '../composants/SelecteurPeriode'
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
  EtatVide,
} from '../composants/ui/base'
import { Aide } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'MRP'

/**
 * Ce sur quoi une question peut porter dans le tableau des besoins.
 *
 * `total` est la somme sur toute la periode. Les colonnes mensuelles sont
 * dynamiques et n'y figurent pas : filtrer « le besoin de mars » se fait en
 * lisant la colonne, pas en composant une condition sur un nom de mois.
 */
type Statut = 'BROUILLON' | 'SIMULATION' | 'EN_COURS' | 'CLOTURE'

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  SIMULATION: 'Simulation',
  EN_COURS: 'En cours',
  CLOTURE: 'Cloture',
}
const TON_STATUT: Record<string, 'neutre' | 'info' | 'succes' | 'contour'> = {
  BROUILLON: 'neutre',
  SIMULATION: 'info',
  EN_COURS: 'succes',
  CLOTURE: 'contour',
}

const MOIS_COURT = [
  'Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jui',
  'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec',
]

interface PlanListe {
  id_plan: string
  libelle: string
  numero_version: number
  statut: Statut
  date_debut: string
  date_fin: string
  nb_besoins: number
}

interface Dossier {
  plan: {
    id_plan: string
    libelle: string
    scenario_nom: string | null
    statut: Statut
    date_debut: string
    date_fin: string
    mois_horizon: number
    croissance_annuelle_pct: number
    taux_perte_pct: number
    m2_total_annuel: number | null
    nb_besoins: number
    dernier_calcul: string | null
  } | null
  mois: { rang_mois: number; mois: number; annee_mois: string }[]
  production: {
    code_qualite: string
    qualite_nom: string
    poids_commercial_m2: number
    mois: number
    rang_mois: number
    annee_mois: string
    m2_prevus: number
    m2_base_mensuel: number | null
    saisonnalite: number | null
  }[]
  besoins: {
    code_reference: string
    designation: string
    code_categorie: string
    categorie: string
    code_fournisseur: string
    fournisseur: string
    unite_catalogue: string
    facteur_kg: number | null
    mois: number
    rang_mois: number | null
    annee_mois: string | null
    quantite_brute_kg: number
    taux_perte_applique: number
    quantite_kg: number
  }[]
}

/** Libelle court d'un mois AAAA-MM. */
const libelleMois = (am: string) => {
  const [an, mo] = am.split('-').map(Number)
  return `${MOIS_COURT[(mo || 1) - 1]} ${String(an).slice(2)}`
}

export function Besoins() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const [idPlan, setIdPlan] = useState<string>('')
  const [filtre, setFiltre] = useState('')
  const [categorie, setCategorie] = useState('')
  const [fournisseur, setFournisseur] = useState('')
  const [periode, setPeriode] = useState<Periode>({ debut: null, fin: null })

  const qPlans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<PlanListe[]>('/api/plans'),
  })

  // A l'ouverture, on vise le plan qui alimente reellement les achats.
  const planParDefaut = useMemo(() => {
    const l = qPlans.data ?? []
    return l.find((p) => p.statut === 'EN_COURS')?.id_plan ?? l[0]?.id_plan ?? ''
  }, [qPlans.data])

  const planVise = idPlan || planParDefaut

  const qDossier = useQuery({
    queryKey: ['production-besoins', planVise],
    queryFn: () => api.get<Dossier>(`/api/plans/${planVise}/production-besoins`),
    enabled: !!planVise,
  })

  const recalcul = useMutation({
    mutationFn: (id: string) =>
      api.post<{ lignes_generees: number; total_kg: number }>(`/api/plans/${id}/mrp`),
    onSuccess: (r) => {
      toast.success('Besoins recalcules', {
        description: `${r.lignes_generees} ligne(s) · ${fmt.nombre(r.total_kg, 2)} kg`,
      })
      void qc.invalidateQueries({ queryKey: ['production-besoins'] })
      void qc.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  const d = qDossier.data
  const mois = d?.mois ?? []

  /** Production pivotee : une ligne par qualite, une colonne par mois. */
  const production = useMemo(() => {
    const m = new Map<
      string,
      { code_qualite: string; qualite_nom: string; poids: number; par_mois: Map<number, number>; total: number }
    >()
    for (const p of d?.production ?? []) {
      let e = m.get(p.code_qualite)
      if (!e) {
        e = {
          code_qualite: p.code_qualite,
          qualite_nom: p.qualite_nom,
          poids: p.poids_commercial_m2,
          par_mois: new Map(),
          total: 0,
        }
        m.set(p.code_qualite, e)
      }
      e.par_mois.set(p.rang_mois, p.m2_prevus)
      e.total += p.m2_prevus
    }
    return [...m.values()].sort((a, b) => a.code_qualite.localeCompare(b.code_qualite))
  }, [d])

  /** Besoins pivotes : une ligne par reference, une colonne par mois. */
  /* Valeurs disponibles pour les filtres, tirees du dossier lui-meme : sur un
     plan donne, seules certaines categories et certains fournisseurs
     apparaissent, et proposer les autres menerait a un tableau vide. */
  const axes = useMemo(() => {
    const c = new Set<string>()
    const f = new Set<string>()
    const mo = new Set<string>()
    for (const b of d?.besoins ?? []) {
      if (b.categorie) c.add(b.categorie)
      if (b.fournisseur) f.add(b.fournisseur)
      if (b.annee_mois) mo.add(b.annee_mois)
    }
    return {
      categories: [...c].sort(),
      fournisseurs: [...f].sort(),
      mois: [...mo].sort(),
    }
  }, [d])

  const besoins = useMemo(() => {
    const m = new Map<
      string,
      {
        code_reference: string
        designation: string
        categorie: string
        fournisseur: string
        unite: string
        facteur_kg: number | null
        par_mois: Map<number, number>
        total: number
      }
    >()
    for (const b of d?.besoins ?? []) {
      /* Categorie, fournisseur et periode s'appliquent AVANT le pivot : filtrer
         apres laisserait les totaux calcules sur toute la duree du plan, donc
         un total qui ne correspond pas aux colonnes affichees. */
      if (categorie && b.categorie !== categorie) continue
      if (fournisseur && b.fournisseur !== fournisseur) continue
      if (!dansPeriode(b.annee_mois, periode)) continue

      let e = m.get(b.code_reference)
      if (!e) {
        e = {
          code_reference: b.code_reference,
          designation: b.designation,
          categorie: b.categorie,
          fournisseur: b.fournisseur,
          unite: b.unite_catalogue,
          facteur_kg: b.facteur_kg,
          par_mois: new Map(),
          total: 0,
        }
        m.set(b.code_reference, e)
      }
      if (b.rang_mois !== null) e.par_mois.set(b.rang_mois, b.quantite_kg)
      e.total += b.quantite_kg
    }
    const q = filtre.trim().toLowerCase()
    return [...m.values()]
      .filter(
        (b) =>
          !q ||
          b.code_reference.toLowerCase().includes(q) ||
          b.designation.toLowerCase().includes(q) ||
          b.fournisseur.toLowerCase().includes(q) ||
          b.categorie.toLowerCase().includes(q),
      )
      .sort((a, b) => b.total - a.total)
  }, [d, filtre, categorie, fournisseur, periode])

  // Le filtre personnalise s'applique APRES le pivot : il porte sur la ligne
  /* Les filtres — categorie, fournisseur, periode — s'appliquent AVANT le
     pivot, dans `besoins` : les appliquer ici, sur la ligne pivotee, laisserait
     des totaux calcules sur toute la duree du plan alors que les colonnes n'en
     montrent qu'une partie. */
  const besoinsFiltres = besoins

  const totalKg = besoins.reduce((s, b) => s + b.total, 0)
  const totalM2 = production.reduce((s, p) => s + p.total, 0)

  /** Export CSV : ce que les acheteurs ouvrent dans Excel pour consulter. */
  function exporter() {
    const sep = ';'
    const enTete = [
      'Code Ref', 'Designation', 'Categorie', 'Fournisseur', 'Unite',
      ...mois.map((m) => libelleMois(m.annee_mois)),
      'Total kg',
    ]
    const lignes = besoinsFiltres.map((b) => [
      b.code_reference, b.designation, b.categorie, b.fournisseur, b.unite,
      ...mois.map((m) => (b.par_mois.get(m.rang_mois) ?? 0).toFixed(3)),
      b.total.toFixed(3),
    ])
    // Le point-virgule et la virgule decimale sont ce qu'attend un Excel
    // francophone ; le BOM lui evite de mal lire les accents.
    const csv =
      '﻿' +
      [enTete, ...lignes]
        .map((l) => l.map((c) => String(c).replace(/;/g, ',')).join(sep))
        .join('\r\n')
        .replace(/(\d)\.(\d)/g, '$1,$2')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `besoins-${d?.plan?.libelle ?? 'plan'}.csv`.replace(/[^\w.-]+/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }

  if (qPlans.isLoading) return <Chargement />

  if (!qPlans.data?.length) {
    return (
      <div>
        <EnTetePage titre="Production & Besoins" />
        <EtatVide
          icone={Factory}
          titre="Aucun plan de production"
          description="Les besoins matiere se deduisent d'un plan : commencez par en creer un."
        />
      </div>
    )
  }

  const plan = d?.plan

  return (
    <div>
      <EnTetePage
        titre="Production & Besoins"
        description="m² planifies par qualite, et matiere necessaire par reference, sur les mois de la periode."
        actions={
          <>
            {/* Le choix du plan remonte ici : c'est le contexte de TOUT l'ecran,
                pas un filtre parmi d'autres. Un rail de 240 px pour une liste
                deroulante prenait un sixieme de la largeur au tableau, qui en a
                besoin — il porte un mois par colonne. */}
            <select
              value={planVise}
              onChange={(e) => setIdPlan(e.target.value)}
              className={CLASSE_FILTRE + ' max-w-[22rem] font-medium'}
              aria-label="Plan de production"
            >
              {qPlans.data.map((p) => (
                <option key={p.id_plan} value={p.id_plan}>
                  {p.libelle} (v{p.numero_version}) — {LIBELLE_STATUT[p.statut] ?? p.statut}
                </option>
              ))}
            </select>
            {droits.peutEcrire && plan && plan.statut !== 'CLOTURE' && (
              <Bouton
                variante="contour"
                onClick={() => recalcul.mutate(plan.id_plan)}
                chargement={recalcul.isPending}
                title="Reexploser le plan par les recettes figees"
              >
                <Calculator />
                Recalculer les besoins
              </Bouton>
            )}
            <Bouton variante="contour" onClick={exporter} disabled={!besoinsFiltres.length}>
              <Download />
              Exporter
            </Bouton>
          </>
        }
      />

      {qDossier.isLoading ? (
        <Chargement texte="Chargement du plan et des besoins..." />
      ) : !plan ? (
        <EtatVide icone={Factory} titre="Plan introuvable" />
      ) : (
        <div className="space-y-3">
          {/* --- Bandeau de contexte ---------------------------------------- */}
          <Carte repliable="besoins.1">
            <CarteCorps className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
              <span className="flex items-center gap-1.5">
                <Badge ton={TON_STATUT[plan.statut] ?? 'neutre'}>
                  {LIBELLE_STATUT[plan.statut] ?? plan.statut}
                </Badge>
                {plan.scenario_nom && (
                  <span className="text-attenue-texte">· {plan.scenario_nom}</span>
                )}
              </span>
              <span className="text-attenue-texte">
                Periode{' '}
                <span className="tabular-nums text-texte">
                  {fmt.date(plan.date_debut)} → {fmt.date(plan.date_fin)}
                </span>{' '}
                ({plan.mois_horizon} mois)
              </span>
              <span className="text-attenue-texte">
                Croissance{' '}
                <span className="tabular-nums text-texte">
                  {fmt.nombre(plan.croissance_annuelle_pct, 2)} %
                </span>
              </span>
              <span className="text-attenue-texte">
                Taux de perte applique{' '}
                <span className="tabular-nums text-texte">
                  {fmt.nombre(plan.taux_perte_pct, 2)} %
                </span>
              </span>
              <span className="ml-auto text-attenue-texte">
                Dernier calcul{' '}
                <span className="text-texte">{fmt.dateHeure(plan.dernier_calcul)}</span>
              </span>
            </CarteCorps>
          </Carte>

          {plan.statut === 'CLOTURE' && (
            <Alerte ton="alerte">
              Plan cloture : ces besoins restent consultables comme historique, mais n'alimentent
              plus le plan d'achat.
            </Alerte>
          )}
          {plan.statut !== 'EN_COURS' && plan.statut !== 'CLOTURE' && (
            <Alerte ton="info">
              Ce plan n'est pas encore en service : ses besoins sont une simulation. Seul le plan
              en cours alimente le plan d'achat.
            </Alerte>
          )}
          {plan.nb_besoins === 0 && (
            <Alerte ton="alerte" titre="Aucun besoin calcule">
              La production est planifiee mais le MRP n'a pas encore tourne. Lancez « Recalculer les
              besoins » — sans cela, aucune matiere ne sera proposee a l'achat.
            </Alerte>
          )}

          {/* --- 1. Production ---------------------------------------------- */}
          <Carte repliable="besoins.2">
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <Factory className="size-3.5" />
                Production planifiee — m² par qualite
              </CarteTitre>
              <span className="text-[11px] text-attenue-texte">
                Total{' '}
                <span className="font-semibold tabular-nums text-texte">
                  {fmt.entier(totalM2)} m²
                </span>
              </span>
            </CarteEntete>
            <CarteCorps className="p-0">
              <div className="defilement-x">
                <table className="grille w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue">
                      <th className="sticky left-0 z-10 bg-attenue px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                        Qualite
                      </th>
                      <th className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte whitespace-nowrap">
                        Poids kg/m²
                      </th>
                      {mois.map((m) => (
                        <th
                          key={m.rang_mois}
                          className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte whitespace-nowrap"
                        >
                          {libelleMois(m.annee_mois)}
                        </th>
                      ))}
                      <th className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                        Total m²
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {production.map((p) => (
                      <tr key={p.code_qualite} className="hover:bg-attenue/60">
                        <td className="sticky left-0 z-10 bg-surface px-2.5 py-1 whitespace-nowrap">
                          <span className="font-medium">{p.code_qualite}</span>
                          <span className="ml-1.5 text-[11px] text-attenue-texte">
                            {p.qualite_nom}
                          </span>
                        </td>
                        <td className="px-2.5 py-1 text-right tabular-nums text-attenue-texte">
                          {fmt.nombre(p.poids, 3)}
                        </td>
                        {mois.map((m) => (
                          <td key={m.rang_mois} className="px-2.5 py-[5px] text-right tabular-nums">
                            {fmt.entier(p.par_mois.get(m.rang_mois) ?? 0)}
                          </td>
                        ))}
                        <td className="px-2.5 py-1 text-right font-semibold tabular-nums">
                          {fmt.entier(p.total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-bordure bg-attenue/40 font-semibold">
                      <td className="sticky left-0 z-10 bg-attenue px-2.5 py-1.5">TOTAL m²/mois</td>
                      <td />
                      {mois.map((m) => (
                        <td key={m.rang_mois} className="px-2.5 py-1.5 text-right tabular-nums">
                          {fmt.entier(
                            production.reduce((s, p) => s + (p.par_mois.get(m.rang_mois) ?? 0), 0),
                          )}
                        </td>
                      ))}
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {fmt.entier(totalM2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CarteCorps>
          </Carte>

          {/* --- 2. Besoins matiere ----------------------------------------- */}
          <Carte repliable="besoins.3">
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <Package className="size-3.5" />
                Besoins matiere — kg par reference
                <Aide>
                  besoin(reference, mois) = (1 + taux de perte) × Σ<sub>qualites</sub> (kg/m² de la
                  composition × m² prevus) — la formule de la feuille Production_Besoins. Le taux de
                  perte applique est celui fige sur le plan ({fmt.nombre(plan.taux_perte_pct, 2)} %),
                  pas le parametre general du jour. Les quantites sont en <strong>kg</strong>, unite
                  canonique : la conversion vers l'unite d'achat se fait au bon de commande.
                </Aide>
              </CarteTitre>
              <div className="flex items-center gap-2">
                <Champ
                  value={filtre}
                  onChange={(e) => setFiltre(e.target.value)}
                  placeholder="Reference, designation, fournisseur..."
                  className="w-56"
                />
                <select
                  value={categorie}
                  onChange={(e) => setCategorie(e.target.value)}
                  className={CLASSE_FILTRE}
                  aria-label="Categorie"
                >
                  <option value="">Toutes categories</option>
                  {axes.categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={fournisseur}
                  onChange={(e) => setFournisseur(e.target.value)}
                  className={CLASSE_FILTRE}
                  aria-label="Fournisseur"
                >
                  <option value="">Tous fournisseurs</option>
                  {axes.fournisseurs.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <SelecteurPeriode
                  mois={axes.mois}
                  valeur={periode}
                  surChangement={setPeriode}
                />
                <span className="text-[11px] text-attenue-texte">
                  {besoinsFiltres.length} ref. ·{' '}
                  <span className="font-semibold tabular-nums text-texte">
                    {fmt.nombre(totalKg, 2)} kg
                  </span>
                </span>
              </div>
            </CarteEntete>
            <CarteCorps className="p-0">
              {!besoinsFiltres.length ? (
                <div className="p-4">
                  <EtatVide
                    icone={AlertTriangle}
                    titre={filtre ? 'Aucune reference ne correspond' : 'Aucun besoin calcule'}
                    description={
                      filtre
                        ? undefined
                        : "Lancez le calcul MRP pour exploser la production par les recettes figees."
                    }
                  />
                </div>
              ) : (
                <div className="defilement-x" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  <table className="grille w-full text-[12px]">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-attenue">
                        <th className="sticky left-0 z-10 border-b border-bordure bg-attenue px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                          Reference
                        </th>
                        <th className="border-b border-bordure bg-attenue px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                          Categorie
                        </th>
                        <th className="hidden border-b border-bordure bg-attenue px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte xl:table-cell">
                          Fournisseur
                        </th>
                        {mois.map((m) => (
                          <th
                            key={m.rang_mois}
                            className="border-b border-bordure bg-attenue px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte whitespace-nowrap"
                          >
                            {libelleMois(m.annee_mois)}
                          </th>
                        ))}
                        <th className="border-b border-bordure bg-attenue px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                          Total kg
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {besoinsFiltres.map((b) => (
                        <tr
                          key={b.code_reference}
                          className="hover:bg-attenue/60"
                        >
                          <td className="sticky left-0 z-10 bg-surface px-2.5 py-1 whitespace-nowrap">
                            <span className="font-medium">{b.code_reference}</span>
                            <span className="ml-1.5 text-[11px] text-attenue-texte">
                              {b.designation}
                            </span>
                          </td>
                          <td className="px-2.5 py-1 text-attenue-texte whitespace-nowrap">
                            {b.categorie}
                          </td>
                          <td className="hidden px-2.5 py-1 text-attenue-texte whitespace-nowrap xl:table-cell">
                            {b.fournisseur}
                          </td>
                          {mois.map((m) => {
                            const v = b.par_mois.get(m.rang_mois) ?? 0
                            return (
                              <td
                                key={m.rang_mois}
                                className={cn(
                                  'px-2.5 py-1 text-right tabular-nums',
                                  v === 0 && 'text-attenue-texte',
                                )}
                              >
                                {v === 0 ? '—' : fmt.nombre(v, 1)}
                              </td>
                            )
                          })}
                          <td className="px-2.5 py-1 text-right font-semibold tabular-nums">
                            {fmt.nombre(b.total, 1)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-bordure bg-attenue/40 font-semibold">
                        <td className="sticky left-0 z-10 bg-attenue px-2.5 py-1.5">TOTAL kg</td>
                        <td />
                        <td className="hidden xl:table-cell" />
                        {mois.map((m) => (
                          <td key={m.rang_mois} className="px-2.5 py-1.5 text-right tabular-nums">
                            {fmt.nombre(
                              besoins.reduce((s, b) => s + (b.par_mois.get(m.rang_mois) ?? 0), 0),
                              1,
                            )}
                          </td>
                        ))}
                        <td className="px-2.5 py-1.5 text-right tabular-nums">
                          {fmt.nombre(totalKg, 1)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CarteCorps>
          </Carte>
        </div>
      )}
    </div>
  )
}

const CLASSE_FILTRE =
  'h-8 rounded-[var(--radius-sm)] border border-champ bg-surface px-2 text-[12px] ' +
  'text-texte outline-none focus:border-primaire'

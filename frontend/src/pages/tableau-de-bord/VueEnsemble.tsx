/**
 * Tableau de bord — la vue d'ensemble (06/10/2026).
 *
 * LA PAGE QU'ON OUVRE LE MATIN, construite comme celles des logiciels de
 * reference (Fiori « overview page », Dynamics, Odoo) :
 *
 *   1. six CHIFFRES CLES, chacun avec sa tendance quand l'historique existe —
 *      la valeur du stock, ce qui est engage, ce qui reste a engager, la
 *      couverture, les ruptures, les economies a saisir ;
 *   2. le FLUX DE MATIERE mois par mois a cote de ce qui ATTEND une decision ;
 *   3. le RISQUE DE RUPTURE mois par mois a cote de la SANTE du catalogue ;
 *   4. les DECISIONS LES PLUS URGENTES, a cote de la depense par fournisseur ;
 *   5. l'exposition aux devises, les classes ABC, la coherence des donnees.
 *
 * Chaque bloc dit d'ou vient son chiffre et mene a l'ecran ou l'on agit. Le
 * detail est dans les autres pages (Risques et files, Analyse, Opportunites,
 * Matiere) : on vient ici pour voir, on va la-bas pour faire.
 *
 * Les droits sont ceux du poste de travail : une file n'apparait que si le
 * role peut VOIR le champ et AGIR dessus ; un champ masque par le serveur
 * s'affiche « — ».
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Gauge,
  PackageX,
  PiggyBank,
  Wallet,
  Warehouse,
} from 'lucide-react'
import { api } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { CarteStat } from '../../composants/CarteStat'
import { Alerte, Badge, Squelette } from '../../composants/ui/base'
import { Anneau, BarresClassees, Colonnes, TON, compact } from '../../composants/graphiques/Visuels'
import { cn, fmt } from '../../lib/utils'
import { OngletsTableauDeBord } from './Onglets'
import { Bloc, EnPanne, Marge, Vide, libelleMois, useFiles } from './commun'

interface MoisRisque {
  annee_mois: string
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
  premier_mois_risque: string | null
  marge_decision_jours: number | null
  equivalent_dispo_kg: number | null
  equivalent_reference: string | null
  mois: MoisRisque[]
}
interface Analyse {
  devises?: { code_devise?: string; nb_references?: number; montant_mad?: number; part_pct?: number }[]
  fournisseurs?: { fournisseur_nom: string; nb_references: number; budget_annuel_mad?: number }[]
  abc_statut?: { classe_abc: string; en_alerte: number; attention: number; ok: number }[]
  tresorerie?: { rotation_annuelle: number; dio_jours: number }
  indicateurs?: {
    couverture_ponderee_jours: number | null
    economies_total_mad?: number
    nb_opportunites: number
  }
}
interface MoisMouvement {
  annee_mois: string
  signe: number
  quantite_kg: number
  valeur_mad?: number
}
interface Controle {
  code: string
  controle: string
  criticite: string
  anomalies: number
}


export function VueEnsemble() {
  const { peut, moi } = useAuth()
  const lisMvt = peut('MOUVEMENTS', 'LIRE')
  // Les montants suivent la grille : qui ne voit pas la valeur du stock ne
  // voit ni la depense par fournisseur ni les devises en MAD (08/10/2026).
  const voit = useDroits('COCKPIT').visible('valeur_stock_mad')

  const qKpi = useQuery({ queryKey: ['cockpit'], queryFn: ({ signal }) => api.get<Record<string, unknown>>('/api/cockpit', { signal }) })
  const qAna = useQuery({ queryKey: ['cockpit-analyse'], queryFn: ({ signal }) => api.get<Analyse>('/api/cockpit/analyse', { signal }) })
  const qRisques = useQuery({ queryKey: ['cockpit-risques'], queryFn: ({ signal }) => api.get<Risque[]>('/api/cockpit/risques', { signal }) })
  const qCtl = useQuery({ queryKey: ['controles'], queryFn: ({ signal }) => api.get<Controle[]>('/api/controles', { signal }) })
  const qMvt = useQuery({
    queryKey: ['stats', 'mouvements'],
    queryFn: ({ signal }) => api.get<{ mois: MoisMouvement[] }>('/api/stats/mouvements', { signal }),
    enabled: lisMvt,
  })

  const k = qKpi.data ?? {}
  const n = (c: string) => (typeof k[c] === 'number' ? (k[c] as number) : null)
  const nn = (c: string) => n(c) ?? 0
  const a = qAna.data ?? {}
  const ind = a.indicateurs

  /* --- Le flux de matiere : entrees et sorties par mois, 12 derniers mois --- */
  const flux = useMemo(() => {
    const parMois = new Map<string, { e: number; s: number; ve: number }>()
    for (const m of qMvt.data?.mois ?? []) {
      const x = parMois.get(m.annee_mois) ?? { e: 0, s: 0, ve: 0 }
      if (m.signe > 0) {
        x.e += m.quantite_kg
        x.ve += m.valeur_mad ?? 0
      } else if (m.signe < 0) x.s += Math.abs(m.quantite_kg)
      parMois.set(m.annee_mois, x)
    }
    const cles = [...parMois.keys()].sort().slice(-12)
    return { cles, e: cles.map((c) => parMois.get(c)!.e), s: cles.map((c) => parMois.get(c)!.s), ve: cles.map((c) => parMois.get(c)!.ve) }
  }, [qMvt.data])

  /* --- Le risque, mois par mois : combien de references tendues / en rupture --- */
  const risques = useMemo(() => qRisques.data ?? [], [qRisques.data])
  const horizon = useMemo(() => {
    const mois = risques[0]?.mois?.map((m) => m.annee_mois) ?? []
    return {
      mois,
      rupture: mois.map((_, i) => risques.filter((r) => r.mois[i]?.statut === 'PLAN_NON_COUVERT').length),
      tendu: mois.map((_, i) => risques.filter((r) => r.mois[i]?.statut === 'SOUS_SECURITE').length),
    }
  }, [risques])
  const urgentes = useMemo(
    () =>
      [...risques]
        .sort((x, y) => (x.marge_decision_jours ?? 9999) - (y.marge_decision_jours ?? 9999))
        .slice(0, 8),
    [risques],
  )

  /* --- Ce qui attend : les memes files et les memes regles que le poste de
         travail (voir Cockpit.tsx) --- */
  const { files: mesFiles, erreur: erreurFiles } = useFiles()

  const anomalies = (qCtl.data ?? []).filter((c) => c.anomalies > 0)
  const chargement = qKpi.isLoading

  const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">
      <EnTetePage
        titre="Tableau de bord"
        description={`Bonjour ${moi?.login ?? ''} · ${aujourdhui}${
          k.besoins_calcules_le ? ` · besoins calculés le ${fmt.dateHeure(k.besoins_calcules_le as string)}` : ''
        }`}
      />
      <OngletsTableauDeBord />

      {nn('besoins_perimes') > 0 && (
        <Alerte ton="danger" titre="Les alertes reposent sur des besoins périmés">
          Le plan, une recette ou une densité a changé depuis le dernier calcul MRP. Relancez le calcul avant de décider.
        </Alerte>
      )}

      {/* ---- 1. Les chiffres clés --------------------------------------------- */}
      {qKpi.isError ? (
        <Alerte ton="danger" titre="Chiffres clés indisponibles">
          Le serveur n'a pas répondu : les compteurs, les files et la santé du catalogue ne peuvent pas être affirmés.
        </Alerte>
      ) : chargement ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Squelette key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <CarteStat
            Icone={Warehouse}
            libelle="Valeur du stock"
            valeur={n('valeur_stock_mad') == null ? '—' : compact(nn('valeur_stock_mad'))}
            unite="MAD"
            precision={`${nn('nb_references')} références${a.tresorerie ? ` · rotation ${fmt.nombre(a.tresorerie.rotation_annuelle, 1)}×/an` : ''}`}
            ton="primaire"
            courbe={voit && flux.ve.length >= 3 ? flux.ve : undefined}
            aide="Valorisée au CMUP. La courbe : la valeur des entrées des derniers mois."
          />
          <CarteStat
            Icone={Wallet}
            libelle="Engagé chez les fournisseurs"
            valeur={n('montant_bc_ouverts_mad') == null ? '—' : compact(nn('montant_bc_ouverts_mad'))}
            unite="MAD"
            precision={`${nn('nb_bc_ouverts')} bons ouverts`}
            ton="neutre"
          />
          <CarteStat
            Icone={CircleDollarSign}
            libelle="Reste à engager"
            valeur={n('budget_a_engager_mad') == null ? '—' : compact(nn('budget_a_engager_mad'))}
            unite="MAD"
            precision={`${nn('nb_refs_a_commander')} références à commander`}
            ton="alerte"
          />
          <CarteStat
            Icone={Gauge}
            libelle="Couverture du stock"
            valeur={ind?.couverture_ponderee_jours == null ? '—' : fmt.nombre(ind.couverture_ponderee_jours, 0)}
            unite="jours"
            precision="au plan — moteur de couverture, pondérée par la valeur du stock"
            ton={ind?.couverture_ponderee_jours != null && ind.couverture_ponderee_jours < 30 ? 'alerte' : 'succes'}
            aide="Jours couverts par le moteur de couverture (jusqu’à la 1re rupture du plan, sinon tout l’horizon), pondérés par la valeur en stock de chaque référence au plan."
          />
          <CarteStat
            Icone={PackageX}
            libelle="Plan non couvert"
            valeur={n('nb_plan_non_couvert') == null ? '—' : `${nn('nb_plan_non_couvert')}`}
            unite={`/ ${nn('nb_references')}`}
            precision={`${nn('nb_a_commander_aujourdhui')} à commander aujourd’hui · ${nn('nb_sous_securite')} sous la sécurité`}
            ton={nn('nb_plan_non_couvert') > 0 ? 'danger' : 'succes'}
            barres={horizon.rupture.length >= 3 ? horizon.rupture : undefined}
            aide="Moteur de couverture. Les barres : les références au plan non couvert, mois par mois, sur l'horizon du plan."
          />
          <CarteStat
            Icone={PiggyBank}
            libelle="Économies identifiées"
            valeur={ind?.economies_total_mad == null ? '—' : compact(ind.economies_total_mad)}
            unite="MAD/an"
            precision={`${ind?.nb_opportunites ?? 0} opportunités à qualité égale · au plan`}
            ton="succes"
          />
        </div>
      )}

      {/* ---- 2. Le flux de matière | Ce qui attend --------------------------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Bloc
          className="xl:col-span-2"
          titre="Flux de matière"
          sousTitre="Entrées et sorties de stock, en kg, sur les 12 derniers mois"
          lien={lisMvt ? { vers: '/statistiques', libelle: 'Statistiques' } : undefined}
        >
          {!lisMvt ? (
            <Vide texte="Réservé aux rôles qui lisent les mouvements." />
          ) : qMvt.isError ? (
            <EnPanne />
          ) : qMvt.isLoading ? (
            <Squelette className="h-56" />
          ) : flux.cles.length === 0 ? (
            <Vide texte="Aucun mouvement enregistré." />
          ) : (
            <Colonnes
              libelles={flux.cles.map(libelleMois)}
              unite="kg"
              series={[
                { cle: 'e', libelle: 'Entrées', valeurs: flux.e, couleur: TON.primaire },
                { cle: 's', libelle: 'Sorties', valeurs: flux.s, couleur: '#8B5CF6' },
              ]}
            />
          )}
        </Bloc>

        <Bloc titre="À traiter" sousTitre={mesFiles.length ? `${mesFiles.length} file(s) attendent votre décision` : undefined} corpsSansMarge>
          {qKpi.isError || erreurFiles ? (
            <EnPanne />
          ) : chargement ? (
            <div className="space-y-2 p-4">
              <Squelette className="h-8" />
              <Squelette className="h-8" />
            </div>
          ) : mesFiles.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-[13px] text-succes">
              <CheckCircle2 className="size-4" /> Rien n'attend de décision pour votre rôle.
            </div>
          ) : (
            <ul className="divide-y divide-ligne">
              {mesFiles.map((f) => (
                <li key={`${f.champ}:${f.vers}`}>
                  <Link
                    to={f.vers ?? '#'}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-attenue"
                  >
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)]',
                        f.ton === 'danger' ? 'bg-danger/10 text-danger' : f.ton === 'alerte' ? 'bg-alerte/12 text-alerte' : 'bg-attenue text-attenue-texte',
                      )}
                    >
                      <f.Icone className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-texte">{f.libelle}</span>
                      {f.detail && <span className="block truncate text-[11px] text-attenue-texte">{f.detail}</span>}
                    </span>
                    <span className={cn('text-[16px] font-semibold tabular-nums', f.ton === 'danger' ? 'text-danger' : f.ton === 'alerte' ? 'text-alerte' : 'text-texte')}>
                      {f.valeur}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-attenue-texte" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>

      {/* ---- 3. Le risque de rupture | La santé du catalogue ----------------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Bloc
          className="xl:col-span-2"
          titre="Risque de rupture, mois par mois"
          sousTitre="Moteur de couverture : références au plan non couvert ou sous la sécurité, arrivages comptés à leur date"
          lien={{ vers: '/tableau-de-bord/situation', libelle: 'Mur de risques' }}
        >
          {qRisques.isError ? (
            <EnPanne />
          ) : qRisques.isLoading ? (
            <Squelette className="h-56" />
          ) : horizon.mois.length === 0 ? (
            <Vide texte="Aucune référence ne descend sous son stock de sécurité sur l'horizon du plan." ok />
          ) : (
            <Colonnes
              empilees
              libelles={horizon.mois.map(libelleMois)}
              unite="références"
              series={[
                { cle: 'r', libelle: 'Plan non couvert', valeurs: horizon.rupture, couleur: TON.danger },
                { cle: 't', libelle: 'Sous la sécurité', valeurs: horizon.tendu, couleur: TON.alerte },
              ]}
            />
          )}
        </Bloc>

        <Bloc titre="Santé du catalogue" sousTitre="Statut de couverture de chaque référence suivie" lien={{ vers: '/stock', libelle: 'Stock projeté' }}>
          {qKpi.isError ? (
            <EnPanne />
          ) : chargement ? (
            <Squelette className="h-44" />
          ) : (
            <Anneau
              centre={String(nn('nb_references'))}
              sousCentre="références"
              parts={[
                { libelle: 'Couvert', valeur: nn('nb_couvert'), couleur: TON.succes },
                { libelle: 'Sous la sécurité', valeur: nn('nb_sous_securite'), couleur: TON.alerte },
                { libelle: 'Plan non couvert', valeur: nn('nb_plan_non_couvert'), couleur: TON.danger },
              ]}
            />
          )}
        </Bloc>
      </div>

      {/* ---- 4. Les décisions urgentes | La dépense par fournisseur ---------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Bloc
          className="xl:col-span-2"
          titre="Les décisions les plus urgentes"
          sousTitre="Triées par la marge qui reste pour commander à temps, délai fournisseur déduit"
          lien={{ vers: '/plan-achat', libelle: "Plan d'achat" }}
          corpsSansMarge
        >
          {qRisques.isError ? (
            <EnPanne />
          ) : qRisques.isLoading ? (
            <div className="p-4"><Squelette className="h-40" /></div>
          ) : urgentes.length === 0 ? (
            <Vide texte="Aucune décision urgente." ok />
          ) : (
            <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
              <table className="grille w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] text-attenue-texte">
                    <th className="px-4 py-2 font-medium">Référence</th>
                    <th className="px-3 py-2 font-medium">Sourcing</th>
                    <th className="px-3 py-2 text-right font-medium">Délai</th>
                    <th className="px-3 py-2 font-medium">À risque dès</th>
                    <th className="px-3 py-2 font-medium">Équivalent</th>
                    <th className="px-4 py-2 text-right font-medium">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {urgentes.map((r) => (
                    <tr key={r.code_reference} className="border-t border-ligne">
                      <td className="max-w-64 px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-texte">{r.code_reference}</span>
                          {r.classe_abc && <Badge ton={r.classe_abc === 'A' ? 'danger' : 'neutre'}>{r.classe_abc}</Badge>}
                        </div>
                        <div className="truncate text-[11px] text-attenue-texte">{r.fournisseur_nom ?? 'sans fournisseur'}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.risque_sourcing === 'MONO-SOURCE' ? <Badge ton="danger">mono-source</Badge> : <span className="text-[11px] text-attenue-texte">multi</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-attenue-texte">
                        {r.delai_livraison_jours == null ? '—' : `${r.delai_livraison_jours} j`}
                      </td>
                      <td className="px-3 py-2 text-attenue-texte">{r.premier_mois_risque ? libelleMois(r.premier_mois_risque) : '—'}</td>
                      <td className="px-3 py-2">
                        {(r.equivalent_dispo_kg ?? 0) > 0 ? (
                          <span className="text-[12px] text-info" title={r.equivalent_reference ?? ''}>
                            {compact(r.equivalent_dispo_kg ?? 0)} kg dispo
                          </span>
                        ) : (
                          <span className="text-[11px] text-attenue-texte">aucun</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Marge jours={r.marge_decision_jours} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloc>

        <Bloc titre="Dépense annuelle par fournisseur" sousTitre="Budget de consommation, au prix d'achat" lien={{ vers: '/fournisseurs', libelle: 'Fournisseurs' }}>
          {qAna.isError ? (
            <EnPanne />
          ) : !voit ? (
            <Vide texte="Montants réservés aux rôles qui voient la valeur du stock." />
          ) : qAna.isLoading ? (
            <Squelette className="h-56" />
          ) : !(a.fournisseurs ?? []).length ? (
            <Vide texte="Pas de données de dépense." />
          ) : (
            <BarresClassees
              donnees={(a.fournisseurs ?? []).slice(0, 7).map((f, i) => ({
                cle: f.fournisseur_nom + i,
                libelle: f.fournisseur_nom,
                detail: `${f.nb_references} réf.`,
                valeur: f.budget_annuel_mad ?? 0,
              }))}
              format={(v) => `${compact(v)} MAD`}
            />
          )}
        </Bloc>
      </div>

      {/* ---- 5. Devises | Classes ABC | Cohérence ------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Bloc titre="Exposition aux devises" sousTitre="Part de la consommation réelle des 12 mois pleins, par devise de facturation" lien={{ vers: '/tableau-de-bord/analyse', libelle: 'Analyse' }}>
          {qAna.isError ? (
            <EnPanne />
          ) : qAna.isLoading ? (
            <Squelette className="h-44" />
          ) : !(a.devises ?? []).some((d) => d.code_devise) ? (
            <Vide texte="Réservé aux rôles qui voient les prix et leurs devises." />
          ) : (
            <Anneau
              centre={`${(a.devises ?? []).length}`}
              sousCentre="devises"
              format={(v) => (voit ? `${compact(v)} MAD` : `${v} réf.`)}
              parts={(a.devises ?? []).map((d) => ({ libelle: d.code_devise ?? '—', valeur: voit ? (d.montant_mad ?? 0) : (d.nb_references ?? 0) }))}
            />
          )}
        </Bloc>

        <Bloc titre="Classes ABC en alerte" sousTitre="Les références A pèsent 80 % de la consommation" lien={{ vers: '/classification', libelle: 'ABC / XYZ' }}>
          {qAna.isError ? (
            <EnPanne />
          ) : qAna.isLoading ? (
            <Squelette className="h-44" />
          ) : (
            <Colonnes
              empilees
              hauteur={180}
              libelles={(a.abc_statut ?? []).map((x) => `Classe ${x.classe_abc}`)}
              series={[
                { cle: 'ok', libelle: 'Couvert', valeurs: (a.abc_statut ?? []).map((x) => x.ok), couleur: TON.succes },
                { cle: 'at', libelle: 'Sous la sécurité', valeurs: (a.abc_statut ?? []).map((x) => x.attention), couleur: TON.alerte },
                { cle: 'al', libelle: 'Plan non couvert', valeurs: (a.abc_statut ?? []).map((x) => x.en_alerte), couleur: TON.danger },
              ]}
            />
          )}
        </Bloc>

        <Bloc titre="Cohérence des données" sousTitre="Contrôles métier en anomalie" lien={{ vers: '/controles', libelle: 'Contrôles' }} corpsSansMarge>
          {qCtl.isError ? (
            <EnPanne />
          ) : qCtl.isLoading ? (
            <div className="p-4"><Squelette className="h-32" /></div>
          ) : anomalies.length === 0 ? (
            <Vide texte="Aucune anomalie : les données sont cohérentes." ok />
          ) : (
            <ul className="divide-y divide-ligne">
              {anomalies.slice(0, 6).map((c) => (
                <li key={c.code} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                  <AlertTriangle className={cn('size-3.5 shrink-0', c.criticite === 'BLOQUANT' || c.criticite === 'CRITIQUE' ? 'text-danger' : 'text-alerte')} />
                  <span className="min-w-0 flex-1 truncate text-texte" title={c.controle}>
                    {c.controle}
                  </span>
                  <Badge ton={c.criticite === 'BLOQUANT' || c.criticite === 'CRITIQUE' ? 'danger' : 'alerte'}>{c.anomalies}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>

      <p className="flex items-center gap-1.5 pb-2 text-[11px] text-attenue-texte">
        <Coins className="size-3" /> Montants en MAD, valorisés au CMUP. Le stock est lu en direct ; les besoins datent du dernier calcul MRP.
      </p>
    </div>
  )
}

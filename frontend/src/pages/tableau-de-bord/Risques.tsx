/**
 * Tableau de bord — Risques et files (06/10/2026).
 *
 * Ce qui attend une décision, rangé par domaine, et ce qui menace le plan de
 * production : le mur de risques mois par mois, puis les références en alerte
 * les plus urgentes. Mêmes données et mêmes droits que l'ancien poste de
 * travail ; seule la présentation change.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDollarSign, Flame, PackageX, ShoppingCart, Timer, TriangleAlert } from 'lucide-react'
import { api } from '../../api/client'
import { EnTetePage } from '../../composants/Coquille'
import { CarteStat } from '../../composants/CarteStat'
import { Alerte, Badge, Squelette } from '../../composants/ui/base'
import { Infobulle } from '../../composants/ui/surcouches'
import { Colonnes, TON, compact } from '../../composants/graphiques/Visuels'
import { cn, fmt } from '../../lib/utils'
import { OngletsTableauDeBord } from './Onglets'
import { Bloc, EnPanne, Marge, Vide, libelleMois, useFiles, type Domaine } from './commun'
import { StatutBadge } from '../../composants/StatutBadge'
import { tonStatut } from '../../lib/statuts'

interface MoisRisque {
  annee_mois: string
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
  premier_mois_risque: string | null
  marge_decision_jours: number | null
  equivalent_dispo_kg: number | null
  equivalent_reference: string | null
  mois: MoisRisque[]
}
interface AlerteRef {
  code_reference: string
  categorie_libelle: string | null
  couleur: string | null
  fournisseur_nom: string | null
  stock_physique_net_kg: number | null
  /** Le plan ramené à un mois de 30 jours, tel que le moteur le consomme (27/10/2026). */
  plan_mois_kg: number | null
  jours_couverture: number | null
  delai_livraison_jours: number | null
  qte_a_commander_kg: number | null
  statut: string
}
interface Controle {
  code: string
  controle: string
  criticite: string
  anomalies: number
}

const DOMAINES: { cle: Domaine; libelle: string }[] = [
  { cle: 'ACHATS', libelle: 'Achats' },
  { cle: 'STOCK', libelle: 'Stock' },
  { cle: 'QUALITE', libelle: 'Qualité' },
]

export function Risques() {
  const qKpi = useQuery({ queryKey: ['cockpit'], queryFn: ({ signal }) => api.get<Record<string, unknown>>('/api/cockpit', { signal }) })
  const qRisques = useQuery({ queryKey: ['cockpit-risques'], queryFn: ({ signal }) => api.get<Risque[]>('/api/cockpit/risques', { signal }) })
  const qAna = useQuery({ queryKey: ['cockpit-analyse'], queryFn: ({ signal }) => api.get<{ alertes?: AlerteRef[] }>('/api/cockpit/analyse', { signal }) })
  const qCtl = useQuery({ queryKey: ['controles'], queryFn: ({ signal }) => api.get<Controle[]>('/api/controles', { signal }) })
  const { files, chargement, erreur } = useFiles()

  const k = qKpi.data ?? {}
  const n = (c: string) => (typeof k[c] === 'number' ? (k[c] as number) : null)
  const nn = (c: string) => n(c) ?? 0

  const risques = useMemo(() => qRisques.data ?? [], [qRisques.data])
  const colonnes = useMemo(() => risques[0]?.mois?.map((m) => m.annee_mois) ?? [], [risques])
  const tropTard = risques.filter((r) => (r.marge_decision_jours ?? 0) < 0).length
  const monoSource = risques.filter((r) => r.risque_sourcing === 'MONO-SOURCE').length
  const parMois = useMemo(
    () => ({
      rupture: colonnes.map((_, i) => risques.filter((r) => r.mois[i]?.statut === 'PLAN_NON_COUVERT').length),
      tendu: colonnes.map((_, i) => risques.filter((r) => r.mois[i]?.statut === 'SOUS_SECURITE').length),
    }),
    [colonnes, risques],
  )
  const alertes = qAna.data?.alertes ?? []
  const bloquants = (qCtl.data ?? []).filter((c) => c.criticite === 'BLOQUANT' && c.anomalies > 0)

  return (
    <div className="space-y-4">
      <EnTetePage titre="Tableau de bord" description="Risques et files — ce qui attend une décision, et ce qui menace le plan de production." />
      <OngletsTableauDeBord />

      {nn('besoins_perimes') > 0 && (
        <Alerte ton="danger" titre="Les alertes reposent sur des besoins périmés">
          Le plan, une recette ou une densité a changé depuis le dernier calcul MRP. Relancez le calcul avant de décider.
        </Alerte>
      )}
      {bloquants.length > 0 && (
        <Alerte ton="danger" titre="Anomalies bloquantes">
          {bloquants.map((c) => `${c.code} — ${c.controle} : ${c.anomalies}`).join(' · ')}
        </Alerte>
      )}

      {qCtl.isError && <EnPanne quoi="Contrôles" />}
      {(qKpi.isError || qRisques.isError) && (
        <Alerte ton="danger" titre="Données indisponibles">
          Le serveur n'a pas répondu : les compteurs ci-dessous ne peuvent pas être affirmés. Réessayez dans un instant.
        </Alerte>
      )}

      {/* ---- Chiffres clés ---------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <CarteStat Icone={PackageX} libelle="Plan non couvert" valeur={n('nb_plan_non_couvert') == null ? '—' : String(nn('nb_plan_non_couvert'))} unite={`/ ${nn('nb_references')}`} precision="une rupture prévue sur l’horizon du plan" ton="danger" barres={parMois.rupture.length >= 3 ? parMois.rupture : undefined} aide="Moteur de couverture. Les barres : les références au plan non couvert, mois par mois, sur l'horizon du plan." />
        <CarteStat Icone={Flame} libelle="À commander aujourd’hui" valeur={String(nn('nb_a_commander_aujourdhui'))} precision={`${nn('nb_sous_securite')} sous la sécurité, sans rupture`} ton="grave" />
        <CarteStat Icone={ShoppingCart} libelle="À commander" valeur={String(nn('nb_refs_a_commander'))} unite="réf." precision={`${nn('nb_propositions_a_traiter')} propositions à arbitrer`} ton="alerte" />
        <CarteStat Icone={CircleDollarSign} libelle="Budget à engager" valeur={n('budget_a_engager_mad') == null ? '—' : compact(nn('budget_a_engager_mad'))} unite="MAD" precision="pour couvrir le plan" ton="primaire" />
        <CarteStat Icone={Timer} libelle="Trop tard pour commander" valeur={String(tropTard)} unite="réf." precision="marge de décision déjà négative" ton={tropTard > 0 ? 'danger' : 'succes'} />
        <CarteStat Icone={TriangleAlert} libelle="Mono-source à risque" valeur={String(monoSource)} unite="réf." precision={`sur ${risques.length} références en risque`} ton={monoSource > 0 ? 'alerte' : 'succes'} jauge={risques.length ? (monoSource / risques.length) * 100 : undefined} />
      </div>

      {/* ---- À traiter, par domaine -------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        {DOMAINES.map((d) => {
          const fs = files.filter((f) => f.domaine === d.cle)
          return (
            <Bloc key={d.cle} titre={`À traiter — ${d.libelle}`} sousTitre={fs.length ? `${fs.length} file(s)` : undefined} corpsSansMarge>
              {erreur ? (
                <EnPanne />
              ) : chargement ? (
                <div className="p-4">
                  <Squelette className="h-16" />
                </div>
              ) : fs.length === 0 ? (
                <Vide texte="Rien n'attend dans ce domaine." ok />
              ) : (
                <ul className="divide-y divide-ligne">
                  {fs.map((f) => (
                    <li key={`${f.champ}:${f.vers}`}>
                      <Link to={f.vers ?? '#'} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-attenue">
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
                        <span className={cn('text-[16px] font-semibold tabular-nums', f.ton === 'danger' ? 'text-danger' : f.ton === 'alerte' ? 'text-alerte' : 'text-texte')}>{f.valeur}</span>
                        <ChevronRight className="size-4 shrink-0 text-attenue-texte" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Bloc>
          )
        })}
      </div>

      {/* ---- Le risque dans le temps ----------------------------------------- */}
      <Bloc titre="Références en risque, mois par mois" sousTitre="Moteur de couverture : combien passent sous la sécurité ou ont un plan non couvert, mois par mois, arrivages comptés à leur date" lien={{ vers: '/plan-achat', libelle: "Plan d'achat" }}>
        {qRisques.isError ? (
          <EnPanne />
        ) : qRisques.isLoading ? (
          <Squelette className="h-56" />
        ) : colonnes.length === 0 ? (
          <Vide texte="Aucune référence ne descend sous son stock de sécurité sur l'horizon du plan." ok />
        ) : (
          <Colonnes
            empilees
            libelles={colonnes.map(libelleMois)}
            unite="références"
            series={[
              { cle: 'r', libelle: 'Plan non couvert', valeurs: parMois.rupture, couleur: TON.danger },
              { cle: 't', libelle: 'Sous la sécurité', valeurs: parMois.tendu, couleur: TON.alerte },
            ]}
          />
        )}
      </Bloc>

      {/* ---- Le mur de risques -------------------------------------------------- */}
      <Bloc
        titre={`Mur de risques${colonnes.length ? ` — ${colonnes.length} mois` : ''}`}
        sousTitre="Chaque case est un mois : survolez-la pour le besoin, les entrées et le stock de fin de mois"
        corpsSansMarge
      >
        {qRisques.isError ? (
          <EnPanne />
        ) : qRisques.isLoading ? (
          <div className="p-4">
            <Squelette className="h-40" />
          </div>
        ) : risques.length === 0 ? (
          <Vide texte="Aucune référence en risque." ok />
        ) : (
          <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
            <table className="grille w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-attenue-texte">
                  <th className="px-4 py-2 font-medium">Référence</th>
                  <th className="px-2 py-2 font-medium">Sourcing</th>
                  <th className="px-2 py-2 text-right font-medium">Délai</th>
                  {colonnes.map((m) => (
                    <th key={m} className="w-10 px-0.5 py-2 text-center font-medium">
                      {libelleMois(m).split(' ')[0]}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-medium">Équivalent</th>
                  <th className="px-4 py-2 text-right font-medium">Marge</th>
                </tr>
              </thead>
              <tbody>
                {risques.map((r) => (
                  <tr key={r.code_reference} className="border-t border-ligne">
                    <td className="max-w-60 px-4 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-texte">{r.code_reference}</span>
                        {r.classe_abc && <Badge ton={tonStatut('classe_abc', r.classe_abc)}>{r.classe_abc}</Badge>}
                      </div>
                      <div className="truncate text-[11px] text-attenue-texte">{r.fournisseur_nom ?? 'sans fournisseur'}</div>
                    </td>
                    <td className="px-2 py-1.5">{r.risque_sourcing === 'MONO-SOURCE' ? <Badge ton="danger">mono</Badge> : <span className="text-[11px] text-attenue-texte">multi</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-attenue-texte">{r.delai_livraison_jours == null ? '—' : `${r.delai_livraison_jours} j`}</td>
                    {r.mois.map((m) => (
                      <td key={m.annee_mois} className="px-0.5 py-1.5">
                        <Infobulle
                          contenu={`${libelleMois(m.annee_mois)} · plan ${fmt.nombre(m.besoin_kg, 0)} kg · arrivages ${fmt.nombre(m.entrees_kg, 0)} kg · fin de mois ${fmt.nombre(m.stock_fin_kg, 0)} kg (sécurité ${fmt.nombre(m.stock_min_kg, 0)})`}
                        >
                          <div
                            className="mx-auto h-6 w-full rounded-[4px]"
                            style={{
                              background:
                                m.statut === 'PLAN_NON_COUVERT'
                                  ? 'linear-gradient(180deg, hsl(var(--danger)), hsl(var(--danger) / 0.55))'
                                  : m.statut === 'SOUS_SECURITE'
                                    ? 'linear-gradient(180deg, hsl(var(--alerte)), hsl(var(--alerte) / 0.55))'
                                    : 'hsl(var(--succes) / 0.18)',
                            }}
                          />
                        </Infobulle>
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      {(r.equivalent_dispo_kg ?? 0) > 0 ? (
                        <span className="text-[12px] text-info" title={r.equivalent_reference ?? ''}>
                          {compact(r.equivalent_dispo_kg ?? 0)} kg
                        </span>
                      ) : (
                        <span className="text-[11px] text-attenue-texte">aucun</span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <Marge jours={r.marge_decision_jours} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-ligne px-4 py-2 text-[11px] text-attenue-texte">
              La marge est le nombre de jours restants avant le premier mois tendu, <strong>délai fournisseur déduit</strong>. Négative, il est
              déjà trop tard pour commander à temps : il reste à arbitrer, substituer ou décaler la production.
            </p>
          </div>
        )}
      </Bloc>

      {/* ---- Les références en alerte ----------------------------------------- */}
      <Bloc titre="Références en alerte, les plus urgentes d'abord" sousTitre="Triées par couverture croissante — la liste complète est au plan d'achat" lien={{ vers: '/stock', libelle: 'Stock projeté' }} corpsSansMarge>
        {qAna.isError ? (
          <EnPanne />
        ) : qAna.isLoading ? (
          <div className="p-4">
            <Squelette className="h-40" />
          </div>
        ) : alertes.length === 0 ? (
          <Vide texte="Aucune référence en alerte." ok />
        ) : (
          <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
            <table className="grille w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-attenue-texte">
                  <th className="px-4 py-2 font-medium">Référence</th>
                  <th className="px-3 py-2 font-medium">Catégorie</th>
                  <th className="px-3 py-2 font-medium">Couleur</th>
                  <th className="px-3 py-2 font-medium">Fournisseur</th>
                  <th className="px-3 py-2 text-right font-medium">Stock (kg)</th>
                  <th className="px-3 py-2 text-right font-medium" title="Le plan de l’horizon ramené à un mois de 30 jours (moteur de couverture)">Plan / mois</th>
                  <th className="px-3 py-2 text-right font-medium">Couv. (j)</th>
                  <th className="px-3 py-2 text-right font-medium">Délai (j)</th>
                  <th className="px-3 py-2 text-right font-medium">À commander (kg)</th>
                  <th className="px-4 py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {alertes.map((a) => (
                  <tr key={a.code_reference} className="border-t border-ligne">
                    <td className="max-w-60 truncate px-4 py-1.5 font-medium text-texte">{a.code_reference}</td>
                    <td className="px-3 py-1.5">{a.categorie_libelle ?? '—'}</td>
                    <td className="px-3 py-1.5">{a.couleur ?? '—'}</td>
                    <td className="px-3 py-1.5">{a.fournisseur_nom ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt.nombre(a.stock_physique_net_kg ?? 0, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{a.plan_mois_kg == null ? '—' : fmt.nombre(a.plan_mois_kg, 0)}</td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', a.jours_couverture === 0 && 'text-danger')}>{a.jours_couverture == null ? 'horizon' : fmt.nombre(a.jours_couverture, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{a.delai_livraison_jours ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{a.qte_a_commander_kg == null ? '—' : fmt.nombre(a.qte_a_commander_kg, 0)}</td>
                    <td className="px-4 py-1.5">
                      <StatutBadge entite="statut_stock" code={a.statut} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloc>

      {(qCtl.data ?? []).filter((c) => c.criticite !== 'BLOQUANT' && c.anomalies > 0).length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
          <AlertTriangle className="size-3" /> Des contrôles de cohérence sont en anomalie : voir{' '}
          <Link to="/controles" className="text-primaire hover:underline">
            Contrôles
          </Link>
          .
        </p>
      )}
      {!chargement && !erreur && files.length === 0 && (
        <p className="flex items-center gap-1.5 text-[12px] text-succes">
          <CheckCircle2 className="size-4" /> Aucune file en cours pour votre rôle.
        </p>
      )}
    </div>
  )
}

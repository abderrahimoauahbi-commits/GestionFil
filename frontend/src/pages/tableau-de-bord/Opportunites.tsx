/**
 * Tableau de bord — Opportunités (06/10/2026).
 *
 * Ce qu'on pourrait gagner : les économies à qualité égale (même groupe
 * d'équivalence, fournisseur moins cher), les dépendances à un seul
 * fournisseur, l'exposition aux devises. Mêmes données que l'ancienne vue.
 */
import { useQuery } from '@tanstack/react-query'
import { Coins, Globe2, Link2, PiggyBank, Sparkles, TrendingDown } from 'lucide-react'
import { api } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { CarteStat } from '../../composants/CarteStat'
import { Squelette } from '../../composants/ui/base'
import { Anneau, BarresClassees, TON, compact } from '../../composants/graphiques/Visuels'
import { cn, fmt } from '../../lib/utils'
import { OngletsTableauDeBord } from './Onglets'
import { Bloc, EnPanne, Vide } from './commun'
import { StatutBadge } from '../../composants/StatutBadge'

interface Analyse {
  economies: {
    code_reference: string
    designation: string | null
    fournisseur_actuel: string | null
    prix_actuel_mad: number
    prix_min_mad: number
    fournisseur_alternatif: string | null
    economie_annuelle_mad: number
    conso_annuelle_kg?: number
  }[]
  devises: { code_devise?: string; nb_references: number; montant_mad?: number; part_pct?: number }[]
  mono_source: {
    code_reference: string
    designation?: string | null
    fournisseur_nom: string | null
    delai_livraison_jours: number | null
    statut: string
    jours_couverture: number | null
    budget_annuel_mad: number
  }[]
  indicateurs?: { economies_total_mad?: number; nb_opportunites: number }
}

export function Opportunites() {
  const q = useQuery({ queryKey: ['cockpit-analyse'], queryFn: ({ signal }) => api.get<Analyse>('/api/cockpit/analyse', { signal }) })
  // LES MONTANTS SUIVENT LA GRILLE (08/10/2026). La page les affichait a tous,
  // et recalculait meme un total dans le navigateur. Le serveur les retire
  // desormais a qui ne voit pas la valeur du stock ; la page ne les montre ni
  // ne les recompose.
  const voit = useDroits('COCKPIT').visible('economies_total_mad')
  const d = q.data
  const total = d?.indicateurs?.economies_total_mad ?? (d?.economies ?? []).reduce((s, e) => s + (e.economie_annuelle_mad ?? 0), 0)
  const meilleure = Math.max(0, ...(d?.economies ?? []).map((e) => e.economie_annuelle_mad ?? 0))
  const budgetMono = (d?.mono_source ?? []).reduce((s, m) => s + (m.budget_annuel_mad ?? 0), 0)
  const partEtrangere = (d?.devises ?? []).filter((x) => x.code_devise !== 'MAD').reduce((s, x) => s + (x.part_pct ?? 0), 0)
  const voitParts = (d?.devises ?? []).some((x) => x.part_pct != null)

  return (
    <div className="space-y-4">
      <EnTetePage titre="Tableau de bord" description="Opportunités — ce qu'on pourrait gagner, et les dépendances qui exposent l'atelier." />
      <OngletsTableauDeBord />

      {q.isError ? (
        <EnPanne quoi="Opportunités" />
      ) : q.isLoading || !d ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Squelette key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <CarteStat Icone={PiggyBank} libelle="Économies identifiées" valeur={voit ? compact(total) : '—'} unite="MAD/an" precision="au plan : écart de prix × plan / mois du moteur × 12" ton="succes" aide="À qualité égale, en changeant de fournisseur. Une projection : l’écart de prix appliqué au plan des 12 prochains mois (plan / mois du moteur de couverture × 12)." />
            <CarteStat Icone={Sparkles} libelle="Opportunités" valeur={String(d.indicateurs?.nb_opportunites ?? d.economies.length)} unite="réf." precision="dans un groupe d'équivalence" ton="primaire" />
            <CarteStat Icone={TrendingDown} libelle="La plus forte" valeur={voit ? compact(meilleure) : '—'} unite="MAD/an" precision={d.economies[0]?.code_reference ?? '—'} ton="succes" />
            <CarteStat Icone={Link2} libelle="Mono-source" valeur={String(d.mono_source.length)} unite="réf." precision="un seul fournisseur possible" ton={d.mono_source.length ? 'alerte' : 'succes'} />
            <CarteStat Icone={Coins} libelle="Budget mono-source" valeur={voit ? compact(budgetMono) : '—'} unite="MAD/an" precision="réel 12 mois, exposé à une seule source" ton="alerte" />
            <CarteStat Icone={Globe2} libelle="Achats en devises" valeur={voitParts ? fmt.nombre(partEtrangere, 0) : '—'} unite="%" precision="réel 12 mois, exposé au cours de change" ton={partEtrangere > 50 ? 'alerte' : 'neutre'} jauge={voitParts ? partEtrangere : undefined} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Bloc className="xl:col-span-2" titre="Les plus fortes économies" sousTitre="Au plan : économie sur les 12 prochains mois en passant au fournisseur le moins cher du groupe" lien={{ vers: '/equivalences', libelle: 'Équivalences' }}>
              {d.economies.length === 0 ? (
                <Vide texte="Aucune économie identifiée : chaque référence est déjà au meilleur prix de son groupe." ok />
              ) : !voit ? (
                <Vide texte={`${d.indicateurs?.nb_opportunites ?? d.economies.length} référence(s) peuvent passer à un fournisseur moins cher du même groupe. Les montants sont réservés aux rôles qui voient la valeur du stock.`} />
              ) : (
                <BarresClassees
                  donnees={d.economies.slice(0, 10).map((e, i) => ({
                    cle: e.code_reference + i,
                    libelle: e.code_reference,
                    detail: `${e.fournisseur_actuel ?? '—'} → ${e.fournisseur_alternatif ?? '—'}`,
                    valeur: e.economie_annuelle_mad,
                    couleur: `linear-gradient(90deg, ${TON.succes}, color-mix(in srgb, ${TON.succes} 45%, transparent))`,
                  }))}
                  format={(v) => `${compact(v)} MAD`}
                />
              )}
            </Bloc>
            <Bloc titre="Exposition aux devises" sousTitre={voit ? 'Part de la consommation réelle des 12 mois pleins, par devise de facturation' : 'Références par devise de facturation'}>
              {/* La devise elle-meme est masquee a qui ne voit pas les prix. */}
              {d.devises.some((x) => x.code_devise) ? (
                <Anneau
                  centre={`${d.devises.length}`}
                  sousCentre="devises"
                  format={(v) => (voit ? `${compact(v)} MAD` : `${v} réf.`)}
                  parts={d.devises.map((x) => ({ libelle: `${x.code_devise} · ${x.nb_references} réf.`, valeur: voit ? (x.montant_mad ?? 0) : x.nb_references }))}
                />
              ) : (
                <Vide texte="Réservé aux rôles qui voient les prix et leurs devises." />
              )}
            </Bloc>
          </div>

          {voit && (
          <Bloc titre="Le détail des économies" sousTitre="Prix au kg, valorisés en MAD" corpsSansMarge>
            {d.economies.length === 0 ? (
              <Vide texte="Rien à afficher." />
            ) : (
              <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
                <table className="grille w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] text-attenue-texte">
                      <th className="px-4 py-2 font-medium">Référence</th>
                      <th className="px-3 py-2 font-medium">Fournisseur actuel</th>
                      <th className="px-3 py-2 text-right font-medium">Prix actuel</th>
                      <th className="px-3 py-2 font-medium">Alternative</th>
                      <th className="px-3 py-2 text-right font-medium">Meilleur prix</th>
                      <th className="px-3 py-2 text-right font-medium">Écart</th>
                      <th className="px-4 py-2 text-right font-medium">Économie / an</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.economies.map((e) => (
                      <tr key={e.code_reference} className="border-t border-ligne">
                        <td className="max-w-64 px-4 py-1.5">
                          <div className="truncate font-medium text-texte">{e.code_reference}</div>
                          {e.designation && <div className="truncate text-[11px] text-attenue-texte">{e.designation}</div>}
                        </td>
                        <td className="px-3 py-1.5">{e.fournisseur_actuel ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt.nombre(e.prix_actuel_mad, 2)}</td>
                        <td className="px-3 py-1.5">{e.fournisseur_alternatif ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-succes">{fmt.nombre(e.prix_min_mad, 2)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-attenue-texte">
                          {e.prix_actuel_mad > 0 ? `−${fmt.nombre(((e.prix_actuel_mad - e.prix_min_mad) / e.prix_actuel_mad) * 100, 1)} %` : '—'}
                        </td>
                        <td className="px-4 py-1.5 text-right font-semibold tabular-nums text-succes">{fmt.nombre(e.economie_annuelle_mad, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Bloc>
          )}

          <Bloc titre="Dépendances à un seul fournisseur" sousTitre="Références sans équivalent chez un autre fournisseur, par dépense réelle des 12 mois pleins" lien={{ vers: '/fournisseurs', libelle: 'Fournisseurs' }} corpsSansMarge>
            {d.mono_source.length === 0 ? (
              <Vide texte="Aucune dépendance à une seule source." ok />
            ) : (
              <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
                <table className="grille w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] text-attenue-texte">
                      <th className="px-4 py-2 font-medium">Référence</th>
                      <th className="px-3 py-2 font-medium">Fournisseur</th>
                      <th className="px-3 py-2 text-right font-medium">Délai</th>
                      <th className="px-3 py-2 text-right font-medium">Couverture</th>
                      <th className="px-3 py-2 font-medium">Statut</th>
                      {voit && <th className="px-4 py-2 text-right font-medium">Réel 12 mois</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.mono_source.map((m) => (
                      <tr key={m.code_reference} className="border-t border-ligne">
                        <td className="max-w-64 truncate px-4 py-1.5 font-medium text-texte">{m.code_reference}</td>
                        <td className="px-3 py-1.5">{m.fournisseur_nom ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{m.delai_livraison_jours == null ? '—' : `${m.delai_livraison_jours} j`}</td>
                        <td className={cn('px-3 py-1.5 text-right tabular-nums', m.jours_couverture != null && m.jours_couverture < 30 && 'text-danger')}>
                          {m.jours_couverture == null ? 'horizon' : `${fmt.nombre(m.jours_couverture, 0)} j`}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatutBadge entite="statut_stock" code={m.statut} />
                        </td>
                        {voit && <td className="px-4 py-1.5 text-right tabular-nums">{fmt.nombre(m.budget_annuel_mad, 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Bloc>
        </>
      )}
    </div>
  )
}

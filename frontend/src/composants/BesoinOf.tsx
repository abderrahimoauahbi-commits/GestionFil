/**
 * LE BESOIN D'UNE REFERENCE : LE PLAN SEUL, LU PAR LE MOTEUR DE COUVERTURE
 * (decision du 26/10/2026 ; une seule source de verite depuis le 27/10/2026).
 *
 * Le besoin d'achat est celui du plan de production en service, mois par mois,
 * sur l'horizon du plan (le mois en cours depuis aujourd'hui seulement : le plan
 * des jours passes est perdu, jamais reporte). Les OF n'y entrent pas : ils sont
 * du court terme et servent la production et les statistiques (ecran des OF,
 * C64).
 *
 * Le calcul est celui du serveur (`/api/stock/besoin`), le meme moteur que
 * l'onglet « A commander » du plan d'achat et le stock projete : plan sur
 * l'horizon, ce qui n'en est pas couvert, la premiere rupture. L'ancienne
 * « demande pendant le delai » (v_besoin_horizon) est retiree avec l'ancien
 * calcul. Lu depuis le stock projete (clic sur une ligne).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Chargement } from './ui/base'
import { fmt } from '../lib/utils'
import { StatutBadge } from './StatutBadge'

interface Synthese {
  statut: string | null
  plan_horizon_kg: number
  plan_non_couvert_kg: number
  premiere_rupture: string | null
  couvert_jusqu_au: string | null
  disponible_kg: number
  arrivages_comptes_kg: number
  delai_j: number
  couverture_commande_j: number
  fin_horizon: string | null
}

interface Mois {
  annee_mois: string
  besoin_plan_kg: number
  kg_dans_horizon: number
}

interface Reponse {
  synthese: Synthese | null
  mois: Mois[]
}

const kg = (v: number | null | undefined) => fmt.nombre(v ?? 0, 0)

/** « 2026-11 » → « nov. 2026 ». */
function libelleMois(am: string) {
  const [a, m] = am.split('-').map(Number)
  if (!a || !m) return am
  return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

function Ligne({ libelle, valeur, fort }: { libelle: string; valeur: string; fort?: boolean }) {
  return (
    <tr className={fort ? 'font-semibold' : undefined}>
      <td className="py-0.5 pr-3">{libelle}</td>
      <td className="py-0.5 pr-3 text-right tabular-nums">{valeur}</td>
    </tr>
  )
}

export function BesoinReference({ reference, compact = false }: { reference: string; compact?: boolean }) {
  const q = useQuery({
    queryKey: ['besoin-reference', reference],
    queryFn: ({ signal }) =>
      api.get<Reponse>(`/api/stock/besoin?reference=${encodeURIComponent(reference)}`, { signal }),
    staleTime: 60_000,
  })
  if (q.isLoading) return <Chargement />
  if (q.error || !q.data?.synthese)
    return <p className="text-[12.5px] text-attenue-texte">Le besoin de cette référence n’a pas pu être lu.</p>

  const s = q.data.synthese
  const mois = q.data.mois.filter((m) => m.kg_dans_horizon > 0.05)

  return (
    <div className="min-w-0 space-y-3 text-[12.5px]">
      <div>
        <p className="mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
          Besoin du plan de production
          {s.statut && <StatutBadge entite="statut_stock" code={s.statut} />}
        </p>
        <table>
          <tbody>
            <Ligne
              libelle={`Plan sur l’horizon${s.fin_horizon ? ` (jusqu’au ${fmt.date(s.fin_horizon)})` : ''}`}
              valeur={`${kg(s.plan_horizon_kg)} kg`}
              fort
            />
            <Ligne libelle="Disponible aujourd’hui (compté)" valeur={`${kg(s.disponible_kg)} kg`} />
            <Ligne libelle="Arrivages comptés à leur date" valeur={`${kg(s.arrivages_comptes_kg)} kg`} />
            <Ligne
              libelle="Plan non couvert"
              valeur={s.plan_non_couvert_kg > 0.05 ? `${kg(s.plan_non_couvert_kg)} kg` : '—'}
            />
            <Ligne
              libelle="Couvert jusqu’au"
              valeur={s.premiere_rupture ? (s.couvert_jusqu_au ? fmt.date(s.couvert_jusqu_au) : 'rupture aujourd’hui') : 'tout l’horizon'}
            />
          </tbody>
        </table>
        <p className="mt-1 text-[11.5px] text-attenue-texte">
          Le plan seul, calculé par le moteur de couverture (délai {s.delai_j} j, couverture d’une commande{' '}
          {s.couverture_commande_j} j) : les ordres de fabrication n’entrent pas dans le besoin d’achat.
        </p>
      </div>

      {!compact && mois.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Mois par mois</p>
          <table className="w-full max-w-xs">
            <thead>
              <tr className="text-[11px] text-attenue-texte">
                <th className="py-0.5 pr-3 text-left font-normal">Mois</th>
                <th className="py-0.5 pr-3 text-right font-normal">Plan (kg)</th>
                <th className="py-0.5 text-right font-normal">Dans l’horizon</th>
              </tr>
            </thead>
            <tbody>
              {mois.map((m) => (
                <tr key={m.annee_mois}>
                  <td className="py-0.5 pr-3">{libelleMois(m.annee_mois)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{kg(m.besoin_plan_kg)}</td>
                  <td className="py-0.5 text-right tabular-nums">{kg(m.kg_dans_horizon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

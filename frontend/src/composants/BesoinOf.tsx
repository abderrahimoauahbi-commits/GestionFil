/**
 * LE BESOIN D'UNE REFERENCE : LE PLAN SEUL (decision du 26/10/2026, migration
 * 2026-10-27b).
 *
 * Le besoin d'achat est celui du plan de production en service, mois par mois.
 * Les OF n'y entrent plus : ils sont du court terme (au plus une semaine) et
 * servent la production et les statistiques — leur consommation se lit sur
 * l'ecran des OF, et C64 signale encore un OF au-dela du plan. Du 22/10 au
 * 27/10, ce composant montrait la part « au-dela du plan » des OF : retiree.
 *
 * Le calcul est celui du serveur (`/api/stock/besoin`), celui que lisent le
 * stock projete et le plan d'achat. Lu depuis le stock projete (clic sur une
 * ligne) et depuis le detail d'une proposition du plan d'achat.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Chargement } from './ui/base'
import { fmt } from '../lib/utils'

interface Synthese {
  besoin_12m_kg: number
  demande_delai_kg: number
  sorties_prevues_kg: number
}

interface Mois {
  annee_mois: string
  besoin_plan_kg: number
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
  const mois = q.data.mois.filter((m) => m.besoin_plan_kg > 0.05)

  return (
    <div className="min-w-0 space-y-3 text-[12.5px]">
      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
          Besoin du plan de production
        </p>
        <table>
          <tbody>
            <tr className="font-semibold">
              <td className="py-0.5 pr-3">Sur l’horizon du plan</td>
              <td className="py-0.5 pr-3 text-right tabular-nums">{kg(s.besoin_12m_kg)}</td>
              <td className="py-0.5 text-[11.5px] font-normal text-attenue-texte">kg</td>
            </tr>
            <tr>
              <td className="py-0.5 pr-3">Pendant le délai fournisseur</td>
              <td className="py-0.5 pr-3 text-right tabular-nums">{kg(s.demande_delai_kg)}</td>
              <td className="py-0.5 text-[11.5px] text-attenue-texte">kg</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11.5px] text-attenue-texte">
          Le plan seul : les ordres de fabrication n’entrent pas dans le besoin d’achat.
        </p>
      </div>

      {!compact && mois.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Mois par mois</p>
          <table className="w-full max-w-xs">
            <thead>
              <tr className="text-[11px] text-attenue-texte">
                <th className="py-0.5 pr-3 text-left font-normal">Mois</th>
                <th className="py-0.5 text-right font-normal">Plan (kg)</th>
              </tr>
            </thead>
            <tbody>
              {mois.map((m) => (
                <tr key={m.annee_mois}>
                  <td className="py-0.5 pr-3">{libelleMois(m.annee_mois)}</td>
                  <td className="py-0.5 text-right tabular-nums">{kg(m.besoin_plan_kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

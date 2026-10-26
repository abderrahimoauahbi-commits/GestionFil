/**
 * LE BESOIN D'UNE REFERENCE, DECOMPOSE (lot B des OF, 22/10/2026).
 *
 * Les OF consomment le plan : par qualite et par mois, le besoin retient les
 * OF (leur reste a produire) plus le plan qu'ils ne couvrent pas. Un OF n'est
 * jamais compte deux fois avec le plan ; ce qui le depasse est le besoin
 * AU-DELA DU PLAN. L'ecran montre les deux parts, mois par mois, et les OF qui
 * pesent sur la reference — le calcul est celui du serveur (`/api/stock/besoin`),
 * celui que lisent le stock projete et le plan d'achat.
 *
 * Lu depuis le stock projete (clic sur une ligne) et depuis le detail d'une
 * proposition du plan d'achat.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Chargement } from './ui/base'
import { cn, fmt } from '../lib/utils'
import { libelleStatut } from '../lib/statuts'

interface Synthese {
  besoin_12m_kg: number
  besoin_plan_12m_kg: number
  besoin_au_dela_12m_kg: number
  demande_delai_kg: number
  demande_delai_au_dela_kg: number
}

interface Mois {
  annee_mois: string
  besoin_plan_kg: number
  dont_of_kg: number
  besoin_au_dela_kg: number
}

interface OfPesant {
  id_of: string
  numero: string
  code_qualite: string
  statut: string
  date_of: string | null
  date_fin_prevue: string | null
  metrage_m2: number
  kg_prevu: number
  kg_consomme: number
  kg_reste: number
  kg_reste_au_dela: number
}

interface Reponse {
  synthese: Synthese | null
  mois: Mois[]
  of: OfPesant[]
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
  const mois = q.data.mois.filter((m) => m.besoin_plan_kg > 0.05 || m.besoin_au_dela_kg > 0.05)
  const ofs = q.data.of

  return (
    <div className="min-w-0 space-y-3 text-[12.5px]">
      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
          Besoin de l’horizon
        </p>
        <table>
          <tbody>
            <tr>
              <td className="py-0.5 pr-3">Lié au plan de production</td>
              <td className="py-0.5 pr-3 text-right tabular-nums">{kg(s.besoin_plan_12m_kg)}</td>
              <td className="py-0.5 text-[11.5px] text-attenue-texte">kg</td>
            </tr>
            <tr>
              <td className="py-0.5 pr-3">Au-delà du plan (OF)</td>
              <td className={cn('py-0.5 pr-3 text-right tabular-nums', s.besoin_au_dela_12m_kg > 0.5 && 'font-medium text-alerte')}>
                {kg(s.besoin_au_dela_12m_kg)}
              </td>
              <td className="py-0.5 text-[11.5px] text-attenue-texte">kg</td>
            </tr>
            <tr className="border-t border-bordure font-semibold">
              <td className="py-0.5 pr-3">Besoin retenu</td>
              <td className="py-0.5 pr-3 text-right tabular-nums">{kg(s.besoin_12m_kg)}</td>
              <td className="py-0.5 text-[11.5px] font-normal text-attenue-texte">
                {s.demande_delai_au_dela_kg > 0.5
                  ? `dont ${kg(s.demande_delai_au_dela_kg)} kg au-delà du plan pendant le délai`
                  : 'kg'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {!compact && mois.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Mois par mois</p>
          <table className="w-full max-w-md">
            <thead>
              <tr className="text-[11px] text-attenue-texte">
                <th className="py-0.5 pr-3 text-left font-normal">Mois</th>
                <th className="py-0.5 pr-3 text-right font-normal">Plan</th>
                <th className="py-0.5 pr-3 text-right font-normal">dont OF</th>
                <th className="py-0.5 text-right font-normal">Au-delà</th>
              </tr>
            </thead>
            <tbody>
              {mois.map((m) => (
                <tr key={m.annee_mois}>
                  <td className="py-0.5 pr-3">{libelleMois(m.annee_mois)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{kg(m.besoin_plan_kg)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums text-attenue-texte">
                    {m.dont_of_kg > 0.05 ? kg(m.dont_of_kg) : '—'}
                  </td>
                  <td className={cn('py-0.5 text-right tabular-nums', m.besoin_au_dela_kg > 0.05 && 'text-alerte')}>
                    {m.besoin_au_dela_kg > 0.05 ? kg(m.besoin_au_dela_kg) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
          OF qui pèsent sur la référence
        </p>
        {ofs.length === 0 ? (
          <p className="text-attenue-texte">Aucun OF prévu ou lancé : le besoin est celui du plan.</p>
        ) : (
          <ul className="space-y-1">
            {ofs.map((o) => (
              <li key={o.id_of} className="flex flex-wrap items-baseline gap-x-3">
                <Link to={`/ordres-fabrication/${encodeURIComponent(o.id_of)}`} className="font-medium text-primaire hover:underline">
                  {o.numero}
                </Link>
                <span className="text-attenue-texte">
                  {o.code_qualite} · {libelleStatut('ordre_fabrication', o.statut).toLowerCase()} · {fmt.nombre(o.metrage_m2, 0)} m²
                  {o.date_of ? ` · ${fmt.date(o.date_of)}` : ''}
                  {o.date_fin_prevue ? ` → ${fmt.date(o.date_fin_prevue)}` : ''}
                </span>
                <span className="ml-auto tabular-nums" title={`prévu ${kg(o.kg_prevu)} kg, déjà consommé ${kg(o.kg_consomme)} kg`}>
                  reste {kg(o.kg_reste)} kg
                  {o.kg_consomme > 0.05 && <span className="text-attenue-texte"> / {kg(o.kg_prevu)}</span>}
                  {o.kg_reste_au_dela > 0.05 && <span className="text-alerte"> · {kg(o.kg_reste_au_dela)} au-delà</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

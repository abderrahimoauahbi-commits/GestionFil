/**
 * LA DERIVE DE POIDS D'UN LOT, A LA SAISIE (audit v5, U10).
 *
 * Le registre des lots mesure l'ecart de poids par bobine d'un lot (kilos
 * reels contre bobines x poids catalogue) et le classe vert, orange, rouge
 * selon P_LotTolOrangePct et P_LotTolRougePct. Il ne le disait qu'apres coup,
 * dans l'ecran des lots. Sur une ligne suivie au lot, l'avis le dit des que
 * poids et bobines sont saisis. Il n'empeche rien.
 */
import { Scale } from 'lucide-react'
import type { Conditionnement } from '../lib/conditionnement'
import { couleurEcart, useTolerancesLot } from '../lib/lots'
import { cn, fmt } from '../lib/utils'

export function AvisDerive({
  kg,
  bobines,
  cond,
  className,
}: {
  kg: unknown
  bobines: unknown
  cond: Conditionnement
  className?: string
}) {
  const t = useTolerancesLot()
  const k = Number(kg)
  const b = Number(bobines)
  const p = Number(cond.poids_bobine_kg)
  if (!(k > 0 && b > 0 && p > 0)) return null
  const pct = (k / (b * p) - 1) * 100
  const c = couleurEcart(pct, t)
  if (c !== 'orange' && c !== 'rouge') return null
  return (
    <div
      role="status"
      className={cn('mt-1 flex items-start gap-1 text-[11px] leading-snug', c === 'rouge' ? 'text-danger' : 'text-alerte', className)}
    >
      <Scale className="mt-px size-3 shrink-0" />
      <span>
        Dérive du lot : {fmt.nombre(k / b, 3)} kg par bobine pour {fmt.nombre(p, 3)} au catalogue (
        {pct > 0 ? '+' : ''}
        {fmt.nombre(pct, 1)} %, au-delà du seuil {c === 'rouge' ? `rouge de ${t.rouge}` : `orange de ${t.orange}`} %).
      </span>
    </div>
  )
}

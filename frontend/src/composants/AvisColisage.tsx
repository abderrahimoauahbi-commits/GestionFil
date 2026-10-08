/**
 * L'AVIS DE COLISAGE, sous une ligne d'achat (08/10/2026).
 *
 * Kilos, bobines et palettes qui se contredisent sont signales a la saisie,
 * la ou on les tape — bon de commande, facture d'import, reception. L'avis
 * n'empeche rien : il dit ce qui cloche et ce que la fiche attend. Le controle
 * C43 garde la liste des documents ouverts qui portent encore une telle ligne.
 */
import { AlertTriangle } from 'lucide-react'
import { controleColisage, type Conditionnement } from '../lib/conditionnement'
import { useTolerancesColisage } from '../lib/lots'
import { cn } from '../lib/utils'

export function AvisColisage({
  kg,
  bobines,
  palettes,
  cond,
  className,
}: {
  kg: unknown
  bobines: unknown
  palettes: unknown
  cond: Conditionnement
  className?: string
}) {
  const t = useTolerancesColisage()
  const v = controleColisage(kg, bobines, palettes, cond, t)
  if (v.niveau === 'ok' || !v.message) return null
  return (
    <div
      role="status"
      className={cn(
        'mt-1 flex items-start gap-1 text-[11px] leading-snug',
        v.niveau === 'incoherent' ? 'text-danger' : 'text-alerte',
        className,
      )}
    >
      <AlertTriangle className="mt-px size-3 shrink-0" />
      <span>{v.message}</span>
    </div>
  )
}

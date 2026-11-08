/**
 * L'AVIS DE COLISAGE, sous une ligne d'achat (08/10/2026).
 *
 * Kilos, bobines et palettes qui se contredisent sont signales a la saisie,
 * la ou on les tape — bon de commande, facture d'import, reception. L'avis
 * n'empeche rien : il dit ce qui cloche et ce que la fiche attend. Le controle
 * C43 garde la liste des documents ouverts qui portent encore une telle ligne.
 *
 * C'EST UNE ALERTE, en variante compacte (24/10/2026) : le meme filet et les
 * memes tons que tous les avis, a la taille d'une ligne ↳.
 */
import { AlertTriangle } from 'lucide-react'
import { Alerte } from './ui/base'
import { controleColisage, type Conditionnement } from '../lib/conditionnement'
import { useTolerancesColisage } from '../lib/lots'
import { cn } from '../lib/utils'
import { MOTS_BOBINE, type Mots } from '../lib/motsUnite'

export function AvisColisage({
  kg,
  bobines,
  palettes,
  cond,
  mots,
  className,
}: {
  kg: unknown
  bobines: unknown
  palettes: unknown
  cond: Conditionnement
  /** Le mot du conditionnement ; a defaut, la bobine. */
  mots?: Mots
  className?: string
}) {
  const t = useTolerancesColisage()
  const v = controleColisage(kg, bobines, palettes, cond, t, mots ?? MOTS_BOBINE)
  if (v.niveau === 'ok' || !v.message) return null
  return (
    <Alerte
      taille="compacte"
      ton={v.niveau === 'incoherent' ? 'danger' : 'alerte'}
      icone={AlertTriangle}
      className={cn('mt-1', className)}
    >
      {v.message}
    </Alerte>
  )
}

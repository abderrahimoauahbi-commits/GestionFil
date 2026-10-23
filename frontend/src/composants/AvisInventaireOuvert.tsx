/**
 * LE MAGASIN GELE PAR UN INVENTAIRE OUVERT (decision du 23/10/2026).
 *
 * « Sur l'inventaire ouvert, il ne faut faire aucun mouvement. » Tant qu'un
 * inventaire du magasin est ouvert (brouillon ou valide), la base refuse tout
 * mouvement qui y entre ou en sort (INVENTAIRE-OUVERT, migration 2026-10-23g).
 * L'ecran ne fait que le dire AVANT la saisie, et desactive l'enregistrement :
 * on ne tape pas un document que le serveur refusera.
 *
 * `GET /api/inventaires/ouverts` : lisible par tout compte authentifie (le
 * magasinier qui saisit une sortie n'a pas forcement le module Inventaire).
 */
import { Lock } from 'lucide-react'
import { type InventaireOuvert, phraseGel } from '../lib/inventairesOuverts'
import { Alerte } from './ui/base'

/** Le bandeau : rien si aucun inventaire ouvert ne gele les magasins choisis. */
export function AvisInventaireOuvert({
  inventaires,
  nommer = false,
  className,
}: {
  inventaires: InventaireOuvert[]
  /** Nommer le magasin (un transfert en touche deux). */
  nommer?: boolean
  className?: string
}) {
  if (inventaires.length === 0) return null
  return (
    <Alerte ton="danger" className={className} data-testid="avis-inventaire-ouvert">
      {inventaires.map((i) => (
        <p key={i.id_inventaire} className="flex items-start gap-1.5">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>{phraseGel([i], nommer)}</span>
        </p>
      ))}
    </Alerte>
  )
}

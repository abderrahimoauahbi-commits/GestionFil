/**
 * La confirmation d'un chargement — la meme au bureau et au telephone.
 *
 * AVANT DE VALIDER : ce qui merite d'etre lu (melange de lots sur l'etage, lot
 * plus ancien au magasin). On confirme, on n'est pas bloque.
 *
 * LE STOCK INSUFFISANT N'EST PLUS UNE QUESTION (05/10/2026). Le chargement est
 * bloque ; le magasinier previent le directeur ou l'administrateur, qui font
 * et valident la correction de stock. Le « charger quand meme » a disparu.
 */
import { useConfirmation } from '../../composants/ui/surcouches'
import type { useFiche } from './useFiche'

type Fiche = ReturnType<typeof useFiche>

export function useValiderFiche(f: Fiche) {
  const confirmation = useConfirmation()
  const valider = () => {
    if (f.avertissements.length === 0) return f.envoi.mutate(undefined)
    confirmation.demander({
      titre: 'Avant de valider',
      libelleConfirmer: 'Valider quand même',
      description: (
        <ul className="list-disc space-y-1 pl-4">
          {f.avertissements.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ),
      action: () => f.envoi.mutate(undefined),
    })
  }
  return { valider, element: confirmation.element }
}

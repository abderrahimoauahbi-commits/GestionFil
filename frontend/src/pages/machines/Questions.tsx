/**
 * Les questions d'un chargement — les memes au bureau et au telephone.
 *
 * AVANT D'ENVOYER : ce qui merite d'etre lu (melange de lots sur la zone, lot
 * plus ancien au magasin). On confirme, on n'est pas bloque.
 *
 * APRES UN REFUS DE STOCK (R02-MAG, 01/10/2026) : la matiere est la, le stock
 * dit le contraire. Deux questions, dans l'ordre :
 *
 *   1. Charger quand meme ?            non -> on corrige la saisie
 *   2. Creer le mouvement de correction ?  non -> BLOQUE
 *
 * Le chargement ne passe jamais sans la correction : un stock negatif en
 * silence ferait mentir tout ce qui le lit ensuite.
 */
import { useState } from 'react'
import { useConfirmation } from '../../composants/ui/surcouches'
import { cn } from '../../lib/utils'
import type { useFiche } from './useFiche'

type Fiche = ReturnType<typeof useFiche>

/** Le detail du refus, sans le code qui le prefixe. */
const detailDe = (message: string) => {
  const i = message.indexOf('R02-MAG')
  return (i >= 0 ? message.slice(i + 'R02-MAG'.length) : message).replace(/^\s*:\s*/, '')
}

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

export function QuestionStock({ f, grand = false }: { f: Fiche; grand?: boolean }) {
  const [etape, setEtape] = useState<1 | 2 | 'bloque'>(1)
  if (!f.stockCourt) return null
  const bouton = cn(
    'rounded-[var(--radius-sm)] px-3 font-semibold disabled:opacity-40',
    grand ? 'min-h-[44px] text-[14px]' : 'min-h-[32px] text-[12.5px]',
  )
  const fermer = () => {
    setEtape(1)
    f.oublierStockCourt()
  }
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border border-l-[3px] px-3 py-2.5',
        etape === 'bloque' ? 'border-danger/30 border-l-danger bg-danger/[0.07]' : 'border-alerte/30 border-l-alerte bg-alerte/[0.09]',
        grand ? 'mb-2 text-[13px]' : 'text-[12.5px]',
      )}
    >
      {etape === 1 && (
        <>
          <p className="font-medium">Le stock du magasin ne couvre pas ce chargement.</p>
          <p className="mt-1 leading-relaxed text-attenue-texte">{detailDe(f.stockCourt)}</p>
          <p className="mt-1">La matière est-elle physiquement là ?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={cn(bouton, 'flex-1 bg-alerte text-surface')} onClick={() => setEtape(2)}>
              Oui, charger quand même
            </button>
            <button type="button" className={cn(bouton, 'border border-bordure font-medium')} onClick={fermer}>
              Non, corriger la saisie
            </button>
          </div>
        </>
      )}
      {etape === 2 && (
        <>
          <p className="font-medium">Créer le mouvement de correction ?</p>
          <p className="mt-1 leading-relaxed text-attenue-texte">
            Un ajustement d’inventaire (+) fait entrer au magasin ce qui manque, au coût moyen, sur le
            lot chargé, avec le motif « écart d’inventaire » et la référence de cette fiche. L’écart reste
            ainsi suivi. Sans correction, le chargement est bloqué.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={f.envoi.isPending}
              className={cn(bouton, 'flex-1 bg-primaire text-primaire-texte')}
              onClick={() => f.envoi.mutate({ corriger: true }, { onSettled: () => setEtape(1) })}
            >
              Oui, corriger et charger
            </button>
            <button type="button" className={cn(bouton, 'border border-bordure font-medium')} onClick={() => setEtape('bloque')}>
              Non
            </button>
          </div>
        </>
      )}
      {etape === 'bloque' && (
        <>
          <p className="font-medium text-danger">Chargement bloqué.</p>
          <p className="mt-1 leading-relaxed text-attenue-texte">
            Sans correction, le magasin passerait sous zéro. Faites entrer la matière (réception,
            transfert, inventaire) ou corrigez la quantité chargée.
          </p>
          <div className="mt-2">
            <button type="button" className={cn(bouton, 'border border-bordure font-medium')} onClick={fermer}>
              Fermer
            </button>
          </div>
        </>
      )}
    </div>
  )
}

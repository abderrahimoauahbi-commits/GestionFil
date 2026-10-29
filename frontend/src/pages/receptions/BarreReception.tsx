/**
 * LA BARRE DU BAS D'UNE RECEPTION — collante, une seule action principale
 * (24/10/2026).
 *
 * Elle disait tout a la fois : jusqu'a sept messages mis bout a bout, qu'on ne
 * lisait plus. Elle montre maintenant, en tete, les INDICATEURS de la
 * reception — chacun en chiffre, en couleur et en mot : lignes, kilos peses
 * contre le bon de livraison et contre le bon de commande, palettes et bobines
 * comptees contre attendues, lignes hors tolerance (chacune mene a sa ligne) —
 * puis UN SEUL message de blocage, le premier ; les autres et les simples avis
 * se deplient sur place, sans fenetre.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn, fmt } from '../../lib/utils'
import { allerALaLigne } from './GrilleReception'

export type TonIndicateur = 'succes' | 'alerte' | 'danger' | 'neutre'

export interface IndicateurRec {
  libelle: string
  valeur: ReactNode
  /** Le mot qui dit ce que vaut le chiffre : « conforme », « écart »… */
  mot?: string
  ton?: TonIndicateur
  titre?: string
  /** Sur telephone, ne se montre qu'une fois la barre depliee (la barre reste basse). */
  secondaire?: boolean
}

/** Un message de la barre ; `cle` mene a la ligne qu'il concerne. */
export interface MessageRec {
  texte: string
  cle?: string
}

const COULEUR: Record<TonIndicateur, string> = {
  succes: 'text-succes',
  alerte: 'text-alerte',
  danger: 'text-danger',
  neutre: 'text-texte',
}

/** Un ecart en kilos, signe, avec sa couleur : negatif = manque, positif = surplus. */
export function tonEcartKg(v: number): TonIndicateur {
  return Math.abs(v) <= 0.001 ? 'succes' : v < 0 ? 'danger' : 'alerte'
}
export const texteEcartKg = (v: number) => `${v > 0 ? '+' : ''}${fmt.nombre(v, 2)} kg`

export function BarreReception({
  indicateurs,
  horsTolerance,
  tolerancePct,
  blocages,
  avis,
  actions,
  enAttente = false,
}: {
  indicateurs: IndicateurRec[]
  /** Les lignes au-dela de la tolerance du fournisseur : rang affiche et cle. */
  horsTolerance: { cle: string; rang: number; code: string; derogee: boolean }[]
  tolerancePct: number
  /** Ce qui empeche l'action principale, dans l'ordre ou il faut le traiter. */
  blocages: MessageRec[]
  /** Ce qui ne bloque pas mais merite d'etre lu. */
  avis: MessageRec[]
  actions: ReactNode
  /** Des modifications attendent d'etre enregistrees : la barre se borde de la couleur principale. */
  enAttente?: boolean
}) {
  const [deplie, setDeplie] = useState(false)
  const premier = blocages[0]
  const autres = blocages.length - 1 + avis.length
  const nonDerogees = horsTolerance.filter((h) => !h.derogee).length
  const nbSecondaires = indicateurs.filter((i) => i.secondaire).length
  const nbAutres = premier ? autres : avis.length - 1

  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 mt-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
        enAttente ? 'border-primaire' : 'border-bordure',
      )}
      role="region"
      aria-label="Indicateurs et actions de la réception"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <dl className="flex min-w-0 flex-1 basis-[28rem] flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
          {indicateurs.map((i) => (
            <div
              key={i.libelle}
              className={cn('flex items-baseline gap-1.5', i.secondaire && !deplie && 'max-md:hidden')}
              title={i.titre}
            >
              <dt className="text-[10.5px] uppercase tracking-wider text-attenue-texte">{i.libelle}</dt>
              <dd className={cn('font-semibold tabular-nums', COULEUR[i.ton ?? 'neutre'])}>
                {i.valeur}
                {i.mot && <span className="ml-1 text-[11px] font-medium">{i.mot}</span>}
              </dd>
            </div>
          ))}
          <div className="flex items-baseline gap-1.5" title={`Tolérance de pesée du fournisseur : ${fmt.nombre(tolerancePct, 1)} %`}>
            <dt className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Tolérance</dt>
            <dd className={cn('font-semibold tabular-nums', horsTolerance.length === 0 ? 'text-succes' : nonDerogees ? 'text-danger' : 'text-alerte')}>
              {horsTolerance.length}
              <span className="ml-1 text-[11px] font-medium">
                {horsTolerance.length === 0 ? 'hors tolérance — conforme' : nonDerogees ? 'hors tolérance' : 'hors tolérance, dérogées'}
              </span>
              {horsTolerance.map((h) => (
                <button
                  key={h.cle}
                  type="button"
                  onClick={() => allerALaLigne(h.cle)}
                  className={cn(
                    'ml-1 rounded-full border px-1.5 text-[11px] font-medium hover:bg-attenue',
                    h.derogee ? 'border-alerte/50 text-alerte' : 'border-danger/50 text-danger',
                  )}
                  title={`Aller à la ligne ${h.rang} (${h.code})`}
                  aria-label={`Aller à la ligne ${h.rang} hors tolérance`}
                >
                  L{h.rang}
                </button>
              ))}
            </dd>
          </div>
        </dl>
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </div>

      {(premier || avis.length > 0 || nbSecondaires > 0) && (
        <div
          className={cn(
            'mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-bordure/60 pt-1.5 text-[12.5px]',
            !premier && avis.length === 0 && 'md:hidden',
          )}
        >
          {premier ? (
            <MessageLigne m={premier} ton="danger" court={!deplie} />
          ) : avis.length > 0 ? (
            <MessageLigne m={avis[0]} ton="alerte" court={!deplie} />
          ) : null}
          {(nbAutres > 0 || nbSecondaires > 0) && (
            <button
              type="button"
              onClick={() => setDeplie((d) => !d)}
              className={cn(
                'inline-flex items-center gap-0.5 text-[12px] text-attenue-texte underline hover:text-texte',
                nbAutres <= 0 && 'md:hidden',
              )}
              aria-expanded={deplie}
            >
              {deplie ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {deplie ? 'Replier' : nbAutres > 0 ? `${nbAutres} autre(s) message(s)` : 'Détails'}
            </button>
          )}
        </div>
      )}
      {deplie && (
        <ul className="mt-1 space-y-0.5 text-[12.5px]">
          {(premier ? blocages.slice(1) : []).map((m, k) => (
            <li key={`b${k}`}>
              <MessageLigne m={m} ton="danger" />
            </li>
          ))}
          {(premier ? avis : avis.slice(1)).map((m, k) => (
            <li key={`a${k}`}>
              <MessageLigne m={m} ton="alerte" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MessageLigne({ m, ton, court = false }: { m: MessageRec; ton: 'danger' | 'alerte'; court?: boolean }) {
  return (
    <span className={cn(ton === 'danger' ? 'text-danger' : 'text-alerte', court && 'max-md:line-clamp-2')}>
      {ton === 'danger' ? 'Bloquant : ' : 'À noter : '}
      {m.texte}
      {m.cle && (
        <button
          type="button"
          onClick={() => allerALaLigne(m.cle!)}
          className="ml-1 text-[12px] text-attenue-texte underline hover:text-texte"
        >
          voir la ligne
        </button>
      )}
    </span>
  )
}

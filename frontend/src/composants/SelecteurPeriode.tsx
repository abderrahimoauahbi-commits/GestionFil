/**
 * Selecteur de periode.
 *
 * Borne par les mois **reellement disponibles**, jamais par un calendrier
 * ouvert. C'est le point qui compte ici : un plan de production couvre trois,
 * six ou douze mois selon le cas, et proposer de filtrer sur un mois hors du
 * plan afficherait un tableau vide sans dire pourquoi.
 *
 * Les raccourcis s'adaptent donc aussi : sur un plan de quatre mois, « 6 mois »
 * n'est pas propose.
 */
import { useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import { cn } from '../lib/utils'

const MOIS_COURT = [
  'jan', 'fev', 'mar', 'avr', 'mai', 'jun',
  'jul', 'aou', 'sep', 'oct', 'nov', 'dec',
]

/** « 2026-07 » devient « jul 26 ». */
export function libelleMois(am: string): string {
  const [an, mo] = am.split('-').map(Number)
  return `${MOIS_COURT[(mo || 1) - 1]} ${String(an).slice(2)}`
}

export interface Periode {
  debut: string | null
  fin: string | null
}

/** Une ligne est-elle dans la periode ? Une periode vide accepte tout. */
export function dansPeriode(annee_mois: string | null | undefined, p: Periode): boolean {
  if (!p.debut && !p.fin) return true
  if (!annee_mois) return false
  if (p.debut && annee_mois < p.debut) return false
  if (p.fin && annee_mois > p.fin) return false
  return true
}

export function SelecteurPeriode({
  mois,
  valeur,
  surChangement,
  compact = false,
}: {
  /** Mois disponibles, tries, au format AAAA-MM. */
  mois: string[]
  valeur: Periode
  surChangement: (p: Periode) => void
  /** Disposition en colonne, pour un panneau lateral etroit. */
  compact?: boolean
}) {
  const raccourcis = useMemo(() => {
    if (mois.length < 2) return []
    // On n'offre que les fenetres qui tiennent dans l'horizon disponible.
    return [3, 6, 12]
      .filter((n) => n < mois.length)
      .map((n) => ({ n, debut: mois[0], fin: mois[n - 1] }))
  }, [mois])

  if (!mois.length) return null

  const actif = valeur.debut !== null || valeur.fin !== null

  return (
    <div className={cn('flex gap-2', compact ? 'flex-col' : 'flex-wrap items-end')}>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10.5px] text-attenue-texte">Du</span>
        <select
          value={valeur.debut ?? ''}
          onChange={(e) => surChangement({ ...valeur, debut: e.target.value || null })}
          className={CLASSE}
        >
          <option value="">Debut du plan</option>
          {mois.map((m) => (
            <option key={m} value={m}>
              {libelleMois(m)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10.5px] text-attenue-texte">Au</span>
        <select
          value={valeur.fin ?? ''}
          onChange={(e) => surChangement({ ...valeur, fin: e.target.value || null })}
          className={CLASSE}
        >
          <option value="">Fin du plan</option>
          {mois.map((m) => (
            <option key={m} value={m}>
              {libelleMois(m)}
            </option>
          ))}
        </select>
      </label>

      <div className={cn('flex flex-wrap gap-1', compact ? '' : 'pb-0.5')}>
        {raccourcis.map((r) => {
          const choisi = valeur.debut === r.debut && valeur.fin === r.fin
          return (
            <button
              key={r.n}
              type="button"
              onClick={() => surChangement({ debut: r.debut, fin: r.fin })}
              className={cn(
                'rounded-[3px] border px-1.5 py-0.5 text-[11px] transition-colors',
                choisi
                  ? 'border-primaire bg-primaire text-primaire-texte'
                  : 'border-bordure text-attenue-texte hover:bg-attenue hover:text-texte',
              )}
            >
              {r.n} mois
            </button>
          )
        })}
        {actif && (
          <button
            type="button"
            onClick={() => surChangement({ debut: null, fin: null })}
            className="rounded-[3px] px-1.5 py-0.5 text-[11px] text-primaire hover:bg-attenue"
          >
            Tout
          </button>
        )}
      </div>

      {!compact && (
        <span className="flex items-center gap-1 pb-1 text-[11px] text-attenue-texte">
          <CalendarRange className="size-3.5" />
          {mois.length} mois au plan
        </span>
      )}
    </div>
  )
}

const CLASSE =
  'h-7 rounded-[3px] border border-champ bg-surface px-1.5 text-[12px] text-texte ' +
  'outline-none focus:border-primaire'

/**
 * Panneau de filtres, en barre laterale.
 *
 * Remplace le constructeur de filtre personnalise. Celui-ci demandait de
 * choisir un champ, puis un operateur, puis une valeur — trois gestes et un
 * vocabulaire technique pour ce qu'une liste deroulante fait en un clic. Il
 * couvrait des cas rares au prix de rendre le cas courant penible.
 *
 * Les valeurs proposees sont **deduites des donnees affichees**, jamais d'une
 * liste devinee : sur un ecran donne, seuls certains magasins ou certains types
 * apparaissent, et offrir les autres ne peut que vider le tableau.
 */
import { useCallback, useMemo, useState } from 'react'
import { FilterX } from 'lucide-react'
import { cn } from '../lib/utils'
import { dansPeriode, SelecteurPeriode, type Periode } from './SelecteurPeriode'

export interface ChampFiltre<L> {
  /** Identifiant du filtre, libre. */
  cle: string
  libelle: string
  /**
   * `liste`   : egalite, valeurs deduites des lignes
   * `texte`   : contient, insensible a la casse
   * `periode` : intervalle de mois, borne par les mois presents
   */
  type: 'liste' | 'texte' | 'periode'
  /** Valeur de la ligne pour ce filtre. */
  valeur: (ligne: L) => string | null | undefined
  /** Libelle affiche pour une valeur, si different de la valeur elle-meme. */
  etiquette?: (valeur: string, ligne: L) => string
}

type Valeurs = Record<string, string | Periode>

/**
 * Etat des filtres et predicat pret a l'emploi.
 *
 * Le predicat est le seul point ou la regle de filtrage est ecrite : les ecrans
 * ne reimplementent pas la comparaison, ce qui evite qu'un filtre se comporte
 * differemment d'un ecran a l'autre.
 */
export function useFiltres<L>(champs: ChampFiltre<L>[]) {
  const [valeurs, setValeurs] = useState<Valeurs>({})

  const definir = useCallback((cle: string, v: string | Periode) => {
    setValeurs((x) => ({ ...x, [cle]: v }))
  }, [])

  const reinitialiser = useCallback(() => setValeurs({}), [])

  const actifs = champs.filter((c) => {
    const v = valeurs[c.cle]
    if (c.type === 'periode') {
      const p = v as Periode | undefined
      return Boolean(p?.debut || p?.fin)
    }
    return Boolean(v)
  }).length

  const retenir = useCallback(
    (ligne: L) =>
      champs.every((c) => {
        const v = valeurs[c.cle]
        if (!v) return true
        const val = c.valeur(ligne)
        if (c.type === 'periode') return dansPeriode(val, v as Periode)
        if (c.type === 'texte') {
          const t = String(v).trim().toLowerCase()
          return !t || (val ?? '').toLowerCase().includes(t)
        }
        return val === v
      }),
    [champs, valeurs],
  )

  return { valeurs, definir, reinitialiser, actifs, retenir }
}

export function PanneauFiltres<L>({
  champs,
  lignes,
  valeurs,
  definir,
  reinitialiser,
  actifs,
  enTete,
  enPied,
}: {
  champs: ChampFiltre<L>[]
  /** Lignes NON filtrees : ce sont elles qui alimentent les listes de valeurs. */
  lignes: L[]
  valeurs: Valeurs
  definir: (cle: string, v: string | Periode) => void
  reinitialiser: () => void
  actifs: number
  enTete?: React.ReactNode
  enPied?: React.ReactNode
}) {
  /* Valeurs distinctes par champ, calculees une fois. */
  const options = useMemo(() => {
    const m = new Map<string, { valeur: string; libelle: string }[]>()
    for (const c of champs) {
      if (c.type === 'liste') {
        const vus = new Map<string, string>()
        for (const l of lignes) {
          const v = c.valeur(l)
          if (v === null || v === undefined || v === '') continue
          if (!vus.has(v)) vus.set(v, c.etiquette ? c.etiquette(v, l) : v)
        }
        m.set(
          c.cle,
          [...vus.entries()]
            .map(([valeur, libelle]) => ({ valeur, libelle }))
            .sort((a, b) => a.libelle.localeCompare(b.libelle)),
        )
      }
      if (c.type === 'periode') {
        const mois = new Set<string>()
        for (const l of lignes) {
          const v = c.valeur(l)
          if (v) mois.add(v.slice(0, 7))
        }
        m.set(
          c.cle,
          [...mois].sort().map((v) => ({ valeur: v, libelle: v })),
        )
      }
    }
    return m
  }, [champs, lignes])

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
          Filtres
        </span>
        {actifs > 0 && (
          <button
            type="button"
            onClick={reinitialiser}
            className="flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[11px]
                       text-primaire hover:bg-attenue"
          >
            <FilterX className="size-3" />
            Effacer ({actifs})
          </button>
        )}
      </div>

      {enTete}

      {champs.map((c) => {
        if (c.type === 'periode') {
          return (
            <div key={c.cle} className="flex flex-col gap-0.5">
              <span className="text-[10.5px] text-attenue-texte">{c.libelle}</span>
              <SelecteurPeriode
                compact
                mois={(options.get(c.cle) ?? []).map((o) => o.valeur)}
                valeur={(valeurs[c.cle] as Periode) ?? { debut: null, fin: null }}
                surChangement={(p) => definir(c.cle, p)}
              />
            </div>
          )
        }

        if (c.type === 'texte') {
          return (
            <label key={c.cle} className="flex flex-col gap-0.5">
              <span className="text-[10.5px] text-attenue-texte">{c.libelle}</span>
              <input
                value={(valeurs[c.cle] as string) ?? ''}
                onChange={(e) => definir(c.cle, e.target.value)}
                className={CLASSE}
              />
            </label>
          )
        }

        const opts = options.get(c.cle) ?? []
        return (
          <label key={c.cle} className="flex flex-col gap-0.5">
            <span className="text-[10.5px] text-attenue-texte">
              {c.libelle}
              {opts.length > 0 && (
                <span className="ml-1 opacity-60">({opts.length})</span>
              )}
            </span>
            <select
              value={(valeurs[c.cle] as string) ?? ''}
              onChange={(e) => definir(c.cle, e.target.value)}
              className={CLASSE}
              disabled={opts.length === 0}
            >
              <option value="">Tous</option>
              {opts.map((o) => (
                <option key={o.valeur} value={o.valeur}>
                  {o.libelle}
                </option>
              ))}
            </select>
          </label>
        )
      })}

      {enPied}
    </div>
  )
}

const CLASSE = cn(
  'h-7 w-full rounded-[3px] border border-champ bg-surface px-1.5 text-[12px]',
  'text-texte outline-none focus:border-primaire disabled:opacity-50',
)

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
import { Filter, FilterX } from 'lucide-react'
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

/**
 * Valeurs distinctes par champ, deduites DES LIGNES AFFICHEES.
 *
 * Jamais d'une liste devinee : sur un ecran donne, seuls certains magasins ou
 * certains types apparaissent, et offrir les autres ne peut que vider le
 * tableau.
 */
function optionsDesChamps<L>(champs: ChampFiltre<L>[], lignes: L[]) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useMemo(() => {
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
  const options = optionsDesChamps(champs, lignes)

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

      {champs.map((c) => (
        <UnChamp
          key={c.cle}
          champ={c}
          options={options.get(c.cle) ?? []}
          valeurs={valeurs}
          definir={definir}
        />
      ))}

      {enPied}
    </div>
  )
}

/**
 * Un champ de filtre, quelle que soit la disposition.
 *
 * Extrait du panneau lateral pour que la barre horizontale rende EXACTEMENT le
 * meme champ : deux rendus paralleles finissent toujours par diverger, et un
 * filtre qui se comporte autrement selon l'ecran est pire que pas de filtre.
 */
function UnChamp<L>({
  champ: c,
  options,
  valeurs,
  definir,
  largeur,
}: {
  champ: ChampFiltre<L>
  options: { valeur: string; libelle: string }[]
  valeurs: Valeurs
  definir: (cle: string, v: string | Periode) => void
  /** Largeur minimale, pour que les champs s'alignent en barre. */
  largeur?: string
}) {
  const enveloppe = cn('flex flex-col gap-0.5', largeur)

  if (c.type === 'periode') {
    return (
      <div className={enveloppe}>
        <span className="text-[10.5px] text-attenue-texte">{c.libelle}</span>
        <SelecteurPeriode
          compact
          mois={options.map((o) => o.valeur)}
          valeur={(valeurs[c.cle] as Periode) ?? { debut: null, fin: null }}
          surChangement={(p) => definir(c.cle, p)}
        />
      </div>
    )
  }

  if (c.type === 'texte') {
    return (
      <label className={enveloppe}>
        <span className="text-[10.5px] text-attenue-texte">{c.libelle}</span>
        <input
          value={(valeurs[c.cle] as string) ?? ''}
          onChange={(e) => definir(c.cle, e.target.value)}
          className={CLASSE}
        />
      </label>
    )
  }

  return (
    <label className={enveloppe}>
      <span className="text-[10.5px] text-attenue-texte">
        {c.libelle}
        {options.length > 0 && <span className="ml-1 opacity-60">({options.length})</span>}
      </span>
      <select
        value={(valeurs[c.cle] as string) ?? ''}
        onChange={(e) => definir(c.cle, e.target.value)}
        className={CLASSE}
        disabled={options.length === 0}
      >
        <option value="">Tous</option>
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Les memes filtres, EN BARRE AU-DESSUS DU TABLEAU.
 *
 * POURQUOI QUITTER LE RAIL. Une colonne de 240 px prise a gauche coute un
 * quart de la largeur sur un portable, et c'est le tableau qui la paie : les
 * colonnes se serrent, les nombres passent a la ligne. Les filtres, eux, se
 * posent une fois puis ne bougent plus — ils n'ont pas besoin de cette place en
 * permanence. En barre, ils tiennent sur une ou deux lignes et rendent toute la
 * largeur au tableau.
 *
 * ELLE NE S'IMPRIME PAS. `sans-impression` la retire du papier : un etat
 * imprime avec ses listes deroulantes en travers de la page n'est pas un
 * document, c'est une capture d'ecran. C'etait le defaut du rail, que la
 * disposition en colonne rendait inevitable.
 *
 * LES CHAMPS S'ALIGNENT parce qu'ils partagent une largeur minimale : sans
 * elle, chaque champ prend celle de son contenu et la barre devient un escalier.
 */
export function BarreFiltres<L>({
  champs,
  lignes,
  valeurs,
  definir,
  reinitialiser,
  actifs,
  enPied,
}: {
  champs: ChampFiltre<L>[]
  lignes: L[]
  valeurs: Valeurs
  definir: (cle: string, v: string | Periode) => void
  reinitialiser: () => void
  actifs: number
  /** Bascules propres a l'ecran, posees au bout de la barre. */
  enPied?: React.ReactNode
}) {
  const options = optionsDesChamps(champs, lignes)

  return (
    <div
      className="sans-impression mb-3 flex flex-wrap items-end gap-2 rounded-[var(--radius)]
                 border border-bordure bg-surface px-2.5 py-2"
    >
      <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase
                       tracking-wide text-attenue-texte">
        <Filter className="size-3" />
        Filtres
      </span>

      {champs.map((c) => (
        <UnChamp
          key={c.cle}
          champ={c}
          options={options.get(c.cle) ?? []}
          valeurs={valeurs}
          definir={definir}
          largeur={c.type === 'periode' ? 'min-w-[13rem]' : 'min-w-[9.5rem]'}
        />
      ))}

      {enPied}

      {actifs > 0 && (
        <button
          type="button"
          onClick={reinitialiser}
          className="mb-0.5 flex items-center gap-1 rounded-[3px] border border-bordure px-2
                     py-1 text-[11px] text-primaire hover:bg-attenue"
        >
          <FilterX className="size-3" />
          Effacer ({actifs})
        </button>
      )}
    </div>
  )
}

const CLASSE = cn(
  'h-7 w-full rounded-[3px] border border-champ bg-surface px-1.5 text-[12px]',
  'text-texte outline-none focus:border-primaire disabled:opacity-50',
)

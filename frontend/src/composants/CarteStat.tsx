/**
 * Carte de statistique.
 *
 * Le motif des tableaux de bord modernes : une pastille d'icone teintee, un
 * chiffre dominant, un libelle, et une seconde information sous le chiffre.
 *
 * Une precision qui n'est pas un detail : ces cartes portent une **comparaison
 * factuelle**, jamais une variation inventee. Un tableau de bord affiche
 * volontiers « +12 % » sous chaque chiffre ; encore faut-il avoir la mesure
 * d'hier. Ici l'historique n'existe pas pour la plupart des indicateurs, alors
 * la seconde ligne dit autre chose de vrai — une repartition, un reste, une
 * date — plutot qu'une tendance fabriquee.
 *
 * La teinte porte un etat, pas une decoration : elle vient de la palette
 * semantique, et une carte neutre reste neutre.
 */
import { cn } from '../lib/utils'

export type TonStat = 'neutre' | 'primaire' | 'succes' | 'alerte' | 'danger'

const PASTILLE: Record<TonStat, string> = {
  neutre: 'bg-attenue text-attenue-texte',
  primaire: 'bg-primaire/12 text-primaire',
  succes: 'bg-succes/15 text-succes',
  alerte: 'bg-alerte/18 text-alerte',
  danger: 'bg-danger/15 text-danger',
}

const CHIFFRE: Record<TonStat, string> = {
  neutre: 'text-texte',
  primaire: 'text-texte',
  succes: 'text-succes',
  alerte: 'text-alerte',
  danger: 'text-danger',
}

export function CarteStat({
  Icone,
  libelle,
  valeur,
  unite,
  precision,
  ton = 'neutre',
  surClic,
  aide,
}: {
  Icone: React.ComponentType<{ className?: string }>
  libelle: string
  valeur: string | number
  /** Suffixe discret : kg, MAD, jours. */
  unite?: string
  /** Seconde ligne : un fait, jamais une tendance inventee. */
  precision?: React.ReactNode
  ton?: TonStat
  surClic?: () => void
  aide?: string
}) {
  const Balise = surClic ? 'button' : 'div'

  return (
    <Balise
      {...(surClic ? { type: 'button' as const, onClick: surClic } : {})}
      title={aide}
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius)] border border-bordure bg-surface p-3',
        'text-left transition-colors',
        surClic && 'hover:border-champ hover:bg-attenue/50',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-[var(--radius)]',
          PASTILLE[ton],
        )}
      >
        <Icone className="size-[18px]" />
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[11px] leading-tight text-attenue-texte">{libelle}</span>
        <span
          className={cn(
            'text-[22px] font-semibold leading-none tabular-nums tracking-tight',
            CHIFFRE[ton],
          )}
        >
          {valeur}
          {unite && (
            <span className="ml-1 text-[11px] font-normal text-attenue-texte">{unite}</span>
          )}
        </span>
        {precision && (
          <span className="truncate text-[11px] leading-tight text-attenue-texte">
            {precision}
          </span>
        )}
      </span>
    </Balise>
  )
}

/**
 * Barre de repartition.
 *
 * Trois segments au plus, cote a cote, avec un filet de fond entre eux. Elle
 * remplace avantageusement un camembert : sur des parts d'etat — conforme,
 * en attente, en anomalie — l'oeil compare des longueurs bien mieux que des
 * angles, et la barre tient sur une ligne.
 */
export function BarreRepartition({
  parts,
}: {
  parts: { libelle: string; valeur: number; ton: TonStat }[]
}) {
  const total = parts.reduce((s, p) => s + p.valeur, 0)
  if (!total) return null

  const FOND: Record<TonStat, string> = {
    neutre: 'bg-attenue-texte/40',
    primaire: 'bg-primaire',
    succes: 'bg-succes',
    alerte: 'bg-alerte',
    danger: 'bg-danger',
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {parts
          .filter((p) => p.valeur > 0)
          .map((p) => (
            <div
              key={p.libelle}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', FOND[p.ton])}
              style={{ width: `${(p.valeur / total) * 100}%` }}
              title={`${p.libelle} : ${p.valeur}`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((p) => (
          <span
            key={p.libelle}
            className="flex items-center gap-1.5 text-[11px] text-attenue-texte"
          >
            <span className={cn('size-2 shrink-0 rounded-full', FOND[p.ton])} />
            {p.libelle}
            <span className="font-medium tabular-nums text-texte">{p.valeur}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

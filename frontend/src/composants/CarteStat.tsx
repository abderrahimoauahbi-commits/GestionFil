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

/* DECLAREE AVANT SES USAGES. `const` n’est pas remonte comme une fonction :
   plus bas, elle ne tenait que parce que ses lecteurs sont des composants,
   rendus apres l’evaluation du module. Un seul usage au niveau du fichier
   aurait suffi a tout faire tomber. */
const TRAIT: Record<TonStat, string> = {
  neutre: 'text-attenue-texte',
  primaire: 'text-primaire',
  succes: 'text-succes',
  alerte: 'text-alerte',
  danger: 'text-danger',
}

/**
 * LE MINI-GRAPHIQUE DE LA CARTE (sparkline).
 *
 * POURQUOI IL MANQUAIT. Une carte qui affiche « 6,4 M MAD » dit ce que vaut le
 * stock aujourd'hui, et rien d'autre. Or la question qu'on se pose devant un
 * tableau de bord n'est jamais « combien » seule : c'est « combien, et dans
 * quel sens ». Sans la forme des derniers mois, il faut ouvrir un autre ecran
 * pour savoir si le chiffre monte ou descend.
 *
 * IL RESTE MUET QUAND IL N'A RIEN A DIRE. Moins de trois points ne dessinent
 * pas une tendance, ils dessinent un trait ; la carte s'en passe alors plutot
 * que d'afficher une ligne qui ne veut rien dire. C'est la meme regle que pour
 * la seconde ligne : pas de variation inventee.
 *
 * LA COURBE EST LISSEE, PAS ANGULEUSE. Une polyligne brute sur douze points
 * donne des dents de scie qu'on lit comme du bruit ; une courbe de Bezier
 * passant par les memes points donne la forme sans le bruit.
 */
function Courbe({ points, ton }: { points: number[]; ton: TonStat }) {
  if (points.length < 3) return null

  const L = 96
  const H = 30
  const min = Math.min(...points)
  const max = Math.max(...points)
  const etendue = max - min || 1
  const xy = points.map((v, i) => [
    (i / (points.length - 1)) * L,
    H - 2 - ((v - min) / etendue) * (H - 4),
  ])

  // Lissage : chaque segment recoit deux poignees a mi-distance horizontale,
  // ce qui arrondit sans jamais depasser les valeurs mesurees.
  let d = `M ${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`
  for (let i = 1; i < xy.length; i += 1) {
    const [x0, y0] = xy[i - 1]
    const [x1, y1] = xy[i]
    const mx = (x0 + x1) / 2
    d += ` C ${mx.toFixed(1)} ${y0.toFixed(1)}, ${mx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }

  const cle = `sp-${ton}`
  const [dernierX, dernierY] = xy[xy.length - 1]

  return (
    <svg
      viewBox={`0 0 ${L} ${H}`}
      className={cn('h-[30px] w-24 shrink-0 overflow-visible', TRAIT[ton])}
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={cle} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* L'aire sous la courbe donne du poids a la tendance ; seule, la ligne
          se perd sur un fond blanc a cette taille. */}
      <path d={`${d} L ${L} ${H} L 0 ${H} Z`} fill={`url(#${cle})`} stroke="none" />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* LE DERNIER POINT EST MARQUE : c'est la valeur du gros chiffre, et
          l'oeil doit pouvoir relier les deux. */}
      <circle cx={dernierX} cy={dernierY} r="2" fill="currentColor" />
    </svg>
  )
}

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
  courbe,
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
  /** Les derniers mois, pour donner le SENS a cote de la valeur. */
  courbe?: number[]
}) {
  const Balise = surClic ? 'button' : 'div'

  return (
    <Balise
      {...(surClic ? { type: 'button' as const, onClick: surClic } : {})}
      title={aide}
      className={cn(
        // L'AIR EST UN MATERIAU. A douze pixels de marge, le chiffre touchait
        // le bord de la carte ; a seize, il est POSE dedans. C'est la
        // difference qu'on percoit entre un ecran fait et un ecran soigne, et
        // elle ne coute que quatre pixels.
        'relative flex items-start gap-3.5 overflow-hidden rounded-[var(--radius-lg)]',
        'border border-bordure bg-surface p-4 text-left shadow-[var(--ombre-pose)]',
        surClic && 'carte-active cursor-pointer',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-[var(--radius)]',
          PASTILLE[ton],
        )}
      >
        <Icone className="size-[18px]" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.055em] text-attenue-texte">
          {libelle}
        </span>
        <span
          className={cn(
            // UN CHIFFRE PLUS GRAND ET PLUS SERRE. C'est lui qu'on vient
            // chercher ; il doit se lire de loin, et le resserrement evite
            // qu'un montant a sept chiffres parte a la ligne.
            'valeur-arrive text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
            CHIFFRE[ton],
          )}
        >
          {valeur}
          {unite && (
            <span className="ml-1.5 text-[11.5px] font-medium tracking-normal text-attenue-texte">
              {unite}
            </span>
          )}
        </span>
        {precision && (
          <span className="truncate text-[11.5px] leading-tight text-attenue-texte">
            {precision}
          </span>
        )}
      </span>

      {courbe && <Courbe points={courbe} ton={ton} />}
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

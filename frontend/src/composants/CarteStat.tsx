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
import { useId } from 'react'
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
  grave: 'text-danger',
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
  // UN DEGRADE PAR CARTE : un id tire du ton seul se repetait d'une carte a
  // l'autre, et le navigateur prenait le premier de la page pour toutes.
  const cle = `sp-${useId().replace(/:/g, '')}`
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

  const [dernierX, dernierY] = xy[xy.length - 1]

  return (
    <svg
      viewBox={`0 0 ${L} ${H}`}
      className={cn('spark h-[30px] w-24 shrink-0 overflow-visible', TRAIT[ton])}
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
      <path className="spark-aire" d={`${d} L ${L} ${H} L 0 ${H} Z`} fill={`url(#${cle})`} stroke="none" />
      {/* LA COURBE SE TRACE A L'APPARITION (12/10/2026) : `pathLength` ramene
          sa longueur a 1, et l'animation du pointille la deroule de gauche a
          droite — une fois, au montage ; un rechargement ne la rejoue pas. */}
      <path
        className="spark-trait"
        pathLength={1}
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
      <circle className="spark-point" cx={dernierX} cy={dernierY} r="2" fill="currentColor" />
    </svg>
  )
}

/**
 * LES BARRES D'ECART : une valeur par periode, de part et d'autre de zero.
 *
 * Pour ce qui se compte (references en rupture par mois) ou ce qui s'ecarte
 * (ecart de pesee) : la hauteur dit l'ampleur, le cote de la ligne dit le sens.
 * Une barre negative descend sous la ligne et prend le rouge. Chaque barre
 * pousse depuis la ligne zero, l'une apres l'autre.
 */
function Barres({ valeurs, ton }: { valeurs: number[]; ton: TonStat }) {
  if (valeurs.length < 3 || valeurs.every((v) => v === 0)) return null
  const L = 96
  const H = 30
  const max = Math.max(...valeurs, 0)
  const min = Math.min(...valeurs, 0)
  const etendue = max - min || 1
  const zero = 1 + (max / etendue) * (H - 2)
  const pas = L / valeurs.length
  const largeur = Math.max(2, pas * 0.62)
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className={cn('spark h-[30px] w-24 shrink-0 overflow-visible', TRAIT[ton])} aria-hidden preserveAspectRatio="none">
      <line x1="0" x2={L} y1={zero} y2={zero} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {valeurs.map((v, i) => {
        const h = (Math.abs(v) / etendue) * (H - 2)
        return (
          <rect
            key={i}
            className={cn('spark-barre', v < 0 && 'spark-barre-bas text-danger')}
            style={{ '--i': i } as React.CSSProperties}
            x={i * pas + (pas - largeur) / 2}
            y={v >= 0 ? zero - h : zero}
            width={largeur}
            height={Math.max(h, v === 0 ? 0 : 0.8)}
            rx="1"
            fill="currentColor"
          />
        )
      })}
    </svg>
  )
}

/**
 * LA JAUGE : une part sur cent (stock dormant, achats en devises). Un arc qui
 * se remplit jusqu'a la valeur ; le fond de l'arc rappelle ou serait le tout.
 */
function Jauge({ pct, ton }: { pct: number; ton: TonStat }) {
  const v = Math.max(0, Math.min(100, pct))
  const arc = 'M 4 30 A 22 22 0 0 1 48 30'
  return (
    <svg viewBox="0 0 52 32" className={cn('spark h-[30px] w-12 shrink-0 overflow-visible', TRAIT[ton])} aria-hidden>
      <path d={arc} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="5" strokeLinecap="round" pathLength={100} />
      <path
        className="spark-jauge"
        style={{ '--v': v } as React.CSSProperties}
        d={arc}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100"
        strokeDashoffset={100 - v}
      />
    </svg>
  )
}

/**
 * `grave` est le cran entre `alerte` et `danger` (« critique » avant « rupture »).
 * Les deux partageaient le meme rouge : dans la barre d'etat du catalogue, on ne
 * distinguait plus les critiques des ruptures sans lire la legende.
 */
export type TonStat = 'neutre' | 'primaire' | 'succes' | 'alerte' | 'grave' | 'danger'

const PASTILLE: Record<TonStat, string> = {
  neutre: 'bg-attenue text-attenue-texte',
  primaire: 'bg-primaire/12 text-primaire',
  succes: 'bg-succes/15 text-succes',
  alerte: 'bg-alerte/18 text-alerte',
  grave: 'bg-danger/10 text-danger',
  danger: 'bg-danger/15 text-danger',
}


const CHIFFRE: Record<TonStat, string> = {
  neutre: 'text-texte',
  primaire: 'text-texte',
  succes: 'text-succes',
  alerte: 'text-alerte',
  grave: 'text-danger',
  danger: 'text-danger',
}

/** Le filet d'etat en haut de la carte : la couleur sans l'aplat. */
const FILET: Record<TonStat, string> = {
  neutre: '',
  primaire: 'bg-primaire',
  succes: 'bg-succes',
  alerte: 'bg-alerte',
  grave: 'bg-danger/60',
  danger: 'bg-danger',
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
  barres,
  jauge,
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
  /** Une valeur par periode, signee : ecarts, comptes par mois. */
  barres?: number[]
  /** Une part sur 100, dessinee en jauge. */
  jauge?: number
}) {
  const Balise = surClic ? 'button' : 'div'

  return (
    <Balise
      {...(surClic ? { type: 'button' as const, onClick: surClic } : {})}
      title={aide}
      data-ton={ton}
      className={cn(
        'carte-stat',
        // UN INDICATEUR, PAS UNE TUILE DECORATIVE : le libelle en tete avec son
        // icone, le chiffre dominant dessous, la precision en pied. Un filet de
        // couleur en haut dit l'etat d'un coup d'oeil, sans fond teinte.
        'group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-[var(--radius-lg)]',
        'border border-bordure bg-surface px-4 pb-3.5 pt-3.5 text-left',
        surClic && 'carte-active cursor-pointer transition-colors hover:border-champ/60',
      )}
    >
      {ton !== 'neutre' && (
        <span aria-hidden className={cn('filet-stat absolute inset-x-0 top-0 h-[2px]', FILET[ton])} />
      )}
      <span className="libelle-stat flex min-w-0 items-center gap-2 text-[12px] font-medium text-attenue-texte">
        <span className={cn('pastille-stat grid size-6 shrink-0 place-items-center rounded-[var(--radius-sm)]', PASTILLE[ton])}>
          <Icone className="size-3.5" />
        </span>
        <span className="truncate">{libelle}</span>
      </span>

      <span className="flex min-w-0 items-end justify-between gap-3">
        <span
          className={cn(
            'valeur-arrive whitespace-nowrap text-[24px] font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-[28px]',
            CHIFFRE[ton],
          )}
        >
          {valeur}
          {unite && (
            <span className="ml-1.5 text-[12px] font-medium tracking-normal text-attenue-texte">
              {unite}
            </span>
          )}
        </span>
        {/* UN SEUL DESSIN PAR CARTE, et seulement d'une serie reelle. */}
        {courbe ? (
          <Courbe points={courbe} ton={ton} />
        ) : barres ? (
          <Barres valeurs={barres} ton={ton} />
        ) : jauge != null && Number.isFinite(jauge) ? (
          <Jauge pct={jauge} ton={ton} />
        ) : null}
      </span>

      {precision && (
        <span className="text-[12px] leading-snug text-attenue-texte max-sm:line-clamp-2 sm:truncate">
          {precision}
        </span>
      )}
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

  /* DES CRANS DE STATUT, PAS DES COULEURS DE SERIE. Chaque etat a sa teinte
     et la garde partout ; « critique » est un rouge eclairci, « rupture » le
     rouge plein — la gravite se lit dans l'intensite, et le libelle l'ecrit. */
  const FOND: Record<TonStat, string> = {
    neutre: 'bg-attenue-texte/40',
    primaire: 'bg-primaire',
    succes: 'bg-succes',
    alerte: 'bg-alerte',
    grave: 'bg-danger/55',
    danger: 'bg-danger',
  }
  const pct = (v: number) => {
    const x = (v / total) * 100
    return x > 0 && x < 1 ? '<1 %' : `${Math.round(x)} %`
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Un filet de fond de 2 px entre les segments : sans lui, deux teintes
          voisines se fondent en une seule longueur. */}
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface">
        {parts
          .filter((p) => p.valeur > 0)
          .map((p) => (
            <div
              key={p.libelle}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', FOND[p.ton])}
              style={{ width: `${(p.valeur / total) * 100}%` }}
              title={`${p.libelle} : ${p.valeur} (${pct(p.valeur)})`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span
            key={p.libelle}
            className="flex items-center gap-1.5 text-[11.5px] text-attenue-texte"
          >
            <span className={cn('size-2.5 shrink-0 rounded-[3px]', FOND[p.ton])} />
            {p.libelle}
            <span className="font-semibold tabular-nums text-texte">{p.valeur}</span>
            <span className="tabular-nums">{pct(p.valeur)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

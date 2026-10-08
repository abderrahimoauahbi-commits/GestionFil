/**
 * Les graphiques du tableau de bord (06/10/2026).
 *
 * LE TRAIT DES GRAPHIQUES « DARK MODE CHART » demandes par la direction : des
 * AIRES EN DEGRADE sous des lignes lumineuses, des COLONNES EN DEGRADE
 * vertical aux angles arrondis, des barres de palmares en degrade, un anneau
 * en degrade, des grilles en pointilles discrets, une infobulle qui suit le
 * pointeur. Dessines en SVG a la largeur de leur bloc : nets a toute taille.
 *
 * LES COULEURS SUIVENT LES REGLAGES : la serie 1 est le debut de la palette
 * choisie (`--pal-1`, a defaut l'accent du style), la serie 2 sa fin
 * (`--pal-2`, a defaut un violet). Les etats gardent leurs jetons.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

/** Les couleurs des series, dans l'ordre. Etats a part (voir `TON`). */
export const SERIES = [
  'var(--pal-1, hsl(var(--primaire)))',
  'var(--pal-2, #8B5CF6)',
  'hsl(var(--succes))',
  'hsl(var(--alerte))',
  'hsl(var(--info))',
  'hsl(var(--attenue-texte))',
]
export const TON = {
  succes: 'hsl(var(--succes))',
  alerte: 'hsl(var(--alerte))',
  danger: 'hsl(var(--danger))',
  neutre: 'hsl(var(--attenue-texte))',
  primaire: 'var(--pal-1, hsl(var(--primaire)))',
  secondaire: 'var(--pal-2, #8B5CF6)',
}

/* -------------------------------------------------------------------------- */
/* Outils                                                                      */
/* -------------------------------------------------------------------------- */

function useLargeur<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [l, setL] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const o = new ResizeObserver(([e]) => setL(Math.max(240, Math.floor(e.contentRect.width))))
    o.observe(ref.current)
    return () => o.disconnect()
  }, [])
  return [ref, l] as const
}

/** Graduations « rondes » : 0, 250, 500… plutot que 0, 237, 474. */
function graduations(max: number, n = 4) {
  if (max <= 0) return [0, 1]
  const brut = max / n
  const p = 10 ** Math.floor(Math.log10(brut))
  const pas = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= brut) ?? brut
  const fin = Math.ceil(max / pas) * pas
  const t: number[] = []
  for (let v = 0; v <= fin + pas / 2; v += pas) t.push(v)
  return t
}

/** 12 400 000 -> « 12,4 M » ; 8 450 -> « 8,5 k ». */
export function compact(v: number) {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
  return v.toLocaleString('fr-FR', { maximumFractionDigits: a < 10 ? 1 : 0 })
}

/** Une courbe lissee qui ne depasse pas les points. */
function chemin(points: [number, number][]) {
  if (!points.length) return ''
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    const mx = (x0 + x1) / 2
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`
  }
  return d
}

/** Un rectangle aux angles du HAUT arrondis (colonne posee sur l'axe). */
function colonne(x: number, y: number, l: number, h: number, r: number) {
  if (h <= 0) return ''
  const rr = Math.min(r, l / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + l - rr} Q${x + l},${y} ${x + l},${y + rr} V${y + h} Z`
}

/** Les degrades d'une serie : vertical (colonnes), d'aire (courbes), et la lueur. */
function Degrades({ id, couleurs }: { id: string; couleurs: string[] }) {
  return (
    <defs>
      {couleurs.map((c, i) => (
        <g key={i}>
          <linearGradient id={`${id}-col-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: c, stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: c, stopOpacity: 0.28 }} />
          </linearGradient>
          <linearGradient id={`${id}-aire-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: c, stopOpacity: 0.45 }} />
            <stop offset="70%" style={{ stopColor: c, stopOpacity: 0.08 }} />
            <stop offset="100%" style={{ stopColor: c, stopOpacity: 0 }} />
          </linearGradient>
        </g>
      ))}
      <filter id={`${id}-lueur`} x="-20%" y="-50%" width="140%" height="200%">
        <feGaussianBlur stdDeviation="3.5" result="flou" />
        <feMerge>
          <feMergeNode in="flou" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}

export interface SerieTemps {
  cle: string
  libelle: string
  valeurs: number[]
  couleur?: string
}

function Legende({ series }: { series: { libelle: string; couleur: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-attenue-texte">
      {series.map((s) => (
        <span key={s.libelle} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3.5 rounded-full" style={{ background: s.couleur }} />
          {s.libelle}
        </span>
      ))}
    </div>
  )
}

function Bulle({
  x,
  titre,
  lignes,
  largeur,
}: {
  x: number
  titre: string
  lignes: { libelle: string; couleur: string; valeur: string }[]
  largeur: number
}) {
  const aGauche = x > largeur * 0.6
  return (
    <div
      className="pointer-events-none absolute top-6 z-10 min-w-40 rounded-[10px] border border-bordure bg-surface/95 px-3 py-2 text-[11px] shadow-[var(--ombre-flottante)] backdrop-blur"
      style={aGauche ? { right: largeur - x + 12 } : { left: x + 12 }}
    >
      <div className="mb-1.5 font-medium text-texte">{titre}</div>
      {lignes.map((l) => (
        <div key={l.libelle} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-attenue-texte">
            <span className="size-2 rounded-full" style={{ background: l.couleur, boxShadow: `0 0 6px ${l.couleur}` }} />
            {l.libelle}
          </span>
          <span className="tabular-nums font-medium text-texte">{l.valeur}</span>
        </div>
      ))}
    </div>
  )
}

const AXE = 'hsl(var(--attenue-texte))'
const GRILLE = 'hsl(var(--bordure))'
const nombre = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

/* -------------------------------------------------------------------------- */
/* Aires et courbes dans le temps                                              */
/* -------------------------------------------------------------------------- */

export function CourbesTemps({
  libelles,
  series,
  unite = '',
  hauteur = 220,
  aire = true,
}: {
  libelles: string[]
  series: SerieTemps[]
  unite?: string
  hauteur?: number
  aire?: boolean
}) {
  const [ref, largeur] = useLargeur<HTMLDivElement>()
  const id = useId().replace(/:/g, '')
  const [survol, setSurvol] = useState<number | null>(null)
  const g = { haut: 12, bas: 24, gauche: 44, droite: 10 }
  const max = Math.max(1, ...series.flatMap((s) => s.valeurs))
  const ticks = graduations(max)
  const fin = ticks[ticks.length - 1]
  const n = libelles.length
  const lx = largeur - g.gauche - g.droite
  const ly = hauteur - g.haut - g.bas
  const X = (i: number) => g.gauche + (n <= 1 ? lx / 2 : (i * lx) / (n - 1))
  const Y = (v: number) => g.haut + ly - (v / fin) * ly
  const pasLibelle = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(lx / 64))))
  const couleurs = series.map((s, i) => s.couleur ?? SERIES[i % SERIES.length])

  return (
    <div ref={ref} className="relative space-y-2">
      {series.length > 1 && <Legende series={series.map((s, i) => ({ libelle: s.libelle, couleur: couleurs[i] }))} />}
      <svg
        width={largeur}
        height={hauteur}
        className="block overflow-visible"
        onMouseLeave={() => setSurvol(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left - g.gauche) / lx) * (n - 1))
          setSurvol(i >= 0 && i < n ? i : null)
        }}
      >
        <Degrades id={id} couleurs={couleurs} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={g.gauche} x2={largeur - g.droite} y1={Y(t)} y2={Y(t)} stroke={GRILLE} strokeDasharray="2 5" />
            <text x={g.gauche - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill={AXE}>
              {compact(t)}
            </text>
          </g>
        ))}
        {libelles.map((l, i) =>
          i % pasLibelle === 0 || i === n - 1 ? (
            <text key={i} x={X(i)} y={hauteur - 6} textAnchor="middle" fontSize={10} fill={AXE}>
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, i) => {
          const pts = s.valeurs.map((v, j) => [X(j), Y(v)] as [number, number])
          const d = chemin(pts)
          return (
            <g key={s.cle}>
              {aire && pts.length > 1 && (
                <path d={`${d} L${pts[pts.length - 1][0]},${Y(0)} L${pts[0][0]},${Y(0)} Z`} fill={`url(#${id}-aire-${i})`} />
              )}
              <path d={d} fill="none" style={{ stroke: couleurs[i] }} strokeWidth={2.2} strokeLinecap="round" filter={`url(#${id}-lueur)`} />
            </g>
          )
        })}
        {survol != null && (
          <g>
            <line x1={X(survol)} x2={X(survol)} y1={g.haut} y2={g.haut + ly} stroke={AXE} strokeOpacity={0.4} strokeDasharray="3 3" />
            {series.map((s, i) => (
              <circle key={s.cle} cx={X(survol)} cy={Y(s.valeurs[survol] ?? 0)} r={4} fill="hsl(var(--surface))" style={{ stroke: couleurs[i] }} strokeWidth={2.2} />
            ))}
          </g>
        )}
      </svg>
      {survol != null && (
        <Bulle
          x={X(survol)}
          largeur={largeur}
          titre={libelles[survol]}
          lignes={series.map((s, i) => ({
            libelle: s.libelle,
            couleur: couleurs[i],
            valeur: `${nombre(s.valeurs[survol] ?? 0)}${unite ? ' ' + unite : ''}`,
          }))}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Colonnes groupees ou empilees, en degrade                                   */
/* -------------------------------------------------------------------------- */

export function Colonnes({
  libelles,
  series,
  unite = '',
  hauteur = 220,
  empilees = false,
}: {
  libelles: string[]
  series: SerieTemps[]
  unite?: string
  hauteur?: number
  empilees?: boolean
}) {
  const [ref, largeur] = useLargeur<HTMLDivElement>()
  const id = useId().replace(/:/g, '')
  const [survol, setSurvol] = useState<number | null>(null)
  const g = { haut: 12, bas: 24, gauche: 44, droite: 10 }
  const n = libelles.length
  const totaux = libelles.map((_, i) => series.reduce((s, x) => s + (x.valeurs[i] ?? 0), 0))
  const max = Math.max(1, ...(empilees ? totaux : series.flatMap((s) => s.valeurs)))
  const ticks = graduations(max)
  const fin = ticks[ticks.length - 1]
  const lx = largeur - g.gauche - g.droite
  const ly = hauteur - g.haut - g.bas
  const bande = lx / Math.max(n, 1)
  const larg = Math.min(46, bande * 0.62)
  const Y = (v: number) => g.haut + ly - (v / fin) * ly
  const couleurs = series.map((s, i) => s.couleur ?? SERIES[i % SERIES.length])
  const pasLibelle = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(lx / 56))))

  return (
    <div ref={ref} className="relative space-y-2">
      {series.length > 1 && <Legende series={series.map((s, i) => ({ libelle: s.libelle, couleur: couleurs[i] }))} />}
      <svg width={largeur} height={hauteur} className="block" onMouseLeave={() => setSurvol(null)}>
        <Degrades id={id} couleurs={couleurs} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={g.gauche} x2={largeur - g.droite} y1={Y(t)} y2={Y(t)} stroke={GRILLE} strokeDasharray="2 5" />
            <text x={g.gauche - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill={AXE}>
              {compact(t)}
            </text>
          </g>
        ))}
        {libelles.map((l, i) => {
          const x0 = g.gauche + i * bande + (bande - larg) / 2
          const hauts = series.map((s) => s.valeurs[i] ?? 0)
          const dernier = hauts.reduce((m, v, k) => (v > 0 ? k : m), -1)
          let cumul = 0
          return (
            <g key={i} onMouseEnter={() => setSurvol(i)}>
              <rect x={g.gauche + i * bande} y={g.haut} width={bande} height={ly} rx={6} fill={survol === i ? 'hsl(var(--attenue))' : 'transparent'} />
              {series.map((s, k) => {
                const v = hauts[k]
                if (empilees) {
                  const y = Y(cumul + v)
                  const h = Y(cumul) - y
                  cumul += v
                  return k === dernier ? (
                    <path key={s.cle} d={colonne(x0, y, larg, Math.max(0, h), 5)} fill={`url(#${id}-col-${k})`} />
                  ) : (
                    <rect key={s.cle} x={x0} y={y} width={larg} height={Math.max(0, h)} fill={`url(#${id}-col-${k})`} />
                  )
                }
                const w = larg / series.length
                return <path key={s.cle} d={colonne(x0 + k * w, Y(v), Math.max(2, w - 3), Math.max(0, Y(0) - Y(v)), 5)} fill={`url(#${id}-col-${k})`} />
              })}
              {(i % pasLibelle === 0 || i === n - 1) && (
                <text x={g.gauche + i * bande + bande / 2} y={hauteur - 6} textAnchor="middle" fontSize={10} fill={AXE}>
                  {l}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {survol != null && (
        <Bulle
          x={g.gauche + survol * bande + bande / 2}
          largeur={largeur}
          titre={libelles[survol]}
          lignes={series.map((s, i) => ({
            libelle: s.libelle,
            couleur: couleurs[i],
            valeur: `${nombre(s.valeurs[survol] ?? 0)}${unite ? ' ' + unite : ''}`,
          }))}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Pareto : colonnes en degrade et courbe du cumul                             */
/* -------------------------------------------------------------------------- */

export function ParetoDegrade({
  donnees,
  unite = 'MAD',
  hauteur = 240,
}: {
  donnees: { cle: string; libelle: string; valeur: number; cumulPct: number; classe?: string | null }[]
  unite?: string
  hauteur?: number
}) {
  const [ref, largeur] = useLargeur<HTMLDivElement>()
  const id = useId().replace(/:/g, '')
  const [survol, setSurvol] = useState<number | null>(null)
  const g = { haut: 12, bas: 12, gauche: 44, droite: 38 }
  const n = donnees.length
  const max = Math.max(1, ...donnees.map((d) => d.valeur))
  const ticks = graduations(max)
  const fin = ticks[ticks.length - 1]
  const lx = largeur - g.gauche - g.droite
  const ly = hauteur - g.haut - g.bas
  const bande = lx / Math.max(n, 1)
  const larg = Math.max(3, Math.min(26, bande * 0.7))
  const Y = (v: number) => g.haut + ly - (v / fin) * ly
  const Yp = (p: number) => g.haut + ly - (p / 100) * ly
  const Xc = (i: number) => g.gauche + i * bande + bande / 2
  const rangClasse = (c?: string | null) => (c === 'A' ? 0 : c === 'B' ? 1 : 2)
  const couleurs = [TON.primaire, TON.secondaire, TON.neutre]
  const ligne = chemin(donnees.map((d, i) => [Xc(i), Yp(d.cumulPct)] as [number, number]))

  return (
    <div ref={ref} className="relative space-y-2">
      <Legende
        series={[
          { libelle: 'Classe A', couleur: couleurs[0] },
          { libelle: 'Classe B', couleur: couleurs[1] },
          { libelle: 'Classe C', couleur: couleurs[2] },
          { libelle: 'Cumul %', couleur: TON.alerte },
        ]}
      />
      <svg width={largeur} height={hauteur} className="block overflow-visible" onMouseLeave={() => setSurvol(null)}>
        <Degrades id={id} couleurs={couleurs} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={g.gauche} x2={largeur - g.droite} y1={Y(t)} y2={Y(t)} stroke={GRILLE} strokeDasharray="2 5" />
            <text x={g.gauche - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill={AXE}>
              {compact(t)}
            </text>
          </g>
        ))}
        {[0, 50, 80, 100].map((p) => (
          <text key={p} x={largeur - g.droite + 6} y={Yp(p) + 3.5} fontSize={10} style={{ fill: p === 80 ? TON.alerte : AXE }}>
            {p} %
          </text>
        ))}
        <line x1={g.gauche} x2={largeur - g.droite} y1={Yp(80)} y2={Yp(80)} style={{ stroke: TON.alerte }} strokeOpacity={0.5} strokeDasharray="4 4" />
        {donnees.map((d, i) => (
          <g key={d.cle} onMouseEnter={() => setSurvol(i)}>
            <rect x={g.gauche + i * bande} y={g.haut} width={bande} height={ly} fill={survol === i ? 'hsl(var(--attenue))' : 'transparent'} />
            <path d={colonne(Xc(i) - larg / 2, Y(d.valeur), larg, Math.max(0, Y(0) - Y(d.valeur)), 4)} fill={`url(#${id}-col-${rangClasse(d.classe)})`} />
          </g>
        ))}
        <path d={ligne} fill="none" style={{ stroke: TON.alerte }} strokeWidth={2} filter={`url(#${id}-lueur)`} />
      </svg>
      {survol != null && (
        <Bulle
          x={Xc(survol)}
          largeur={largeur}
          titre={donnees[survol].libelle}
          lignes={[
            { libelle: 'Consommation', couleur: couleurs[rangClasse(donnees[survol].classe)], valeur: `${nombre(donnees[survol].valeur)} ${unite}` },
            { libelle: 'Cumul', couleur: TON.alerte, valeur: `${donnees[survol].cumulPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` },
          ]}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Anneau en degrade                                                           */
/* -------------------------------------------------------------------------- */

export interface Part {
  libelle: string
  valeur: number
  couleur?: string
}

export function Anneau({
  parts,
  centre,
  sousCentre,
  taille = 168,
  format = (v: number) => v.toLocaleString('fr-FR'),
}: {
  parts: Part[]
  centre?: string
  sousCentre?: string
  taille?: number
  format?: (v: number) => string
}) {
  const id = useId().replace(/:/g, '')
  const total = parts.reduce((s, p) => s + p.valeur, 0) || 1
  const r = taille / 2 - 12
  const C = 2 * Math.PI * r
  const [survol, setSurvol] = useState<number | null>(null)
  const couleurs = parts.map((p, i) => p.couleur ?? SERIES[i % SERIES.length])
  const arcs = parts.map((p) => (p.valeur / total) * C)
  const departs = arcs.map((_, i) => arcs.slice(0, i).reduce((s, x) => s + x, 0))
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={taille} height={taille} className="shrink-0 -rotate-90 overflow-visible">
        <defs>
          {couleurs.map((c, i) => (
            <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: c, stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: c, stopOpacity: 0.55 }} />
            </linearGradient>
          ))}
          <filter id={`${id}-lueur`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="f" />
            <feMerge>
              <feMergeNode in="f" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={taille / 2} cy={taille / 2} r={r} fill="none" stroke="hsl(var(--attenue))" strokeWidth={14} />
        {parts.map((p, i) => (
          <circle
            key={p.libelle}
            cx={taille / 2}
            cy={taille / 2}
            r={r}
            fill="none"
            stroke={`url(#${id}-${i})`}
            strokeWidth={survol === i ? 19 : 14}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, arcs[i] - 4)} ${C}`}
            strokeDashoffset={-departs[i] - 2}
            filter={survol === i ? `url(#${id}-lueur)` : undefined}
            onMouseEnter={() => setSurvol(i)}
            onMouseLeave={() => setSurvol(null)}
            style={{ transition: 'stroke-width 120ms ease' }}
          />
        ))}
        <g className="rotate-90" style={{ transformOrigin: 'center' }}>
          <text x="50%" y="48%" textAnchor="middle" fontSize={19} fontWeight={600} fill="hsl(var(--texte))">
            {survol != null ? format(parts[survol].valeur) : centre}
          </text>
          <text x="50%" y="60%" textAnchor="middle" fontSize={10} fill={AXE}>
            {survol != null ? parts[survol].libelle : sousCentre}
          </text>
        </g>
      </svg>
      <ul className="min-w-[11rem] flex-1 space-y-1.5 text-[12px]">
        {parts.map((p, i) => (
          <li
            key={p.libelle}
            className={cn('flex items-center gap-2 rounded px-1', survol === i && 'bg-attenue')}
            onMouseEnter={() => setSurvol(i)}
            onMouseLeave={() => setSurvol(null)}
          >
            <span className="h-2 w-3.5 shrink-0 rounded-full" style={{ background: couleurs[i] }} />
            <span className="min-w-0 flex-1 truncate text-attenue-texte">{p.libelle}</span>
            <span className="tabular-nums text-texte">{format(p.valeur)}</span>
            <span className="w-10 text-right tabular-nums text-attenue-texte">{Math.round((p.valeur / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Barres classees en degrade : un palmares                                    */
/* -------------------------------------------------------------------------- */

export interface Rang {
  cle: string
  libelle: string
  valeur: number
  detail?: string
  couleur?: string
}

export function BarresClassees({
  donnees,
  format = compact,
  max: maxImpose,
}: {
  donnees: Rang[]
  format?: (v: number) => string
  max?: number
}) {
  const max = maxImpose ?? Math.max(1, ...donnees.map((d) => Math.abs(d.valeur)))
  return (
    <ul className="space-y-3">
      {donnees.map((d) => (
        <li key={d.cle} className="text-[12px]">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-texte" title={d.libelle}>
              {d.libelle}
              {d.detail && <span className="ml-2 text-[11px] text-attenue-texte">{d.detail}</span>}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-texte">{format(d.valeur)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-attenue">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(Math.abs(d.valeur) / max) * 100}%`,
                background: d.couleur ?? `linear-gradient(90deg, ${SERIES[0]}, ${SERIES[1]})`,
                boxShadow: `0 0 10px -2px ${d.couleur ?? SERIES[1]}`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Jauge                                                                       */
/* -------------------------------------------------------------------------- */

export function Jauge({ valeur, objectif, libelle, taille = 150 }: { valeur: number | null; objectif?: number; libelle: string; taille?: number }) {
  const id = useId().replace(/:/g, '')
  const r = taille / 2 - 12
  const demi = Math.PI * r
  const v = Math.max(0, Math.min(100, valeur ?? 0))
  const couleur = valeur == null ? TON.neutre : objectif == null || v >= objectif ? TON.succes : v >= objectif * 0.85 ? TON.alerte : TON.danger
  const arc = `M ${12} ${taille / 2} A ${r} ${r} 0 0 1 ${taille - 12} ${taille / 2}`
  return (
    <div className="flex flex-col items-center">
      <svg width={taille} height={taille / 2 + 8}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: couleur, stopOpacity: 0.45 }} />
            <stop offset="100%" style={{ stopColor: couleur, stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke="hsl(var(--attenue))" strokeWidth={12} strokeLinecap="round" />
        <path d={arc} fill="none" stroke={`url(#${id})`} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(v / 100) * demi} ${demi}`} />
        <text x="50%" y={taille / 2 - 4} textAnchor="middle" fontSize={20} fontWeight={600} fill="hsl(var(--texte))">
          {valeur == null ? '—' : `${Math.round(v)} %`}
        </text>
      </svg>
      <div className="text-[11px] text-attenue-texte">
        {libelle}
        {objectif != null && <span> · objectif {objectif} %</span>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mini-courbe en aire, pour les chiffres cles                                  */
/* -------------------------------------------------------------------------- */

export function MiniCourbe({ valeurs, couleur = SERIES[0], largeur = 120, hauteur = 36 }: { valeurs: number[]; couleur?: string; largeur?: number; hauteur?: number }) {
  const id = useId().replace(/:/g, '')
  const pts = useMemo(() => {
    if (valeurs.length < 2) return [] as [number, number][]
    const min = Math.min(...valeurs)
    const max = Math.max(...valeurs)
    const e = max - min || 1
    return valeurs.map((v, i) => [(i / (valeurs.length - 1)) * largeur, hauteur - 3 - ((v - min) / e) * (hauteur - 8)] as [number, number])
  }, [valeurs, largeur, hauteur])
  if (!pts.length) return null
  const d = chemin(pts)
  return (
    <svg width={largeur} height={hauteur} className="shrink-0 overflow-visible">
      <Degrades id={id} couleurs={[couleur]} />
      <path d={`${d} L${largeur},${hauteur} L0,${hauteur} Z`} fill={`url(#${id}-aire-0)`} />
      <path d={d} fill="none" style={{ stroke: couleur }} strokeWidth={1.8} filter={`url(#${id}-lueur)`} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.6} style={{ fill: couleur }} />
    </svg>
  )
}

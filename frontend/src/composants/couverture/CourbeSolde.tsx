/**
 * LA COURBE DU SOLDE PROJETÉ (SVG fait main, jetons du thème) : le solde du
 * moteur jour par jour, la ligne de sécurité, les arrivages comptés, la bande du
 * plan non couvert sous zéro, et D, la disponibilité de la première
 * proposition. En simulation, `comparaison` trace en pointillé le solde RÉEL,
 * pour voir l'écart de l'hypothèse d'un coup d'œil.
 */
import { useEffect, useRef, useState } from 'react'
import { dateCourte, kg, positif, type Jour, type Proposition } from './types'

// ============================================================================
// La courbe du solde projeté (SVG fait main, jetons du thème)
// ============================================================================

function useLargeur() {
  const ref = useRef<HTMLDivElement>(null)
  const [l, setL] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(([e]) => setL(Math.max(260, Math.floor(e.contentRect.width))))
    o.observe(el)
    return () => o.disconnect()
  }, [])
  return [ref, l] as const
}

/** Graduations rondes : 0, 2 000, 4 000… */
function graduations(max: number) {
  if (max <= 0) return [0]
  const brut = max / 3
  const p = 10 ** Math.floor(Math.log10(brut))
  const pas = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= brut) ?? brut
  const t: number[] = []
  for (let v = 0; v <= max + 1e-9; v += pas) t.push(v)
  return t
}

const compact = (v: number) =>
  Math.abs(v) >= 1000
    ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t`
    : v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

const COULEUR = {
  solde: 'hsl(var(--primaire))',
  securite: 'hsl(var(--alerte))',
  danger: 'hsl(var(--danger))',
  arrivage: 'hsl(var(--succes))',
  repere: 'hsl(var(--info))',
  grille: 'hsl(var(--ligne))',
  axe: 'hsl(var(--bordure))',
  texte: 'hsl(var(--attenue-texte))',
}

export function CourbeSolde({
  jours,
  propositions,
  comparaison,
}: {
  jours: Jour[]
  propositions: Proposition[]
  /** Le solde réel, tracé en pointillé derrière celui de la simulation. */
  comparaison?: Jour[]
}) {
  const [ref, largeur] = useLargeur()
  const [survol, setSurvol] = useState<number | null>(null)
  const n = jours.length
  const H = 210
  const M = { g: 44, d: 8, h: 10, b: 22 }
  const bande = 22 // la zone sous zéro : les jours où le plan n'est pas couvert
  const hUtile = H - M.h - M.b - bande
  const maxBrut = Math.max(
    1,
    ...jours.map((j) => Math.max(j.solde_kg, j.securite_kg)),
    ...(comparaison ?? []).map((j) => j.solde_kg),
  )
  const ticks = graduations(maxBrut * 1.05)
  const max = ticks[ticks.length - 1] || 1
  const x = (i: number) => M.g + ((largeur - M.g - M.d) * i) / Math.max(1, n - 1)
  const y = (v: number) => M.h + hUtile * (1 - v / max)
  const y0 = y(0)
  const pas = (largeur - M.g - M.d) / Math.max(1, n - 1)

  const chemin = (v: (j: Jour) => number) =>
    jours.map((j, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v(j)).toFixed(1)}`).join(' ')
  const aire = `${chemin((j) => j.solde_kg)} L${x(n - 1).toFixed(1)},${y0} L${x(0).toFixed(1)},${y0} Z`

  // Les séries de jours où le plan n'est pas couvert, et ce qu'elles perdent.
  const zones: { debut: number; fin: number; kg: number }[] = []
  jours.forEach((j, i) => {
    if (j.plan_non_couvert_kg <= 0.0001) return
    const z = zones[zones.length - 1]
    if (z && z.fin === i - 1) {
      z.fin = i
      z.kg += j.plan_non_couvert_kg
    } else zones.push({ debut: i, fin: i, kg: j.plan_non_couvert_kg })
  })
  const totalNonCouvert = zones.reduce((s, z) => s + z.kg, 0)

  // Les débuts de mois, en abscisse (un sur deux s'ils se serrent).
  const mois = jours
    .map((j, i) => ({ i, j }))
    .filter(({ j, i }) => i === 0 || j.date.endsWith('-01'))
  const ecartMois = mois.length > 1 ? x(mois[1].i) - x(mois[0].i) : largeur
  const sautMois = ecartMois < 34 ? 2 : 1
  const nomMois = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })

  const indexDe = (date: string) => jours.findIndex((j) => j.date === date)
  const p1 = propositions[0]
  const iD = p1 ? indexDe(p1.date_disponibilite) : -1

  const j = survol != null ? jours[survol] : null
  const description =
    `Solde projeté de ${kg(jours[0].solde_kg)} kg aujourd’hui à ${kg(jours[n - 1].solde_kg)} kg en fin d’horizon` +
    (totalNonCouvert > 0 ? `, plan non couvert ${kg(totalNonCouvert)} kg` : '')

  return (
    <div ref={ref} className="relative w-full">
      <svg
        viewBox={`0 0 ${largeur} ${H}`}
        preserveAspectRatio="none"
        height={H}
        role="img"
        aria-label={description}
        className="block w-full touch-none select-none"
        onPointerLeave={() => setSurvol(null)}
        onPointerMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          const i = Math.round((e.clientX - b.left - M.g) / pas)
          setSurvol(i >= 0 && i < n ? i : null)
        }}
      >
        {/* Grille et axe des kilos */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.g} x2={largeur - M.d} y1={y(t)} y2={y(t)} stroke={t === 0 ? COULEUR.axe : COULEUR.grille} strokeWidth={t === 0 ? 1.2 : 1} strokeDasharray={t === 0 ? undefined : '2 3'} />
            <text x={M.g - 5} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={COULEUR.texte}>
              {compact(t)}
            </text>
          </g>
        ))}
        <text x={M.g - 5} y={y0 + bande / 2 + 3.5} textAnchor="end" fontSize="10" fill={COULEUR.danger}>
          &lt; 0
        </text>

        {/* La zone sous zéro : plan non couvert */}
        {zones.map((z) => (
          <rect
            key={z.debut}
            x={x(z.debut) - pas / 2}
            y={y0}
            width={Math.max(2, x(z.fin) - x(z.debut) + pas)}
            height={bande}
            fill={COULEUR.danger}
            fillOpacity={0.28}
          >
            <title>
              {`Plan non couvert du ${dateCourte(jours[z.debut].date)} au ${dateCourte(jours[z.fin].date)} : ${kg(z.kg)} kg`}
            </title>
          </rect>
        ))}

        {/* Solde et sécurité */}
        <path d={aire} fill={COULEUR.solde} fillOpacity={0.1} />
        <path d={chemin((j) => j.securite_kg)} fill="none" stroke={COULEUR.securite} strokeWidth={1.3} strokeDasharray="5 3" />
        {comparaison && comparaison.length === n && (
          <path
            d={comparaison.map((j, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(j.solde_kg).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={COULEUR.texte}
            strokeWidth={1.2}
            strokeDasharray="2 3"
          />
        )}
        <path d={chemin((j) => j.solde_kg)} fill="none" stroke={COULEUR.solde} strokeWidth={1.8} strokeLinejoin="round" />

        {/* Les arrivages qui remontent le solde */}
        {jours.map((jj, i) =>
          jj.arrivee_kg > 0.0001 ? (
            <path
              key={jj.date}
              d={`M${x(i)},${y(jj.solde_kg) - 9} l-4.5,7 h9 Z`}
              fill={COULEUR.arrivage}
            >
              <title>{`Arrivage le ${dateCourte(jj.date)} : ${kg(jj.arrivee_kg)} kg`}</title>
            </path>
          ) : null,
        )}

        {/* D de la première proposition */}
        {iD >= 0 && (
          <g>
            <line x1={x(iD)} x2={x(iD)} y1={M.h} y2={y0 + bande} stroke={COULEUR.repere} strokeWidth={1} strokeDasharray="3 3" />
            <text x={x(iD) + 3} y={M.h + 9} fontSize="10" fill={COULEUR.repere}>
              D
            </text>
          </g>
        )}

        {/* Les mois */}
        {mois.map(({ i, j: jj }, k) =>
          k % sautMois === 0 ? (
            <text key={jj.date} x={x(i)} y={H - 6} fontSize="10" textAnchor={i === 0 ? 'start' : 'middle'} fill={COULEUR.texte}>
              {nomMois(jj.date)}
            </text>
          ) : null,
        )}

        {/* Le jour survolé */}
        {j && survol != null && (
          <g pointerEvents="none">
            <line x1={x(survol)} x2={x(survol)} y1={M.h} y2={y0 + bande} stroke={COULEUR.texte} strokeWidth={0.8} />
            <circle cx={x(survol)} cy={y(j.solde_kg)} r={3} fill={COULEUR.solde} />
          </g>
        )}
      </svg>

      {j && survol != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-[var(--radius-sm)] border border-bordure bg-surface px-2 py-1 text-[11px] leading-snug shadow-[var(--ombre-pose)]"
          style={x(survol) > largeur / 2 ? { right: largeur - x(survol) + 8 } : { left: x(survol) + 8 }}
        >
          <div className="font-semibold tabular-nums">{dateCourte(j.date)}</div>
          <div className="tabular-nums">solde {kg(j.solde_kg)} kg</div>
          <div className="tabular-nums text-attenue-texte">sécurité {kg(j.securite_kg)} kg</div>
          {positif(j.conso_prevue_kg) && <div className="tabular-nums text-attenue-texte">besoin planifié {kg(j.conso_prevue_kg)} kg</div>}
          {positif(j.arrivee_kg) && <div className="tabular-nums text-succes">arrivage + {kg(j.arrivee_kg)} kg</div>}
          {positif(j.plan_non_couvert_kg) && <div className="tabular-nums text-danger">plan non couvert {kg(j.plan_non_couvert_kg)} kg</div>}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: COULEUR.solde }} /> solde projeté
          {comparaison ? ' (simulé)' : ''}
        </span>
        {comparaison && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dotted" style={{ borderColor: COULEUR.texte }} /> solde réel
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COULEUR.securite }} /> sécurité
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5" style={{ background: COULEUR.arrivage, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} /> arrivage compté
        </span>
        {iD >= 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 border-l border-dashed" style={{ borderColor: COULEUR.repere }} /> D, disponibilité de la 1re proposition
          </span>
        )}
        {totalNonCouvert > 0 && (
          <span className="inline-flex items-center gap-1.5 text-danger">
            <span className="inline-block h-2.5 w-4" style={{ background: COULEUR.danger, opacity: 0.35 }} /> plan non couvert à
            partir du {dateCourte(jours[zones[0].debut].date)} : {kg(totalNonCouvert)} kg sur l’horizon
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Pareto de concentration.
 *
 * Repond a « combien de references portent l'essentiel de la valeur ». La
 * courbe est **cumulee**, et c'est tout : pas de barres individuelles sous la
 * courbe.
 *
 * Ce choix est deliberatement contraire au Pareto de manuel. Le Pareto
 * classique superpose des barres (part de chacun) et une courbe (cumul) sur
 * **deux echelles differentes** — l'erreur de lecture la plus repandue en
 * gestion : on croit lire un croisement qui n'existe pas, parce que les deux
 * axes n'ont aucun rapport. Une seule echelle, en pourcentage cumule, dit la
 * meme chose sans mentir.
 *
 * Les coupures 80 % et 95 % sont tracees : ce sont les seuils qui definissent
 * les classes A, B et C dans les parametres du systeme.
 */
import { useMemo, useState } from 'react'
import { Table2, BarChart3 } from 'lucide-react'
import './graphiques.css'

export interface PointPareto {
  cle: string
  libelle: string
  valeur: number
}

export function Pareto({
  titre,
  sousTitre,
  unite,
  donnees,
  seuilA = 80,
  seuilB = 95,
  action,
}: {
  titre: string
  sousTitre?: string
  unite?: string
  donnees: PointPareto[]
  seuilA?: number
  seuilB?: number
  /** Action proposee sous le graphique (ex. lancer la classification). */
  action?: React.ReactNode
}) {
  const [tableau, setTableau] = useState(false)

  const calcul = useMemo(() => {
    const triees = [...donnees].filter((d) => d.valeur > 0).sort((a, b) => b.valeur - a.valeur)
    const total = triees.reduce((s, d) => s + d.valeur, 0)
    if (!total) return null

    let cumul = 0
    const points = triees.map((d, i) => {
      cumul += d.valeur
      return {
        ...d,
        rang: i + 1,
        partRang: ((i + 1) / triees.length) * 100,
        partCumulee: (cumul / total) * 100,
      }
    })

    const rangA = points.find((p) => p.partCumulee >= seuilA)?.rang ?? points.length
    const rangB = points.find((p) => p.partCumulee >= seuilB)?.rang ?? points.length
    return { points, total, rangA, rangB, nb: triees.length }
  }, [donnees, seuilA, seuilB])

  if (!calcul) {
    return (
      <figure className="viz m-0 rounded-[var(--radius)] border border-bordure bg-surface p-3">
        <h3 className="text-[13px] font-semibold text-texte">{titre}</h3>
        <p className="mt-2 text-[12px] text-attenue-texte">
          Aucune valeur a repartir : la concentration se calcule sur des montants valorises, et
          aucun n'est encore disponible.
        </p>
      </figure>
    )
  }

  const { points, rangA, rangB, nb } = calcul

  /* Courbe en coordonnees 0-100 sur les deux axes : x = part des references,
     y = part cumulee de la valeur. Une seule echelle, lisible telle quelle. */
  const chemin = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.partRang.toFixed(2)} ${(100 - p.partCumulee).toFixed(2)}`)
    .join(' ')

  const xA = (rangA / nb) * 100
  const xB = (rangB / nb) * 100

  return (
    <figure className="viz m-0 flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3">
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-texte">{titre}</h3>
          {sousTitre && <p className="truncate text-[11px] text-attenue-texte">{sousTitre}</p>}
        </div>
        <button
          type="button"
          onClick={() => setTableau((t) => !t)}
          aria-pressed={tableau}
          title={tableau ? 'Voir la courbe' : 'Voir les valeurs'}
          className="grid size-6 shrink-0 place-items-center rounded-[3px] text-attenue-texte
                     hover:bg-attenue hover:text-texte"
        >
          {tableau ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
        </button>
      </figcaption>

      {/* Le fait saillant, en clair : c'est lui qu'on retient, pas la courbe. */}
      <p className="text-[12px] text-texte">
        <strong className="text-[15px] tabular-nums">{rangA}</strong> reference
        {rangA > 1 ? 's' : ''} sur {nb} portent {seuilA} % de la valeur
        <span className="text-attenue-texte">
          {' '}
          — soit {((rangA / nb) * 100).toFixed(0)} % du catalogue valorise.
        </span>
      </p>

      {tableau ? (
        <div className="defilement-x max-h-72 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th className="border-b border-bordure py-1 pr-3 text-left font-medium text-attenue-texte">
                  Rang
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-left font-medium text-attenue-texte">
                  Reference
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-right font-medium text-attenue-texte">
                  {unite ?? 'Valeur'}
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-right font-medium text-attenue-texte">
                  Cumul
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.cle} className="border-b border-ligne last:border-0">
                  <td className="py-1 pr-3 tabular-nums text-attenue-texte">{p.rang}</td>
                  <td className="py-1 pr-3 font-mono">{p.libelle}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {Math.round(p.valeur).toLocaleString('fr-FR')}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {p.partCumulee.toFixed(1)} %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-40 w-full"
            role="img"
            aria-label={`Courbe de concentration : ${rangA} references sur ${nb} portent ${seuilA} % de la valeur`}
          >
            {/* Grille horizontale aux coupures, recessive. */}
            {[seuilA, seuilB].map((s) => (
              <line
                key={s}
                x1="0"
                y1={100 - s}
                x2="100"
                y2={100 - s}
                className="grille-ligne"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="3 3"
              />
            ))}
            {/* Coupures verticales : frontieres des classes A et B. */}
            {[xA, xB].map((x, i) => (
              <line
                key={i}
                x1={x}
                y1="0"
                x2={x}
                y2="100"
                className="grille-ligne"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={chemin}
              fill="none"
              stroke="var(--viz-serie-1)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>

          <div className="flex justify-between text-[10px] text-attenue-texte">
            <span>
              Classe A : {rangA} ref. — {seuilA} %
            </span>
            <span>
              Classe B : jusqu'a {rangB} ref. — {seuilB} %
            </span>
            <span>Classe C : le reste</span>
          </div>
        </>
      )}

      {action}
    </figure>
  )
}

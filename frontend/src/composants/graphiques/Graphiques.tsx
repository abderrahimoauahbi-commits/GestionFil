/**
 * Graphiques de gestion.
 *
 * Trois formes seulement, choisies pour ce que les donnees ont a dire :
 *
 *   - `BarresRangees`  — comparer des grandeurs entre categories (cout par
 *                        qualite, conformite par fournisseur). Barres
 *                        horizontales triees : le nom se lit sans incliner la
 *                        tete, et le classement saute aux yeux.
 *   - `BarresEmpilees` — la meme comparaison, decomposee en trois parts au
 *                        plus. Au-dela de trois, l'oeil ne compare plus les
 *                        segments du milieu : il faut alors facetter.
 *   - `ColonnesTemps`  — une grandeur mois par mois. Le temps va de gauche a
 *                        droite, toujours en colonnes, jamais en barres
 *                        horizontales.
 *
 * Regles communes, tenues par le cadre et non laissees a l'appelant :
 * un seul axe de valeurs, jamais deux ; une legende des qu'il y a deux series ;
 * des etiquettes lisibles sur les valeurs saillantes ; et une vue tableau
 * toujours accessible — c'est elle qui rend le graphique utilisable quand la
 * couleur ne suffit pas (impression, vision des couleurs deficiente).
 */
import { useId, useMemo, useState } from 'react'
import { Table2, BarChart3 } from 'lucide-react'
import { cn } from '../../lib/utils'
import './graphiques.css'

/* -------------------------------------------------------------------------- */
/* Cadre commun                                                                */
/* -------------------------------------------------------------------------- */

export interface Serie {
  cle: string
  libelle: string
}

function Cadre({
  titre,
  sousTitre,
  series,
  vueTableau,
  basculer,
  children,
  tableau,
}: {
  titre: string
  sousTitre?: string
  series?: Serie[]
  vueTableau: boolean
  basculer: () => void
  children: React.ReactNode
  tableau: React.ReactNode
}) {
  return (
    <figure className="viz m-0 flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3">
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-texte">{titre}</h3>
          {sousTitre && (
            <p className="truncate text-[11px] text-attenue-texte">{sousTitre}</p>
          )}
        </div>
        <button
          type="button"
          onClick={basculer}
          aria-pressed={vueTableau}
          title={vueTableau ? 'Voir le graphique' : 'Voir les valeurs'}
          className="grid size-6 shrink-0 place-items-center rounded-[3px] text-attenue-texte
                     hover:bg-attenue hover:text-texte"
        >
          {vueTableau ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
        </button>
      </figcaption>

      {/* Legende : presente des deux series, absente pour une seule — le titre
          nomme deja la grandeur unique. */}
      {series && series.length >= 2 && !vueTableau && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s, i) => (
            <li key={s.cle} className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: `var(--viz-serie-${i + 1})` }}
              />
              {s.libelle}
            </li>
          ))}
        </ul>
      )}

      {vueTableau ? tableau : children}
    </figure>
  )
}

function TableauValeurs({
  entetes,
  lignes,
}: {
  entetes: string[]
  lignes: (string | number)[][]
}) {
  return (
    <div className="defilement-x max-h-72 overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {entetes.map((e, i) => (
              <th
                key={e}
                className={cn(
                  'border-b border-bordure py-1 pr-3 font-medium text-attenue-texte',
                  i === 0 ? 'text-left' : 'text-right',
                )}
              >
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-ligne last:border-0">
              {l.map((c, j) => (
                <td
                  key={j}
                  className={cn('py-1 pr-3', j === 0 ? 'text-texte' : 'text-right text-texte')}
                >
                  {typeof c === 'number' ? fmtNombre(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const fmtNombre = (v: number) =>
  v >= 1000 ? Math.round(v).toLocaleString('fr-FR') : v.toFixed(v < 10 ? 2 : 1)

/* -------------------------------------------------------------------------- */
/* Barres rangees — une grandeur, plusieurs categories                         */
/* -------------------------------------------------------------------------- */

export interface Barre {
  cle: string
  libelle: string
  valeur: number
  /** Etat metier : colore la barre en rouge / ambre / vert au lieu du bleu. */
  etat?: 'critique' | 'alerte' | 'bon'
}

export function BarresRangees({
  titre,
  sousTitre,
  unite,
  donnees,
  maximum = 12,
}: {
  titre: string
  sousTitre?: string
  unite?: string
  donnees: Barre[]
  /** Nombre de barres affichees. Le reste est annonce, jamais tronque en silence. */
  maximum?: number
}) {
  const [tableau, setTableau] = useState(false)

  const triees = useMemo(
    () => [...donnees].sort((a, b) => b.valeur - a.valeur),
    [donnees],
  )
  const visibles = triees.slice(0, maximum)
  const restantes = triees.length - visibles.length
  const echelle = Math.max(...visibles.map((d) => d.valeur), 0) || 1

  const teinte = (b: Barre) =>
    b.etat === 'critique'
      ? 'var(--viz-critique)'
      : b.etat === 'alerte'
        ? 'var(--viz-alerte)'
        : b.etat === 'bon'
          ? 'var(--viz-bon)'
          : 'var(--viz-serie-1)'

  return (
    <Cadre
      titre={titre}
      sousTitre={
        restantes > 0
          ? `${sousTitre ? sousTitre + ' · ' : ''}${visibles.length} sur ${triees.length}, ${restantes} non affichee${restantes > 1 ? 's' : ''}`
          : sousTitre
      }
      vueTableau={tableau}
      basculer={() => setTableau((t) => !t)}
      tableau={
        <TableauValeurs
          entetes={['Libelle', unite ?? 'Valeur']}
          lignes={triees.map((d) => [d.libelle, d.valeur])}
        />
      }
    >
      <div className="flex flex-col gap-[3px]">
        {visibles.map((d) => (
          <div key={d.cle} className="rangee grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-2">
            <span className="truncate text-[11px] text-attenue-texte" title={d.libelle}>
              {d.libelle}
            </span>
            <div className="flex items-center gap-2">
              <div className="h-4 min-w-0 flex-1">
                <div
                  className="marque h-full rounded-r-[4px]"
                  style={{
                    width: `${Math.max((d.valeur / echelle) * 100, 0.8)}%`,
                    background: teinte(d),
                  }}
                  role="img"
                  aria-label={`${d.libelle} : ${fmtNombre(d.valeur)}${unite ? ' ' + unite : ''}`}
                />
              </div>
              {/* Etiquette directe : elle porte la valeur, ce qui rend le
                  graphique lisible sans dependre de la seule couleur. */}
              <span className="w-16 shrink-0 text-right text-[11px] text-texte">
                {fmtNombre(d.valeur)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {unite && <p className="text-right text-[10px] text-attenue-texte">{unite}</p>}
    </Cadre>
  )
}

/* -------------------------------------------------------------------------- */
/* Barres empilees — decomposition en trois parts au plus                      */
/* -------------------------------------------------------------------------- */

export interface BarreComposee {
  cle: string
  libelle: string
  parts: Record<string, number>
}

export function BarresEmpilees({
  titre,
  sousTitre,
  unite,
  series,
  donnees,
  maximum = 10,
}: {
  titre: string
  sousTitre?: string
  unite?: string
  /** Trois au plus : au-dela, les segments du milieu ne se comparent plus. */
  series: Serie[]
  donnees: BarreComposee[]
  maximum?: number
}) {
  const [tableau, setTableau] = useState(false)
  const retenues = series.slice(0, 3)

  const total = (d: BarreComposee) =>
    retenues.reduce((s, k) => s + (d.parts[k.cle] ?? 0), 0)

  const triees = useMemo(
    () => [...donnees].sort((a, b) => total(b) - total(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [donnees, series],
  )
  const visibles = triees.slice(0, maximum)
  const restantes = triees.length - visibles.length
  const echelle = Math.max(...visibles.map(total), 0) || 1

  return (
    <Cadre
      titre={titre}
      sousTitre={
        restantes > 0
          ? `${sousTitre ? sousTitre + ' · ' : ''}${restantes} non affichee${restantes > 1 ? 's' : ''}`
          : sousTitre
      }
      series={retenues}
      vueTableau={tableau}
      basculer={() => setTableau((t) => !t)}
      tableau={
        <TableauValeurs
          entetes={['Libelle', ...retenues.map((s) => s.libelle), 'Total']}
          lignes={triees.map((d) => [
            d.libelle,
            ...retenues.map((s) => d.parts[s.cle] ?? 0),
            total(d),
          ])}
        />
      }
    >
      <div className="flex flex-col gap-[3px]">
        {visibles.map((d) => (
          <div key={d.cle} className="rangee grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-2">
            <span className="truncate text-[11px] text-attenue-texte" title={d.libelle}>
              {d.libelle}
            </span>
            <div className="flex items-center gap-2">
              {/* Un filet de fond de 2 px separe les segments : sans lui, deux
                  parts voisines se lisent comme une seule. */}
              <div className="flex h-4 min-w-0 flex-1 gap-[2px]">
                {retenues.map((s, i) => {
                  const v = d.parts[s.cle] ?? 0
                  if (v <= 0) return null
                  return (
                    <div
                      key={s.cle}
                      className="marque h-full first:rounded-l-[2px] last:rounded-r-[4px]"
                      style={{
                        width: `${(v / echelle) * 100}%`,
                        background: `var(--viz-serie-${i + 1})`,
                      }}
                      title={`${s.libelle} : ${fmtNombre(v)}${unite ? ' ' + unite : ''}`}
                    />
                  )
                })}
              </div>
              <span className="w-16 shrink-0 text-right text-[11px] text-texte">
                {fmtNombre(total(d))}
              </span>
            </div>
          </div>
        ))}
      </div>
      {unite && <p className="text-right text-[10px] text-attenue-texte">{unite}</p>}
    </Cadre>
  )
}

/* -------------------------------------------------------------------------- */
/* Colonnes dans le temps                                                      */
/* -------------------------------------------------------------------------- */

export interface Colonne {
  cle: string
  /** Etiquette d'axe, courte : « 01 », « fev ». */
  libelle: string
  valeur: number
  etat?: 'critique' | 'alerte' | 'bon'
}

export function ColonnesTemps({
  titre,
  sousTitre,
  unite,
  donnees,
  hauteur = 132,
}: {
  titre: string
  sousTitre?: string
  unite?: string
  donnees: Colonne[]
  hauteur?: number
}) {
  const [tableau, setTableau] = useState(false)
  const id = useId()
  const echelle = Math.max(...donnees.map((d) => d.valeur), 0) || 1

  const teinte = (c: Colonne) =>
    c.etat === 'critique'
      ? 'var(--viz-critique)'
      : c.etat === 'alerte'
        ? 'var(--viz-alerte)'
        : c.etat === 'bon'
          ? 'var(--viz-bon)'
          : 'var(--viz-serie-1)'

  /* Etiquettes selectives : la plus haute et la derniere. Un nombre sur chaque
     colonne transforme le graphique en tableau mal range. */
  const iMax = donnees.reduce((m, d, i) => (d.valeur > donnees[m].valeur ? i : m), 0)

  return (
    <Cadre
      titre={titre}
      sousTitre={sousTitre}
      vueTableau={tableau}
      basculer={() => setTableau((t) => !t)}
      tableau={
        <TableauValeurs
          entetes={['Periode', unite ?? 'Valeur']}
          lignes={donnees.map((d) => [d.libelle, d.valeur])}
        />
      }
    >
      <div className="flex items-end gap-[3px]" style={{ height: hauteur }}>
        {donnees.map((d, i) => (
          <div
            key={d.cle}
            className="rangee group flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${d.libelle} : ${fmtNombre(d.valeur)}${unite ? ' ' + unite : ''}`}
          >
            {(i === iMax || i === donnees.length - 1) && (
              <span className="mb-0.5 truncate text-center text-[10px] text-texte">
                {fmtNombre(d.valeur)}
              </span>
            )}
            <div
              className="marque w-full rounded-t-[4px]"
              style={{
                height: `${Math.max((d.valeur / echelle) * 100, 1)}%`,
                background: teinte(d),
              }}
              role="img"
              aria-labelledby={`${id}-${i}`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] border-t border-bordure pt-1">
        {donnees.map((d, i) => (
          <span
            key={d.cle}
            id={`${id}-${i}`}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-attenue-texte"
          >
            {d.libelle}
          </span>
        ))}
      </div>
      {unite && <p className="text-right text-[10px] text-attenue-texte">{unite}</p>}
    </Cadre>
  )
}

/* -------------------------------------------------------------------------- */
/* Pareto : barres decroissantes et courbe de cumul                            */
/* -------------------------------------------------------------------------- */

export interface BarrePareto {
  cle: string
  libelle: string
  valeur: number
  /** Part cumulee, en pourcentage, deja calculee par le serveur. */
  cumul: number
  /** Classe ABC : colore la barre selon le rang, pas selon un seuil arbitraire. */
  classe?: string | null
}

/**
 * Le Pareto dit deux choses a la fois, et c'est tout son interet.
 *
 * Les BARRES donnent la valeur de chaque reference, decroissante. La COURBE
 * donne la part cumulee : c'est elle qui montre ou passe la barre des 80 %,
 * c'est-a-dire combien de references portent l'essentiel de la depense.
 *
 * Sans la courbe, on voit que la premiere reference est grosse ; avec elle, on
 * voit que seize references font huit dixiemes du budget. C'est la seconde
 * lecture qui commande une politique d'achat.
 *
 * La courbe est tracee en SVG sur la meme grille que les barres, pas dans un
 * second cadre : superposees, les deux echelles se lisent ensemble ; cote a
 * cote, il faudrait compter les colonnes pour les rapprocher.
 */
export function Pareto({
  titre,
  sousTitre,
  unite,
  donnees,
  seuilA = 80,
  maximum = 30,
}: {
  titre: string
  sousTitre?: string
  unite?: string
  donnees: BarrePareto[]
  /** Trait horizontal du seuil de classe A, lu du parametre. */
  seuilA?: number
  maximum?: number
}) {
  const [tableau, setTableau] = useState(false)
  const visibles = donnees.slice(0, maximum)
  const echelle = Math.max(...visibles.map((d) => d.valeur), 0) || 1
  const H = 150
  const L = 100

  const points = visibles
    .map((d, i) => {
      const x = visibles.length > 1 ? (i / (visibles.length - 1)) * L : L / 2
      return `${x.toFixed(2)},${(H - (Math.min(d.cumul, 100) / 100) * H).toFixed(2)}`
    })
    .join(' ')

  const teinte = (c?: string | null) =>
    c === 'A' ? 'var(--viz-critique)' : c === 'B' ? 'var(--viz-alerte)' : 'var(--viz-serie-1)'

  return (
    <Cadre
      titre={titre}
      sousTitre={sousTitre}
      series={[
        { cle: 'valeur', libelle: 'Valeur consommee' },
        { cle: 'cumul', libelle: 'Part cumulee' },
      ]}
      vueTableau={tableau}
      basculer={() => setTableau((v) => !v)}
      tableau={
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-attenue-texte">
              <th className="py-1 text-left font-medium">Reference</th>
              <th className="py-1 text-right font-medium">Valeur</th>
              <th className="py-1 text-right font-medium">Cumul</th>
              <th className="py-1 text-right font-medium">Classe</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((d) => (
              <tr key={d.cle} className="border-t border-bordure">
                <td className="max-w-[220px] truncate py-1">{d.libelle}</td>
                <td className="py-1 text-right tabular-nums">
                  {d.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                </td>
                <td className="py-1 text-right tabular-nums">{d.cumul.toFixed(1)} %</td>
                <td className="py-1 text-right">{d.classe ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="relative" style={{ height: H }}>
        {/* Barres */}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {visibles.map((d) => (
            <div
              key={d.cle}
              className="min-w-0 flex-1 rounded-t-[2px]"
              style={{
                height: `${Math.max((d.valeur / echelle) * 100, 1)}%`,
                background: teinte(d.classe),
              }}
              title={`${d.libelle} — ${d.valeur.toLocaleString('fr-FR', {
                maximumFractionDigits: 0,
              })} · cumul ${d.cumul.toFixed(1)} %`}
            />
          ))}
        </div>

        {/* Courbe de cumul, superposee. `preserveAspectRatio="none"` etire le
            trace a la largeur reelle : les points restent au-dessus de leur
            barre quelle que soit la taille du cadre. */}
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${L} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <line
            x1="0"
            x2={L}
            y1={H - (seuilA / 100) * H}
            y2={H - (seuilA / 100) * H}
            stroke="var(--color-attenue-texte)"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points}
            fill="none"
            stroke="var(--viz-serie-2)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <span className="absolute right-0 text-[9px] text-attenue-texte"
              style={{ top: H - (seuilA / 100) * H - 12 }}>
          {seuilA} % — limite classe A
        </span>
      </div>
      {unite && <p className="text-right text-[10px] text-attenue-texte">{unite}</p>}
    </Cadre>
  )
}

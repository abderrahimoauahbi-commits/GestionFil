/**
 * Carte des fournisseurs.
 *
 * Une bulle par fournisseur : **l'aire** est proportionnelle au montant engage,
 * pas le rayon. Un rayon proportionnel exagere les ecarts au carre — un
 * fournisseur deux fois plus gros paraitrait quatre fois plus gros.
 *
 * La couleur porte le classement, qui est un **etat** et non une serie : elle
 * vient donc de la palette d'etat, et chaque bulle porte son libelle. Une
 * couleur seule ne dit rien a qui ne distingue pas le rouge du vert, et la
 * decision — reduire la dependance a ce fournisseur — merite mieux qu'une
 * teinte.
 */
import { useMemo, useState } from 'react'
import { Table2, BarChart3 } from 'lucide-react'
import { cn } from '../../lib/utils'
import './graphiques.css'

export interface Fournisseur {
  code_fournisseur: string
  nom: string
  montant_total_mad: number | null
  nb_references: number | null
  note_globale: number | null
  classement: string | null
  pays: string | null
}

/** Classement -> etat. Les libelles viennent du parametrage serveur. */
function etat(classement: string | null): 'bon' | 'neutre' | 'alerte' {
  const c = (classement ?? '').toUpperCase()
  if (c.includes('STRATEG')) return 'bon'
  if (c.includes('SURVEIL')) return 'alerte'
  return 'neutre'
}

const TEINTE = {
  bon: 'var(--viz-bon)',
  neutre: 'var(--viz-serie-1)',
  alerte: 'var(--viz-alerte)',
} as const

export function BullesFournisseurs({
  donnees,
  surClic,
}: {
  donnees: Fournisseur[]
  surClic?: (code: string) => void
}) {
  const [tableau, setTableau] = useState(false)

  const bulles = useMemo(() => {
    const avecMontant = donnees.filter((f) => (f.montant_total_mad ?? 0) > 0)
    const max = Math.max(...avecMontant.map((f) => f.montant_total_mad ?? 0), 1)
    return avecMontant
      .map((f) => ({
        ...f,
        montant: f.montant_total_mad ?? 0,
        // Aire proportionnelle : le diametre suit la racine carree.
        taille: 34 + Math.sqrt((f.montant_total_mad ?? 0) / max) * 82,
        e: etat(f.classement),
      }))
      .sort((a, b) => b.montant - a.montant)
  }, [donnees])

  const total = bulles.reduce((s, f) => s + f.montant, 0)

  return (
    <figure className="viz m-0 flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3">
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-texte">Fournisseurs</h3>
          <p className="truncate text-[11px] text-attenue-texte">
            {bulles.length} actifs · {Math.round(total).toLocaleString('fr-FR')} MAD engages ·
            surface proportionnelle au montant
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTableau((t) => !t)}
          aria-pressed={tableau}
          title={tableau ? 'Voir la carte' : 'Voir les valeurs'}
          className="grid size-6 shrink-0 place-items-center rounded-[3px] text-attenue-texte
                     hover:bg-attenue hover:text-texte"
        >
          {tableau ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
        </button>
      </figcaption>

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ['bon', 'Strategique'],
            ['neutre', 'Standard'],
            ['alerte', 'A surveiller'],
          ] as const
        ).map(([id, libelle]) => (
          <li key={id} className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: TEINTE[id] }}
            />
            {libelle}
          </li>
        ))}
      </ul>

      {tableau ? (
        <div className="defilement-x max-h-64 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th className="border-b border-bordure py-1 pr-3 text-left font-medium text-attenue-texte">
                  Fournisseur
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-left font-medium text-attenue-texte">
                  Classement
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-right font-medium text-attenue-texte">
                  Montant (MAD)
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-right font-medium text-attenue-texte">
                  Refs
                </th>
                <th className="border-b border-bordure py-1 pr-3 text-right font-medium text-attenue-texte">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {bulles.map((f) => (
                <tr key={f.code_fournisseur} className="border-b border-ligne last:border-0">
                  <td className="py-1 pr-3">{f.nom}</td>
                  <td className="py-1 pr-3 text-attenue-texte">{f.classement ?? '—'}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {Math.round(f.montant).toLocaleString('fr-FR')}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{f.nb_references ?? '—'}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{f.note_globale ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-2 py-2">
          {bulles.map((f) => (
            <button
              key={f.code_fournisseur}
              type="button"
              onClick={() => surClic?.(f.code_fournisseur)}
              title={`${f.nom} — ${Math.round(f.montant).toLocaleString('fr-FR')} MAD · ${
                f.nb_references ?? 0
              } references · ${f.classement ?? 'non classe'}`}
              style={{ width: f.taille, height: f.taille, background: TEINTE[f.e] }}
              className={cn(
                'grid shrink-0 place-items-center rounded-full p-1 text-center leading-none',
                'transition-transform duration-100 hover:scale-105',
                // Liseré a la couleur du fond : deux bulles qui se touchent
                // restent distinctes.
                'marque-anneau',
                f.e === 'neutre' ? 'text-white' : 'text-[hsl(var(--fond))]',
              )}
            >
              <span className="flex flex-col gap-0.5 overflow-hidden">
                <span className="truncate text-[10px] font-semibold">
                  {f.nom.split(' ')[0].slice(0, 9)}
                </span>
                {f.taille > 72 && (
                  <span className="text-[9px] tabular-nums opacity-90">
                    {(f.montant / 1_000_000).toFixed(1)} M
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </figure>
  )
}

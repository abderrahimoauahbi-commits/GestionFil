/**
 * L'analyse ABC / XYZ.
 *
 * LES DEUX CLASSEMENTS NE DISENT PAS LA MEME CHOSE, et c'est leur croisement qui
 * commande une politique d'achat :
 *
 *   ABC — le POIDS.       Combien la reference pese dans la depense annuelle.
 *   XYZ — la REGULARITE.  La variabilite du besoin d'un mois sur l'autre.
 *
 * Une reference grosse ET erratique (AZ) est la plus dangereuse du catalogue :
 * elle engage beaucoup et se prevoit mal. Une petite ET erratique (CZ) ne
 * merite aucun stock. Traiter les deux pareil met la premiere en rupture et
 * immobilise du capital sur la seconde.
 *
 * LA MATRICE EST LA VUE PRINCIPALE, pas la liste. Neuf cases se lisent d'un
 * coup ; cent vingt-quatre lignes ne se lisent pas. La liste vient apres,
 * filtree par la case qu'on a choisie.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { EnTetePage } from '../components/Layout'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { Alerte, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Chargement } from '../composants/ui/base'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'

const MODULE = 'STOCK'

interface Ligne {
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  classe_abc: string | null
  classe_xyz: string | null
  statut: string
  jours_couverture: number | null
  conso_mensuelle_kg: number | null
  valeur_conso_annuelle_mad?: number | null
  part_pct?: number | null
  pct_cumule?: number | null
  rang: number
  politique: string
  date_dernier_abc: string | null
  [k: string]: unknown
}

const ABC = ['A', 'B', 'C'] as const
const XYZ = ['X', 'Y', 'Z'] as const

/** Ce que chaque classe veut dire, dit une fois. */
const SENS_ABC: Record<string, string> = {
  A: 'Porte l essentiel de la depense — jusqu au seuil parametre, 80 % par defaut',
  B: 'Le palier intermediaire, jusqu a 95 %',
  C: 'La longue traine : beaucoup de references, peu de valeur',
}
const SENS_XYZ: Record<string, string> = {
  X: 'Demande reguliere : le besoin varie peu d un mois a l autre',
  Y: 'Demande saisonniere ou moderement variable',
  Z: 'Demande erratique : elle ne se prevoit pas depuis l historique',
}

export function AnalyseAbcXyz() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const [case_, setCase] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['analyse-abc-xyz'],
    queryFn: () => api.get<Ligne[]>('/api/analyse-abc-xyz'),
  })

  const recalculer = useMutation({
    mutationFn: () => api.post<Record<string, number>>('/api/classification', {}),
    onSuccess: (r) => {
      toast.success('Classement recalcule', {
        description: `${r.classe_a} en A, ${r.classe_b} en B, ${r.classe_c} en C.`,
      })
      void qc.invalidateQueries({ queryKey: ['analyse-abc-xyz'] })
      void qc.invalidateQueries({ queryKey: ['stock-projete'] })
    },
    onError: (e) =>
      toast.error(e instanceof ErreurApi ? e.message : 'Recalcul impossible.'),
  })

  const lignes = q.data ?? []

  /* La matrice : neuf cases, chacune portant son compte et sa valeur. Les
     references non classees — celles sans consommation — forment une dixieme
     case a part, qu'on ne peut pas ranger dans la grille sans mentir. */
  const matrice = useMemo(() => {
    const m = new Map<string, { n: number; valeur: number }>()
    let nonClassees = 0
    for (const l of lignes) {
      if (!l.classe_abc || !l.classe_xyz) {
        nonClassees += 1
        continue
      }
      const k = l.classe_abc + l.classe_xyz
      const c = m.get(k) ?? { n: 0, valeur: 0 }
      c.n += 1
      c.valeur += l.valeur_conso_annuelle_mad ?? 0
      m.set(k, c)
    }
    return { m, nonClassees }
  }, [lignes])

  const vues = case_
    ? case_ === '??'
      ? lignes.filter((l) => !l.classe_abc || !l.classe_xyz)
      : lignes.filter((l) => (l.classe_abc ?? '') + (l.classe_xyz ?? '') === case_)
    : lignes

  const valeurVisible = droits.visible('valeur_conso_annuelle_mad')
  const maxCase = Math.max(...[...matrice.m.values()].map((c) => c.n), 1)

  const colonnes: Colonne<Ligne>[] = [
    {
      champ: 'rang',
      entete: 'Rang',
      numerique: true,
      largeur: '60px',
      rendu: (l) => l.rang,
    },
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px]">{l.code_reference}</div>
          {l.designation && (
            <div className="truncate text-[11px] text-attenue-texte">{l.designation}</div>
          )}
        </div>
      ),
    },
    {
      champ: 'classe_abc',
      entete: 'Classe',
      largeur: '64px',
      rendu: (l) =>
        !l.classe_abc ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span
            className={cn(
              'inline-block rounded-[3px] px-1.5 py-px text-[11px] font-semibold',
              l.classe_abc === 'A'
                ? 'bg-primaire/15 text-primaire'
                : l.classe_abc === 'B'
                  ? 'bg-attenue text-texte'
                  : 'text-attenue-texte',
            )}
          >
            {l.classe_abc}
            {l.classe_xyz ?? '?'}
          </span>
        ),
    },
    { champ: 'fournisseur_nom', entete: 'Fournisseur', secondaire: true },
    {
      champ: 'conso_mensuelle_kg',
      entete: 'Conso / mois',
      numerique: true,
      rendu: (l) =>
        l.conso_mensuelle_kg == null ? '—' : `${fmt.nombre(l.conso_mensuelle_kg, 0)} kg`,
    },
    {
      champ: 'valeur_conso_annuelle_mad',
      entete: 'Valeur annuelle',
      numerique: true,
      rendu: (l) =>
        l.valeur_conso_annuelle_mad == null
          ? '—'
          : fmt.nombre(l.valeur_conso_annuelle_mad, 0),
    },
    {
      champ: 'part_pct',
      entete: 'Part',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.part_pct == null ? '—' : `${fmt.nombre(l.part_pct, 2)} %`),
    },
    {
      champ: 'pct_cumule',
      entete: 'Cumul',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.pct_cumule == null ? '—' : `${fmt.nombre(l.pct_cumule, 1)} %`),
    },
    {
      champ: 'politique',
      entete: 'Politique deduite',
      rendu: (l) => <span className="text-[11px]">{l.politique}</span>,
    },
  ]

  if (q.isLoading) return <Chargement texte="Lecture du classement…" />

  const dernier = lignes.find((l) => l.date_dernier_abc)?.date_dernier_abc

  return (
    <div>
      <EnTetePage
        titre="Analyse ABC / XYZ"
        sous_titre="Le poids dans la depense croise a la regularite de la demande"
        actions={
          droits.peutEcrire && (
            <Bouton
              variante="contour"
              onClick={() => recalculer.mutate()}
              chargement={recalculer.isPending}
            >
              <RefreshCw />
              Recalculer le classement
            </Bouton>
          )
        }
      />

      {matrice.nonClassees > 0 && (
        <Alerte ton="info" className="mb-3">
          {matrice.nonClassees} reference(s) sans consommation ne peuvent pas etre classees en
          XYZ : la regularite se mesure sur un historique, et elles n en ont pas. Elles sont
          rangees en C par convention — zero pour cent de la depense — et regroupees dans la case
          « non classees ».
        </Alerte>
      )}

      {/* --- La matrice ---------------------------------------------------- */}
      <Carte className="mb-3">
        <CarteEntete>
          <CarteTitre>
            Matrice
            {case_ && (
              <button
                onClick={() => setCase(null)}
                className="ml-2 text-[11px] font-normal text-primaire hover:underline"
              >
                voir tout
              </button>
            )}
          </CarteTitre>
        </CarteEntete>
        <CarteCorps>
          <div className="defilement-x">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead>
                <tr>
                  <th className="w-24 px-2 py-1" />
                  {XYZ.map((x) => (
                    <th
                      key={x}
                      className="px-2 py-1 text-center text-[11px] font-semibold text-attenue-texte"
                      title={SENS_XYZ[x]}
                    >
                      {x}
                      <div className="font-normal">
                        {x === 'X' ? 'regulier' : x === 'Y' ? 'saisonnier' : 'erratique'}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ABC.map((a) => (
                  <tr key={a}>
                    <th
                      className="px-2 py-1 text-left text-[11px] font-semibold text-attenue-texte"
                      title={SENS_ABC[a]}
                    >
                      {a}
                      <div className="font-normal">
                        {a === 'A' ? 'gros' : a === 'B' ? 'moyen' : 'petit'}
                      </div>
                    </th>
                    {XYZ.map((x) => {
                      const k = a + x
                      const c = matrice.m.get(k)
                      const actif = case_ === k
                      return (
                        <td key={x} className="p-1">
                          <button
                            type="button"
                            disabled={!c}
                            onClick={() => setCase(actif ? null : k)}
                            className={cn(
                              'w-full rounded-[var(--radius-sm)] border p-2 text-left transition-colors',
                              !c
                                ? 'cursor-default border-bordure/60 text-attenue-texte'
                                : actif
                                  ? 'border-primaire bg-primaire/10'
                                  : 'border-bordure hover:bg-attenue',
                            )}
                            style={
                              // L'intensite suit le NOMBRE de references, pas la
                              // valeur : la matrice montre ou se concentre le
                              // catalogue, la colonne « valeur annuelle » dit ou
                              // se concentre l'argent.
                              c
                                ? {
                                    background: actif
                                      ? undefined
                                      : `color-mix(in srgb, var(--color-primaire) ${Math.round((c.n / maxCase) * 14)}%, transparent)`,
                                  }
                                : undefined
                            }
                          >
                            <div className="font-mono text-[11px] font-semibold">{k}</div>
                            <div className="text-[15px] font-semibold tabular-nums">
                              {c?.n ?? 0}
                            </div>
                            {c && valeurVisible && (
                              <div className="text-[10px] text-attenue-texte">
                                {fmt.nombre(c.valeur / 1e6, 2)} M MAD
                              </div>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {matrice.nonClassees > 0 && (
            <button
              type="button"
              onClick={() => setCase(case_ === '??' ? null : '??')}
              className={cn(
                'mt-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[11px] transition-colors',
                case_ === '??'
                  ? 'border-primaire bg-primaire/10'
                  : 'border-bordure hover:bg-attenue',
              )}
            >
              Non classees — {matrice.nonClassees} reference(s) sans consommation
            </button>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-attenue-texte">
            La teinte suit le nombre de references, pas la valeur : la matrice montre ou se
            concentre le catalogue. Cliquez une case pour filtrer la liste.
            {dernier && ` Dernier classement : ${fmt.dateHeure(dernier)}.`}
          </p>
        </CarteCorps>
      </Carte>

      <TableDroits
        module={MODULE}
        colonnes={colonnes}
        lignes={vues}
        cle={(l) => l.code_reference}
        titreCarte={(l) => l.code_reference}
        exportable="analyse-abc-xyz"
        imprimable="Analyse ABC XYZ"
        texteVide="Aucune reference dans cette case."
      />
    </div>
  )
}

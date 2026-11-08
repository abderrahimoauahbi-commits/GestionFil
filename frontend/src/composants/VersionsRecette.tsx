/**
 * LES VERSIONS DE LA RECETTE (decision du 07/11/2026 : historique a chaque
 * modification). Chaque enregistrement qui change la composition ou les
 * densites garde une version numerotee — date, auteur, motif. Cliquer une
 * version montre ce qui a change par rapport a la precedente : matieres
 * ajoutees, retirees, pourcentages et densites avant → apres. Les calculs
 * utilisent toujours la recette en cours ; l'historique se lit, il ne se
 * rejoue pas.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History } from 'lucide-react'
import { api } from '../api/client'
import { Carte, CarteCorps, CarteEntete, CarteTitre, Chargement } from './ui/base'
import { cn, fmt } from '../lib/utils'

interface LigneCompo {
  code_reference: string
  code_role: string
  pourcentage: number
  couleur?: string | null
}
interface LigneDensite {
  code_role: string
  densite: number
  unite_densite: string
}
interface Version {
  numero: number
  date_version: string
  auteur: string | null
  motif: string
  composition: LigneCompo[] | null
  densites: LigneDensite[] | null
  poids_commercial_m2: number | null
}

/** Une difference entre deux versions, prete a lire. */
interface Ecart {
  quoi: string
  avant: string
  apres: string
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${fmt.nombre(Number(v), 2)} %`)
const dens = (d?: LigneDensite) => (d ? `${fmt.nombre(Number(d.densite), 4)} ${d.unite_densite === 'ml_m2' ? 'ml/m²' : 'kg/m²'}` : '—')

/** Ce qui a change de `avant` a `apres`. */
function ecarts(avant: Version | undefined, apres: Version): Ecart[] {
  const sortie: Ecart[] = []
  const ca = new Map((avant?.composition ?? []).map((l) => [l.code_reference, l]))
  const cb = new Map((apres.composition ?? []).map((l) => [l.code_reference, l]))
  for (const [ref, b] of cb) {
    const a = ca.get(ref)
    if (!a) sortie.push({ quoi: `${ref} (${b.code_role})`, avant: 'absente', apres: pct(b.pourcentage) })
    else if (Number(a.pourcentage) !== Number(b.pourcentage) || a.code_role !== b.code_role)
      sortie.push({
        quoi: `${ref} (${b.code_role})`,
        avant: `${pct(a.pourcentage)}${a.code_role !== b.code_role ? ` · ${a.code_role}` : ''}`,
        apres: pct(b.pourcentage),
      })
  }
  for (const [ref, a] of ca) if (!cb.has(ref)) sortie.push({ quoi: `${ref} (${a.code_role})`, avant: pct(a.pourcentage), apres: 'retirée' })
  const da = new Map((avant?.densites ?? []).map((l) => [l.code_role, l]))
  const db = new Map((apres.densites ?? []).map((l) => [l.code_role, l]))
  for (const role of new Set([...da.keys(), ...db.keys()])) {
    const a = da.get(role)
    const b = db.get(role)
    if (dens(a) !== dens(b)) sortie.push({ quoi: `Densité ${role}`, avant: dens(a), apres: dens(b) })
  }
  return sortie
}

export function VersionsRecette({ code }: { code: string }) {
  const [ouverte, setOuverte] = useState<number | null>(null)
  const q = useQuery({
    queryKey: ['recette-versions', code],
    queryFn: ({ signal }) => api.get<Version[]>(`/api/qualites/${encodeURIComponent(code)}/versions`, { signal }),
  })
  const versions = q.data ?? []
  return (
    <Carte className="mt-3">
      <CarteEntete>
        <CarteTitre className="flex items-center gap-1.5">
          <History className="size-3.5" />
          Versions de la recette {versions.length > 0 && `— ${versions.length}`}
        </CarteTitre>
      </CarteEntete>
      <CarteCorps className="p-0">
        {q.isLoading ? (
          <div className="p-3">
            <Chargement texte="Lecture des versions…" />
          </div>
        ) : versions.length === 0 ? (
          <p className="p-3 text-[12px] text-attenue-texte">Aucune version : la première naîtra au prochain enregistrement.</p>
        ) : (
          <ul className="divide-y divide-bordure/60">
            {versions.map((v, i) => {
              const precedente = versions[i + 1]
              const deplie = ouverte === v.numero
              const liste = deplie ? ecarts(precedente, v) : []
              return (
                <li key={v.numero}>
                  <button
                    type="button"
                    onClick={() => setOuverte(deplie ? null : v.numero)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-[12.5px] hover:bg-attenue/50"
                  >
                    <span className={cn('w-9 shrink-0 font-mono font-semibold', i === 0 ? 'text-primaire' : 'text-attenue-texte')}>
                      V{v.numero}
                    </span>
                    <span className="w-36 shrink-0 tabular-nums text-attenue-texte">{fmt.dateHeure(v.date_version)}</span>
                    <span className="w-24 shrink-0 truncate">{v.auteur ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate" title={v.motif}>
                      {v.motif}
                    </span>
                    {i === 0 && <span className="shrink-0 text-[11px] text-primaire">en cours</span>}
                    <ChevronDown className={cn('size-4 shrink-0 text-attenue-texte transition-transform', deplie && 'rotate-180')} />
                  </button>
                  {deplie && (
                    <div className="px-3 pb-3">
                      {!precedente ? (
                        <p className="text-[12px] text-attenue-texte">
                          Première version : {(v.composition ?? []).length} matière(s), {(v.densites ?? []).length} densité(s)
                          {v.poids_commercial_m2 != null && ` · ${fmt.nombre(v.poids_commercial_m2, 4)} kg/m²`}.
                        </p>
                      ) : liste.length === 0 ? (
                        <p className="text-[12px] text-attenue-texte">Aucune différence de composition ni de densité avec V{precedente.numero}.</p>
                      ) : (
                        <table className="grille w-full text-[12px]">
                          <thead>
                            <tr className="bg-attenue">
                              <th className="px-2 py-1 text-left font-semibold">Changement depuis V{precedente.numero}</th>
                              <th className="px-2 py-1 text-right font-semibold">Avant</th>
                              <th className="px-2 py-1 text-right font-semibold">Après</th>
                            </tr>
                          </thead>
                          <tbody>
                            {liste.map((e) => (
                              <tr key={e.quoi}>
                                <td className="px-2 py-1">{e.quoi}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-attenue-texte">{e.avant}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{e.apres}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CarteCorps>
    </Carte>
  )
}

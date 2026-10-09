/**
 * LA SAISON ET LES STOCKS MINIMUMS (regle 9, 09/10/2026).
 *
 * Au-dela du plan en service, la demande est prolongee a la moyenne du plan.
 * Un coefficient par mois la corrige de la saison : janvier-mars tourne a
 * 120-140 t par mois quand la moyenne du plan est de 184. La Direction le regle
 * ici (1 = la moyenne telle quelle).
 *
 * Les stocks minimums du catalogue venaient du classeur (793 t, quatre mois de
 * plan) : ceux qui depassent trois mois du besoin mensuel du plan sont listes,
 * avec une valeur proposee — la couverture minimale de la fiche multipliee par
 * le besoin mensuel. Les achats acceptent ou corrigent, reference par reference.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ } from '../composants/ui/base'
import { fmt } from '../lib/utils'

interface Saison {
  mois: number
  libelle: string
  coefficient: number
}

interface Minimum {
  code_reference: string
  designation: string
  stock_min_kg: number
  couverture_min_mois: number | null
  besoin_mensuel_kg: number
  mois_couverts: number | null
  valeur_proposee_kg: number | null
}

const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

export function SaisonMinimums() {
  const { peut } = useAuth()
  const qc = useQueryClient()
  const reglerSaison = peut('PARAMETRES', 'ECRIRE')
  const reglerCatalogue = peut('CATALOGUE', 'ECRIRE')

  const qSaison = useQuery({ queryKey: ['saisons'], queryFn: () => api.get<Saison[]>('/api/saisons') })
  const qMin = useQuery({
    queryKey: ['stocks-minimums'],
    queryFn: () => api.get<Minimum[]>('/api/plan-achat/stocks-minimums'),
  })
  const [brouillon, setBrouillon] = useState<Record<number, string>>({})

  const enregistrerSaison = useMutation({
    mutationFn: async () => {
      for (const [mois, v] of Object.entries(brouillon)) {
        await api.patch(`/api/saisons/${mois}`, { coefficient: Number(v.replace(',', '.')) })
      }
    },
    onSuccess: () => {
      toast.success('Saison enregistrée — le prochain calcul du plan d’achat en tient compte')
      setBrouillon({})
      void qc.invalidateQueries({ queryKey: ['saisons'] })
    },
    onError: echec,
  })
  const appliquer = useMutation({
    mutationFn: (m: Minimum) =>
      api.patch(`/api/catalogue/${encodeURIComponent(m.code_reference)}`, { stock_min_kg: m.valeur_proposee_kg }),
    onSuccess: (_r, m) => {
      toast.success(`${m.code_reference} : stock minimum ramené à ${fmt.nombre(m.valeur_proposee_kg ?? 0, 0)} kg`)
      void qc.invalidateQueries({ queryKey: ['stocks-minimums'] })
    },
    onError: echec,
  })

  const saisons = qSaison.data ?? []
  const minimums = qMin.data ?? []
  const modifiee = Object.keys(brouillon).length > 0

  return (
    <Carte repliable="plan-achat.saison" className="mt-4">
      <CarteEntete>
        <CarteTitre>Saison et stocks minimums</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-4">
        <div>
          <p className="m-0 mb-2 text-[12.5px] text-attenue-texte">
            Au-delà du plan en service, la demande se prolonge à la moyenne du plan multipliée par le coefficient du
            mois (1 = la moyenne telle quelle).
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {saisons.map((s) => (
              <label key={s.mois} className="flex flex-col gap-0.5 text-[11.5px] text-attenue-texte">
                {s.libelle.slice(0, 4)}.
                <Champ
                  inputMode="decimal"
                  className="h-8 text-right tabular-nums"
                  disabled={!reglerSaison}
                  value={brouillon[s.mois] ?? String(s.coefficient)}
                  onChange={(e) => setBrouillon((b) => ({ ...b, [s.mois]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {reglerSaison && modifiee && (
            <Bouton className="mt-2" chargement={enregistrerSaison.isPending} onClick={() => enregistrerSaison.mutate()}>
              Enregistrer la saison
            </Bouton>
          )}
        </div>

        <div>
          <p className="m-0 mb-2 text-[12.5px] text-attenue-texte">
            {minimums.length} stock(s) minimum(s) au-delà de trois mois du besoin mensuel du plan. Valeur proposée :
            couverture minimale de la fiche × besoin mensuel.
          </p>
          {minimums.length > 0 && (
            <div className="max-h-[45vh] overflow-auto rounded-[var(--radius)] border border-bordure">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Référence</th>
                    <th className="px-2 py-1.5 text-right">Minimum actuel</th>
                    <th className="px-2 py-1.5 text-right">Besoin / mois</th>
                    <th className="px-2 py-1.5 text-right">Mois couverts</th>
                    <th className="px-2 py-1.5 text-right">Proposé</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {minimums.map((m) => (
                    <tr key={m.code_reference} className="border-t border-bordure/60">
                      <td className="px-2 py-1">
                        {m.code_reference}
                        <div className="text-[10.5px] text-attenue-texte">{m.designation}</div>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt.nombre(m.stock_min_kg, 0)} kg</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {m.besoin_mensuel_kg > 0 ? `${fmt.nombre(m.besoin_mensuel_kg, 0)} kg` : 'hors plan'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {m.mois_couverts != null ? fmt.nombre(m.mois_couverts, 1) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {m.valeur_proposee_kg != null ? `${fmt.nombre(m.valeur_proposee_kg, 0)} kg` : '—'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {reglerCatalogue && m.valeur_proposee_kg != null && (
                          <Bouton taille="sm" variante="contour" chargement={appliquer.isPending}
                            onClick={() => appliquer.mutate(m)}>
                            Appliquer
                          </Bouton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CarteCorps>
    </Carte>
  )
}

/**
 * Les engagements d'importation (EI) du dossier.
 *
 * Avant toute importation, l'entreprise ouvre en banque un engagement
 * d'importation : c'est lui qui autorise le reglement en devise au fournisseur.
 * La DUM le reprend en case 38 — numero, date, banque, quantite, valeur — et un
 * dossier en porte souvent plusieurs, ouverts dans des banques differentes.
 *
 * CE BLOC NE GERE PAS LE CREDIT. Il RANGE les numeros, pour qu'on retrouve le
 * dossier par celui que la banque, le transitaire ou la comptabilite ont sous
 * les yeux. La consommation de l'engagement, les echeances et les reglements
 * appartiennent a la tresorerie.
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ } from '../../composants/ui/base'
import { cn, fmt } from '../../lib/utils'
import { echec, nombre, useRafraichir } from './dialogues'
import type { DossierComplet, Engagement } from './types'

const VIDE = { numero_ei: '', banque: '', date_ei: '', quantite_kg: '', montant_devise: '' }

export function EngagementsDossier({ d, ecrire }: { d: DossierComplet; ecrire: boolean }) {
  const rafraichir = useRafraichir(d.dossier.id_dossier)
  const [n, setN] = useState(VIDE)
  const engagements: Engagement[] = d.engagements ?? []
  const devise = d.dossier.code_devise ?? ''

  const ajouter = useMutation({
    mutationFn: () =>
      api.post(`/api/import/dossiers/${d.dossier.id_dossier}/engagements`, {
        numero_ei: n.numero_ei,
        banque: n.banque || null,
        date_ei: n.date_ei || null,
        quantite_kg: n.quantite_kg ? nombre(n.quantite_kg) : null,
        montant_devise: n.montant_devise ? nombre(n.montant_devise) : null,
      }),
    onSuccess: () => {
      toast.success(`Engagement ${n.numero_ei.replace(/\s/g, '')} rattaché au dossier`)
      setN(VIDE)
      rafraichir()
    },
    onError: echec,
  })

  const retirer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/import/engagements/${id}`),
    onSuccess: () => {
      toast.success('Engagement retiré du dossier')
      rafraichir()
    },
    onError: echec,
  })

  const maj = (k: keyof typeof VIDE) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setN((x) => ({ ...x, [k]: e.target.value }))

  const th = 'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte'
  const td = 'px-2 py-1'
  const champ = 'h-8 text-[12.5px]'

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Engagements d’importation</CarteTitre>
        <span className="text-[11.5px] text-attenue-texte">
          Ceux que cite la DUM en case 38 — pour retrouver le dossier par son numéro bancaire.
        </span>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div className="defilement-x">
          <table className="w-full min-w-[46rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-bordure">
                <th className={cn(th, 'text-left')}>N° d’engagement</th>
                <th className={cn(th, 'w-40 text-left')}>Banque</th>
                <th className={cn(th, 'w-36 text-left')}>Date</th>
                <th className={cn(th, 'w-32 text-right')}>Quantité (kg)</th>
                <th className={cn(th, 'w-36 text-right')}>Montant {devise}</th>
                {ecrire && <th className={cn(th, 'w-10')} />}
              </tr>
            </thead>
            <tbody>
              {engagements.length === 0 && !ecrire && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-attenue-texte">
                    Aucun engagement rattaché.
                  </td>
                </tr>
              )}
              {engagements.map((e) => (
                <tr key={e.id_engagement} className="border-b border-bordure/60">
                  <td className={cn(td, 'font-medium tabular-nums')}>{e.numero_ei}</td>
                  <td className={td}>{e.banque ?? '—'}</td>
                  <td className={td}>{e.date_ei ? fmt.date(e.date_ei) : '—'}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>
                    {e.quantite_kg != null ? fmt.nombre(e.quantite_kg, 2) : '—'}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums')}>
                    {e.montant_devise != null ? fmt.nombre(e.montant_devise, 2) : '—'}
                  </td>
                  {ecrire && (
                    <td className={td}>
                      <Bouton
                        taille="icone-xs"
                        variante="discret"
                        className="text-danger hover:bg-danger/10"
                        aria-label={`Retirer l’engagement ${e.numero_ei}`}
                        onClick={() => retirer.mutate(e.id_engagement)}
                      >
                        <Trash2 />
                      </Bouton>
                    </td>
                  )}
                </tr>
              ))}
              {ecrire && (
                <tr className="bg-attenue/30">
                  <td className={td}>
                    <Champ
                      className={champ}
                      value={n.numero_ei}
                      onChange={maj('numero_ei')}
                      placeholder="20261000000000905984"
                      aria-label="Numéro de l’engagement d’importation"
                    />
                  </td>
                  <td className={td}>
                    <Champ className={champ} value={n.banque} onChange={maj('banque')} placeholder="013-6400063" aria-label="Banque" />
                  </td>
                  <td className={td}>
                    <Champ className={champ} type="date" value={n.date_ei} onChange={maj('date_ei')} aria-label="Date de l’engagement" />
                  </td>
                  <td className={td}>
                    <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={n.quantite_kg} onChange={maj('quantite_kg')} aria-label="Quantité couverte, en kilos" />
                  </td>
                  <td className={td}>
                    <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={n.montant_devise} onChange={maj('montant_devise')} aria-label={`Montant couvert en ${devise}`} />
                  </td>
                  <td className={td}>
                    <Bouton
                      taille="icone-xs"
                      disabled={!n.numero_ei.trim()}
                      chargement={ajouter.isPending}
                      aria-label="Ajouter l’engagement"
                      title="Ajouter l’engagement au dossier"
                      onClick={() => ajouter.mutate()}
                    >
                      <Plus />
                    </Bouton>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CarteCorps>
    </Carte>
  )
}

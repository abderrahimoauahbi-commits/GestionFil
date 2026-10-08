/**
 * CLOTURER UNE RECEPTION AVEC SA FACTURE (regle 6, 08/10/2026).
 *
 * A la validation, la marchandise est entree au prix du bon : une valeur
 * PROVISOIRE. La facture du fournisseur, avec ses frais, donne la valeur
 * DEFINITIVE. La difference va au stock encore present (le CMUP en tient
 * compte, au prorata) ; la part des kilos deja sortis est tracee en ecart de
 * prix, hors CMUP. On voit l'apercu avant de signer.
 *
 * Saisie sur la page, pas dans une fenetre : c'est un document qu'on relit.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, FileCheck2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Etiq } from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'

interface Resultat {
  valeur_provisoire_mad: number
  valeur_definitive_mad: number
  difference_mad: number
  au_stock_mad: number
  ecart_prix_mad: number
  references: {
    code_reference: string
    valeur_provisoire_mad: number
    difference_mad: number
    recu_kg: number
    stock_kg: number
    au_stock_mad: number
    ecart_prix_mad: number
  }[]
}

const signe = (n: number) => `${n > 0 ? '+' : ''}${fmt.nombre(n, 2)}`

export function ClotureFacture({
  idReception,
  numeroFacture,
  surCloture,
}: {
  idReception: string
  numeroFacture: string | null
  surCloture: () => void
}) {
  const qc = useQueryClient()
  const [ouvert, setOuvert] = useState(false)
  const [f, setF] = useState({ numero: numeroFacture ?? '', montant: '', frais: '' })
  const [apercu, setApercu] = useState<Resultat | null>(null)

  const corps = (simuler: boolean) => ({
    numero_facture: f.numero.trim(),
    montant_facture_mad: Number(f.montant.replace(',', '.')),
    frais_mad: f.frais.trim() ? Number(f.frais.replace(',', '.')) : 0,
    simuler,
  })
  const complet = f.numero.trim() !== '' && Number(f.montant.replace(',', '.')) > 0
  const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  const simuler = useMutation({
    mutationFn: () => api.post<Resultat>(`/api/receptions/${idReception}/cloturer`, corps(true)),
    onSuccess: setApercu,
    onError: echec,
  })
  const cloturer = useMutation({
    mutationFn: () => api.post<Resultat>(`/api/receptions/${idReception}/cloturer`, corps(false)),
    onSuccess: (r) => {
      toast.success('Réception clôturée', {
        description: `Valeur définitive ${fmt.nombre(r.valeur_definitive_mad, 2)} MAD — ${signe(r.au_stock_mad)} au stock, ${signe(r.ecart_prix_mad)} en écart de prix.`,
      })
      void qc.invalidateQueries()
      surCloture()
    },
    onError: echec,
  })
  const maj = (k: 'numero' | 'montant' | 'frais') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }))
    setApercu(null)
  }

  if (!ouvert) {
    return (
      <Bouton variante="contour" onClick={() => setOuvert(true)}>
        <FileCheck2 />
        Clôturer avec la facture
      </Bouton>
    )
  }

  return (
    <Carte className="mb-3">
      <CarteEntete>
        <CarteTitre>Clôturer avec la facture du fournisseur</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        <p className="text-[12.5px] text-attenue-texte">
          La marchandise est entrée au prix du bon. La facture et ses frais donnent la valeur définitive : la
          différence va au stock encore présent ; la part des kilos déjà sortis reste en écart de prix.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Etiq obligatoire>N° de facture</Etiq>
            <Champ value={f.numero} onChange={maj('numero')} />
          </div>
          <div>
            <Etiq obligatoire>Montant HT de la marchandise (MAD)</Etiq>
            <Champ inputMode="decimal" className="text-right tabular-nums" value={f.montant} onChange={maj('montant')} />
          </div>
          <div>
            <Etiq>Frais (transport, manutention) en MAD</Etiq>
            <Champ inputMode="decimal" className="text-right tabular-nums" value={f.frais} onChange={maj('frais')} />
          </div>
        </div>

        {apercu && (
          <div className="defilement-x">
            <table className="w-full min-w-[40rem] text-[12.5px] tabular-nums">
              <thead>
                <tr className="border-b border-bordure text-[10.5px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-2 py-1.5 text-left">Référence</th>
                  <th className="px-2 py-1.5 text-right">Provisoire</th>
                  <th className="px-2 py-1.5 text-right">Différence</th>
                  <th className="px-2 py-1.5 text-right">Reçu / en stock</th>
                  <th className="px-2 py-1.5 text-right">Au stock (CMUP)</th>
                  <th className="px-2 py-1.5 text-right">Écart de prix</th>
                </tr>
              </thead>
              <tbody>
                {apercu.references.map((r) => (
                  <tr key={r.code_reference} className="border-b border-bordure/60">
                    <td className="px-2 py-1">{r.code_reference}</td>
                    <td className="px-2 py-1 text-right">{fmt.nombre(r.valeur_provisoire_mad, 2)}</td>
                    <td className={cn('px-2 py-1 text-right', r.difference_mad < 0 ? 'text-succes' : r.difference_mad > 0 && 'text-alerte')}>
                      {signe(r.difference_mad)}
                    </td>
                    <td className="px-2 py-1 text-right">{fmt.nombre(r.recu_kg, 0)} / {fmt.nombre(r.stock_kg, 0)} kg</td>
                    <td className="px-2 py-1 text-right">{signe(r.au_stock_mad)}</td>
                    <td className="px-2 py-1 text-right text-attenue-texte">{signe(r.ecart_prix_mad)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-2 py-1">Total</td>
                  <td className="px-2 py-1 text-right">{fmt.nombre(apercu.valeur_provisoire_mad, 2)}</td>
                  <td className="px-2 py-1 text-right">{signe(apercu.difference_mad)}</td>
                  <td />
                  <td className="px-2 py-1 text-right">{signe(apercu.au_stock_mad)}</td>
                  <td className="px-2 py-1 text-right">{signe(apercu.ecart_prix_mad)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Bouton variante="contour" disabled={!complet} chargement={simuler.isPending} onClick={() => simuler.mutate()}>
            <Eye />
            Aperçu
          </Bouton>
          <Bouton disabled={!complet || !apercu} chargement={cloturer.isPending} onClick={() => cloturer.mutate()}
            title={!apercu ? 'Faites d’abord l’aperçu' : undefined}>
            <FileCheck2 />
            Clôturer
          </Bouton>
          <Bouton variante="discret" onClick={() => setOuvert(false)}>Fermer</Bouton>
          <span className="text-[11.5px] text-attenue-texte">
            Après clôture, l’entrée ne s’annule plus : une correction passe par un avoir.
          </span>
        </div>
      </CarteCorps>
    </Carte>
  )
}

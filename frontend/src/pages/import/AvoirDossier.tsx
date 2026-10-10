/**
 * L'AVOIR DU FOURNISSEUR SUR UN DOSSIER D'IMPORT (regle 3, 09/10/2026).
 *
 * Une facture recue est figee : un avoir ne la modifie pas, il s'ajoute au
 * journal du dossier.
 *   - De prix (remise, non-conformite gardee) : la valeur baisse, portee a la
 *     marchandise du dossier encore en stock ; la part deja sortie va en
 *     « consomme », hors CMUP.
 *   - Pour retour : solde les retours fournisseur des receptions du dossier.
 *     Les kilos sont deja sortis : rien au CMUP, la difference entre la valeur
 *     des kilos rendus et l'avoir va en « consomme ».
 * Saisi sur la page, avec un apercu avant d'enregistrer.
 */
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { Alerte, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Etiq, Selecteur } from '../../composants/ui/base'
import { fmt } from '../../lib/utils'
import { echec, nombre, useRafraichir } from './dialogues'
import type { DossierComplet } from './types'

type Nature = 'AVOIR_PRIX' | 'AVOIR_RETOUR'

interface Apercu {
  ecart_stock_dhs: number
  ecart_consomme_dhs: number
  valeur_retours_dhs?: number
  retours?: { numero_mouvement: string; code_reference: string; kg: number }[]
}

export function AvoirDossier({ d }: { d: DossierComplet }) {
  const rafraichir = useRafraichir(d.dossier.id_dossier)
  const retoursOuverts = (d.retours ?? []).filter((r) => !r.solde)
  const references = useMemo(
    () => [...new Set(d.lignes.filter((l) => l.type_ligne === 'ERP' && l.code_reference).map((l) => l.code_reference!))].sort(),
    [d.lignes],
  )
  const vide = { nature: 'AVOIR_PRIX' as Nature, numero_piece: '', montant_mad: '', motif: '', code_reference: '' }
  const [n, setN] = useState(vide)
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const maj = (k: keyof typeof n) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setN((x) => ({ ...x, [k]: e.target.value }))
    setApercu(null)
  }
  const corps = (simuler: boolean) => ({
    nature: n.nature,
    numero_piece: n.numero_piece.trim(),
    montant_mad: nombre(n.montant_mad),
    motif: n.motif.trim(),
    code_reference: n.nature === 'AVOIR_PRIX' && n.code_reference ? n.code_reference : null,
    simuler,
  })
  const voir = useMutation({
    mutationFn: () => api.post<Apercu>(`/api/import/dossiers/${d.dossier.id_dossier}/avoir`, corps(true)),
    onSuccess: setApercu,
    onError: echec,
  })
  const enregistrer = useMutation({
    mutationFn: () => api.post(`/api/import/dossiers/${d.dossier.id_dossier}/avoir`, corps(false)),
    onSuccess: () => {
      toast.success(n.nature === 'AVOIR_PRIX' ? 'Avoir de prix enregistré — CMUP du stock restant corrigé' : 'Avoir pour retour enregistré — retours soldés')
      setN(vide)
      setApercu(null)
      rafraichir()
    },
    onError: echec,
  })
  const complet = n.numero_piece.trim() !== '' && nombre(n.montant_mad) > 0 && n.motif.trim().length >= 5
    && (n.nature === 'AVOIR_PRIX' || retoursOuverts.length > 0)

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Avoir du fournisseur</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1">
            <Etiq htmlFor="ch-avoirdossier-1">Nature</Etiq>
            <Selecteur id="ch-avoirdossier-1" value={n.nature} onChange={maj('nature')}>
              <option value="AVOIR_PRIX">De prix (remise, marchandise gardée)</option>
              <option value="AVOIR_RETOUR">Pour retour</option>
            </Selecteur>
          </label>
          <label className="space-y-1">
            <Etiq htmlFor="ch-avoirdossier-2">N° de l’avoir</Etiq>
            <Champ id="ch-avoirdossier-2" value={n.numero_piece} onChange={maj('numero_piece')} />
          </label>
          <label className="space-y-1">
            <Etiq htmlFor="ch-avoirdossier-3">Montant (DH)</Etiq>
            <Champ id="ch-avoirdossier-3" inputMode="decimal" className="text-right tabular-nums" value={n.montant_mad} onChange={maj('montant_mad')} />
          </label>
          {n.nature === 'AVOIR_PRIX' && (
            <label className="space-y-1">
              <Etiq htmlFor="ch-avoirdossier-4">Référence visée</Etiq>
              <Selecteur id="ch-avoirdossier-4" value={n.code_reference} onChange={maj('code_reference')}>
                <option value="">Toutes, au prorata de la valeur</option>
                {references.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Selecteur>
            </label>
          )}
          <label className="space-y-1 lg:col-span-1">
            <Etiq htmlFor="ch-avoirdossier-5">Motif</Etiq>
            <Champ id="ch-avoirdossier-5" value={n.motif} onChange={maj('motif')} placeholder="5 caractères au moins" />
          </label>
        </div>

        {n.nature === 'AVOIR_RETOUR' &&
          (retoursOuverts.length === 0 ? (
            <Alerte ton="info">
              Aucun retour fournisseur non soldé sur les réceptions de ce dossier. Pour une remise ou une marchandise
              gardée, c’est un avoir de prix.
            </Alerte>
          ) : (
            <p className="text-[12.5px] text-attenue-texte">
              Soldera {retoursOuverts.length} retour(s) :{' '}
              {retoursOuverts.map((r) => `${r.numero_mouvement} (${r.code_reference}, ${fmt.nombre(r.kg, 2)} kg)`).join(' ; ')}
            </p>
          ))}

        {apercu && (
          <Alerte ton="info">
            {n.nature === 'AVOIR_PRIX' ? (
              <>
                Au CMUP du stock restant : <strong>{fmt.nombre(apercu.ecart_stock_dhs, 2)} DH</strong> ; part déjà
                sortie, en consommé : <strong>{fmt.nombre(apercu.ecart_consomme_dhs, 2)} DH</strong>.
              </>
            ) : (
              <>
                Valeur des kilos rendus : <strong>{fmt.nombre(apercu.valeur_retours_dhs ?? 0, 2)} DH</strong> ; écart
                avec l’avoir, en consommé : <strong>{fmt.nombre(apercu.ecart_consomme_dhs, 2)} DH</strong>. Le CMUP ne
                bouge pas.
              </>
            )}
          </Alerte>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="contour" disabled={!complet || voir.isPending} onClick={() => voir.mutate()}>
            Aperçu
          </Bouton>
          <Bouton disabled={!complet || !apercu || enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            Enregistrer l’avoir
          </Bouton>
        </div>
      </CarteCorps>
    </Carte>
  )
}

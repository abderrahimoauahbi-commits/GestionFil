/**
 * UN GESTE QUI DEFAIT DEMANDE POURQUOI.
 *
 * Contre-passer un mouvement, devalider un document, effacer une ligne de
 * referentiel : trois actes differents, une meme exigence. Ils reviennent sur
 * ce qui a ete decide, et celui qui relira le journal dans six mois n'aura que
 * le motif pour comprendre. Un bouton qui defait sans demander de raison
 * fabrique des trous dans l'histoire.
 *
 * LE DIALOGUE MONTRE D'ABORD CE QUI VA SE PASSER, en toutes lettres, puis
 * demande la raison. L'ordre compte : une question posee avant l'explication
 * n'obtient qu'une reponse machinale.
 *
 * LE BOUTON RESTE INERTE tant que le motif n'a pas cinq caracteres. Ce n'est
 * pas une tracasserie : « ok » et « erreur » n'apprennent rien, et le seul
 * moment ou l'on sait pourquoi on defait quelque chose, c'est maintenant.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ErreurApi } from '../api/client'
import { Bouton } from './ui/base'
import { Dialogue, DialogueContenu } from './ui/surcouches'

export function ActionMotivee({
  ouvert,
  surFermeture,
  titre,
  description,
  consequence,
  libelleBouton = 'Confirmer',
  chemin,
  invalider = [],
  surSucces,
}: {
  ouvert: boolean
  surFermeture: () => void
  titre: string
  description?: string
  /** CE QUI VA SE PASSER, dit avant qu'on demande quoi que ce soit. */
  consequence: React.ReactNode
  libelleBouton?: string
  /** La route qui recoit `{ motif }` en POST. */
  chemin: string
  /** Les caches a rafraichir une fois le geste passe. */
  invalider?: string[]
  surSucces?: (reponse: unknown) => void
}) {
  const [motif, setMotif] = useState('')
  const qc = useQueryClient()

  const agir = useMutation({
    mutationFn: () => api.post<unknown>(chemin, { motif: motif.trim() }),
    onSuccess: async (r) => {
      // TOUT SE RAFRAICHIT, pas seulement l'ecran courant : un mouvement
      // contre-passe change le stock, la valorisation et le plan d'achat. Ne
      // rafraichir que la page ouverte laisserait les autres mentir.
      await qc.invalidateQueries()
      for (const cle of invalider) await qc.invalidateQueries({ queryKey: [cle] })
      toast.success('C\'est fait', { description: titre })
      setMotif('')
      surFermeture()
      surSucces?.(r)
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  const assezLong = motif.trim().length >= 5

  return (
    <Dialogue
      open={ouvert}
      onOpenChange={(o) => {
        if (!o) {
          setMotif('')
          surFermeture()
        }
      }}
    >
      <DialogueContenu titre={titre} description={description}>
        <div className="flex flex-col gap-3 p-4">
          <div className="rounded-[var(--radius-sm)] border border-bordure bg-attenue/40 p-3
                          text-[13px] leading-relaxed">
            {consequence}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-texte">
              Pourquoi ? <span className="font-normal text-attenue-texte">(obligatoire)</span>
            </span>
            <textarea
              id="motif-action"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ex. : erreur de saisie du magasinier, le fournisseur a refusé le bon…"
              className="w-full rounded-[var(--radius-sm)] border border-bordure bg-surface px-2.5 py-2
                         text-[13px] outline-none focus:border-primaire/60"
            />
            <span className="text-[11px] text-attenue-texte">
              Cette phrase reste au journal, a cote de votre nom et de l'heure.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-bordure p-3">
          <Bouton variante="contour" taille="sm" onClick={surFermeture}>
            Annuler
          </Bouton>
          <Bouton
            taille="sm"
            variante="danger"
            disabled={!assezLong}
            chargement={agir.isPending}
            onClick={() => agir.mutate()}
          >
            {libelleBouton}
          </Bouton>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

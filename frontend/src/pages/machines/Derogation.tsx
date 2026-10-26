/**
 * DEMANDER UNE DEROGATION LA OU LE REFUS TOMBE (audit v4).
 *
 * Un lot bloque par la qualite ne se charge pas. La derogation existait en
 * base mais rien ne la proposait : on ne pouvait que prevenir quelqu'un. Sous
 * le refus, l'apercu liste les lots qu'une derogation debloquerait ; on la
 * demande ici, motif a l'appui. Un responsable (droit VALIDER des lots, ou la
 * Direction) l'accorde dans Lots → Autorisations ; elle sert alors une fois,
 * pour CE lot et CETTE fiche.
 *
 * Saisie sur la page, pas dans une fenetre.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Alerte, Bouton, Champ } from '../../composants/ui/base'
import { fmt } from '../../lib/utils'

export interface DerogationPossible {
  type_demande: string
  code_reference: string
  lot_fournisseur: string
  document: string
  /** Les kilos de ce lot sur la fiche : la derogation ne couvre que ceux-la. */
  kg: number
  id_demande_en_attente: string | null
}

export function DemandesDerogation({ derogations, surDemande }: { derogations: DerogationPossible[]; surDemande: () => void }) {
  const { peut } = useAuth()
  const [motifs, setMotifs] = useState<Record<string, string>>({})
  const [envoi, setEnvoi] = useState<string | null>(null)
  if (derogations.length === 0) return null
  const cle = (d: DerogationPossible) => `${d.code_reference}\u0001${d.lot_fournisseur}`

  async function demander(d: DerogationPossible) {
    setEnvoi(cle(d))
    try {
      await api.post('/api/autorisations', {
        type_demande: d.type_demande,
        niveau: 'ROUGE',
        code_reference: d.code_reference,
        lot_fournisseur: d.lot_fournisseur,
        document: d.document,
        kg: d.kg,
        motif: (motifs[cle(d)] ?? '').trim(),
      })
      toast.success('Dérogation demandée', { description: 'Un responsable la tranchera dans Lots → Autorisations.' })
      surDemande()
    } catch (e) {
      toast.error(e instanceof ErreurApi ? e.message : 'Demande impossible.')
    } finally {
      setEnvoi(null)
    }
  }

  return (
    <Alerte ton="alerte" className="mt-2 px-2.5 py-2.5 text-[12.5px]">
      <div className="space-y-2">
      <p className="font-medium">
        Lot bloqué : une dérogation peut autoriser ce chargement, une fois, pour les kilos de la fiche.
      </p>
      {derogations.map((d) => (
        <div key={cle(d)} className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{d.code_reference}</span>
          <span className="text-attenue-texte">lot {d.lot_fournisseur}</span>
          <span className="tabular-nums">{fmt.nombre(d.kg, 1)} kg</span>
          {d.id_demande_en_attente ? (
            <span className="text-alerte">demande en attente d’un responsable (Lots → Autorisations)</span>
          ) : peut('LOTS', 'ECRIRE') || peut('MOUVEMENTS', 'ECRIRE') ? (
            <>
              <Champ className="h-7 w-72 text-[12.5px]" placeholder="Motif (obligatoire)"
                value={motifs[cle(d)] ?? ''} onChange={(e) => setMotifs((m) => ({ ...m, [cle(d)]: e.target.value }))} />
              <Bouton taille="sm" variante="contour" disabled={(motifs[cle(d)] ?? '').trim().length < 5}
                chargement={envoi === cle(d)} onClick={() => void demander(d)}>
                Demander une dérogation
              </Bouton>
            </>
          ) : (
            <span className="text-attenue-texte">prévenez un responsable des lots</span>
          )}
        </div>
      ))}
      </div>
    </Alerte>
  )
}

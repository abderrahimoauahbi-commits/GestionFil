/**
 * Panneau bas : ce que l'editeur appelle « Problemes » et « Sortie ».
 *
 * Deux onglets seulement, et tous deux portent des faits verifiables :
 * les controles de coherence en anomalie, et le journal d'audit. Un panneau
 * bas qui afficherait des messages decoratifs ne serait jamais consulte.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { cn } from '../../lib/utils'
import { VueControles, type Controle } from './Lateral'

export type OngletBas = 'controles' | 'journal'

interface LigneAudit {
  id_audit: number
  table_concernee: string
  operation: string
  id_enregistrement: string | null
  date_operation: string
  auteur: string | null
}

export function PanneauBas({
  onglet,
  definirOnglet,
  controles,
  ouvrir,
  fermer,
  maximise,
  basculerMaximise,
}: {
  onglet: OngletBas
  definirOnglet: (o: OngletBas) => void
  controles: Controle[]
  ouvrir: (chemin: string, apercu: boolean) => void
  fermer: () => void
  maximise: boolean
  basculerMaximise: () => void
}) {
  const { peut } = useAuth()
  const peutAudit = peut('AUDIT', 'LIRE')
  const anomalies = controles.filter((c) => c.anomalies > 0).length

  const onglets: { id: OngletBas; libelle: string; compte?: number }[] = [
    { id: 'controles', libelle: 'Controles', compte: anomalies },
    ...(peutAudit ? [{ id: 'journal' as const, libelle: 'Journal' }] : []),
  ]

  return (
    <section
      aria-label="Panneau inferieur"
      className="flex min-h-0 flex-1 flex-col border-t border-bordure bg-[hsl(var(--at-panneau))]"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-bordure px-2">
        {onglets.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => definirOnglet(o.id)}
            aria-selected={onglet === o.id}
            className={cn(
              'relative px-2 py-1.5 text-[11px] uppercase tracking-[0.08em] transition-colors',
              onglet === o.id
                ? 'text-texte'
                : 'text-attenue-texte hover:text-texte',
            )}
          >
            {o.libelle}
            {o.compte !== undefined && o.compte > 0 && (
              <span
                className="ml-1.5 rounded-full bg-[hsl(var(--at-badge))] px-1.5 py-px text-[9px]
                           font-semibold tracking-normal text-[hsl(var(--at-badge-texte))]"
              >
                {o.compte}
              </span>
            )}
            {onglet === o.id && (
              <span className="absolute inset-x-2 bottom-0 h-px bg-texte" />
            )}
          </button>
        ))}

        <div className="flex-1" />

        <button
          type="button"
          onClick={basculerMaximise}
          aria-label={maximise ? 'Restaurer le panneau' : 'Agrandir le panneau'}
          className="grid size-5 place-items-center rounded-[2px] text-attenue-texte
                     hover:bg-[hsl(var(--at-liste-survol))] hover:text-texte"
        >
          {maximise ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
        <button
          type="button"
          onClick={fermer}
          aria-label="Masquer le panneau"
          className="grid size-5 place-items-center rounded-[2px] text-attenue-texte
                     hover:bg-[hsl(var(--at-liste-survol))] hover:text-texte"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {onglet === 'controles' && <VueControles controles={controles} ouvrir={ouvrir} />}
        {onglet === 'journal' && peutAudit && <VueJournal />}
      </div>
    </section>
  )
}

function VueJournal() {
  const q = useQuery({
    queryKey: ['atelier-journal'],
    queryFn: () => api.get<LigneAudit[]>('/api/audit?limite=200'),
    staleTime: 60_000,
  })

  if (q.isLoading) {
    return <p className="px-3 py-2 text-[12px] text-attenue-texte">Chargement…</p>
  }
  if (!q.data?.length) {
    return <p className="px-3 py-2 text-[12px] text-attenue-texte">Journal vide.</p>
  }

  return (
    <table className="w-full font-mono text-[11px]">
      <tbody>
        {q.data.map((l) => (
          <tr key={l.id_audit} className="hover:bg-[hsl(var(--at-liste-survol))]">
            <td className="whitespace-nowrap py-[3px] pl-3 pr-3 text-attenue-texte">
              {l.date_operation?.slice(0, 19).replace('T', ' ')}
            </td>
            <td className="whitespace-nowrap pr-3 text-attenue-texte">{l.auteur ?? '—'}</td>
            <td className="whitespace-nowrap pr-3">
              <span
                className={cn(
                  l.operation === 'DELETE'
                    ? 'text-danger'
                    : l.operation === 'INSERT'
                      ? 'text-succes'
                      : 'text-alerte',
                )}
              >
                {l.operation}
              </span>
            </td>
            <td className="pr-3 text-texte">{l.table_concernee}</td>
            <td className="w-full truncate pr-3 text-attenue-texte">
              {l.id_enregistrement ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

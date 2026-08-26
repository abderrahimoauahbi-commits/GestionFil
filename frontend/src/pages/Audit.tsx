/**
 * Journal d'audit.
 *
 * Reserve a la Direction et a la DAF : le serveur refuse `/api/audit` aux
 * autres roles, l'ecran ne fait que refleter cette regle.
 *
 * Un avertissement est affiche en tete, et il n'est pas decoratif : ce journal
 * enregistre les changements de **statut et de referentiel**, pas les
 * quantites ni les montants. Le jour ou quinze tonnes manqueront, il dira qui a
 * modifie un libelle. Le presenter comme une piste d'audit complete serait
 * trompeur, et c'est le genre de promesse qui fait cesser de verifier.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Squelette } from '../composants/ui/base'
import { cn } from '../lib/utils'

interface LigneAudit {
  id_audit: number
  table_concernee: string
  operation: string
  id_enregistrement: string | null
  date_operation: string
  auteur: string | null
  anciennes_valeurs: string | null
  nouvelles_valeurs: string | null
}

const TEINTE: Record<string, string> = {
  INSERT: 'text-succes',
  UPDATE: 'text-alerte',
  DELETE: 'text-danger',
}

export function Audit() {
  const { peut } = useAuth()
  const [recherche, setRecherche] = useState('')
  const [operation, setOperation] = useState<string>('')
  const [ouvert, setOuvert] = useState<number | null>(null)

  const q = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<LigneAudit[]>('/api/audit?limite=1000'),
    enabled: peut('AUDIT', 'LIRE'),
  })

  const lignes = useMemo(() => {
    const t = recherche.trim().toLowerCase()
    return (q.data ?? []).filter((l) => {
      if (operation && l.operation !== operation) return false
      if (!t) return true
      return (
        l.table_concernee.toLowerCase().includes(t) ||
        (l.auteur ?? '').toLowerCase().includes(t) ||
        (l.id_enregistrement ?? '').toLowerCase().includes(t)
      )
    })
  }, [q.data, recherche, operation])

  const operations = useMemo(
    () => [...new Set((q.data ?? []).map((l) => l.operation))].sort(),
    [q.data],
  )

  if (!peut('AUDIT', 'LIRE')) {
    return (
      <Alerte ton="danger" titre="Acces refuse">
        Le journal d'audit est reserve a la Direction et a la DAF.
      </Alerte>
    )
  }
  if (q.isLoading) return <Squelette className="h-96 w-full" />

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Journal d'audit"
        description={`${(q.data ?? []).length} entrees les plus recentes`}
      />

      <Alerte ton="alerte" titre="Ce journal ne trace pas les valeurs">
        Il enregistre les changements de statut et de referentiel, avec leur auteur et leur date.
        Il ne contient <strong>ni quantite, ni prix, ni mouvement de stock</strong> : ce n'est pas
        une piste d'audit complete au sens comptable. L'etendre aux valeurs est un prealable a
        tout audit externe.
      </Alerte>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Table, auteur, identifiant"
          className="h-7 w-64 rounded-[3px] border border-champ bg-surface px-2 text-[12px]
                     outline-none focus:border-primaire"
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setOperation('')}
            className={cn(
              'rounded-[3px] border px-2 py-1 text-[12px]',
              operation === ''
                ? 'border-primaire bg-primaire text-primaire-texte'
                : 'border-bordure text-attenue-texte hover:bg-attenue',
            )}
          >
            Toutes
          </button>
          {operations.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOperation(o)}
              className={cn(
                'rounded-[3px] border px-2 py-1 text-[12px]',
                operation === o
                  ? 'border-primaire bg-primaire text-primaire-texte'
                  : 'border-bordure text-attenue-texte hover:bg-attenue',
              )}
            >
              {o}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-attenue-texte">{lignes.length} affichees</span>
      </div>

      <div className="defilement-x rounded-[var(--radius)] border border-bordure bg-surface">
        <table className="grille w-full text-[12px]">
          <thead className="bg-attenue">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Date</th>
              <th className="px-2 py-1.5 text-left font-medium">Auteur</th>
              <th className="px-2 py-1.5 text-left font-medium">Operation</th>
              <th className="px-2 py-1.5 text-left font-medium">Table</th>
              <th className="px-2 py-1.5 text-left font-medium">Enregistrement</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <>
                <tr
                  key={l.id_audit}
                  onClick={() => setOuvert(ouvert === l.id_audit ? null : l.id_audit)}
                  className="cursor-pointer hover:bg-attenue/60"
                >
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-attenue-texte">
                    {l.date_operation?.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{l.auteur ?? '—'}</td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-2 py-1 font-medium',
                      TEINTE[l.operation] ?? 'text-attenue-texte',
                    )}
                  >
                    {l.operation}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono">{l.table_concernee}</td>
                  <td className="px-2 py-1 font-mono text-attenue-texte">
                    {l.id_enregistrement ?? '—'}
                  </td>
                </tr>
                {ouvert === l.id_audit && (
                  <tr key={`${l.id_audit}-detail`}>
                    <td colSpan={5} className="bg-attenue/40 px-2 py-2">
                      <div className="grid gap-2 lg:grid-cols-2">
                        <Valeurs titre="Avant" json={l.anciennes_valeurs} />
                        <Valeurs titre="Apres" json={l.nouvelles_valeurs} />
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Valeurs({ titre, json }: { titre: string; json: string | null }) {
  let contenu = json
  try {
    if (json) contenu = JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    /* la colonne peut contenir autre chose que du JSON : on l'affiche brute */
  }
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-attenue-texte">{titre}</div>
      <pre className="defilement-x max-h-48 overflow-y-auto rounded-[3px] border border-bordure bg-surface p-2 font-mono text-[11px]">
        {contenu ?? '—'}
      </pre>
    </div>
  )
}

/**
 * Assistant de direction.
 *
 * Une question, une reponse chiffree, un lien vers l'ecran ou agir.
 *
 * L'ecran dit ce qu'il est : un **catalogue ferme**. Il n'interprete pas une
 * question libre, il l'apparie a ce qu'il connait. Presenter cela comme une
 * intelligence generale serait une promesse intenable — et le jour ou elle
 * repondrait a cote sur une question de stock, plus personne ne lui ferait
 * confiance sur les autres.
 *
 * Rien ne sort de la machine, rien ne s'ecrit. Les chiffres viennent des memes
 * vues que les ecrans, donc ils ne peuvent pas diverger d'eux.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Search, Sparkles } from 'lucide-react'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Squelette } from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'

interface EntreeCatalogue {
  id: string
  libelle: string
  theme: string
  lien: string
}

interface Reponse {
  id: string
  question: string
  theme: string
  reponse: string
  chiffres: Record<string, unknown> | null
  detail: Record<string, unknown>[]
  lien: string
}

export function Assistant() {
  const { moi } = useAuth()
  const naviguer = useNavigate()
  const [saisie, setSaisie] = useState('')
  const [demande, setDemande] = useState<string | null>(null)

  const qCatalogue = useQuery({
    queryKey: ['assistant-catalogue'],
    queryFn: () => api.get<{ questions: EntreeCatalogue[] }>('/api/assistant'),
    retry: false,
  })

  const qReponse = useQuery({
    queryKey: ['assistant', demande],
    queryFn: () => api.get<Reponse>(`/api/assistant/${encodeURIComponent(demande as string)}`),
    enabled: demande !== null,
    retry: false,
  })

  const questions = qCatalogue.data?.questions ?? []

  const parTheme = useMemo(() => {
    const m = new Map<string, EntreeCatalogue[]>()
    for (const q of questions) m.set(q.theme, [...(m.get(q.theme) ?? []), q])
    return [...m.entries()]
  }, [questions])

  /* Le refus de droits est une reponse legitime, pas une panne : le serveur
     reserve l'assistant a la Direction, et l'ecran le dit dans ces termes. */
  if (qCatalogue.isError) {
    const e = qCatalogue.error as ErreurApi
    return (
      <Alerte ton="danger" titre="Assistant reserve a la Direction">
        {e?.estNonAutorise
          ? `Votre role (${moi?.role ?? '—'}) n'a pas acces a l'assistant. Il lit des donnees
             consolidees — valorisation, marges fournisseurs, journal — que la grille de droits
             masque pour les autres roles.`
          : String(e?.message ?? e)}
      </Alerte>
    )
  }
  if (qCatalogue.isLoading) return <Squelette className="h-96 w-full" />

  const poser = (v: string) => {
    const t = v.trim()
    if (t) setDemande(t)
  }

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Assistant"
        description="Questions sur l'etat du systeme — reponses calculees sur vos vues, en lecture seule"
      />

      {/* --- Poser une question ------------------------------------------- */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          poser(saisie)
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-attenue-texte" />
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Ou en est le stock ? Y a-t-il des anomalies ? Qu'y a-t-il a commander ?"
            className="h-9 w-full rounded-[var(--radius)] border border-champ bg-surface pl-8 pr-3
                       text-[13px] outline-none focus:border-primaire"
          />
        </div>
        <button
          type="submit"
          className="rounded-[var(--radius)] bg-primaire px-3 text-[13px] font-medium
                     text-primaire-texte hover:opacity-90"
        >
          Demander
        </button>
      </form>

      {/* --- La reponse ---------------------------------------------------- */}
      {demande !== null && (
        <div className="rounded-[var(--radius)] border border-bordure bg-surface p-4">
          {qReponse.isLoading ? (
            <Squelette className="h-20 w-full" />
          ) : qReponse.isError ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-alerte">
                Je ne connais pas cette question.
              </p>
              <p className="text-[12px] text-attenue-texte">
                L'assistant repond a un catalogue ferme, il ne devine pas. Choisissez une question
                ci-dessous, ou reformulez avec un mot du catalogue — <em>rupture</em>,{' '}
                <em>couverture</em>, <em>anomalie</em>, <em>valeur</em>, <em>fournisseur</em>,{' '}
                <em>commander</em>, <em>inventaire</em>.
              </p>
            </div>
          ) : qReponse.data ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primaire" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-attenue-texte">
                    {qReponse.data.theme} · {qReponse.data.question}
                  </p>
                  <p className="mt-0.5 text-[15px] leading-snug text-texte">
                    {qReponse.data.reponse}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => naviguer(qReponse.data!.lien)}
                  className="flex shrink-0 items-center gap-1 rounded-[3px] border border-bordure
                             px-2 py-1 text-[12px] text-texte hover:bg-attenue"
                >
                  Ouvrir l'ecran
                  <ArrowRight className="size-3.5" />
                </button>
              </div>

              {qReponse.data.detail.length > 0 && (
                <TableauDetail lignes={qReponse.data.detail} />
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* --- Le catalogue -------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-wide text-attenue-texte">
          Ce que je sais repondre
        </p>
        {parTheme.map(([theme, entrees]) => (
          <div key={theme} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-[11px] text-attenue-texte">{theme}</span>
            {entrees.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  setSaisie(q.libelle)
                  setDemande(q.id)
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  qReponse.data?.id === q.id
                    ? 'border-primaire bg-primaire text-primaire-texte'
                    : 'border-bordure text-attenue-texte hover:bg-attenue hover:text-texte',
                )}
              >
                {q.libelle}
              </button>
            ))}
          </div>
        ))}
      </div>

      <Alerte ton="info" titre="Ce que fait cet assistant, et ce qu'il ne fait pas">
        Il interroge les memes vues que les ecrans : ses chiffres ne peuvent pas diverger des
        leurs. <strong>Rien ne sort de cette machine</strong> — aucun appel a un service externe,
        vos stocks et vos prix restent ici. Et il est en <strong>lecture seule</strong> : il ne
        valide rien, ne commande rien, n'ecrit rien. Il repond et vous emmene au bon ecran.
      </Alerte>
    </div>
  )
}

/** Detail generique : les colonnes viennent de la reponse, pas d'un schema fige. */
function TableauDetail({ lignes }: { lignes: Record<string, unknown>[] }) {
  const colonnes = Object.keys(lignes[0] ?? {})
  const estNombre = (v: unknown) => typeof v === 'number'

  return (
    <div className="defilement-x max-h-80 overflow-y-auto rounded-[3px] border border-bordure">
      <table className="grille w-full text-[12px]">
        <thead className="sticky top-0 bg-attenue">
          <tr>
            {colonnes.map((c) => (
              <th
                key={c}
                className={cn(
                  'px-2 py-1.5 font-medium',
                  estNombre(lignes[0][c]) ? 'text-right' : 'text-left',
                )}
              >
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="hover:bg-attenue/60">
              {colonnes.map((c) => (
                <td
                  key={c}
                  className={cn(
                    'px-2 py-1',
                    estNombre(l[c]) ? 'text-right tabular-nums' : 'text-attenue-texte',
                  )}
                >
                  {l[c] == null
                    ? '—'
                    : estNombre(l[c])
                      ? fmt.nombre(l[c] as number)
                      : String(l[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

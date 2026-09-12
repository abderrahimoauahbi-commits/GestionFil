/**
 * LE ROBOT DE CONNEXION — ce qui attend l'utilisateur, des qu'il ouvre.
 *
 * Il se declenche A LA CONNEXION, une fois par session, et se rouvre par son
 * bouton dans le bandeau. Il ne montre que ce que cet utilisateur peut traiter
 * (le serveur filtre par ses droits) et chaque ligne mene a l'ecran ou l'on
 * agit : un rappel qui ne dit pas ou aller fait perdre le temps qu'il pretend
 * gagner.
 *
 * IL NE PARLE PAS A UN MODELE DE LANGAGE. Ce sont des comptes, calcules par la
 * base : il s'affiche en moins d'une seconde, meme moteur local arrete. La
 * conversation, elle, reste dans l'ecran Assistant.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Check, ChevronRight, X } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useOuvrirVue } from '../lib/navigation'
import { cn } from '../lib/utils'
import { Bouton } from './ui/base'

const CLE_VU = 'gestionfil.robot.vu'

interface Point {
  cle: string
  titre: string
  nombre: number
  ton: 'info' | 'alerte' | 'danger' | 'succes'
  chemin: string
  detail: string
}

interface Briefing {
  utilisateur: string
  role: string
  points: Point[]
}

const TON: Record<Point['ton'], string> = {
  info: 'text-info',
  alerte: 'text-alerte',
  danger: 'text-danger',
  succes: 'text-succes',
}

/** « Bonjour », « Bonsoir » : l'heure du poste suffit. */
function salutation() {
  const h = new Date().getHours()
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

export function RobotConnexion() {
  const { moi } = useAuth()
  const ouvrir = useOuvrirVue()
  const [ouvert, setOuvert] = useState(false)

  const q = useQuery({
    queryKey: ['briefing'],
    queryFn: () => api.get<Briefing>('/api/briefing'),
    enabled: !!moi,
    staleTime: 5 * 60_000,
  })

  // A LA CONNEXION, une fois : le drapeau vit dans la session, comme le jeton.
  // Il disparait donc avec l'onglet, et le robot revient a la prochaine
  // ouverture — pas a chaque changement d'ecran.
  useEffect(() => {
    if (!moi || !q.data) return
    try {
      if (sessionStorage.getItem(CLE_VU)) return
      sessionStorage.setItem(CLE_VU, '1')
    } catch {
      // Session storage refuse (navigation privee) : on ouvre quand meme.
    }
    setOuvert(true)
  }, [moi, q.data])

  if (!moi) return null

  const points = q.data?.points ?? []
  const urgents = points.filter((p) => p.ton === 'danger' || p.ton === 'alerte').length

  return (
    <>
      {/* Ferme, le robot reste a portee : une pastille au coin, au-dessus de la
          barre du telephone. Il ne recouvre jamais la saisie. */}
      {!ouvert && (
        <button
          type="button"
          onClick={() => setOuvert(true)}
          title="Ce qui vous attend"
          aria-label="Ce qui vous attend"
          data-robot-bouton
          className="fixed right-4 z-40 grid size-11 place-items-center rounded-full border border-bordure bg-surface text-primaire shadow-lg transition-transform hover:scale-105"
          style={{ bottom: 'calc(1rem + var(--barre-basse, 0px))' }}
        >
          <Bot className="size-5" />
          {urgents > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-alerte text-[10px] font-semibold text-white">
              {urgents}
            </span>
          )}
        </button>
      )}

      {ouvert && (
        <div
          data-robot
          className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface shadow-lg"
          style={{ bottom: 'calc(1rem + var(--barre-basse, 0px))' }}
        >
          <div className="flex items-start gap-2 border-b border-bordure bg-attenue/40 px-3 py-2">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primaire/10 text-primaire">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">
                {salutation()} {moi.login}
              </div>
              <div className="text-[11.5px] text-attenue-texte">
                {points.length === 0
                  ? 'Rien ne vous attend. Bonne journée.'
                  : `${points.length} point(s) à regarder`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              aria-label="Fermer"
              className="rounded p-1 text-attenue-texte hover:bg-attenue hover:text-texte"
            >
              <X className="size-4" />
            </button>
          </div>

          <ul className="max-h-[60vh] divide-y divide-bordure/60 overflow-y-auto">
            {q.isLoading && (
              <li className="px-3 py-3 text-[12.5px] text-attenue-texte">Je regarde…</li>
            )}
            {!q.isLoading && points.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-succes">
                <Check className="size-4" />
                Aucun retard, aucune anomalie ouverte.
              </li>
            )}
            {points.map((p) => (
              <li key={p.cle}>
                <button
                  type="button"
                  onClick={() => {
                    setOuvert(false)
                    ouvrir(p.chemin)
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-attenue/40"
                >
                  <span className={cn('w-10 shrink-0 text-right text-[15px] font-semibold tabular-nums', TON[p.ton])}>
                    {p.nombre}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px]">{p.titre}</span>
                    {p.detail && (
                      <span className="block text-[11px] text-attenue-texte">{p.detail}</span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-attenue-texte" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex justify-end gap-2 border-t border-bordure px-3 py-2">
            <Bouton taille="sm" variante="contour" onClick={() => setOuvert(false)}>
              Fermer
            </Bouton>
          </div>
        </div>
      )}
    </>
  )
}

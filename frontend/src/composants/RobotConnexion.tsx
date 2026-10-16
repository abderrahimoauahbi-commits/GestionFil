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
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
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
    queryFn: ({ signal }) => api.get<Briefing>('/api/briefing', { signal }),
    enabled: !!moi,
    staleTime: 5 * 60_000,
  })

  // A LA CONNEXION, une fois : le drapeau vit dans la session, comme le jeton.
  // Il disparait donc avec l'onglet, et le robot revient a la prochaine
  // ouverture — pas a chaque changement d'ecran.
  // Sur l'accueil seulement : arrive par un lien ou un rechargement sur une
  // fiche, le panneau couvrirait ses boutons — la pastille du bandeau suffit.
  const { pathname } = useLocation()
  useEffect(() => {
    if (!moi || !q.data || pathname !== '/') return
    try {
      if (sessionStorage.getItem(CLE_VU)) return
      sessionStorage.setItem(CLE_VU, '1')
    } catch {
      // Session storage refuse (navigation privee) : on ouvre quand meme.
    }
    setOuvert(true)
  }, [moi, q.data, pathname])

  // Echap referme, comme tout panneau de l'application.
  useEffect(() => {
    if (!ouvert) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setOuvert(false)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [ouvert])

  // LE PANNEAU NE GARDE PLUS LES BOUTONS DE L'ECRAN (08/10/2026). Ouvert a la
  // connexion en haut a droite, il restait pose sur la barre d'actions de la
  // page suivante — « Valider le controle » d'une reception etait dessous, et
  // le clic tombait sur le panneau. Il se referme desormais quand on change
  // d'ecran et quand on clique ailleurs.
  const ecranOuverture = useRef(pathname)
  useEffect(() => {
    if (pathname !== ecranOuverture.current) {
      ecranOuverture.current = pathname
      setOuvert(false)
    }
  }, [pathname])
  useEffect(() => {
    if (!ouvert) return
    const f = (e: PointerEvent) => {
      const cible = e.target as Element | null
      if (cible?.closest?.('[data-robot], [data-robot-bouton]')) return
      setOuvert(false)
    }
    document.addEventListener('pointerdown', f)
    return () => document.removeEventListener('pointerdown', f)
  }, [ouvert])

  if (!moi) return null

  const points = q.data?.points ?? []
  const urgents = points.filter((p) => p.ton === 'danger' || p.ton === 'alerte').length

  return (
    <>
      {/* LE BOUTON VIT DANS LE BANDEAU, PAS AU COIN DE L'ECRAN.
          Pastille flottante en bas a droite, il se posait au telephone sur la
          derniere page de la pagination et sur « Enregistrer » ; chaque ecran
          devait lui menager une marge. Dans le bandeau, a cote des alertes, il
          ne recouvre plus rien et se trouve la ou l'on cherche les rappels. */}
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        title="Ce qui vous attend"
        aria-label={`Ce qui vous attend${urgents ? ` (${urgents} urgent(s))` : ''}`}
        aria-expanded={ouvert}
        data-robot-bouton
        className={cn(
          'relative grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-attenue hover:text-texte',
          ouvert ? 'bg-attenue text-texte' : 'text-attenue-texte',
        )}
      >
        <Bot className="size-4" />
        {urgents > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full bg-alerte px-1 text-[9px] font-semibold leading-[14px] text-white">
            {urgents}
          </span>
        )}
      </button>

      {/* Le panneau s'ouvre SOUS le bandeau, rendu a la racine du document :
          le bandeau forme son propre empilement, et la barre du telephone
          passerait sinon par-dessus. */}
      {ouvert && createPortal(
        <div
          data-robot
          role="dialog"
          aria-label="Ce qui vous attend"
          className="sans-impression fixed right-2 top-14 z-50 w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-levee)]"
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

          <ul className="max-h-[min(60vh,28rem)] divide-y divide-bordure/60 overflow-y-auto">
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
        </div>,
        document.body,
      )}
    </>
  )
}

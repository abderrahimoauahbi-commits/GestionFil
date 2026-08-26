/**
 * Barre d'etat.
 *
 * Vingt-deux pixels, et rien qui ne soit actionnable ou factuel. Le bloc
 * colore de gauche joue le role de l'indicateur distant de l'editeur : il dit
 * d'un coup d'oeil sous quelle identite on travaille, ce qui evite de valider
 * un bon de commande en croyant etre magasinier.
 */
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Moon, RefreshCw, Sun, WifiOff } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useTheme } from '../Theme'
import { cn } from '../../lib/utils'
import type { Controle } from './Lateral'

export function BarreEtat({
  controles,
  ouvrirControles,
  rafraichir,
  version,
}: {
  controles: Controle[]
  ouvrirControles: () => void
  rafraichir: () => void
  version: string
}) {
  const { moi } = useAuth()
  const { resolu, definir } = useTheme()

  /* Sonde de disponibilite. Le mode bureau est toujours relie au serveur : si
     la sonde tombe, l'utilisateur doit le savoir avant de saisir une pesee. */
  const sante = useQuery({
    queryKey: ['atelier-sante'],
    queryFn: () => api.get<unknown>('/api/sante'),
    refetchInterval: 30_000,
    retry: false,
    staleTime: 0,
  })

  const enAnomalie = controles.filter((c) => c.anomalies > 0)
  const bloquantes = enAnomalie.filter(
    (c) => c.criticite === 'BLOQUANT' || c.criticite === 'CRITIQUE',
  ).length
  const horsLigne = sante.isError

  return (
    <footer
      className="flex h-[var(--at-h-etat)] shrink-0 items-stretch justify-between
                 border-t border-bordure bg-[hsl(var(--at-etat))] text-[11px]"
    >
      <div className="flex items-stretch">
        {/* Identite : bloc plein, comme l'indicateur distant de l'editeur. */}
        <span
          className={cn(
            'flex items-center gap-1.5 px-2 font-medium',
            horsLigne
              ? 'bg-danger text-danger-texte'
              : 'bg-primaire text-primaire-texte',
          )}
        >
          {horsLigne ? <WifiOff className="size-3" /> : <Check className="size-3" />}
          {moi?.login ?? '—'} · {moi?.role ?? '—'}
        </span>

        <BoutonEtat onClick={ouvrirControles}>
          {enAnomalie.length === 0 ? (
            <>
              <Check className="size-3 text-succes" />
              29 controles au vert
            </>
          ) : (
            <>
              <AlertTriangle
                className={cn('size-3', bloquantes ? 'text-danger' : 'text-alerte')}
              />
              {enAnomalie.length} controle{enAnomalie.length > 1 ? 's' : ''} en anomalie
              {bloquantes > 0 && ` · ${bloquantes} bloquant${bloquantes > 1 ? 's' : ''}`}
            </>
          )}
        </BoutonEtat>

        <BoutonEtat onClick={rafraichir} etiquette="Rafraichir les donnees">
          <RefreshCw className={cn('size-3', sante.isFetching && 'animate-spin')} />
          Rafraichir
        </BoutonEtat>
      </div>

      <div className="flex items-stretch">
        <BoutonEtat
          onClick={() => definir(resolu === 'sombre' ? 'clair' : 'sombre')}
          etiquette="Changer de theme"
        >
          {resolu === 'sombre' ? <Moon className="size-3" /> : <Sun className="size-3" />}
          {resolu === 'sombre' ? 'Sombre' : 'Clair'}
        </BoutonEtat>
        <span className="flex items-center px-2 text-attenue-texte">Gestion Fil {version}</span>
      </div>
    </footer>
  )
}

function BoutonEtat({
  onClick,
  etiquette,
  children,
}: {
  onClick: () => void
  etiquette?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={etiquette}
      className="flex items-center gap-1.5 px-2 text-texte/85 transition-colors
                 hover:bg-[hsl(var(--at-liste-survol))] hover:text-texte"
    >
      {children}
    </button>
  )
}

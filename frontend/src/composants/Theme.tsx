/**
 * Theme clair / sombre / systeme.
 *
 * Le choix est persiste et applique avant le premier rendu (voir le script
 * inline de index.html) : sans cela, un utilisateur en mode sombre voit un
 * eclair blanc a chaque chargement.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type Theme = 'clair' | 'sombre' | 'systeme'

const CLE = 'gestionfil.theme'

interface Contexte {
  theme: Theme
  resolu: 'clair' | 'sombre'
  definir: (t: Theme) => void
}

const ThemeContext = createContext<Contexte | null>(null)

function preferenceSysteme(): 'clair' | 'sombre' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'sombre' : 'clair'
}

export function FournisseurTheme({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(CLE) as Theme) || 'systeme',
  )
  const [resolu, setResolu] = useState<'clair' | 'sombre'>(() =>
    theme === 'systeme' ? preferenceSysteme() : theme,
  )

  useEffect(() => {
    const appliquer = () => {
      const effectif = theme === 'systeme' ? preferenceSysteme() : theme
      setResolu(effectif)
      document.documentElement.classList.toggle('sombre', effectif === 'sombre')
    }
    appliquer()

    if (theme !== 'systeme') return
    // Suit les changements de preference du systeme tant qu'aucun choix
    // explicite n'a ete fait.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', appliquer)
    return () => mq.removeEventListener('change', appliquer)
  }, [theme])

  const definir = useCallback((t: Theme) => {
    localStorage.setItem(CLE, t)
    setTheme(t)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolu, definir }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme() {
  const c = useContext(ThemeContext)
  if (!c) throw new Error('useTheme doit etre utilise dans un FournisseurTheme')
  return c
}

/**
 * Contexte d'authentification et de droits.
 *
 * `/api/auth/moi` renvoie la grille COMPLETE de l'utilisateur : accès module et
 * niveau par champ. L'interface s'en sert pour ne rendre que ce qui est visible
 * et ne rendre modifiable que ce qui l'est.
 *
 * Ce n'est PAS une mesure de securite : le serveur applique la meme grille en
 * sortie comme en entree. L'interface evite simplement a l'utilisateur de
 * saisir ce qui sera de toute facon refuse.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, jeton } from '../api/client'

export type Niveau = 'MASQUE' | 'LECTURE' | 'ECRITURE'
export type ActionModule = 'LIRE' | 'ECRIRE' | 'VALIDER'

export interface Moi {
  id: string
  login: string
  role: string
  plafond_validation_bc_mad: number | null
  permissions: { module: string; action: ActionModule }[]
  droits_champ: Record<string, Record<string, Niveau>>
}

interface Contexte {
  moi: Moi | null
  chargement: boolean
  connecter: (login: string, motDePasse: string) => Promise<void>
  deconnecter: () => void
  /** L'utilisateur a-t-il cette action sur ce module ? */
  peut: (module: string, action: ActionModule) => boolean
  /** Niveau de visibilite d'un champ. */
  niveau: (module: string, champ: string) => Niveau
  /** Champ affichable ? */
  visible: (module: string, champ: string) => boolean
  /** Champ modifiable ? Exige aussi le droit ECRIRE sur le module. */
  modifiable: (module: string, champ: string) => boolean
}

const AuthContext = createContext<Contexte | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [moi, setMoi] = useState<Moi | null>(null)
  const [chargement, setChargement] = useState(true)

  const charger = useCallback(async () => {
    if (!jeton.lire()) {
      setMoi(null)
      setChargement(false)
      return
    }
    try {
      setMoi(await api.get<Moi>('/api/auth/moi'))
    } catch {
      jeton.effacer()
      setMoi(null)
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => {
    void charger()
  }, [charger])

  const connecter = useCallback(
    async (login: string, motDePasse: string) => {
      const r = await api.post<{ jeton: string }>('/api/auth/connexion', {
        login,
        mot_de_passe: motDePasse,
      })
      jeton.ecrire(r.jeton)
      setChargement(true)
      await charger()
    },
    [charger],
  )

  const deconnecter = useCallback(() => {
    jeton.effacer()
    setMoi(null)
  }, [])

  const valeur = useMemo<Contexte>(() => {
    const peut = (module: string, action: ActionModule) =>
      !!moi?.permissions.some((p) => p.module === module && p.action === action)

    const niveau = (module: string, champ: string): Niveau =>
      moi?.droits_champ?.[module]?.[champ] ?? 'MASQUE'

    return {
      moi,
      chargement,
      connecter,
      deconnecter,
      peut,
      niveau,
      visible: (m, c) => niveau(m, c) !== 'MASQUE',
      // Un champ en ECRITURE reste en lecture seule si le module n'est pas
      // accessible en ecriture : les deux niveaux se combinent, ils ne se
      // remplacent pas.
      modifiable: (m, c) => niveau(m, c) === 'ECRITURE' && peut(m, 'ECRIRE'),
    }
  }, [moi, chargement, connecter, deconnecter])

  return <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const c = useContext(AuthContext)
  if (!c) throw new Error('useAuth doit etre utilise dans un AuthProvider')
  return c
}

/** Raccourci pour un module donne. */
export function useDroits(module: string) {
  const { niveau, visible, modifiable, peut } = useAuth()
  return useMemo(
    () => ({
      niveau: (champ: string) => niveau(module, champ),
      visible: (champ: string) => visible(module, champ),
      modifiable: (champ: string) => modifiable(module, champ),
      peutLire: peut(module, 'LIRE'),
      peutEcrire: peut(module, 'ECRIRE'),
      peutValider: peut(module, 'VALIDER'),
      /** Ne garde des colonnes proposees que celles reellement visibles. */
      colonnesVisibles: <T extends { champ: string }>(colonnes: T[]) =>
        colonnes.filter((c) => visible(module, c.champ)),
    }),
    [module, niveau, visible, modifiable, peut],
  )
}

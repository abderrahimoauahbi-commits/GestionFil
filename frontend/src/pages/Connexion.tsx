import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { ErreurApi } from '../api/client'
import { Alerte, Bouton, Champ, Chargement, Etiq } from '../composants/ui/base'
import { estBureau } from '../lib/utils'

export function Connexion() {
  const { moi, chargement, connecter } = useAuth()
  const [login, setLogin] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [visible, setVisible] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  if (chargement) return <Chargement />
  if (moi) return <Navigate to="/" replace />

  async function soumettre(e: React.FormEvent) {
    e.preventDefault()
    setErreur(null)
    setEnvoi(true)
    try {
      await connecter(login.trim(), motDePasse)
    } catch (ex) {
      setErreur(
        ex instanceof ErreurApi
          ? ex.message
          : ex instanceof Error
            ? `Connexion impossible : ${ex.message}`
            : 'Connexion impossible.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="flex min-h-full">
      {/* --- Panneau de presentation : bureau seulement ------------------- */}
      <div className="relative hidden flex-1 flex-col justify-between bg-barre p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primaire text-sm font-bold text-primaire-texte">
            GF
          </div>
          <div>
            <div className="font-semibold text-barre-texte">Gestion Fil</div>
            <div className="text-xs text-barre-attenue">Polyfashions Carpet Morocco</div>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-snug text-barre-texte">
            Pilotage des achats, des stocks et de la production de matieres premieres.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-barre-attenue">
            Tout est tenu au kilogramme. Les palettes, bobines et metres lineaires ne sont que
            des masques de saisie : la conversion est faite a l'enregistrement, jamais devinee.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-barre-attenue">
          {[
            ['124', 'references'],
            ['18', 'qualites'],
            ['12', 'fournisseurs'],
          ].map(([valeur, libelle]) => (
            <div key={libelle}>
              <dt className="text-2xl font-semibold text-barre-texte">{valeur}</dt>
              <dd className="text-xs">{libelle}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* --- Formulaire ---------------------------------------------------- */}
      <div className="flex flex-1 items-center justify-center bg-fond p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 grid size-11 place-items-center rounded-lg bg-primaire text-base font-bold text-primaire-texte">
              GF
            </div>
            <h1 className="text-xl font-semibold">Gestion Fil</h1>
            <p className="text-sm text-attenue-texte">Polyfashions Carpet Morocco</p>
          </div>

          <div className="mb-6 hidden lg:block">
            <h1 className="text-xl font-semibold">Connexion</h1>
            <p className="mt-1 text-sm text-attenue-texte">
              Identifiez-vous pour acceder a votre espace.
            </p>
          </div>

          <form onSubmit={soumettre} className="space-y-4">
            <div>
              <Etiq htmlFor="login" obligatoire>
                Identifiant
              </Etiq>
              <Champ
                id="login"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                required
              />
            </div>

            <div>
              <Etiq htmlFor="mdp" obligatoire>
                Mot de passe
              </Etiq>
              <div className="relative">
                <Champ
                  id="mdp"
                  type={visible ? 'text' : 'password'}
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => !v)}
                  aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-attenue-texte hover:text-texte"
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {erreur && <Alerte ton="danger">{erreur}</Alerte>}

            <Bouton type="submit" chargement={envoi} className="w-full" taille="lg">
              {!envoi && <LogIn />}
              Se connecter
            </Bouton>
          </form>

          <p className="mt-6 text-center text-xs text-attenue-texte">
            {estBureau() ? 'Application de bureau' : 'Application web'} · version 0.1.0
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Le verrou d'inactivite.
 *
 * LE PROBLEME QU'IL RESOUT N'EST PAS TECHNIQUE. Personne ne ferme sa session :
 * on quitte le poste pour aller peser une palette, et l'ecran reste ouvert avec
 * les stocks, les prix et le droit d'ecrire, a la portee de qui passe. Aucune
 * consigne affichee n'a jamais corrige cette habitude nulle part.
 *
 * VERROUILLER, ET NON DECONNECTER, et c'est la decision qui fait tout tenir.
 * Une deconnexion ferait perdre la fiche en cours de saisie — vingt lignes de
 * bobines a retaper. Au bout de deux fois, l'operateur trouverait le moyen de
 * contourner le verrou, et l'usine se retrouverait moins protegee qu'avant. Ici
 * l'ecran se couvre, le mot de passe le decouvre, et la saisie est intacte.
 *
 * DEVERROUILLER NE PROLONGE PAS LA SESSION. Le serveur verifie le mot de passe
 * sans emettre de nouveau jeton : au bout de quatre heures la session tombe
 * quoi qu'il arrive. Sinon il suffirait de bouger la souris une fois par heure
 * pour qu'une session vive une semaine.
 *
 * LE VOILE EST OPAQUE, PAS FLOUTE. Un flou laisse lire les ordres de grandeur —
 * un chiffre a six chiffres reste un chiffre a six chiffres. Ce qui est couvert
 * doit etre illisible.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, LockKeyhole, LogOut } from 'lucide-react'
import { api, echeance, ErreurApi } from '../api/client'
import { useAuth } from './AuthContext'

/** Ce qui compte comme un signe de vie. */
const SIGNES = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const

export function Verrou() {
  const { moi, deconnecter } = useAuth()
  const [verrouille, setVerrouille] = useState(false)
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const champ = useRef<HTMLInputElement>(null)

  const delai = (moi?.verrou_inactivite_secondes ?? 120) * 1000

  /* --- Le compte a rebours d'inactivite ---------------------------------
     Un seul minuteur, relance a chaque signe de vie. `mousemove` se declenche
     des dizaines de fois par seconde : on ne relance qu'une fois par seconde,
     sinon la page passe son temps a reprogrammer un minuteur. */
  const echeanceInactivite = useRef(Date.now() + delai)

  useEffect(() => {
    if (!moi || verrouille) return

    echeanceInactivite.current = Date.now() + delai
    let dernier = 0

    const signe = () => {
      const t = Date.now()
      if (t - dernier < 1000) return
      dernier = t
      echeanceInactivite.current = t + delai
    }

    /* L'ONGLET CACHE COMPTE COMME UNE ABSENCE. Sans cela, un poste laisse sur
       un autre onglet ne se verrouillerait jamais : aucun evenement de souris
       n'arrive, mais aucun minuteur ne se declenche non plus de facon fiable,
       les navigateurs les ralentissant en arriere-plan. On verifie donc au
       retour. */
    const retour = () => {
      if (document.visibilityState === 'visible' && Date.now() > echeanceInactivite.current) {
        setVerrouille(true)
      }
    }

    for (const s of SIGNES) window.addEventListener(s, signe, { passive: true })
    document.addEventListener('visibilitychange', retour)

    const battement = window.setInterval(() => {
      if (Date.now() > echeanceInactivite.current) setVerrouille(true)
    }, 1000)

    return () => {
      for (const s of SIGNES) window.removeEventListener(s, signe)
      document.removeEventListener('visibilitychange', retour)
      window.clearInterval(battement)
    }
  }, [moi, verrouille, delai])

  /* --- L'echeance absolue de la session ---------------------------------
     Elle court aussi pendant que l'ecran est verrouille : c'est le but. */
  useEffect(() => {
    if (!moi) return
    const verifier = () => {
      const fin = echeance.lire()
      if (fin && Date.now() / 1000 > fin) {
        setVerrouille(false)
        deconnecter()
      }
    }
    verifier()
    const t = window.setInterval(verifier, 15_000)
    return () => window.clearInterval(t)
  }, [moi, deconnecter])

  useEffect(() => {
    if (verrouille) {
      setMotDePasse('')
      setErreur(null)
      champ.current?.focus()
    }
  }, [verrouille])

  const deverrouiller = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!motDePasse || envoi) return
      setEnvoi(true)
      setErreur(null)
      try {
        await api.post('/api/auth/deverrouiller', { mot_de_passe: motDePasse })
        echeanceInactivite.current = Date.now() + delai
        setVerrouille(false)
      } catch (err) {
        /* Un jeton expire pendant le verrouillage : la session est finie, on ne
           reste pas devant un ecran qui refuse tout sans dire pourquoi. */
        if (err instanceof ErreurApi && err.statut === 401 && err.code !== 'IDENTIFIANTS_INVALIDES') {
          setVerrouille(false)
          deconnecter()
          return
        }
        setErreur(
          err instanceof ErreurApi && err.statut === 401
            ? 'Mot de passe incorrect.'
            : "Le serveur n'a pas répondu. Réessayez.",
        )
        setMotDePasse('')
        champ.current?.focus()
      } finally {
        setEnvoi(false)
      }
    },
    [motDePasse, envoi, delai, deconnecter],
  )

  if (!moi || !verrouille) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session verrouillée"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-fond p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-[var(--radius)] border border-bordure bg-surface p-6 shadow-lg">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-attenue-texte">
            <LockKeyhole className="size-4" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Session verrouillée
            </span>
          </div>
          <h2 className="text-[17px] font-semibold text-texte">{moi.login}</h2>
          <p className="text-[13px] text-attenue-texte">
            L&rsquo;écran s&rsquo;est verrouillé faute d&rsquo;activité. Votre saisie en cours est
            conservée&nbsp;: entrez votre mot de passe pour la retrouver.
          </p>
        </div>

        <form onSubmit={deverrouiller} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-attenue-texte">Mot de passe</span>
            <input
              ref={champ}
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="current-password"
              autoFocus
              className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-3
                         text-[15px] text-texte outline-none focus:border-primaire
                         focus:ring-2 focus:ring-primaire/30"
            />
          </label>

          {erreur && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {erreur}
            </p>
          )}

          <button
            type="submit"
            disabled={!motDePasse || envoi}
            className="inline-flex min-h-[44px] items-center justify-center gap-2
                       rounded-[var(--radius-sm)] bg-primaire px-4 text-[15px] font-semibold
                       text-primaire-texte disabled:opacity-40"
          >
            {envoi ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
            Déverrouiller
          </button>
        </form>

        {/* CHANGER D'UTILISATEUR RESTE POSSIBLE, et c'est necessaire : sans
            cette porte, le collegue qui prend le poste serait oblige de
            reveiller celui qui est parti. Elle ferme la session pour de bon —
            la saisie en cours est alors perdue, ce que le libelle annonce. */}
        <button
          type="button"
          onClick={deconnecter}
          className="inline-flex items-center justify-center gap-1.5 text-[13px]
                     text-attenue-texte underline-offset-2 hover:text-texte hover:underline"
        >
          <LogOut className="size-3.5" />
          Fermer la session et changer d&rsquo;utilisateur
        </button>
      </div>
    </div>
  )
}

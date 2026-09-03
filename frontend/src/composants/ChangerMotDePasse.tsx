/**
 * Changer son propre mot de passe.
 *
 * IL VIT DANS LE MENU DU PROFIL, en haut a droite. C'est la que tout le monde
 * le cherche, dans tous les logiciels — le ranger dans les parametres
 * obligerait a traverser deux ecrans pour un geste qu'on fait rarement mais
 * toujours dans l'urgence.
 *
 * L'ANCIEN MOT DE PASSE EST EXIGE, meme si l'on est deja connecte. Un jeton
 * prouve qu'une session est ouverte, pas que la personne devant l'ecran est
 * bien la bonne : sans cette garde, une session laissee ouverte sur un poste de
 * magasin permettrait de changer le mot de passe et d'en verrouiller le
 * proprietaire dehors.
 */
import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { api, ErreurApi } from '../api/client'
import { Alerte, Bouton, Champ, Etiq } from './ui/base'
import { Dialogue, DialogueContenu } from './ui/surcouches'

/** Longueur minimale, la meme que celle appliquee par le serveur. */
const LONGUEUR_MINIMALE = 8

export function ChangerMotDePasse({
  ouvert,
  surFermeture,
}: {
  ouvert: boolean
  surFermeture: () => void
}) {
  const [ancien, setAncien] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  function fermer() {
    setAncien('')
    setNouveau('')
    setConfirmation('')
    setErreur(null)
    setFait(false)
    surFermeture()
  }

  // LA CONFIRMATION EST VERIFIEE ICI, PAS AU SERVEUR, et c'est le seul controle
  // qui a sa place cote client : elle ne protege de rien, elle evite une faute
  // de frappe. Tous les autres — longueur, ancien mot de passe correct — sont
  // appliques par le serveur, qui ne fait confiance a personne.
  const concordent = nouveau === confirmation
  const assezLong = nouveau.length >= LONGUEUR_MINIMALE
  const different = nouveau !== ancien || nouveau === ''
  const valide = ancien !== '' && assezLong && concordent && nouveau !== ancien

  async function soumettre(e: React.FormEvent) {
    e.preventDefault()
    setErreur(null)
    setEnvoi(true)
    try {
      await api.post('/api/auth/mot-de-passe', { ancien, nouveau })
      setFait(true)
    } catch (ex) {
      setErreur(
        ex instanceof ErreurApi
          ? ex.estNonAutorise || ex.code === 'IDENTIFIANTS_INVALIDES'
            ? 'Ancien mot de passe incorrect.'
            : ex.message
          : 'Changement impossible.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Dialogue open={ouvert} onOpenChange={(o) => !o && fermer()}>
      <DialogueContenu
        titre="Changer mon mot de passe"
        description="L ancien mot de passe est demande : un jeton prouve qu une session est ouverte, pas qui est devant l ecran."
        className="max-w-sm"
      >

        {fait ? (
          <div className="space-y-4">
            <Alerte ton="succes">
              Mot de passe change. Il sera demande a votre prochaine connexion.
            </Alerte>
            <Bouton className="w-full" onClick={fermer}>
              Fermer
            </Bouton>
          </div>
        ) : (
          <form onSubmit={soumettre} className="space-y-3">
            <div>
              <Etiq htmlFor="mdp-ancien" obligatoire>
                Mot de passe actuel
              </Etiq>
              <Champ
                id="mdp-ancien"
                type="password"
                value={ancien}
                onChange={(e) => setAncien(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>

            <div>
              <Etiq htmlFor="mdp-nouveau" obligatoire>
                Nouveau mot de passe
              </Etiq>
              <Champ
                id="mdp-nouveau"
                type="password"
                value={nouveau}
                onChange={(e) => setNouveau(e.target.value)}
                autoComplete="new-password"
                required
              />
              <p className="mt-1 text-[11px] leading-relaxed text-attenue-texte">
                {LONGUEUR_MINIMALE} caracteres minimum, mais{' '}
                <span className="text-texte">
                  une phrase longue est bien plus sure et plus facile a retenir
                </span>{' '}
                qu un mot court et complique : la longueur compte davantage que les majuscules
                et les chiffres.
              </p>
            </div>

            <div>
              <Etiq htmlFor="mdp-confirmation" obligatoire>
                Confirmer le nouveau
              </Etiq>
              <Champ
                id="mdp-confirmation"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                aria-invalid={confirmation !== '' && !concordent}
                required
              />
              {confirmation !== '' && !concordent && (
                <p className="mt-1 text-[11px] text-danger">Les deux saisies different.</p>
              )}
            </div>

            {nouveau !== '' && !assezLong && (
              <p className="text-[11px] text-attenue-texte">
                Encore {LONGUEUR_MINIMALE - nouveau.length} caractere
                {LONGUEUR_MINIMALE - nouveau.length > 1 ? 's' : ''}.
              </p>
            )}
            {!different && (
              <p className="text-[11px] text-danger">
                Le nouveau mot de passe doit differer de l actuel.
              </p>
            )}

            {erreur && <Alerte ton="danger">{erreur}</Alerte>}

            <div className="flex gap-2 pt-1">
              <Bouton variante="contour" className="flex-1" type="button" onClick={fermer}>
                Annuler
              </Bouton>
              <Bouton className="flex-1" type="submit" disabled={!valide || envoi}>
                {envoi ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Changer
              </Bouton>
            </div>
          </form>
        )}
      </DialogueContenu>
    </Dialogue>
  )
}

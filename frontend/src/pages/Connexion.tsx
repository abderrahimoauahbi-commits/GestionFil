/**
 * L'ecran de connexion.
 *
 * IL NE RESSEMBLE PAS AU RESTE DE L'APPLICATION, ET C'EST VOULU. Partout
 * ailleurs, la regle est la densite : le maximum de lignes lisibles a l'ecran.
 * Ici il n'y a rien a lire — deux champs et un bouton. La place liberee sert
 * donc a marquer la frontiere entre « dehors » et « dans l'application », ce
 * qu'un ERP gagne a rendre net.
 *
 * IL EST SOMBRE DANS LES DEUX THEMES. Cet ecran s'affiche AVANT qu'on sache qui
 * se connecte, donc avant de connaitre ses preferences d'apparence. Le dessiner
 * deux fois pour cinq secondes de lecture n'en vaut pas le cout.
 *
 * L'ADRESSE DU SERVEUR SE REGLE ICI, et nulle part ailleurs : c'est le seul
 * ecran qu'on atteigne sans serveur.
 *
 * La mise en forme vit dans `connexion.css` : elle redefinit localement des
 * champs poses sur du verre sombre, ce qu'aucun jeton de l'application ne
 * decrit.
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, LogIn, Server } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { ErreurApi, definirServeur, serveur, serveurRequis } from '../api/client'
import { Chargement } from '../composants/ui/base'
import { estBureau } from '../lib/utils'
import './connexion.css'

export function Connexion() {
  const { moi, chargement, connecter } = useAuth()
  const [login, setLogin] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [visible, setVisible] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  // L'adresse du serveur.
  //
  // ELLE S'OUVRE D'ELLE-MEME QUAND ELLE EST INDISPENSABLE : une application
  // installee sur un poste ou un telephone ne sait pas ou joindre le serveur
  // tant qu'on ne le lui a pas dit, et sans cet ecran elle repondrait
  // « serveur injoignable » sans jamais offrir de le corriger. Dans un
  // navigateur, l'origine courante suffit : le reglage reste replie.
  const [adresse, setAdresse] = useState(serveur())
  const [reglageOuvert, setReglageOuvert] = useState(serveurRequis())

  if (chargement) return <Chargement />
  if (moi) return <Navigate to="/" replace />

  async function soumettre(e: React.FormEvent) {
    e.preventDefault()
    setErreur(null)
    setEnvoi(true)
    try {
      definirServeur(adresse)
      await connecter(login.trim(), motDePasse)
    } catch (ex) {
      setErreur(
        ex instanceof ErreurApi
          ? ex.message
          : ex instanceof Error
            ? `Connexion impossible : ${ex.message}`
            : 'Connexion impossible.',
      )
      // Serveur injoignable : c'est le seul cas ou l'adresse est en cause. On
      // deplie le reglage plutot que de laisser l'utilisateur deviner qu'il
      // existe.
      if (ex instanceof ErreurApi && ex.code === 'SERVEUR_INJOIGNABLE') {
        setReglageOuvert(true)
      }
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="cnx">
      {/* Le decor : dessine, jamais photographie — il doit exister hors ligne,
          dans une application empaquetee comme sur un telephone. */}
      <div className="cnx__decor" aria-hidden />
      <div className="cnx__grain" aria-hidden />

      <div className="cnx__contenu">
        {/* --- Le discours : grand ecran seulement ------------------------- */}
        <section className="cnx__pitch">
          <div className="cnx__marque">
            <span className="cnx__sigle">GF</span>
            <span>
              <span className="cnx__nom">Gestion Fil</span>
              <br />
              <span className="cnx__societe">Polyfashions Carpet Morocco</span>
            </span>
          </div>

          <h2 className="cnx__titre">
            Achats, stocks et production de matieres premieres.
          </h2>
          <p className="cnx__texte">
            Tout est tenu au kilogramme. Les palettes, bobines et metres lineaires ne sont que des
            masques de saisie : la conversion est faite a l enregistrement, jamais devinee.
          </p>

          <dl className="cnx__chiffres">
            {[
              ['124', 'references'],
              ['18', 'qualites'],
              ['12', 'fournisseurs'],
            ].map(([valeur, libelle]) => (
              <div key={libelle}>
                <dt>{valeur}</dt>
                <dd>{libelle}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* --- La carte de verre ------------------------------------------- */}
        <div className="cnx__carte">
          {/* La marque revient dans la carte quand le discours est masque. */}
          <div className="cnx__marque lg:hidden" style={{ marginBottom: '1.5rem' }}>
            <span className="cnx__sigle">GF</span>
            <span>
              <span className="cnx__nom">Gestion Fil</span>
              <br />
              <span className="cnx__societe">Polyfashions Carpet Morocco</span>
            </span>
          </div>

          <h1>Connexion</h1>
          <p className="cnx__sous-titre">Identifiez-vous pour acceder a votre espace.</p>

          <form onSubmit={soumettre} className="space-y-3.5">
            <div className="space-y-1">
              <label htmlFor="login" className="block text-[12px]">
                Identifiant
              </label>
              <input
                id="login"
                className="w-full px-3"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mdp" className="block text-[12px]">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="mdp"
                  type={visible ? 'text' : 'password'}
                  className="w-full px-3 pr-10"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => !v)}
                  aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center
                             text-slate-300/60 transition-colors hover:text-slate-100"
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* --- Adresse du serveur ---------------------------------------- */}
            {reglageOuvert ? (
              <div className="cnx__serveur space-y-1">
                <label htmlFor="serveur" className="block text-[12px]">
                  Adresse du serveur
                </label>
                <input
                  id="serveur"
                  className="w-full px-3"
                  value={adresse}
                  onChange={(e) => setAdresse(e.target.value)}
                  placeholder="http://192.168.1.140:8080"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="url"
                />
                <p className="cnx__aide">
                  Protocole et port compris. Elle est retenue sur ce poste et ne sera plus
                  demandee.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setReglageOuvert(true)}
                className="cnx__discret"
              >
                <Server className="size-3" />
                {serveur() || 'Serveur : cette machine'}
              </button>
            )}

            {erreur && <div className="cnx__erreur">{erreur}</div>}

            <button type="submit" className="cnx__valider" disabled={envoi}>
              {envoi ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              Se connecter
            </button>

            {/* Effacer plutot que « annuler ». Il n'y a pas d'ecran precedent
                ou revenir : la seule chose qu'on puisse annuler, c'est sa
                saisie. Nommer le bouton par ce qu'il fait vaut mieux que par un
                verbe generique qui promet un retour inexistant. */}
            <button
              type="button"
              className="cnx__discret"
              onClick={() => {
                setLogin('')
                setMotDePasse('')
                setErreur(null)
                setVisible(false)
              }}
            >
              Effacer la saisie
            </button>
          </form>

          {/* --- Mot de passe perdu -----------------------------------------
              L'ERP n'envoie pas de courriel et n'a pas de question secrete : la
              recuperation passe donc par une PERSONNE, pas par un lien. Le dire
              ici evite de chercher un « mot de passe oublie ? » qui n'existera
              jamais, et evite surtout de croire le compte perdu. */}
          <details className="cnx__perdu">
            <summary>Mot de passe perdu ?</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>
                Demandez a l administrateur systeme de le redefinir depuis
                <strong> Parametres → Utilisateurs et droits</strong>. Il prend effet
                immediatement.
              </p>
              <p>
                <strong>Si c est le compte administrateur lui-meme qui est perdu</strong> — le seul
                cas ou personne ne peut plus rien redefinir — la reprise se fait sur la machine du
                serveur, avec un acces au dossier de l application :
              </p>
              <pre>
{`cd backend
GESTIONFIL_MOT_DE_PASSE="au moins douze caracteres" \\
  ./gestionfil-admin definir-mot-de-passe admin`}
              </pre>
              <p>
                Cette commande ne s execute que sur le serveur, par quelqu un qui a deja acces aux
                fichiers : c est ce qui la rend sure. Aucun lien de reinitialisation ne circule.
              </p>
            </div>
          </details>
        </div>
      </div>

      <p className="cnx__pied">
        {estBureau() ? 'Application de bureau' : 'Application web'} · version 0.1.0
      </p>
    </div>
  )
}

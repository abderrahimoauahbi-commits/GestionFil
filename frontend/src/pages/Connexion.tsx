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
 * se connecte, donc avant de connaitre ses preferences d'apparence.
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
import { Eye, EyeOff, Loader2, LogIn, Server, X } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { ErreurApi, definirServeur, serveur, serveurRequis } from '../api/client'
import { Chargement } from '../composants/ui/base'
import { VERSION } from '../lib/version'
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
  // tant qu'on ne le lui a pas dit, et sans ce reglage elle repondrait
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

      {/* LA MARQUE, UNE SEULE FOIS, EN TETE DE PAGE.
          Elle etait posee deux fois : dans le discours et dans la carte, la
          seconde masquee sur grand ecran. Deux exemplaires du meme logo sur un
          ecran qui n'en demande qu'un — et il suffisait d'une largeur
          intermediaire pour voir les deux. Une seule marque, toujours visible,
          au-dessus de tout le reste. */}
      {/* QUITTER. L'application installee n'a PAS de barre de titre : la fenetre
          est sans decoration, et sa croix vit dans l'entete de l'application —
          qui n'existe pas encore tant qu'on n'est pas connecte. Sans ce bouton,
          l'ecran de connexion est une impasse : il faut le gestionnaire des
          taches pour en sortir. Il ne parait que dans l'application installee ;
          dans un navigateur, l'onglet se ferme tout seul. */}
      {estBureau() && (
        <button
          type="button"
          onClick={() => {
            void import('@tauri-apps/api/window').then((m) =>
              m.getCurrentWindow().close(),
            )
          }}
          className="cnx__quitter"
          title="Quitter Gestion Fil"
          aria-label="Quitter"
        >
          <X className="size-4" />
        </button>
      )}

      <header className="cnx__entete">
        <img
          src={`${import.meta.env.BASE_URL}logo-polyfashions-blanc.png`}
          alt="Polyfashions Carpet"
          className="cnx__logo"
        />
        <span className="cnx__appli">Gestion Fil</span>
      </header>

      <div className="cnx__contenu">
        {/* --- Le discours : grand ecran seulement ------------------------- */}
        <section className="cnx__pitch">
          <hr className="cnx__filet" />

          <h2 className="cnx__titre">
            Achats, stocks et production de matieres premieres.
          </h2>
          <p className="cnx__texte">
            Tout est tenu au kilogramme. Les palettes, bobines et metres lineaires ne sont que
            des masques de saisie : la conversion est faite a l enregistrement, jamais devinee.
          </p>
        </section>

        {/* --- La carte de verre ------------------------------------------- */}
        <div className="cnx__carte">
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
            ) : null}

            {erreur && <div className="cnx__erreur">{erreur}</div>}

            <button type="submit" className="cnx__valider" disabled={envoi}>
              {envoi ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              Se connecter
            </button>

            {/* Effacer plutot que « annuler ». Il n'y a pas d'ecran precedent
                ou revenir : la seule chose qu'on puisse annuler, c'est sa
                saisie. */}
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
        </div>
      </div>

      {/* LE PIED EST AUSSI LA PORTE DE SERVICE.
          L'adresse du serveur ne concerne QUE celui qui installe : sur un
          navigateur elle est inutile — la page vient deja du serveur — et
          l'afficher a tout le monde ajoute une question a un ecran qui n'en
          pose qu'une.

          Elle apparait donc d'elle-meme dans deux cas seulement : application
          empaquetee non configuree, ou serveur injoignable. Sinon, un clic sur
          la version l'ouvre — un geste que celui qui installe trouve, et que
          l'utilisateur ne fait jamais par hasard. */}
      <p className="cnx__pied">
        <span>
          <strong>Gestion Fil</strong> version {VERSION} · © {new Date().getFullYear()}{' '}
          Polyfashions Carpet
        </span>

        {/* LE REGLAGE DU SERVEUR SE VOIT, DESORMAIS.
            Il s'ouvrait par un clic sur la ligne de version — un geste que celui
            qui installe finit par trouver, mais que personne ne devine le jour ou
            le serveur change d'adresse. Le lien reste discret : il ne pose pas de
            question a qui n'en a pas, et il repond a qui la cherche.

            LA BASE DE DONNEES, ELLE, NE SE REGLE PAS ICI ni nulle part dans
            l'application. Seul le serveur lui parle, par son fichier .env ; un
            poste de magasin n'a aucun acces direct a PostgreSQL, et c'est ce qui
            fait que la grille de droits protege quelque chose. */}
        {!reglageOuvert && (
          <button type="button" onClick={() => setReglageOuvert(true)} className="cnx__reglage">
            <Server className="size-3" />
            {serveur() ? `Serveur : ${serveur()}` : 'Configurer le serveur'}
          </button>
        )}
      </p>
    </div>
  )
}

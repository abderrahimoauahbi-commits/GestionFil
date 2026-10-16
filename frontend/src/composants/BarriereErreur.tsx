/**
 * LA BARRIERE D'ERREUR (audit v4, P3).
 *
 * Une exception dans un ecran faisait tomber toute l'application : page
 * blanche, menu compris, et rien a lire pour dire ce qui s'etait passe. La
 * barriere entoure l'ecran courant : l'erreur reste dans son cadre, le menu
 * demeure, et l'on peut recharger l'ecran ou changer d'ecran.
 *
 * UNE VERSION PUBLIEE PENDANT QU'ON TRAVAILLE. Les ecrans se chargent a la
 * demande ; apres une publication, l'ancien fichier d'un ecran n'existe plus
 * sur le serveur. Le message le dit et propose de recharger la page entiere.
 *
 * OU LE RESEAU COUPE (audit v5, F20). Le meme echec de chargement (« Failed to
 * fetch ») vient aussi d'une coupure : annoncer une nouvelle version etait
 * faux. La barriere interroge alors le serveur : injoignable, c'est le reseau ;
 * joignable, c'est bien une nouvelle version.
 */
import { Component, type ReactNode } from 'react'
import { Alerte, Bouton } from './ui/base'

interface Props {
  /** Change a chaque navigation : la barriere se rearme sur le nouvel ecran. */
  cle: string
  children: ReactNode
}

interface Etat {
  erreur: Error | null
  cle: string
  /** Pour un echec de chargement : le serveur repond-il ? null tant qu'on verifie. */
  cause: 'version' | 'reseau' | null
}

const ECHEC_CHARGEMENT = /dynamically imported module|Importing a module script failed|Failed to fetch|NetworkError|Load failed/i

export class BarriereErreur extends Component<Props, Etat> {
  state: Etat = { erreur: null, cle: this.props.cle, cause: null }

  static getDerivedStateFromError(erreur: Error): Partial<Etat> {
    return { erreur, cause: null }
  }

  static getDerivedStateFromProps(props: Props, etat: Etat): Partial<Etat> | null {
    // Une autre adresse : l'erreur de l'ecran precedent ne la suit pas.
    return props.cle !== etat.cle ? { erreur: null, cle: props.cle } : null
  }

  componentDidCatch(erreur: Error) {
    console.error('Erreur d’écran :', erreur)
    if (!ECHEC_CHARGEMENT.test(erreur.message)) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState({ cause: 'reseau' })
      return
    }
    // La page d'accueil du serveur, sans cache : elle repond si le serveur est la.
    fetch(`/index.html?sonde=${Date.now()}`, { cache: 'no-store' })
      .then((r) => this.setState({ cause: r.ok ? 'version' : 'reseau' }))
      .catch(() => this.setState({ cause: 'reseau' }))
  }

  render() {
    const { erreur, cause } = this.state
    if (!erreur) return this.props.children
    const chargement = ECHEC_CHARGEMENT.test(erreur.message)
    const versionPerimee = chargement && cause === 'version'
    const reseau = chargement && cause === 'reseau'
    const titre = versionPerimee
      ? 'Une nouvelle version est publiée'
      : reseau
        ? 'Le serveur ne répond pas'
        : chargement
          ? 'Écran indisponible'
          : 'Cet écran a rencontré une erreur'
    return (
      <div className="p-4">
        <Alerte ton={reseau ? 'alerte' : 'danger'} titre={titre}>
          <p className="m-0">
            {versionPerimee
              ? 'L’application a été mise à jour pendant que vous travailliez : rechargez la page pour prendre la nouvelle version.'
              : reseau
                ? 'La connexion au serveur est coupée (réseau, Wi-Fi, serveur arrêté). Rien n’est perdu de ce qui était enregistré : réessayez quand la connexion revient.'
                : chargement
                  ? 'Vérification de la connexion au serveur…'
                  : 'Le reste de l’application fonctionne. Rechargez l’écran ; si l’erreur revient, notez ce que vous faisiez et prévenez l’administrateur.'}
          </p>
          {!chargement && <p className="m-0 mt-1 font-mono text-[11.5px] text-attenue-texte">{erreur.message}</p>}
          <div className="mt-2 flex gap-2">
            {!versionPerimee && (
              <Bouton taille="sm" variante="contour" onClick={() => this.setState({ erreur: null, cause: null })}>
                {reseau ? 'Réessayer' : 'Recharger l’écran'}
              </Bouton>
            )}
            <Bouton taille="sm" onClick={() => window.location.reload()}>
              Recharger la page
            </Bouton>
          </div>
        </Alerte>
      </div>
    )
  }
}

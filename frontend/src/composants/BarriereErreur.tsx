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
}

export class BarriereErreur extends Component<Props, Etat> {
  state: Etat = { erreur: null, cle: this.props.cle }

  static getDerivedStateFromError(erreur: Error): Partial<Etat> {
    return { erreur }
  }

  static getDerivedStateFromProps(props: Props, etat: Etat): Partial<Etat> | null {
    // Une autre adresse : l'erreur de l'ecran precedent ne la suit pas.
    return props.cle !== etat.cle ? { erreur: null, cle: props.cle } : null
  }

  componentDidCatch(erreur: Error) {
    console.error('Erreur d’écran :', erreur)
  }

  render() {
    const { erreur } = this.state
    if (!erreur) return this.props.children
    const versionPerimee = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
      erreur.message,
    )
    return (
      <div className="p-4">
        <Alerte ton="danger" titre={versionPerimee ? 'Une nouvelle version est publiée' : 'Cet écran a rencontré une erreur'}>
          <p className="m-0">
            {versionPerimee
              ? 'L’application a été mise à jour pendant que vous travailliez : rechargez la page pour prendre la nouvelle version.'
              : 'Le reste de l’application fonctionne. Rechargez l’écran ; si l’erreur revient, notez ce que vous faisiez et prévenez l’administrateur.'}
          </p>
          {!versionPerimee && <p className="m-0 mt-1 font-mono text-[11.5px] text-attenue-texte">{erreur.message}</p>}
          <div className="mt-2 flex gap-2">
            {!versionPerimee && (
              <Bouton taille="sm" variante="contour" onClick={() => this.setState({ erreur: null })}>
                Recharger l’écran
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

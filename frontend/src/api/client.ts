/**
 * Client HTTP.
 *
 * Le jeton est conserve en sessionStorage : il disparait a la fermeture de
 * l'onglet. Sur un poste de magasin partage, un localStorage laisserait la
 * session ouverte pour l'operateur suivant.
 */

const CLE_JETON = 'gestionfil.jeton'
const CLE_SERVEUR = 'gestionfil.serveur'

/**
 * L'adresse du serveur.
 *
 * TROIS NIVEAUX, DU PLUS PRECIS AU PLUS GENERAL :
 *
 *   1. LE REGLAGE DU POSTE, en localStorage. C'est lui qui permet a UN SEUL
 *      paquet installe de viser n'importe quel serveur : on ne recompile pas
 *      l'application parce que l'adresse du serveur change.
 *   2. L'ADRESSE COMPILEE, `VITE_API_URL`. Utile pour un paquet prepare a
 *      l'avance pour un site donne, qui marche sans reglage.
 *   3. LA MEME ORIGINE, chaine vide. C'est le cas du navigateur : la page vient
 *      du serveur, l'API est au meme endroit. Ni CORS ni configuration.
 *
 * Le stockage est `localStorage` et non `sessionStorage`, contrairement au
 * jeton : l'adresse du serveur doit survivre a la fermeture de l'application,
 * le jeton non.
 */
export function serveur(): string {
  try {
    const choisi = localStorage.getItem(CLE_SERVEUR)
    if (choisi) return choisi.replace(/\/+$/, '')
  } catch {
    /* navigation privee, stockage refuse : on continue sans */
  }
  const compile = import.meta.env.VITE_API_URL as string | undefined
  if (compile) return compile.replace(/\/+$/, '')
  return ''
}

export function definirServeur(url: string): void {
  const propre = url.trim().replace(/\/+$/, '')
  if (propre) localStorage.setItem(CLE_SERVEUR, propre)
  else localStorage.removeItem(CLE_SERVEUR)
}

/**
 * Faut-il demander l'adresse du serveur avant de pouvoir se connecter ?
 *
 * Vrai pour une application EMPAQUETEE (bureau ou mobile) non configuree : sa
 * page ne vient pas d'un serveur, l'origine est `tauri://localhost` ou
 * `file://`, et une requete relative n'aboutirait nulle part. Faux dans un
 * navigateur, ou l'origine courante fait office de serveur.
 */
export function serveurRequis(): boolean {
  if (serveur()) return false
  return location.protocol !== 'http:' && location.protocol !== 'https:'
}

/** Erreur applicative renvoyee par l'API, avec son code metier. */
export class ErreurApi extends Error {
  constructor(
    public readonly statut: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ErreurApi'
  }

  /** Regle metier violee : le message est redige pour l'utilisateur. */
  get estRegleMetier() {
    return this.code === 'REGLE_METIER'
  }
  get estNonAutorise() {
    return this.code === 'NON_AUTORISE'
  }
}

export const jeton = {
  lire: () => sessionStorage.getItem(CLE_JETON),
  ecrire: (v: string) => sessionStorage.setItem(CLE_JETON, v),
  effacer: () => sessionStorage.removeItem(CLE_JETON),
}

async function requete<T>(
  methode: string,
  route: string,
  corps?: unknown,
): Promise<T> {
  const entetes: Record<string, string> = {}
  const t = jeton.lire()
  if (t) entetes['Authorization'] = `Bearer ${t}`
  if (corps !== undefined) entetes['Content-Type'] = 'application/json'

  let reponse: Response
  try {
    reponse = await fetch(serveur() + route, {
      method: methode,
      headers: entetes,
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
  } catch {
    // fetch n'echoue que si la requete n'a pas abouti : serveur arrete,
    // port ferme, reseau coupe. Le distinguer d'une erreur applicative evite
    // de chercher un bug la ou il n'y en a pas.
    throw new ErreurApi(
      0,
      'SERVEUR_INJOIGNABLE',
      serveur()
        ? `Le serveur ${serveur()} ne repond pas. Verifiez l'adresse et que la machine est allumee.`
        : "Le serveur ne repond pas. Verifiez qu'il est demarre.",
    )
  }

  if (reponse.status === 204) return undefined as T

  const texte = await reponse.text()

  // Une reponse non-JSON vient d'un intermediaire (proxy de developpement,
  // page d'erreur), pas de l'API : le signaler tel quel plutot que de laisser
  // remonter une SyntaxError sans rapport.
  let donnees: { code?: string; message?: string } | null = null
  if (texte) {
    try {
      donnees = JSON.parse(texte)
    } catch {
      throw new ErreurApi(
        reponse.status,
        'REPONSE_INVALIDE',
        `Reponse inattendue du serveur (HTTP ${reponse.status}). ` +
          `Le backend est-il demarre sur le port attendu ?`,
      )
    }
  }

  if (!reponse.ok) {
    const code = donnees?.code ?? 'ERREUR'
    const message = donnees?.message ?? `Erreur ${reponse.status}`

    // Jeton expire ou compte desactive : on nettoie et on renvoie a la
    // connexion plutot que de laisser l'interface enchainer les 401.
    if (reponse.status === 401) {
      jeton.effacer()
      // `location.replace` sur un chemin absolu casse dans une application
      // empaquetee, ou la page est servie depuis le disque : le hachage suffit
      // et fonctionne dans les deux cas.
      if (!location.pathname.endsWith('/connexion')) {
        location.replace(import.meta.env.BASE_URL + 'connexion')
      }
    }
    throw new ErreurApi(reponse.status, code, message)
  }
  return donnees as T
}

export const api = {
  get: <T>(route: string) => requete<T>('GET', route),
  post: <T>(route: string, corps?: unknown) => requete<T>('POST', route, corps ?? {}),
  put: <T>(route: string, corps: unknown) => requete<T>('PUT', route, corps),
  patch: <T>(route: string, corps: unknown) => requete<T>('PATCH', route, corps),
  delete: <T>(route: string) => requete<T>('DELETE', route),
}

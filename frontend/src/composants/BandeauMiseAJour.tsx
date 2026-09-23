/**
 * « UNE VERSION PLUS RECENTE EXISTE » — dit a l'application installee.
 *
 * POURQUOI SEULEMENT A ELLE. Le navigateur recoit l'interface du serveur a
 * chaque visite : il est a jour par construction. L'application de bureau, non
 * — elle EMBARQUE son interface, figee au jour ou on l'a installee. Un poste
 * installe le 3 septembre affiche donc, des mois plus tard, des ecrans qui
 * ignorent les colonnes que l'API renvoie desormais. Rien ne le signalait :
 * l'application se contentait de fonctionner de moins en moins bien.
 *
 * ON ANNONCE, ON N'INSTALLE PAS. Lancer une installation sur le poste de
 * quelqu'un, dans un atelier, c'est interrompre une saisie en cours. Le
 * bandeau donne le chiffre, la date et le lien ; la personne choisit son
 * moment.
 *
 * IL SE TAIT POUR LA SESSION, JAMAIS POUR TOUJOURS. Un avis de mise a jour
 * qu'on peut eteindre definitivement est un avis que personne ne verra : au
 * prochain lancement, il revient.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, X } from 'lucide-react'

import { api } from '../api/client'
import { estBureau } from '../lib/utils'
import { VERSION } from '../lib/version'
import { Bouton } from './ui/base'

interface Paquet {
  plateforme: string
  plateforme_libelle: string
  compatibilite: string
  version: string
  fichier: string
  url: string
  taille_octets: number
  publie_le: string
}

interface Disponible {
  serveur: string
  nb_plateformes: number
  plateformes: Record<string, Paquet>
}

/**
 * Compare deux versions champ par champ, NUMERIQUEMENT.
 *
 * `'0.9.0' < '0.10.0'` est faux en comparaison de texte : le jour ou le numero
 * mineur depasse neuf, l'application proposerait de « mettre a jour » vers un
 * paquet plus ancien — et l'erreur serait invisible.
 */
function plusRecente(candidate: string, courante: string): boolean {
  const n = (v: string) => v.split(/[.\-+]/).map((s) => Number.parseInt(s, 10) || 0)
  const a = n(candidate)
  const b = n(courante)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** La famille de systeme, telle que le poste l'annonce. */
function famille(): string[] {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return ['windows']
  if (/Mac OS X|Macintosh/i.test(ua)) return ['macos']
  // DEUX FORMES DU MEME CLIENT sous Linux : le paquet Debian et l'AppImage
  // portable. On ne peut pas savoir laquelle tourne — on propose la plus
  // recente des deux et on nomme la forme, pour que la personne reconnaisse
  // la sienne.
  if (/Linux|X11/i.test(ua)) return ['linux', 'linuxportable']
  return []
}

function mo(octets: number): string {
  return `${(octets / 1e6).toFixed(1)} Mo`
}

export function BandeauMiseAJour() {
  const bureau = estBureau()
  const [maVersion, setMaVersion] = useState<string | null>(null)
  const [masque, setMasque] = useState(false)

  // LA VERSION DE L'APPLICATION INSTALLEE, pas celle de l'interface. Ce sont
  // deux numeros differents : le paquet porte celui de Tauri, et c'est lui
  // qu'on retrouve dans le nom du fichier. L'import est dynamique pour que la
  // construction navigateur n'embarque pas le module.
  useEffect(() => {
    if (!bureau) return
    let vivant = true
    const arrive = (v: string) => {
      if (vivant) {
        vivant = false
        setMaVersion(v)
      }
    }
    // UNE PROMESSE SANS DELAI D'ATTENTE N'EST PAS UNE PROMESSE. L'appel passe
    // par le pont Tauri ; si ce pont ne repond pas — enveloppe incomplete,
    // version trop ancienne du client — la promesse ne se resout NI ne se
    // rejette, et l'avis de mise a jour ne parait jamais. C'est le defaut
    // exact observe a l'essai : tout marchait, sauf que rien ne s'affichait.
    // Trois secondes, puis on se rabat sur la version de l'interface
    // embarquee, qui est au pire d'un cran en retard.
    const repli = setTimeout(() => arrive(VERSION), 3000)
    import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then(arrive)
      .catch(() => arrive(VERSION))
    return () => {
      vivant = false
      clearTimeout(repli)
    }
  }, [bureau])

  const q = useQuery({
    queryKey: ['mise-a-jour'],
    queryFn: () => api.get<Disponible>('/api/mise-a-jour'),
    enabled: bureau,
    retry: false,
    // Une fois par session suffit : un paquet n'apparait pas toutes les cinq
    // minutes, et une requete de plus au demarrage se remarque.
    staleTime: Infinity,
  })

  if (!bureau || masque || !maVersion || !q.data) return null

  const candidats = famille()
    .map((p) => q.data.plateformes[p])
    .filter((p): p is Paquet => !!p && plusRecente(p.version, maVersion))
    .sort((a, b) => (plusRecente(a.version, b.version) ? -1 : 1))
  const paquet = candidats[0]
  if (!paquet) return null

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-primaire/40
                 bg-primaire/10 px-3 py-2 text-[12px]"
      role="status"
    >
      <Download className="size-4 shrink-0 text-primaire" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-texte">
          Version {paquet.version} disponible pour {paquet.plateforme_libelle}
        </span>
        <span className="text-attenue-texte">
          {' '}— vous utilisez la {maVersion}
          {paquet.publie_le ? `, publiee le ${paquet.publie_le}` : ''} · {mo(paquet.taille_octets)}
        </span>
        {/* CE QUE L'ANCIENNE VERSION NE MONTRE PAS, dit sans detour : c'est la
            raison de mettre a jour, et elle vaut mieux qu'un numero. */}
        <div className="text-[11px] text-attenue-texte">
          Votre application affiche les ecrans de sa propre installation : les colonnes et
          calculs ajoutes depuis n'y apparaissent pas.
        </div>
      </div>
      <Bouton
        asChild
        taille="sm"
        onClick={() => {
          // On inscrit l'intention au journal, comme l'ecran Telecharger : la
          // question a laquelle il repond est « sur quelle version tourne ce
          // poste ».
          void api.post('/api/telechargements/journal', { fichier: paquet.fichier })
        }}
      >
        <a href={paquet.url} download>
          <Download />
          Telecharger
        </a>
      </Bouton>
      <button
        type="button"
        onClick={() => setMasque(true)}
        className="rounded p-1 text-attenue-texte hover:bg-attenue hover:text-texte"
        aria-label="Masquer pour cette session"
        title="Masquer — l'avis reviendra au prochain lancement"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

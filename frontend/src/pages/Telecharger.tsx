/**
 * Les paquets clients : bureau, mobile, et qui les a pris.
 *
 * POURQUOI CET ECRAN EXISTE. L'application se sert dans un navigateur, mais un
 * poste de magasin gagne a l'avoir installee : elle demarre seule, garde son
 * adresse de serveur et survit a un onglet ferme par megarde. Restait a
 * distribuer les installateurs — ce qui se faisait par cle USB, donc mal, donc
 * chaque poste finissait sur une version differente.
 *
 * LE SERVEUR LES SERT LUI-MEME, parce que le reseau est local et qu'un lien
 * externe deviendrait inaccessible le jour ou la ligne tombe.
 *
 * CE QUI MANQUE EST DIT. Une plateforme sans paquet affiche pourquoi : macOS et
 * iOS demandent un Mac pour etre signes, Android une chaine Java. Laisser la
 * case vide ferait croire a un oubli, et quelqu'un chercherait le fichier.
 */
import { useQuery } from '@tanstack/react-query'
import {
  Apple,
  Download,
  Info,
  Laptop,
  Monitor,
  Smartphone,
  Terminal,
} from 'lucide-react'
import { api, jeton, serveur } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Chargement,
} from '../composants/ui/base'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { fmt } from '../lib/utils'
import { VERSION } from '../lib/version'

const MODULE = 'PARAMETRES'

interface Paquet {
  fichier: string
  plateforme: string
  plateforme_libelle: string
  /** Version minimale du systeme, annoncee avant le telechargement. */
  compatibilite: string
  version: string
  taille_octets: number
  nb_telechargements: number
}

interface LigneJournal extends Record<string, unknown> {
  fichier: string
  plateforme: string
  version: string
  taille_octets?: number
  date_telechargement: string
  utilisateur: string
  adresse_ip?: string | null
}

/**
 * Les plateformes que l'application vise, dans l'ordre ou on les rencontre.
 *
 * `attente` explique une absence. Ce n'est pas une excuse : c'est ce qu'il
 * faudrait pour que le paquet existe, afin que la question ne soit pas reposee
 * tous les mois.
 */
const PLATEFORMES: {
  cle: string
  libelle: string
  Icone: typeof Monitor
  /** Version minimale du systeme, meme quand aucun paquet n'est publie. */
  compatibilite: string
  attente: string
}[] = [
  {
    cle: 'windows',
    libelle: 'Windows',
    Icone: Monitor,
    compatibilite: 'Windows 10 1803 ou plus recent, 64 bits',
    attente: "L'installateur se fabrique depuis le poste de developpement.",
  },
  {
    cle: 'linux',
    libelle: 'Linux',
    Icone: Terminal,
    compatibilite: 'Ubuntu 22.04 / Debian 12 ou plus recents, 64 bits',
    attente: 'A produire sur le serveur, qui porte deja la chaine de compilation.',
  },
  {
    cle: 'linuxportable',
    libelle: 'Linux portable',
    Icone: Terminal,
    compatibilite: 'Toute distribution 64 bits munie de FUSE',
    attente: 'A produire sur le serveur, en meme temps que le paquet Debian.',
  },
  {
    cle: 'android',
    libelle: 'Android',
    Icone: Smartphone,
    compatibilite: 'Android 8.0 ou plus recent',
    attente:
      'Demande le SDK Android, le NDK et une cle de signature. Ces outils ne sont pas encore \
       installes sur le poste de developpement.',
  },
  {
    cle: 'macos',
    libelle: 'macOS',
    Icone: Laptop,
    compatibilite: 'macOS 10.15 Catalina ou plus recent',
    attente:
      'Un Mac est indispensable : la chaine d Apple ne tourne ni sous Windows ni sous Linux. \
       C est une contrainte materielle, pas un choix.',
  },
  {
    cle: 'ios',
    libelle: 'iOS',
    Icone: Apple,
    compatibilite: 'iOS 13 ou plus recent',
    attente:
      'Un Mac, Xcode et un compte developpeur Apple payant. Meme contrainte materielle que macOS.',
  },
]

/** Une taille de fichier, lisible. */
function taille(octets: number): string {
  if (!octets) return '—'
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`
}

export function Telecharger() {
  const { peut } = useAuth()
  const droits = useDroits(MODULE)

  const qPaquets = useQuery({
    queryKey: ['telechargements'],
    queryFn: () => api.get<Paquet[]>('/api/telechargements'),
  })
  const qJournal = useQuery({
    queryKey: ['telechargements-journal'],
    queryFn: () => api.get<LigneJournal[]>('/api/telechargements/journal'),
    enabled: peut(MODULE, 'LIRE'),
  })

  /**
   * LE TELECHARGEMENT PASSE PAR UN CLIC, PAS PAR `fetch`.
   *
   * L'API exige un jeton dans un en-tete, qu'un `<a href>` ne sait pas poser.
   * On ouvre donc la route dans un onglet avec le jeton en parametre… non :
   * cela l'ecrirait dans l'historique et dans les journaux du serveur. On
   * telecharge donc en memoire, puis on remet le contenu au navigateur par un
   * lien temporaire. Un installateur pese quelques megaoctets : le detour est
   * invisible, et le jeton ne quitte jamais l'en-tete.
   */
  async function prendre(p: Paquet) {
    const r = await fetch(`${serveur()}/api/telechargements/${encodeURIComponent(p.fichier)}`, {
      headers: { Authorization: `Bearer ${jeton.lire() ?? ''}` },
    })
    if (!r.ok) return
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = p.fichier
    a.click()
    URL.revokeObjectURL(url)
    void qPaquets.refetch()
    void qJournal.refetch()
  }

  const paquets = qPaquets.data ?? []
  const parPlateforme = (cle: string) => paquets.filter((p) => p.plateforme === cle)

  const colonnes: Colonne<LigneJournal>[] = [
    {
      champ: 'date_telechargement',
      entete: 'Telecharge le',
      rendu: (l) => fmt.dateHeure(l.date_telechargement),
    },
    { champ: 'utilisateur', entete: 'Par' },
    { champ: 'plateforme', entete: 'Plateforme' },
    {
      champ: 'version',
      entete: 'Version',
      rendu: (l) => <span className="font-mono text-xs">{l.version}</span>,
    },
    {
      champ: 'fichier',
      entete: 'Fichier',
      secondaire: true,
      rendu: (l) => <span className="font-mono text-[11px]">{l.fichier}</span>,
    },
    { champ: 'adresse_ip', entete: 'Adresse IP', secondaire: true,
      rendu: (l) => fmt.texte(l.adresse_ip) },
  ]

  if (qPaquets.isLoading) return <Chargement texte="Lecture des paquets…" />

  return (
    <div>
      <EnTetePage
        titre="Telecharger l application"
        description={`Version en service : ${VERSION}. Installer le client garde l adresse du serveur et evite de rouvrir un onglet chaque matin.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PLATEFORMES.map(({ cle, libelle, Icone, compatibilite, attente }) => {
          const dispo = parPlateforme(cle)
          const derniere = dispo[0]
          return (
            <Carte key={cle}>
              <CarteEntete>
                <CarteTitre className="flex items-center gap-2">
                  <Icone className="size-4 text-attenue-texte" />
                  {libelle}
                  {derniere && <Badge ton="succes">{derniere.version}</Badge>}
                </CarteTitre>
              </CarteEntete>
              <CarteCorps className="space-y-2">
                {/* LA COMPATIBILITE EST DITE AVANT LE TELECHARGEMENT, qu'il y
                    ait un paquet ou non. Un installateur qui refuse de demarrer
                    sur un poste trop ancien n'explique jamais pourquoi : il
                    affiche une bibliotheque manquante, ou ne fait rien. On
                    conclut que le fichier est casse, et on rappelle. */}
                <div className="flex items-start gap-1.5 text-[11px] leading-snug text-attenue-texte">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  <span>{derniere?.compatibilite || compatibilite}</span>
                </div>

                {derniere ? (
                  <>
                    <div className="text-[12px] text-attenue-texte">
                      {taille(derniere.taille_octets)}
                      {derniere.nb_telechargements > 0 &&
                        ` · pris ${derniere.nb_telechargements} fois`}
                    </div>
                    <Bouton className="w-full" onClick={() => void prendre(derniere)}>
                      <Download />
                      Telecharger
                    </Bouton>
                    {/* Les versions precedentes restent accessibles : un poste
                        qu'on ne peut pas remettre dans son etat d'hier est un
                        poste qu'on n'ose plus mettre a jour. */}
                    {dispo.slice(1).map((p) => (
                      <button
                        key={p.fichier}
                        type="button"
                        onClick={() => void prendre(p)}
                        className="w-full rounded px-2 py-1 text-left text-[11px] text-attenue-texte hover:bg-attenue hover:text-texte"
                      >
                        version {p.version} · {taille(p.taille_octets)}
                      </button>
                    ))}
                  </>
                ) : (
                  <p className="text-[12px] leading-relaxed text-attenue-texte">{attente}</p>
                )}
              </CarteCorps>
            </Carte>
          )
        })}
      </div>

      {paquets.length === 0 && (
        <Alerte ton="info" className="mt-3" titre="Aucun paquet publie">
          Deposer les installateurs dans le dossier des paquets du serveur. Le nom porte la
          plateforme et la version : <code>gestionfil-windows-0.1.0.exe</code>. Rien d autre n est
          a declarer.
        </Alerte>
      )}

      {droits.peutLire && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-texte">
            Journal des telechargements
          </h2>
          <p className="mb-2 text-[12px] text-attenue-texte">
            Sur quelle version tourne un poste donne. C est la question qu on se pose quand un
            utilisateur decrit un comportement que le code n a plus.
          </p>
          <TableDroits
            exportable="journal-des-telechargements"
            module={MODULE}
            colonnes={colonnes}
            lignes={qJournal.data ?? []}
            chargement={qJournal.isLoading}
            cle={(l) => `${l.date_telechargement}-${l.fichier}-${l.utilisateur}`}
            titreCarte={(l) => `${l.plateforme} ${l.version}`}
            texteVide="Aucun telechargement pour l instant."
          />
        </>
      )}
    </div>
  )
}

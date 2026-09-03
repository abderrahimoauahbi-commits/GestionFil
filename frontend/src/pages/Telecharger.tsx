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
 * L'ECRAN EST FAIT POUR ETRE MONTRE A QUELQU'UN QUI DOIT INSTALLER, pas pour
 * etre lu par un administrateur. D'ou trois partis pris :
 *
 *   CE QUI SE TELECHARGE PASSE DEVANT. Les plateformes disponibles occupent le
 *   haut, en grand, un bouton chacune. Celles qui n'ont pas de paquet descendent
 *   plus bas, en gris : elles informent, elles ne sollicitent pas. La premiere
 *   version alignait les six sur un pied d'egalite, et l'oeil ne savait pas ou
 *   cliquer.
 *
 *   CE QUI MANQUE EST DIT, ET POURQUOI. macOS et iOS demandent un Mac — une
 *   contrainte materielle, pas un oubli. Laisser une case vide ferait chercher
 *   un fichier qui n'existe pas.
 *
 *   LE SUPPORT EST EN BAS. La version en service, l'adresse du serveur et le
 *   telephone de l'entreprise : les trois choses qu'on cherche quand une
 *   installation resiste.
 */
import { useQuery } from '@tanstack/react-query'
import {
  Apple,
  CheckCircle2,
  Download,
  Info,
  Laptop,
  LifeBuoy,
  Monitor,
  Phone,
  Server,
  Smartphone,
  Terminal,
} from 'lucide-react'
import { api, jeton, serveur } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Bouton, Chargement } from '../composants/ui/base'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { useEntreprise } from '../lib/entreprise'
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
 * Les plateformes visees, dans l'ordre ou on les rencontre dans l'usine.
 *
 * `attente` explique une absence. Ce n'est pas une excuse : c'est ce qu'il
 * faudrait pour que le paquet existe, afin que la question ne soit pas reposee
 * tous les mois.
 */
const PLATEFORMES: {
  cle: string
  libelle: string
  Icone: typeof Monitor
  /** Le geste d'installation, en une phrase. */
  installation: string
  compatibilite: string
  attente: string
}[] = [
  {
    cle: 'windows',
    libelle: 'Windows',
    Icone: Monitor,
    installation: 'Ouvrir le fichier telecharge et suivre l assistant.',
    compatibilite: 'Windows 10 1803 ou plus recent, 64 bits',
    attente: "L'installateur se fabrique depuis le poste de developpement.",
  },
  {
    cle: 'linux',
    libelle: 'Linux',
    Icone: Terminal,
    installation: 'sudo apt install ./gestionfil-linux-0.1.0.deb',
    compatibilite: 'Ubuntu 22.04 / Debian 12 ou plus recents, 64 bits',
    attente: 'A produire sur le serveur, qui porte deja la chaine de compilation.',
  },
  {
    cle: 'android',
    libelle: 'Android',
    Icone: Smartphone,
    installation: 'Ouvrir le fichier .apk depuis le telephone.',
    compatibilite: 'Android 8.0 ou plus recent',
    attente:
      'Demande le SDK Android, le NDK et une cle de signature. Ces outils ne sont pas encore ' +
      'installes sur le poste de developpement.',
  },
  {
    cle: 'macos',
    libelle: 'macOS',
    Icone: Laptop,
    installation: 'Glisser l application dans le dossier Applications.',
    compatibilite: 'macOS 10.15 Catalina ou plus recent',
    attente:
      'Un Mac est indispensable : la chaine d Apple ne tourne ni sous Windows ni sous Linux. ' +
      'C est une contrainte materielle, pas un choix.',
  },
  {
    cle: 'ios',
    libelle: 'iOS',
    Icone: Apple,
    installation: 'Par l App Store, une fois l application publiee.',
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
  const entreprise = useEntreprise()

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
   * LE TELECHARGEMENT PASSE PAR UN CLIC, PAS PAR UN LIEN.
   *
   * L'API exige un jeton dans un en-tete, qu'un `<a href>` ne sait pas poser.
   * Le mettre dans l'adresse l'ecrirait dans l'historique du navigateur et dans
   * les journaux du serveur. On telecharge donc en memoire, puis on remet le
   * contenu au navigateur par un lien temporaire : le detour est invisible sur
   * deux megaoctets, et le jeton ne quitte jamais l'en-tete.
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
    {
      champ: 'adresse_ip',
      entete: 'Adresse IP',
      secondaire: true,
      rendu: (l) => fmt.texte(l.adresse_ip),
    },
  ]

  if (qPaquets.isLoading) return <Chargement texte="Lecture des paquets…" />

  const disponibles = PLATEFORMES.filter((p) => parPlateforme(p.cle).length > 0)
  const manquantes = PLATEFORMES.filter((p) => parPlateforme(p.cle).length === 0)

  return (
    <div>
      <EnTetePage
        titre="Telecharger l application"
        description="Installer le client garde l adresse du serveur et evite de rouvrir un onglet chaque matin."
      />

      {/* --- CE QUI SE TELECHARGE, EN GRAND ------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {disponibles.map(({ cle, libelle, Icone, installation }) => {
          const dispo = parPlateforme(cle)
          const derniere = dispo[0]
          return (
            <div
              key={cle}
              className="flex flex-col rounded-[var(--radius)] border border-bordure bg-surface p-4"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[var(--radius)] bg-primaire/10 text-primaire">
                  <Icone className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-tight text-texte">
                    {libelle}
                  </div>
                  <div className="text-[12px] tabular-nums text-attenue-texte">
                    version {derniere.version} · {taille(derniere.taille_octets)}
                  </div>
                </div>
              </div>

              <Bouton className="mt-3 w-full" onClick={() => void prendre(derniere)}>
                <Download />
                Telecharger
              </Bouton>

              <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-attenue-texte">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-succes" />
                <span>{derniere.compatibilite}</span>
              </p>
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-snug text-attenue-texte">
                <Info className="mt-0.5 size-3 shrink-0" />
                <span>{installation}</span>
              </p>

              {/* Les versions precedentes restent accessibles : un poste qu'on
                  ne peut pas remettre dans son etat d'hier est un poste qu'on
                  n'ose plus mettre a jour. */}
              {dispo.slice(1).map((p) => (
                <button
                  key={p.fichier}
                  type="button"
                  onClick={() => void prendre(p)}
                  className="mt-1 rounded px-1.5 py-1 text-left text-[11px] text-attenue-texte hover:bg-attenue hover:text-texte"
                >
                  version {p.version} · {taille(p.taille_octets)}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {paquets.length === 0 && (
        <Alerte ton="info" titre="Aucun paquet publie">
          Deposer les installateurs dans le dossier des paquets du serveur. Le nom porte la
          plateforme et la version : <code>gestionfil-windows-0.1.0.exe</code>. Rien d autre n est
          a declarer.
        </Alerte>
      )}

      {/* --- CE QUI N'EXISTE PAS ENCORE, PLUS BAS ET EN GRIS -------------- */}
      {manquantes.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
            Pas encore disponibles
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {manquantes.map(({ cle, libelle, Icone, compatibilite, attente }) => (
              <div
                key={cle}
                className="rounded-[var(--radius)] border border-dashed border-bordure p-3"
              >
                <div className="flex items-center gap-2 text-[13px] font-medium text-attenue-texte">
                  <Icone className="size-4 shrink-0" />
                  {libelle}
                  <span className="ml-auto truncate text-[11px] font-normal">{compatibilite}</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-attenue-texte">{attente}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* --- SUPPORT ET VERSION -------------------------------------------
          Les trois choses qu'on cherche quand une installation resiste : sur
          quelle version on est, a quel serveur on parle, et qui appeler. */}
      <div className="mt-6 grid gap-4 rounded-[var(--radius)] border border-bordure bg-attenue/40 p-4 sm:grid-cols-3">
        <Renseignement Icone={Info} titre="Version en service" valeur={VERSION}>
          Les postes installes doivent porter la meme. Le journal dit qui a pris quoi.
        </Renseignement>

        <Renseignement
          Icone={Server}
          titre="Serveur"
          valeur={serveur() || 'la machine qui sert cette page'}
        >
          L adresse est inscrite dans l installateur : rien a saisir. Elle se change depuis l ecran
          de connexion si le serveur demenage.
        </Renseignement>

        <Renseignement
          Icone={LifeBuoy}
          titre="Support"
          valeur={entreprise.nom ?? 'Polyfashions Carpet'}
        >
          {entreprise.telephone ? (
            <span className="flex items-start gap-1.5">
              <Phone className="mt-0.5 size-3 shrink-0" />
              {entreprise.telephone}
            </span>
          ) : (
            "Contacter l administrateur de l'ERP."
          )}
        </Renseignement>
      </div>

      {droits.peutLire && (
        <>
          <h2 className="mb-1 mt-6 text-sm font-semibold text-texte">
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

/** Un renseignement du pied : une icone, un titre, une valeur, une explication. */
function Renseignement({
  Icone,
  titre,
  valeur,
  children,
}: {
  Icone: typeof Info
  titre: string
  valeur: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
        <Icone className="size-3" />
        {titre}
      </div>
      <div className="mt-0.5 truncate text-[14px] font-medium text-texte" title={valeur}>
        {valeur}
      </div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-attenue-texte">{children}</div>
    </div>
  )
}

/**
 * Telecharger l'application.
 *
 * UNE LIGNE PAR SYSTEME, UN BOUTON, LA VERSION. Rien d'autre.
 *
 * Les deux versions precedentes de cet ecran expliquaient : la compatibilite,
 * le geste d'installation, ce qui manquait et pourquoi, un bandeau de support.
 * Tout cela etait vrai et personne ne le lit. On vient ici pour prendre un
 * fichier ; l'ecran doit le donner, pas l'accompagner d'une notice.
 *
 * LE BOUTON EST UN VRAI LIEN. Il passait par `fetch` parce que la route d'API
 * exigeait un jeton dans un en-tete — un detour invisible, mais un bouton qui
 * n'est pas un lien ne s'ouvre pas dans un onglet, ne se copie pas, ne se colle
 * pas dans un courriel. Les paquets sont donc servis en fichiers sous
 * `/telechargements/`, comme chez tout editeur : un installateur n'est pas un
 * secret.
 *
 * LE JOURNAL RESTE, ecrit au clic. Savoir sur quelle version tourne un poste est
 * la seule question qu'on se pose apres coup.
 */
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api, serveur } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Badge, Chargement } from '../composants/ui/base'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { fmt } from '../lib/utils'

const MODULE = 'PARAMETRES'

interface Paquet {
  fichier: string
  plateforme: string
  plateforme_libelle: string
  version: string
  taille_octets: number
  nb_telechargements: number
}

interface LigneJournal extends Record<string, unknown> {
  fichier: string
  plateforme: string
  version: string
  date_telechargement: string
  utilisateur: string
  adresse_ip?: string | null
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
  ]

  if (qPaquets.isLoading) return <Chargement texte="Lecture des paquets…" />
  const paquets = qPaquets.data ?? []

  /* LA DERNIERE VERSION D'ABORD, LE RESTE EN DESSOUS.
     L'ecran empilait toutes les versions jamais publiees — Windows 0.1.0,
     0.3.0, 0.4.0, Linux 0.1.0, 0.3.0 — au meme rang et dans l'ordre du
     systeme de fichiers. Celui qui vient installer l'ERP ne sait pas laquelle
     prendre, et rien ne le lui dit. Or dans quatre-vingt-dix-neuf cas sur
     cent, la reponse est « la plus recente pour ma machine ».
     Les anciennes ne disparaissent pas : elles descendent. On en a besoin le
     jour ou une version neuve pose un probleme et qu'il faut revenir. */
  const rang = (v: string) =>
    v.split(/[.\-+]/).reduce((a, x) => a * 1000 + (parseInt(x, 10) || 0), 0)

  const derniers = new Map<string, Paquet>()
  for (const p of paquets) {
    const tenant = derniers.get(p.plateforme)
    if (!tenant || rang(p.version) > rang(tenant.version)) derniers.set(p.plateforme, p)
  }
  const courants = [...derniers.values()].sort((a, b) =>
    a.plateforme_libelle.localeCompare(b.plateforme_libelle),
  )
  const anciens = paquets
    .filter((p) => derniers.get(p.plateforme)?.fichier !== p.fichier)
    .sort((a, b) => rang(b.version) - rang(a.version))

  return (
    <div>
      <EnTetePage titre="Télécharger l application" />

      {paquets.length === 0 ? (
        <Alerte ton="info" titre="Aucun paquet publie">
          Deposer les installateurs dans le dossier des paquets du serveur. Le nom porte la
          plateforme et la version : <code>gestionfil-windows-0.1.0.exe</code>.
        </Alerte>
      ) : (
        <div className="max-w-2xl divide-y divide-bordure rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
          {courants.map((p) => (
            <div key={p.fichier} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-texte">
                    {p.plateforme_libelle}
                  </span>
                  <Badge ton="succes">derniere version</Badge>
                </div>
                <div className="text-[12px] tabular-nums text-attenue-texte">
                  Version {p.version} · {(p.taille_octets / 1e6).toFixed(1)} Mo
                </div>
              </div>

              {/* UN VRAI LIEN : il s'ouvre dans un onglet, se copie, se colle.
                  `download` demande l'enregistrement plutot que l'affichage. Le
                  clic inscrit au passage la ligne du journal ; s'il echoue, le
                  telechargement part quand meme — la trace ne vaut pas qu'on
                  prive quelqu'un de son installateur. */}
              <a
                href={`${serveur()}/telechargements/${encodeURIComponent(p.fichier)}`}
                download={p.fichier}
                onClick={() => {
                  void api
                    .post('/api/telechargements/journal', { fichier: p.fichier })
                    .then(() => qJournal.refetch())
                    .catch(() => undefined)
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)]
                           bg-primaire px-3 py-1.5 text-[13px] font-medium text-primaire-texte
                           transition-[filter] hover:brightness-110"
              >
                <Download className="size-4" />
                Telecharger
              </a>
            </div>
          ))}
        </div>
      )}

      {/* LES VERSIONS PRECEDENTES, REPLIEES.
          Elles servent le jour ou une version neuve pose un probleme et qu'il
          faut revenir en arriere — cas rare, mais sans issue quand le fichier
          a disparu. Repliees, elles ne brouillent plus le choix courant. */}
      {anciens.length > 0 && (
        <details className="mt-3 max-w-2xl">
          <summary
            className="cursor-pointer select-none text-[12px] text-attenue-texte
                       transition-colors hover:text-texte"
          >
            Versions precedentes ({anciens.length})
          </summary>
          <ul className="mt-2 divide-y divide-bordure/60 rounded-[var(--radius)] border border-bordure">
            {anciens.map((p) => (
              <li
                key={p.fichier}
                className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]"
              >
                <span className="text-attenue-texte">
                  {p.plateforme_libelle} · version {p.version}
                </span>
                <a
                  href={`${serveur()}/telechargements/${encodeURIComponent(p.fichier)}`}
                  download={p.fichier}
                  className="text-primaire underline-offset-2 hover:underline"
                >
                  Telecharger
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {droits.peutLire && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-texte">
            Journal des telechargements
          </h2>
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

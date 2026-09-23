/**
 * LA MISE A JOUR SE FAIT TOUTE SEULE.
 *
 * POURQUOI LE BANDEAU NE SUFFISAIT PAS. On savait dire « une version plus
 * recente existe », avec un lien. Il fallait ensuite telecharger, fermer
 * l'application, retrouver le fichier, relancer un installateur, repondre a
 * trois questions. Personne ne le fait — et surtout pas au milieu d'une
 * journee de travail. Les postes restaient donc sur la version du jour de leur
 * installation, pendant que le serveur avancait.
 *
 * CE QUE FAIT CELUI-CI. Au demarrage, l'application demande au serveur s'il
 * existe mieux que ce qu'elle porte. Si oui, elle telecharge, VERIFIE LA
 * SIGNATURE contre la cle publique compilee dedans, installe et redemarre.
 * Une seule chose est demandee a la personne : le moment. Interrompre une
 * saisie de reception pour redemarrer serait une facon sure de faire detester
 * les mises a jour.
 *
 * LA SIGNATURE EST CE QUI REND LA CHOSE ACCEPTABLE. Sans la cle privee — qui
 * ne quitte pas le poste de construction — personne ne peut faire installer
 * quoi que ce soit sur les postes de l'usine, meme en tenant le serveur.
 *
 * HORS DE L'APPLICATION INSTALLEE, CE COMPOSANT NE FAIT RIEN. Au navigateur,
 * la question ne se pose pas : la page servie est toujours celle du serveur.
 */
import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Alerte, Bouton } from './ui/base'
import { estBureau } from '../lib/utils'

interface Trouvee {
  version: string
  notes?: string
  /** Lance le telechargement, puis l'installation. */
  installer: () => Promise<void>
}

export function MiseAJourAuto() {
  const [trouvee, setTrouvee] = useState<Trouvee | null>(null)
  const [avancement, setAvancement] = useState<number | null>(null)
  const [masque, setMasque] = useState(false)

  useEffect(() => {
    if (!estBureau()) return
    let vivant = true

    // L'IMPORT EST DYNAMIQUE pour que la construction navigateur n'embarque
    // pas un module qui n'y servirait a rien et n'y fonctionnerait pas.
    ;(async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const maj = await check()
        if (!vivant || !maj) return
        setTrouvee({
          version: maj.version,
          notes: maj.body,
          installer: async () => {
            let recu = 0
            let total = 0
            await maj.downloadAndInstall((e) => {
              if (e.event === 'Started') total = e.data.contentLength ?? 0
              else if (e.event === 'Progress') {
                recu += e.data.chunkLength
                setAvancement(total ? Math.round((recu / total) * 100) : null)
              }
            })
            const { relaunch } = await import('@tauri-apps/plugin-process')
            await relaunch()
          },
        })
      } catch (e) {
        // UNE MISE A JOUR QUI ECHOUE NE DOIT PAS EMPECHER DE TRAVAILLER.
        // Serveur injoignable, signature refusee, greffon absent d'une
        // version ancienne : dans tous les cas l'ERP s'ouvre normalement, et
        // l'on garde la trace en console pour qui la cherche.
        console.warn('mise a jour : verification impossible', e)
      }
    })()

    return () => {
      vivant = false
    }
  }, [])

  if (!trouvee || masque) return null

  const enCours = avancement !== null

  return (
    <Alerte ton="info" className="mb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex-1 min-w-[16rem]">
          <strong>La version {trouvee.version} est disponible.</strong>{' '}
          {enCours
            ? `Telechargement ${avancement}% — l'application redemarrera toute seule.`
            : "L'installation prend moins d'une minute et l'application redemarre ensuite. Choisissez votre moment."}
        </span>

        {!enCours && (
          <>
            <Bouton
              taille="sm"
              onClick={() => {
                void trouvee.installer().catch((e) => {
                  setAvancement(null)
                  toast.error("La mise a jour n'a pas abouti", {
                    description: String(e),
                  })
                })
              }}
            >
              <Download />
              Installer maintenant
            </Bouton>
            <Bouton variante="contour" taille="sm" onClick={() => setMasque(true)}>
              Plus tard
            </Bouton>
          </>
        )}

        {enCours && <RefreshCw className="size-4 animate-spin" />}
      </div>
    </Alerte>
  )
}

/**
 * Barre de titre de l'atelier.
 *
 * La fenetre Tauri est declaree sans decoration : ce composant fournit donc a
 * la fois la zone de glissement (attribut Tauri), les menus et les boutons
 * systeme. Les boutons
 * reproduisent les proportions de Windows 11 (46 x 32 px, croix rouge au
 * survol) plutot que des icones rondes : sur un poste de bureau, l'ecart avec
 * les autres fenetres se remarque immediatement.
 */
import { useCallback, useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Menu,
  MenuContenu,
  MenuDeclencheur,
  MenuElement,
  MenuSeparateur,
} from '../ui/surcouches'
import { cn } from '../../lib/utils'

/** Charge l'API fenetre a la demande : elle n'existe pas hors de Tauri. */
async function fenetre() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export interface Commande {
  id: string
  libelle: string
  raccourci?: string
  executer: () => void
  separateurAvant?: boolean
  actif?: boolean
}

export interface MenuBarre {
  libelle: string
  commandes: Commande[]
}

export function BarreTitre({
  menus,
  titre,
}: {
  menus: MenuBarre[]
  /** Titre du document actif, affiche au centre comme dans l'editeur. */
  titre: string
}) {
  const [maximisee, setMaximisee] = useState(false)

  useEffect(() => {
    let vivant = true
    let detacher: (() => void) | undefined

    void (async () => {
      try {
        const f = await fenetre()
        const relever = async () => {
          const v = await f.isMaximized()
          if (vivant) setMaximisee(v)
        }
        await relever()
        detacher = await f.onResized(() => void relever())
      } catch {
        // Hors Tauri : la barre reste decorative.
      }
    })()

    return () => {
      vivant = false
      detacher?.()
    }
  }, [])

  /**
   * Commandes de fenetre.
   *
   * L'echec est signale, jamais avale : ces commandes dependent de permissions
   * declarees dans `capabilities/`, et un refus renvoie une erreur. Un `catch`
   * muet donnerait des boutons inertes sans le moindre indice — c'est
   * exactement ce qui s'est produit ici.
   */
  const agir = useCallback(async (action: 'reduire' | 'basculer' | 'fermer') => {
    try {
      const f = await fenetre()
      if (action === 'reduire') await f.minimize()
      else if (action === 'basculer') await f.toggleMaximize()
      else await f.close()
    } catch (erreur) {
      console.error(`Commande de fenetre « ${action} » refusee`, erreur)
      toast.error("La fenetre n'a pas repondu", {
        description: String(erreur),
      })
    }
  }, [])

  return (
    <header
      /* `data-tauri-drag-region` est le mecanisme de Tauri ; la propriete CSS
         `-webkit-app-region` est propre a Electron et n'a aucun effet ici.
         « deep » etend la zone a tout le sous-arbre : les boutons et les menus
         bloquent le glissement d'eux-memes, sans declaration supplementaire.
         Le double-clic pour agrandir est gere par Tauri — ne pas le doubler
         d'un `onDoubleClick`, les deux basculements s'annuleraient. */
      data-tauri-drag-region="deep"
      className="flex h-[var(--at-h-titre)] shrink-0 select-none items-center
                 border-b border-bordure bg-[hsl(var(--at-titre))] pl-2"
    >
      {/* --- Marque ---------------------------------------------------- */}
      <div className="mr-1 grid size-5 shrink-0 place-items-center rounded-[2px] bg-primaire text-[10px] font-bold text-primaire-texte">
        GF
      </div>

      {/* --- Menus ------------------------------------------------------ */}
      <nav className="flex items-center" data-nodrag>
        {menus.map((m) => (
          <Menu key={m.libelle}>
            <MenuDeclencheur asChild>
              <button
                className="rounded-[2px] px-2 py-0.5 text-[12px] text-texte/85
                           hover:bg-[hsl(var(--at-liste-survol))] data-[state=open]:bg-[hsl(var(--at-liste-survol))]"
              >
                {m.libelle}
              </button>
            </MenuDeclencheur>
            <MenuContenu align="start" className="w-64">
              {m.commandes.map((c) => (
                <div key={c.id}>
                  {c.separateurAvant && <MenuSeparateur />}
                  <MenuElement onSelect={c.executer}>
                    <span className="flex-1 truncate">{c.libelle}</span>
                    {c.raccourci && (
                      <span className="ml-4 shrink-0 font-mono text-[10px] text-attenue-texte">
                        {c.raccourci}
                      </span>
                    )}
                  </MenuElement>
                </div>
              ))}
            </MenuContenu>
          </Menu>
        ))}
      </nav>

      {/* --- Titre centre ----------------------------------------------- */}
      <div className="pointer-events-none flex min-w-0 flex-1 justify-center px-4">
        <span className="truncate text-[12px] text-attenue-texte">{titre}</span>
      </div>

      {/* --- Boutons systeme -------------------------------------------- */}
      <div className="flex h-full shrink-0" data-nodrag>
        <BoutonSysteme onClick={() => void agir('reduire')} etiquette="Reduire">
          <Minus className="size-3.5" strokeWidth={1.5} />
        </BoutonSysteme>
        <BoutonSysteme
          onClick={() => void agir('basculer')}
          etiquette={maximisee ? 'Restaurer' : 'Agrandir'}
        >
          {maximisee ? (
            <Copy className="size-3 -scale-x-100" strokeWidth={1.5} />
          ) : (
            <Square className="size-3" strokeWidth={1.5} />
          )}
        </BoutonSysteme>
        <BoutonSysteme onClick={() => void agir('fermer')} etiquette="Fermer" destructif>
          <X className="size-4" strokeWidth={1.5} />
        </BoutonSysteme>
      </div>
    </header>
  )
}

function BoutonSysteme({
  onClick,
  etiquette,
  destructif,
  children,
}: {
  onClick: () => void
  etiquette: string
  destructif?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiquette}
      title={etiquette}
      className={cn(
        'grid h-full w-[46px] place-items-center text-texte transition-colors',
        destructif
          ? 'hover:bg-[#c42b1c] hover:text-white'
          : 'hover:bg-[hsl(var(--at-liste-survol))]',
      )}
    >
      {children}
    </button>
  )
}

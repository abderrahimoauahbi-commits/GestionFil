/**
 * Bandeau d'onglets d'un groupe.
 *
 * Conventions de l'editeur : titre en italique pour un apercu, pastille a la
 * place de la croix pour un onglet epingle, clic du milieu pour fermer,
 * glisser-deposer pour reordonner, menu au clic droit.
 *
 * Le glisser-deposer traverse les groupes : l'onglet tire porte son chemin
 * *et* son groupe d'origine dans le presse-papiers de glissement, si bien que
 * le groupe qui recoit sait s'il s'agit d'un reordonnancement chez lui ou d'un
 * transfert depuis un voisin. C'est ce qui permet de composer « catalogue a
 * gauche, bon de commande a droite ».
 *
 * Le menu est **pilote**, et non branche sur un declencheur : le primitif de
 * menu deroulant s'ouvre au clic gauche, ce qui ouvrirait le menu chaque fois
 * qu'on change d'onglet. L'ancre est un point invisible dans l'onglet, et seul
 * `onContextMenu` ouvre.
 */
import { useState } from 'react'
import { Columns2, Copy, Pin, PinOff, X } from 'lucide-react'
import {
  Menu,
  MenuContenu,
  MenuDeclencheur,
  MenuElement,
  MenuSeparateur,
  Infobulle,
} from '../ui/surcouches'
import { cn } from '../../lib/utils'
import { decrire, type Groupe } from './etat'

/** Format porte par le glissement : chemin et groupe d'origine. */
const FORMAT = 'application/x-gestionfil-onglet'

export function Onglets({
  groupe,
  focalise,
  plusieursGroupes,
  activer,
  fixer,
  fermer,
  fermerAutres,
  fermerADroite,
  fermerTous,
  basculerEpingle,
  deplacer,
  deplacerVersGroupe,
  deplacerVersFenetre,
  fractionner,
  fermerGroupe,
}: {
  groupe: Groupe
  focalise: boolean
  plusieursGroupes: boolean
  activer: (chemin: string) => void
  fixer: (chemin: string) => void
  fermer: (chemin: string) => void
  fermerAutres: (chemin: string) => void
  fermerADroite: (chemin: string) => void
  fermerTous: () => void
  basculerEpingle: (chemin: string) => void
  deplacer: (de: string, vers: string) => void
  deplacerVersGroupe: (chemin: string, source: string, cible: string) => void
  deplacerVersFenetre: (chemin: string) => void
  fractionner: () => void
  fermerGroupe: () => void
}) {
  const [menu, setMenu] = useState<string | null>(null)
  const [survol, setSurvol] = useState(false)

  /** Lit le presse-papiers de glissement, s'il porte bien un onglet. */
  const lire = (e: React.DragEvent): { chemin: string; source: string } | null => {
    const brut = e.dataTransfer.getData(FORMAT)
    if (!brut) return null
    try {
      return JSON.parse(brut)
    } catch {
      return null
    }
  }

  const deposer = (e: React.DragEvent, surOnglet?: string) => {
    e.preventDefault()
    setSurvol(false)
    const charge = lire(e)
    if (!charge) return
    if (charge.source === groupe.id) {
      if (surOnglet && surOnglet !== charge.chemin) deplacer(charge.chemin, surOnglet)
    } else {
      deplacerVersGroupe(charge.chemin, charge.source, groupe.id)
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Documents ouverts"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(FORMAT)) {
          e.preventDefault()
          setSurvol(true)
        }
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(e) => deposer(e)}
      className={cn(
        'defilement-x flex h-[var(--at-h-onglet)] shrink-0 items-stretch',
        'border-b border-bordure bg-[hsl(var(--at-onglet-inactif))]',
        // Cible de depot signalee, sinon on ne sait pas ou l'onglet va tomber.
        survol && 'ring-1 ring-inset ring-primaire',
      )}
    >
      {groupe.onglets.map((o) => {
        const { titre, detail, Icone } = decrire(o.chemin)
        const estActif = o.chemin === groupe.actif

        return (
          <div
            key={o.chemin}
            role="tab"
            aria-selected={estActif}
            tabIndex={estActif ? 0 : -1}
            title={detail ? `${titre} — ${detail}` : titre}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                FORMAT,
                JSON.stringify({ chemin: o.chemin, source: groupe.id }),
              )
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(FORMAT)) e.preventDefault()
            }}
            onDrop={(e) => {
              e.stopPropagation()
              deposer(e, o.chemin)
            }}
            onClick={() => activer(o.chemin)}
            onDoubleClick={() => fixer(o.chemin)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(o.chemin)
            }}
            onAuxClick={(e) => {
              // Bouton du milieu : fermeture, comme dans l'editeur.
              if (e.button === 1) {
                e.preventDefault()
                fermer(o.chemin)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activer(o.chemin)
              }
            }}
            className={cn(
              'group relative flex min-w-[110px] max-w-[220px] shrink-0 cursor-pointer',
              'select-none items-center gap-1.5 border-r border-bordure pl-2.5 pr-1.5 text-[13px]',
              estActif
                ? 'bg-[hsl(var(--at-onglet-actif))] text-texte'
                : 'bg-[hsl(var(--at-onglet-inactif))] text-attenue-texte hover:text-texte',
              // Le filet d'accent ne coiffe que l'onglet actif du groupe qui a
              // le focus : sinon deux groupes sembleraient tous deux actifs.
              estActif && focalise && 'onglet-actif',
            )}
          >
            <Icone className="size-4 shrink-0 opacity-80" strokeWidth={1.6} />
            <span className={cn('flex-1 truncate', o.apercu && 'italic')}>{titre}</span>

            {o.epingle ? (
              <button
                type="button"
                aria-label="Desepingler"
                onClick={(e) => {
                  e.stopPropagation()
                  basculerEpingle(o.chemin)
                }}
                className="grid size-5 shrink-0 place-items-center rounded-[2px]
                           hover:bg-[hsl(var(--at-liste-survol))]"
              >
                <Pin className="size-3" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Fermer ${titre}`}
                onClick={(e) => {
                  e.stopPropagation()
                  fermer(o.chemin)
                }}
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-[2px]',
                  'hover:bg-[hsl(var(--at-liste-survol))]',
                  // La croix ne se montre que sur l'onglet actif ou au survol :
                  // sinon le bandeau devient un mur de croix.
                  estActif ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <X className="size-3.5" />
              </button>
            )}

            {/* Ancre du menu contextuel : point sans surface, en bas a gauche de
                l'onglet, pour que le menu s'ouvre sous lui. */}
            <Menu
              open={menu === o.chemin}
              onOpenChange={(ouvert) => setMenu(ouvert ? o.chemin : null)}
            >
              <MenuDeclencheur asChild>
                <span aria-hidden className="pointer-events-none absolute bottom-0 left-2 size-0" />
              </MenuDeclencheur>
              <MenuContenu align="start" className="w-60">
                <MenuElement onSelect={() => fermer(o.chemin)}>
                  <X className="size-4" />
                  <span className="flex-1">Fermer</span>
                  <span className="font-mono text-[10px] text-attenue-texte">Ctrl+W</span>
                </MenuElement>
                <MenuElement onSelect={() => fermerAutres(o.chemin)}>
                  Fermer les autres
                </MenuElement>
                <MenuElement onSelect={() => fermerADroite(o.chemin)}>
                  Fermer ceux de droite
                </MenuElement>
                <MenuElement onSelect={fermerTous}>Tout fermer</MenuElement>
                <MenuSeparateur />
                <MenuElement onSelect={fractionner}>
                  <Columns2 className="size-4" />
                  <span className="flex-1">Fractionner ici</span>
                </MenuElement>
                <MenuElement onSelect={() => deplacerVersFenetre(o.chemin)}>
                  <Copy className="size-4" />
                  Deplacer vers une nouvelle fenetre
                </MenuElement>
                <MenuSeparateur />
                <MenuElement onSelect={() => basculerEpingle(o.chemin)}>
                  {o.epingle ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {o.epingle ? 'Desepingler' : 'Epingler'}
                </MenuElement>
                {o.apercu && (
                  <MenuElement onSelect={() => fixer(o.chemin)}>Garder ouvert</MenuElement>
                )}
              </MenuContenu>
            </Menu>
          </div>
        )
      })}

      {/* Reste de la bande : surface de depot, a la couleur des onglets. */}
      <div className="min-w-4 flex-1" />

      {/* Commandes du groupe, alignees a droite du bandeau. */}
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        <Infobulle contenu="Fractionner la zone de travail (Ctrl+\)">
          <button
            type="button"
            aria-label="Fractionner"
            onClick={fractionner}
            className="grid size-6 place-items-center rounded-[2px] text-attenue-texte
                       hover:bg-[hsl(var(--at-liste-survol))] hover:text-texte"
          >
            <Columns2 className="size-4" strokeWidth={1.6} />
          </button>
        </Infobulle>
        {plusieursGroupes && (
          <Infobulle contenu="Fermer ce groupe">
            <button
              type="button"
              aria-label="Fermer le groupe"
              onClick={fermerGroupe}
              className="grid size-6 place-items-center rounded-[2px] text-attenue-texte
                         hover:bg-[hsl(var(--at-liste-survol))] hover:text-texte"
            >
              <X className="size-4" strokeWidth={1.6} />
            </button>
          </Infobulle>
        )}
      </div>
    </div>
  )
}

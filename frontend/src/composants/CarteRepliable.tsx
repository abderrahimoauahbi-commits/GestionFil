/**
 * Carte repliable.
 *
 * Un ecran de saisie dense empile trois ou quatre blocs, et l'utilisateur qui
 * travaille sur le dernier passe sa journee a faire defiler les precedents.
 * Replier un bloc le reduit a son en-tete : il reste visible, donc retrouvable,
 * mais ne coute plus une hauteur d'ecran.
 *
 * L'etat est **retenu par carte et par utilisateur** : un planificateur qui
 * replie toujours l'entete la retrouve repliee le lendemain. Sans cela, le
 * geste serait a refaire a chaque ouverture, et personne ne s'en servirait.
 *
 * L'en-tete reste cliquable en entier, pas seulement le chevron : viser une
 * cible de 16 px pour replier un bloc est une punition inutile.
 */
import { useCallback, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Carte, CarteCorps, CarteEntete, CarteTitre } from './ui/base'
import { cn } from '../lib/utils'

const CLE = 'gestionfil.cartes.repliees'

function lire(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CLE) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export function CarteRepliable({
  id,
  titre,
  Icone,
  actions,
  resume,
  replieParDefaut = false,
  classeCorps,
  children,
}: {
  /** Identifiant stable : c'est lui qui porte la memoire du repli. */
  id: string
  titre: React.ReactNode
  Icone?: React.ComponentType<{ className?: string }>
  /** Boutons de la carte, a droite de l'en-tete. Ils ne replient pas. */
  actions?: React.ReactNode
  /** Une ligne affichee a la place du contenu quand la carte est repliee. */
  resume?: React.ReactNode
  replieParDefaut?: boolean
  classeCorps?: string
  children: React.ReactNode
}) {
  const [replie, setReplie] = useState<boolean>(() => lire()[id] ?? replieParDefaut)

  const basculer = useCallback(() => {
    setReplie((r) => {
      const suivant = !r
      try {
        localStorage.setItem(CLE, JSON.stringify({ ...lire(), [id]: suivant }))
      } catch {
        /* stockage indisponible : le repli marche quand meme, il n'est juste
           pas retenu d'une session a l'autre. */
      }
      return suivant
    })
  }, [id])

  const idCorps = `carte-${id}`

  return (
    <Carte>
      <CarteEntete>
        <button
          type="button"
          onClick={basculer}
          aria-expanded={!replie}
          aria-controls={idCorps}
          className="-my-1.5 -ml-3 flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-3 text-left"
        >
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-attenue-texte transition-transform duration-100',
              replie && '-rotate-90',
            )}
          />
          <CarteTitre className="flex min-w-0 items-center gap-1.5">
            {Icone && <Icone className="size-3.5 shrink-0" />}
            <span className="truncate">{titre}</span>
          </CarteTitre>
          {replie && resume && (
            <span className="ml-2 truncate text-[11px] font-normal text-attenue-texte">
              {resume}
            </span>
          )}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CarteEntete>

      {/* Demonte plutot que masque : un formulaire replie ne doit pas continuer
          a recevoir le focus au clavier. */}
      {!replie && (
        <CarteCorps id={idCorps} className={classeCorps}>
          {children}
        </CarteCorps>
      )}
    </Carte>
  )
}

/* -------------------------------------------------------------------------- */
/* Repli sur une carte existante                                               */
/* -------------------------------------------------------------------------- */

/**
 * Rend une carte deja ecrite repliable, sans la restructurer.
 *
 * `CarteRepliable` impose sa forme d'en-tete ; beaucoup de cartes en ont deja
 * une, riche, avec des aides et des boutons. Ce crochet leur ajoute le repli en
 * trois gestes : poser `<Chevron />` en tete du titre, et envelopper le corps
 * dans `{!replie && ...}`.
 *
 * Meme memoire que `CarteRepliable` : meme cle de stockage, meme comportement.
 */
export function useRepli(id: string, replieParDefaut = false) {
  const [replie, setReplie] = useState<boolean>(() => lire()[id] ?? replieParDefaut)

  const basculer = useCallback(() => {
    setReplie((r) => {
      const suivant = !r
      try {
        localStorage.setItem(CLE, JSON.stringify({ ...lire(), [id]: suivant }))
      } catch {
        /* sans memoire, le repli fonctionne quand meme */
      }
      return suivant
    })
  }, [id])

  const Chevron = useCallback(
    () => (
      <button
        type="button"
        onClick={basculer}
        aria-expanded={!replie}
        aria-label={replie ? 'Deplier' : 'Replier'}
        className="-ml-1 grid size-5 shrink-0 place-items-center rounded-[3px]
                   text-attenue-texte hover:bg-surface hover:text-texte"
      >
        <ChevronDown
          className={cn('size-3.5 transition-transform duration-100', replie && '-rotate-90')}
        />
      </button>
    ),
    [basculer, replie],
  )

  return { replie, basculer, Chevron }
}

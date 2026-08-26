/**
 * Command Center — fil d'Ariane, recherche globale, alertes et compte.
 *
 * Quarante-huit pixels, trois zones. Le fil d'Ariane porte le contexte a
 * gauche, la recherche occupe le centre, les alertes et le compte tiennent la
 * droite.
 *
 * Le segment « module » du fil est un **menu deroulant** listant les ecrans de
 * ce module. Sans lui, un fil d'Ariane seul ne dit que ou l'on est, jamais ou
 * l'on peut aller : il faudrait passer par le rail puis par la palette pour
 * changer d'ecran a l'interieur d'un module. Le deroulant rend le geste unique,
 * sans ajouter une seconde barre.
 */
import { ChevronRight, LogOut, Search, Settings, UserRound } from 'lucide-react'
import {
  Infobulle,
  Menu,
  MenuContenu,
  MenuDeclencheur,
  MenuElement,
  MenuSeparateur,
  MenuTitre,
} from '../ui/surcouches'
import { MODULES, type EntreeNav, type Section } from '../Coquille'
import { cn } from '../../lib/utils'
import { decrire } from './etat'

export function FilAriane({
  section,
  ecrans,
  cheminActif,
  ouvrir,
  ouvrirRecherche,
  anomalies,
  bloquantes,
  ouvrirControles,
  login,
  role,
  deconnecter,
}: {
  section: Section
  /** Ecrans du module, deja filtres par les droits de l'utilisateur. */
  ecrans: EntreeNav[]
  cheminActif: string | null
  ouvrir: (chemin: string, apercu: boolean) => void
  ouvrirRecherche: () => void
  anomalies: number
  /** Anomalies bloquantes ou critiques : elles seules teintent la cloche en rouge. */
  bloquantes: number
  ouvrirControles: () => void
  login: string
  role: string
  deconnecter: () => void
}) {
  const module = MODULES.find((m) => m.id === section)
  const ecranCourant = cheminActif ? decrire(cheminActif) : null

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b border-bordure
                 bg-[hsl(var(--at-lateral))] pl-3 pr-2"
    >
      {/* --- Fil d'Ariane ------------------------------------------------ */}
      <nav aria-label="Fil d'Ariane" className="flex min-w-0 shrink-0 items-center gap-1">
        <Menu>
          <MenuDeclencheur asChild>
            <button
              className="flex items-center gap-1 rounded-[3px] px-2 py-1 text-[13px] font-semibold
                         text-texte hover:bg-[hsl(var(--at-liste-survol))]
                         data-[state=open]:bg-[hsl(var(--at-liste-survol))]"
            >
              {module?.Icone && <module.Icone className="size-4 opacity-80" strokeWidth={1.7} />}
              {module?.libelle}
            </button>
          </MenuDeclencheur>
          <MenuContenu align="start" className="w-72">
            <MenuTitre>{module?.resume}</MenuTitre>
            <MenuSeparateur />
            {ecrans.map((e) => (
              <MenuElement
                key={e.vers}
                disabled={Boolean(e.aVenir)}
                onSelect={() => !e.aVenir && ouvrir(e.vers, false)}
              >
                <e.Icone className="size-4" />
                <span className="flex-1 truncate">{e.libelle}</span>
                {e.aVenir && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-attenue-texte">
                    a venir
                  </span>
                )}
              </MenuElement>
            ))}
          </MenuContenu>
        </Menu>

        {ecranCourant && (
          <>
            <ChevronRight className="size-3.5 shrink-0 text-attenue-texte" />
            <span className="truncate text-[13px] text-attenue-texte">{ecranCourant.titre}</span>
          </>
        )}
      </nav>

      {/* --- Recherche globale, au centre -------------------------------- */}
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={ouvrirRecherche}
          className="flex h-7 w-full max-w-md items-center gap-2 rounded-[4px] border border-bordure
                     bg-[hsl(var(--at-editeur))] px-2.5 text-[12px] text-attenue-texte
                     transition-colors hover:border-champ hover:text-texte"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Rechercher une reference, un bon, un fournisseur</span>
          <kbd className="shrink-0 rounded-[3px] border border-bordure px-1 font-mono text-[10px]">
            Ctrl+P
          </kbd>
        </button>
      </div>

      {/* --- Alertes et compte -------------------------------------------- */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Infobulle
          contenu={
            anomalies === 0
              ? 'Aucune anomalie de coherence'
              : `${anomalies} controle${anomalies > 1 ? 's' : ''} en anomalie${
                  bloquantes > 0 ? `, dont ${bloquantes} bloquant${bloquantes > 1 ? 's' : ''}` : ''
                }`
          }
        >
          <button
            type="button"
            aria-label="Controles de coherence"
            onClick={ouvrirControles}
            className="relative grid size-8 place-items-center rounded-[3px] text-attenue-texte
                       hover:bg-[hsl(var(--at-liste-survol))] hover:text-texte"
          >
            <Cloche />
            {anomalies > 0 && (
              <span
                className={cn(
                  'absolute right-1 top-1 grid min-w-3.5 place-items-center rounded-full px-0.5',
                  'text-[8px] font-semibold leading-3.5 text-white',
                  // Le rouge est reserve au bloquant : une cloche rouge en
                  // permanence cesse d'etre vue au bout d'une journee.
                  bloquantes > 0 ? 'bg-danger' : 'bg-alerte',
                )}
              >
                {anomalies > 9 ? '9+' : anomalies}
              </span>
            )}
          </button>
        </Infobulle>

        <Menu>
          <MenuDeclencheur asChild>
            <button
              aria-label="Compte"
              className="flex items-center gap-1.5 rounded-[3px] px-1.5 py-1
                         hover:bg-[hsl(var(--at-liste-survol))]"
            >
              <UserRound className="size-4 text-attenue-texte" strokeWidth={1.7} />
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-[11.5px] text-texte">{login}</span>
                <span className="block text-[9.5px] text-attenue-texte">{role}</span>
              </span>
            </button>
          </MenuDeclencheur>
          <MenuContenu align="end" className="w-56">
            <MenuTitre>
              {login} — {role}
            </MenuTitre>
            <MenuSeparateur />
            <MenuElement onSelect={() => ouvrir('/parametres', false)}>
              <Settings className="size-4" />
              Parametres systeme
            </MenuElement>
            <MenuSeparateur />
            <MenuElement destructif onSelect={deconnecter}>
              <LogOut className="size-4" />
              Se deconnecter
            </MenuElement>
          </MenuContenu>
        </Menu>
      </div>
    </header>
  )
}

/** Cloche dessinee a la main : celle de la bibliotheque est trop epaisse a 16 px. */
function Cloche() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
      <path
        d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

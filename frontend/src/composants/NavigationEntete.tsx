/**
 * La navigation en barre du haut, pour les dispositions qui la demandent.
 *
 * ELLE COUTE DEUX CLICS PAR ECRAN — un pour ouvrir le menu du module, un pour
 * choisir. C'est le prix de la largeur qu'elle rend : sur un ecran de portable
 * ou la hauteur manque, il vaut souvent la peine.
 *
 * En disposition MIXTE, elle ne porte que les modules ; les ecrans du module
 * courant restent dans la barre laterale. Un seul clic suffit alors, au prix de
 * deux barres.
 */
import { NavLink } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useApparence } from './Apparence'
import { MODULES, type EntreeNav } from './Coquille'
import { Menu, MenuContenu, MenuDeclencheur, MenuElement, MenuTitre } from './ui/surcouches'
import { Badge } from './ui/base'
import { cn } from '../lib/utils'

export function NavigationEntete({
  accessibles,
  courante,
}: {
  accessibles: EntreeNav[]
  courante: EntreeNav | undefined
}) {
  const { disposition } = useApparence()
  const modules = MODULES.filter((m) => accessibles.some((e) => e.section === m.id))

  const lien = (actif: boolean) =>
    cn(
      'flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 py-1.5',
      'text-[13px] transition-colors',
      actif
        ? 'bg-attenue font-medium text-texte'
        : 'text-attenue-texte hover:bg-attenue hover:text-texte',
    )

  return (
    <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
      {modules.map((m) => {
        const ecrans = accessibles.filter((e) => e.section === m.id)
        const actif = ecrans.some((e) => e.vers === courante?.vers)

        /* En disposition MIXTE, cliquer un module ouvre son PREMIER ecran et
           laisse la barre laterale montrer les autres : le menu deroulant
           ferait doublon avec elle. */
        if (disposition === 'mixte') {
          const premier = ecrans.find((e) => !e.aVenir) ?? ecrans[0]
          if (!premier) return null
          return (
            <NavLink key={m.id} to={premier.vers} className={lien(actif)}>
              <m.Icone className="size-3.5" />
              {m.libelle}
            </NavLink>
          )
        }

        return (
          <Menu key={m.id}>
            <MenuDeclencheur asChild>
              <button className={lien(actif)}>
                <m.Icone className="size-3.5" />
                {m.libelle}
                <ChevronDown className="size-3 opacity-60" />
              </button>
            </MenuDeclencheur>
            <MenuContenu align="start" className="w-60">
              <MenuTitre>{m.resume}</MenuTitre>
              {ecrans.map((e) => (
                <MenuElement key={e.vers} asChild disabled={Boolean(e.aVenir)}>
                  {e.aVenir ? (
                    <span className="cursor-not-allowed opacity-50" title={e.aVenir}>
                      <e.Icone />
                      {e.libelle}
                      <Badge ton="contour" className="ml-auto text-[9px]">
                        a venir
                      </Badge>
                    </span>
                  ) : (
                    <NavLink to={e.vers} end={e.vers === '/'}>
                      <e.Icone />
                      {e.libelle}
                      {e.vers === courante?.vers && (
                        <Badge ton="contour" className="ml-auto">
                          ici
                        </Badge>
                      )}
                    </NavLink>
                  )}
                </MenuElement>
              ))}
            </MenuContenu>
          </Menu>
        )
      })}
    </nav>
  )
}

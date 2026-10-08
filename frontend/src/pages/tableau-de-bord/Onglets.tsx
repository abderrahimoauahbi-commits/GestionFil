/**
 * Les pages du tableau de bord, en onglets (06/10/2026).
 *
 * UN TABLEAU DE BORD N'EST PAS UNE PAGE QU'ON FAIT DEFILER. Les logiciels de
 * reference (Fiori, Dynamics, Odoo) ouvrent sur une VUE D'ENSEMBLE — les
 * chiffres qui comptent, leur tendance, ce qui attend — et renvoient le detail
 * a des pages par domaine. Chaque page a son adresse : on la met en signet, on
 * la retrouve au meme endroit.
 */
import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'

const PAGES = [
  { vers: '/tableau-de-bord', libelle: "Vue d'ensemble" },
  { vers: '/tableau-de-bord/situation', libelle: 'Risques et files' },
  { vers: '/tableau-de-bord/analyse', libelle: 'Analyse' },
  { vers: '/tableau-de-bord/opportunites', libelle: 'Opportunités' },
  { vers: '/tableau-de-bord/matiere', libelle: 'Matière' },
]

/* L'onglet actif porte `aria-current="page"` (pose par NavLink) : c'est
   l'accroche que les chartes habillent, comme `data-state` des onglets Radix. */
export function OngletsTableauDeBord({ className }: { className?: string }) {
  return (
    <nav aria-label="Pages du tableau de bord" className={cn('onglets-liste defilement-x mb-4 flex items-end gap-5 border-b border-bordure', className)}>
      {PAGES.map((p) => (
        <NavLink
          key={p.vers}
          to={p.vers}
          end
          className={({ isActive }) =>
            cn(
              'onglet relative -mb-px inline-flex h-10 items-center whitespace-nowrap border-b-2 px-0.5 text-[13px] font-medium transition-colors',
              isActive ? 'border-primaire text-texte' : 'border-transparent text-attenue-texte hover:text-texte',
            )
          }
        >
          {p.libelle}
        </NavLink>
      ))}
    </nav>
  )
}

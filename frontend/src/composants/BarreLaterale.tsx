/**
 * La navigation en barre laterale, repliable et figeable.
 *
 * POURQUOI LATERALE ET NON EN HAUT. Sept modules et vingt-neuf ecrans ne
 * tiennent pas sur une ligne : la barre du haut les repliait en menus
 * deroulants, et il fallait deux clics et une memoire du rangement pour
 * atteindre un ecran. En colonne, tout est visible d'un coup — c'est la seule
 * disposition qui tienne quand le nombre d'ecrans grandit.
 *
 * REPLIEE PAR DEFAUT, OUVERTE AU SURVOL. Repliee elle occupe 56 px et ne montre
 * que les icones des modules ; le pointeur la fait glisser a 248 px avec les
 * libelles. Elle se DEPLOIE AU-DESSUS du contenu au lieu de le pousser : une
 * table de quinze colonnes ne doit pas se reorganiser parce qu'on longe le bord
 * de l'ecran.
 *
 * LE BOUTON DE FIGEAGE la garde ouverte. Sur un grand ecran on prefere souvent
 * la voir en permanence ; elle pousse alors le contenu, puisque la place existe.
 * Le choix depend de la largeur disponible, pas d'un gout — d'ou un reglage
 * plutot qu'une decision prise a la place de l'utilisateur.
 */
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, Pin, PinOff } from 'lucide-react'
import { useApparence } from './Apparence'
import { estAccessible, MODULES, NAVIGATION, type EntreeNav, type Section } from './Coquille'
import { useAuth } from '../auth/AuthContext'
import { cn } from '../lib/utils'

export function BarreLaterale() {
  const { moi, peut } = useAuth()
  const { menuFige, disposition, definir } = useApparence()
  const emplacement = useLocation()
  const [survol, setSurvol] = useState(false)
  /** Module deplie quand la barre est repliee et qu'on clique son icone. */
  const [ouvert, setOuvert] = useState<Section | null>(null)

  const ouverte = menuFige || survol
  const accessibles = NAVIGATION.filter((e) => estAccessible(e, peut, moi?.role))

  const courante = accessibles.find(
    (e) =>
      e.vers === emplacement.pathname ||
      (e.vers !== '/' && emplacement.pathname.startsWith(e.vers.split('?')[0])),
  )

  const tous = MODULES.filter((m) => accessibles.some((e) => e.section === m.id))
  // Les reglages descendent en pied : on n'y va pas dans le fil du travail,
  // mais quand quelque chose doit changer. Les melanger aux modules metier les
  // met au meme rang que le plan d'achat, ce qu'ils ne sont pas.
  const modules = tous.filter(
    (m) =>
      m.id !== 'PARAMETRES' &&
      // En disposition mixte, l'entete porte deja les modules : la barre ne
      // garde que celui ou l'on se trouve, deplie sur ses ecrans.
      (disposition !== 'mixte' || m.id === courante?.section),
  )
  const reglages = tous.filter((m) => m.id === 'PARAMETRES')

  /** Un ecran de la liste, avec son etat courant et son eventuel « a venir ». */
  const lien = (e: EntreeNav) => {
    const actif = e.vers === courante?.vers
    const contenu = (
      <>
        <e.Icone className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{e.libelle}</span>
        {e.aVenir && (
          <span className="shrink-0 rounded-[3px] border border-bordure px-1 text-[9px] text-attenue-texte">
            a venir
          </span>
        )}
      </>
    )
    const classe = cn(
      'flex items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pl-8 pr-2 text-[12.5px]',
      'transition-colors',
      actif
        ? 'bg-primaire/12 font-medium text-primaire'
        : e.aVenir
          ? 'cursor-not-allowed text-attenue-texte/60'
          : 'text-attenue-texte hover:bg-attenue hover:text-texte',
    )
    if (e.aVenir) {
      return (
        <span key={e.vers} className={classe} title={e.aVenir} aria-disabled>
          {contenu}
        </span>
      )
    }
    return (
      <NavLink key={e.vers} to={e.vers} end={e.vers === '/'} className={classe}>
        {contenu}
      </NavLink>
    )
  }

  return (
    <>
      {/* La gouttiere : elle reserve la place de la barre REPLIEE, ou de la
          barre entiere quand elle est figee. Sans elle, le contenu passerait
          sous la barre au lieu de commencer apres. */}
      <div
        className={cn(
          'sans-impression hidden shrink-0 transition-[width] duration-150 ease-out md:block',
          menuFige ? 'w-[248px]' : 'w-[56px]',
        )}
      />

      <aside
        onMouseEnter={() => setSurvol(true)}
        onMouseLeave={() => {
          setSurvol(false)
          setOuvert(null)
        }}
        className={cn(
          'sans-impression fixed bottom-0 left-0 top-0 z-40 hidden flex-col border-r border-bordure',
          'bg-surface transition-[width] duration-150 ease-out md:flex',
          ouverte ? 'w-[248px] shadow-xl' : 'w-[56px]',
        )}
      >
        {/* --- Marque et figeage ------------------------------------------ */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-bordure px-3">
          <div className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-primaire text-[12px] font-bold text-primaire-texte">
            GF
          </div>
          {ouverte && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                Gestion Fil
              </span>
              <button
                type="button"
                onClick={() => definir({ menuFige: !menuFige })}
                title={menuFige ? 'Laisser le menu se replier' : 'Garder le menu ouvert'}
                aria-pressed={menuFige}
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-[3px] transition-colors',
                  menuFige
                    ? 'bg-primaire/12 text-primaire'
                    : 'text-attenue-texte hover:bg-attenue hover:text-texte',
                )}
              >
                {menuFige ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
              </button>
            </>
          )}
        </div>

        {/* --- Les modules ------------------------------------------------- */}
        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
          {modules.map((m) => {
            const ecrans = accessibles.filter((e) => e.section === m.id)
            const contientCourant = ecrans.some((e) => e.vers === courante?.vers)
            const deplie = ouverte && (contientCourant || ouvert === m.id)

            return (
              <div key={m.id} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => setOuvert(ouvert === m.id ? null : m.id)}
                  title={ouverte ? undefined : `${m.libelle} — ${m.resume}`}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left',
                    'text-[12.5px] transition-colors',
                    contientCourant
                      ? 'font-medium text-texte'
                      : 'text-attenue-texte hover:bg-attenue hover:text-texte',
                  )}
                >
                  <m.Icone className="size-4 shrink-0" strokeWidth={contientCourant ? 2.2 : 1.7} />
                  {ouverte && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{m.libelle}</span>
                      <ChevronRight
                        className={cn(
                          'size-3.5 shrink-0 transition-transform duration-150',
                          deplie && 'rotate-90',
                        )}
                      />
                    </>
                  )}
                  {/* Barre de presence quand la barre est repliee : c'est le
                      seul indice de la section courante a 56 px. */}
                  {!ouverte && contientCourant && (
                    <span className="absolute left-0 h-6 w-[3px] rounded-r bg-primaire" />
                  )}
                </button>

                {deplie && <div className="mt-0.5 space-y-0.5">{ecrans.map(lien)}</div>}
              </div>
            )
          })}
        </nav>

        {/* --- Pied : reglages et identite --------------------------------- */}
        <div className="shrink-0 border-t border-bordure p-2">
          {reglages.map((m) => {
            const ecrans = accessibles.filter((e) => e.section === m.id)
            const contientCourant = ecrans.some((e) => e.vers === courante?.vers)
            return ecrans.map((e) => (
              <NavLink
                key={e.vers}
                to={e.vers}
                title={ouverte ? undefined : m.libelle}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-[12.5px]',
                  'transition-colors',
                  contientCourant
                    ? 'bg-primaire/12 font-medium text-primaire'
                    : 'text-attenue-texte hover:bg-attenue hover:text-texte',
                )}
              >
                <m.Icone className="size-4 shrink-0" strokeWidth={contientCourant ? 2.2 : 1.7} />
                {ouverte && <span className="min-w-0 flex-1 truncate">{e.libelle}</span>}
              </NavLink>
            ))
          })}
          {ouverte && (
            <div className="px-2 pt-2 text-[10px] text-attenue-texte">
              {moi?.login} · {moi?.role}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

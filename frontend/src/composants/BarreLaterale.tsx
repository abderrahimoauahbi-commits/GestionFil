/**
 * La navigation en colonne, toujours ouverte.
 *
 * TOUT EST VISIBLE D'UN COUP. Sept modules et une trentaine d'ecrans : chaque
 * module est un intertitre, ses ecrans sont listes dessous, sans accordeon ni
 * survol. On ne cherche pas un ecran dans un menu replie, on le lit.
 *
 * JAMAIS REPLIEE (preference du 05/10/2026) : une barre qui se replie cache le
 * chemin, et une barre qui se deploie au survol passe sur le tableau qu'on lit.
 *
 * SOMBRE A COTE D'UNE ZONE DE TRAVAIL CLAIRE : le chrome recule, le contenu
 * avance, et la frontiere se voit sans chercher le filet.
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useOuvrirVue } from '../lib/navigation'
import { useApparence } from './Apparence'
import { entreeCourante, estAccessible, MODULES, NAVIGATION, type EntreeNav } from './Coquille'
import { useAuth } from '../auth/AuthContext'
import { useOngletsFacultatif } from './atelier/etat'
import { MarqueCarree } from './Marque'
import { cn, sousChemin } from '../lib/utils'

/**
 * Un lien de navigation qui sait ou il vit.
 *
 * DANS LE NAVIGATEUR il remplace la page ; DANS L'APPLICATION DE BUREAU il
 * ouvre un onglet. C'etait la raison pour laquelle le bureau avait sa propre
 * barre laterale : un `NavLink` y aurait remplace l'onglet courant au lieu d'en
 * ouvrir un, ce qui aurait supprime le multifenetrage a chaque clic.
 *
 * `useOuvrirVue` connait la difference. Le meme composant sert donc les deux
 * coquilles, et une entree ajoutee a la navigation apparait des deux cotes sans
 * qu'on y pense.
 */
function LienVue({
  vers,
  className,
  title,
  children,
}: {
  vers: string
  className: string | ((e: { isActive: boolean }) => string)
  title?: string
  children: React.ReactNode
}) {
  const ouvrir = useOuvrirVue()
  const emplacement = useLocation()
  const onglets = useOngletsFacultatif()

  if (!onglets) {
    return (
      <NavLink to={vers} end={vers === '/'} title={title} className={className}>
        {children}
      </NavLink>
    )
  }

  const actif = vers === '/' ? onglets.actif === '/' : sousChemin(onglets.actif ?? emplacement.pathname, vers)
  return (
    <button
      type="button"
      title={title}
      onClick={() => ouvrir(vers)}
      className={typeof className === 'function' ? className({ isActive: actif }) : className}
    >
      {children}
    </button>
  )
}

export function BarreLaterale() {
  const { moi, peut } = useAuth()
  const { disposition, menuMasque } = useApparence()
  const emplacement = useLocation()
  /* La coquille de bureau change deux choses : la barre y est dans le flux, et
     ses liens ouvrent des onglets. Elle se reconnait a la presence du contexte
     d'onglets. */
  const dansAtelier = !!useOngletsFacultatif()

  const accessibles = NAVIGATION.filter((e) => estAccessible(e, peut, moi?.role))

  const courante = entreeCourante(accessibles, emplacement.pathname)

  const tous = MODULES.filter((m) => accessibles.some((e) => e.section === m.id))
  // Les reglages descendent en pied : on n'y va pas dans le fil du travail.
  const modules = tous.filter(
    (m) =>
      m.id !== 'PARAMETRES' &&
      // En disposition mixte, l'entete porte deja les modules : la barre ne
      // garde que celui ou l'on se trouve.
      (disposition !== 'mixte' || m.id === courante?.section),
  )
  const reglages = accessibles.filter((e) => e.section === 'PARAMETRES')

  /** Un ecran de la liste : un trait cobalt a gauche marque celui ou l'on est. */
  const lien = (e: EntreeNav) => {
    const actif = e.vers === courante?.vers
    const contenu = (
      <>
        <e.Icone
          className={cn('size-[15px] shrink-0', actif ? 'text-primaire' : 'opacity-70')}
          strokeWidth={actif ? 2.1 : 1.7}
        />
        <span className="min-w-0 flex-1 truncate">{e.libelle}</span>
        {e.aVenir && (
          <span className="shrink-0 rounded-full border border-barre-attenue/35 px-1.5 text-[9px] uppercase tracking-wide text-barre-attenue">
            bientôt
          </span>
        )}
      </>
    )
    const classe = cn(
      'lien-nav relative flex h-[30px] w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left text-[12.5px]',
      'transition-colors duration-100',
      actif
        ? 'actif bg-barre-actif font-medium text-barre-texte before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-primaire'
        : e.aVenir
          ? 'cursor-not-allowed text-barre-attenue/45'
          : 'text-barre-attenue hover:bg-barre-actif/70 hover:text-barre-texte',
    )
    if (e.aVenir) {
      return (
        <span key={e.vers + e.libelle} className={classe} title={e.aVenir} aria-disabled>
          {contenu}
        </span>
      )
    }
    return (
      <LienVue key={e.vers + e.libelle} vers={e.vers} title={e.resume} className={classe}>
        {contenu}
      </LienVue>
    )
  }

  return (
    <>
      {/* La gouttiere reserve la place de la barre, posee en `fixed` dans le
          navigateur. Dans l'atelier la barre est dans le flux : pas de
          gouttiere, elle la doublerait. */}
      <div
        className={cn(
          'sans-impression hidden shrink-0 transition-[width] duration-300 ease-out md:block',
          menuMasque ? 'w-0' : 'w-[232px]',
          dansAtelier && 'md:hidden',
        )}
      />

      <aside
        className={cn(
          'barre-laterale sans-impression hidden w-[232px] flex-col border-r border-black/20 bg-barre text-barre-texte md:flex',
          // Fixe aux bords de la fenetre dans le navigateur ; dans le flux au
          // bureau, ou la fenetre a aussi une barre de titre et une barre d'etat
          // que la barre laterale ne doit pas recouvrir.
          dansAtelier ? 'relative shrink-0' : 'fixed bottom-0 left-0 top-0 z-40',
          // LA BARRE GLISSE (06/10/2026) : le bouton de la barre du haut la
          // fait sortir de l'ecran et revenir ; le contenu reprend la place.
          'transition-[transform,margin] duration-300 ease-out',
          menuMasque && (dansAtelier ? '-ml-[232px]' : '-translate-x-full'),
        )}
        aria-hidden={menuMasque || undefined}
        inert={menuMasque || undefined}
      >
        {/* --- Marque ------------------------------------------------------ */}
        <NavLink
          to="/"
          end
          className="marque-nav flex h-14 shrink-0 items-center gap-2.5 px-4 transition-opacity hover:opacity-90"
        >
          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-white/95 ring-1 ring-white/10">
            <MarqueCarree className="size-7 object-contain" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em]">Gestion Fil</span>
            <span className="block truncate text-[10.5px] text-barre-attenue">Polyfashions Carpet</span>
          </span>
        </NavLink>

        {/* --- Les modules, tous ouverts ----------------------------------- */}
        <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2 [scrollbar-width:thin]">
          {modules.map((m, i) => {
            const ecrans = accessibles.filter((e) => e.section === m.id)
            return (
              /* UN FILET ENTRE LES GROUPES (12/10/2026) : le titre dit le
                 groupe, le filet dit ou il s'arrete. */
              <section
                key={m.id}
                aria-label={m.libelle}
                className={cn(i > 0 && 'border-t border-white/[0.06] pt-3')}
              >
                <h2
                  title={m.resume}
                  className="titre-nav mb-1 flex items-center gap-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-barre-attenue/80"
                >
                  {m.libelle}
                </h2>
                <div className="space-y-px">{ecrans.map(lien)}</div>
              </section>
            )
          })}
        </nav>

        {/* --- Pied : les reglages -----------------------------------------
            L'identite et la deconnexion sont dans la barre du haut : les
            repeter ici mettait deux fois le meme nom sur l'ecran. */}
        {reglages.length > 0 && (
          <div className="shrink-0 space-y-px border-t border-white/[0.06] px-3 py-2.5">
            {reglages.map(lien)}
          </div>
        )}
      </aside>
    </>
  )
}

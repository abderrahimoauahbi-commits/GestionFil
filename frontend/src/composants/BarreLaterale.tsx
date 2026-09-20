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
import { useOuvrirVue } from '../lib/navigation'
import { ChevronRight, Pin, PinOff } from 'lucide-react'
import { useApparence } from './Apparence'
import { estAccessible, MODULES, NAVIGATION, type EntreeNav, type Section } from './Coquille'
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
  const { menuFige, disposition, definir } = useApparence()
  const emplacement = useLocation()
  const [survol, setSurvol] = useState(false)
  /** Module deplie quand la barre est repliee et qu'on clique son icone. */
  const [ouvert, setOuvert] = useState<Section | null>(null)

  const ouverte = menuFige || survol
  /* La coquille de bureau change deux choses : la barre y est dans le flux, et
     ses liens ouvrent des onglets. Elle se reconnait a la presence du contexte
     d'onglets. */
  const dansAtelier = !!useOngletsFacultatif()

  const accessibles = NAVIGATION.filter((e) => estAccessible(e, peut, moi?.role))

  const courante = accessibles.find(
    (e) =>
      e.vers === emplacement.pathname ||
      (e.vers !== '/' && sousChemin(emplacement.pathname, e.vers.split('?')[0])),
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
  /** Cette entree est-elle la rubrique d'un sous-menu ? */
  const aDesSous = (e: EntreeNav) => {
    const i = NAVIGATION.indexOf(e)
    return i >= 0 && !!NAVIGATION[i + 1]?.sous
  }

  const lien = (e: EntreeNav) => {
    /* L'ENTREE ACTIVE SE RECONNAIT PAR SON CHEMIN EXACT — sauf le parent d'un
       sous-menu, qui partage son chemin avec sa premiere page et s'allumerait
       deux fois. Le parent reste donc eteint des qu'une de ses pages est
       ouverte : c'est la page qui se designe, pas la rubrique. */
    const actif = e.vers === courante?.vers && (!!e.sous || !aDesSous(e))
    const contenu = (
      <>
        <e.Icone className={cn('shrink-0', e.sous ? 'size-3' : 'size-3.5')} />
        <span className="min-w-0 flex-1 truncate">{e.libelle}</span>
        {e.aVenir && (
          <span className="shrink-0 rounded-[3px] border border-barre-attenue/40 px-1 text-[9px] text-barre-attenue">
            a venir
          </span>
        )}
      </>
    )
    const classe = cn(
      'flex items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pr-2 transition-colors',
      // UN CRAN DE PLUS, ET UN PEU PLUS DISCRET : le decalage seul suffit a
      // dire « ceci est une page de la rubrique du dessus ».
      e.sous ? 'pl-[2.875rem] text-[12px]' : 'pl-8 text-[12.5px]',
      actif
        ? 'bg-barre-actif font-medium text-or'
        : e.aVenir
          ? 'cursor-not-allowed text-barre-attenue/50'
          : 'text-barre-attenue hover:bg-barre-actif hover:text-barre-texte',
    )
    if (e.aVenir) {
      return (
        <span key={e.vers + e.libelle} className={classe} title={e.aVenir} aria-disabled>
          {contenu}
        </span>
      )
    }
    return (
      <LienVue key={e.vers + e.libelle} vers={e.vers} className={classe}>
        {contenu}
      </LienVue>
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
          // Dans l'atelier la barre est dans le flux : elle occupe deja sa
          // place, une gouttiere de plus la doublerait.
          dansAtelier && 'hidden',
        )}
      />

      <aside
        onMouseEnter={() => setSurvol(true)}
        onMouseLeave={() => {
          setSurvol(false)
          setOuvert(null)
        }}
        className={cn(
          'sans-impression hidden flex-col border-r border-barre/40',
          // LA COLONNE DE NAVIGATION EST SOMBRE, LA ZONE DE TRAVAIL EST CLAIRE.
          //
          // Elle etait blanche comme le contenu : rien ne separait « ou je
          // suis » de « ce que je regarde », et le regard devait chercher le
          // filet de separation pour savoir ou finissait le menu.
          //
          // C'est la disposition des consoles d'administration serieuses —
          // Gentelella, Fiori, la plupart des ERP — et elle ne tient pas a la
          // mode : le chrome sombre recule, le contenu clair avance, et la
          // hierarchie se lit sans y penser. Les jetons `--barre` existaient
          // deja pour cela et ne servaient nulle part.
          'bg-barre text-barre-texte transition-[width] duration-150 ease-out md:flex',
          // POSEE DANS LE FLUX SUR LE BUREAU, EN SURIMPRESSION SUR LE WEB.
          //
          // `fixed` la colle aux quatre bords de la fenetre. Dans un
          // navigateur c'est ce qu'on veut : elle passe par-dessus le contenu
          // quand elle s'ouvre au survol, sans le decaler. Dans l'application
          // de bureau, la fenetre porte AUSSI une barre de titre en haut et une
          // barre d'etat en bas : la barre laterale les recouvrait, mangeant le
          // menu Fichier et le nom du compte. Vu a la capture.
          //
          // Le bureau la met donc dans le flux — sa zone de travail est deja
          // une rangee flex, la barre y prend simplement sa colonne.
          dansAtelier
            ? 'relative shrink-0'
            : 'fixed bottom-0 left-0 top-0 z-40',
          ouverte ? 'w-[248px] shadow-xl' : 'w-[56px]',
          ouverte && dansAtelier && 'absolute bottom-0 left-0 top-0 z-40',
        )}
      >
        {/* --- Marque et figeage ------------------------------------------ */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-barre-attenue/20 px-3">
          {/* La marque porte le retour a l'accueil : l'entete ne l'affiche plus
              en disposition laterale, ce lien doit donc exister ici. */}
          {/* LA MARQUE DE L'ENTREPRISE, PAS DEUX LETTRES. Un carre « GF » ne
              dit rien a personne : le bloc de la carte de visite se reconnait
              a 28 px, parce que son texte est horizontal et gros. C'est la
              seule version du logo qui tienne a cette taille. */}
          <NavLink
            to="/"
            end
            title="Cockpit"
            className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)]"
          >
            <MarqueCarree className="size-7 object-contain" />
          </NavLink>
          {ouverte && (
            <>
              <NavLink to="/" end className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                Gestion Fil
              </NavLink>
              <button
                type="button"
                onClick={() => definir({ menuFige: !menuFige })}
                title={menuFige ? 'Laisser le menu se replier' : 'Garder le menu ouvert'}
                aria-pressed={menuFige}
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-[3px] transition-colors',
                  menuFige
                    ? 'bg-barre-actif text-or'
                    : 'text-barre-attenue hover:bg-barre-actif hover:text-barre-texte',
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
                      ? 'font-medium text-barre-texte'
                      : 'text-barre-attenue hover:bg-barre-actif hover:text-barre-texte',
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
        <div className="shrink-0 border-t border-barre-attenue/20 p-2">
          {/* CHAQUE ECRAN PORTE SON PROPRE NOM ET SA PROPRE ICONE.
              Ce pied affichait ceux du MODULE : deux ecrans de reglages s'y
              montraient donc avec la meme icone et la meme infobulle,
              impossibles a distinguer une fois la barre repliee. Et la
              coloration suivait la SECTION, donc les deux s'allumaient
              ensemble. Vu a la capture, le jour ou un second ecran est arrive. */}
          {reglages.map((m) => {
            const ecrans = accessibles.filter((e) => e.section === m.id)
            return ecrans.map((e) => {
              const courant = e.vers === courante?.vers
              return (
                <LienVue
                  key={e.vers}
                  vers={e.vers}
                  title={ouverte ? undefined : e.libelle}
                  className={cn(
                    'flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-[12.5px]',
                    'transition-colors',
                    courant
                      ? 'bg-barre-actif font-medium text-or'
                      : 'text-barre-attenue hover:bg-barre-actif hover:text-barre-texte',
                  )}
                >
                  <e.Icone className="size-4 shrink-0" strokeWidth={courant ? 2.2 : 1.7} />
                  {ouverte && <span className="min-w-0 flex-1 truncate">{e.libelle}</span>}
                </LienVue>
              )
            })
          })}
          {ouverte && (
            <div className="px-2 pt-2 text-[10px] text-barre-attenue">
              {moi?.login} · {moi?.role}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

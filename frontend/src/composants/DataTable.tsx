/**
 * Tableau de donnees.
 *
 * TanStack Table fournit le tri, la pagination et la visibilite des colonnes ;
 * la grille de droits decide, en amont, quelles colonnes ont le droit
 * d'exister. Une colonne dont le champ est MASQUE n'est pas montee du tout :
 * ni en-tete, ni cellule, ni entree dans le menu de visibilite. Le serveur ne
 * l'a d'ailleurs pas envoyee.
 *
 * Sous 768 px, le tableau cede la place a des cartes empilees. Les colonnes
 * marquees `secondaire` disparaissent en dessous de 1280 px : sur une tablette
 * de magasin, mieux vaut cinq colonnes lisibles que quinze illisibles.
 */
import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  Download,
  Printer,
  Filter,
  Inbox,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useDroits } from '../auth/AuthContext'
import { cn } from '../lib/utils'
import { exporterCsv } from '../lib/export'
import { TableauImprimable } from './Etat'
import { Badge, Bouton, Champ, Chargement, EtatVide, Selecteur, Squelette } from './ui/base'
import { Menu, MenuContenu, MenuDeclencheur, MenuElement, MenuTitre } from './ui/surcouches'
import {
  MenuContextuel,
  MenuContextuelContenu,
  MenuContextuelDeclencheur,
} from './ui/surcouches'

export interface ColonneDT<L> {
  /** Nom du champ, tel qu'il figure dans `champ_configurable`. */
  champ: string
  entete: string
  rendu?: (ligne: L) => React.ReactNode
  /** Valeur brute utilisee pour le tri et le filtrage, si differente de l'affichage. */
  valeurTri?: (ligne: L) => string | number | null
  numerique?: boolean
  /** Masquee sous 1280 px ; reste presente dans la vue en cartes. */
  secondaire?: boolean
  /**
   * PRIORITE D'AFFICHAGE quand la largeur manque : 1 reste jusqu'au bout,
   * 5 part en premier.
   *
   * POURQUOI CE N'EST PLUS UN OUI/NON. `secondaire` ne connaissait que deux
   * etats et un seul seuil, 1280 px : au-dessus tout s'affichait, en dessous
   * on perdait d'un coup toutes les colonnes marquees, quelle que soit la
   * largeur reelle. Sur un ecran de 1100 px, il restait de la place pour deux
   * d'entre elles ; sur un de 820, la table debordait quand meme.
   *
   * Avec une priorite, on retire une colonne A LA FOIS, la moins utile
   * d'abord, jusqu'a ce que le tableau tienne. Rien n'est perdu : ce qui sort
   * du tableau passe dans la ligne de detail, sous le bouton « + ».
   *
   * Sans valeur : 2 pour une colonne ordinaire, 4 si `secondaire` est mis —
   * de sorte que les ecrans deja ecrits gardent exactement leur hierarchie.
   */
  priorite?: 1 | 2 | 3 | 4 | 5
  largeur?: string
  triable?: boolean
  /**
   * Filtre propre a la colonne, affiche sous son en-tete.
   *   'texte' : contient
   *   'liste' : egalite, valeurs deduites des donnees
   */
  filtre?: 'texte' | 'liste'
}

/**
 * Delegation au serveur.
 *
 * Fournie, la table cesse de filtrer, trier et paginer elle-meme : elle affiche
 * la page recue et remonte les intentions. C'est indispensable des que la table
 * depasse quelques milliers de lignes — tout charger pour filtrer dans le
 * navigateur tient a 120 references et s'effondre a 20 000.
 */
export interface ModeServeur {
  /** Nombre de lignes correspondant au filtre, toutes pages confondues. */
  total: number
  page: number
  taille: number
  surPage: (page: number) => void
  surTaille: (taille: number) => void
  surRecherche: (motif: string) => void
  surTri: (champ: string | null, sens: 'asc' | 'desc') => void
}

interface Props<L> {
  module: string
  /** Absent : la table travaille en memoire, comme avant. */
  serveur?: ModeServeur
  colonnes: ColonneDT<L>[]
  lignes: L[] | undefined
  chargement?: boolean
  cle: (ligne: L) => string
  surClic?: (ligne: L) => void
  /** Colonne d'actions, toujours rendue en fin de ligne. */
  actions?: (ligne: L) => React.ReactNode
  /**
   * Menu au clic droit sur la ligne.
   *
   * Rend des `MenuContextuelElement`. Il DOUBLE des chemins qui existent
   * ailleurs, il n'en cree pas : un acheteur qui repere une rupture dans la
   * liste veut commander sans repasser par le menu, mais l'ecran de commande
   * reste atteignable normalement. Un menu contextuel est une raccourci, jamais
   * le seul acces a une action — il ne s'ouvre ni au clavier ni au doigt.
   */
  menuContextuel?: (ligne: L) => React.ReactNode
  titreCarte?: (ligne: L) => React.ReactNode
  recherche?: boolean
  placeholderRecherche?: string
  tailleParDefaut?: number
  /** Pied de pagination. A couper sur une table de saisie de quelques lignes. */
  pagination?: boolean
  videTitre?: string
  videDescription?: string
  videAction?: React.ReactNode
  /** Boutons additionnels, inseres dans la barre d'outils. */
  barreOutils?: React.ReactNode
  /** Hauteur maximale du corps ; l'en-tete reste fixe au defilement. */
  /** Hauteur du cadre de defilement du tableau. Voir le defaut plus bas. */
  hauteurMax?: string
  /**
   * Sujet du fichier exporte. Sa PRESENCE affiche le bouton d'export.
   *
   * L'export part des COLONNES VISIBLES, donc de celles que les droits
   * laissent passer : un magasinier exporte le meme tableau que celui qu'il
   * lit, sans les montants. Exporter les colonnes declarees plutot que les
   * colonnes visibles ferait sortir par un fichier ce que l'ecran masque.
   */
  exportable?: string
  /**
   * Titre de l'etat imprime. Sa PRESENCE affiche le bouton d'impression.
   *
   * L'impression ne quitte pas l'ecran : le tableau visible est rendu une
   * seconde fois, invisible a l'ecran et seul visible au papier. C'est ce qui
   * permet d'imprimer CE QU'ON REGARDE — filtres, tri et colonnes compris —
   * plutot qu'un etat separe qu'il faudrait re-parametrer.
   */
  imprimable?: string
}

export function DataTable<L extends Record<string, unknown>>({
  module,
  colonnes,
  lignes,
  chargement,
  cle,
  surClic,
  actions,
  menuContextuel,
  titreCarte,
  recherche = true,
  placeholderRecherche = 'Filtrer...',
  tailleParDefaut = 25,
  pagination: avecPagination = true,
  videTitre = 'Aucun resultat',
  videDescription,
  videAction,
  barreOutils,
  /* SANS HAUTEUR, L'EN-TETE DE COLONNES NE COLLE PAS — et c'etait le cas
     partout sauf sur les recettes, seul ecran a renseigner cette propriete.
     `position: sticky` se cale sur le premier ancetre qui defile ; le cadre
     porte `overflow-x: auto`, donc c'est LUI le referentiel, et tant qu'il n'a
     pas de hauteur il ne defile jamais verticalement : l'en-tete part avec la
     page. Mesure : sur un ecran de 500 px, il descendait a -434 px.

     On lui donne donc une hauteur par defaut. `dvh` et non `vh` : sur un
     telephone, `vh` ignore la barre d'adresse qui se replie, et le bas du
     tableau se retrouve sous le pouce. La reserve de 18 rem couvre l'en-tete de
     page fige, la barre d'outils, la pagination et la barre de navigation
     basse. */
  hauteurMax = 'calc(100dvh - 18rem)',
  exportable,
  imprimable,
  serveur,
}: Props<L>) {
  const droits = useDroits(module)
  const [tri, setTri] = React.useState<SortingState>([])
  const [visibilite, setVisibilite] = React.useState<VisibilityState>({})
  const [filtre, setFiltre] = React.useState('')
  const [filtresColonne, setFiltresColonne] = React.useState<ColumnFiltersState>([])
  const [filtresOuverts, setFiltresOuverts] = React.useState(false)

  const visibles = React.useMemo(
    () => droits.colonnesVisibles(colonnes),
    [colonnes, droits],
  )

  /* ------------------------------------------------------------------------
     TENIR DANS LA LARGEUR : ON RETIRE, ON NE COUPE PAS
     ------------------------------------------------------------------------
     Le tableau debordait et l'on faisait defiler de cote. C'est la pire des
     reponses a un ecran etroit : on perd la colonne de gauche des qu'on part
     a droite, donc on ne sait plus de quelle ligne on lit les chiffres.

     On mesure donc la largeur reellement disponible, on estime ce que chaque
     colonne demande, et l'on retire les moins prioritaires UNE A UNE jusqu'a
     ce que l'ensemble tienne. Ce qui sort n'est pas perdu : la ligne se
     deplie sur un « + » et montre les valeurs manquantes en liste.
     C'est le comportement de DataTables Responsive, et il est juste.
  */
  const [largeurDispo, setLargeurDispo] = React.useState(0)
  const observateur = React.useRef<ResizeObserver | null>(null)

  /* REFERENCE DE RAPPEL, ET NON `useRef` + `useLayoutEffect`.
     La premiere ecriture posait l'observateur dans un effet a dependances
     vides. Or le conteneur du tableau n'existe pas au premier rendu — tant que
     les lignes ne sont pas arrivees, c'est l'etat vide ou le squelette qui
     occupe la place. L'effet trouvait donc `null`, renoncait, et ne repassait
     jamais : la largeur restait a zero et aucune colonne n'etait retiree.
     Mesure a l'appui — conteneur de 823 px, quatorze colonnes, zero masquee.
     Une reference de rappel est appelee AU MOMENT ou le noeud arrive, ce qui
     supprime la question. */
  const conteneur = React.useCallback((el: HTMLDivElement | null) => {
    observateur.current?.disconnect()
    observateur.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver((entrees) => {
      const l = entrees[0]?.contentRect.width ?? 0
      // Arrondi a 16 px : sans cela, un pixel de variation au defilement
      // relance le calcul en boucle et fait clignoter les colonnes.
      setLargeurDispo(Math.round(l / 16) * 16)
    })
    obs.observe(el)
    observateur.current = obs
    setLargeurDispo(Math.round(el.getBoundingClientRect().width / 16) * 16)
  }, [])

  React.useEffect(() => () => observateur.current?.disconnect(), [])

  /** Ce qu'une colonne demande, en pixels, quand elle ne le dit pas. */
  const largeurDemandee = (c: ColonneDT<L>) => {
    if (c.largeur && c.largeur.endsWith('px')) return parseInt(c.largeur, 10) || 140
    if (c.largeur && c.largeur.endsWith('%')) return 140
    // Un nombre tient dans moins de place qu'un libelle : ce n'est pas une
    // preference, c'est la longueur des chaines.
    return c.numerique ? 110 : 160
  }

  const priorite = (c: ColonneDT<L>) => c.priorite ?? (c.secondaire ? 4 : 2)

  /** Les colonnes retirees faute de place, de la moins utile a la plus utile. */
  const retirees = React.useMemo(() => {
    if (!largeurDispo) return new Set<string>()
    // La colonne d'actions et le bouton de depliage prennent aussi leur part.
    const reserve = (actions ? 56 : 0) + 40
    let total = visibles.reduce((s, c) => s + largeurDemandee(c), reserve)
    if (total <= largeurDispo) return new Set<string>()

    // On sacrifie d'abord les priorites les plus hautes, et a priorite egale
    // la colonne la plus a droite — celle que l'oeil atteint en dernier.
    const candidats = visibles
      .map((c, i) => ({ c, i }))
      .sort((a, b) => priorite(b.c) - priorite(a.c) || b.i - a.i)

    const sortantes = new Set<string>()
    for (const { c } of candidats) {
      // LA PREMIERE COLONNE NE PART JAMAIS. Elle porte l'identite de la ligne ;
      // sans elle, la ligne depliee ne dit plus de quoi elle parle.
      if (c.champ === visibles[0]?.champ) continue
      if (total <= largeurDispo) break
      sortantes.add(c.champ)
      total -= largeurDemandee(c)
    }
    return sortantes
  }, [visibles, largeurDispo, actions])

  const [dépliees, setDépliees] = React.useState<Set<string>>(() => new Set())
  const basculerDepli = React.useCallback((id: string) => {
    setDépliees((d) => {
      const s = new Set(d)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }, [])

  const definitions = React.useMemo<ColumnDef<L>[]>(
    () =>
      visibles.map((c) => ({
        id: c.champ,
        accessorFn: (l) => (c.valeurTri ? c.valeurTri(l) : l[c.champ]),
        header: c.entete,
        enableSorting: c.triable !== false,
        // Egalite stricte pour une liste, « contient » pour un texte : filtrer
        // un statut sur « contient » ferait sortir CLOTURE pour la saisie « O ».
        filterFn: c.filtre === 'liste' ? 'equalsString' : 'includesString',
        cell: ({ row }) => (c.rendu ? c.rendu(row.original) : String(row.original[c.champ] ?? '—')),
        meta: { numerique: c.numerique, secondaire: c.secondaire, largeur: c.largeur },
      })),
    [visibles],
  )

  const table = useReactTable({
    data: lignes ?? [],
    columns: definitions,
    state: {
      sorting: tri,
      columnVisibility: visibilite,
      globalFilter: filtre,
      columnFilters: filtresColonne,
    },
    onSortingChange: setTri,
    onColumnVisibilityChange: setVisibilite,
    onGlobalFilterChange: setFiltre,
    onColumnFiltersChange: setFiltresColonne,
    getCoreRowModel: getCoreRowModel(),
    // En mode serveur, les modeles locaux sont retires : les garder ferait
    // filtrer une seconde fois la page deja filtree, et paginer une page.
    ...(serveur
      ? {
          manualSorting: true,
          manualFiltering: true,
          manualPagination: true,
          rowCount: serveur.total,
        }
      : {
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
        }),
    initialState: { pagination: { pageSize: tailleParDefaut } },
  })

  /* Remontee des intentions au parent. Le tri est traduit tel quel ; la
     recherche est laissee au parent, qui l'amortit avant d'appeler le serveur. */
  const premierRendu = React.useRef(true)
  React.useEffect(() => {
    if (!serveur) return
    if (premierRendu.current) {
      premierRendu.current = false
      return
    }
    const t = tri[0]
    serveur.surTri(t?.id ?? null, t?.desc ? 'desc' : 'asc')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tri])

  React.useEffect(() => {
    if (!serveur) return
    const t = window.setTimeout(() => serveur.surRecherche(filtre), 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtre])

  /** Valeurs distinctes d'une colonne, pour alimenter son filtre en liste. */
  const valeursDistinctes = React.useCallback(
    (champ: string) => {
      const c = visibles.find((v) => v.champ === champ)
      const s = new Set<string>()
      for (const l of lignes ?? []) {
        const v = c?.valeurTri ? c.valeurTri(l) : l[champ]
        if (v !== null && v !== undefined && v !== '') s.add(String(v))
      }
      return [...s].sort()
    },
    [lignes, visibles],
  )

  /* LE FILTRE PAR COLONNE NE PEUT PAS MARCHER EN MODE SERVEUR, donc on ne le
     propose pas.
     
     `manualFiltering: true` dit a la table de ne PAS filtrer localement — c'est
     juste, elle n'a qu'une page sous la main — et rien ne transmet ces filtres
     au serveur. Le bouton s'allumait donc, affichait « 1 », et le tableau ne
     bougeait pas. Un controle qui ment est pire qu'un controle absent : on
     conclut que le filtre ne trouve rien, alors qu'il n'a jamais ete applique.
     
     Les ecrans en mode serveur portent leur propre barre de filtres, qui elle
     interroge le serveur. */
  const colonnesFiltrables = serveur ? [] : visibles.filter((c) => c.filtre)
  const nbFiltresActifs = filtresColonne.length

  if (chargement) {
    return (
      <div className="space-y-2">
        <Squelette className="h-9 w-64" />
        <Squelette className="h-64 w-full" />
      </div>
    )
  }

  if (!visibles.length) {
    return (
      <EtatVide
        icone={Inbox}
        titre="Aucune colonne visible"
        description="Vos droits masquent tous les champs de cet ecran."
      />
    )
  }

  const rangs = table.getRowModel().rows
  const total = serveur ? serveur.total : table.getFilteredRowModel().rows.length
  const pagination = serveur
    ? { pageIndex: serveur.page, pageSize: serveur.taille }
    : table.getState().pagination

  const meta = (id: string) =>
    (definitions.find((d) => d.id === id)?.meta ?? {}) as {
      numerique?: boolean
      secondaire?: boolean
      largeur?: string
    }

  return (
    <div className="space-y-2">
      {/* --- Barre d'outils ----------------------------------------------
          ELLE RESTE EN HAUT, ET C'EST INDISPENSABLE SUR UNE GRANDE TABLE.
          Sur quatre cents references, l'utilisateur qui veut changer de filtre
          apres avoir descendu la liste devait remonter jusqu'en haut, filtrer,
          puis redescendre. La barre suit donc le defilement.

          `top-0` colle a l'en-tete de table, qui est deja `sticky top-0` : les
          deux se superposeraient. On la place donc AU-DESSUS en pile (`z-20`
          contre `z-10`) et on lui donne un fond opaque — sans quoi les lignes
          defileraient visiblement derriere elle.

          `sans-impression` : une barre d'outils n'a rien a faire sur un papier. */}
      {(recherche || colonnesFiltrables.length > 0 || visibles.length > 4 || barreOutils) && (
        <div
          /* COLLEE SOUS L EN-TETE DE PAGE. Deux regimes, mesures a l ecran :
             l en-tete fait 36 px des `sm`, et 65 px en dessous ou ses actions
             passent a la ligne. Les decalages suivent, en CSS pur — une version
             precedente les mesurait en JavaScript, et les crochets ajoutes a
             `EnTetePage` faisaient planter toute l application. */
          className="sans-impression sticky top-[4.6rem] z-20 -mx-1 flex flex-wrap items-center
                     gap-1.5 border-b border-bordure bg-fond px-1 py-2 sm:top-[2.5rem]"
        >
          {recherche && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-attenue-texte" />
              <Champ
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                placeholder={placeholderRecherche}
                className="w-56 pl-7"
              />
            </div>
          )}

          {colonnesFiltrables.length > 0 && (
            <Bouton
              variante={nbFiltresActifs ? 'principal' : 'contour'}
              taille="md"
              onClick={() => setFiltresOuverts((o) => !o)}
            >
              <Filter />
              Filtres
              {nbFiltresActifs > 0 && (
                <span className="rounded bg-surface/25 px-1 text-[10px]">{nbFiltresActifs}</span>
              )}
            </Bouton>
          )}

          {nbFiltresActifs > 0 && (
            <Bouton variante="discret" taille="sm" onClick={() => setFiltresColonne([])}>
              <X />
              Effacer
            </Bouton>
          )}

          {barreOutils}

          {/* --- Outils de sortie --------------------------------------------
              Groupes a droite, en un bloc segmente : trois boutons pleins et
              libelles cote a cote encombraient la barre au point de repousser
              les filtres hors de vue sur un portable. Ici ce sont des icones
              dans un cadre unique — visibles quand on les cherche, muettes
              quand on ne les cherche pas.

              L'INTITULE RESTE AU SURVOL, pas dans le bouton. Une icone
              d'imprimante et une fleche descendante se reconnaissent ; ce qui
              se devine moins, c'est CE QUI part au papier ou au fichier, et
              c'est cela que l'infobulle precise. */}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] tabular-nums text-attenue-texte sm:inline">
              {total} ligne{total > 1 ? 's' : ''}
            </span>

            <div className="flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-bordure">
              {visibles.length > 4 && (
                <Menu>
                  <MenuDeclencheur asChild>
                    <button
                      type="button"
                      title="Choisir les colonnes affichees"
                      aria-label="Colonnes"
                      className="grid size-7 place-items-center text-attenue-texte
                                 transition-colors hover:bg-attenue hover:text-texte"
                    >
                      <Columns3 className="size-3.5" />
                    </button>
                  </MenuDeclencheur>
                  <MenuContenu className="max-h-80 overflow-y-auto">
                    <MenuTitre>Colonnes affichees</MenuTitre>
                    {table.getAllLeafColumns().map((col) => (
                      <MenuElement
                        key={col.id}
                        onSelect={(e) => {
                          e.preventDefault()
                          col.toggleVisibility()
                        }}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={col.getIsVisible()}
                          className="size-3.5"
                        />
                        {visibles.find((v) => v.champ === col.id)?.entete ?? col.id}
                      </MenuElement>
                    ))}
                  </MenuContenu>
                </Menu>
              )}

              {imprimable && (
                <button
                  type="button"
                  disabled={!rangs.length}
                  onClick={() => window.print()}
                  title="Imprimer la liste telle qu elle est affichee"
                  aria-label="Imprimer la liste"
                  className="grid size-7 place-items-center border-l border-bordure
                             text-attenue-texte transition-colors hover:bg-attenue
                             hover:text-texte disabled:pointer-events-none disabled:opacity-40"
                >
                  <Printer className="size-3.5" />
                </button>
              )}

              {exportable && (
                <button
                  type="button"
                  disabled={!rangs.length}
                  onClick={() =>
                    exporterCsv(
                      exportable,
                      visibles.map((c) => ({
                        champ: c.champ,
                        entete: c.entete,
                        numerique: c.numerique,
                        // `valeurTri` porte deja la valeur brute quand
                        // l'affichage differe — une date formatee, un statut
                        // traduit. C'est ce qu'un tableur doit recevoir : le
                        // rendu JSX ne s'exporte pas.
                        valeurExport: c.valeurTri,
                      })),
                      // Les lignes AFFICHEES, filtres et tri compris : on
                      // exporte ce qu'on voit. Exporter la table entiere
                      // surprendrait apres avoir pose trois filtres.
                      rangs.map((r) => r.original),
                    )
                  }
                  title="Télécharger la liste au format CSV, lisible par Excel"
                  aria-label="Exporter la liste"
                  className="grid size-7 place-items-center border-l border-bordure
                             text-attenue-texte transition-colors hover:bg-attenue
                             hover:text-texte disabled:pointer-events-none disabled:opacity-40"
                >
                  <Download className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Filtres par colonne, regroupes -------------------------------
          Ranges dans un bandeau plutot que sous chaque en-tete : la ligne de
          filtres integree au tableau double la hauteur de l'en-tete et devient
          illisible des qu'il y a plus de six colonnes. */}
      {filtresOuverts && colonnesFiltrables.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-bordure bg-attenue/40 p-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {colonnesFiltrables.map((c) => {
            const col = table.getColumn(c.champ)
            const valeur = (col?.getFilterValue() as string) ?? ''
            return (
              <div key={c.champ}>
                <label className="mb-0.5 block text-[11px] font-medium text-attenue-texte">
                  {c.entete}
                </label>
                {c.filtre === 'liste' ? (
                  <Selecteur
                    value={valeur}
                    onChange={(e) => col?.setFilterValue(e.target.value || undefined)}
                  >
                    <option value="">Tous</option>
                    {valeursDistinctes(c.champ).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Selecteur>
                ) : (
                  <Champ
                    value={valeur}
                    onChange={(e) => col?.setFilterValue(e.target.value || undefined)}
                    placeholder="Contient..."
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {rangs.length === 0 ? (
        <EtatVide
          icone={Inbox}
          titre={videTitre}
          description={videDescription}
          action={videAction}
        />
      ) : (
        <>
          {/* --- Tableau : au-dela de 768 px ----------------------------- */}
          <div
            ref={conteneur}
            className="defilement-x hidden rounded-lg border border-bordure bg-surface md:block"
            style={hauteurMax ? { maxHeight: hauteurMax, overflowY: 'auto' } : undefined}
          >
            <table className="grille w-full text-[12px]">
              {/* L'en-tete se colle SOUS la barre d'outils : `top-12` la laisse
                  passer, sinon les deux se recouvrent au defilement. */}
              {/* CET EN-TETE NE COLLE PAS, ET CE N'EST PAS FAUTE DE `sticky`.
                  Le tableau vit dans un conteneur `overflow-x-auto` : des qu'un
                  ancetre porte un debordement, il devient le referentiel du
                  collage, et `sticky` ne voit plus le defilement de la page.
                  Mesure a l'appui — sur un ecran de 500 px ou la table defile
                  de 903 px, l'en-tete part a -434 px.

                  C'etait deja le cas AVANT que je touche a quoi que ce soit :
                  le `sticky top-0` d'origine ne servait a rien non plus. Le
                  reparer demande de donner au conteneur sa propre hauteur et
                  son propre defilement vertical — un changement de modele de
                  defilement qui merite d'etre decide, pas glisse ici.

                  On laisse donc `top-0` : inerte, mais honnete. */}
              <thead className="sticky top-0 z-10">
                {table.getHeaderGroups().map((groupe) => (
                  <tr key={groupe.id} className="bg-attenue">
                    {/* La colonne du bouton « + » n'existe que s'il y a
                        quelque chose a deplier. */}
                    {retirees.size > 0 && <th className="w-8 bg-attenue px-1" />}
                    {groupe.headers.map((entete) => {
                      const m = meta(entete.column.id)
                      const sens = entete.column.getIsSorted()
                      const filtree = entete.column.getFilterValue() != null
                      return (
                        <th
                          key={entete.id}
                          style={m.largeur ? { width: m.largeur } : undefined}
                          className={cn(
                            'bg-attenue px-2.5 py-1.5 text-left',
                            'text-[10px] font-semibold uppercase tracking-wider text-attenue-texte whitespace-nowrap',
                            m.numerique && 'text-right',
                            retirees.has(entete.column.id) && 'hidden',
                          )}
                        >
                          {entete.column.getCanSort() ? (
                            <button
                              onClick={entete.column.getToggleSortingHandler()}
                              className={cn(
                                'inline-flex items-center gap-1 rounded transition-colors hover:text-texte',
                                m.numerique && 'flex-row-reverse',
                                filtree && 'text-primaire',
                              )}
                            >
                              {flexRender(entete.column.columnDef.header, entete.getContext())}
                              {sens === 'asc' ? (
                                <ArrowUp className="size-3" />
                              ) : sens === 'desc' ? (
                                <ArrowDown className="size-3" />
                              ) : (
                                <ChevronsUpDown className="size-3 opacity-30" />
                              )}
                              {filtree && <Filter className="size-2.5" />}
                            </button>
                          ) : (
                            flexRender(entete.column.columnDef.header, entete.getContext())
                          )}
                        </th>
                      )
                    })}
                    {actions && <th className="w-px px-3" />}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rangs.map((rang) => {
                  const id = cle(rang.original)
                  const deplie = dépliees.has(id)
                  const ligne = (
                    <tr
                      onClick={surClic ? () => surClic(rang.original) : undefined}
                      // Le quadrillage vient de la classe `grille` : filets
                      // horizontaux ET verticaux, definis une seule fois dans la
                      // feuille globale.
                      className={cn(
                        'transition-colors',
                        surClic ? 'cursor-pointer hover:bg-primaire/5' : 'hover:bg-attenue/60',
                        // Etat propre au menu contextuel : la ligne visee reste
                        // designee tant que le menu est ouvert. Sans cela le
                        // menu flotte au-dessus du tableau sans qu'on sache plus
                        // sur quelle ligne il porte.
                        menuContextuel && 'data-[state=open]:bg-primaire/8',
                      )}
                    >
                      {/* LE BOUTON QUI DEPLIE. Il ne parait que s'il y a
                          quelque chose dessous — un « + » qui n'ouvre rien
                          est une promesse non tenue. Le clic ne doit pas
                          declencher l'ouverture de la ligne : deplier et
                          ouvrir sont deux gestes differents. */}
                      {retirees.size > 0 && (
                        <td className="w-8 px-1 align-middle">
                          <button
                            type="button"
                            aria-expanded={deplie}
                            aria-label={deplie ? 'Replier le detail' : 'Voir le detail'}
                            onClick={(e) => {
                              e.stopPropagation()
                              basculerDepli(id)
                            }}
                            className={cn(
                              'grid size-5 place-items-center rounded-full border transition-colors',
                              deplie
                                ? 'border-primaire bg-primaire text-primaire-texte'
                                : 'border-bordure text-attenue-texte hover:border-primaire/50 hover:text-texte',
                            )}
                          >
                            {deplie ? <Minus className="size-3" /> : <Plus className="size-3" />}
                          </button>
                        </td>
                      )}
                      {rang.getVisibleCells().map((cellule) => {
                        const m = meta(cellule.column.id)
                        return (
                          <td
                            key={cellule.id}
                            className={cn(
                              'px-2.5 align-middle',
                              m.numerique && 'text-right tabular-nums',
                              retirees.has(cellule.column.id) && 'hidden',
                            )}
                          >
                            {flexRender(cellule.column.columnDef.cell, cellule.getContext())}
                          </td>
                        )
                      })}
                      {actions && (
                        <td
                          className="px-2 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {actions(rang.original)}
                        </td>
                      )}
                    </tr>
                  )

                  /* LA LIGNE DE DETAIL porte ce que la largeur a chasse.
                     En liste libelle / valeur, sur deux ou trois colonnes
                     selon la place : c'est la forme qui se lit le mieux quand
                     les champs n'ont aucun rapport entre eux. */
                  const detail = deplie && retirees.size > 0 && (
                    <tr key={id + '-detail'} className="bg-attenue/40">
                      <td
                        colSpan={visibles.length - retirees.size + 1 + (actions ? 1 : 0)}
                        className="px-3 py-2.5"
                      >
                        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {visibles
                            .filter((c) => retirees.has(c.champ))
                            .map((c) => (
                              <div
                                key={c.champ}
                                className="flex items-baseline justify-between gap-3
                                           border-b border-bordure/50 pb-1"
                              >
                                <dt className="text-[10.5px] font-medium uppercase
                                               tracking-wider text-attenue-texte">
                                  {c.entete}
                                </dt>
                                <dd
                                  className={cn(
                                    'min-w-0 text-right text-[12px]',
                                    c.numerique && 'tabular-nums',
                                  )}
                                >
                                  {c.rendu
                                    ? c.rendu(rang.original)
                                    : String(rang.original[c.champ] ?? '—')}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </td>
                    </tr>
                  )

                  if (!menuContextuel)
                    return (
                      <React.Fragment key={id}>
                        {ligne}
                        {detail}
                      </React.Fragment>
                    )

                  // `asChild` fait porter le clic droit par le <tr> lui-meme.
                  // Sans lui, Radix inserait un <span> declencheur, que le
                  // navigateur remonterait hors du <tbody> : la ligne se
                  // detacherait du tableau.
                  return (
                    <React.Fragment key={id}>
                      <MenuContextuel>
                        <MenuContextuelDeclencheur asChild>{ligne}</MenuContextuelDeclencheur>
                        <MenuContextuelContenu>{menuContextuel(rang.original)}</MenuContextuelContenu>
                      </MenuContextuel>
                      {detail}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* --- Version papier ------------------------------------------
              Rendue en permanence mais invisible a l'ecran : `@media print`
              masque tout le reste et ne laisse qu'elle. La produire seulement
              au clic obligerait a un aller-retour de rendu avant l'appel a
              `window.print()`, pendant lequel le navigateur capture parfois une
              page encore vide. */}
          {imprimable && (
            <TableauImprimable
              titre={imprimable}
              colonnes={visibles.map((c) => ({
                entete: c.entete,
                numerique: c.numerique,
                valeur: (l: L) => {
                  const v = c.valeurTri ? c.valeurTri(l) : l[c.champ]
                  return v == null ? '' : String(v)
                },
              }))}
              lignes={rangs.map((r) => r.original)}
              resume={`${rangs.length} ligne(s)${
                total !== rangs.length ? ` sur ${total}` : ''
              }${filtre ? ` — recherche « ${filtre} »` : ''}`}
            />
          )}

          {/* --- Cartes : telephone et tablette portrait ------------------ */}
          <div className="space-y-2 md:hidden">
            {rangs.map((rang) => (
              <div
                key={rang.id}
                onClick={surClic ? () => surClic(rang.original) : undefined}
                className={cn(
                  'rounded-lg border border-bordure bg-surface p-3',
                  surClic && 'active:bg-attenue',
                )}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  {titreCarte && (
                    <div className="min-w-0 font-medium">{titreCarte(rang.original)}</div>
                  )}
                  {actions && (
                    <div onClick={(e) => e.stopPropagation()}>{actions(rang.original)}</div>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  {rang.getVisibleCells().map((cellule) => (
                    <div key={cellule.id} className="min-w-0">
                      <dt className="text-xs text-attenue-texte">
                        {visibles.find((v) => v.champ === cellule.column.id)?.entete}
                      </dt>
                      {/* UNE CARTE A LA PLACE DE PASSER A LA LIGNE, une table
                          non. `truncate` coupait « SOFIA TEXTILE » ou une
                          designation longue au milieu d'un mot, sans que rien
                          ne le signale — 44 px de valeur perdus sur l'ecran
                          Stock. Ici la hauteur est libre : on laisse le texte
                          revenir a la ligne. */}
                      <dd className="break-words">
                        {flexRender(cellule.column.columnDef.cell, cellule.getContext())}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          {/* --- Pagination ----------------------------------------------
              Toujours affichee des qu'il y a des lignes : le compte total et
              le choix de la taille de page sont des reperes utiles meme sur
              une seule page.

              FIGEE EN BAS SUR TELEPHONE. Vingt-cinq cartes font sept mille
              pixels : la barre de pages se trouvait sous la derniere, et il
              fallait traverser toute la liste pour changer de page — puis
              remonter pour la lire. Au bureau elle reste au fil du texte : le
              corps du tableau a deja sa propre hauteur bornee, la barre est
              donc visible sans rien figer. */}
          <div
            className={cn(
              'sticky z-20 -mx-3 flex flex-wrap items-center justify-between gap-3',
              'border-t border-bordure bg-fond px-3 py-2 text-[12px]',
              'md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0',
              !avecPagination && 'hidden',
            )}
            style={{ bottom: 'var(--barre-basse, 0px)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-attenue-texte">
                {total === 0
                  ? '0 ligne'
                  : `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min(
                      (pagination.pageIndex + 1) * pagination.pageSize,
                      total,
                    )} sur ${total}`}
              </span>
              <select
                value={pagination.pageSize}
                onChange={(e) => {
                  const t = Number(e.target.value)
                  if (serveur) serveur.surTaille(t)
                  else table.setPageSize(t)
                }}
                aria-label="Lignes par page"
                className="h-8 rounded-[var(--radius)] border border-champ bg-surface px-2 text-xs outline-none
                           focus-visible:border-anneau focus-visible:ring-2 focus-visible:ring-anneau/25"
              >
                {[10, 25, 50, 100, 250].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
                <option value={Math.max(total, 1)}>Tout</option>
              </select>
            </div>

            {Math.max(1, Math.ceil(total / pagination.pageSize)) > 1 && (
              <div className="flex items-center gap-1">
                <Bouton
                  variante="contour"
                  taille="icone"
                  onClick={() => table.firstPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Premiere page"
                >
                  <ChevronsLeft />
                </Bouton>
                <Bouton
                  variante="contour"
                  taille="icone"
                  onClick={() =>
                    serveur ? serveur.surPage(serveur.page - 1) : table.previousPage()
                  }
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Page précédente"
                >
                  <ChevronLeft />
                </Bouton>
                <Badge ton="contour" className="px-2.5 py-1 tabular-nums">
                  {pagination.pageIndex + 1} / {Math.max(1, Math.ceil(total / pagination.pageSize))}
                </Badge>
                <Bouton
                  variante="contour"
                  taille="icone"
                  onClick={() =>
                    serveur ? serveur.surPage(serveur.page + 1) : table.nextPage()
                  }
                  disabled={pagination.pageIndex + 1 >= Math.max(1, Math.ceil(total / pagination.pageSize))}
                  aria-label="Page suivante"
                >
                  <ChevronRight />
                </Bouton>
                <Bouton
                  variante="contour"
                  taille="icone"
                  onClick={() => table.lastPage()}
                  disabled={pagination.pageIndex + 1 >= Math.max(1, Math.ceil(total / pagination.pageSize))}
                  aria-label="Dernière page"
                >
                  <ChevronsRight />
                </Bouton>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export { Chargement }

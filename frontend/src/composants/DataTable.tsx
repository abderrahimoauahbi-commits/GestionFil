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
  Filter,
  Inbox,
  Search,
  X,
} from 'lucide-react'
import { useDroits } from '../auth/AuthContext'
import { cn } from '../lib/utils'
import { Badge, Bouton, Champ, Chargement, EtatVide, Selecteur, Squelette } from './ui/base'
import { Menu, MenuContenu, MenuDeclencheur, MenuElement, MenuTitre } from './ui/surcouches'

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
  largeur?: string
  triable?: boolean
  /**
   * Filtre propre a la colonne, affiche sous son en-tete.
   *   'texte' : contient
   *   'liste' : egalite, valeurs deduites des donnees
   */
  filtre?: 'texte' | 'liste'
}

interface Props<L> {
  module: string
  colonnes: ColonneDT<L>[]
  lignes: L[] | undefined
  chargement?: boolean
  cle: (ligne: L) => string
  surClic?: (ligne: L) => void
  /** Colonne d'actions, toujours rendue en fin de ligne. */
  actions?: (ligne: L) => React.ReactNode
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
  hauteurMax?: string
}

export function DataTable<L extends Record<string, unknown>>({
  module,
  colonnes,
  lignes,
  chargement,
  cle,
  surClic,
  actions,
  titreCarte,
  recherche = true,
  placeholderRecherche = 'Filtrer...',
  tailleParDefaut = 25,
  pagination: avecPagination = true,
  videTitre = 'Aucun resultat',
  videDescription,
  videAction,
  barreOutils,
  hauteurMax,
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
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: tailleParDefaut } },
  })

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

  const colonnesFiltrables = visibles.filter((c) => c.filtre)
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
  const total = table.getFilteredRowModel().rows.length
  const pagination = table.getState().pagination

  const meta = (id: string) =>
    (definitions.find((d) => d.id === id)?.meta ?? {}) as {
      numerique?: boolean
      secondaire?: boolean
      largeur?: string
    }

  return (
    <div className="space-y-2">
      {/* --- Barre d'outils --------------------------------------------- */}
      {(recherche || colonnesFiltrables.length > 0 || visibles.length > 4 || barreOutils) && (
        <div className="flex flex-wrap items-center gap-1.5">
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

          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-[11px] tabular-nums text-attenue-texte sm:inline">
              {total} ligne{total > 1 ? 's' : ''}
            </span>
            {visibles.length > 4 && (
              <Menu>
                <MenuDeclencheur asChild>
                  <Bouton variante="contour" taille="md">
                    <Columns3 />
                    <span className="hidden sm:inline">Colonnes</span>
                  </Bouton>
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
            className="defilement-x hidden rounded-lg border border-bordure bg-surface md:block"
            style={hauteurMax ? { maxHeight: hauteurMax, overflowY: 'auto' } : undefined}
          >
            <table className="grille w-full text-[12px]">
              <thead className="sticky top-0 z-10">
                {table.getHeaderGroups().map((groupe) => (
                  <tr key={groupe.id} className="bg-attenue">
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
                            m.secondaire && 'hidden xl:table-cell',
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
                {rangs.map((rang) => (
                  <tr
                    key={cle(rang.original)}
                    onClick={surClic ? () => surClic(rang.original) : undefined}
                    // Le quadrillage vient de la classe `grille` : filets
                    // horizontaux ET verticaux, definis une seule fois dans la
                    // feuille globale.
                    className={cn(
                      'transition-colors',
                      surClic ? 'cursor-pointer hover:bg-primaire/5' : 'hover:bg-attenue/60',
                    )}
                  >
                    {rang.getVisibleCells().map((cellule) => {
                      const m = meta(cellule.column.id)
                      return (
                        <td
                          key={cellule.id}
                          className={cn(
                            'px-2.5 py-[5px] align-middle',
                            m.numerique && 'text-right tabular-nums',
                            m.secondaire && 'hidden xl:table-cell',
                          )}
                        >
                          {flexRender(cellule.column.columnDef.cell, cellule.getContext())}
                        </td>
                      )
                    })}
                    {actions && (
                      <td className="px-2 py-[5px] text-right" onClick={(e) => e.stopPropagation()}>
                        {actions(rang.original)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
                      <dd className="truncate">
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
              une seule page. */}
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 text-[12px]',
              !avecPagination && 'hidden',
            )}
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
                onChange={(e) => table.setPageSize(Number(e.target.value))}
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

            {table.getPageCount() > 1 && (
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
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Page precedente"
                >
                  <ChevronLeft />
                </Bouton>
                <Badge ton="contour" className="px-2.5 py-1 tabular-nums">
                  {pagination.pageIndex + 1} / {table.getPageCount()}
                </Badge>
                <Bouton
                  variante="contour"
                  taille="icone"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Page suivante"
                >
                  <ChevronRight />
                </Bouton>
                <Bouton
                  variante="contour"
                  taille="icone"
                  onClick={() => table.lastPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Derniere page"
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

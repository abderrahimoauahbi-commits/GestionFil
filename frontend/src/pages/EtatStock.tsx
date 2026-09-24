/**
 * Etat des stocks — une ligne par reference, ventilee par magasin.
 *
 * CE QUI A CHANGE, ET POURQUOI. L'ecran precedent lisait `/api/stock`, qui rend
 * une ligne par couple (reference, magasin) : il fallait quatre lignes pour
 * savoir ou etaient les kilos d'une reference, et le total ne s'affichait
 * nulle part. La feuille « Stock » du classeur a la bonne forme depuis
 * toujours — une ligne par reference, des colonnes par magasin — et c'est
 * celle-ci.
 *
 * LES MACHINES TIENNENT EN UNE COLONNE. Chaque etage est un magasin, ce qui est
 * juste pour la comptabilite et illisible dans un etat : une machine a six
 * zones ferait six colonnes. Le detail vit sur l'ecran des machines ; deux
 * etats pour la meme matiere ne servent personne.
 *
 * DEUX MISES EN PAGE, UN SEUL JEU DE DONNEES. Sur large ecran, un tableau
 * dense que l'on balaie — c'est un ecran de bureau, on y compare des lignes.
 * Sur telephone, une carte par reference qui se deplie : la meme information,
 * mais lue une reference a la fois.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Boxes, ChevronDown, ChevronLeft, ChevronRight, Cog, Download, Printer, Search, Warehouse, X } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { BarreFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { Alerte, Chargement } from '../composants/ui/base'
import { TableauImprimable } from '../composants/Etat'
import { cn, fmt } from '../lib/utils'

const MODULE = 'STOCK'

interface LigneStock extends Record<string, unknown> {
  code_reference: string
  designation: string
  categorie: string | null
  fournisseur_nom: string | null
  unite: string | null
  stock_global_kg: number | null
  magasins_kg: number | null
  machines_kg: number | null
  machines_bobines: number | null
  nb_machines: number | null
  par_magasin: Record<string, number> | null
  /* LE COMPTAGE TEL QU'ON LE FAIT AU MAGASIN. Le stock ENTRE en palettes ; le
     rendre en kilos seulement obligeait le magasinier a diviser de tete pour
     retrouver ce qu'il a devant les yeux. `null` quand le catalogue ignore le
     poids d'une bobine ou leur nombre par palette : on ne sait pas, on ne dit
     rien — un zero se lirait « il n'y en a pas ». */
  kg_par_palette: number | null
  palettes: number | null
  bobines: number | null
  quarantaine_kg: number | null
  disponible_kg: number | null
  encours_kg: number | null
  besoin_12m_kg: number | null
  stock_projete_kg: number | null
  stock_min_kg: number | null
  conso_mensuelle_kg: number | null
  jours_couverture: number | null
  delai_livraison_jours: number | null
  statut: string | null
  /** La lecture du magasin : sous le minimum, quelle que soit la demande. */
  sous_minimum: boolean | null
  classe_abc: string | null
  classe_xyz: string | null
  cmup_mad: number | null
  prix_catalogue_kg: number | null
  devise: string | null
  valeur_mad: number | null
  a_commander_kg: number | null
  derniere_sortie: string | null
  jours_sans_mouvement: number | null
  nb_equivalents: number | null
}

interface Magasin {
  code_magasin: string
  nom: string
  actif: number
}

const nb = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

/** Les quatre statuts, du plus grave au plus calme. */
const TONS: Record<string, string> = {
  RUPTURE: 'bg-danger/15 text-danger',
  CRITIQUE: 'bg-alerte/20 text-alerte',
  ATTENTION: 'bg-alerte/15 text-alerte',
  OK: 'bg-succes/15 text-succes',
}

export function EtatStock() {
  const { peut } = useAuth()
  const [recherche, setRecherche] = useState('')
  const [statut, setStatut] = useState('')
  const [ouverte, setOuverte] = useState<string | null>(null)
  /* OU LE STOCK SE TROUVE : le seul critere que la barre generique ne sait pas
     poser, parce qu'une reference est presente dans PLUSIEURS magasins a la
     fois et qu'un filtre par egalite ne connait qu'une valeur. */
  const [magasin, setMagasin] = useState('')
  const [page, setPage] = useState(0)
  const [taille, setTaille] = useState(50)

  const q = useQuery({
    queryKey: ['etat-stock'],
    queryFn: () => api.get<LigneStock[]>('/api/etat-stock?limite=5000'),
  })
  const qMag = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: () => api.get<Magasin[]>('/api/magasins?actif=1'),
  })

  const lignes = q.data ?? []

  /* LES COLONNES DE MAGASIN VIENNENT DES DONNEES, PAS D'UNE LISTE FIGEE.
     Un magasin cree demain doit apparaitre sans qu'on retouche cet ecran ; un
     magasin vide ne merite pas une colonne de tirets sur trois cents lignes.
     On ne garde donc que ceux qui portent effectivement quelque chose, et on
     ecarte les zones de machine, deja resumees par leur propre colonne. */
  const magasins = useMemo(() => {
    const vus = new Set<string>()
    for (const l of lignes) for (const c of Object.keys(l.par_magasin ?? {})) vus.add(c)
    const noms = new Map((qMag.data ?? []).map((m) => [m.code_magasin, m.nom]))
    return [...vus].sort().map((code) => ({ code, nom: noms.get(code) ?? code }))
  }, [lignes, qMag.data])

  /* LES CRITERES SONT CEUX DU CLASSEUR : de qui ca vient, de quelle famille,
     et ce que l'analyse en dit. Les valeurs proposees sortent des lignes
     recues — offrir une categorie que personne ne porte ne peut que vider le
     tableau. */
  const champs = useMemo<ChampFiltre<LigneStock>[]>(
    () => [
      { cle: 'categorie', libelle: 'Catégorie', type: 'liste', valeur: (l) => l.categorie },
      { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', valeur: (l) => l.fournisseur_nom },
      { cle: 'abc', libelle: 'Classe ABC', type: 'liste', valeur: (l) => l.classe_abc },
      { cle: 'unite', libelle: 'Unité', type: 'liste', valeur: (l) => l.unite },
    ],
    [],
  )
  const filtres = useFiltres<LigneStock>(champs)
  const { retenir } = filtres

  /* Les magasins DECLARES, pour le filtre. Les colonnes, elles, restent
     deduites du stock reel : c'est une lecture, pas un reglage. */
  const declares = qMag.data ?? []

  const filtrees = useMemo(() => {
    const r = recherche.trim().toLowerCase()
    return lignes.filter(
      (l) =>
        (!statut || l.statut === statut) &&
        (!magasin || (l.par_magasin?.[magasin] ?? 0) > 0) &&
        retenir(l) &&
        (!r ||
          l.designation?.toLowerCase().includes(r) ||
          l.code_reference?.toLowerCase().includes(r) ||
          l.fournisseur_nom?.toLowerCase().includes(r)),
    )
  }, [lignes, recherche, statut, magasin, retenir])

  /* ON REVIENT EN PREMIERE PAGE DES QUE LE FILTRE CHANGE. Rester en page 3
     d'un resultat qui n'en a plus qu'une affiche un tableau vide et donne a
     croire que le critere ne trouve rien. */
  useEffect(() => setPage(0), [recherche, statut, magasin, filtres.valeurs])

  const pages = Math.max(1, Math.ceil(filtrees.length / taille))
  const pageSure = Math.min(page, pages - 1)
  const visibles = useMemo(
    () => filtrees.slice(pageSure * taille, pageSure * taille + taille),
    [filtrees, pageSure, taille],
  )

  const totaux = useMemo(() => {
    const s = (f: (l: LigneStock) => number | null | undefined) =>
      filtrees.reduce((a, l) => a + (f(l) ?? 0), 0)
    return {
      global: s((l) => l.stock_global_kg),
      magasins: s((l) => l.magasins_kg),
      machines: s((l) => l.machines_kg),
      valeur: s((l) => l.valeur_mad),
      commander: s((l) => l.a_commander_kg),
      ruptures: filtrees.filter((l) => l.statut === 'RUPTURE').length,
      sousMin: filtrees.filter((l) => l.sous_minimum).length,
    }
  }, [filtrees])


  /**
   * LA BARRE DE PAGES, POSEE EN HAUT ET EN BAS.
   *
   * Elle existe parce que 124 references font sept metres de page sur un
   * telephone. En bas seulement, il fallait traverser les cinquante fiches pour
   * atteindre « page suivante » — exactement le defilement qu'on voulait
   * supprimer. Elle s'affiche meme quand tout tient sur une page : sans elle,
   * rien ne dit si l'ecran montre tout ou une tranche.
   *
   * C'est un ELEMENT et non un composant : declarer un composant dans le corps
   * du rendu en fabrique un type neuf a chaque passage, React demonte alors la
   * barre et la liste deroulante se referme sous le doigt a l'instant meme ou
   * l'on change le nombre de lignes par page.
   */
  const barrePages = (
    <div className="sans-impression flex flex-wrap items-center justify-between gap-2
                    rounded-[var(--radius)] border border-bordure bg-surface px-2.5 py-2">
      <span className="text-[12px] tabular-nums text-attenue-texte">
        {pageSure * taille + 1}–{Math.min(filtrees.length, (pageSure + 1) * taille)} sur{' '}
        {filtrees.length}
      </span>
      <div className="flex items-center gap-2">
        <select
          value={taille}
          onChange={(e) => {
            setTaille(Number(e.target.value))
            setPage(0)
          }}
          className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure
                     bg-fond px-2 text-[12.5px]"
          aria-label="References par page"
        >
          {[25, 50, 100, 250].map((n) => (
            <option key={n} value={n}>
              {n} par page
            </option>
          ))}
          <option value={100000}>Tout afficher</option>
        </select>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(pageSure - 1)}
            disabled={pageSure === 0}
            className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center
                       rounded-[var(--radius-sm)] border border-bordure disabled:opacity-40"
            aria-label="Page precedente"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[4.5rem] text-center text-[12px] tabular-nums">
            {pageSure + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage(pageSure + 1)}
            disabled={pageSure >= pages - 1}
            className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center
                       rounded-[var(--radius-sm)] border border-bordure disabled:opacity-40"
            aria-label="Page suivante"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )

  if (q.isLoading) return <Chargement texte="Lecture de l etat des stocks…" />

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="État des stocks"
        actions={
          <>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)]
                         border border-bordure px-3 text-[13px] hover:bg-attenue"
            >
              <Printer className="size-4" />
              Imprimer
            </button>
            {peut(MODULE, 'LIRE') && (
              <button
                type="button"
                onClick={() => exporter(filtrees, magasins)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)]
                           border border-bordure px-3 text-[13px] hover:bg-attenue"
              >
                <Download className="size-4" />
                Export
              </button>
            )}
          </>
        }
      />

      {/* --- Le resume, comme en tete de la feuille du classeur ------------- */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tuile t="Stock global" v={`${nb(totaux.global)} kg`} fort />
        <Tuile t="En magasin" v={`${nb(totaux.magasins)} kg`} />
        <Tuile
          t="Sur machines"
          v={`${nb(totaux.machines)} kg`}
          Icone={Cog}
        />
        <Tuile t="Valeur" v={`${nb(totaux.valeur)} MAD`} />
        {/* DEUX LECTURES, DEUX TUILES. « Rupture » vient du calcul des
            besoins et vaut zero tant qu'aucune demande n'est planifiee ;
            « sous le minimum » est la lecture du magasin, celle du classeur.
            Les confondre donnerait un ecran qui affiche OK a cote d'un besoin
            de commande de 3 900 kg. */}
        <Tuile
          t="Sous le minimum"
          v={String(totaux.sousMin)}
          alerte={totaux.sousMin > 0}
        />
      </div>

      {/* --- Les criteres, la meme barre que sur les autres ecrans ---------- */}
      <BarreFiltres
        champs={champs}
        lignes={lignes}
        valeurs={filtres.valeurs}
        definir={filtres.definir}
        reinitialiser={() => {
          filtres.reinitialiser()
          setMagasin('')
        }}
        actifs={filtres.actifs + (magasin ? 1 : 0)}
        enPied={
          declares.length > 1 && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-attenue-texte">Magasin</span>
              <select
                value={magasin}
                onChange={(e) => setMagasin(e.target.value)}
                className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure
                           bg-fond px-2 text-[12.5px]"
              >
                <option value="">Tous les magasins</option>
                {declares.map((m) => (
                  <option key={m.code_magasin} value={m.code_magasin}>
                    {m.nom}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />

      {/* --- La recherche et les statuts ------------------------------------ */}
      <div className="sans-impression flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-attenue-texte" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Référence, designation, fournisseur…"
            className="min-h-[38px] w-full rounded-[var(--radius-sm)] border border-bordure
                       bg-fond pl-8 pr-8 text-[13px]"
          />
          {recherche && (
            <button
              type="button"
              onClick={() => setRecherche('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-attenue-texte"
              aria-label="Effacer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['', 'RUPTURE', 'CRITIQUE', 'ATTENTION', 'OK'].map((s) => (
            <button
              key={s || 'tous'}
              type="button"
              onClick={() => setStatut(s)}
              className={cn(
                'min-h-[38px] rounded-[var(--radius-sm)] px-3 text-[12px] font-medium',
                statut === s
                  ? 'bg-primaire text-primaire-texte'
                  : 'border border-bordure hover:bg-attenue',
              )}
            >
              {s || 'Tous'}
            </button>
          ))}
        </div>
        <span className="text-[12px] tabular-nums text-attenue-texte">
          {filtrees.length} reference{filtrees.length > 1 ? 's' : ''}
        </span>
      </div>

      {filtrees.length === 0 ? (
        <Alerte ton="info" titre="Aucune référence">
          Aucune reference ne correspond a ces criteres.
        </Alerte>
      ) : (
        <>
          {barrePages}
          <TableauLarge
            lignes={visibles}
            toutes={filtrees}
            magasins={magasins}
            totaux={totaux}
          />
          <ListeTelephone
            lignes={visibles}
            magasins={magasins}
            ouverte={ouverte}
            setOuverte={setOuverte}
          />
          {barrePages}
        </>
      )}
    </div>
  )
}

function Tuile({
  t, v, fort, alerte, Icone,
}: {
  t: string
  v: string
  fort?: boolean
  alerte?: boolean
  Icone?: typeof Cog
}) {
  return (
    <div className="rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-attenue-texte">
        {Icone && <Icone className="size-3" />}
        {t}
      </div>
      <div
        className={cn(
          'tabular-nums',
          fort ? 'text-[20px] font-semibold' : 'text-[16px] font-medium',
          alerte ? 'text-danger' : 'text-texte',
        )}
      >
        {v}
      </div>
    </div>
  )
}

// =============================================================================
// LE TABLEAU, SUR LARGE ECRAN
// =============================================================================

/**
 * UN ECRAN DE BUREAU SERT A COMPARER DES LIGNES, pas a lire une fiche. La
 * densite est donc voulue : entete collante, chiffres alignes a droite en
 * chasse fixe, et les colonnes groupees par ce qu'elles racontent — ou est le
 * stock, ce qu'il vaut, ce qu'il annonce.
 *
 * Le defilement lateral appartient au tableau, jamais a la page.
 */
function TableauLarge({
  lignes, toutes, magasins, totaux,
}: {
  /** Les lignes de la PAGE affichee. */
  lignes: LigneStock[]
  /** Toutes les lignes retenues par les filtres : ce sont elles qu'on totalise.
      Totaliser la page donnerait un total qui change quand on tourne la page —
      un chiffre qu'on ne peut ni recopier ni verifier. */
  toutes: LigneStock[]
  magasins: { code: string; nom: string }[]
  totaux: { global: number; magasins: number; machines: number; valeur: number }
}) {
  return (
    <>
    /* CE TABLEAU EST CELUI DE L'ECRAN. La version papier est rendue par
       `TableauImprimable`, plus bas : elle porte l'en-tete de societe, la date
       d'edition et le nom de qui imprime — un etat, pas une photo d'ecran.
       C'est ce qui manquait ici : « Imprimer » sortait la barre laterale, les
       filtres, et le tableau tasse dans ce qui restait de largeur. */
    <div className="sans-impression hidden overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface md:block">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
            <th className="px-2 py-1 text-left" rowSpan={2}>Référence</th>
            <th className="border-l border-bordure px-2 py-1 text-center" colSpan={2 + magasins.length}>
              Ou est le stock (kg)
            </th>
            {/* LE COMPTAGE A SA PROPRE COLONNE, pas une infobulle : c'est le
                chiffre qu'on verifie en marchant dans l'allee. */}
            <th className="border-l border-bordure px-2 py-1 text-center" colSpan={2}>
              Comptage
            </th>
            <th className="border-l border-bordure px-2 py-1 text-center" colSpan={3}>
              Ce qu il annonce
            </th>
            <th className="border-l border-bordure px-2 py-1 text-center" colSpan={3}>
              Valeur
            </th>
          </tr>
          <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
            <th className="border-l border-bordure px-2 py-1 text-right font-semibold">Global</th>
            {magasins.map((m) => (
              <th key={m.code} className="px-2 py-1 text-right" title={m.nom}>
                {m.code}
              </th>
            ))}
            <th className="px-2 py-1 text-right">Machines</th>
            <th className="border-l border-bordure px-2 py-1 text-right">Palettes</th>
            <th className="px-2 py-1 text-right">Bobines</th>
            <th className="border-l border-bordure px-2 py-1 text-right">Min</th>
            <th className="px-2 py-1 text-right">Couv. j</th>
            <th className="px-2 py-1 text-center">Statut</th>
            <th className="border-l border-bordure px-2 py-1 text-right">CMUP</th>
            <th className="px-2 py-1 text-right">Valeur MAD</th>
            <th className="px-2 py-1 text-right">A cder kg</th>
          </tr>
        </thead>

        <tbody className="tabular-nums">
          {lignes.map((l) => (
            <tr key={l.code_reference} className="border-t border-bordure hover:bg-attenue/50">
              <td className="max-w-[22rem] px-2 py-1.5">
                <div className="truncate font-medium text-texte">{l.designation}</div>
                <div className="truncate text-[10px] text-attenue-texte">
                  {l.fournisseur_nom ?? '—'}
                  {l.classe_abc && <span className="ml-1.5">· {l.classe_abc}{l.classe_xyz}</span>}
                </div>
              </td>

              <td className="border-l border-bordure px-2 py-1.5 text-right font-semibold text-texte">
                {nb(l.stock_global_kg)}
              </td>
              {magasins.map((m) => (
                <td key={m.code} className="px-2 py-1.5 text-right text-attenue-texte">
                  {l.par_magasin?.[m.code] != null ? nb(l.par_magasin[m.code]) : ''}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right">
                {l.machines_kg ? (
                  <span className="text-texte" title={`${l.machines_bobines} bobines sur ${l.nb_machines} machine(s)`}>
                    {nb(l.machines_kg)}
                  </span>
                ) : (
                  ''
                )}
              </td>

              {/* LE TIRET DIT « ON NE SAIT PAS », et il se distingue du vide
                  qui dit « rien ici » : une reference sans poids de bobine au
                  catalogue ne se compte pas en palettes, et cela doit se voir
                  plutot que passer pour un zero. */}
              <td
                className="border-l border-bordure px-2 py-1.5 text-right text-texte"
                title={l.kg_par_palette ? `${nb(l.kg_par_palette)} kg la palette` : undefined}
              >
                {l.palettes == null ? (
                  <span className="text-attenue-texte">—</span>
                ) : (
                  nb(l.palettes, 2)
                )}
              </td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">
                {l.bobines == null ? '—' : nb(l.bobines, 0)}
              </td>

              <td className="border-l border-bordure px-2 py-1.5 text-right text-attenue-texte">
                {nb(l.stock_min_kg)}
              </td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">
                {nb(l.jours_couverture, 0)}
              </td>
              <td className="px-2 py-1.5 text-center">
                <div className="flex flex-col items-center gap-0.5">
                  <Pastille statut={l.statut} />
                  {l.sous_minimum && (
                    <span className="rounded-full bg-alerte/20 px-1.5 py-0.5 text-[9px] font-medium text-alerte">
                      SOUS MIN
                    </span>
                  )}
                </div>
              </td>

              <td className="border-l border-bordure px-2 py-1.5 text-right text-attenue-texte">
                {nb(l.cmup_mad, 2)}
              </td>
              <td className="px-2 py-1.5 text-right text-texte">{nb(l.valeur_mad)}</td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right',
                  (l.a_commander_kg ?? 0) > 0 ? 'font-medium text-danger' : 'text-attenue-texte',
                )}
              >
                {(l.a_commander_kg ?? 0) > 0 ? nb(l.a_commander_kg) : ''}
              </td>
            </tr>
          ))}
        </tbody>

        {/* LES TOTAUX RESTENT VISIBLES EN BAS : c'est la premiere chose qu'on
            cherche apres avoir filtre, et la derniere qu'on veut aller
            chercher en faisant defiler trois cents lignes. */}
        <tfoot className="sticky bottom-0">
          <tr className="border-t-2 border-ink/20 bg-attenue font-semibold text-texte">
            <td className="px-2 py-1.5">Total ({toutes.length})</td>
            <td className="border-l border-bordure px-2 py-1.5 text-right tabular-nums">
              {nb(totaux.global)}
            </td>
            {magasins.map((m) => (
              <td key={m.code} className="px-2 py-1.5 text-right tabular-nums">
                {nb(toutes.reduce((a, l) => a + (l.par_magasin?.[m.code] ?? 0), 0))}
              </td>
            ))}
            <td className="px-2 py-1.5 text-right tabular-nums">{nb(totaux.machines)}</td>
            <td className="border-l border-bordure px-2 py-1.5" colSpan={3} />
            <td className="border-l border-bordure px-2 py-1.5" />
            <td className="px-2 py-1.5 text-right tabular-nums">{nb(totaux.valeur)}</td>
            <td className="px-2 py-1.5" />
          </tr>
        </tfoot>
      </table>
    </div>

      {/* L'ETAT PAPIER : en-tete de societe, date, operateur. Il ne s'affiche
          jamais a l'ecran (`hidden print:block`) et remplace entierement la
          page a l'impression. */}
      <TableauImprimable<LigneStock>
        titre="Etat du stock"
        resume={`${toutes.length} reference(s) · global ${fmt.nombre(totaux.global, 0)} kg · magasins ${fmt.nombre(totaux.magasins, 0)} kg · machines ${fmt.nombre(totaux.machines, 0)} kg`}
        lignes={toutes}
        colonnes={[
          { entete: 'Reference', valeur: (l) => l.code_reference },
          { entete: 'Designation', valeur: (l) => l.designation },
          { entete: 'Fournisseur', valeur: (l) => l.fournisseur_nom ?? '—' },
          { entete: 'Magasins', numerique: true, valeur: (l) => fmt.nombre(l.magasins_kg ?? 0, 0) },
          { entete: 'Machines', numerique: true, valeur: (l) => fmt.nombre(l.machines_kg ?? 0, 0) },
          { entete: 'Global (kg)', numerique: true, valeur: (l) => fmt.nombre(l.stock_global_kg ?? 0, 0) },
        ]}
      />
    </>
  )
}

function Pastille({ statut }: { statut: string | null }) {
  if (!statut) return <span className="text-attenue-texte">—</span>
  return (
    <span
      className={cn(
        'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        TONS[statut] ?? 'bg-attenue text-attenue-texte',
      )}
    >
      {statut}
    </span>
  )
}

// =============================================================================
// LA LISTE, SUR TELEPHONE
// =============================================================================

/**
 * LA LIGNE QUI SE COMPLETE EN BAS. Deux chiffres restent visibles — la
 * reference et son stock global — et le reste se deplie sous la ligne. Une
 * seule ouverte a la fois : deux replis pousseraient hors de l'ecran ce qu'on
 * etait venu comparer.
 */
function ListeTelephone({
  lignes, magasins, ouverte, setOuverte,
}: {
  lignes: LigneStock[]
  magasins: { code: string; nom: string }[]
  ouverte: string | null
  setOuverte: (v: string | null) => void
}) {
  return (
    <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface md:hidden">
      {lignes.map((l) => {
        const deplie = ouverte === l.code_reference
        return (
          <div key={l.code_reference}>
            <button
              type="button"
              onClick={() => setOuverte(deplie ? null : l.code_reference)}
              aria-expanded={deplie}
              className="flex min-h-[52px] w-full items-center gap-2 px-3 py-2 text-left active:bg-attenue"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-texte">{l.designation}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
                  <Pastille statut={l.statut} />
                  {l.sous_minimum && (
                    <span className="rounded-full bg-alerte/20 px-1.5 py-0.5 text-[10px] font-medium text-alerte">
                      sous min
                    </span>
                  )}
                  {(l.machines_kg ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Cog className="size-3" />
                      {nb(l.machines_kg)} kg
                    </span>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-texte">
                {nb(l.stock_global_kg)}
                <span className="ml-0.5 text-[11px] font-normal text-attenue-texte">kg</span>
              </span>
              <ChevronDown
                className={cn('size-4 shrink-0 text-attenue-texte transition-transform', deplie && 'rotate-180')}
              />
            </button>

            {deplie && (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 bg-attenue px-3 pb-3 pt-1 text-[12px]">
                <D t="Fournisseur" v={l.fournisseur_nom ?? '—'} />
                {magasins.map((m) => (
                  <D
                    key={m.code}
                    t={m.nom}
                    v={`${nb(l.par_magasin?.[m.code] ?? 0)} kg`}
                    Icone={Warehouse}
                  />
                ))}
                {(l.machines_kg ?? 0) > 0 && (
                  <D
                    t={`Machines (${l.nb_machines})`}
                    v={`${nb(l.machines_kg)} kg · ${l.machines_bobines} bob.`}
                    Icone={Cog}
                  />
                )}
                {l.palettes != null && (
                  <D
                    t="Comptage"
                    v={`${nb(l.palettes, 2)} palette(s) · ${nb(l.bobines, 0)} bobine(s)`}
                    Icone={Boxes}
                  />
                )}
                <D t="Disponible" v={`${nb(l.disponible_kg)} kg`} />
                <D t="Stock minimum" v={`${nb(l.stock_min_kg)} kg`} />
                <D t="Couverture" v={`${nb(l.jours_couverture, 0)} j`} />
                <D t="Conso mensuelle" v={`${nb(l.conso_mensuelle_kg)} kg`} />
                <D t="En commande" v={`${nb(l.encours_kg)} kg`} />
                <D t="CMUP" v={`${nb(l.cmup_mad, 2)} MAD`} />
                <D t="Valeur" v={`${nb(l.valeur_mad)} MAD`} />
                {(l.a_commander_kg ?? 0) > 0 && (
                  <D t="A commander" v={`${nb(l.a_commander_kg)} kg`} alerte />
                )}
                {l.jours_sans_mouvement != null && (
                  <D t="Sans mouvement" v={`${l.jours_sans_mouvement} j`} />
                )}
                {(l.nb_equivalents ?? 0) > 0 && (
                  <D t="Equivalents" v={String(l.nb_equivalents)} />
                )}
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )
}

function D({
  t, v, alerte, Icone,
}: { t: string; v: string; alerte?: boolean; Icone?: typeof Cog }) {
  return (
    <>
      <dt className="flex items-center gap-1 text-attenue-texte">
        {Icone && <Icone className="size-3" />}
        {t}
      </dt>
      <dd className={cn('text-right tabular-nums', alerte ? 'font-medium text-danger' : 'text-texte')}>
        {v}
      </dd>
    </>
  )
}

// =============================================================================
// L'EXPORT
// =============================================================================

/**
 * Un CSV point-virgule, encode avec sa marque d'octets.
 *
 * Sans le BOM, Excel en francais lit l'UTF-8 comme du latin-1 et affiche
 * « Ã© » partout. C'est le detail qui fait dire qu'un export ne marche pas.
 */
function exporter(lignes: LigneStock[], magasins: { code: string; nom: string }[]) {
  const entetes = [
    'Code', 'Designation', 'Categorie', 'Fournisseur', 'Unite',
    'Stock global kg', ...magasins.map((m) => `${m.nom} kg`), 'Machines kg', 'Machines bobines',
    'Palettes', 'Bobines', 'Kg par palette',
    'Disponible kg', 'Quarantaine kg', 'En commande kg', 'Besoin 12m kg', 'Stock projete kg',
    'Stock min kg', 'Conso mens. kg', 'Couverture j', 'Delai j', 'Statut', 'Sous minimum', 'ABC', 'XYZ',
    'CMUP MAD', 'Prix catalogue', 'Devise', 'Valeur MAD', 'A commander kg',
    'Derniere sortie', 'Jours sans mvt', 'Equivalents',
  ]
  const cellule = (v: unknown) =>
    v == null ? '' : String(v).includes(';') ? `"${String(v).replace(/"/g, '""')}"` : String(v)

  const corps = lignes.map((l) =>
    [
      l.code_reference, l.designation, l.categorie, l.fournisseur_nom, l.unite,
      l.stock_global_kg, ...magasins.map((m) => l.par_magasin?.[m.code] ?? 0),
      l.machines_kg, l.machines_bobines,
      l.palettes, l.bobines, l.kg_par_palette,
      l.disponible_kg, l.quarantaine_kg, l.encours_kg, l.besoin_12m_kg, l.stock_projete_kg,
      l.stock_min_kg, l.conso_mensuelle_kg, l.jours_couverture, l.delai_livraison_jours,
      l.statut, l.sous_minimum ? 'OUI' : 'NON', l.classe_abc, l.classe_xyz,
      l.cmup_mad, l.prix_catalogue_kg, l.devise, l.valeur_mad, l.a_commander_kg,
      l.derniere_sortie?.slice(0, 10), l.jours_sans_mouvement, l.nb_equivalents,
    ]
      .map(cellule)
      .join(';'),
  )

  const csv = '﻿' + [entetes.join(';'), ...corps].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `etat-des-stocks-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

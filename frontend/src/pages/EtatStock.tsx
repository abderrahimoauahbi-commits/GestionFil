/**
 * Etat de stock physique.
 *
 * Ce que contiennent reellement les magasins, ici et maintenant — a ne pas
 * confondre avec l'ecran « Stock projete », qui montre une projection MRP
 * agregee par reference. Les deux repondent a des questions differentes :
 *
 *   Stock projete  →  « vais-je manquer, et quand ? »        (planificateur)
 *   Etat de stock  →  « qu'y a-t-il dans MP-01, maintenant ? » (magasinier)
 *
 * Confondre les deux fait chercher dans le mauvais ecran. C'est pourquoi le
 * titre et le sous-titre le disent explicitement.
 *
 * Les magasins vides sont affiches, pas masques : savoir qu'un magasin est a
 * zero est une information, et un magasin absent de la liste se lit comme un
 * magasin qui n'existe pas.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Coins, Warehouse } from 'lucide-react'
import { api } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Badge, Squelette } from '../composants/ui/base'
import { BarresRangees } from '../composants/graphiques/Graphiques'
import { BarreFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { cn, fmt } from '../lib/utils'

interface LigneStock {
  id_stock: string
  code_magasin: string
  magasin_nom: string | null
  code_reference: string
  designation: string | null
  quantite_kg: number | null
  cmup_mad: number | null
  valeur_mad: number | null
  inclure_mrp: number | null
  date_derniere_entree: string | null
  date_derniere_sortie: string | null
  date_dernier_inventaire: string | null
  /* Nombre de magasins portant du stock pour cette reference. Pose par la
     consolidation ; toujours 1 quand on regarde un magasin precis. */
  nb_magasins: number
  /* `TableDroits` filtre ses colonnes par la grille de droits, ce qui suppose
     une ligne indexable par nom de champ. */
  [k: string]: unknown
}

interface Magasin {
  code_magasin: string
  nom: string | null
  est_quarantaine: number | null
  inclure_mrp: number | null
  actif: number | null
}

/* Les axes de filtrage vivent dans la barre laterale, comme sur les autres
   ecrans de consultation. Les valeurs sortent des lignes chargees. */
const CHAMPS_STOCK: ChampFiltre<LigneStock>[] = [
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (l) => l.code_magasin },
  { cle: 'reference', libelle: 'Reference', type: 'texte', valeur: (l) => l.code_reference },
  { cle: 'designation', libelle: 'Designation', type: 'texte', valeur: (l) => l.designation },
]

export function EtatStock() {
  const { peut } = useAuth()
  const droits = useDroits('STOCK')
  const [avecStock, setAvecStock] = useState(true)
  const filtres = useFiltres(CHAMPS_STOCK)
  const magasin = (filtres.valeurs.magasin as string) ?? ''
  const setMagasin = (v: string) => filtres.definir('magasin', v)

  const qStock = useQuery({
    queryKey: ['etat-stock'],
    queryFn: () => api.get<LigneStock[]>('/api/stock?limite=5000'),
    enabled: peut('STOCK', 'LIRE'),
  })
  const qMagasins = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: () => api.get<Magasin[]>('/api/magasins?actif=1'),
    staleTime: 10 * 60_000,
  })

  const lignes = qStock.data ?? []
  const magasins = qMagasins.data ?? []

  /* Totaux par magasin, y compris ceux qui n'ont rien. */
  const parMagasin = useMemo(() => {
    const acc = new Map<string, { kg: number; valeur: number; refs: number }>()
    for (const m of magasins) acc.set(m.code_magasin, { kg: 0, valeur: 0, refs: 0 })
    for (const l of lignes) {
      const e = acc.get(l.code_magasin) ?? { kg: 0, valeur: 0, refs: 0 }
      const kg = l.quantite_kg ?? 0
      e.kg += kg
      e.valeur += l.valeur_mad ?? 0
      if (kg !== 0) e.refs += 1
      acc.set(l.code_magasin, e)
    }
    return magasins.map((m) => ({
      ...m,
      ...(acc.get(m.code_magasin) ?? { kg: 0, valeur: 0, refs: 0 }),
    }))
  }, [lignes, magasins])

  const total = useMemo(
    () => ({
      kg: lignes.reduce((s, l) => s + (l.quantite_kg ?? 0), 0),
      valeur: lignes.reduce((s, l) => s + (l.valeur_mad ?? 0), 0),
      refs: new Set(lignes.filter((l) => (l.quantite_kg ?? 0) !== 0).map((l) => l.code_reference))
        .size,
      sansValeur: lignes.filter((l) => (l.quantite_kg ?? 0) > 0 && l.cmup_mad == null).length,
    }),
    [lignes],
  )

  /**
   * Lignes affichees.
   *
   * Sans magasin selectionne, la position est **consolidee par reference** :
   * un etat global qui listerait une ligne par couple reference-magasin ferait
   * apparaitre la meme reference plusieurs fois, et ne serait pas une position
   * globale mais une liste d'emplacements. Des qu'un magasin est choisi, on
   * redescend au detail de ce magasin.
   */
  const visibles = useMemo(() => {
    const retenues = lignes.filter(filtres.retenir)

    if (magasin) {
      return retenues
        .filter((l) => !avecStock || (l.quantite_kg ?? 0) !== 0)
        .map((l) => ({ ...l, nb_magasins: 1 }))
        .sort((a, b) => (b.valeur_mad ?? 0) - (a.valeur_mad ?? 0))
    }

    const parRef = new Map<string, LigneStock>()
    for (const l of retenues) {
      const e = parRef.get(l.code_reference)
      if (!e) {
        parRef.set(l.code_reference, { ...l, nb_magasins: (l.quantite_kg ?? 0) !== 0 ? 1 : 0 })
        continue
      }
      e.quantite_kg = (e.quantite_kg ?? 0) + (l.quantite_kg ?? 0)
      e.valeur_mad = (e.valeur_mad ?? 0) + (l.valeur_mad ?? 0)
      if ((l.quantite_kg ?? 0) !== 0) e.nb_magasins += 1
      // On garde la date la plus recente de chaque nature.
      for (const c of ['date_derniere_entree', 'date_derniere_sortie', 'date_dernier_inventaire'] as const) {
        if ((l[c] ?? '') > (e[c] ?? '')) e[c] = l[c]
      }
    }
    return [...parRef.values()]
      .filter((l) => !avecStock || (l.quantite_kg ?? 0) !== 0)
      .sort((a, b) => (b.valeur_mad ?? 0) - (a.valeur_mad ?? 0))
  }, [lignes, magasin, filtres, avecStock])

  /* Les colonnes du detail. Declarees ici plutot qu'en constante : deux
     d'entre elles changent de libelle selon qu'on regarde un magasin ou la
     consolidation, et le champ `magasin` porte la mention « n magasins » qui
     n'a de sens que consolidee. */
  const colonnes: Colonne<LigneStock>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => <span className="font-mono">{l.code_reference}</span>,
    },
    {
      champ: 'designation',
      entete: 'Designation',
      rendu: (l) => <span className="text-attenue-texte">{l.designation ?? '—'}</span>,
    },
    {
      champ: 'code_magasin',
      entete: magasin ? 'Magasin' : 'Magasins',
      rendu: (l) =>
        !magasin && l.nb_magasins > 1 ? (
          // Une reference eclatee sur plusieurs magasins merite d'etre
          // signalee : c'est la que naissent les erreurs de picking.
          <Badge ton="info">{l.nb_magasins} magasins</Badge>
        ) : (
          <span className="font-mono">{l.code_magasin}</span>
        ),
    },
    {
      champ: 'quantite_kg',
      entete: 'Quantite (kg)',
      numerique: true,
      rendu: (l) => fmt.nombre(l.quantite_kg ?? 0),
    },
    {
      champ: 'cmup_mad',
      entete: 'CMUP',
      numerique: true,
      rendu: (l) =>
        l.cmup_mad != null ? (
          fmt.nombre(l.cmup_mad)
        ) : (
          <span className="inline-flex items-center gap-1 text-alerte">
            <AlertTriangle className="size-3" />—
          </span>
        ),
    },
    {
      champ: 'valeur_mad',
      entete: 'Valeur (MAD)',
      numerique: true,
      rendu: (l) => (l.valeur_mad != null ? fmt.nombre(Math.round(l.valeur_mad)) : '—'),
    },
    {
      champ: 'date_derniere_entree',
      entete: 'Derniere entree',
      secondaire: true,
      rendu: (l) => l.date_derniere_entree?.slice(0, 10) ?? '—',
    },
    {
      champ: 'date_derniere_sortie',
      entete: 'Derniere sortie',
      secondaire: true,
      rendu: (l) => l.date_derniere_sortie?.slice(0, 10) ?? '—',
    },
    {
      champ: 'date_dernier_inventaire',
      entete: 'Dernier inventaire',
      secondaire: true,
      rendu: (l) =>
        l.date_dernier_inventaire?.slice(0, 10) ?? <span className="text-alerte">jamais</span>,
    },
  ]

  if (qStock.isLoading) return <Squelette className="h-96 w-full" />

  return (
    <>
      <EnTetePage
        titre="Etat de stock"
        description={
          magasin
            ? `Detail du magasin ${magasin} — la projection MRP est sur l'ecran Stock projete`
            : "Position consolidee tous magasins — cliquer un magasin pour son detail"
        }
      />

      {/* LES FILTRES SONT AU-DESSUS DU TABLEAU, plus a sa gauche : le rail
          prenait un quart de la largeur, et partait a l'impression. */}
      <BarreFiltres
        champs={CHAMPS_STOCK}
        lignes={lignes}
        valeurs={filtres.valeurs}
        definir={filtres.definir}
        reinitialiser={filtres.reinitialiser}
        actifs={filtres.actifs}
        enPied={
          <button
            type="button"
            onClick={() => setAvecStock((v) => !v)}
            aria-pressed={avecStock}
            className={cn(
              'mb-0.5 rounded-[3px] border px-2 py-1 text-[11px] transition-colors',
              avecStock
                ? 'border-primaire bg-primaire text-primaire-texte'
                : 'border-bordure text-attenue-texte hover:bg-attenue',
            )}
          >
            Avec stock seulement
          </button>
        }
      />

      {/* --- Position globale, avant tout detail -------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Chiffre Icone={Boxes} libelle="Quantite totale" valeur={`${fmt.nombre(Math.round(total.kg))} kg`} />
        <Chiffre libelle="References en stock" valeur={String(total.refs)} />
        {droits.visible('valeur_mad') && (
          <Chiffre
            Icone={Coins}
            libelle="Valeur totale"
            valeur={`${fmt.nombre(Math.round(total.valeur))} MAD`}
          />
        )}
        <Chiffre libelle="Magasins actifs" valeur={String(magasins.length)} />
      </div>

      {/* --- Magasins : le filtre par emplacement ------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {parMagasin.map((m) => {
          const actif = magasin === m.code_magasin
          const vide = m.kg === 0
          return (
            <button
              key={m.code_magasin}
              type="button"
              onClick={() => setMagasin(actif ? '' : m.code_magasin)}
              aria-pressed={actif}
              className={cn(
                'flex flex-col gap-1 rounded-[var(--radius)] border p-3 text-left transition-colors',
                actif
                  ? 'border-primaire bg-attenue'
                  : 'border-bordure bg-surface hover:bg-attenue/60',
              )}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
                <Warehouse className="size-3.5" />
                <span className="truncate font-mono">{m.code_magasin}</span>
                {m.est_quarantaine === 1 && <Badge ton="alerte">quarantaine</Badge>}
              </span>
              <span className="truncate text-[12px] text-texte">{m.nom ?? '—'}</span>
              <span
                className={cn(
                  'text-[19px] font-semibold tabular-nums leading-tight',
                  vide ? 'text-attenue-texte' : 'text-texte',
                )}
              >
                {fmt.nombre(Math.round(m.kg))} <span className="text-[11px]">kg</span>
              </span>
              <span className="text-[11px] text-attenue-texte">
                {vide ? 'aucun stock' : `${m.refs} references`}
                {droits.visible('valeur_mad') && !vide && (
                  <> · {fmt.nombre(Math.round(m.valeur))} MAD</>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* --- Ce que le magasin de quarantaine implique --------------------- */}
      {parMagasin.some((m) => m.est_quarantaine === 1 && m.kg > 0) && (
        <Alerte ton="alerte" titre="Du stock est en quarantaine">
          Les quantites en zone de quarantaine sont exclues du calcul des besoins : elles existent
          physiquement, mais le MRP ne compte pas dessus tant que le controle qualite n'a pas
          tranche.
        </Alerte>
      )}

      {total.sansValeur > 0 && droits.visible('valeur_mad') && (
        <Alerte ton="alerte" titre="Une partie du stock n'est pas valorisee">
          {total.sansValeur} ligne{total.sansValeur > 1 ? 's portent' : ' porte'} du stock sans
          CMUP : aucune reception valorisee n'a eu lieu sur ces references. Elles comptent en kilos,
          pas en dirhams — la valeur totale est donc un plancher.
        </Alerte>
      )}

      {droits.visible('valeur_mad') && visibles.length > 0 && (
        <BarresRangees
          titre={magasin ? `Ou dort la valeur dans ${magasin}` : 'Ou dort la valeur'}
          sousTitre="References les plus lourdes en valeur immobilisee"
          unite="MAD"
          donnees={visibles
            .filter((l) => (l.valeur_mad ?? 0) > 0)
            .map((l) => ({
              cle: l.id_stock,
              libelle: l.code_reference,
              valeur: l.valeur_mad as number,
            }))}
        />
      )}

      {/* --- Detail -------------------------------------------------------
          UN TABLEAU A LA MAIN NE SAIT NI PAGINER, NI EXPORTER, NI S'IMPRIMER.
          Celui-ci alignait toutes les lignes d'un coup : sur trois cents
          references c'est deja long, et il n'y avait aucun moyen d'en sortir un
          etat. `TableDroits` apporte les trois, et applique en plus la grille
          de droits par colonne — le magasinier ne voit ni CMUP ni valeur, sans
          qu'on ait a le redire ici. */}
      <TableDroits
        exportable="etat-de-stock"
        imprimable={magasin ? `Etat de stock — ${magasin}` : 'Etat de stock consolide'}
        module="STOCK"
        colonnes={colonnes}
        lignes={visibles}
        cle={(l) => l.id_stock}
        titreCarte={(l) => l.code_reference}
        texteVide="Aucune ligne de stock."
      />

    </>
  )
}

function Chiffre({
  Icone,
  libelle,
  valeur,
}: {
  Icone?: React.ComponentType<{ className?: string }>
  libelle: string
  valeur: string
}) {
  return (
    <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
        {Icone && <Icone className="size-3.5" />}
        {libelle}
      </div>
      <div className="mt-0.5 text-[19px] font-semibold tabular-nums leading-tight text-texte">
        {valeur}
      </div>
    </div>
  )
}

/**
 * LA LISTE DU MOTEUR DE COUVERTURE — une rangée par référence : l'onglet « À
 * commander » du plan d'achat et, la MÊME, le volet « Surveillance / Alertes »
 * du stock projeté (décision du 27/10/2026 : un seul tableau, une seule
 * fenêtre de détail).
 *
 * Elle LIT `GET /api/couverture` : la proposition est calculée par le moteur, la
 * décision reste au directeur. « Commander » (au plan d'achat seulement)
 * régénère la proposition d'achat de la référence depuis ce même moteur.
 *
 * L'ordre (27/10/2026) : la première rupture la plus proche d'abord (une rupture
 * aujourd'hui en tête, sans rupture en dernier), puis la date limite de commande.
 * Une référence sans plan ni stock mais avec un arrivage, même hors couverture,
 * est listée, ses kilos hors couverture sur la ligne ↳.
 *
 * Vocabulaire tenu : un déficit est un « plan non couvert à partir du … », jamais
 * une dette ; le manque d'une rupture inévitable est affiché, jamais commandé.
 * Les colonnes sont celles d'avant le moteur v2 (décision du 27/10/2026) : seuls
 * l'état et les valeurs viennent du v2 ; le reste est dans la fenêtre de détail.
 *
 * Une ligne ↳ d'information seulement quand quelque chose est compté à part (fil
 * sur métiers, restes, fil en route à sa date), laissé hors couverture
 * (quarantaine, bloqué, en retard, sans date), ou qu'un défaut de données a
 * imposé un réglage par défaut. LE DÉTAIL NE SE DÉPLIE PLUS SOUS LA LIGNE : le
 * clic ouvre la grande fenêtre (`ModaleReference`).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CornerDownRight, Maximize2, ShoppingCart } from 'lucide-react'
import { api } from '../../api/client'
import { DataTable, type ColonneDT } from '../DataTable'
import { BarreFiltres, useFiltres, type ChampFiltre } from '../PanneauFiltres'
import { Alerte, Bouton, Chargement } from '../ui/base'
import { cn, fmt } from '../../lib/utils'
import { ModaleReference } from './ModaleCouverture'
import {
  dateCourte,
  dateListe,
  designationUtile,
  joursEntre,
  kg,
  plusJours,
  positif,
  source,
  type LigneCouverture,
  type ListeCouverture as ReponseListe,
} from './types'

const MODULE = 'PLAN_ACHAT'

/** Ce que la ligne ↳ dit : compté à part, non compté, hors couverture. */
function partsInformation(l: LigneCouverture) {
  const dont = [
    positif(l.machine_kg) && `sur métiers ${kg(l.machine_kg)} kg`,
    positif(l.restes_kg) && `restes ${kg(l.restes_kg)} kg`,
  ].filter(Boolean) as string[]
  // Le fil en route est un arrivage compté à sa date (27/10/2026) : dit à part.
  const enRoute = positif(l.transit_kg) ? `en route ${kg(l.transit_kg)} kg, compté à sa date` : null
  const nonComptes = [
    positif(l.quarantaine_kg) && `quarantaine ${kg(l.quarantaine_kg)} kg`,
    positif(l.bloque_kg) && `bloqué ${kg(l.bloque_kg)} kg`,
    positif(l.hors_plan_kg) && `magasins hors plan ${kg(l.hors_plan_kg)} kg`,
  ].filter(Boolean) as string[]
  const horsCouverture = [
    positif(l.en_retard_kg) && `en retard ${kg(l.en_retard_kg)} kg`,
    positif(l.sans_date_kg) && `sans date ${kg(l.sans_date_kg)} kg`,
    positif(l.non_valide_kg) && `bons non validés ${kg(l.non_valide_kg)} kg`,
    positif(l.apres_horizon_kg) && `après l’horizon ${kg(l.apres_horizon_kg)} kg`,
  ].filter(Boolean) as string[]
  const defaut = l.defaut_donnees ?? null
  const vide = !dont.length && !nonComptes.length && !horsCouverture.length && !enRoute && !defaut
  return { dont, enRoute, nonComptes, horsCouverture, defaut, vide }
}

/** La ligne ↳ d'information : seulement quand quelque chose est compté à part ou laissé hors couverture. */
function LigneInformation({ l }: { l: LigneCouverture }) {
  const { dont, enRoute, nonComptes, horsCouverture, defaut, vide } = partsInformation(l)
  if (vide) return null
  return (
    <div className="-my-1 flex items-baseline gap-2 text-[12px] text-attenue-texte">
      <CornerDownRight aria-label="information sur la ligne" className="size-3.5 shrink-0 translate-y-0.5" />
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
        {defaut && <span className="text-alerte">défaut de données : {defaut}</span>}
        {dont.length > 0 && <span>dont {dont.join(', ')}</span>}
        {enRoute && <span>{enRoute}</span>}
        {nonComptes.length > 0 && <span>non compté : {nonComptes.join(', ')}</span>}
        {horsCouverture.length > 0 && <span>hors couverture : {horsCouverture.join(', ')}</span>}
      </div>
    </div>
  )
}

export function ListeCouverture({
  commander,
  enCommande,
  enrichi = false,
  surSimuler,
  exportable = 'plan-achat-a-commander',
}: {
  /** « Commander » : la proposition de la référence part dans les lignes à commander. Absent : lecture seule. */
  commander?: (l: LigneCouverture) => void
  /** La référence dont la commande se prépare (bouton en attente). */
  enCommande?: string | null
  /** La fenêtre de détail enrichie du stock projeté. */
  enrichi?: boolean
  /** Ouvre l'espace « Simulation » sur une référence (stock projeté). */
  surSimuler?: (reference: string) => void
  /** Le nom du fichier d'export. */
  exportable?: string
} = {}) {
  const q = useQuery({
    queryKey: ['couverture'],
    queryFn: ({ signal }) => api.get<ReponseListe>('/api/couverture', { signal }),
    staleTime: 60_000,
  })
  // La référence dont la grande fenêtre est ouverte.
  const [ouverte, setOuverte] = useState<LigneCouverture | null>(null)

  const aujourdhui = q.data?.aujourdhui ?? new Date().toISOString().slice(0, 10)
  const lignes = useMemo(() => q.data?.lignes ?? [], [q.data])

  /* Les filtres de toujours (BarreFiltres) : valeurs déduites des lignes. */
  const champs = useMemo<ChampFiltre<LigneCouverture>[]>(
    () => [
      { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', recherche: true, valeur: (l) => l.fournisseur_nom ?? null },
      {
        cle: 'proposition',
        libelle: 'Proposition',
        type: 'liste',
        valeur: (l) => (positif(l.qte_a_commander_kg) ? 'Avec proposition' : 'Sans proposition'),
      },
      {
        cle: 'couverture',
        libelle: 'Plan non couvert',
        type: 'liste',
        valeur: (l) =>
          !l.premiere_rupture
            ? 'Couvert sur l’horizon'
            : l.premiere_rupture < plusJours(aujourdhui, l.delai_j ?? 0)
              ? 'Avant aujourd’hui + délai'
              : 'Après aujourd’hui + délai',
      },
    ],
    [aujourdhui],
  )
  const filtres = useFiltres<LigneCouverture>(champs)
  const filtrees = useMemo(() => lignes.filter(filtres.retenir), [lignes, filtres.retenir])

  const colonnes: ColonneDT<LigneCouverture>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      // La recherche du tableau porte aussi sur la désignation et le fournisseur.
      valeurTri: (l) => [l.code_reference, l.designation, l.fournisseur_nom].filter(Boolean).join(' '),
      // Le bouton du détail vit dans la cellule : une colonne de moins, la ligne
      // tient à 1366 px ; au clavier, il ouvre la fenêtre comme le clic sur la ligne.
      rendu: (l) => {
        const suite = [designationUtile(l), l.fournisseur_nom].filter(Boolean).join(' · ')
        return (
          <div className="flex max-w-[15rem] items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOuverte(l)
              }}
              aria-label={`Détail de ${l.code_reference}`}
              aria-haspopup="dialog"
              className="-ml-1 shrink-0 rounded p-0.5 text-attenue-texte hover:bg-attenue"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <div className="min-w-0 truncate" title={[l.code_reference, suite].filter(Boolean).join(' — ')}>
              <span className="font-medium">{l.code_reference}</span>
              {suite && <span className="text-[11.5px] text-attenue-texte"> — {suite}</span>}
            </div>
          </div>
        )
      },
    },
    {
      champ: 'disponible_kg',
      entete: 'Disponible',
      numerique: true,
      largeur: '84px',
      rendu: (l) => (
        <span title="Magasins comptés et fil sur métiers, aujourd’hui">{kg(l.disponible_kg)}</span>
      ),
    },
    {
      champ: 'couvert_jusqu_au',
      entete: 'Couvert jusqu’au',
      largeur: '96px',
      valeurTri: (l) => (l.couvert_tout_horizon ? '9999' : l.couvert_jusqu_au ?? '0000'),
      rendu: (l) =>
        l.couvert_tout_horizon ? (
          <span className="text-succes" title={`Jusqu’au ${dateCourte(l.couvert_jusqu_au)}, fin de l’horizon`}>
            tout l’horizon
          </span>
        ) : l.couvert_jusqu_au ? (
          <span className="tabular-nums">{dateListe(l.couvert_jusqu_au)}</span>
        ) : l.premiere_rupture ? (
          <span className="text-danger">non couvert</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'prochain_arrivage_date',
      entete: 'Prochain arrivage',
      largeur: '130px',
      rendu: (l) =>
        l.prochain_arrivage_date ? (
          <span className="tabular-nums">
            {dateListe(l.prochain_arrivage_date)}
            {typeof l.prochain_arrivage_kg === 'number' && (
              <span className="text-attenue-texte"> · {kg(l.prochain_arrivage_kg)} kg</span>
            )}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'premiere_rupture',
      entete: '1re rupture',
      largeur: '90px',
      rendu: (l) =>
        l.premiere_rupture ? (
          <span
            className={cn(
              'tabular-nums',
              l.premiere_rupture < plusJours(aujourdhui, l.delai_j ?? 0) ? 'font-medium text-danger' : 'text-alerte',
            )}
            title={`Plan non couvert à partir du ${dateCourte(l.premiere_rupture)}`}
          >
            {dateListe(l.premiere_rupture)}
          </span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'plan_non_couvert_kg',
      entete: 'Plan non couvert',
      numerique: true,
      largeur: '96px',
      rendu: (l) =>
        positif(l.plan_non_couvert_kg) ? (
          <span className="text-danger">{kg(l.plan_non_couvert_kg)}</span>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      champ: 'delai_j',
      entete: 'Délai',
      numerique: true,
      largeur: '56px',
      rendu: (l) =>
        typeof l.delai_j === 'number' ? (
          <span className="text-attenue-texte" title={`Délai fournisseur, pour information${source(l.source_delai)}`}>
            {l.delai_j} j
          </span>
        ) : (
          '—'
        ),
    },
    {
      champ: 'qte_a_commander_kg',
      entete: 'Proposition',
      numerique: true,
      largeur: '140px',
      rendu: (l) =>
        positif(l.qte_a_commander_kg) ? (
          <span>
            <span className="font-semibold">{kg(l.qte_a_commander_kg)} kg</span>
            {typeof l.palettes_equivalentes === 'number' && (
              <span className="text-[11.5px] text-attenue-texte"> ≈ {fmt.nombre(l.palettes_equivalentes, 1)} pal.</span>
            )}
          </span>
        ) : (
          <span className="text-attenue-texte" title={l.motif_sans_proposition ?? undefined}>
            rien
          </span>
        ),
    },
    {
      champ: 'date_limite_commande',
      entete: 'Avant le',
      largeur: '84px',
      rendu: (l) => {
        if (!l.date_limite_commande) return <span className="text-attenue-texte">—</span>
        const reste = joursEntre(aujourdhui, l.date_limite_commande)
        return (
          <span
            className={cn('tabular-nums', reste < 0 ? 'font-medium text-danger' : reste <= 7 ? 'text-alerte' : '')}
            title={`À commander avant le ${dateCourte(l.date_limite_commande)} — ${reste < 0 ? `date dépassée de ${-reste} j` : reste === 0 ? 'aujourd’hui' : `dans ${reste} j`}`}
          >
            {dateListe(l.date_limite_commande)}
          </span>
        )
      },
    },
  ]

  if (q.isLoading) return <Chargement />

  const d = q.data
  return (
    <div>
      {d && !d.plan && (
        <div className="mb-3">
          <Alerte ton="alerte" titre="Aucun plan de production en service">
            Sans plan en service, il n’y a ni horizon ni consommation prévue : rien ne se projette.
          </Alerte>
        </div>
      )}
      {d?.plan && (
        <p className="mb-2 text-[12px] text-attenue-texte">
          {d.plan.libelle ?? 'Plan en service'} · horizon jusqu’au {dateCourte(d.fin_horizon)}
          {d.plan.date_photo_mrp && <> · photo du besoin du {dateCourte(d.plan.date_photo_mrp)}</>}
          {' '}· projection depuis le {dateCourte(d.aujourdhui)}
        </p>
      )}
      {(d?.regles_provisoires?.length ?? 0) > 0 && (
        <details className="mb-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-1.5 text-[12px]">
          <summary className="cursor-pointer select-none text-attenue-texte hover:text-texte">
            Règles des dates d’arrivage, de la fenêtre et des réglages par défaut
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-attenue-texte">
            {d!.regles_provisoires!.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}

      <BarreFiltres
        champs={champs}
        lignes={lignes}
        valeurs={filtres.valeurs}
        definir={filtres.definir}
        reinitialiser={filtres.reinitialiser}
        actifs={filtres.actifs}
      />

      <DataTable<LigneCouverture>
        module={MODULE}
        exportable={exportable}
        colonnes={colonnes}
        lignes={filtrees}
        erreur={q.error}
        cle={(l) => l.code_reference}
        surClic={(l) => setOuverte(l)}
        titreCarte={(l) => [l.code_reference, designationUtile(l), l.fournisseur_nom].filter(Boolean).join(' — ')}
        placeholderRecherche="Référence, désignation, fournisseur..."
        tailleParDefaut={50}
        videTitre="Aucune référence"
        videDescription="Aucune référence n’a de demande au plan en service, de stock ni d’arrivage."
        actions={
          commander
            ? (l) =>
                positif(l.qte_a_commander_kg) && l.actif !== false ? (
                  // Icône seule sous 1536 px : la ligne garde sa date limite à 1366 px.
                  <Bouton
                    taille="xs"
                    variante="contour"
                    className="px-1.5 2xl:px-2"
                    chargement={enCommande === l.code_reference}
                    disabled={!!enCommande && enCommande !== l.code_reference}
                    onClick={(e) => {
                      e.stopPropagation()
                      commander(l)
                    }}
                    aria-label={`Commander ${l.code_reference}`}
                    title="Préparer la commande : la proposition s’ouvre dans les lignes à commander, en kg ou en palettes"
                  >
                    <ShoppingCart />
                    <span className="hidden 2xl:inline">Commander</span>
                  </Bouton>
                ) : null
            : undefined
        }
        detail={(l) => (partsInformation(l).vide ? null : <LigneInformation l={l} />)}
      />
      <ModaleReference
        reference={ouverte?.code_reference ?? null}
        designation={ouverte?.designation}
        surFermer={() => setOuverte(null)}
        enrichi={enrichi}
        surSimuler={surSimuler}
      />
    </div>
  )
}


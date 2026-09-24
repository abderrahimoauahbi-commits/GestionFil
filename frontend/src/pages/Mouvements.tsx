/**
 * Grand livre des mouvements et saisie.
 *
 * Concu tablette d'abord : c'est un ecran de magasin. La quantite se saisit
 * dans l'unite de manutention (bobine, palette, ml) et la conversion vers le kg
 * est affichee AVANT validation — l'operateur doit voir ce qui va reellement
 * entrer en stock.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  PanneauFiltres,
  useFiltres,
  type ChampFiltre,
} from '../composants/PanneauFiltres'

import { TableDroits, type Colonne } from '../components/TableDroits'
import { Bouton, Etiquette, fmt } from '../components/ui'
import { useEtatDepuisParam } from '../lib/navigation'

const MODULE = 'MOUVEMENTS'

interface LigneLivre extends Record<string, unknown> {
  numero_mouvement: string
  date_mouvement: string
  code_type_mvt: string
  code_magasin: string
  code_reference: string
  quantite_kg: number
  prix_kg_mad?: number | null
  total_mad?: number
  lot_fournisseur: string | null
  numero_of: string | null
  utilisateur: string
  signe: number
}

/**
 * Le grand livre est immuable : on ne le corrige pas, on l'interroge.
 *
 * Les valeurs des listes sortent des lignes affichees : un magasin sans
 * mouvement ne figure pas au filtre, puisque le choisir ne montrerait rien.
 */
interface DocMouvement extends Record<string, unknown> {
  id_mouvement: string
  numero_mouvement: string
  date_mouvement: string
  date_creation?: string
  jours_de_retard_saisie?: number
  code_type_mvt: string
  type_libelle?: string
  signe: number
  code_magasin: string
  magasin_nom?: string
  motif_libelle?: string
  reference_document?: string | null
  numero_of?: string | null
  responsable?: string | null
  saisi_par?: string
  nb_lignes: number
  nb_references: number
  quantite_totale_kg: number
  bobines_totales?: number
  palettes_totales?: number
  valeur_totale_mad?: number
  rebut_kg?: number
}

const CHAMPS_DOC: ChampFiltre<DocMouvement>[] = [
  { cle: 'periode', libelle: 'Période', type: 'periode', valeur: (d) => d.date_mouvement },
  { cle: 'type', libelle: 'Type', type: 'liste', valeur: (d) => d.code_type_mvt },
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (d) => d.code_magasin },
  { cle: 'responsable', libelle: 'Responsable', type: 'liste', valeur: (d) => d.responsable },
  { cle: 'saisi_par', libelle: 'Saisi par', type: 'liste', valeur: (d) => d.saisi_par },
  { cle: 'document', libelle: 'Document', type: 'texte', valeur: (d) => d.reference_document },
]

const CHAMPS_MVT: ChampFiltre<LigneLivre>[] = [
  { cle: 'periode', libelle: 'Période', type: 'periode', valeur: (l) => l.date_mouvement },
  { cle: 'type', libelle: 'Type', type: 'liste', valeur: (l) => l.code_type_mvt },
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (l) => l.code_magasin },
  { cle: 'reference', libelle: 'Référence', type: 'liste', valeur: (l) => l.code_reference },
  { cle: 'lot', libelle: 'Lot', type: 'texte', valeur: (l) => l.lot_fournisseur },
  { cle: 'of', libelle: "N° d'OF", type: 'texte', valeur: (l) => l.numero_of },
  { cle: 'utilisateur', libelle: 'Saisi par', type: 'liste', valeur: (l) => l.utilisateur },
]

function ListeDocuments({ filtreRef }: { filtreRef: string }) {
  const navigate = useNavigate()
  const filtres = useFiltres(CHAMPS_DOC)
  const [sens, setSens] = useState('')

  const params = new URLSearchParams({ limite: '300' })
  if (filtreRef) params.set('code_reference', filtreRef)

  const q = useQuery({
    queryKey: ['mouvements-documents', filtreRef],
    queryFn: () => api.get<DocMouvement[]>(`/api/mouvements/documents?${params}`),
  })

  const colonnes: Colonne<DocMouvement>[] = [
    { champ: 'date_mouvement', entete: 'Date', rendu: (d) => fmt.date(d.date_mouvement) },
    {
      champ: 'numero_mouvement',
      entete: 'Numéro',
      rendu: (d) => <span className="font-mono text-xs">{d.numero_mouvement}</span>,
    },
    {
      champ: 'code_type_mvt',
      entete: 'Type',
      rendu: (d) => (
        <Etiquette ton={d.signe > 0 ? 'vert' : 'ambre'}>
          {d.signe > 0 ? '+' : '−'} {d.type_libelle ?? d.code_type_mvt}
        </Etiquette>
      ),
    },
    { champ: 'magasin_nom', entete: 'Magasin', rendu: (d) => d.magasin_nom ?? d.code_magasin },
    {
      champ: 'nb_lignes',
      entete: 'Lignes',
      numerique: true,
      rendu: (d) => (
        <span title={`${d.nb_references} reference(s)`}>{d.nb_lignes}</span>
      ),
    },
    {
      champ: 'quantite_totale_kg',
      entete: 'Total (kg)',
      numerique: true,
      rendu: (d) => (
        <span className={d.signe > 0 ? 'text-emerald-700' : 'text-alerte'}>
          {d.signe > 0 ? '+' : '−'}
          {fmt.nombre(d.quantite_totale_kg, 2)}
        </span>
      ),
    },
    {
      champ: 'palettes_totales',
      entete: 'Palettes',
      numerique: true,
      secondaire: true,
      rendu: (d) => (d.palettes_totales ? fmt.entier(d.palettes_totales) : '—'),
    },
    {
      champ: 'rebut_kg',
      entete: 'Rebut (kg)',
      numerique: true,
      secondaire: true,
      rendu: (d) =>
        d.rebut_kg ? <span className="text-alerte">{fmt.nombre(d.rebut_kg, 2)}</span> : '—',
    },
    {
      champ: 'valeur_totale_mad',
      entete: 'Valeur',
      numerique: true,
      secondaire: true,
      rendu: (d) => (d.valeur_totale_mad ? fmt.mad(d.valeur_totale_mad) : '—'),
    },
    {
      champ: 'responsable',
      entete: 'Responsable',
      rendu: (d) => fmt.texte(d.responsable),
    },
    {
      champ: 'saisi_par',
      entete: 'Saisi par',
      secondaire: true,
      // L'ECART ENTRE LE FAIT ET SA SAISIE se lit ici, pas dans une colonne a
      // part : il n'interesse que lorsqu'il n'est pas nul.
      rendu: (d) => (
        <>
          {d.saisi_par ?? '—'}
          {(d.jours_de_retard_saisie ?? 0) > 0 && (
            <span className="ml-1 text-[11px] text-alerte">+{d.jours_de_retard_saisie} j</span>
          )}
        </>
      ),
    },
    { champ: 'reference_document', entete: 'Document', secondaire: true,
      rendu: (d) => fmt.texte(d.reference_document) },
  ]

  const tous = q.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, d) => {
    const c = d.signe > 0 ? 'ENTREE' : 'SORTIE'
    m[c] = (m[c] ?? 0) + 1
    m[`T:${d.code_type_mvt}`] = (m[`T:${d.code_type_mvt}`] ?? 0) + 1
    return m
  }, {})
  const typesPresents = [...new Set(tous.map((d) => d.code_type_mvt))].sort()

  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les bons', compte: tous.length }] },
    {
      titre: 'Par sens',
      entrees: [
        { cle: 'ENTREE', libelle: 'Entrees', resume: 'Le stock monte',
          compte: comptes.ENTREE ?? 0, ton: 'succes' as const },
        { cle: 'SORTIE', libelle: 'Sorties', resume: 'Le stock descend',
          compte: comptes.SORTIE ?? 0, ton: 'alerte' as const },
      ],
    },
    {
      titre: 'Par type',
      entrees: typesPresents.map((t) => ({
        cle: `T:${t}`,
        libelle: tous.find((d) => d.code_type_mvt === t)?.type_libelle ?? t,
        compte: comptes[`T:${t}`] ?? 0,
      })),
    },
  ]

  const parSens = tous.filter((d) => {
    if (!sens) return true
    if (sens.startsWith('T:')) return d.code_type_mvt === sens.slice(2)
    return sens === 'ENTREE' ? d.signe > 0 : d.signe < 0
  })
  const vues = parSens.filter(filtres.retenir)

  // Les totaux de ce qui est A L'ECRAN, pas de ce que la base contient : c'est
  // la question qu'on se pose apres avoir filtre.
  const totalKg = vues.reduce((s, d) => s + d.signe * (d.quantite_totale_kg ?? 0), 0)
  const totalPalettes = vues.reduce((s, d) => s + (d.palettes_totales ?? 0), 0)

  return (
    <PageAvecRail
      large
      rail={
        <div className="space-y-3">
          <RailLateral groupes={groupes} actif={sens} surChoix={setSens} />
          <PanneauFiltres
            champs={CHAMPS_DOC}
            lignes={parSens}
            valeurs={filtres.valeurs}
            definir={filtres.definir}
            reinitialiser={filtres.reinitialiser}
            actifs={filtres.actifs}
          />
        </div>
      }
    >
      {vues.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-4 text-[12px] text-attenue-texte">
          <span>
            {vues.length} bon(s) sur {tous.length}
          </span>
          <span>
            Solde affiche{' '}
            <strong className={totalKg >= 0 ? 'text-emerald-700' : 'text-alerte'}>
              {fmt.nombre(totalKg, 2)} kg
            </strong>
          </span>
          {totalPalettes > 0 && <span>{fmt.entier(totalPalettes)} palette(s)</span>}
        </div>
      )}
      <TableDroits
        exportable="bons-de-mouvement"
        imprimable="Bons de mouvement"
        module={MODULE}
        colonnes={colonnes}
        lignes={vues}
        chargement={q.isLoading}
        cle={(d) => d.id_mouvement}
        surClic={(d) => navigate(`/mouvements/${d.id_mouvement}`)}
        titreCarte={(d) => `${d.numero_mouvement} · ${d.type_libelle ?? d.code_type_mvt}`}
        texteVide="Aucun mouvement."
      />
    </PageAvecRail>
  )
}

export function Mouvements() {
  const droits = useDroits(MODULE)
  const naviguer = useNavigate()
  // Amorce par `?reference=`, pose par le menu contextuel de l'ecran Stock :
  // « voir l'historique » doit arriver sur le livre DEJA filtre, pas sur les
  // trois cents derniers mouvements tous articles confondus.
  const [filtreRef, setFiltreRef] = useEtatDepuisParam('reference')
  const [sens, setSens] = useState('')
  const filtres = useFiltres(CHAMPS_MVT)

  // DEUX LECTURES DU MEME JOURNAL. « Bons » montre un document par ligne, avec
  // ses totaux : c'est la vue du magasin. « Grand livre » montre une ligne par
  // reference : c'est celle de l'auditeur. Le choix vit dans l'URL, pour qu'un
  // lien partage ouvre la bonne.
  const [vue, setVue] = useEtatDepuisParam('vue')
  const livre = vue === 'livre'

  const params = new URLSearchParams({ limite: '300' })
  if (filtreRef) params.set('code_reference', filtreRef)

  const qLivre = useQuery({
    queryKey: ['mouvements', filtreRef],
    queryFn: () => api.get<LigneLivre[]>(`/api/mouvements?${params}`),
  })

  const colonnes: Colonne<LigneLivre>[] = [
    {
      champ: 'date_mouvement',
      entete: 'Date',
      rendu: (l) => fmt.date(l.date_mouvement),
    },
    {
      champ: 'numero_mouvement',
      entete: 'Numéro',
      rendu: (l) => <span className="font-mono text-xs">{l.numero_mouvement}</span>,
      secondaire: true,
    },
    {
      champ: 'code_type_mvt',
      entete: 'Type',
      rendu: (l) => (
        <Etiquette ton={l.signe > 0 ? 'vert' : 'ambre'}>
          {l.signe > 0 ? '+' : '−'} {l.code_type_mvt}
        </Etiquette>
      ),
    },
    { champ: 'code_reference', entete: 'Référence' },
    { champ: 'code_magasin', entete: 'Magasin' },
    {
      champ: 'quantite_kg',
      entete: 'Quantité (kg)',
      numerique: true,
      rendu: (l) => (
        <span className={l.signe > 0 ? 'text-emerald-700' : 'text-alerte'}>
          {l.signe > 0 ? '+' : '−'}
          {fmt.nombre(l.quantite_kg, 2)}
        </span>
      ),
    },
    {
      champ: 'prix_kg_mad',
      entete: 'Prix (MAD/kg)',
      numerique: true,
      rendu: (l) => (l.prix_kg_mad == null ? '—' : fmt.nombre(l.prix_kg_mad, 4)),
    },
    {
      champ: 'total_mad',
      entete: 'Total',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.total_mad ? fmt.mad(l.total_mad) : '—'),
    },
    { champ: 'lot_fournisseur', entete: 'Lot', rendu: (l) => fmt.texte(l.lot_fournisseur) },
    { champ: 'numero_of', entete: 'OF', rendu: (l) => fmt.texte(l.numero_of), secondaire: true },
    { champ: 'utilisateur', entete: 'Par', secondaire: true },
  ]

  const toutesLignes = qLivre.data ?? []

  // Les compteurs se lisent sur le jeu ramene, avant le rail : ils disent ce que
  // chaque choix montrera, et ne suivent donc pas le choix en cours.
  const comptesMvt = toutesLignes.reduce<Record<string, number>>((m, l) => {
    const c = l.signe > 0 ? 'ENTREE' : 'SORTIE'
    m[c] = (m[c] ?? 0) + 1
    m[`T:${l.code_type_mvt}`] = (m[`T:${l.code_type_mvt}`] ?? 0) + 1
    return m
  }, {})

  const typesPresents = [...new Set(toutesLignes.map((l) => l.code_type_mvt))].sort()

  const groupesMvt: GroupeRail[] = [
    {
      entrees: [
        { cle: '', libelle: 'Tous les mouvements', compte: toutesLignes.length },
      ],
    },
    {
      titre: 'Par sens',
      entrees: [
        {
          cle: 'ENTREE',
          libelle: 'Entrees',
          resume: 'Le stock monte',
          compte: comptesMvt.ENTREE ?? 0,
          ton: 'succes' as const,
        },
        {
          cle: 'SORTIE',
          libelle: 'Sorties',
          resume: 'Le stock descend',
          compte: comptesMvt.SORTIE ?? 0,
          ton: 'alerte' as const,
        },
      ],
    },
    {
      titre: 'Par type',
      entrees: typesPresents.map((t) => ({
        cle: `T:${t}`,
        libelle: t,
        compte: comptesMvt[`T:${t}`] ?? 0,
      })),
    },
  ]

  const lignesSens = toutesLignes.filter((l) => {
    if (!sens) return true
    if (sens.startsWith('T:')) return l.code_type_mvt === sens.slice(2)
    return sens === 'ENTREE' ? l.signe > 0 : l.signe < 0
  })
  const lignesVues = lignesSens.filter(filtres.retenir)

  return (
    <div>
      <EnTetePage
        titre="Mouvements de stock"
        sous_titre="Registre immuable : une correction se fait par un mouvement inverse"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-bordure p-0.5 text-[12px]">
              {[
                { cle: '', libelle: 'Bons' },
                { cle: 'livre', libelle: 'Grand livre' },
              ].map((o) => (
                <button
                  key={o.cle}
                  type="button"
                  onClick={() => setVue(o.cle)}
                  className={
                    'rounded px-2.5 py-1 transition-colors ' +
                    ((o.cle === 'livre') === livre
                      ? 'bg-accent font-medium text-texte'
                      : 'text-attenue-texte hover:text-texte')
                  }
                >
                  {o.libelle}
                </button>
              ))}
            </div>
            {droits.peutEcrire && (
              <Bouton onClick={() => naviguer('/mouvements/nouveau')}>Saisir un mouvement</Bouton>
            )}
          </div>
        }
      />

      {!livre && <ListeDocuments filtreRef={filtreRef} />}

      {livre && (
      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral
              groupes={groupesMvt}
              actif={sens}
              surChoix={setSens}
              recherche={{
                valeur: filtreRef,
                surChangement: setFiltreRef,
                placeholder: 'Référence exacte…',
              }}
            />
            <PanneauFiltres
              champs={CHAMPS_MVT}
              lignes={lignesSens}
              valeurs={filtres.valeurs}
              definir={filtres.definir}
              reinitialiser={filtres.reinitialiser}
              actifs={filtres.actifs}
            />
          </div>
        }
      >
        {(filtres.actifs > 0 || sens) && (
          <div className="mb-2 text-[12px] text-attenue-texte">
            {lignesVues.length} ligne(s) sur {toutesLignes.length} apres filtrage.
          </div>
        )}
        <TableDroits
          exportable="mouvements-de-stock"
          imprimable="Mouvements de stock"
          module={MODULE}
          colonnes={colonnes}
          lignes={lignesVues}
          chargement={qLivre.isLoading}
          cle={(l) => `${l.numero_mouvement}-${l.code_reference}-${l.quantite_kg}`}
          titreCarte={(l) => `${l.code_reference} · ${l.code_type_mvt}`}
          texteVide="Aucun mouvement."
        />
      </PageAvecRail>
      )}

    </div>
  )
}


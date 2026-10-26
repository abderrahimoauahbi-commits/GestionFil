/**
 * La liste des inventaires (13/10/2026), comme celle des bons : brouillon,
 * validé, clôturé, annulé. Chaque inventaire s'ouvre sur sa propre page
 * (en-tête et lignes de comptage) ; la création aussi.
 *
 *   BROUILLON  créé, ses lignes préparées : le magasinier compte et corrige ;
 *   VALIDÉ     un autre compte a figé le comptage — rien n'a touché le stock ;
 *   CLÔTURÉ    les écarts sont passés au stock (ajustements d'inventaire).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Plus, Printer } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOuvrirVue } from '../lib/navigation'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import { PanneauFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Bouton, Chargement } from '../composants/ui/base'
import { fmt } from '../lib/utils'
import { PanneRequetes } from '../composants/PanneRequetes'
import { MODULE } from './inventaires/comptage'
import { StatutBadge } from '../composants/StatutBadge'

export interface InventaireListe extends Record<string, unknown> {
  id_inventaire: string
  numero_inventaire: string
  date_inventaire: string
  type_inventaire: string
  code_magasin: string
  statut: string
  nb_lignes: number
  nb_a_compter: number
  responsable: string | null
  valide_par: string | null
  motif_annulation?: string | null
}

/* Des axes que l'on choisit, pas de comparateur a saisir : les valeurs
   des listes sortent des lignes affichees. */
const CHAMPS_INVENTAIRE: ChampFiltre<InventaireListe>[] = [
  { cle: 'periode', libelle: 'Période', type: 'periode', valeur: (l) => l.date_inventaire },
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (l) => l.code_magasin },
  { cle: 'type', libelle: "Type d'inventaire", type: 'liste', valeur: (l) => l.type_inventaire },
  { cle: 'responsable', libelle: 'Créé par', type: 'liste', valeur: (l) => l.responsable },
  { cle: 'numero', libelle: 'Numéro', type: 'texte', valeur: (l) => l.numero_inventaire },
]

export function Inventaires() {
  const droits = useDroits(MODULE)
  const naviguer = useNavigate()
  const ouvrirEtat = useOuvrirVue()
  const [statut, setStatut] = useState('')
  const filtres = useFiltres(CHAMPS_INVENTAIRE)

  const qInv = useQuery({
    queryKey: ['inventaires'],
    queryFn: ({ signal }) => api.get<InventaireListe[]>('/api/inventaires', { signal }),
  })

  const colonnes: ColonneDT<InventaireListe>[] = [
    {
      champ: 'numero_inventaire',
      entete: 'Numéro',
      rendu: (i) => <span className="font-mono text-xs">{i.numero_inventaire}</span>,
    },
    { champ: 'date_inventaire', entete: 'Date', rendu: (i) => fmt.date(i.date_inventaire) },
    { champ: 'type_inventaire', entete: 'Type' },
    { champ: 'code_magasin', entete: 'Magasin' },
    {
      champ: 'statut',
      entete: 'Statut',
      rendu: (i) => <StatutBadge entite="inventaire" code={i.statut} />,
    },
    {
      champ: 'quantite_theorique_kg',
      entete: 'Comptées',
      numerique: true,
      rendu: (i) => (i.nb_lignes === 0 ? '—' : `${i.nb_lignes - i.nb_a_compter} / ${i.nb_lignes}`),
    },
    { champ: 'valide_par', entete: 'Validé par', secondaire: true, rendu: (i) => i.valide_par ?? '—' },
  ]

  if (qInv.isLoading) return <Chargement />

  const tous = qInv.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, i) => {
    m[i.statut] = (m[i.statut] ?? 0) + 1
    return m
  }, {})
  const filtrables = tous.filter((i) => !statut || i.statut === statut)
  const vus = filtrables.filter(filtres.retenir)

  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les inventaires', compte: tous.length }] },
    {
      titre: 'Par statut',
      entrees: [
        { cle: 'BROUILLON', libelle: 'Brouillon', resume: 'Comptage en cours', compte: comptes.BROUILLON ?? 0, ton: 'alerte' as const },
        { cle: 'VALIDE', libelle: 'Validé', resume: 'Comptage figé, à clôturer', compte: comptes.VALIDE ?? 0, ton: 'neutre' as const },
        { cle: 'CLOTURE', libelle: 'Clôturé', resume: 'Écarts passés au stock', compte: comptes.CLOTURE ?? 0, ton: 'succes' as const },
        { cle: 'ANNULE', libelle: 'Annulé', compte: comptes.ANNULE ?? 0, ton: 'neutre' as const },
      ],
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Inventaires"
        description="Brouillon : on compte. Validé : un autre compte fige le comptage. Clôturé : les écarts passent au stock."
        actions={
          droits.peutEcrire && (
            <Bouton title="Nouvel inventaire" aria-label="Nouvel inventaire" onClick={() => naviguer('/inventaires/nouveau')}>
              <Plus />
              Nouvel inventaire
            </Bouton>
          )
        }
      />
      <PanneRequetes requetes={[['Les inventaires', qInv]]} />

      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral groupes={groupes} actif={statut} surChoix={setStatut} />
            <PanneauFiltres
              champs={CHAMPS_INVENTAIRE}
              lignes={filtrables}
              valeurs={filtres.valeurs}
              definir={filtres.definir}
              reinitialiser={filtres.reinitialiser}
              actifs={filtres.actifs}
            />
          </div>
        }
      >
        <DataTable<InventaireListe>
          exportable="inventaires"
          imprimable="Inventaires"
          module={MODULE}
          colonnes={colonnes}
          lignes={vus}
          cle={(i) => i.id_inventaire}
          surClic={(i) => naviguer(`/inventaires/${i.id_inventaire}`)}
          titreCarte={(i) => i.numero_inventaire}
          placeholderRecherche="Filtrer les inventaires..."
          tailleParDefaut={25}
          videTitre="Aucun inventaire"
          actions={(i) => (
            <div className="flex justify-end gap-0.5">
              {/* DEUX PAPIERS, DANS L'ORDRE OU L'ON S'EN SERT : la feuille de
                  comptage part dans l'allee, a l'aveugle ; le proces-verbal
                  revient confronter le compte au theorique. */}
              {i.nb_lignes > 0 && (
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  onClick={() => ouvrirEtat(`/etats/inventaire/${i.id_inventaire}/comptage`)}
                  aria-label="Feuille de comptage"
                  title="Imprimer la feuille de comptage"
                >
                  <ClipboardList />
                </Bouton>
              )}
              <Bouton
                variante="discret"
                taille="icone-xs"
                onClick={() => ouvrirEtat(`/etats/inventaire/${i.id_inventaire}`)}
                aria-label="Imprimer"
                title="Imprimer le procès-verbal"
              >
                <Printer />
              </Bouton>
            </div>
          )}
        />
      </PageAvecRail>
    </div>
  )
}

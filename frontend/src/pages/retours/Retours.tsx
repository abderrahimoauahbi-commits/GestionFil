/**
 * Les retours fournisseur — une page a part (12/10/2026).
 *
 * Un retour est un document LIBRE, comme l'avoir d'une gestion commerciale :
 * fournisseur, references en stock, quantite et prix. Il se prepare en
 * brouillon et se valide par un autre compte. Il n'est plus une saisie libre
 * de mouvement, ni un bloc du dossier d'import.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { DataTable, type ColonneDT } from '../../composants/DataTable'
import { PageAvecRail, RailLateral, type GroupeRail } from '../../composants/RailLateral'
import { Badge, Bouton, Chargement } from '../../composants/ui/base'
import { fmt } from '../../lib/utils'
import { LIBELLE_STATUT_RETOUR, MODULE_RETOURS, type RetourListe } from './commun'



export function Retours() {
  const droits = useDroits(MODULE_RETOURS)
  const naviguer = useNavigate()
  const [statut, setStatut] = useState('')
  const q = useQuery({
    queryKey: ['retours-fournisseur'],
    queryFn: ({ signal }) => api.get<RetourListe[]>('/api/retours-fournisseur', { signal }),
  })

  const colonnes: ColonneDT<RetourListe>[] = [
    { champ: 'numero_retour', entete: 'N° de retour', rendu: (r) => <span className="font-mono text-xs">{r.numero_retour}</span> },
    { champ: 'date_retour', entete: 'Date', rendu: (r) => fmt.date(r.date_retour) },
    { champ: 'fournisseur_nom', entete: 'Fournisseur' },
    {
      champ: 'quantite_totale_kg',
      entete: 'Kilos rendus',
      numerique: true,
      rendu: (r) => `${fmt.nombre(r.quantite_totale_kg, 2)}`,
    },
    {
      champ: 'montant_avoir_mad',
      entete: 'Avoir (DH)',
      numerique: true,
      rendu: (r) => (r.montant_avoir_mad === null || r.montant_avoir_mad === undefined ? '—' : fmt.nombre(r.montant_avoir_mad, 2)),
    },
    {
      champ: 'statut_retour',
      entete: 'État',
      rendu: (r) => (
        <div>
          <Badge ton={r.statut_retour === 'VALIDE' ? 'succes' : 'neutre'}>{LIBELLE_STATUT_RETOUR[r.statut_retour]}</Badge>
          <div className="mt-0.5 text-[11px] text-attenue-texte">
            {r.statut_retour === 'VALIDE' ? `validé par ${r.valide_par ?? '—'}` : `saisi par ${r.saisi_par}`}
          </div>
        </div>
      ),
    },
  ]

  const tous = q.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, r) => {
    m[r.statut_retour] = (m[r.statut_retour] ?? 0) + 1
    return m
  }, {})
  const vus = tous.filter((r) => !statut || r.statut_retour === statut)
  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les retours', compte: tous.length }] },
    {
      titre: 'Par état',
      entrees: [
        { cle: 'BROUILLON', libelle: 'Brouillons', resume: 'À valider par un autre compte', compte: comptes.BROUILLON ?? 0, ton: 'neutre' as const },
        { cle: 'VALIDE', libelle: 'Validés', resume: 'Sortis du stock', compte: comptes.VALIDE ?? 0, ton: 'succes' as const },
      ],
    },
  ]

  if (q.isLoading) return <Chargement />

  return (
    <div>
      <EnTetePage
        titre="Retours fournisseur"
        description="La marchandise rendue au fournisseur, avec son avoir : préparée en brouillon, validée par un autre compte."
        actions={
          droits.peutEcrire && (
            <Bouton onClick={() => naviguer('/retours-fournisseur/nouveau')}>
              <Plus />
              Nouveau retour
            </Bouton>
          )
        }
      />
      <PageAvecRail large rail={<RailLateral groupes={groupes} actif={statut} surChoix={setStatut} />}>
        <DataTable<RetourListe>
          exportable="retours-fournisseur"
          imprimable="Retours fournisseur"
          module={MODULE_RETOURS}
          colonnes={colonnes}
          lignes={vus}
          cle={(r) => r.id_retour}
          titreCarte={(r) => `${r.numero_retour} — ${r.fournisseur_nom}`}
          placeholderRecherche="Filtrer les retours..."
          videTitre="Aucun retour fournisseur"
          surClic={(r) => naviguer(`/retours-fournisseur/${r.id_retour}`)}
        />
      </PageAvecRail>
    </div>
  )
}

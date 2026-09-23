/**
 * Les receptions d'import — la liste. Un document A PART du dossier : le
 * magasin recoit ce que le camion apporte, et une meme reception peut prendre
 * des lignes de factures de plusieurs dossiers.
 *
 * Elle se lit avec le module RECEPTIONS, comme toute reception : le magasinier
 * y prepare le brouillon, la direction valide l'entree en stock.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PackageCheck } from 'lucide-react'
import { api } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { DataTable, type ColonneDT } from '../../composants/DataTable'
import { Badge, Bouton } from '../../composants/ui/base'
import { useOuvrirVue } from '../../lib/navigation'
import { cn, fmt } from '../../lib/utils'
import type { ReceptionResume } from './types'

const MODULE = 'RECEPTIONS'
type Statut = ReceptionResume['statut']

const LIBELLE: Record<Statut, string> = { BROUILLON: 'Brouillon', VALIDEE: 'Validée', ANNULEE: 'Annulée' }
const TON: Record<Statut, 'alerte' | 'succes' | 'neutre'> = { BROUILLON: 'alerte', VALIDEE: 'succes', ANNULEE: 'neutre' }

export function ReceptionsImport() {
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const [filtre, setFiltre] = useState<Statut | ''>('')

  const q = useQuery({
    queryKey: ['import-receptions'],
    queryFn: () => api.get<ReceptionResume[]>('/api/import/receptions'),
  })
  // Ce qui attend encore, tous dossiers en cours : le magasin sait d'un coup
  // d'oeil s'il reste des camions a recevoir.
  const qReste = useQuery({
    queryKey: ['import-a-recevoir'],
    queryFn: () => api.get<{ reste_kg: number }[]>('/api/import/a-recevoir'),
  })
  const lignes = (q.data ?? []).filter((r) => !filtre || r.statut === filtre)
  const reste = qReste.data ?? []

  const colonnes: ColonneDT<ReceptionResume>[] = [
    {
      champ: 'numero_reception',
      entete: 'Réception',
      rendu: (r) => (
        <div>
          <span className="font-semibold">{r.numero_reception}</span>
          {r.litige === 1 && <div className="text-[11px] text-alerte">litige : {r.motif_litige}</div>}
        </div>
      ),
    },
    { champ: 'date_reception', entete: 'Date', rendu: (r) => fmt.date(r.date_reception) },
    { champ: 'statut', entete: 'Statut', rendu: (r) => <Badge ton={TON[r.statut]}>{LIBELLE[r.statut]}</Badge> },
    { champ: 'dossiers', entete: 'Dossiers', rendu: (r) => r.dossiers ?? '—' },
    { champ: 'fournisseur_nom', entete: 'Fournisseurs', rendu: (r) => r.fournisseur_nom ?? '—' },
    { champ: 'numero_facture', entete: 'Factures', rendu: (r) => r.numero_facture ?? '—', secondaire: true },
    { champ: 'nb_lignes', entete: 'Lignes', numerique: true, secondaire: true },
    { champ: 'quantite_kg', entete: 'Reçu (kg)', numerique: true, rendu: (r) => fmt.nombre(r.quantite_kg, 2) },
    {
      champ: 'ecart_kg',
      entete: 'Écart (kg)',
      numerique: true,
      rendu: (r) => <span className={cn(Math.abs(r.ecart_kg) > 0.5 && 'text-alerte')}>{fmt.nombre(r.ecart_kg, 2)}</span>,
    },
    { champ: 'nb_palettes', entete: 'Palettes', numerique: true, secondaire: true },
  ]

  return (
    <div>
      <EnTetePage
        titre="Réceptions import"
        description={
          reste.length > 0
            ? `${reste.length} ligne(s) de facture restent à recevoir — ${fmt.nombre(reste.reduce((t, x) => t + x.reste_kg, 0), 2)} kg, tous dossiers en cours.`
            : "L'entrée en stock des marchandises importées, facture par facture ou en partie."
        }
        actions={
          droits.peutEcrire && (
            <Bouton onClick={() => ouvrir('/receptions-import/nouvelle')}>
              <PackageCheck />
              Nouvelle réception
            </Bouton>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', 'BROUILLON', 'VALIDEE'] as const).map((s) => (
          <Bouton key={s || 'toutes'} taille="sm" variante={filtre === s ? 'principal' : 'contour'} onClick={() => setFiltre(s)}>
            {s ? LIBELLE[s] : 'Toutes'}
            <span className="tabular-nums opacity-70">{(q.data ?? []).filter((r) => !s || r.statut === s).length}</span>
          </Bouton>
        ))}
      </div>

      <DataTable
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        cle={(r) => r.id_reception}
        surClic={(r) => ouvrir(`/receptions-import/${r.id_reception}`)}
        titreCarte={(r) => `Réception ${r.numero_reception}`}
        placeholderRecherche="Réception, dossier, fournisseur…"
        videTitre="Aucune réception d'import"
        videDescription="Une réception fait entrer en stock des lignes de facture — d'un ou de plusieurs dossiers."
      />
    </div>
  )
}

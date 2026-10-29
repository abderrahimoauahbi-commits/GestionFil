/**
 * LES FACTURES FOURNISSEUR — la liste (ADR-003 phase B).
 *
 * La facture n'etait qu'un formulaire accroche a une reception. C'est un
 * DOCUMENT : un brouillon qu'on relit, des lignes, un rapprochement, et une
 * validation qui cloture les arrivages qu'elle couvre.
 *
 * Pas de statistiques en tete de liste (regle d'ecran du 10/10) : la liste sert
 * a retrouver un document, pas a contempler des totaux. Les deux chiffres qui
 * aident vraiment — ce qui attend d'etre facture — sont dans la description.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FilePlus2 } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Bouton } from '../composants/ui/base'
import { useOuvrirVue } from '../lib/navigation'
import { fmt } from '../lib/utils'
import { StatutBadge } from '../composants/StatutBadge'
import { libelleStatut } from '../lib/statuts'

const MODULE = 'RECEPTIONS'

interface Facture extends Record<string, unknown> {
  id_facture: string
  numero_facture: string
  code_fournisseur: string
  fournisseur_nom: string
  date_facture: string
  code_devise: string
  taux_change: number
  montant_devise?: number
  montant_lignes_devise?: number
  frais_devise?: number
  statut: string
  nb_lignes: number
  nb_receptions: number
  receptions: string | null
  dossier_numero: string | null
  saisie_par: string | null
  valide_par: string | null
}

interface ARecevoir {
  id_ligne_reception: string
  numero_reception: string
  provisoire_mad?: number
}

export function FacturesFournisseur() {
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const [filtre, setFiltre] = useState('')

  const q = useQuery({
    queryKey: ['factures-fournisseur', filtre],
    queryFn: ({ signal }) =>
      api.get<Facture[]>(`/api/factures-fournisseur${filtre ? `?statut=${filtre}` : ''}`, { signal }),
  })
  // CE QUI ATTEND SA FACTURE : des pesees validees que rien ne couvre. C'est la
  // seule chose qu'on vient verifier ici sans ouvrir un document.
  const qAttente = useQuery({
    queryKey: ['factures-a-facturer'],
    queryFn: ({ signal }) => api.get<ARecevoir[]>('/api/factures-fournisseur/a-facturer', { signal }),
  })
  const attente = qAttente.data ?? []
  const arrivages = new Set(attente.map((l) => l.numero_reception)).size

  const colonnes: ColonneDT<Facture>[] = [
    {
      champ: 'numero_facture',
      entete: 'Facture',
      rendu: (f) => (
        <div className="min-w-0">
          <span className="font-semibold">{f.numero_facture}</span>
          {f.dossier_numero && (
            <div className="truncate text-[11px] text-attenue-texte">dossier {f.dossier_numero}</div>
          )}
        </div>
      ),
    },
    { champ: 'date_facture', entete: 'Date', rendu: (f) => fmt.date(f.date_facture) },
    {
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      rendu: (f) => (
        <div className="min-w-0">
          <div className="truncate">{f.fournisseur_nom}</div>
          <div className="text-[11px] text-attenue-texte">{f.code_fournisseur}</div>
        </div>
      ),
    },
    {
      champ: 'statut',
      entete: 'Statut',
      rendu: (f) => <StatutBadge entite="facture_fournisseur" code={f.statut} />,
    },
    {
      champ: 'numero_reception',
      entete: 'Arrivages couverts',
      largeur: '200px',
      rendu: (f) => (
        <div className="min-w-0">
          <div className="truncate">{f.receptions ?? <span className="text-attenue-texte">—</span>}</div>
          <div className="text-[11px] text-attenue-texte tabular-nums">
            {f.nb_lignes} ligne(s){f.nb_receptions > 1 ? ` · ${f.nb_receptions} arrivages` : ''}
          </div>
        </div>
      ),
    },
    {
      champ: 'montant_devise',
      entete: 'Montant',
      numerique: true,
      rendu: (f) => (
        <div className="tabular-nums">
          {f.montant_lignes_devise != null
            ? `${fmt.nombre(f.montant_lignes_devise, 2)} ${f.code_devise}`
            : '—'}
          {/* LE TOTAL IMPRIME qui ne retombe pas sur la somme des lignes est un
              signal : une facture mal saisie se voit ici, pas au bilan. */}
          {f.montant_devise != null &&
            f.montant_lignes_devise != null &&
            Math.abs(f.montant_devise - (f.montant_lignes_devise ?? 0) - (f.frais_devise ?? 0)) >
              0.05 && (
              <div className="text-[11px] text-alerte">
                imprimé {fmt.nombre(f.montant_devise, 2)}
              </div>
            )}
        </div>
      ),
    },
    { champ: 'code_devise', entete: 'Devise', secondaire: true },
    { champ: 'saisie_par', entete: 'Saisie par', secondaire: true },
    { champ: 'valide_par', entete: 'Validée par', secondaire: true },
  ]

  return (
    <div>
      <EnTetePage
        titre="Factures fournisseur"
        description={
          arrivages > 0
            ? `${attente.length} pesée(s) validée(s) sur ${arrivages} arrivage(s) attendent leur facture.`
            : 'La facture rapproche ce qui a été commandé, pesé et facturé, puis clôture les arrivages.'
        }
        actions={
          droits.peutEcrire && (
            <Bouton onClick={() => ouvrir('/factures-fournisseur/nouvelle')}>
              <FilePlus2 />
              Nouvelle facture
            </Bouton>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {['', 'BROUILLON', 'VALIDEE', 'ANNULEE'].map((s) => (
          <Bouton
            key={s || 'toutes'}
            taille="sm"
            variante={filtre === s ? 'principal' : 'contour'}
            onClick={() => setFiltre(s)}
          >
            {s ? libelleStatut('facture_fournisseur', s) : 'Toutes'}
          </Bouton>
        ))}
      </div>

      <DataTable
        module={MODULE}
        exportable="factures-fournisseur"
        imprimable="Factures fournisseur"
        colonnes={colonnes}
        lignes={q.data ?? []}
        chargement={q.isLoading}
        erreur={q.error}
        cle={(f) => f.id_facture}
        surClic={(f) => ouvrir(`/factures-fournisseur/${f.id_facture}`)}
        titreCarte={(f) => `Facture ${f.numero_facture}`}
        placeholderRecherche="Facture, fournisseur, arrivage…"
        videTitre="Aucune facture fournisseur"
        videDescription="Une facture se saisit en face de ce qui est entré : ses lignes pointent les pesées qu'elle facture."
      />
    </div>
  )
}

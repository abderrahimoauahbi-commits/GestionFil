/**
 * Les dossiers d'importation — la liste.
 *
 * Ce qu'on vient y chercher d'un coup d'oeil : de quels fournisseurs, pour
 * quelle valeur, avec quels frais, et OU EN EST LA RECEPTION. Le reste est dans
 * la fiche.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, ScanText, Ship } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { DataTable, type ColonneDT } from '../../composants/DataTable'
import { Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Etiq } from '../../composants/ui/base'
import { useOuvrirVue } from '../../lib/navigation'
import { cn, fmt } from '../../lib/utils'
import {
  LIBELLE_STATUT,
  SAISIE_ASSISTEE_VISIBLE,
  TON_STATUT,
  type DossierResume,
  type StatutDossier,
} from './types'

const MODULE = 'IMPORT'

/** L'avancement de la reception, en kilos : la barre dit plus vite qu'un %. */
export function Avancement({ recu, total }: { recu: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (recu / total) * 100) : 0
  return (
    <div className="flex min-w-24 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-attenue">
        <div
          className={cn('h-full rounded-full', pct >= 98 ? 'bg-succes' : 'bg-info')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-[11px] tabular-nums text-attenue-texte">
        {fmt.nombre(pct, 0)} %
      </span>
    </div>
  )
}

export function PastilleStatut({ statut }: { statut: StatutDossier }) {
  return (
    <Badge ton={TON_STATUT[statut]} className="inline-flex items-center gap-1">
      {statut === 'CLOTURE' && <Lock className="size-3" />}
      {LIBELLE_STATUT[statut]}
    </Badge>
  )
}

export function DossiersImport() {
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const [filtre, setFiltre] = useState<StatutDossier | ''>('')
  const [creation, setCreation] = useState(false)

  const q = useQuery({
    queryKey: ['import-dossiers'],
    queryFn: ({ signal }) => api.get<DossierResume[]>('/api/import/dossiers', { signal }),
  })
  const lignes = (q.data ?? []).filter((d) => !filtre || d.statut === filtre)

  const colonnes: ColonneDT<DossierResume>[] = [
    {
      champ: 'numero',
      entete: 'Dossier',
      rendu: (d) => <span className="font-semibold">{d.numero}</span>,
    },
    { champ: 'statut', entete: 'Statut', rendu: (d) => <PastilleStatut statut={d.statut} /> },
    { champ: 'fournisseurs', entete: 'Fournisseurs', rendu: (d) => d.fournisseurs ?? '—' },
    // PAR ICI QU'ON RETROUVE UN DOSSIER quand la banque ou le transitaire le
    // designe par son numero d'engagement, pas par le notre.
    { champ: 'engagements', entete: 'Engagements (EI)', rendu: (d) => d.engagements ?? '—', secondaire: true },
    { champ: 'nb_factures', entete: 'Factures', numerique: true, secondaire: true },
    { champ: 'date_arrivee', entete: 'Arrivée', rendu: (d) => fmt.date(d.date_arrivee), secondaire: true },
    { champ: 'valeur_dhs', entete: 'Valeur (DH)', numerique: true, rendu: (d) => fmt.nombre(d.valeur_dhs, 2) },
    { champ: 'frais_dhs', entete: 'Frais HT (DH)', numerique: true, rendu: (d) => fmt.nombre(d.frais_dhs, 2) },
    {
      champ: 'coef_frais_pct',
      entete: 'Frais %',
      numerique: true,
      rendu: (d) => (d.coef_frais_pct == null ? '—' : `${fmt.nombre(d.coef_frais_pct, 2)} %`),
    },
    {
      champ: 'recu_kg',
      entete: 'Réception',
      rendu: (d) => <Avancement recu={d.recu_kg} total={d.poids_kg} />,
      valeurTri: (d) => (d.poids_kg > 0 ? d.recu_kg / d.poids_kg : 0),
    },
    { champ: 'nb_palettes', entete: 'Palettes', numerique: true, secondaire: true },
  ]

  return (
    <div>
      <EnTetePage
        titre="Dossiers d'importation"
        description="Factures, frais et coût de revient de chaque expédition — et ce qu'elle fait entrer en stock."
        actions={
          droits.peutEcrire && (
            <>
              {/* L'ASSISTANT N'AVAIT AUCUNE ENTREE : sa route existait, rien n'y
                  menait. C'est pourtant le geste reel — on part de la liasse
                  scannee, pas d'un formulaire vide. */}
              {SAISIE_ASSISTEE_VISIBLE && (
                <Bouton variante="contour" onClick={() => ouvrir('/import/assistant')}>
                  <ScanText />
                  Depuis un scan
                </Bouton>
              )}
              <Bouton onClick={() => setCreation(true)}>
                <Plus />
                Nouveau dossier
              </Bouton>
            </>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', 'BROUILLON', 'EN_COURS', 'CLOTURE'] as const).map((s) => (
          <Bouton
            key={s || 'tous'}
            taille="sm"
            variante={filtre === s ? 'principal' : 'contour'}
            onClick={() => setFiltre(s)}
          >
            {s ? LIBELLE_STATUT[s] : 'Tous'}
            <span className="tabular-nums opacity-70">
              {(q.data ?? []).filter((d) => !s || d.statut === s).length}
            </span>
          </Bouton>
        ))}
      </div>

      {/* UN DOCUMENT SE SAISIT SUR LA PAGE, PAS DANS UNE FENETRE (preference de
          l'entreprise, audit v4) : le formulaire s'ouvre au-dessus de la liste. */}
      <NouveauDossier ouvert={creation} surFermer={() => setCreation(false)} />
      <DataTable
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        erreur={q.error}
        cle={(d) => d.id_dossier}
        surClic={(d) => ouvrir(`/import/${d.id_dossier}`)}
        titreCarte={(d) => `Dossier ${d.numero}`}
        placeholderRecherche="Dossier, fournisseur…"
        videTitre="Aucun dossier d'importation"
        videDescription="Un dossier regroupe les factures d'une expédition et ses frais."
      />

    </div>
  )
}

function NouveauDossier({ ouvert, surFermer }: { ouvert: boolean; surFermer: () => void }) {
  const qc = useQueryClient()
  const ouvrir = useOuvrirVue()
  const [f, setF] = useState({
    numero: '',
    numero_bl: '',
    conteneurs: '',
    date_arrivee: '',
    numero_dum: '',
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_dossier: string; numero: string }>('/api/import/dossiers', {
        ...f,
        numero: f.numero.trim() || null,
        date_arrivee: f.date_arrivee || null,
        numero_dum: f.numero_dum.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(`Dossier ${r.numero} créé`)
      void qc.invalidateQueries({ queryKey: ['import-dossiers'] })
      surFermer()
      ouvrir(`/import/${r.id_dossier}`)
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Création impossible.'),
  })

  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }))

  if (!ouvert) return null
  return (
    <Carte className="mb-3">
      <CarteEntete>
        <CarteTitre>Nouveau dossier d’importation</CarteTitre>
      </CarteEntete>
      <CarteCorps>
        <p className="mb-3 mt-0 text-[12.5px] text-attenue-texte">
          Une expédition en groupage : chaque facture portera sa devise, son taux et son engagement.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Etiq>Numéro</Etiq>
            <Champ value={f.numero} onChange={maj('numero')} placeholder="Automatique (06/26…)" />
          </div>
          <div>
            <Etiq>Arrivée</Etiq>
            <Champ type="date" value={f.date_arrivee} onChange={maj('date_arrivee')} />
          </div>
          <div>
            <Etiq>N° BL</Etiq>
            <Champ value={f.numero_bl} onChange={maj('numero_bl')} />
          </div>
          <div>
            <Etiq>Conteneur(s)</Etiq>
            <Champ value={f.conteneurs} onChange={maj('conteneurs')} placeholder="CMAU4385688" />
          </div>
          <div className="sm:col-span-2">
            <Etiq>N° DUM</Etiq>
            <Champ value={f.numero_dum} onChange={maj('numero_dum')} placeholder="Peut se saisir plus tard" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Bouton variante="contour" onClick={surFermer}>Annuler</Bouton>
          <Bouton
            chargement={creer.isPending}
            onClick={() => creer.mutate()}
          >
            <Ship />
            Créer le dossier
          </Bouton>
        </div>
      </CarteCorps>
    </Carte>
  )
}

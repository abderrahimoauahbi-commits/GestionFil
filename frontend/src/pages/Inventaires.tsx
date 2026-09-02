/**
 * Inventaires physiques.
 *
 * Le comptage se saisit directement dans le tableau : on compte une allee
 * entiere avant de valider, pas une reference a la fois. L'ecart et son
 * pourcentage se recalculent a la frappe, ce qui rend visible immediatement
 * ce qui devra etre justifie.
 *
 * Les references sous suivi de lot sont comptees AU LOT : on compte des
 * bobines portant un numero de bain de teinture, pas un total abstrait.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, FolderOpen, Plus, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { useOuvrirVue } from '../lib/navigation'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  PanneauFiltres,
  useFiltres,
  type ChampFiltre,
} from '../composants/PanneauFiltres'
import { CelluleEditable } from '../composants/CelluleEditable'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  Chargement,
  EtatVide,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { Dialogue, DialogueContenu, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'INVENTAIRE'

interface Inventaire extends Record<string, unknown> {
  id_inventaire: string
  numero_inventaire: string
  date_inventaire: string
  type_inventaire: string
  code_magasin: string
  statut: string
  nb_lignes: number
  nb_a_compter: number
  responsable: string | null
}

/* Des axes que l'on choisit, pas de comparateur a saisir : les valeurs
   des listes sortent des lignes affichees. */
const CHAMPS_INVENTAIRE: ChampFiltre<Inventaire>[] = [
  { cle: 'periode', libelle: 'Periode', type: 'periode', valeur: (l) => l.date_inventaire },
  { cle: 'statut', libelle: 'Statut', type: 'liste', valeur: (l) => l.statut },
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (l) => l.code_magasin },
  { cle: 'type', libelle: "Type d'inventaire", type: 'liste', valeur: (l) => l.type_inventaire },
  { cle: 'responsable', libelle: 'Responsable', type: 'liste', valeur: (l) => l.responsable },
  { cle: 'numero', libelle: 'Numero', type: 'texte', valeur: (l) => l.numero_inventaire },
]

interface LigneInv extends Record<string, unknown> {
  id_ligne_inv: string
  code_reference: string
  designation: string
  code_magasin: string
  lot_fournisseur: string | null
  quantite_theorique_kg: number
  quantite_comptee_kg: number | null
  ecart_kg: number | null
  ecart_pct: number | null
  motif_ecart: string | null
  statut_ligne: string
}

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'danger'> = {
  BROUILLON: 'neutre',
  EN_COURS: 'info',
  CLOTURE: 'succes',
  ANNULE: 'danger',
}

/** Tolerance d'ecart au-dela de laquelle un motif devient obligatoire. */
const TOLERANCE_PCT = 2

export function Inventaires() {
  const droits = useDroits(MODULE)
  const ouvrirEtat = useOuvrirVue()
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const [selection, setSelection] = useState<string | null>(null)
  const [creation, setCreation] = useState(false)
  const [statut, setStatut] = useState('')
  const filtres = useFiltres(CHAMPS_INVENTAIRE)

  const qInv = useQuery({
    queryKey: ['inventaires'],
    queryFn: () => api.get<Inventaire[]>('/api/inventaires'),
  })
  const inventaire = qInv.data?.find((i) => i.id_inventaire === selection) ?? null

  const qLignes = useQuery({
    queryKey: ['lignes-inventaire', selection],
    queryFn: () => api.get<LigneInv[]>(`/api/inventaires/${selection}/lignes`),
    enabled: !!selection,
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['inventaires'] })
    void qc.invalidateQueries({ queryKey: ['lignes-inventaire'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Operation impossible.')

  const ouvrir = useMutation({
    mutationFn: (id: string) =>
      api.post<{ lignes_a_compter: number }>(`/api/inventaires/${id}/ouvrir`),
    onSuccess: (r) => {
      toast.success(`${r.lignes_a_compter} ligne(s) a compter.`)
      rafraichir()
    },
    onError: echec,
  })

  const compter = useMutation({
    mutationFn: (c: {
      code_reference: string
      code_magasin: string
      lot_fournisseur: string | null
      quantite_comptee_kg: number
      motif_ecart?: string | null
    }) => api.put(`/api/inventaires/${selection}/lignes`, { comptages: [c] }),
    onSuccess: rafraichir,
    onError: echec,
  })

  const cloturer = useMutation({
    mutationFn: () =>
      api.post<{
        lignes_ajustees: number
        ecart_positif_kg: number
        ecart_negatif_kg: number
        impact_valorisation_mad: number
      }>(`/api/inventaires/${selection}/cloturer`),
    onSuccess: (r) => {
      toast.success(
        `Inventaire cloture : ${r.lignes_ajustees} ajustement(s), impact ${fmt.mad(r.impact_valorisation_mad)}.`,
      )
      rafraichir()
      void qc.invalidateQueries({ queryKey: ['stock-projete'] })
      void qc.invalidateQueries({ queryKey: ['cockpit'] })
    },
    onError: echec,
  })

  const enCours = inventaire?.statut === 'EN_COURS'
  const saisissable = enCours && droits.peutEcrire

  /** Lignes hors tolerance sans justification : elles bloqueront la cloture. */
  const injustifiees = useMemo(
    () =>
      (qLignes.data ?? []).filter(
        (l) =>
          l.ecart_pct != null &&
          Math.abs(l.ecart_pct) > TOLERANCE_PCT &&
          !l.motif_ecart?.trim(),
      ),
    [qLignes.data],
  )
  const restantes = (qLignes.data ?? []).filter((l) => l.statut_ligne === 'A_TRAITER').length

  const colonnesInv: ColonneDT<Inventaire>[] = [
    {
      champ: 'numero_inventaire',
      entete: 'Numero',
      rendu: (i) => <span className="font-mono text-xs">{i.numero_inventaire}</span>,
    },
    { champ: 'date_inventaire', entete: 'Date', rendu: (i) => fmt.date(i.date_inventaire) },
    { champ: 'type_inventaire', entete: 'Type' },
    { champ: 'code_magasin', entete: 'Magasin' },
    {
      champ: 'statut',
      entete: 'Statut',
      rendu: (i) => <Badge ton={TON[i.statut] ?? 'neutre'}>{i.statut}</Badge>,
    },
    {
      champ: 'quantite_theorique_kg',
      entete: 'A compter',
      numerique: true,
      rendu: (i) =>
        i.nb_lignes === 0 ? '—' : `${i.nb_lignes - i.nb_a_compter} / ${i.nb_lignes}`,
    },
  ]

  const colonnesLignes: ColonneDT<LigneInv>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{l.code_reference}</div>
          {l.lot_fournisseur && (
            <div className="truncate text-xs text-attenue-texte">lot {l.lot_fournisseur}</div>
          )}
        </div>
      ),
    },
    {
      champ: 'quantite_theorique_kg',
      entete: 'Theorique (kg)',
      numerique: true,
      rendu: (l) => fmt.nombre(l.quantite_theorique_kg, 2),
    },
    {
      champ: 'quantite_comptee_kg',
      entete: 'Compte (kg)',
      numerique: true,
      rendu: (l) => (
        <CelluleEditable
          valeur={l.quantite_comptee_kg}
          affichage={
            l.quantite_comptee_kg == null ? (
              <span className="text-attenue-texte">a compter</span>
            ) : (
              fmt.nombre(l.quantite_comptee_kg, 2)
            )
          }
          type="nombre"
          min={0}
          aligneDroite
          modifiable={!!saisissable}
          surValider={(v) =>
            compter.mutateAsync({
              code_reference: l.code_reference,
              code_magasin: l.code_magasin,
              lot_fournisseur: l.lot_fournisseur,
              quantite_comptee_kg: Number(v ?? 0),
              motif_ecart: l.motif_ecart,
            })
          }
        />
      ),
    },
    {
      champ: 'ecart_kg',
      entete: 'Ecart (kg)',
      numerique: true,
      rendu: (l) =>
        l.ecart_kg == null ? (
          '—'
        ) : (
          <span
            className={cn(
              'tabular-nums',
              l.ecart_kg > 0 ? 'text-succes' : l.ecart_kg < 0 ? 'text-danger' : '',
            )}
          >
            {l.ecart_kg > 0 ? '+' : ''}
            {fmt.nombre(l.ecart_kg, 2)}
          </span>
        ),
    },
    {
      champ: 'ecart_pct',
      entete: 'Ecart (%)',
      numerique: true,
      rendu: (l) =>
        l.ecart_pct == null ? (
          '—'
        ) : (
          <Badge ton={Math.abs(l.ecart_pct) > TOLERANCE_PCT ? 'danger' : 'neutre'}>
            {l.ecart_pct > 0 ? '+' : ''}
            {fmt.nombre(l.ecart_pct, 1)} %
          </Badge>
        ),
    },
    {
      champ: 'motif_ecart',
      entete: 'Motif',
      rendu: (l) => (
        <CelluleEditable
          valeur={l.motif_ecart}
          affichage={
            l.motif_ecart ? (
              <span className="truncate">{l.motif_ecart}</span>
            ) : l.ecart_pct != null && Math.abs(l.ecart_pct) > TOLERANCE_PCT ? (
              <span className="text-danger">requis</span>
            ) : (
              <span className="text-attenue-texte">—</span>
            )
          }
          modifiable={!!saisissable && l.quantite_comptee_kg != null}
          surValider={(v) =>
            compter.mutateAsync({
              code_reference: l.code_reference,
              code_magasin: l.code_magasin,
              lot_fournisseur: l.lot_fournisseur,
              quantite_comptee_kg: l.quantite_comptee_kg ?? 0,
              motif_ecart: (v as string) ?? null,
            })
          }
        />
      ),
    },
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
        {
          cle: 'BROUILLON',
          libelle: 'Brouillon',
          resume: 'Pas encore lance',
          compte: comptes.BROUILLON ?? 0,
          ton: 'neutre' as const,
        },
        {
          cle: 'EN_COURS',
          libelle: 'En cours',
          resume: 'Comptage commence',
          compte: comptes.EN_COURS ?? 0,
          ton: 'alerte' as const,
        },
        {
          cle: 'CLOTURE',
          libelle: 'Cloture',
          resume: 'Ajustements generes',
          compte: comptes.CLOTURE ?? 0,
          ton: 'succes' as const,
        },
        {
          cle: 'ANNULE',
          libelle: 'Annule',
          compte: comptes.ANNULE ?? 0,
          ton: 'neutre' as const,
        },
      ],
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Inventaires"
        description="La cloture genere automatiquement les mouvements d'ajustement, dans une seule transaction."
        actions={
          droits.peutEcrire && (
            <Bouton taille="icone" title="Nouvel inventaire" aria-label="Nouvel inventaire" onClick={() => setCreation(true)}>              <Plus />            </Bouton>
          )
        }
      />

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
      <div className="space-y-4">
        <DataTable<Inventaire>
          exportable="inventaires"
          imprimable="Inventaires"
          module={MODULE}
          colonnes={colonnesInv}
          lignes={vus}
          cle={(i) => i.id_inventaire}
          surClic={(i) => setSelection(i.id_inventaire)}
          titreCarte={(i) => i.numero_inventaire}
          placeholderRecherche="Filtrer les inventaires..."
          tailleParDefaut={10}
          videTitre="Aucun inventaire"
          actions={(i) => (
            <div className="flex justify-end gap-0.5">
              {/* Le proces-verbal s'imprime des l'ouverture du comptage, pas
                  seulement apres cloture : c'est le document qu'on emporte
                  pour faire signer les ecarts au fur et a mesure. */}
              <Bouton
                variante="discret"
                taille="icone-xs"
                onClick={() => ouvrirEtat(`/etats/inventaire/${i.id_inventaire}`)}
                aria-label="Imprimer"
                title="Imprimer le proces-verbal"
              >
                <Printer />
              </Bouton>
              {droits.peutEcrire && i.statut === 'BROUILLON' && (
                <Bouton
                  variante="contour"
                  taille="sm"
                  onClick={() => {
                    setSelection(i.id_inventaire)
                    ouvrir.mutate(i.id_inventaire)
                  }}
                >
                  <FolderOpen />
                  Ouvrir
                </Bouton>
              )}
            </div>
          )}
        />

        {!inventaire ? (
          <EtatVide
            titre="Selectionnez un inventaire"
            description="Le comptage s'affichera ici, saisissable ligne par ligne."
          />
        ) : (
          <div className="space-y-4">
            <Carte repliable="inventaires.1">
              <CarteCorps className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{inventaire.numero_inventaire}</span>
                    <Badge ton={TON[inventaire.statut] ?? 'neutre'}>{inventaire.statut}</Badge>
                  </div>
                  <div className="text-sm text-attenue-texte">
                    {inventaire.type_inventaire} · magasin {inventaire.code_magasin}
                    {restantes > 0 && ` · ${restantes} ligne(s) a compter`}
                  </div>
                </div>

                {enCours && droits.peutValider && (
                  <Bouton
                    disabled={restantes > 0 || injustifiees.length > 0}
                    onClick={() =>
                      confirmation.demander({
                        titre: `Cloturer ${inventaire.numero_inventaire} ?`,
                        description:
                          "Les ecarts seront convertis en mouvements d'ajustement. Le grand livre etant immuable, cette operation ne s'annule pas.",
                        libelleConfirmer: 'Cloturer',
                        action: () => cloturer.mutate(),
                      })
                    }
                  >
                    <ClipboardCheck />
                    Cloturer et ajuster
                  </Bouton>
                )}
              </CarteCorps>
            </Carte>

            {inventaire.statut === 'BROUILLON' && (
              <Alerte ton="info">
                Ouvrez l'inventaire pour figer le stock theorique et commencer le comptage.
              </Alerte>
            )}

            {injustifiees.length > 0 && (
              <Alerte ton="alerte" titre={`${injustifiees.length} ecart(s) a justifier`}>
                Un ecart superieur a {TOLERANCE_PCT} % exige un motif. La cloture est bloquee tant
                qu'il en reste un sans justification.
              </Alerte>
            )}

            <DataTable<LigneInv>
              module={MODULE}
              colonnes={colonnesLignes}
              lignes={qLignes.data}
              chargement={qLignes.isLoading}
              cle={(l) => l.id_ligne_inv}
              titreCarte={(l) => l.code_reference}
              placeholderRecherche="Chercher une reference..."
              tailleParDefaut={50}
              videTitre="Aucune ligne"
              videDescription="Ouvrez l'inventaire pour figer le stock theorique."
            />

            {saisissable && (
              <p className="text-xs text-attenue-texte">
                Cliquez sur une quantite pour la saisir. Entree valide, Echap annule.
              </p>
            )}
          </div>
        )}
      </div>
      </PageAvecRail>

      {creation && (
        <FormulaireInventaire
          surFermeture={() => setCreation(false)}
          surSucces={(id) => {
            setCreation(false)
            setSelection(id)
            rafraichir()
          }}
        />
      )}

      {confirmation.element}
    </div>
  )
}

function FormulaireInventaire({
  surFermeture,
  surSucces,
}: {
  surFermeture: () => void
  surSucces: (id: string) => void
}) {
  const [form, setForm] = useState({ code_magasin: '', type_inventaire: 'GLOBAL' })
  const [erreur, setErreur] = useState<string | null>(null)

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_inventaire: string; numero_inventaire: string }>('/api/inventaires', form),
    onSuccess: (r) => {
      toast.success(`Inventaire ${r.numero_inventaire} cree.`)
      surSucces(r.id_inventaire)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Creation impossible.'),
  })

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu titre="Nouvel inventaire">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            creer.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Etiq htmlFor="mag" obligatoire>
              Magasin
            </Etiq>
            <Selecteur
              id="mag"
              required
              value={form.code_magasin}
              onChange={(e) => setForm({ ...form, code_magasin: e.target.value })}
            >
              <option value="">—</option>
              {qMag.data?.map((m) => (
                <option key={m.code_magasin} value={m.code_magasin}>
                  {m.nom}
                </option>
              ))}
            </Selecteur>
          </div>
          <div>
            <Etiq htmlFor="type" obligatoire>
              Type
            </Etiq>
            <Selecteur
              id="type"
              value={form.type_inventaire}
              onChange={(e) => setForm({ ...form, type_inventaire: e.target.value })}
            >
              <option value="GLOBAL">Global — tout le magasin</option>
              <option value="TOURNANT">Tournant — par rotation</option>
              <option value="CIBLE">Cible — references choisies</option>
            </Selecteur>
          </div>
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}
          <div className="flex justify-end gap-2">
            <Bouton type="button" variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton type="submit" chargement={creer.isPending}>
              Creer
            </Bouton>
          </div>
        </form>
      </DialogueContenu>
    </Dialogue>
  )
}

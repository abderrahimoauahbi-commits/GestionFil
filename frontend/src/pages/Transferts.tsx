/**
 * Transferts inter-magasins.
 *
 * Un transfert valide produit DEUX mouvements distincts (R10) : une sortie du
 * magasin source et une entree au magasin destinataire, valorisee au CMUP
 * source pour que la valeur suive la marchandise.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, PackageCheck, Pencil, Plus, Printer, Truck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  FiltrePersonnalise,
  appliquerConditions,
  type ChampFiltrable,
  type Condition,
} from '../composants/FiltrePersonnalise'

import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Alerte, Badge, Bouton, Chargement } from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { fmt } from '../lib/utils'

const MODULE = 'MOUVEMENTS'

interface Transfert extends Record<string, unknown> {
  id_transfert: string
  numero_transfert: string
  date_transfert: string
  code_magasin_source: string
  code_magasin_dest: string
  statut: string
  nb_lignes: number
  auteur: string | null
  observations: string | null
  receptionnaire: string | null
  date_reception_dest: string | null
  quantite_totale_kg: number
  jours_en_transit: number | null
}

/**
 * Le libelle compte autant que le statut.
 *
 * « VALIDE » ne dit pas ou est la marchandise. « En transit » le dit : elle a
 * quitte le magasin source et n'est arrivee nulle part. C'est un etat reel, et
 * l'ecran doit le nommer pour que personne ne compte sur un stock qui roule
 * encore.
 */
const LIBELLE: Record<string, string> = {
  BROUILLON: 'En preparation',
  VALIDE: 'En transit',
  TERMINE: 'Recu',
  ANNULE: 'Annule',
}

const CHAMPS_TRANSFERT: ChampFiltrable[] = [
  { champ: 'numero_transfert', libelle: 'Numero', type: 'texte' },
  { champ: 'date_transfert', libelle: 'Date', type: 'date' },
  { champ: 'code_magasin_source', libelle: 'Magasin source', type: 'texte' },
  { champ: 'code_magasin_dest', libelle: 'Magasin destinataire', type: 'texte' },
  { champ: 'nb_lignes', libelle: 'Nombre de lignes', type: 'nombre' },
  { champ: 'auteur', libelle: 'Auteur', type: 'texte' },
  { champ: 'observations', libelle: 'Observations', type: 'texte' },
  {
    champ: 'statut',
    libelle: 'Statut',
    type: 'liste',
    options: [
      { valeur: 'BROUILLON', libelle: 'En preparation' },
      { valeur: 'VALIDE', libelle: 'En transit' },
      { valeur: 'TERMINE', libelle: 'Recu' },
      { valeur: 'ANNULE', libelle: 'Annule' },
    ],
  },
]

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'danger' | 'alerte'> = {
  BROUILLON: 'neutre',
  // En transit : ni ici ni la-bas. C'est le seul etat qui demande une action de
  // quelqu'un d'AUTRE que celui qui l'a cree.
  VALIDE: 'alerte',
  TERMINE: 'succes',
  ANNULE: 'danger',
}

export function Transferts() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const naviguer = useNavigate()
  const [statut, setStatut] = useState('')
  const [conditions, setConditions] = useState<Condition[]>([])

  const q = useQuery({
    queryKey: ['transferts'],
    queryFn: () => api.get<Transfert[]>('/api/transferts'),
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['transferts'] })
    void qc.invalidateQueries({ queryKey: ['stock-projete'] })
    void qc.invalidateQueries({ queryKey: ['mouvements'] })
  }

  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Operation impossible.')

  /** Etape 1, au magasin SOURCE : la marchandise part. */
  const expedier = useMutation({
    mutationFn: (id: string) =>
      api.post<{
        quantite_totale_kg: number
        valeur_totale_mad: number
        mouvement: string
        magasin_destinataire: string | null
      }>(`/api/transferts/${id}/expedier`),
    onSuccess: (r) => {
      toast.success(`Expedie : ${fmt.nombre(r.quantite_totale_kg, 2)} kg partis.`, {
        description:
          `La marchandise est EN TRANSIT et n'est comptee dans aucun magasin. ` +
          `Elle entrera en stock a ${r.magasin_destinataire} quand quelqu'un y constatera ` +
          `son arrivee.`,
        duration: 10000,
      })
      rafraichir()
    },
    onError: echec,
  })

  /** Etape 2, au magasin DESTINATAIRE : quelqu'un constate l'arrivee. */
  const receptionner = useMutation({
    mutationFn: (id: string) =>
      api.post<{ quantite_totale_kg: number; valeur_totale_mad: number; mouvement: string }>(
        `/api/transferts/${id}/receptionner`,
      ),
    onSuccess: (r) => {
      toast.success(`Recu : ${fmt.nombre(r.quantite_totale_kg, 2)} kg entres en stock.`, {
        description:
          `Valorises ${fmt.nombre(r.valeur_totale_mad, 2)} MAD, au CMUP fige au depart — ` +
          `et non a celui du magasin source aujourd'hui.`,
        duration: 10000,
      })
      rafraichir()
    },
    onError: echec,
  })

  const colonnes: ColonneDT<Transfert>[] = [
    {
      champ: 'numero_mouvement',
      entete: 'Numero',
      rendu: (t) => <span className="font-mono text-xs">{t.numero_transfert}</span>,
    },
    { champ: 'date_mouvement', entete: 'Date', rendu: (t) => fmt.date(t.date_transfert) },
    {
      champ: 'code_magasin',
      entete: 'Trajet',
      rendu: (t) => (
        <div className="flex items-center gap-1.5 text-sm">
          <Badge ton="neutre">{t.code_magasin_source}</Badge>
          <ArrowRight className="size-3 text-attenue-texte" />
          <Badge ton="info">{t.code_magasin_dest}</Badge>
        </div>
      ),
    },
    {
      champ: 'quantite_kg',
      entete: 'Contenu',
      numerique: true,
      rendu: (t) => (
        <div className="text-right">
          <div className="tabular-nums">{t.nb_lignes} ligne(s)</div>
          {t.quantite_totale_kg > 0 && (
            <div className="text-[11px] tabular-nums text-attenue-texte">
              {fmt.nombre(t.quantite_totale_kg, 0)} kg
            </div>
          )}
        </div>
      ),
    },
    {
      champ: 'statut',
      entete: 'Ou est la marchandise',
      largeur: '190px',
      rendu: (t) => (
        <div>
          <Badge ton={TON[t.statut] ?? 'neutre'}>{LIBELLE[t.statut] ?? t.statut}</Badge>
          {t.statut === 'VALIDE' && (t.jours_en_transit ?? 0) > 0 && (
            <div className="mt-0.5 text-[11px] text-alerte">
              en route depuis {t.jours_en_transit} j
            </div>
          )}
        </div>
      ),
    },
    {
      champ: 'utilisateur',
      entete: 'Expedie / recu par',
      secondaire: true,
      rendu: (t) => (
        <div className="text-[12px]">
          <div>{fmt.texte(t.auteur)}</div>
          {t.receptionnaire ? (
            <div className="text-[11px] text-attenue-texte">
              recu par {t.receptionnaire}
              {t.date_reception_dest && ` le ${fmt.date(t.date_reception_dest)}`}
            </div>
          ) : (
            t.statut === 'VALIDE' && (
              <div className="text-[11px] text-alerte">arrivee non constatee</div>
            )
          )}
        </div>
      ),
    },
  ]

  const tous = q.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, t) => {
    m[t.statut] = (m[t.statut] ?? 0) + 1
    return m
  }, {})
  const vus = appliquerConditions(
    tous.filter((t) => !statut || t.statut === statut),
    conditions,
    CHAMPS_TRANSFERT,
  )

  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les transferts', compte: tous.length }] },
    {
      titre: 'Par statut',
      entrees: [
        {
          cle: 'BROUILLON',
          libelle: 'En preparation',
          resume: 'Rien n a bouge',
          compte: comptes.BROUILLON ?? 0,
          ton: 'neutre' as const,
        },
        {
          cle: 'VALIDE',
          libelle: 'En transit',
          resume: 'Parti, arrivee non constatee',
          compte: comptes.VALIDE ?? 0,
          ton: 'alerte' as const,
        },
        {
          cle: 'TERMINE',
          libelle: 'Recu',
          resume: 'Entre en stock a destination',
          compte: comptes.TERMINE ?? 0,
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

  if (q.isLoading) return <Chargement />

  return (
    <div>
      <EnTetePage
        titre="Transferts"
        description="Un transfert valide genere deux mouvements : sortie du magasin source, entree au destinataire."
        actions={
          droits.peutEcrire && (
            <Bouton onClick={() => naviguer('/transferts/nouveau')}>
              <Plus />
              Nouveau transfert
            </Bouton>
          )
        }
      />

      {(comptes.VALIDE ?? 0) > 0 && (
        <Alerte ton="alerte" titre="Marchandise en transit" className="mb-3">
          {comptes.VALIDE} transfert(s) ont quitte leur magasin source sans que l arrivee ait ete
          constatee. Cette marchandise n est comptee <strong>dans aucun magasin</strong> : elle ne
          couvre aucun besoin tant que la reception n est pas faite a destination.
        </Alerte>
      )}

      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral groupes={groupes} actif={statut} surChoix={setStatut} />
            <FiltrePersonnalise
              champs={CHAMPS_TRANSFERT}
              conditions={conditions}
              surChangement={setConditions}
            />
          </div>
        }
      >
      <DataTable<Transfert>
        module={MODULE}
        colonnes={colonnes}
        lignes={vus}
        cle={(t) => t.id_transfert}
        titreCarte={(t) => t.numero_transfert}
        placeholderRecherche="Filtrer les transferts..."
        videTitre="Aucun transfert"
        actions={(t) =>
          // Deux etapes, deux boutons, jamais les deux en meme temps : ce qui
          // est propose depend de l'endroit ou se trouve la marchandise.
          t.statut === 'BROUILLON' && droits.peutEcrire ? (
            <div className="flex gap-1">
              {/* Tant que rien n'est parti, le document se reprend en entier :
                  en-tete et lignes, sur l'ecran meme qui l'a cree. */}
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => naviguer(`/transferts/${t.id_transfert}/modifier`)}
                title="Reprendre l'en-tete et les lignes"
              >
                <Pencil />
                Modifier
              </Bouton>
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => naviguer(`/transferts/${t.id_transfert}/bon-sortie`)}
                title="Bon de sortie, a joindre au chargement"
              >
                <Printer />
                Bon
              </Bouton>
              {droits.peutValider && (
                <Bouton
                  taille="sm"
                  disabled={t.nb_lignes === 0}
                  chargement={expedier.isPending}
                  onClick={() =>
                    confirmation.demander({
                      titre: `Expedier ${t.numero_transfert} ?`,
                      description:
                        `${t.nb_lignes} ligne(s) vont QUITTER ${t.code_magasin_source}. ` +
                        `Elles ne seront comptees dans aucun magasin tant que quelqu'un ne les ` +
                        `aura pas constatees a ${t.code_magasin_dest}. Le mouvement de sortie ` +
                        `est immuable.`,
                      libelleConfirmer: 'Expedier',
                      action: () => expedier.mutate(t.id_transfert),
                    })
                  }
                >
                  <Truck />
                  Expedier
                </Bouton>
              )}
            </div>
          ) : t.statut === 'VALIDE' && droits.peutValider ? (
            <div className="flex gap-1">
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => naviguer(`/transferts/${t.id_transfert}/bon-reception`)}
                title="Bon de reception, a remplir au dechargement"
              >
                <Printer />
                Bon de reception
              </Bouton>
              <Bouton
              taille="sm"
              chargement={receptionner.isPending}
              onClick={() =>
                confirmation.demander({
                  titre: `Constater l'arrivee de ${t.numero_transfert} ?`,
                  description:
                    `${t.nb_lignes} ligne(s) entreront en stock a ${t.code_magasin_dest}, ` +
                    `valorisees au CMUP fige au depart. A ne faire qu'apres avoir vu la ` +
                    `marchandise sur place.`,
                  libelleConfirmer: 'Constater la reception',
                  action: () => receptionner.mutate(t.id_transfert),
                })
              }
            >
              <PackageCheck />
              Receptionner
            </Bouton>
            </div>
          ) : t.statut === 'TERMINE' ? (
            <Bouton
              variante="contour"
              taille="sm"
              onClick={() => naviguer(`/transferts/${t.id_transfert}/bon-sortie`)}
              title="Reimprimer le bon de sortie"
            >
              <Printer />
              Bon de sortie
            </Bouton>
          ) : null
        }
      />
      </PageAvecRail>


      {confirmation.element}
    </div>
  )
}

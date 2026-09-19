/**
 * SUPPRIMER EN SACHANT CE QU'ON SUPPRIME.
 *
 * LE PROBLEME QU'IL RESOUT. « Etes-vous sur ? » ne demande rien. Celui qui clique
 * n'en sait pas plus qu'avant, et la seule facon d'apprendre ce qui retenait la
 * ligne etait d'essayer : le serveur refusait, nommait une table, on la vidait,
 * on relancait, une autre apparaissait. Le refus arrivait APRES la decision.
 *
 * ICI L'ECRAN DEMANDE D'ABORD. A l'ouverture, il interroge
 * `/api/{entite}/{id}/retenants`, qui lit le catalogue PostgreSQL et rend TOUT
 * ce qui s'appuie sur cette ligne, avec le nombre d'enregistrements. On voit
 * donc avant de cliquer, et la question posee n'est plus « etes-vous sur ? »
 * mais « voici ce qui tient, que voulez-vous faire ? ».
 *
 * DEUX ISSUES, JAMAIS UN MUR.
 *
 *   — RIEN NE RETIENT : la ligne s'efface pour de bon. C'est le cas courant
 *     d'une saisie fausse de la veille, et rien ne justifie de la garder.
 *
 *   — QUELQUE CHOSE RETIENT : effacer briserait l'historique — un mouvement qui
 *     cite une couleur disparue ne se lit plus. On propose alors de METTRE DE
 *     COTE : la ligne quitte les listes de saisie et reste dans le passe. C'est
 *     ce que font les grands ERP, et c'est presque toujours ce qu'on voulait.
 *
 * LE NOM DES TABLES EST TRADUIT. « ligne_mouvement » ne dit rien a qui tient un
 * magasin ; « des lignes de mouvement de stock » le dit.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api, ErreurApi } from '../api/client'
import { Alerte, Bouton, Chargement } from '../composants/ui/base'
import { Dialogue, DialogueContenu } from '../composants/ui/surcouches'

interface Retenants {
  entite: string
  cle: string
  supprimable: boolean
  desactivable: boolean
  total: number
  retenants: { table: string; nb: number }[]
}

/**
 * Le nom des tables, dit dans la langue du metier.
 *
 * Ce qui n'est pas traduit sort tel quel : un nom technique reste plus utile
 * qu'un « quelque chose » qui n'aide personne a comprendre.
 */
const NOM_METIER: Record<string, string> = {
  // Stock et grand livre
  mouvement: 'mouvements de stock',
  ligne_mouvement: 'lignes de mouvement de stock',
  stock_magasin: 'lignes de stock en magasin',
  stock_lot: 'lots en stock',
  valorisation_stock: 'lignes de valorisation',
  transfert: 'transferts',
  ligne_transfert: 'lignes de transfert',
  inventaire: 'inventaires',
  ligne_inventaire: 'lignes d inventaire',
  // Achats
  bon_commande: 'bons de commande',
  ligne_bc: 'lignes de bon de commande',
  reception: 'receptions',
  ligne_reception: 'lignes de reception',
  archive_reception: 'receptions archivees',
  plan_achat: 'propositions d achat',
  fournisseur: 'fournisseurs',
  contact_fournisseur: 'contacts fournisseur',
  couleur_fournisseur: 'correspondances de couleur',
  // Catalogue
  reference: 'references du catalogue',
  famille: 'familles',
  categorie_matiere: 'categories de matiere',
  couleur: 'couleurs',
  groupe_equiv: 'groupes d equivalence',
  reference_groupe_equiv: 'references equivalentes',
  historique_prix: 'releves de prix',
  // Production
  qualite: 'qualites',
  ligne_qualite: 'lignes de composition',
  recette: 'recettes',
  plan_production: 'plans de production',
  ligne_plan_production: 'lignes de plan',
  plan_qualite: 'qualites planifiees',
  plan_saisonnalite: 'coefficients de saisonnalite',
  besoin_mrp: 'besoins calcules',
  snapshot_mrp: 'archives de calcul',
  // Machines
  machine: 'machines',
  machine_etat: 'constats de machine',
  machine_emplacement: 'emplacements de machine',
  machine_fiche: 'fiches de machine',
  machine_fiche_ligne: 'lignes de fiche machine',
  machine_consommation: 'consommations machine',
  machine_cliche: 'cliches de machine',
  // Import
  import_dossiers: 'dossiers d import',
  import_factures: 'factures d import',
  import_facture_lignes: 'lignes de facture d import',
  import_receptions: 'receptions d import',
  import_reception_lignes: 'lignes de reception d import',
  frais_approche: 'frais d approche',
  // Structure et journal
  magasin: 'magasins',
  entreprise: 'etablissements',
  utilisateur: 'comptes utilisateur',
  role_utilisateur: 'roles',
  droit_champ: 'droits par champ',
  permission: 'permissions',
  audit_log: 'lignes du journal',
  journal_connexion: 'connexions enregistrees',
  alerte: 'alertes',
  piece_jointe: 'pieces jointes',
  type_mouvement: 'types de mouvement',
  motif_mouvement: 'motifs de mouvement',
  motif_ligne: 'motifs de ligne',
  devise: 'devises',
  taux_change: 'taux de change',
  cours_bam: 'cours Bank Al-Maghrib',
}

function nommer(table: string) {
  return NOM_METIER[table] ?? `lignes de « ${table} »`
}

export function DialogueSuppression({
  ouvert,
  surFermeture,
  entite,
  id,
  /** Ce qu'on montre a l'utilisateur : « la famille COTON », pas « COT ». */
  libelle,
  /** Rafraichissement de l'ecran appelant, une fois le geste passe. */
  surSucces,
}: {
  ouvert: boolean
  surFermeture: () => void
  entite: string
  id: string
  libelle?: string
  surSucces?: () => void
}) {
  const qc = useQueryClient()
  const nom = libelle ?? id

  // ON DEMANDE A L'OUVERTURE, PAS AVANT. Interroger le serveur pour chaque
  // ligne d'une liste de trois cents couterait trois cents requetes pour un
  // bouton qu'on ne cliquera pas.
  const q = useQuery({
    queryKey: ['retenants', entite, id],
    queryFn: () =>
      api.get<Retenants>(`/api/${entite}/${encodeURIComponent(id)}/retenants`),
    enabled: ouvert && !!id,
    staleTime: 0,
  })

  function apresCoup(message: string) {
    return {
      onSuccess: async () => {
        await qc.invalidateQueries()
        toast.success(message)
        surFermeture()
        surSucces?.()
      },
      onError: (e: unknown) =>
        toast.error(e instanceof ErreurApi ? e.message : String(e)),
    }
  }

  const effacer = useMutation({
    mutationFn: () => api.delete(`/api/${entite}/${encodeURIComponent(id)}`),
    ...apresCoup(`${nom} supprime.`),
  })

  const mettreDeCote = useMutation({
    mutationFn: () =>
      api.post(`/api/${entite}/${encodeURIComponent(id)}/activation`, { actif: false }),
    ...apresCoup(`${nom} mis de cote : il reste dans l historique.`),
  })

  const d = q.data
  const enCours = effacer.isPending || mettreDeCote.isPending

  return (
    <Dialogue open={ouvert} onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        titre={`Supprimer ${nom} ?`}
        description="Ce que l ERP sait de cette ligne avant de la retirer."
      >
        <div className="flex flex-col gap-3 p-4 text-[13px] leading-relaxed">
          {q.isLoading && <Chargement texte="Recherche de ce qui s appuie dessus…" />}

          {d?.supprimable && (
            <Alerte ton="info">
              <strong>Rien ne s appuie sur cette ligne.</strong> Elle sera effacee pour de bon —
              le journal en gardera la trace, avec votre nom et l heure.
            </Alerte>
          )}

          {d && !d.supprimable && (
            <>
              <Alerte ton="alerte" titre="Cette ligne est retenue">
                <strong>{d.total}</strong> enregistrement(s) la citent. L effacer les rendrait
                illisibles : un mouvement qui nomme une matiere disparue ne se comprend plus.
              </Alerte>

              <ul className="divide-y divide-bordure/60 rounded-[var(--radius-sm)] border border-bordure">
                {d.retenants.map((r) => (
                  <li key={r.table} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                    <span>{nommer(r.table)}</span>
                    <span className="font-medium tabular-nums">{r.nb}</span>
                  </li>
                ))}
              </ul>

              {d.desactivable ? (
                <p className="text-attenue-texte">
                  Vous pouvez la <strong>mettre de cote</strong> : elle disparait des listes de
                  saisie, et tout ce qui la cite continue de fonctionner. C est le geste juste
                  pour une matiere qu on ne commande plus.
                </p>
              ) : (
                <p className="text-attenue-texte">
                  Pour l effacer, il faut d abord retirer ou rattacher ailleurs ce qui la cite.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-bordure p-3">
          <Bouton variante="contour" taille="sm" onClick={surFermeture} disabled={enCours}>
            Annuler
          </Bouton>

          {d && !d.supprimable && d.desactivable && (
            <Bouton
              variante="contour"
              taille="sm"
              chargement={mettreDeCote.isPending}
              onClick={() => mettreDeCote.mutate()}
            >
              <Archive />
              Mettre de cote
            </Bouton>
          )}

          <Bouton
            variante="danger"
            taille="sm"
            disabled={!d?.supprimable || enCours}
            chargement={effacer.isPending}
            onClick={() => effacer.mutate()}
            title={
              d && !d.supprimable
                ? 'Impossible tant que des enregistrements la citent'
                : undefined
            }
          >
            {d && !d.supprimable ? <AlertTriangle /> : <Trash2 />}
            Supprimer definitivement
          </Bouton>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

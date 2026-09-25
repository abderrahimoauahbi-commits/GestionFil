/**
 * Bons de commande — LISTE.
 *
 * Cette page ne fait qu'une chose : montrer les bons, leur statut et leur
 * avancement de livraison. La saisie et le suivi d'un bon ont leur propre page,
 * parce qu'un bon se prepare sur des semaines et qu'on y revient : melanger la
 * liste et le document obligeait a re-parcourir tous les bons a chaque retour.
 *
 * Les colonnes reprennent le bloc « En-tetes BC » de la feuille Commandes :
 * n°, date, fournisseur, livraison prevue, statut, montant devise et MAD,
 * % livre, nombre de lignes, statut de livraison.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useOuvrirVue } from '../lib/navigation'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Badge, Bouton } from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { SUPPRIMABLES } from '../lib/statuts'

const MODULE = 'BONS_COMMANDE'

interface Bc extends Record<string, unknown> {
  id_bc: string
  numero_bc: string
  date_bc: string
  code_fournisseur: string
  fournisseur_nom: string
  date_livraison_prevue: string | null
  statut: string
  code_devise: string
  montant_total_devise?: number
  montant_total_mad?: number
  nb_lignes: number
  reste_a_livrer_kg?: number
  quantite_commandee_kg?: number
  quantite_recue_kg?: number
  pct_livre?: number
  statut_livraison?: string
  date_validation: string | null
  date_envoi: string | null
  createur: string | null
  valideur: string | null
}

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'alerte' | 'danger'> = {
  BROUILLON: 'neutre',
  EN_ATTENTE_VALIDATION: 'alerte',
  VALIDE: 'info',
  ENVOYE: 'info',
  LIVRE_PARTIEL: 'alerte',
  CLOTURE: 'succes',
  ANNULE: 'danger',
}

/** L'etat de la livraison, distinct du statut du bon : un bon envoye peut etre
 *  deja en retard, et c'est ce que l'acheteur doit voir en premier. */
const TON_LIVRAISON: Record<string, 'neutre' | 'info' | 'succes' | 'alerte' | 'danger'> = {
  ATTENDU: 'info',
  PARTIEL: 'alerte',
  'PARTIEL EN RETARD': 'danger',
  'EN RETARD': 'danger',
  COMPLET: 'succes',
}

const LIBELLE: Record<string, string> = {
  BROUILLON: 'Brouillon',
  EN_ATTENTE_VALIDATION: 'A valider',
  VALIDE: 'Valide',
  ENVOYE: 'Envoye',
  LIVRE_PARTIEL: 'Livre partiel',
  CLOTURE: 'Cloture',
  ANNULE: 'Annule',
}

/**
 * Les statuts qui n'engagent RIEN, et se suppriment donc pour de bon.
 *
 * Un bon soumis a validation en fait partie : personne ne l'a signe, aucun
 * fournisseur n'a ete prevenu, aucun stock n'a bouge. Des qu'il est valide,
 * il a engage l'entreprise — il s'annule, il ne s'efface plus.
 */

export function BonsCommande() {
  const droits = useDroits(MODULE)
  const ouvrirEtat = useOuvrirVue()
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const confirmation = useConfirmation()

  const q = useQuery({
    queryKey: ['bons-commande'],
    queryFn: () => api.get<Bc[]>('/api/bons-commande'),
  })

  /**
   * LA VRAIE SUPPRESSION, pour ce qui n'a jamais engage personne.
   *
   * Un bon annule reste dans la liste, dans les etats, dans la numerotation.
   * C'est juste pour un document qui a engage quelque chose. Mais un brouillon
   * — et un bon seulement SOUMIS a validation — n'a prevenu aucun fournisseur
   * et n'a fait bouger aucun stock. Le garder « annule » pour la forme
   * encombre la liste de documents qui n'ont jamais existe pour personne.
   *
   * Le serveur tient la limite : des qu'un bon est valide, il refuse.
   */
  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/bons-commande/${id}`),
    onSuccess: () => {
      toast.success('Bon supprime', {
        description: 'Il n’engageait rien : ses propositions d’achat sont revenues au plan.',
      })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Suppression impossible.'),
  })

  const annuler = useMutation({
    mutationFn: (id: string) => api.put(`/api/bons-commande/${id}/statut`, { statut: 'ANNULE' }),
    onSuccess: () => {
      toast.success('Bon annule', {
        description: 'Ses propositions d’achat sont revenues au plan.',
      })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Annulation impossible.'),
  })

  const lignes = q.data ?? []

  const totaux = useMemo(() => {
    const ouverts = lignes.filter((b) => !['CLOTURE', 'ANNULE'].includes(b.statut))
    return {
      ouverts: ouverts.length,
      engage: ouverts.reduce((s, b) => s + (b.montant_total_mad ?? 0), 0),
      aValider: lignes.filter((b) => b.statut === 'EN_ATTENTE_VALIDATION').length,
      brouillons: lignes.filter((b) => b.statut === 'BROUILLON').length,
    }
  }, [lignes])

  const colonnes: ColonneDT<Bc>[] = [
    {
      champ: 'numero_bc',
      entete: 'N° BC',
      largeur: '150px',
      filtre: 'texte',
      rendu: (b) => (
        <div className="min-w-0">
          <div className="font-medium">{b.numero_bc}</div>
          <div className="text-[11px] text-attenue-texte">{fmt.date(b.date_bc)}</div>
        </div>
      ),
    },
    {
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      filtre: 'texte',
      rendu: (b) => (
        <div className="min-w-0">
          <div className="truncate">{b.fournisseur_nom}</div>
          <div className="text-[11px] text-attenue-texte">{b.code_fournisseur}</div>
        </div>
      ),
    },
    {
      champ: 'statut',
      entete: 'Statut',
      largeur: '130px',
      filtre: 'liste',
      rendu: (b) => <Badge ton={TON[b.statut] ?? 'neutre'}>{LIBELLE[b.statut] ?? b.statut}</Badge>,
    },
    {
      champ: 'date_livraison_prevue',
      entete: 'Livraison',
      largeur: '110px',
      rendu: (b) => (b.date_livraison_prevue ? fmt.date(b.date_livraison_prevue) : '—'),
    },
    {
      champ: 'nb_lignes',
      entete: 'Lignes',
      numerique: true,
      largeur: '80px',
      rendu: (b) => fmt.entier(b.nb_lignes),
    },
    {
      champ: 'montant_total_devise',
      entete: 'Montant devise',
      numerique: true,
      largeur: '150px',
      rendu: (b) =>
        b.montant_total_devise == null
          ? '—'
          : `${fmt.nombre(b.montant_total_devise, 2)} ${b.code_devise}`,
    },
    {
      champ: 'montant_total_mad',
      entete: 'Montant MAD',
      numerique: true,
      largeur: '140px',
      rendu: (b) => (b.montant_total_mad == null ? '—' : fmt.mad(b.montant_total_mad)),
    },
    {
      champ: 'date_validation',
      entete: 'Validation',
      largeur: '150px',
      rendu: (b) =>
        b.date_validation ? (
          <div>
            <div className="tabular-nums">{fmt.date(b.date_validation)}</div>
            {b.valideur && (
              <div className="text-[11px] text-attenue-texte">{b.valideur}</div>
            )}
          </div>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
    {
      // Colonne I de la feuille : quantite recue sur quantite commandee. Elle se
      // CALCULE depuis les lignes, donc elle ne peut pas diverger des receptions.
      champ: 'pct_livre',
      entete: '% livre',
      numerique: true,
      largeur: '130px',
      rendu: (b) => {
        if (['BROUILLON', 'EN_ATTENTE_VALIDATION', 'ANNULE'].includes(b.statut)) {
          return <span className="text-attenue-texte">—</span>
        }
        const pct = b.pct_livre ?? 0
        return (
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5">
              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-attenue">
                <div
                  className={cn(
                    'h-full rounded-full',
                    pct >= 99.9 ? 'bg-succes' : pct > 0 ? 'bg-info' : 'bg-bordure',
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <span className="tabular-nums">{fmt.nombre(pct, 0)} %</span>
            </div>
            {(b.reste_a_livrer_kg ?? 0) > 0.001 && (
              <div className="text-[11px] text-attenue-texte tabular-nums">
                reste {fmt.nombre(b.reste_a_livrer_kg ?? 0, 0)} kg
              </div>
            )}
          </div>
        )
      },
    },
    {
      // Colonne K de la feuille : l'etat de la livraison, distinct du statut du
      // bon. Un bon peut etre ENVOYE et deja en retard.
      champ: 'statut_livraison',
      entete: 'Livraison',
      largeur: '150px',
      filtre: 'liste',
      rendu: (b) =>
        !b.statut_livraison || b.statut_livraison === 'SANS OBJET' ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <Badge ton={TON_LIVRAISON[b.statut_livraison] ?? 'neutre'}>{b.statut_livraison}</Badge>
        ),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Bons de commande"
        description="Ouvrir un bon pour saisir ses lignes, negocier et suivre les livraisons."
        actions={
          droits.peutEcrire && (
            <Bouton taille="icone" title="Nouveau bon" aria-label="Nouveau bon" onClick={() => naviguer('/bons-commande/nouveau')}>              <Plus />            </Bouton>
          )
        }
      />

      {lignes.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="rounded-[var(--radius)] border border-bordure bg-surface px-4 py-2.5">
            <div className="text-[11px] text-attenue-texte">Engage, bons ouverts</div>
            <div className="text-lg font-semibold tabular-nums">{fmt.mad(totaux.engage)}</div>
          </div>
          <div className="rounded-[var(--radius)] border border-bordure bg-surface px-4 py-2.5">
            <div className="text-[11px] text-attenue-texte">Bons ouverts</div>
            <div className="text-lg font-semibold tabular-nums">{totaux.ouverts}</div>
          </div>
          {totaux.brouillons > 0 && (
            <div className="rounded-[var(--radius)] border border-bordure bg-surface px-4 py-2.5">
              <div className="text-[11px] text-attenue-texte">En brouillon</div>
              <div className="text-lg font-semibold tabular-nums">{totaux.brouillons}</div>
            </div>
          )}
          {totaux.aValider > 0 && (
            <div className="rounded-[var(--radius)] border border-alerte bg-alerte/5 px-4 py-2.5">
              <div className="text-[11px] text-attenue-texte">En attente de validation</div>
              <div className="text-lg font-semibold tabular-nums text-alerte">
                {totaux.aValider}
              </div>
            </div>
          )}
        </div>
      )}

      <DataTable<Bc>
          exportable="bons-de-commande"
          imprimable="Bons de commande"
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        cle={(b) => b.id_bc}
        surClic={(b) => naviguer(`/bons-commande/${b.id_bc}`)}
        placeholderRecherche="N° de bon, fournisseur, statut..."
        titreCarte={(b) => `${b.numero_bc} — ${b.fournisseur_nom}`}
        videTitre="Aucun bon de commande"
        videDescription="Les bons naissent du plan d'achat, ou se creent a la main."
        actions={(b) => (
          <div className="flex justify-end gap-0.5">
            <Bouton
              variante="discret"
              taille="icone-xs"
              onClick={() => ouvrirEtat(`/bons-commande/${b.id_bc}/etat`)}
              aria-label="Imprimer"
              title="Imprimer le bon"
            >
              <Printer />
            </Bouton>
            <Bouton
              variante="discret"
              taille="icone-xs"
              onClick={() => naviguer(`/bons-commande/${b.id_bc}`)}
              aria-label="Ouvrir"
              title="Ouvrir le bon"
            >
              <FileText />
            </Bouton>
            {/* LE BOUTON DIT CE QU'IL FAIT. Il annoncait « Annuler le bon »
                meme quand il EFFACE un brouillon, si bien qu'on croyait garder
                une trace la ou il n'en reste aucune. Un brouillon n'a que deux
                issues : on le complete, ou il disparait. Annuler et le laisser
                en base ne servirait qu'a encombrer la liste d'un document mort
                dont le numero n'a jamais rien engage. */}
            {droits.peutEcrire && !['CLOTURE', 'ANNULE'].includes(b.statut) && (
              <Bouton
                variante="discret"
                taille="icone-xs"
                className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: SUPPRIMABLES.includes(b.statut)
                      ? `Supprimer ${b.numero_bc} ?`
                      : `Annuler ${b.numero_bc} ?`,
                    destructif: true,
                    libelleConfirmer: SUPPRIMABLES.includes(b.statut)
                      ? 'Supprimer definitivement'
                      : 'Annuler le bon',
                    description: SUPPRIMABLES.includes(b.statut)
                      ? 'Ce bon n’engage rien : il sera EFFACE, sans laisser de trace dans ' +
                        'la liste ni dans les etats. Ses propositions d’achat reviendront au plan.'
                      : 'Ses lignes seront annulees et les propositions d’achat qui les ont ' +
                        'produites reviendront au plan. Le bon restera visible, marque annule.',
                    action: () =>
                      SUPPRIMABLES.includes(b.statut)
                        ? supprimer.mutate(b.id_bc)
                        : annuler.mutate(b.id_bc),
                  })
                }
                aria-label={SUPPRIMABLES.includes(b.statut) ? 'Supprimer' : 'Annuler'}
                title={
                  SUPPRIMABLES.includes(b.statut)
                    ? 'Supprimer definitivement ce brouillon'
                    : 'Annuler le bon'
                }
              >
                <Trash2 />
              </Bouton>
            )}
          </div>
        )}
      />

      {confirmation.element}
    </div>
  )
}

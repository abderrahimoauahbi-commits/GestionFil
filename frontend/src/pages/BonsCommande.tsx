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
            <Bouton onClick={() => naviguer('/bons-commande/nouveau')}>
              <Plus />
              Nouveau bon
            </Bouton>
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
            {droits.peutEcrire && !['CLOTURE', 'ANNULE'].includes(b.statut) && (
              <Bouton
                variante="discret"
                taille="icone-xs"
                className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: `Annuler ${b.numero_bc} ?`,
                    destructif: true,
                    libelleConfirmer: 'Annuler le bon',
                    description:
                      'Ses lignes seront annulees et les propositions d’achat qui les ont ' +
                      'produites reviendront au plan.',
                    action: () => annuler.mutate(b.id_bc),
                  })
                }
                aria-label="Annuler"
                title="Annuler le bon"
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

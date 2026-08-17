/**
 * Receptions — LISTE.
 *
 * Une reception se prepare au quai : le camion arrive, on compte les colis, on
 * pese, on releve les lots. C'est un document, pas une saisie unique — d'ou une
 * page pour la liste et une pour le document, comme les bons de commande.
 *
 * Les colonnes disent l'avancement de la chaine : quel bon, combien de lignes
 * pesees, ou en est le controle qualite. Le poids et la valorisation ne se
 * fixent qu'a la validation, par la cascade.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Badge, Bouton } from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'RECEPTIONS'

interface Reception extends Record<string, unknown> {
  id_reception: string
  numero_reception: string
  date_reception: string
  code_fournisseur: string
  fournisseur_nom: string
  numero_bc: string | null
  id_bc: string | null
  num_bon_livraison: string | null
  numero_facture: string | null
  transporteur: string | null
  nombre_colis: number | null
  poids_total_brut_kg: number | null
  statut: string
  nb_lignes: number
  receptionnaire: string | null
  controleur: string | null
  date_controle: string | null
  delai_reel_jours: number | null
  delai_prevu_jours: number | null
  retard_jours: number | null
  on_time: number | null
  in_full: number | null
  in_spec: number | null
}

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'alerte' | 'danger'> = {
  BROUILLON: 'neutre',
  A_CONTROLER: 'alerte',
  VALIDE: 'succes',
  CLOTURE: 'info',
  ANNULE: 'danger',
}

const LIBELLE: Record<string, string> = {
  BROUILLON: 'En saisie',
  A_CONTROLER: 'A controler',
  VALIDE: 'Validee',
  CLOTURE: 'Cloturee',
  ANNULE: 'Annulee',
}

export function Receptions() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const confirmation = useConfirmation()

  const q = useQuery({
    queryKey: ['receptions'],
    queryFn: () => api.get<Reception[]>('/api/receptions'),
  })

  const annuler = useMutation({
    mutationFn: (id: string) => api.put(`/api/receptions/${id}/statut`, { statut: 'ANNULE' }),
    onSuccess: () => {
      toast.success('Reception annulee')
      void qc.invalidateQueries({ queryKey: ['receptions'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Annulation impossible.'),
  })

  const lignes = q.data ?? []
  const totaux = useMemo(() => {
    // OTIF = produit des trois criteres, jamais leur moyenne : une livraison a
    // l'heure mais incomplete ne sert a rien a l'atelier. On ne compte que les
    // receptions MESURABLES — sans bon de commande, il n'y a pas de promesse a
    // comparer, et les inclure ferait mentir le taux.
    const mesurables = lignes.filter(
      (r) => ['VALIDE', 'CLOTURE'].includes(r.statut) && r.on_time != null,
    )
    const otif = mesurables.filter(
      (r) => r.on_time === 1 && r.in_full !== 0 && r.in_spec !== 0,
    ).length
    return {
      enSaisie: lignes.filter((r) => r.statut === 'BROUILLON').length,
      aControler: lignes.filter((r) => r.statut === 'A_CONTROLER').length,
      mesurables: mesurables.length,
      otif,
      tauxOtif: mesurables.length ? (otif / mesurables.length) * 100 : null,
      enRetard: mesurables.filter((r) => (r.retard_jours ?? 0) > 0).length,
    }
  }, [lignes])

  const colonnes: ColonneDT<Reception>[] = [
    {
      champ: 'numero_reception',
      entete: 'N° reception',
      largeur: '160px',
      filtre: 'texte',
      rendu: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.numero_reception}</div>
          <div className="text-[11px] text-attenue-texte">{fmt.date(r.date_reception)}</div>
        </div>
      ),
    },
    {
      champ: 'fournisseur_nom',
      entete: 'Fournisseur',
      filtre: 'texte',
      rendu: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.fournisseur_nom}</div>
          <div className="text-[11px] text-attenue-texte">{r.code_fournisseur}</div>
        </div>
      ),
    },
    {
      champ: 'numero_bc',
      entete: 'Bon de commande',
      largeur: '150px',
      rendu: (r) =>
        r.numero_bc ? (
          <span className="tabular-nums">{r.numero_bc}</span>
        ) : (
          <span className="text-attenue-texte">hors commande</span>
        ),
    },
    {
      champ: 'num_bon_livraison',
      entete: 'Bon de livraison',
      largeur: '150px',
      rendu: (r) => (
        <div className="min-w-0">
          <div className="truncate">
            {r.num_bon_livraison ?? <span className="text-attenue-texte">—</span>}
          </div>
          {r.numero_facture && (
            <div className="truncate text-[11px] text-attenue-texte">
              facture {r.numero_facture}
            </div>
          )}
        </div>
      ),
    },
    {
      champ: 'statut',
      entete: 'Statut',
      largeur: '130px',
      filtre: 'liste',
      rendu: (r) => <Badge ton={TON[r.statut] ?? 'neutre'}>{LIBELLE[r.statut] ?? r.statut}</Badge>,
    },
    {
      champ: 'nb_lignes',
      entete: 'Lignes',
      numerique: true,
      largeur: '80px',
      rendu: (r) => fmt.entier(r.nb_lignes),
    },
    {
      champ: 'nombre_colis',
      entete: 'Colis',
      numerique: true,
      largeur: '80px',
      secondaire: true,
      rendu: (r) => (r.nombre_colis == null ? '—' : fmt.entier(r.nombre_colis)),
    },
    {
      // Trois criteres, un verdict : le produit, pas la moyenne. Les afficher
      // separement laisse voir POURQUOI une livraison manque son OTIF.
      champ: 'on_time',
      entete: 'OTIF',
      largeur: '180px',
      rendu: (r) => {
        if (r.on_time == null) return <span className="text-attenue-texte">non mesurable</span>
        const ok = r.on_time === 1 && r.in_full !== 0 && r.in_spec !== 0
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge ton={ok ? 'succes' : 'danger'}>{ok ? 'OTIF' : 'manque'}</Badge>
            <span className="text-[11px] text-attenue-texte">
              {[
                r.on_time === 1 ? null : 'retard',
                r.in_full === 0 ? 'incomplet' : null,
                r.in_spec === 0 ? 'non conforme' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )
      },
    },
    {
      champ: 'retard_jours',
      entete: 'Delai',
      numerique: true,
      largeur: '130px',
      rendu: (r) => {
        if (r.delai_reel_jours == null) return <span className="text-attenue-texte">—</span>
        const retard = r.retard_jours ?? 0
        return (
          <div className="text-right">
            <div className={cn('tabular-nums', retard > 0 && 'font-medium text-danger')}>
              {fmt.entier(r.delai_reel_jours)} j
            </div>
            <div className="text-[11px] tabular-nums text-attenue-texte">
              {r.delai_prevu_jours == null
                ? '—'
                : retard > 0
                  ? `promis ${fmt.entier(r.delai_prevu_jours)} j · +${fmt.entier(retard)}`
                  : `promis ${fmt.entier(r.delai_prevu_jours)} j`}
            </div>
          </div>
        )
      },
    },
    {
      champ: 'poids_total_brut_kg',
      entete: 'Poids brut',
      numerique: true,
      largeur: '120px',
      secondaire: true,
      rendu: (r) =>
        r.poids_total_brut_kg == null ? '—' : `${fmt.nombre(r.poids_total_brut_kg, 0)} kg`,
    },
    {
      champ: 'transporteur',
      entete: 'Transporteur',
      largeur: '140px',
      secondaire: true,
      rendu: (r) => r.transporteur ?? <span className="text-attenue-texte">—</span>,
    },
    {
      champ: 'receptionnaire',
      entete: 'Pesee par',
      largeur: '130px',
      secondaire: true,
      rendu: (r) => r.receptionnaire ?? <span className="text-attenue-texte">—</span>,
    },
    {
      champ: 'date_controle',
      entete: 'Controle',
      largeur: '150px',
      rendu: (r) =>
        r.date_controle ? (
          <div>
            <div className="tabular-nums">{fmt.date(r.date_controle)}</div>
            {r.controleur && <div className="text-[11px] text-attenue-texte">{r.controleur}</div>}
          </div>
        ) : (
          <span className="text-attenue-texte">—</span>
        ),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Receptions"
        description="Ouvrir une reception pour peser, relever les lots et soumettre au controle qualite."
        actions={
          droits.peutEcrire && (
            <Bouton onClick={() => naviguer('/receptions/nouvelle')}>
              <Plus />
              Nouvelle reception
            </Bouton>
          )
        }
      />

      {(totaux.enSaisie > 0 || totaux.aControler > 0 || totaux.mesurables > 0) && (
        <div className="mb-4 flex flex-wrap gap-3">
          {totaux.enSaisie > 0 && (
            <div className="rounded-[var(--radius)] border border-bordure bg-surface px-4 py-2.5">
              <div className="text-[11px] text-attenue-texte">En saisie</div>
              <div className="text-lg font-semibold tabular-nums">{totaux.enSaisie}</div>
            </div>
          )}
          {totaux.aControler > 0 && (
            <div className="rounded-[var(--radius)] border border-alerte bg-alerte/5 px-4 py-2.5">
              <div className="text-[11px] text-attenue-texte">En attente de controle</div>
              <div className="text-lg font-semibold tabular-nums text-alerte">
                {totaux.aControler}
              </div>
            </div>
          )}
          {totaux.tauxOtif != null && (
            <div
              className={cn(
                'rounded-[var(--radius)] border px-4 py-2.5',
                totaux.tauxOtif >= 95 ? 'border-succes bg-succes/5' : 'border-alerte bg-alerte/5',
              )}
            >
              <div className="text-[11px] text-attenue-texte">
                OTIF sur {totaux.mesurables} livraison(s)
              </div>
              <div
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  totaux.tauxOtif >= 95 ? 'text-succes' : 'text-alerte',
                )}
              >
                {fmt.nombre(totaux.tauxOtif, 1)} %
              </div>
              <div className="text-[11px] text-attenue-texte">
                {totaux.otif} a l'heure, completes et conformes
              </div>
            </div>
          )}
          {totaux.enRetard > 0 && (
            <div className="rounded-[var(--radius)] border border-danger bg-danger/5 px-4 py-2.5">
              <div className="text-[11px] text-attenue-texte">Livrees en retard</div>
              <div className="text-lg font-semibold tabular-nums text-danger">
                {totaux.enRetard}
              </div>
            </div>
          )}
        </div>
      )}

      <DataTable<Reception>
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        cle={(r) => r.id_reception}
        surClic={(r) => naviguer(`/receptions/${r.id_reception}`)}
        placeholderRecherche="N° de reception, fournisseur, bon de livraison..."
        titreCarte={(r) => `${r.numero_reception} — ${r.fournisseur_nom}`}
        videTitre="Aucune reception"
        videDescription="Une reception se rattache a un bon de commande envoye, ou se saisit librement."
        actions={(r) => (
          <div className="flex justify-end gap-0.5">
            <Bouton
              variante="discret"
              taille="icone-xs"
              onClick={() => naviguer(`/receptions/${r.id_reception}`)}
              aria-label="Ouvrir"
              title="Ouvrir la reception"
            >
              <FileText />
            </Bouton>
            {droits.peutEcrire && r.statut === 'BROUILLON' && (
              <Bouton
                variante="discret"
                taille="icone-xs"
                className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: `Annuler ${r.numero_reception} ?`,
                    destructif: true,
                    libelleConfirmer: 'Annuler',
                    description: "Rien n'est encore entre en stock : la reception sera abandonnee.",
                    action: () => annuler.mutate(r.id_reception),
                  })
                }
                aria-label="Annuler"
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

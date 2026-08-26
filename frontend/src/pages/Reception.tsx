/**
 * Reception — DOCUMENT : en-tete, pesees, controle qualite.
 *
 * La saisie propose ce qui est ATTENDU : les lignes du bon de commande encore a
 * livrer, avec ce qui reste du. Sans cela, le magasinier choisit une reference
 * dans le catalogue et saisit un poids sans savoir ce qui etait commande — c'est
 * ainsi qu'on receptionne la mauvaise couleur, ou deux fois la meme palette.
 *
 * Rien ne part au serveur pendant la saisie : pesees, corrections, retraits et
 * en-tete attendent l'enregistrement. Une pesee corrigee doit pouvoir l'etre
 * avant d'exister, pas apres.
 *
 * La VALIDATION, elle, est autre chose : c'est la cascade — stock, CMUP,
 * archive, historique de prix — et elle appartient au controle qualite, pas au
 * peseur (separation B4).
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Send, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { Dialogue, DialogueContenu } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'RECEPTIONS'
/** Au-dela, l'ecart de pesee exige une derogation motivee (controle C10). */
const TOLERANCE_PCT = 2

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
  // OTIF : produit de trois conditions, pas moyenne. A l'heure mais incomplet
  // vaut zero — c'est la seule lecture honnete d'une livraison.
  delai_reel_jours: number | null
  delai_prevu_jours: number | null
  retard_jours: number | null
  on_time: number | null
  in_full: number | null
  in_spec: number | null
}

interface LigneRec extends Record<string, unknown> {
  id_ligne_reception: string
  ligne_numero: number
  code_reference: string
  reference_designation: string
  unite_saisie: string
  quantite_pesee_unite: number
  quantite_stock_kg: number
  quantite_commandee_kg: number | null
  quantite_bl_kg: number | null
  ecart_pct: number | null
  ecart_bl_kg: number | null
  ecart_cmd_kg: number | null
  nb_colis_ligne: number | null
  poids_moyen_colis_kg: number | null
  prix_kg_devise?: number
  code_devise?: string
  prix_kg_mad?: number
  lot_fournisseur: string | null
  statut_qualite: string
  code_magasin_dest: string
}

interface LigneAttendue extends Record<string, unknown> {
  id_ligne_bc: string
  code_reference: string
  designation: string
  unite_commande: string
  quantite_commandee_kg: number
  quantite_recue_kg: number
  quantite_restante_kg: number
  prix_kg_devise?: number
  code_devise?: string
  unite_catalogue: string
  suivi_lot: number
  deja_pesee_kg: number
  numero_bc: string
  date_livraison_prevue: string | null
  retard_jours: number | null
}

/** Une pesee saisie mais pas encore enregistree. */
interface Pesee {
  cle: string
  id_ligne_bc: string | null
  code_reference: string
  designation: string
  unite_saisie: string
  quantite: number
  quantite_bl: number | null
  attendu_kg: number | null
  colis: number | null
  lot: string
  magasin: string
  statut_qualite: string
}

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'alerte' | 'danger'> = {
  BROUILLON: 'neutre',
  A_CONTROLER: 'alerte',
  VALIDE: 'succes',
  CLOTURE: 'info',
  ANNULE: 'danger',
}

const TON_QUALITE: Record<string, 'succes' | 'alerte' | 'danger'> = {
  CONFORME: 'succes',
  QUARANTAINE: 'alerte',
  NON_CONFORME: 'danger',
}

export function Reception() {
  const { id = '' } = useParams()
  const droits = useDroits(MODULE)
  const { moi } = useAuth()
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const [saisie, setSaisie] = useState(false)

  const [entete, setEntete] = useState({
    num_bon_livraison: '',
    numero_facture: '',
    transporteur: '',
    nombre_colis: '',
    poids_total_brut_kg: '',
  })
  const [pesees, setPesees] = useState<Pesee[]>([])
  const [supprimees, setSupprimees] = useState<string[]>([])

  const qRec = useQuery({
    queryKey: ['receptions'],
    queryFn: () => api.get<Reception[]>('/api/receptions'),
  })
  const rec = qRec.data?.find((r) => r.id_reception === id) ?? null

  const qLignes = useQuery({
    queryKey: ['lignes-reception', id],
    queryFn: () => api.get<LigneRec[]>(`/api/receptions/${id}/lignes`),
    enabled: !!id,
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['receptions'] })
    void qc.invalidateQueries({ queryKey: ['lignes-reception'] })
    void qc.invalidateQueries({ queryKey: ['lignes-attendues'] })
    void qc.invalidateQueries({ queryKey: ['stock-projete'] })
    void qc.invalidateQueries({ queryKey: ['bons-commande'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Operation impossible.')

  useEffect(() => {
    if (!rec) return
    setEntete({
      num_bon_livraison: rec.num_bon_livraison ?? '',
      numero_facture: rec.numero_facture ?? '',
      transporteur: rec.transporteur ?? '',
      nombre_colis: rec.nombre_colis?.toString() ?? '',
      poids_total_brut_kg: rec.poids_total_brut_kg?.toString() ?? '',
    })
  }, [
    rec?.id_reception,
    rec?.num_bon_livraison,
    rec?.numero_facture,
    rec?.transporteur,
    rec?.nombre_colis,
    rec?.poids_total_brut_kg,
  ])

  const enteteModifie =
    !!rec &&
    (entete.num_bon_livraison !== (rec.num_bon_livraison ?? '') ||
      entete.numero_facture !== (rec.numero_facture ?? '') ||
      entete.transporteur !== (rec.transporteur ?? '') ||
      entete.nombre_colis !== (rec.nombre_colis?.toString() ?? '') ||
      entete.poids_total_brut_kg !== (rec.poids_total_brut_kg?.toString() ?? ''))

  const lignes = qLignes.data ?? []
  const modifiable =
    !!droits.peutEcrire && (rec?.statut === 'BROUILLON' || rec?.statut === 'A_CONTROLER')
  const aEnregistrer = pesees.length > 0 || supprimees.length > 0 || enteteModifie

  const enregistrer = useMutation({
    mutationFn: async () => {
      if (enteteModifie) {
        await api.patch(`/api/receptions/${id}`, {
          num_bon_livraison: entete.num_bon_livraison || undefined,
          numero_facture: entete.numero_facture || undefined,
          transporteur: entete.transporteur || undefined,
          nombre_colis: entete.nombre_colis ? Number(entete.nombre_colis) : undefined,
          poids_total_brut_kg: entete.poids_total_brut_kg
            ? Number(entete.poids_total_brut_kg)
            : undefined,
        })
      }
      for (const ligne of supprimees) {
        await api.delete(`/api/receptions/${id}/lignes/${ligne}`)
      }
      for (const p of pesees) {
        await api.post(`/api/receptions/${id}/lignes`, {
          code_reference: p.code_reference,
          id_ligne_bc: p.id_ligne_bc ?? undefined,
          unite_saisie: p.unite_saisie,
          quantite_pesee_unite: p.quantite,
          quantite_bl_kg: p.quantite_bl ?? undefined,
          nb_colis_ligne: p.colis ?? undefined,
          code_magasin_dest: p.magasin,
          lot_fournisseur: p.lot || undefined,
          statut_qualite: p.statut_qualite,
        })
      }
      return { pesees: pesees.length, retirees: supprimees.length }
    },
    onSuccess: (r) => {
      const parts = [
        r.pesees > 0 ? `${r.pesees} pesee(s)` : null,
        r.retirees > 0 ? `${r.retirees} retiree(s)` : null,
      ].filter(Boolean)
      toast.success('Reception enregistree', {
        description: parts.length ? `Lignes : ${parts.join(' · ')}.` : undefined,
      })
      setPesees([])
      setSupprimees([])
      rafraichir()
    },
    onError: echec,
  })

  const changerStatut = useMutation({
    mutationFn: (statut: string) => api.put(`/api/receptions/${id}/statut`, { statut }),
    onSuccess: () => {
      toast.success('Reception soumise au controle qualite')
      rafraichir()
    },
    onError: echec,
  })

  const valider = useMutation({
    mutationFn: () => api.post(`/api/receptions/${id}/valider`),
    onSuccess: () => {
      toast.success('Reception validee', {
        description: 'Stock, CMUP, archive et historique de prix mis a jour en une transaction.',
      })
      rafraichir()
    },
    onError: echec,
  })

  const basculerSuppression = (ligne: string) =>
    setSupprimees((l) => (l.includes(ligne) ? l.filter((x) => x !== ligne) : [...l, ligne]))

  const estNouvelle = (l: LigneRec) => l.id_ligne_reception.startsWith('pesee:')

  const lignesAffichees: LigneRec[] = [
    ...lignes,
    ...pesees.map((p, i) => ({
      id_ligne_reception: p.cle,
      ligne_numero: lignes.length + i + 1,
      code_reference: p.code_reference,
      reference_designation: p.designation,
      unite_saisie: p.unite_saisie,
      quantite_pesee_unite: p.quantite,
      quantite_stock_kg: p.quantite,
      quantite_commandee_kg: p.attendu_kg,
      quantite_bl_kg: p.quantite_bl,
      ecart_pct:
        p.attendu_kg && p.attendu_kg > 0
          ? Math.round(((p.quantite - p.attendu_kg) / p.attendu_kg) * 1000) / 10
          : null,
      ecart_bl_kg: p.quantite_bl == null ? null : Math.round((p.quantite - p.quantite_bl) * 1e4) / 1e4,
      ecart_cmd_kg: p.attendu_kg == null ? null : Math.round((p.quantite - p.attendu_kg) * 1e4) / 1e4,
      nb_colis_ligne: p.colis,
      poids_moyen_colis_kg: p.colis && p.colis > 0 ? Math.round((p.quantite / p.colis) * 1e3) / 1e3 : null,
      lot_fournisseur: p.lot || null,
      statut_qualite: p.statut_qualite,
      code_magasin_dest: p.magasin,
    })),
  ]

  const horsTolerance = useMemo(
    () => lignesAffichees.filter((l) => Math.abs(l.ecart_pct ?? 0) > TOLERANCE_PCT).length,
    [lignesAffichees],
  )

  const colonnes: ColonneDT<LigneRec>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{l.code_reference}</div>
          <div className="truncate text-[11px] text-attenue-texte">{l.reference_designation}</div>
        </div>
      ),
    },
    {
      champ: 'quantite_pesee_unite',
      entete: 'Pesee',
      numerique: true,
      largeur: '140px',
      rendu: (l) => (
        <div className="text-right">
          <div className="tabular-nums font-medium">
            {fmt.nombre(l.quantite_pesee_unite, 2)} {l.unite_saisie}
          </div>
          {l.unite_saisie !== 'kg' && (
            <div className="text-[11px] text-attenue-texte tabular-nums">
              {fmt.nombre(l.quantite_stock_kg, 2)} kg
            </div>
          )}
        </div>
      ),
    },
    {
      // Ce que le fournisseur DECLARE sur son bon de livraison. L'ecart avec la
      // pesee est un litige de transport ou de declaration — il n'a rien a voir
      // avec l'ecart de commande, qui mesure un reliquat.
      champ: 'quantite_bl_kg',
      entete: 'Annonce BL',
      numerique: true,
      largeur: '130px',
      rendu: (l) =>
        l.quantite_bl_kg == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right">
            <div className="tabular-nums">{fmt.nombre(l.quantite_bl_kg, 2)} kg</div>
            {l.ecart_bl_kg != null && Math.abs(l.ecart_bl_kg) > 0.001 && (
              <div className="text-[11px] tabular-nums text-danger">
                {l.ecart_bl_kg > 0 ? '+' : ''}
                {fmt.nombre(l.ecart_bl_kg, 2)} kg pese
              </div>
            )}
          </div>
        ),
    },
    {
      champ: 'quantite_commandee_kg',
      entete: 'Attendu',
      numerique: true,
      largeur: '120px',
      rendu: (l) =>
        l.quantite_commandee_kg == null ? (
          <span className="text-attenue-texte">hors commande</span>
        ) : (
          <span className="tabular-nums">{fmt.nombre(l.quantite_commandee_kg, 0)} kg</span>
        ),
    },
    {
      champ: 'ecart_pct',
      entete: 'Ecart',
      numerique: true,
      largeur: '110px',
      rendu: (l) => {
        if (l.ecart_pct == null) return <span className="text-attenue-texte">—</span>
        const hors = Math.abs(l.ecart_pct) > TOLERANCE_PCT
        return (
          <span className={cn('tabular-nums', hors && 'font-medium text-danger')}>
            {l.ecart_pct > 0 ? '+' : ''}
            {fmt.nombre(l.ecart_pct, 1)} %
          </span>
        )
      },
    },
    {
      champ: 'ecart_cmd_kg',
      entete: 'Ecart commande',
      numerique: true,
      largeur: '130px',
      secondaire: true,
      rendu: (l) =>
        l.ecart_cmd_kg == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <span className={cn('tabular-nums', l.ecart_cmd_kg < 0 && 'text-alerte')}>
            {l.ecart_cmd_kg > 0 ? '+' : ''}
            {fmt.nombre(l.ecart_cmd_kg, 2)} kg
          </span>
        ),
    },
    {
      // Un poids par colis inhabituel revele un conditionnement different de
      // celui negocie : c'est ce qui se voit avant que le stock ne l'absorbe.
      champ: 'nb_colis_ligne',
      entete: 'Colis',
      numerique: true,
      largeur: '110px',
      secondaire: true,
      rendu: (l) =>
        l.nb_colis_ligne == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right">
            <div className="tabular-nums">{fmt.entier(l.nb_colis_ligne)}</div>
            {l.poids_moyen_colis_kg != null && (
              <div className="text-[11px] tabular-nums text-attenue-texte">
                {fmt.nombre(l.poids_moyen_colis_kg, 2)} kg/colis
              </div>
            )}
          </div>
        ),
    },
    {
      champ: 'lot_fournisseur',
      entete: 'Lot',
      largeur: '150px',
      rendu: (l) => l.lot_fournisseur ?? <span className="text-attenue-texte">—</span>,
    },
    {
      champ: 'code_magasin_dest',
      entete: 'Magasin',
      largeur: '110px',
      rendu: (l) => l.code_magasin_dest,
    },
    {
      champ: 'statut_qualite',
      entete: 'Qualite',
      largeur: '140px',
      rendu: (l) => (
        <Badge ton={TON_QUALITE[l.statut_qualite] ?? 'neutre'}>{l.statut_qualite}</Badge>
      ),
    },
    {
      champ: 'prix_kg_mad',
      entete: 'Prix MAD/kg',
      numerique: true,
      largeur: '120px',
      rendu: (l) =>
        l.prix_kg_mad == null ? (
          <span className="text-attenue-texte">a la validation</span>
        ) : (
          fmt.nombre(l.prix_kg_mad, 4)
        ),
    },
    {
      champ: 'ligne_numero',
      entete: 'Etat',
      largeur: '150px',
      rendu: (l) =>
        estNouvelle(l) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="succes">nouvelle</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() => setPesees((p) => p.filter((x) => x.cle !== l.id_ligne_reception))}
            >
              retirer
            </button>
          </div>
        ) : supprimees.includes(l.id_ligne_reception) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="danger">a retirer</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() => basculerSuppression(l.id_ligne_reception)}
            >
              garder
            </button>
          </div>
        ) : (
          <span className="text-attenue-texte">enregistree</span>
        ),
    },
  ]

  if (qRec.isLoading) return <Chargement />
  if (!rec) {
    return (
      <div>
        <EnTetePage titre="Reception" description="Introuvable." />
        <Alerte ton="alerte">
          Cette reception n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/receptions')}>
            Revenir a la liste
          </button>
        </Alerte>
      </div>
    )
  }

  const estPeseur = rec.receptionnaire === moi?.login

  return (
    <div>
      <EnTetePage
        titre={`${rec.numero_reception} — ${rec.fournisseur_nom}`}
        description={`${fmt.date(rec.date_reception)}${rec.numero_bc ? ` · bon ${rec.numero_bc}` : ' · hors commande'}${rec.receptionnaire ? ` · pesee par ${rec.receptionnaire}` : ''}`}
        actions={
          <>
            <Bouton variante="contour" onClick={() => naviguer('/receptions')}>
              <ArrowLeft />
              Retour
            </Bouton>
            {modifiable && (
              <Bouton variante="contour" onClick={() => setSaisie(true)}>
                <Plus />
                Peser des lignes
              </Bouton>
            )}
            {droits.peutEcrire && rec.statut === 'BROUILLON' && (
              <Bouton
                variante="contour"
                onClick={() => changerStatut.mutate('A_CONTROLER')}
                disabled={lignes.length === 0 || aEnregistrer}
                title={
                  lignes.length === 0
                    ? 'Aucune ligne pesee'
                    : aEnregistrer
                      ? 'Enregistrez d’abord les modifications en cours'
                      : undefined
                }
              >
                <Send />
                Soumettre au controle
              </Bouton>
            )}
            {droits.peutValider && rec.statut === 'A_CONTROLER' && (
              <Bouton
                onClick={() => valider.mutate()}
                disabled={estPeseur}
                title={
                  estPeseur
                    ? 'B4 : le peseur ne peut pas controler sa propre reception'
                    : 'Entree en stock, CMUP, archive et historique de prix'
                }
              >
                <ShieldCheck />
                Valider le controle
              </Bouton>
            )}
          </>
        }
      />

      {!modifiable && !['ANNULE'].includes(rec.statut) && (
        <Alerte ton={rec.statut === 'VALIDE' || rec.statut === 'CLOTURE' ? 'succes' : 'info'} className="mb-3">
          {rec.statut === 'VALIDE' || rec.statut === 'CLOTURE'
            ? 'Reception validee : le stock, le CMUP et l’historique de prix ont ete mis a jour. Les lignes sont figees.'
            : 'Reception figee.'}
        </Alerte>
      )}

      {horsTolerance > 0 && (
        <Alerte ton="alerte" titre="Ecart de pesee" className="mb-3">
          {horsTolerance} ligne(s) s'ecartent de plus de {TOLERANCE_PCT} % de la quantite
          commandee. Au-dela, le controle qualite exigera une derogation motivee.
        </Alerte>
      )}

      {rec.on_time != null && (
        <Carte className="mb-3">
          <CarteEntete>
            <CarteTitre>Performance de livraison (OTIF)</CarteTitre>
            <Badge
              ton={
                rec.on_time === 1 && rec.in_full !== 0 && rec.in_spec !== 0 ? 'succes' : 'danger'
              }
            >
              {rec.on_time === 1 && rec.in_full !== 0 && rec.in_spec !== 0
                ? 'OTIF respecte'
                : 'OTIF manque'}
            </Badge>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Indicateur libelle="Delai reel" valeur={rec.delai_reel_jours} suffixe=" j" />
            <Indicateur libelle="Delai promis" valeur={rec.delai_prevu_jours} suffixe=" j" />
            <Indicateur
              libelle="Retard"
              valeur={rec.retard_jours}
              suffixe=" j"
              alerte={(rec.retard_jours ?? 0) > 0}
            />
            <Critere libelle="A l'heure" ok={rec.on_time} />
            <Critere libelle="Complet" ok={rec.in_full} />
            <Critere libelle="Conforme" ok={rec.in_spec} />
          </CarteCorps>
          <CarteCorps className="pt-0">
            <p className="text-[11px] text-attenue-texte">
              L'OTIF est le produit des trois criteres, pas leur moyenne : une livraison a l'heure
              mais incomplete ne vaut rien pour l'atelier qui l'attend.
            </p>
          </CarteCorps>
        </Carte>
      )}

      <div className="space-y-3">
        <Carte repliable="reception.1">
          <CarteEntete>
            <CarteTitre>En-tete</CarteTitre>
            <Badge ton={TON[rec.statut] ?? 'neutre'}>{rec.statut}</Badge>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Etiq htmlFor="bl">Bon de livraison</Etiq>
              <Champ
                id="bl"
                value={entete.num_bon_livraison}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, num_bon_livraison: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="fact">N° de facture</Etiq>
              <Champ
                id="fact"
                value={entete.numero_facture}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, numero_facture: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-attenue-texte">
                Souvent absente a la livraison : elle se saisit plus tard.
              </p>
            </div>
            <div>
              <Etiq htmlFor="tr">Transporteur</Etiq>
              <Champ
                id="tr"
                value={entete.transporteur}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, transporteur: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="colis">Nombre de colis</Etiq>
              <Champ
                id="colis"
                type="number"
                min="0"
                value={entete.nombre_colis}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, nombre_colis: e.target.value })}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq htmlFor="brut">Poids brut (kg)</Etiq>
              <Champ
                id="brut"
                type="number"
                step="any"
                min="0"
                value={entete.poids_total_brut_kg}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, poids_total_brut_kg: e.target.value })}
                className="text-right tabular-nums"
              />
              <p className="mt-1 text-[11px] text-attenue-texte">
                Releve au pont-bascule, emballage compris.
              </p>
            </div>
          </CarteCorps>
        </Carte>

        <Carte repliable="reception.2">
          <CarteEntete>
            <CarteTitre>Pesees</CarteTitre>
            {modifiable && (
              <Bouton variante="contour" taille="sm" onClick={() => setSaisie(true)}>
                <Plus />
                Peser
              </Bouton>
            )}
          </CarteEntete>
          <CarteCorps className="p-0">
            <DataTable<LigneRec>
              module={MODULE}
              colonnes={colonnes}
              lignes={lignesAffichees}
              chargement={qLignes.isLoading}
              cle={(l) => l.id_ligne_reception}
              recherche={false}
              pagination={false}
              tailleParDefaut={500}
              titreCarte={(l) => l.code_reference}
              videTitre="Aucune pesee"
              videDescription="Ajoutez les lignes attendues du bon de commande, puis enregistrez."
              actions={
                modifiable
                  ? (l) => (
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className="text-danger hover:bg-danger/10"
                        onClick={() =>
                          estNouvelle(l)
                            ? setPesees((p) => p.filter((x) => x.cle !== l.id_ligne_reception))
                            : basculerSuppression(l.id_ligne_reception)
                        }
                        aria-label="Retirer"
                        title="Marquer la ligne a retirer — effectif a l'enregistrement"
                      >
                        <Trash2 />
                      </Bouton>
                    )
                  : undefined
              }
            />
          </CarteCorps>
        </Carte>
      </div>

      {modifiable && (
        <div
          className={cn(
            'sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            aEnregistrer ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="text-[13px]">
            {aEnregistrer ? (
              <>
                <span className="font-medium">
                  {[
                    pesees.length > 0 ? `${pesees.length} pesee(s)` : null,
                    supprimees.length > 0 ? `${supprimees.length} a retirer` : null,
                    enteteModifie ? 'en-tete modifie' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-alerte"> — rien n'est encore enregistre.</span>
              </>
            ) : (
              <span className="text-attenue-texte">
                Pesez des lignes ou modifiez l'en-tete, puis enregistrez.
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton
              variante="contour"
              disabled={!aEnregistrer}
              onClick={() => {
                setPesees([])
                setSupprimees([])
                if (rec) {
                  setEntete({
                    num_bon_livraison: rec.num_bon_livraison ?? '',
                    numero_facture: rec.numero_facture ?? '',
                    transporteur: rec.transporteur ?? '',
                    nombre_colis: rec.nombre_colis?.toString() ?? '',
                    poids_total_brut_kg: rec.poids_total_brut_kg?.toString() ?? '',
                  })
                }
              }}
            >
              <Undo2 />
              Annuler les modifications
            </Bouton>
            <Bouton
              onClick={() => enregistrer.mutate()}
              chargement={enregistrer.isPending}
              disabled={!aEnregistrer}
            >
              <Save />
              Enregistrer les modifications
            </Bouton>
          </div>
        </div>
      )}

      {saisie && (
        <PanneauPesee
          idReception={id}
          codeFournisseur={rec.code_fournisseur}
          dejaPesees={[...lignes.map((l) => l.code_reference), ...pesees.map((p) => p.code_reference)]}
          surFermeture={() => setSaisie(false)}
          surAjout={(ajouts) =>
            setPesees((p) => [
              ...p,
              ...ajouts.map((a, i) => ({ ...a, cle: `pesee:${Date.now()}:${i}` })),
            ])
          }
        />
      )}
    </div>
  )
}

/**
 * Saisie des pesees, a partir de ce qui est ATTENDU.
 *
 * Chaque ligne du bon encore due est proposee avec son reste a livrer, prerempli
 * comme quantite. Le magasinier corrige avec ce que la bascule affiche.
 */
function PanneauPesee({
  idReception,
  codeFournisseur,
  dejaPesees,
  surFermeture,
  surAjout,
}: {
  idReception: string
  codeFournisseur: string
  dejaPesees: string[]
  surFermeture: () => void
  surAjout: (ajouts: Omit<Pesee, 'cle'>[]) => void
}) {
  const [choix, setChoix] = useState<
    Record<
      string,
      {
        qte: string
        qteBl: string
        colis: string
        unite: string
        lot: string
        magasin: string
        qualite: string
      }
    >
  >({})
  const [erreur, setErreur] = useState<string | null>(null)

  // On interroge par FOURNISSEUR, pas par bon : un camion porte parfois deux
  // bons, et n'offrir que celui de l'en-tete obligerait a ouvrir une seconde
  // reception pour un seul dechargement.
  const q = useQuery({
    queryKey: ['lignes-attendues', idReception, codeFournisseur],
    queryFn: () =>
      api.get<LigneAttendue[]>(
        `/api/lignes-attendues?id_reception=${idReception}&code_fournisseur=${encodeURIComponent(codeFournisseur)}`,
      ),
  })

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () =>
      api.get<{ code_magasin: string; nom: string; est_quarantaine: number }[]>('/api/magasins'),
  })

  const attendues = (q.data ?? []).filter((l) => l.quantite_restante_kg > 0.001)

  const basculer = (l: LigneAttendue) =>
    setChoix((c) => {
      if (c[l.id_ligne_bc]) {
        const { [l.id_ligne_bc]: _, ...reste } = c
        return reste
      }
      return {
        ...c,
        [l.id_ligne_bc]: {
          // Le reste a livrer sert de proposition : c'est ce qu'on attend, et
          // c'est presque toujours ce qui arrive.
          qte: String(Math.max(0, l.quantite_restante_kg - l.deja_pesee_kg)),
          qteBl: String(Math.max(0, l.quantite_restante_kg - l.deja_pesee_kg)),
          colis: '',
          unite: 'kg',
          lot: '',
          magasin: 'MP-01',
          qualite: 'CONFORME',
        },
      }
    })

  const valider = () => {
    const ajouts = attendues
      .filter((l) => choix[l.id_ligne_bc])
      .map((l) => {
        const v = choix[l.id_ligne_bc]
        return {
          id_ligne_bc: l.id_ligne_bc,
          code_reference: l.code_reference,
          designation: l.designation,
          unite_saisie: v.unite,
          quantite: Number(v.qte),
          quantite_bl: v.qteBl ? Number(v.qteBl) : null,
          attendu_kg: l.quantite_restante_kg,
          colis: v.colis ? Number(v.colis) : null,
          lot: v.lot,
          magasin: v.magasin,
          statut_qualite: v.qualite,
        }
      })
    if (ajouts.some((a) => !(a.quantite > 0))) {
      setErreur('Renseignez une quantite pour chaque ligne pesee.')
      return
    }
    const sansLot = attendues.filter(
      (l) => choix[l.id_ligne_bc] && l.suivi_lot === 1 && !choix[l.id_ligne_bc].lot.trim(),
    )
    if (sansLot.length > 0) {
      setErreur(
        `Lot obligatoire pour ${sansLot.map((l) => l.code_reference).join(', ')} : ces references sont suivies par lot.`,
      )
      return
    }
    surAjout(ajouts)
    setChoix({})
    surFermeture()
  }

  const nb = Object.keys(choix).length

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        cote="droite"
        titre="Peser les lignes attendues"
        description="Le reste a livrer est propose : corrigez avec ce que la bascule affiche."
      >
        {q.isLoading && <Chargement texte="Lecture du bon de commande…" />}

        {!q.isLoading && attendues.length === 0 && (
          <Alerte ton="info">
            Rien n'est en attente chez ce fournisseur : tout a ete livre, ou aucun bon n'a encore
            ete envoye.
          </Alerte>
        )}

        <div className="space-y-1.5">
          {attendues.map((l) => {
            const coche = !!choix[l.id_ligne_bc]
            const deja = dejaPesees.includes(l.code_reference)
            return (
              <div
                key={l.id_ligne_bc}
                className={cn(
                  'rounded-[var(--radius)] border p-2',
                  coche ? 'border-primaire bg-primaire/5' : 'border-bordure',
                )}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={coche}
                    onChange={() => basculer(l)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{l.code_reference}</span>
                      <span className="text-[11px] tabular-nums text-attenue-texte">
                        {l.numero_bc}
                      </span>
                      {(l.retard_jours ?? 0) > 0 && (
                        <Badge ton="danger">{l.retard_jours} j de retard</Badge>
                      )}
                      {l.suivi_lot === 1 && <Badge ton="info">lot obligatoire</Badge>}
                      {deja && (
                        <span className="text-[11px] text-attenue-texte">deja pesee ici</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-attenue-texte">
                      {l.designation}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
                      <span>
                        Commande{' '}
                        <span className="tabular-nums text-texte">
                          {fmt.nombre(l.quantite_commandee_kg, 0)} kg
                        </span>
                      </span>
                      <span>
                        Deja recu{' '}
                        <span className="tabular-nums text-texte">
                          {fmt.nombre(l.quantite_recue_kg, 0)} kg
                        </span>
                      </span>
                      <span>
                        Reste{' '}
                        <span className="tabular-nums font-medium text-texte">
                          {fmt.nombre(l.quantite_restante_kg, 0)} kg
                        </span>
                      </span>
                      {l.prix_kg_devise != null && (
                        <span>
                          Prix engage{' '}
                          <span className="tabular-nums text-texte">
                            {fmt.nombre(l.prix_kg_devise, 4)} {l.code_devise}
                          </span>
                        </span>
                      )}
                    </span>
                  </span>
                </label>

                {coche && (
                  <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <Etiq>Qte BL (kg)</Etiq>
                      <Champ
                        type="number"
                        step="any"
                        min="0"
                        value={choix[l.id_ligne_bc].qteBl}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [l.id_ligne_bc]: { ...c[l.id_ligne_bc], qteBl: e.target.value },
                          }))
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <Etiq obligatoire>Qte pesee</Etiq>
                      <Champ
                        type="number"
                        step="any"
                        min="0.0001"
                        value={choix[l.id_ligne_bc].qte}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [l.id_ligne_bc]: { ...c[l.id_ligne_bc], qte: e.target.value },
                          }))
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <Etiq>Unite</Etiq>
                      <Selecteur
                        value={choix[l.id_ligne_bc].unite}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [l.id_ligne_bc]: { ...c[l.id_ligne_bc], unite: e.target.value },
                          }))
                        }
                      >
                        <option value="kg">kg</option>
                        {l.unite_catalogue !== 'kg' && (
                          <option value={l.unite_catalogue}>{l.unite_catalogue}</option>
                        )}
                      </Selecteur>
                    </div>
                    <div>
                      <Etiq>Nb colis</Etiq>
                      <Champ
                        type="number"
                        min="1"
                        value={choix[l.id_ligne_bc].colis}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [l.id_ligne_bc]: { ...c[l.id_ligne_bc], colis: e.target.value },
                          }))
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <Etiq obligatoire={l.suivi_lot === 1}>Lot fournisseur</Etiq>
                      <Champ
                        value={choix[l.id_ligne_bc].lot}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [l.id_ligne_bc]: { ...c[l.id_ligne_bc], lot: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Etiq>Destination</Etiq>
                      <Selecteur
                        value={choix[l.id_ligne_bc].magasin}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [l.id_ligne_bc]: { ...c[l.id_ligne_bc], magasin: e.target.value },
                          }))
                        }
                      >
                        {(qMag.data ?? []).map((m) => (
                          <option key={m.code_magasin} value={m.code_magasin}>
                            {m.nom}
                          </option>
                        ))}
                      </Selecteur>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {erreur && (
          <Alerte ton="danger" className="mt-3">
            {erreur}
          </Alerte>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-bordure bg-surface px-4 pt-3">
          <span className="text-[11px] text-attenue-texte">
            {nb} ligne(s) — ajoutees au brouillon, enregistrees avec la reception
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton onClick={valider} disabled={!nb}>
              <Plus />
              Ajouter {nb || ''}
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

/** Un chiffre de l'OTIF, avec son libelle. */
function Indicateur({
  libelle,
  valeur,
  suffixe = '',
  alerte = false,
}: {
  libelle: string
  valeur: number | null
  suffixe?: string
  alerte?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] text-attenue-texte">{libelle}</div>
      <div className={cn('text-lg font-semibold tabular-nums', alerte && 'text-danger')}>
        {valeur == null ? '—' : `${fmt.entier(valeur)}${suffixe}`}
      </div>
    </div>
  )
}

/** Un des trois criteres OTIF. `null` = non mesurable, ce qui n'est pas un echec. */
function Critere({ libelle, ok }: { libelle: string; ok: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-attenue-texte">{libelle}</div>
      <Badge ton={ok == null ? 'neutre' : ok === 1 ? 'succes' : 'danger'}>
        {ok == null ? 'non mesurable' : ok === 1 ? 'oui' : 'non'}
      </Badge>
    </div>
  )
}

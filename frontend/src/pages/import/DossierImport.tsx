/**
 * L'ecran d'un dossier d'importation — une seule page, de haut en bas :
 *
 *   1. les informations du dossier ;
 *   2. ses frais (TVA, douane, fret, transitaire…), saisis dans le tableau ;
 *   3. les factures qui le composent — chacune s'ouvre sur son ecran.
 *
 * Les receptions n'y sont pas : c'est un document A PART, avec sa propre
 * liste (/receptions-import), qui peut prendre des lignes de plusieurs
 * dossiers. Le dossier n'en voit que l'effet — le recu de chaque facture.
 *
 * CLOTURE, TOUT EST EN LECTURE SEULE : un dossier clos a servi a corriger le
 * CUMP, le modifier ferait mentir le stock. Le serveur le refuserait de toute
 * facon ; l'ecran n'offre simplement plus les gestes.
 */
import { CoutRevientReel } from './CoutRevientReel'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight, History, Lock, Plus, Save, ShieldCheck, Target, Trash2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
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
} from '../../composants/ui/base'
import { Onglet, OngletContenu, Onglets, OngletsListe, useConfirmation } from '../../composants/ui/surcouches'
import { useOuvrirVue } from '../../lib/navigation'
import { cn, fmt } from '../../lib/utils'
import { Avancement, PastilleStatut } from './DossiersImport'
import { CiblesPanneau, CloturePanneau, echec, nombre, Tuile, useEnregistrerTout, useRafraichir, type Signaler } from './dialogues'
import { PiecesDossier } from './PiecesDossier'
import { EngagementsDossier } from './EngagementsDossier'
import {
  LIBELLE_CLE,
  LIBELLE_FICHE,
  LIBELLE_RECEPTION,
  TON_RECEPTION,
  type ApercuFiche,
  type CleRepartition,
  type DossierComplet,
  type Frais,
  type ParametreFrais,
  type StatutFiche,
} from './types'

const MODULE = 'IMPORT'
const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1.5'

export function DossierImport() {
  const { id = '' } = useParams()
  // LE RETOUR D'UNE FACTURE ROUVRE LA LISTE DES FACTURES (12/10/2026), pas
  // l'onglet des frais : ?onglet=factures.
  const [parametres] = useSearchParams()
  const ongletDemande = parametres.get('onglet')
  const ongletInitial = ongletDemande === 'factures' || ongletDemande === 'engagements' ? ongletDemande : 'frais'
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const rafraichir = useRafraichir(id)
  const confirmation = useConfirmation()
  const [cloture, setCloture] = useState(false)
  const tout = useEnregistrerTout()

  const q = useQuery({
    queryKey: ['import-dossier', id],
    queryFn: ({ signal }) => api.get<DossierComplet>(`/api/import/dossiers/${id}`, { signal }),
    enabled: !!id,
  })

  /* LE CYCLE DE VIE DU DOSSIER, sur son ecran (demande du 30/09/2026) :
     valider le brouillon, le supprimer tant qu'il n'est que brouillon,
     cloturer, devalider une cloture. */
  const valider = useMutation({
    mutationFn: () => api.post(`/api/import/dossiers/${id}/valider`),
    onSuccess: () => {
      toast.success('Dossier validé — il est en cours')
      rafraichir()
    },
    onError: echec,
  })
  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/import/dossiers/${id}`),
    onSuccess: () => {
      toast.success('Brouillon supprimé')
      rafraichir()
      ouvrir('/import')
    },
    onError: echec,
  })

  if (q.isLoading) return <Chargement texte="Lecture du dossier…" />
  if (!q.data) return <Alerte ton="alerte">Dossier introuvable.</Alerte>

  const d = q.data
  const { dossier } = d
  const clos = dossier.statut === 'CLOTURE'
  const ecrire = droits.peutEcrire && !clos

  return (
    <div className="space-y-3">
      <EnTetePage
        titre={`Dossier ${dossier.numero}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <PastilleStatut statut={dossier.statut} />
            {dossier.numero_bl && <span>BL {dossier.numero_bl}</span>}
            {dossier.conteneurs && <span>{dossier.conteneurs}</span>}
          </span>
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir('/import')}>
              <ArrowLeft />
              Tous les dossiers
            </Bouton>
            {ecrire && (
              <Bouton
                disabled={tout.aEnregistrer.length === 0}
                chargement={tout.enCours}
                title={tout.aEnregistrer.length ? `À enregistrer : ${tout.aEnregistrer.join(', ')}` : 'Rien à enregistrer'}
                onClick={() => void tout.toutEnregistrer()}
              >
                <Save />
                Enregistrer tout
                {tout.aEnregistrer.length > 0 && (
                  <span className="rounded bg-primaire-texte/15 px-1 text-[10px]">{tout.aEnregistrer.length}</span>
                )}
              </Bouton>
            )}
            {droits.peutEcrire && dossier.statut === 'BROUILLON' && (
              <Bouton
                variante="contour"
                className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: `Supprimer le dossier ${dossier.numero} ?`,
                    destructif: true,
                    libelleConfirmer: 'Supprimer',
                    description:
                      'Un brouillon n’a rien fait entrer en stock : il est effacé avec ses factures, ses frais et ses engagements.',
                    action: () => supprimer.mutate(),
                  })
                }
              >
                <Trash2 />
                Supprimer le brouillon
              </Bouton>
            )}
            {droits.peutValider && dossier.statut === 'BROUILLON' && (
              <Bouton
                chargement={valider.isPending}
                disabled={d.factures.length === 0}
                title={d.factures.length === 0 ? 'Ajoutez d’abord les factures du dossier' : undefined}
                onClick={() => valider.mutate()}
              >
                <ShieldCheck />
                Valider
              </Bouton>
            )}
            {/* PLUS DE REOUVERTURE (regle 5, 09/10/2026) : un dossier clos est fige ;
                une facture tardive s'ajoute en frais post-cloture, plus bas. */}
            {droits.peutValider && dossier.statut === 'EN_COURS' && (
              <Bouton onClick={() => setCloture(true)}>
                <Lock />
                Clôturer
              </Bouton>
            )}
          </>
        }
      />

      {clos && (
        <Alerte ton="succes">
          Clôturé le {fmt.date(dossier.date_cloture)}
          {dossier.cloture_par && ` par ${dossier.cloture_par}`} : le dossier est figé. Un frais tardif s’ajoute
          en fiche, avec motif, et s’applique au stock restant.
        </Alerte>
      )}

      {/* DISPOSITION (demandes des 30/09 et 01/10/2026) : le dossier et sa
          DUM en haut ; frais, factures et engagements dans leurs onglets —
          les engagements par fournisseur, chaque facture sur le sien ; le
          recapitulatif et les totaux en bas, dans leur cadre. */}
      <CloturePanneau idDossier={id} ouvert={cloture} surFermer={() => setCloture(false)} />
      <Informations d={d} ecrire={ecrire} valider={droits.peutValider} signaler={tout.signaler} />

      {/* LES TROIS ONGLETS RESTENT MONTES, seulement masques : une saisie
          commencee dans l'un (un engagement, un frais) ne doit pas se perdre
          quand on passe a l'autre avant « Enregistrer tout ». */}
      <Onglets defaultValue={ongletInitial}>
        <OngletsListe>
          <Onglet value="frais">
            Frais
            <span className="text-[11px] tabular-nums text-attenue-texte">{d.frais.length}</span>
          </Onglet>
          <Onglet value="factures">
            Factures
            <span className="text-[11px] tabular-nums text-attenue-texte">{d.factures.length}</span>
          </Onglet>
          <Onglet value="engagements">
            Engagements
            <span className="text-[11px] tabular-nums text-attenue-texte">{(d.engagements ?? []).length}</span>
            {d.factures.some((f) => !f.id_engagement) && <span className="size-1.5 rounded-full bg-alerte" title="Facture(s) sans engagement" />}
          </Onglet>
        </OngletsListe>
        <OngletContenu value="frais" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FraisDossier d={d} ecrire={ecrire} valider={droits.peutValider} postCloture={clos && droits.peutValider} signaler={tout.signaler} />
        </OngletContenu>
        <OngletContenu value="factures" forceMount className="mt-3 data-[state=inactive]:hidden">
          <FacturesDossier d={d} ecrire={ecrire} />
          <CoutRevientReel idDossier={d.dossier.id_dossier} />
        </OngletContenu>
        <OngletContenu value="engagements" forceMount className="mt-3 data-[state=inactive]:hidden">
          <EngagementsDossier d={d} ecrire={ecrire} signaler={tout.signaler} />
        </OngletContenu>
      </Onglets>

      <PiecesDossier d={d} ecrire={ecrire} />
      {d.ajustements.length > 0 && <JournalCloture d={d} />}

      <Carte>
        <CarteEntete>
          <CarteTitre>Récapitulatif et totaux</CarteTitre>
        </CarteEntete>
        <CarteCorps>
          <Synthese d={d} />
        </CarteCorps>
      </Carte>

      {confirmation.element}
    </div>
  )
}

// ============================================================================
// Synthese
// ============================================================================

function Synthese({ d }: { d: DossierComplet }) {
  const valeur = d.lignes.reduce((t, l) => t + l.valeur_achat_dhs, 0)
  const inclus = d.frais.filter((x) => x.inclus_dans_cout === 1).reduce((t, x) => t + x.montant_dhs, 0)
  const horsCout = d.frais.filter((x) => x.inclus_dans_cout === 0).reduce((t, x) => t + x.montant_dhs, 0)
  const erp = d.lignes.filter((l) => l.type_ligne === 'ERP')
  const poids = erp.reduce((t, l) => t + (l.poids_net_kg ?? 0), 0)
  const recu = erp.reduce((t, l) => t + l.quantite_recue_kg, 0)
  const coefVisible = d.lignes.some((l) => l.coef_frais_pct !== undefined)
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tuile titre="Valeur d'achat" valeur={`${fmt.nombre(valeur, 2)} DH`} detail={`${d.factures.length} facture(s)`} />
      <Tuile
        titre="Frais HT inclus"
        valeur={`${fmt.nombre(inclus, 2)} DH`}
        detail={coefVisible && valeur > 0 ? `${fmt.nombre((inclus * 100) / valeur, 2)} % de la valeur` : undefined}
      />
      <Tuile titre="Hors coût (TVA)" valeur={`${fmt.nombre(horsCout, 2)} DH`} detail="récupérable, jamais réparti" />
      <div className="rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2">
        <div className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Réception</div>
        <div className="text-[15px] font-semibold tabular-nums">
          {fmt.nombre(recu, 0)} / {fmt.nombre(poids, 0)} kg
        </div>
        <Avancement recu={recu} total={poids} />
      </div>
    </div>
  )
}

// ============================================================================
// 1. Informations du dossier
// ============================================================================

function Informations({
  d, ecrire, valider, signaler,
}: { d: DossierComplet; ecrire: boolean; valider: boolean; signaler?: Signaler }) {
  const rafraichir = useRafraichir(d.dossier.id_dossier)
  const { dossier } = d
  const initial = () => ({
    numero: dossier.numero,
    numero_bl: dossier.numero_bl ?? '',
    conteneurs: dossier.conteneurs ?? '',
    date_arrivee: dossier.date_arrivee?.slice(0, 10) ?? '',
    notes: dossier.notes ?? '',
    numero_dum: dossier.numero_dum ?? '',
    regime_douanier: dossier.regime_douanier ?? '010',
    date_dum: dossier.date_dum?.slice(0, 10) ?? '',
  })
  const [f, setF] = useState(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(initial()), [dossier])
  /* UNE DUM SAISIE NE S'EFFACE PAS (regle 5) : elle se corrige au droit de
     valider, avec un motif. */
  const dumInitiale = (dossier.numero_dum ?? '').trim()
  const dumChangee = dumInitiale !== '' && f.numero_dum.trim() !== dumInitiale
  const [motifDum, setMotifDum] = useState('')
  const modifie = JSON.stringify(f) !== JSON.stringify(initial())

  const enregistrer = useMutation({
    mutationFn: () =>
      api.patch(`/api/import/dossiers/${dossier.id_dossier}`, {
        ...f,
        motif_dum: dumChangee ? motifDum.trim() : undefined,
        date_arrivee: f.date_arrivee || null,
        date_dum: f.date_dum || null,
      }),
    onSuccess: () => {
      toast.success('Dossier enregistré')
      rafraichir()
    },
    onError: echec,
  })
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }))
  // Se signaler a « Enregistrer tout » tant qu'un champ a change.
  useEffect(() => {
    signaler?.('informations', modifie && ecrire ? { libelle: 'informations du dossier', enregistrer: () => enregistrer.mutateAsync() } : null)
  })
  useEffect(() => () => signaler?.('informations', null), [signaler])

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Informations du dossier</CarteTitre>
        {ecrire && (
          <Bouton taille="sm" disabled={!modifie} chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            <Save />
            Enregistrer
          </Bouton>
        )}
      </CarteEntete>
      <CarteCorps>
        {/* PAS DE DEVISE SUR LE DOSSIER (01/10/2026) : en groupage, chaque
            facture porte la sienne. LA DUM est celle du dossier, une seule. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <div>
            <Etiq htmlFor="ch-dossierimport-1">Numéro</Etiq>
            <Champ id="ch-dossierimport-1" value={f.numero} onChange={maj('numero')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq htmlFor="ch-dossierimport-2">N° BL</Etiq>
            <Champ id="ch-dossierimport-2" value={f.numero_bl} onChange={maj('numero_bl')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq htmlFor="ch-dossierimport-3">Conteneur(s)</Etiq>
            <Champ id="ch-dossierimport-3" value={f.conteneurs} onChange={maj('conteneurs')} disabled={!ecrire} />
          </div>
          <div className="md:col-span-2">
            <Etiq htmlFor="ch-dossierimport-4">N° DUM</Etiq>
            <Champ id="ch-dossierimport-4"
              value={f.numero_dum}
              onChange={maj('numero_dum')}
              disabled={!ecrire || (dumInitiale !== '' && !valider)}
              title={dumInitiale !== '' && !valider ? 'Une DUM saisie se corrige au droit de valider' : undefined}
              placeholder="Bureau · régime · année · série"
            />
            {dumChangee && (
              <Champ
                className="mt-1"
                value={motifDum}
                onChange={(e) => setMotifDum(e.target.value)}
                placeholder="Pourquoi la DUM change (obligatoire)"
                aria-label="Motif du changement de DUM"
              />
            )}
          </div>
          <div>
            <Etiq htmlFor="ch-dossierimport-5">Régime</Etiq>
            <Champ id="ch-dossierimport-5" value={f.regime_douanier} onChange={maj('regime_douanier')} disabled={!ecrire} placeholder="010" />
          </div>
          <div>
            <Etiq htmlFor="ch-dossierimport-6">Date DUM</Etiq>
            <Champ id="ch-dossierimport-6" type="date" value={f.date_dum} onChange={maj('date_dum')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq htmlFor="ch-dossierimport-7">Date d'arrivée</Etiq>
            <Champ id="ch-dossierimport-7" type="date" value={f.date_arrivee} onChange={maj('date_arrivee')} disabled={!ecrire} />
          </div>
          <div className="col-span-2 md:col-span-4 xl:col-span-7">
            <Etiq htmlFor="ch-dossierimport-8">Notes</Etiq>
            <Champ id="ch-dossierimport-8" value={f.notes} onChange={maj('notes')} disabled={!ecrire} />
          </div>
        </div>
      </CarteCorps>
    </Carte>
  )
}

// ============================================================================
// 2. Frais du dossier — des FICHES saisies dans le tableau (12/10/2026)
// ============================================================================
//
// TROIS NIVEAUX. Le type de frais PROPOSE une cle et dit celles qui sont
// permises ; l'utilisateur DECIDE (cle, lignes, montants, motif) ; le serveur
// calcule, controle et applique. L'ecran ne calcule rien de definitif : chaque
// chiffre de l'apercu vient du serveur, le meme calcul que la validation.
//
// Une fiche vit en trois etats : BROUILLON (libre), VALIDEE (allocation figee,
// appliquee a ce qui est recu), APPLIQUEE (rien ne reste). Une fiche validee
// ne se modifie plus : on la corrige par une rectificative.

type VueFiche = 'apercu' | 'brouillon' | 'rectifier' | 'historique'

const TON_FICHE: Record<StatutFiche, 'neutre' | 'alerte' | 'succes'> = {
  BROUILLON: 'neutre',
  VALIDE: 'alerte',
  APPLIQUE: 'succes',
}

const dh = (v: number | null | undefined) => (v === undefined || v === null ? '—' : fmt.nombre(v, 2))

function FraisDossier({
  d, ecrire, valider, postCloture, signaler,
}: { d: DossierComplet; ecrire: boolean; valider: boolean; postCloture: boolean; signaler?: Signaler }) {
  /* LE FRAIS TARDIF (regle 5, 09/10/2026) : sur un dossier clos, une fiche
     nouvelle s'ajoute avec un motif ; elle se valide et s'applique comme les
     autres, sans rouvrir le dossier ni rien recalculer d'ancien. */
  const [motifPost, setMotifPost] = useState('')
  const saisie = ecrire || postCloture
  const idDossier = d.dossier.id_dossier
  const rafraichir = useRafraichir(idDossier)
  const confirmation = useConfirmation()
  const [cible, setCible] = useState<Frais | null>(null)
  const [ouverte, setOuverte] = useState<{ id: string; vue: VueFiche } | null>(null)
  const vide = { id_frais: '', libelle: '', numero_piece: '', code_devise: 'MAD', cours_change: '1', montant_devise: '', cle: '', motif_cle: '' }
  const [n, setN] = useState(vide)

  const qParam = useQuery({
    queryKey: ['parametres-frais'],
    queryFn: ({ signal }) => api.get<ParametreFrais[]>('/api/parametres-frais', { signal }),
    enabled: saisie,
  })
  const qDevises = useQuery({
    queryKey: ['devises'],
    queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }),
    enabled: saisie,
  })
  // La liste deroulante groupee par categorie, comme les colonnes du classeur.
  const groupes = useMemo(() => {
    const m = new Map<string, ParametreFrais[]>()
    for (const p of qParam.data ?? []) if (p.actif) m.set(p.categorie, [...(m.get(p.categorie) ?? []), p])
    return [...m.entries()]
  }, [qParam.data])
  const typeChoisi = qParam.data?.find((p) => p.id_frais === n.id_frais)
  // La cle PROPOSEE par le type, tant que l'utilisateur n'en a pas choisi une autre.
  const cleNouvelle = (n.cle || typeChoisi?.methode_repartition || '') as CleRepartition | ''
  const cleEcartee = !!typeChoisi && !!cleNouvelle && cleNouvelle !== typeChoisi.methode_repartition
  const montantDh = nombre(n.montant_devise) * (n.code_devise === 'MAD' ? 1 : nombre(n.cours_change))

  /* LE COURS DU JOUR EST PROPOSE (06/10/2026), comme sur les factures : un frais
     en devise laisse au cours 1 entrait au cout de revient au cours du dirham. */
  const fraisEnDevise = n.code_devise !== 'MAD'
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const qTauxFrais = useQuery({
    queryKey: ['taux-reference', n.code_devise, aujourdhui],
    queryFn: () =>
      api.get<{ reference: number | null; source: string | null }>(
        `/api/import/taux-reference?devise=${encodeURIComponent(n.code_devise)}&date=${aujourdhui}`,
      ),
    enabled: saisie && fraisEnDevise,
  })
  const coursPropose = fraisEnDevise ? (qTauxFrais.data?.reference ?? null) : null
  useEffect(() => {
    if (coursPropose && n.cours_change === '') setN((x) => ({ ...x, cours_change: String(coursPropose) }))
  }, [coursPropose, n.cours_change])

  const corpsFrais = (confirme?: boolean) => ({
    id_frais: n.id_frais,
    libelle: n.libelle || null,
    numero_piece: n.numero_piece || null,
    montant_devise: nombre(n.montant_devise),
    code_devise: n.code_devise,
    cours_change: n.code_devise === 'MAD' ? 1 : nombre(n.cours_change),
    cle_repartition: cleNouvelle || null,
    motif_cle: cleEcartee ? n.motif_cle.trim() : null,
    taux_confirme: confirme === true,
  })
  const ajouter = useMutation({
    mutationFn: (confirme?: boolean) =>
      postCloture
        ? api.post(`/api/import/dossiers/${idDossier}/frais-post-cloture`, { ...corpsFrais(confirme), motif: motifPost.trim() })
        : api.post(`/api/import/dossiers/${idDossier}/frais`, corpsFrais(confirme)),
    onSuccess: () => {
      toast.success(
        !typeChoisi?.inclus_dans_cout
          ? 'Fiche ajoutée en brouillon — hors coût de revient'
          : 'Fiche ajoutée en brouillon — vérifiez l’aperçu de sa répartition, puis validez',
      )
      setN(vide)
      setMotifPost('')
      rafraichir()
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      if (e instanceof ErreurApi ? e.estRegle('TAUX-ECART') : message.includes('TAUX-ECART')) {
        confirmation.demander({
          titre: 'Cours éloigné de celui de Bank Al-Maghrib',
          description: e instanceof ErreurApi ? e.messageSansCode : message.replace(/^TAUX-ECART : /, ''),
          libelleConfirmer: 'Je confirme ce cours',
          action: () => ajouter.mutate(true),
        })
        return
      }
      echec(e)
    },
  })
  const supprimer = useMutation({
    mutationFn: (idFrais: string) => api.delete(`/api/import/frais/${idFrais}`),
    onSuccess: () => {
      toast.success('Fiche supprimée')
      rafraichir()
    },
    onError: echec,
  })

  const inclus = d.frais.filter((f) => f.inclus_dans_cout === 1).reduce((t, f) => t + f.montant_dhs, 0)
  const hors = d.frais.filter((f) => f.inclus_dans_cout === 0).reduce((t, f) => t + f.montant_dhs, 0)
  const applique = d.frais.reduce((t, f) => t + (f.montant_applique_dhs ?? 0), 0)
  const complet =
    n.id_frais &&
    nombre(n.montant_devise) > 0 &&
    (n.code_devise === 'MAD' || nombre(n.cours_change) > 0) &&
    (!cleEcartee || n.motif_cle.trim().length >= 5) &&
    (!postCloture || motifPost.trim().length >= 5)
  const maj = (k: keyof typeof n) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setN((x) => ({
      ...x,
      [k]: e.target.value,
      // Passer a une devise vide le cours : celui du jour vient s'y proposer.
      ...(k === 'code_devise' ? { cours_change: e.target.value === 'MAD' ? '1' : '' } : {}),
      // Un autre type : sa cle proposee reprend la main.
      ...(k === 'id_frais' ? { cle: '', motif_cle: '' } : {}),
    }))
  // La fiche en cours de saisie, complete, part avec « Enregistrer tout ».
  useEffect(() => {
    signaler?.('frais', complet && ecrire ? { libelle: 'nouvelle fiche de frais', enregistrer: () => ajouter.mutateAsync(false) } : null)
  })
  useEffect(() => () => signaler?.('frais', null), [signaler])

  const basculer = (id: string, vue: VueFiche) =>
    setOuverte((o) => (o && o.id === id && o.vue === vue ? null : { id, vue }))
  const colonnes = saisie || valider ? 8 : 7

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Frais du dossier</CarteTitre>
        <span className="text-[11.5px] text-attenue-texte">
          Montant HT. Le type propose une clé ; vous la confirmez ou en choisissez une autre permise, avec un motif.
        </span>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-bordure">
                <th className={cn(th, 'text-left')}>Type de frais</th>
                <th className={cn(th, 'text-left')}>Précision</th>
                <th className={cn(th, 'text-left')}>N° pièce</th>
                <th className={cn(th, 'text-right')}>Montant</th>
                <th className={cn(th, 'text-right')}>Montant DH</th>
                <th className={cn(th, 'text-left')}>Fiche · clé</th>
                <th className={cn(th, 'text-right')}>Appliqué · reste</th>
                {(saisie || valider) && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {d.frais.map((f) => {
                const brouillon = f.statut_fiche === 'BROUILLON'
                const validee = f.statut_fiche === 'VALIDE' || f.statut_fiche === 'APPLIQUE'
                const rienApplique = Math.abs(f.montant_applique_dhs ?? 0) < 0.005
                const vue = ouverte?.id === f.id_ligne_frais ? ouverte.vue : null
                return (
                  <Fragment key={f.id_ligne_frais}>
                    <tr className={cn('border-b border-bordure/60', !f.inclus_dans_cout && 'text-attenue-texte', vue && 'bg-attenue/30')}>
                      <td className={cn(td, 'font-medium')}>
                        {f.frais_libelle}
                        {f.id_ligne_frais_origine && <div className="text-[11px] font-normal text-attenue-texte">Rectificative — {f.motif_rectification}</div>}
                        {f.post_cloture === 1 && <div className="text-[11px] font-normal text-attenue-texte">Frais tardif — {f.motif_post_cloture}</div>}
                      </td>
                      <td className={td}>{f.libelle ?? '—'}</td>
                      <td className={cn(td, 'tabular-nums')}>{f.numero_piece ?? '—'}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {fmt.nombre(f.montant_devise, 2)} {f.code_devise}
                        {f.code_devise !== 'MAD' && <div className="text-[11px] text-attenue-texte">× {fmt.nombre(f.cours_change, 4)}</div>}
                      </td>
                      <td className={cn(td, 'text-right font-medium tabular-nums')}>{fmt.nombre(f.montant_dhs, 2)}</td>
                      <td className={td}>
                        {f.statut_fiche ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <Badge ton={TON_FICHE[f.statut_fiche]}>{LIBELLE_FICHE[f.statut_fiche]}</Badge>
                            {f.inclus_dans_cout ? (
                              <span className="text-[11.5px]" title={f.motif_cle ?? undefined}>
                                {f.cle_repartition ? LIBELLE_CLE[f.cle_repartition] : '—'}
                                {f.cle_repartition && f.cle_repartition !== f.cle_proposee && ' *'}
                                {' · '}
                                {f.cibles.length === 0 ? 'tout le dossier' : `${f.cibles.length} ligne(s)`}
                              </span>
                            ) : (
                              <Badge ton="neutre">hors coût</Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-[11.5px] text-attenue-texte" title="Porté à la clôture par l'ancien moteur ; conservé tel quel">
                            Historique (clé non conservée)
                          </span>
                        )}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {f.statut_fiche && f.inclus_dans_cout ? (
                          <>
                            {dh(f.montant_applique_dhs)}
                            {Math.abs(f.reste_a_appliquer_dhs ?? 0) >= 0.005 && (
                              <div className="text-[11px] text-alerte">reste {dh(f.reste_a_appliquer_dhs)}</div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      {(saisie || valider) && (
                        <td className={td}>
                          <div className="flex flex-wrap justify-end gap-0.5">
                            {f.statut_fiche && f.inclus_dans_cout === 1 && (brouillon || f.statut_fiche) && (
                              <Bouton taille="sm" variante={vue === 'apercu' ? 'primaire' : 'contour'}
                                onClick={() => basculer(f.id_ligne_frais, 'apercu')}>
                                {brouillon ? 'Répartir' : 'Répartition'}
                              </Bouton>
                            )}
                            {brouillon && f.inclus_dans_cout === 0 && valider && (
                              <Bouton taille="sm" variante="contour" onClick={() => basculer(f.id_ligne_frais, 'apercu')}>
                                Valider…
                              </Bouton>
                            )}
                            {brouillon && saisie && f.inclus_dans_cout === 1 && (
                              <Bouton taille="icone-xs" variante="discret" title="Choisir les lignes qui portent ce frais"
                                aria-label="Cibler des lignes" onClick={() => setCible(f)}>
                                <Target />
                              </Bouton>
                            )}
                            {validee && valider && rienApplique && f.statut_fiche === 'VALIDE' && (
                              <Bouton taille="sm" variante="discret" onClick={() => basculer(f.id_ligne_frais, 'brouillon')}>
                                En brouillon…
                              </Bouton>
                            )}
                            {validee && valider && !f.id_ligne_frais_origine && (
                              <Bouton taille="sm" variante="discret" onClick={() => basculer(f.id_ligne_frais, 'rectifier')}>
                                Rectifier…
                              </Bouton>
                            )}
                            {f.statut_fiche && (
                              <Bouton taille="icone-xs" variante="discret" title="Historique de la fiche" aria-label="Historique de la fiche"
                                onClick={() => basculer(f.id_ligne_frais, 'historique')}>
                                <History />
                              </Bouton>
                            )}
                            {brouillon && saisie && (
                              <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10"
                                aria-label="Supprimer la fiche"
                                onClick={() =>
                                  confirmation.demander({
                                    titre: `Supprimer « ${f.frais_libelle} » ?`,
                                    destructif: true,
                                    libelleConfirmer: 'Supprimer',
                                    description: 'Une fiche en brouillon n’a rien alloué ni appliqué.',
                                    action: () => supprimer.mutate(f.id_ligne_frais),
                                  })
                                }>
                                <Trash2 />
                              </Bouton>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {vue && (
                      <tr className="border-b border-bordure bg-attenue/20">
                        <td colSpan={colonnes} className="px-3 py-3">
                          {vue === 'apercu' && (
                            <ApercuFicheVue f={f} d={d} saisie={saisie} valider={valider} surFin={() => { setOuverte(null); rafraichir() }} />
                          )}
                          {vue === 'brouillon' && (
                            <RetourBrouillon f={f} surFin={() => { setOuverte(null); rafraichir() }} />
                          )}
                          {vue === 'rectifier' && (
                            <Rectification f={f} surFin={() => { setOuverte(null); rafraichir() }} />
                          )}
                          {vue === 'historique' && <HistoriqueFiche f={f} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}

              {/* LA LIGNE DE SAISIE, a la suite des fiches : on remplit comme une
                  ligne du classeur, et « Ajouter ». La fiche nait en brouillon. */}
              {saisie && (
                <tr className="border-b border-bordure/60 bg-attenue/25 align-top">
                  <td className={td}>
                    <Selecteur className="h-7 w-full min-w-[12rem]" aria-label="Type de frais" value={n.id_frais} onChange={maj('id_frais')}>
                      <option value="">Nouveau frais…</option>
                      {groupes.map(([cat, liste]) => (
                        <optgroup key={cat} label={cat}>
                          {liste.map((p) => (
                            <option key={p.id_frais} value={p.id_frais}>
                              {p.libelle}{p.inclus_dans_cout ? '' : ' — hors coût'}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Selecteur>
                    {/* La piece a avoir en main pour ce frais. */}
                    {typeChoisi?.piece_justificative && (
                      <div className="mt-0.5 text-[11px] text-attenue-texte">{typeChoisi.piece_justificative}</div>
                    )}
                  </td>
                  <td className={td}><Champ className="h-7 min-w-[8rem]" aria-label="Libellé du frais" value={n.libelle} onChange={maj('libelle')} placeholder="ESMATRANS…" /></td>
                  <td className={td}><Champ className="h-7 min-w-[6rem]" aria-label="N° de pièce" value={n.numero_piece} onChange={maj('numero_piece')} placeholder="F2610861" /></td>
                  <td className={td}>
                    <div className="flex gap-1">
                      <Champ className="h-7 w-24 text-right" inputMode="decimal" aria-label="Montant HT" value={n.montant_devise}
                        onChange={maj('montant_devise')} placeholder="0,00"
                        onKeyDown={(e) => e.key === 'Enter' && complet && ajouter.mutate(false)} />
                      <Selecteur className="h-7 w-[5.5rem] pl-2 pr-6" aria-label="Devise du frais" value={n.code_devise} onChange={maj('code_devise')}>
                        {(qDevises.data ?? [{ code_devise: 'MAD' }]).map((x) => (
                          <option key={x.code_devise}>{x.code_devise}</option>
                        ))}
                      </Selecteur>
                    </div>
                    {fraisEnDevise && (
                      <Champ className="mt-1 h-7 w-full text-right" inputMode="decimal" aria-label="Cours de change" value={n.cours_change}
                        onChange={maj('cours_change')} placeholder="Cours" />
                    )}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums text-attenue-texte')}>
                    {montantDh > 0 ? fmt.nombre(montantDh, 2) : '—'}
                  </td>
                  <td className={cn(td, 'text-[11.5px]')}>
                    {typeChoisi &&
                      (typeChoisi.inclus_dans_cout ? (
                        <>
                          <Selecteur className="h-7 w-full min-w-[9rem]" aria-label="Clé de répartition" value={cleNouvelle}
                            onChange={maj('cle')}>
                            {(typeChoisi.cles_autorisees ?? [typeChoisi.methode_repartition]).map((c) => (
                              <option key={c} value={c}>
                                {LIBELLE_CLE[c]}{c === typeChoisi.methode_repartition ? ' (proposée)' : ''}
                              </option>
                            ))}
                          </Selecteur>
                          {cleEcartee && (
                            <Champ className="mt-1 h-7 w-full" aria-label="Motif de la clé" value={n.motif_cle}
                              onChange={maj('motif_cle')} placeholder="Pourquoi cette clé (obligatoire)" />
                          )}
                        </>
                      ) : (
                        <span className="text-alerte">
                          hors coût{typeChoisi.recuperable ? ' — récupérable' : ''}
                        </span>
                      ))}
                  </td>
                  <td className={td} />
                  <td className={td}>
                    <Bouton taille="sm" disabled={!complet} chargement={ajouter.isPending} onClick={() => ajouter.mutate(false)}>
                      <Plus />
                      Ajouter
                    </Bouton>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-attenue/40 font-semibold">
                <td className={td} colSpan={4}>Frais inclus dans le coût</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(inclus, 2)}</td>
                <td className={cn(td, 'text-[11.5px] font-normal text-attenue-texte')}>
                  + {fmt.nombre(hors, 2)} DH hors coût (TVA)
                </td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(applique, 2)}</td>
                {(saisie || valider) && <td className={td} />}
              </tr>
            </tfoot>
          </table>
        </div>
      </CarteCorps>
      {postCloture && (
        <CarteCorps className="space-y-1 border-t border-bordure">
          <Etiq obligatoire htmlFor="ch-dossierimport-9">Frais tardif : quelle facture arrive après la clôture ?</Etiq>
          <Champ id="ch-dossierimport-9"
            value={motifPost}
            onChange={(e) => setMotifPost(e.target.value)}
            placeholder="Ex. : facture du transitaire reçue le 12/10"
          />
          <p className="m-0 text-[11.5px] text-attenue-texte">
            La fiche s’ajoute en brouillon ; son aperçu montre ce qui ira au stock restant et au journal des écarts.
          </p>
        </CarteCorps>
      )}
      <RestesAuSolde d={d} valider={valider} surFin={rafraichir} />
      <CiblesPanneau idDossier={idDossier} frais={cible} lignes={d.lignes} surFermer={() => setCible(null)} />
      {confirmation.element}
    </Carte>
  )
}

/** L'APERCU — le meme calcul que la validation, cote serveur, annule. La cle
    et son motif se decident ici ; en MANUEL, les montants ligne par ligne. */
function ApercuFicheVue({
  f, d, saisie, valider, surFin,
}: { f: Frais; d: DossierComplet; saisie: boolean; valider: boolean; surFin: () => void }) {
  const brouillon = f.statut_fiche === 'BROUILLON'
  const [cle, setCle] = useState<CleRepartition>(f.cle_repartition ?? f.cle_proposee)
  const [motif, setMotif] = useState(f.motif_cle ?? '')
  const ecartee = cle !== f.cle_proposee
  const lignesVisees = d.lignes.filter((l) => f.cibles.length === 0 || f.cibles.includes(l.id_ligne))
  const [montants, setMontants] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.lignes.map((l) => [l.id_ligne, f.montants_saisis[l.id_ligne] !== undefined ? String(f.montants_saisis[l.id_ligne]) : ''])),
  )
  const decision = { cle_repartition: cle, motif_cle: ecartee ? motif.trim() : null }

  const apercu = useMutation({
    mutationFn: () =>
      brouillon
        ? api.post<ApercuFiche>(`/api/import/frais/${f.id_ligne_frais}/apercu`, decision)
        : Promise.resolve(null),
    onError: echec,
  })
  const enregistrerMontants = useMutation({
    mutationFn: () =>
      api.patch(`/api/import/frais/${f.id_ligne_frais}`, {
        cle_repartition: 'MANUEL',
        motif_cle: ecartee ? motif.trim() : '',
        montants: Object.entries(montants)
          .filter(([, v]) => v.trim() !== '')
          .map(([id_ligne, v]) => ({ id_ligne, montant: nombre(v) })),
      }),
    onSuccess: () => {
      toast.success('Montants enregistrés')
      apercu.mutate()
    },
    onError: echec,
  })
  const validerFiche = useMutation({
    mutationFn: () => api.post<ApercuFiche>(`/api/import/frais/${f.id_ligne_frais}/valider`, decision),
    onSuccess: (r) => {
      toast.success(
        r.statut_fiche === 'APPLIQUE'
          ? 'Fiche validée et entièrement appliquée'
          : `Fiche validée — ${fmt.nombre(r.montant_applique_dhs ?? 0, 2)} DH appliqués, le reste suivra les réceptions`,
      )
      for (const a of r.avis) toast.warning(a)
      surFin()
    },
    onError: echec,
  })
  // L'apercu se calcule a l'ouverture, puis a chaque changement de cle.
  useEffect(() => {
    if (brouillon && f.inclus_dans_cout === 1) apercu.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle])

  const a = apercu.data
  const motifManquant = ecartee && motif.trim().length < 5
  const sommeSaisie = Object.values(montants).reduce((t, v) => t + nombre(v), 0)

  if (!brouillon) {
    // Une fiche validee : son allocation figee, lue telle qu'enregistree.
    const allocation = d.repartition.filter((r) => r.id_ligne_frais === f.id_ligne_frais)
    return (
      <div className="space-y-2">
        <div className="text-[12px] text-attenue-texte">
          Allocation figée le {fmt.date(f.date_validation)}{f.valide_par && ` par ${f.valide_par}`} —{' '}
          {f.cle_repartition ? LIBELLE_CLE[f.cle_repartition] : '—'}
          {f.motif_cle && ` (motif : ${f.motif_cle})`}
        </div>
        <TableAllocation
          lignes={allocation.map((r) => {
            const l = d.lignes.find((x) => x.id_ligne === r.id_article_dossier)
            return {
              id_ligne: r.id_article_dossier,
              code_reference: l?.code_reference ?? null,
              designation: l?.designation ?? null,
              type_ligne: l?.type_ligne ?? 'ERP',
              quantite: l?.quantite ?? 0,
              valeur_dhs: l?.valeur_achat_dhs,
              poids_net_kg: l?.poids_net_kg ?? null,
              base_repartition: r.base_repartition ?? undefined,
              pourcentage: r.pourcentage,
              montant_theorique: r.montant_theorique ?? undefined,
              montant_alloue_dhs: r.montant_alloue_dhs,
            }
          })}
          montant={f.montant_dhs}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {f.inclus_dans_cout === 1 && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Etiq htmlFor={`cle-${f.id_ligne_frais}`}>Clé de répartition</Etiq>
            <Selecteur id={`cle-${f.id_ligne_frais}`} className="h-8 min-w-[12rem]" value={cle} disabled={!saisie}
              onChange={(e) => setCle(e.target.value as CleRepartition)}>
              {f.cles_autorisees.map((c) => (
                <option key={c} value={c}>{LIBELLE_CLE[c]}{c === f.cle_proposee ? ' (proposée)' : ''}</option>
              ))}
            </Selecteur>
          </div>
          {ecartee && (
            <div className="min-w-[16rem] flex-1">
              <Etiq obligatoire htmlFor={`motif-${f.id_ligne_frais}`}>Pourquoi pas la clé proposée ({LIBELLE_CLE[f.cle_proposee]}) ?</Etiq>
              <Champ id={`motif-${f.id_ligne_frais}`} value={motif} onChange={(e) => setMotif(e.target.value)}
                placeholder="Ex. : le fret facturé suit le poids, pas la valeur" />
            </div>
          )}
          <Bouton variante="contour" chargement={apercu.isPending} onClick={() => apercu.mutate()}>Recalculer l’aperçu</Bouton>
        </div>
      )}

      {cle === 'MANUEL' && f.inclus_dans_cout === 1 && (
        <div className="space-y-1">
          <div className="text-[12px] font-medium">Montant affecté à chaque ligne (la somme doit faire {fmt.nombre(f.montant_dhs, 2)} DH)</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {lignesVisees.map((l) => (
              <label key={l.id_ligne} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{l.code_reference ?? l.designation}</span>
                <Champ className="h-7 w-28 text-right" inputMode="decimal" aria-label={`Montant pour ${l.code_reference ?? l.designation}`}
                  value={montants[l.id_ligne] ?? ''} disabled={!saisie}
                  onChange={(e) => setMontants((m) => ({ ...m, [l.id_ligne]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className={cn('tabular-nums', Math.abs(sommeSaisie - f.montant_dhs) < 0.005 ? 'text-succes' : 'text-alerte')}>
              Saisi : {fmt.nombre(sommeSaisie, 2)} / {fmt.nombre(f.montant_dhs, 2)} DH
            </span>
            {saisie && (
              <Bouton taille="sm" variante="contour" disabled={motifManquant} chargement={enregistrerMontants.isPending}
                onClick={() => enregistrerMontants.mutate()}>
                Enregistrer les montants
              </Bouton>
            )}
          </div>
        </div>
      )}

      {a && a.capitalisable && <TableAllocation lignes={a.lignes} montant={a.montant_dhs} />}
      {a && a.capitalisable && (
        <div className="space-y-1 text-[12px]">
          <div className={cn('font-medium', a.equilibre ? 'text-succes' : 'text-danger')}>
            {a.equilibre ? '✓ Répartition équilibrée — total réparti = montant de la fiche' : 'Répartition déséquilibrée'}
          </div>
          {a.applications.length > 0 ? (
            <div>
              À la validation : {dh(a.montant_applique_dhs)} DH s’appliquent aux kilos déjà reçus
              {' '}({a.applications.map((x) => `${x.code_reference}${x.reception ? ` — ${x.reception}` : ''} : ${dh(x.au_stock_dhs)} au stock, ${dh(x.consomme_dhs)} au consommé`).join(' ; ')}).
              {Math.abs(a.reste_a_appliquer_dhs ?? 0) >= 0.005 && ` ${dh(a.reste_a_appliquer_dhs)} DH suivront les réceptions.`}
            </div>
          ) : (
            <div className="text-attenue-texte">Rien n’est encore reçu : tout s’appliquera à mesure des réceptions.</div>
          )}
          {a.avis.map((x) => <div key={x} className="text-alerte">{x}</div>)}
        </div>
      )}
      {f.inclus_dans_cout === 0 && (
        <p className="m-0 text-[12px] text-attenue-texte">Frais hors coût : sa validation n’alloue ni n’applique rien au stock.</p>
      )}

      {valider && (
        <div className="flex justify-end">
          <Bouton disabled={motifManquant || (f.inclus_dans_cout === 1 && (!a || !a.equilibre))} chargement={validerFiche.isPending}
            onClick={() => validerFiche.mutate()}>
            <ShieldCheck />
            Valider la fiche
          </Bouton>
        </div>
      )}
    </div>
  )
}

/** La grille de l'allocation : on lit pourquoi chaque ligne recoit son montant. */
function TableAllocation({ lignes, montant }: { lignes: ApercuFiche['lignes']; montant: number }) {
  const total = lignes.reduce((t, l) => t + (l.montant_alloue_dhs ?? 0), 0)
  const totalBase = lignes.reduce((t, l) => t + (l.base_repartition ?? 0), 0)
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-bordure">
          <th className={cn(th, 'text-left')}>Article</th>
          <th className={cn(th, 'text-right')}>Valeur DH</th>
          <th className={cn(th, 'text-right')}>Poids net kg</th>
          <th className={cn(th, 'text-right')}>Base</th>
          <th className={cn(th, 'text-right')}>%</th>
          <th className={cn(th, 'text-right')}>Théorique</th>
          <th className={cn(th, 'text-right')}>Final DH</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.id_ligne} className="border-b border-bordure/50">
            <td className={td}>{l.code_reference ?? l.designation ?? '—'}</td>
            <td className={cn(td, 'text-right tabular-nums')}>{dh(l.valeur_dhs)}</td>
            <td className={cn(td, 'text-right tabular-nums')}>{l.poids_net_kg === null ? '—' : fmt.nombre(l.poids_net_kg, 2)}</td>
            <td className={cn(td, 'text-right tabular-nums')}>{l.base_repartition === undefined ? '—' : fmt.nombre(l.base_repartition, 2)}</td>
            <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(l.pourcentage, 2)} %</td>
            <td className={cn(td, 'text-right tabular-nums text-attenue-texte')}>
              {l.montant_theorique === undefined ? '—' : fmt.nombre(l.montant_theorique, 4)}
            </td>
            <td className={cn(td, 'text-right font-medium tabular-nums')}>{dh(l.montant_alloue_dhs)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className={td}>TOTAL</td>
          <td className={td} />
          <td className={td} />
          <td className={cn(td, 'text-right tabular-nums')}>{totalBase ? fmt.nombre(totalBase, 2) : '—'}</td>
          <td className={cn(td, 'text-right tabular-nums')}>100 %</td>
          <td className={td} />
          <td className={cn(td, 'text-right tabular-nums', Math.abs(total - montant) < 0.005 ? 'text-succes' : 'text-danger')}>
            {fmt.nombre(total, 2)} / {fmt.nombre(montant, 2)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

/** VALIDEE, RIEN D'APPLIQUE : retour en brouillon, avec son motif. */
function RetourBrouillon({ f, surFin }: { f: Frais; surFin: () => void }) {
  const [motif, setMotif] = useState('')
  const m = useMutation({
    mutationFn: () => api.post(`/api/import/frais/${f.id_ligne_frais}/brouillon`, { motif: motif.trim() }),
    onSuccess: () => {
      toast.success('Fiche revenue en brouillon — son allocation reste archivée')
      surFin()
    },
    onError: echec,
  })
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[18rem] flex-1">
        <Etiq obligatoire htmlFor={`brouillon-${f.id_ligne_frais}`}>Pourquoi revenir en brouillon ?</Etiq>
        <Champ id={`brouillon-${f.id_ligne_frais}`} value={motif} onChange={(e) => setMotif(e.target.value)}
          placeholder="Ex. : mauvaise clé choisie, rien n’est encore reçu" />
      </div>
      <Bouton variante="contour" disabled={motif.trim().length < 5} chargement={m.isPending} onClick={() => m.mutate()}>
        Remettre en brouillon
      </Bouton>
    </div>
  )
}

/** UNE RECTIFICATIVE : une fiche nouvelle, liee ; l'originale ne change pas. */
function Rectification({ f, surFin }: { f: Frais; surFin: () => void }) {
  const [montant, setMontant] = useState('')
  const [motif, setMotif] = useState('')
  const [piece, setPiece] = useState('')
  const m = useMutation({
    mutationFn: () =>
      api.post(`/api/import/frais/${f.id_ligne_frais}/rectifier`, {
        montant_devise: nombre(montant), motif: motif.trim(), numero_piece: piece.trim(),
      }),
    onSuccess: () => {
      toast.success('Rectificative créée en brouillon — vérifiez sa répartition, puis validez-la')
      surFin()
    },
    onError: echec,
  })
  const complet = nombre(montant) !== 0 && motif.trim().length >= 5 && piece.trim() !== ''
  return (
    <div className="space-y-2">
      <p className="m-0 text-[12px] text-attenue-texte">
        La fiche d’origine reste telle quelle. La rectificative porte la différence (négative pour un avoir), en {f.code_devise},
        et propose l’allocation de l’originale au prorata.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Etiq obligatoire htmlFor={`rect-m-${f.id_ligne_frais}`}>Différence ({f.code_devise})</Etiq>
          <Champ id={`rect-m-${f.id_ligne_frais}`} className="w-32 text-right" inputMode="decimal" value={montant}
            onChange={(e) => setMontant(e.target.value)} placeholder="-19,00" />
        </div>
        <div className="min-w-[14rem] flex-1">
          <Etiq obligatoire htmlFor={`rect-motif-${f.id_ligne_frais}`}>Motif</Etiq>
          <Champ id={`rect-motif-${f.id_ligne_frais}`} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Avoir du transitaire" />
        </div>
        <div>
          <Etiq obligatoire htmlFor={`rect-piece-${f.id_ligne_frais}`}>Pièce</Etiq>
          <Champ id={`rect-piece-${f.id_ligne_frais}`} className="w-36" value={piece} onChange={(e) => setPiece(e.target.value)} placeholder="AV-0042" />
        </div>
        <Bouton disabled={!complet} chargement={m.isPending} onClick={() => m.mutate()}>Créer la rectificative</Bouton>
      </div>
    </div>
  )
}

/** L'HISTORIQUE : versions d'allocation (archivees comprises), applications,
    rectificatives, decisions. */
function HistoriqueFiche({ f }: { f: Frais }) {
  const q = useQuery({
    queryKey: ['import-frais-historique', f.id_ligne_frais],
    queryFn: ({ signal }) =>
      api.get<{
        allocations: { version: number; code_reference: string | null; pourcentage: number; montant_alloue_dhs?: number; en_vigueur: boolean }[]
        journal: { date_ajustement: string; type_operation: string | null; nature: string; code_reference: string; code_magasin: string | null; quantite_kg: number | null; montant_dhs?: number; numero_reception: string | null; motif: string | null; par: string | null }[]
        rectificatives: { id_ligne_frais: string; montant_dhs?: number; statut_fiche: string; motif_rectification: string; numero_piece: string }[]
      }>(`/api/import/frais/${f.id_ligne_frais}/historique`, { signal }),
  })
  if (q.isLoading) return <Chargement texte="Lecture de l’historique…" />
  if (!q.data) return null
  const versions = [...new Set(q.data.allocations.map((a) => a.version))]
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div>
        <div className="mb-1 text-[12px] font-semibold">Allocations</div>
        {versions.length === 0 && <div className="text-[12px] text-attenue-texte">Aucune allocation enregistrée.</div>}
        {versions.map((v) => {
          const lignes = q.data.allocations.filter((a) => a.version === v)
          return (
            <div key={v} className="mb-2 text-[12px]">
              <div className="font-medium">
                Version {v} {lignes[0]?.en_vigueur ? <Badge ton="succes">en vigueur</Badge> : <Badge ton="neutre">archivée</Badge>}
              </div>
              {lignes.map((a, i) => (
                <div key={i} className="flex justify-between gap-2 tabular-nums">
                  <span>{a.code_reference ?? '—'}</span>
                  <span>{fmt.nombre(a.pourcentage, 2)} % · {dh(a.montant_alloue_dhs)} DH</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div>
        <div className="mb-1 text-[12px] font-semibold">Applications au coût</div>
        {q.data.journal.length === 0 && <div className="text-[12px] text-attenue-texte">Rien n’est encore appliqué.</div>}
        {q.data.journal.map((j, i) => (
          <div key={i} className="flex justify-between gap-2 text-[12px] tabular-nums">
            <span>
              {fmt.date(j.date_ajustement)} · {j.code_reference} · {j.nature === 'STOCK' ? `stock ${j.code_magasin}` : 'consommé'}
              {j.numero_reception && ` · ${j.numero_reception}`}
              {j.type_operation === 'CONTRE_PASSATION' && ' · contre-passation'}
            </span>
            <span>{dh(j.montant_dhs)} DH</span>
          </div>
        ))}
        {q.data.rectificatives.length > 0 && (
          <>
            <div className="mb-1 mt-2 text-[12px] font-semibold">Rectificatives</div>
            {q.data.rectificatives.map((r) => (
              <div key={r.id_ligne_frais} className="flex justify-between gap-2 text-[12px]">
                <span>{r.numero_piece} — {r.motif_rectification}</span>
                <span className="tabular-nums">{dh(r.montant_dhs)} DH · {r.statut_fiche.toLowerCase()}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** LES RESTES DES LIGNES SOLDEES : ce qui depasse les kilos recus attend une
    decision explicite — aux kilos recus, ou au journal des ecarts. */
function RestesAuSolde({ d, valider, surFin }: { d: DossierComplet; valider: boolean; surFin: () => void }) {
  const [choix, setChoix] = useState<Record<string, { choix: string; motif: string }>>({})
  const restes = useMemo(() => {
    const fiches = new Set(d.frais.filter((f) => f.statut_fiche && f.statut_fiche !== 'BROUILLON' && f.inclus_dans_cout === 1).map((f) => f.id_ligne_frais))
    return d.lignes
      .filter((l) => l.soldee === 1 && l.type_ligne === 'ERP')
      .map((l) => {
        const alloue = d.repartition
          .filter((r) => r.id_article_dossier === l.id_ligne && fiches.has(r.id_ligne_frais))
          .reduce((t, r) => t + (r.montant_alloue_dhs ?? 0), 0)
        const applique = d.ajustements
          .filter((j) => j.id_ligne === l.id_ligne && j.origine === 'FICHE')
          .reduce((t, j) => t + (j.montant_dhs ?? 0), 0)
        return { l, reste: alloue - applique }
      })
      .filter((x) => Math.abs(x.reste) >= 0.005)
  }, [d])
  const m = useMutation({
    mutationFn: (id: string) => api.post(`/api/import/lignes/${id}/reste-frais`, choix[id]),
    onSuccess: () => {
      toast.success('Décision enregistrée et appliquée')
      surFin()
    },
    onError: echec,
  })
  if (restes.length === 0) return null
  return (
    <CarteCorps className="space-y-2 border-t border-bordure">
      <div className="text-[12.5px] font-semibold">Restes de frais sur des lignes soldées — à décider</div>
      {restes.map(({ l, reste }) => {
        const c = choix[l.id_ligne] ?? { choix: '', motif: '' }
        const maj = (v: Partial<typeof c>) => setChoix((x) => ({ ...x, [l.id_ligne]: { ...c, ...v } }))
        return (
          <div key={l.id_ligne} className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="min-w-[12rem] flex-1">
              {l.code_reference} — <span className="tabular-nums">{fmt.nombre(reste, 2)} DH</span> au-delà des kilos reçus
            </span>
            {valider && (
              <>
                <Selecteur className="h-7 min-w-[13rem]" aria-label="Décision sur le reste" value={c.choix}
                  onChange={(e) => maj({ choix: e.target.value })}>
                  <option value="">Choisir…</option>
                  <option value="APPLIQUER_RECU">Appliquer aux kilos reçus</option>
                  <option value="JOURNAL_ECART">Journal des écarts</option>
                </Selecteur>
                <Champ className="h-7 min-w-[12rem]" aria-label="Motif de la décision" value={c.motif}
                  onChange={(e) => maj({ motif: e.target.value })} placeholder="Motif (obligatoire)" />
                <Bouton taille="sm" disabled={!c.choix || c.motif.trim().length < 5} chargement={m.isPending}
                  onClick={() => m.mutate(l.id_ligne)}>
                  Décider
                </Bouton>
              </>
            )}
          </div>
        )
      })}
    </CarteCorps>
  )
}

// ============================================================================
// 3. Factures du dossier
// ============================================================================

function FacturesDossier({ d, ecrire }: { d: DossierComplet; ecrire: boolean }) {
  const ouvrir = useOuvrirVue()
  const idDossier = d.dossier.id_dossier
  const parFacture = (id: string) => d.lignes.filter((l) => l.id_facture === id)
  const coutVisible = d.lignes.some((l) => l.frais_alloues_dhs !== undefined)
  const somme = (f: (l: DossierComplet['lignes'][number]) => number) => d.lignes.reduce((t, l) => t + f(l), 0)

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Factures du dossier</CarteTitre>
        {ecrire && (
          <Bouton taille="sm" onClick={() => ouvrir(`/import/${idDossier}/factures/nouvelle`)}>
            <Plus />
            Ajouter une facture
          </Bouton>
        )}
      </CarteEntete>
      <CarteCorps className="p-0">
        {d.factures.length === 0 ? (
          <p className="p-3 text-[12.5px] text-attenue-texte">
            Aucune facture. Un dossier peut regrouper les factures de plusieurs fournisseurs.
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
            <table className="w-full min-w-[62rem] text-[12.5px]">
              <thead>
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'text-left')}>Fournisseur</th>
                  <th className={cn(th, 'text-left')}>N° facture</th>
                  <th className={cn(th, 'text-left')}>Date</th>
                  <th className={cn(th, 'text-right')}>Lignes</th>
                  <th className={cn(th, 'text-right')}>Montant devise</th>
                  <th className={cn(th, 'text-right')}>Valeur DH</th>
                  {coutVisible && <th className={cn(th, 'text-right')}>Frais alloués</th>}
                  <th className={cn(th, 'text-right')}>Poids net</th>
                  <th className={cn(th, 'text-right')}>Palettes</th>
                  <th className={cn(th, 'text-right')}>Bobines</th>
                  <th className={cn(th, 'text-left')}>Réception</th>
                  <th className={cn(th, 'w-24')} />
                </tr>
              </thead>
              <tbody>
                {d.factures.map((f) => {
                  const lignes = parFacture(f.id_facture)
                  const ecart = f.montant_devise != null && Math.abs(f.montant_devise - f.montant_lignes_devise) > 0.005
                  return (
                    <tr key={f.id_facture} className="cursor-pointer border-b border-bordure/60 hover:bg-attenue/30"
                      onClick={() => ouvrir(`/import/${idDossier}/factures/${f.id_facture}`)}>
                      <td className={cn(td, 'font-medium')}>{f.fournisseur_nom}</td>
                      <td className={cn(td, 'tabular-nums')}>{f.numero_facture}</td>
                      <td className={td}>{fmt.date(f.date_facture)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{f.nb_lignes}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {fmt.nombre(f.montant_lignes_devise, 2)} {f.code_devise}
                        {ecart && <div className="text-[10.5px] text-alerte">imprimé {fmt.nombre(f.montant_devise, 2)}</div>}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(lignes.reduce((t, l) => t + l.valeur_achat_dhs, 0), 2)}</td>
                      {coutVisible && (
                        <td className={cn(td, 'text-right tabular-nums')}>
                          {fmt.nombre(lignes.reduce((t, l) => t + (l.frais_alloues_dhs ?? 0), 0), 2)}
                        </td>
                      )}
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(lignes.reduce((t, l) => t + (l.poids_net_kg ?? 0), 0), 2)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(lignes.reduce((t, l) => t + l.nb_palettes, 0))}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(lignes.reduce((t, l) => t + l.nb_bobines, 0))}</td>
                      <td className={td}><Badge ton={TON_RECEPTION[f.statut_reception]}>{LIBELLE_RECEPTION[f.statut_reception]}</Badge></td>
                      <td className={cn(td, 'text-right')}>
                        <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primaire">
                          {ecrire ? 'Modifier' : 'Ouvrir'}
                          <ChevronRight className="size-3.5" />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-attenue/40 font-semibold">
                  <td className={td} colSpan={3}>Total du dossier</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{d.lignes.length}</td>
                  <td className={td} />
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(somme((l) => l.valeur_achat_dhs), 2)}</td>
                  {coutVisible && <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(somme((l) => l.frais_alloues_dhs ?? 0), 2)}</td>}
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(somme((l) => l.poids_net_kg ?? 0), 2)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(somme((l) => l.nb_palettes))}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(somme((l) => l.nb_bobines))}</td>
                  <td className={td} colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
}

// ============================================================================
// Journal de cloture
// ============================================================================

function JournalCloture({ d }: { d: DossierComplet }) {
  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Ce que les frais et les avoirs ont fait au CUMP</CarteTitre>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
          <table className="w-full min-w-[36rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-bordure">
                <th className={cn(th, 'text-left')}>Origine</th>
                <th className={cn(th, 'text-left')}>Référence</th>
                <th className={cn(th, 'text-left')}>Magasin</th>
                <th className={cn(th, 'text-right')}>Stock (kg)</th>
                <th className={cn(th, 'text-right')}>Montant (DH)</th>
                <th className={cn(th, 'text-right')}>CUMP avant → après</th>
              </tr>
            </thead>
            <tbody>
              {d.ajustements.map((a, i) => (
                <tr key={i} className="border-b border-bordure/60">
                  <td className={td} title={a.motif ?? undefined}>
                    {a.origine === 'FICHE' ? (
                      <span>
                        {d.frais.find((f) => f.id_ligne_frais === a.id_ligne_frais)?.frais_libelle ?? 'Fiche de frais'}
                        {a.type_operation === 'CONTRE_PASSATION' && <span className="text-attenue-texte"> — contre-passation</span>}
                      </span>
                    ) : a.origine && a.origine !== 'FRAIS' ? (
                      <span>
                        {a.origine === 'AVOIR_PRIX' ? 'Avoir de prix' : 'Avoir pour retour'}{' '}
                        <span className="text-attenue-texte">{a.numero_piece}</span>
                      </span>
                    ) : (
                      'Frais (clôture, ancien moteur)'
                    )}
                  </td>
                  <td className={cn(td, 'font-medium')}>{a.code_reference}</td>
                  <td className={td}>
                    {a.nature === 'STOCK' ? (
                      a.code_magasin
                    ) : a.nature === 'RETOUR' ? (
                      <em className="text-attenue-texte">rendu ({fmt.nombre(a.quantite_recue_kg, 2)} kg)</em>
                    ) : (
                      <em className="text-attenue-texte">déjà consommé</em>
                    )}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(a.stock_kg, 2)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(a.montant_dhs, 2)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>
                    {a.nature === 'STOCK'
                      ? `${a.cump_avant == null ? '—' : fmt.nombre(a.cump_avant, 4)} → ${a.cump_apres == null ? '—' : fmt.nombre(a.cump_apres, 4)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CarteCorps>
    </Carte>
  )
}

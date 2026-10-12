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
import { ChevronRight, Lock, Plus, Save, ShieldCheck, Target, Trash2, ArrowLeft } from 'lucide-react'
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
import { CloturePanneau, echec, nombre, Tuile, useEnregistrerTout, useRafraichir, type Signaler } from './dialogues'
import { PiecesDossier } from './PiecesDossier'
import { EngagementsDossier } from './EngagementsDossier'
import {
  LIBELLE_RECEPTION,
  METHODE_REPARTITION,
  TON_RECEPTION,
  nonReparti,
  type DossierComplet,
  type MethodeRepartition,
  type ParametreFrais,
} from './types'

const MODULE = 'IMPORT'
const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1.5'

export function DossierImport() {
  const { id = '' } = useParams()
  // LE RETOUR D'UNE FACTURE ROUVRE LA LISTE DES FACTURES (12/10/2026) : ?onglet=factures.
  const [parametres] = useSearchParams()
  const ongletDemande = parametres.get('onglet') ?? ''
  const ongletInitial = ['factures', 'engagements', 'liquidation'].includes(ongletDemande) ? ongletDemande : 'frais'
  const [onglet, setOnglet] = useState(ongletInitial)
  // Le petit bouton d'une ligne de frais ouvre sa liquidation.
  const [fraisLiquide, setFraisLiquide] = useState('')
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
          {dossier.cloture_par && ` par ${dossier.cloture_par}`} : les frais ont rejoint le CUMP, le
          dossier est en lecture seule.
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
      <Onglets value={onglet} onValueChange={setOnglet}>
        <OngletsListe>
          <Onglet value="frais">
            Frais
            <span className="text-[11px] tabular-nums text-attenue-texte">{d.frais.length}</span>
          </Onglet>
          <Onglet value="liquidation">
            Liquidation
            {d.frais.some(nonReparti) && <span className="size-1.5 rounded-full bg-alerte" title="Un frais n’est pas réparti" />}
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
          <FraisDossier d={d} ecrire={ecrire} postCloture={clos && droits.peutValider} signaler={tout.signaler}
            ouvrirLiquidation={(idFrais) => { setFraisLiquide(idFrais); setOnglet('liquidation') }} />
        </OngletContenu>
        <OngletContenu value="liquidation" forceMount className="mt-3 data-[state=inactive]:hidden">
          <LiquidationFrais d={d} ecrire={ecrire} choix={fraisLiquide} setChoix={setFraisLiquide} />
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
// 2. Frais du dossier — saisis dans le tableau
// ============================================================================

function FraisDossier({
  d, ecrire, postCloture, signaler, ouvrirLiquidation,
}: { d: DossierComplet; ecrire: boolean; postCloture: boolean; signaler?: Signaler; ouvrirLiquidation: (idFrais: string) => void }) {
  /* LA FACTURE TARDIVE (regle 5, 09/10/2026) : sur un dossier clos, le frais
     s'ajoute « post-cloture », avec un motif ; il va au stock restant du
     dossier, la part consommee en ecart, sans rouvrir le dossier. */
  const [motifPost, setMotifPost] = useState('')
  const [apercuPost, setApercuPost] = useState<{ ecart_stock_dhs: number; ecart_consomme_dhs: number } | null>(null)
  const saisie = ecrire || postCloture
  const idDossier = d.dossier.id_dossier
  const rafraichir = useRafraichir(idDossier)
  const confirmation = useConfirmation()
  const vide = { id_frais: '', libelle: '', numero_piece: '', code_devise: 'MAD', cours_change: '1', montant_devise: '' }
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
    taux_confirme: confirme === true,
  })
  const apercuPostCloture = useMutation({
    mutationFn: () =>
      api.post<{ ecart_stock_dhs: number; ecart_consomme_dhs: number }>(
        `/api/import/dossiers/${idDossier}/frais-post-cloture`,
        { ...corpsFrais(true), motif: motifPost.trim(), simuler: true },
      ),
    onSuccess: setApercuPost,
    onError: echec,
  })
  const ajouter = useMutation({
    mutationFn: (confirme?: boolean) =>
      postCloture
        ? api.post(`/api/import/dossiers/${idDossier}/frais-post-cloture`, {
            ...corpsFrais(confirme),
            motif: motifPost.trim(),
          })
        : api.post(`/api/import/dossiers/${idDossier}/frais`, corpsFrais(confirme)),
    onSuccess: () => {
      if (postCloture) {
        toast.success('Frais post-clôture enregistré — réparti sur le stock restant du dossier')
        setN(vide)
        setMotifPost('')
        setApercuPost(null)
        rafraichir()
        return
      }
      toast.success(
        !typeChoisi?.inclus_dans_cout
          ? 'Frais ajouté — hors coût de revient'
          : typeChoisi.commun
            ? `Frais ajouté — réparti ${METHODE_REPARTITION[typeChoisi.methode_repartition].toLowerCase()}`
            : 'Frais ajouté — désignez les lignes qu’il concerne (icône cible)',
      )
      setN(vide)
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
  // La repartition d'un frais : celle du parametrage par defaut, modifiable.
  const changerMethode = useMutation({
    mutationFn: (x: { id: string; methode: string }) => api.patch(`/api/import/frais/${x.id}`, { methode_repartition: x.methode }),
    onSuccess: () => {
      toast.success('Répartition du frais changée')
      rafraichir()
    },
    onError: echec,
  })
  const supprimer = useMutation({
    mutationFn: (idFrais: string) => api.delete(`/api/import/frais/${idFrais}`),
    onSuccess: () => {
      toast.success('Frais supprimé — répartition recalculée')
      rafraichir()
    },
    onError: echec,
  })

  const inclus = d.frais.filter((f) => f.inclus_dans_cout === 1).reduce((t, f) => t + f.montant_dhs, 0)
  const hors = d.frais.filter((f) => f.inclus_dans_cout === 0).reduce((t, f) => t + f.montant_dhs, 0)
  const complet =
    n.id_frais &&
    nombre(n.montant_devise) > 0 &&
    (n.code_devise === 'MAD' || nombre(n.cours_change) > 0) &&
    (!postCloture || motifPost.trim().length >= 5)
  const maj = (k: keyof typeof n) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setN((x) => ({
      ...x,
      [k]: e.target.value,
      // Passer a une devise vide le cours : celui du jour vient s'y proposer.
      ...(k === 'code_devise' ? { cours_change: e.target.value === 'MAD' ? '1' : '' } : {}),
    }))
  // Le frais en cours de saisie, complet, part avec « Enregistrer tout ».
  useEffect(() => {
    signaler?.('frais', complet && ecrire ? { libelle: 'nouveau frais', enregistrer: () => ajouter.mutateAsync(false) } : null)
  })
  useEffect(() => () => signaler?.('frais', null), [signaler])

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Frais du dossier</CarteTitre>
        <span className="text-[11.5px] text-attenue-texte">
          Chaque type de frais dit sa pièce justificative et sa méthode de répartition.
        </span>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
          <table className="w-full min-w-[60rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-bordure">
                <th className={cn(th, 'w-52 text-left')}>Type de frais</th>
                <th className={cn(th, 'text-left')}>Précision</th>
                <th className={cn(th, 'w-28 text-left')}>N° pièce</th>
                <th className={cn(th, 'w-28 text-left')}>Devise</th>
                <th className={cn(th, 'w-24 text-right')}>Cours</th>
                <th className={cn(th, 'w-28 text-right')}>Montant</th>
                <th className={cn(th, 'w-28 text-right')}>Montant DH</th>
                <th className={cn(th, 'w-36 text-left')}>Coût / répartition</th>
                {ecrire && <th className={cn(th, 'w-24')} />}
              </tr>
            </thead>
            <tbody>
              {d.frais.map((f) => (
                <tr key={f.id_ligne_frais} className={cn('border-b border-bordure/60', !f.inclus_dans_cout && 'text-attenue-texte')}>
                  <td className={cn(td, 'font-medium')}>{f.frais_libelle}</td>
                  <td className={td}>{f.libelle ?? '—'}</td>
                  <td className={cn(td, 'tabular-nums')}>{f.numero_piece ?? '—'}</td>
                  <td className={td}>{f.code_devise}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{f.code_devise === 'MAD' ? '—' : fmt.nombre(f.cours_change, 4)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(f.montant_devise, 2)}</td>
                  <td className={cn(td, 'text-right font-medium tabular-nums')}>{fmt.nombre(f.montant_dhs, 2)}</td>
                  <td className={td}>
                    {f.inclus_dans_cout ? (
                      <div className="space-y-0.5">
                        {ecrire ? (
                          <Selecteur className="h-7 min-w-[12.5rem]" aria-label="Répartition du frais" value={f.methode_repartition}
                            onChange={(e) => changerMethode.mutate({ id: f.id_ligne_frais, methode: e.target.value === f.methode_type ? '' : e.target.value })}>
                            {([...new Set(['VALEUR', 'POIDS', f.methode_type, 'MANUEL'])] as MethodeRepartition[]).map((m) => (
                              <option key={m} value={m}>{METHODE_REPARTITION[m]}{m === f.methode_type ? ' (paramétrage)' : ''}</option>
                            ))}
                          </Selecteur>
                        ) : (
                          <span className="text-[11.5px]">{METHODE_REPARTITION[f.methode_repartition]}</span>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                          <span className="whitespace-nowrap">{f.cibles.length === 0 ? 'tout le dossier' : `${f.cibles.length} ligne(s)`}</span>
                          {nonReparti(f) && <Badge ton="alerte">non réparti</Badge>}
                        </div>
                      </div>
                    ) : (
                      <Badge ton="neutre">hors coût</Badge>
                    )}
                  </td>
                  {ecrire && (
                    <td className={td}>
                      <div className="flex justify-end gap-0.5">
                        {f.inclus_dans_cout === 1 && (
                          <Bouton taille="icone-xs" variante="discret" title="Ouvrir sa liquidation : les factures visées et la répartition"
                            aria-label="Ouvrir la liquidation du frais" onClick={() => ouvrirLiquidation(f.id_ligne_frais)}>
                            <Target />
                          </Bouton>
                        )}
                        <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10"
                          aria-label="Supprimer le frais"
                          onClick={() =>
                            confirmation.demander({
                              titre: `Supprimer « ${f.frais_libelle} » ?`,
                              destructif: true,
                              libelleConfirmer: 'Supprimer',
                              description: 'La répartition du dossier sera recalculée.',
                              action: () => supprimer.mutate(f.id_ligne_frais),
                            })
                          }>
                          <Trash2 />
                        </Bouton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}

              {/* LA LIGNE DE SAISIE, a la suite des frais deja saisis : on
                  remplit comme une ligne du classeur, et « Ajouter ». */}
              {saisie && (
                <tr className="border-b border-bordure/60 bg-attenue/25">
                  <td className={td}>
                    <Selecteur className="h-7 w-full min-w-[13rem]" aria-label="Type de frais" value={n.id_frais} onChange={maj('id_frais')}>
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
                  <td className={td}><Champ className="h-7 min-w-[9rem]" aria-label="Libellé du frais" value={n.libelle} onChange={maj('libelle')} placeholder="ESMATRANS…" /></td>
                  <td className={td}><Champ className="h-7" aria-label="N° de pièce" value={n.numero_piece} onChange={maj('numero_piece')} placeholder="F2610861" /></td>
                  <td className={td}>
                    <Selecteur className="h-7 min-w-[6.5rem] pl-2 pr-6" aria-label="Devise du frais" value={n.code_devise} onChange={maj('code_devise')}>
                      {(qDevises.data ?? [{ code_devise: 'MAD' }]).map((x) => (
                        <option key={x.code_devise}>{x.code_devise}</option>
                      ))}
                    </Selecteur>
                  </td>
                  <td className={td}>
                    <Champ className="h-7 text-right" inputMode="decimal" aria-label="Cours de change" value={n.cours_change}
                      onChange={maj('cours_change')} disabled={n.code_devise === 'MAD'} />
                  </td>
                  <td className={td}>
                    <Champ className="h-7 text-right" inputMode="decimal" aria-label="Montant en devise" value={n.montant_devise}
                      onChange={maj('montant_devise')} placeholder="0,00"
                      onKeyDown={(e) => e.key === 'Enter' && complet && ajouter.mutate(false)} />
                  </td>
                  <td className={cn(td, 'text-right tabular-nums text-attenue-texte')}>
                    {montantDh > 0 ? fmt.nombre(montantDh, 2) : '—'}
                  </td>
                  <td className={cn(td, 'text-[11.5px]')}>
                    {typeChoisi &&
                      (typeChoisi.inclus_dans_cout ? (
                        <>
                          {METHODE_REPARTITION[typeChoisi.methode_repartition].toLowerCase()} ·{' '}
                          {typeChoisi.commun ? 'tout le dossier' : 'lignes à désigner'}
                        </>
                      ) : (
                        <span className="text-alerte">
                          hors coût{typeChoisi.recuperable ? ' — récupérable' : ''}
                        </span>
                      ))}
                  </td>
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
                <td className={td} colSpan={6}>Frais inclus dans le coût</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(inclus, 2)}</td>
                <td className={cn(td, 'text-[11.5px] font-normal text-attenue-texte')} colSpan={ecrire ? 2 : 1}>
                  + {fmt.nombre(hors, 2)} DH hors coût (TVA)
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CarteCorps>
      {postCloture && (
        <CarteCorps className="space-y-2 border-t border-bordure">
          <Etiq obligatoire htmlFor="ch-dossierimport-9">Frais post-clôture : quelle facture arrive après la clôture ?</Etiq>
          <div className="flex flex-wrap items-center gap-2">
            <Champ id="ch-dossierimport-9"
              className="min-w-0 flex-1"
              value={motifPost}
              onChange={(e) => {
                setMotifPost(e.target.value)
                setApercuPost(null)
              }}
              placeholder="Ex. : facture du transitaire reçue le 12/10"
            />
            <Bouton variante="contour" disabled={!complet} chargement={apercuPostCloture.isPending}
              onClick={() => apercuPostCloture.mutate()}>
              Aperçu
            </Bouton>
          </div>
          {apercuPost && (
            <p className="m-0 text-[12.5px]">
              {fmt.nombre(apercuPost.ecart_stock_dhs, 2)} DH au stock restant du dossier,{' '}
              {fmt.nombre(apercuPost.ecart_consomme_dhs, 2)} DH en écart (kilos déjà consommés).
            </p>
          )}
        </CarteCorps>
      )}
      {confirmation.element}
    </Carte>
  )
}

// ============================================================================
// Liquidation : la repartition d'un frais, ligne par ligne
// ============================================================================

/**
 * L'ONGLET LIQUIDATION (12/10/2026). L'en-tete est le frais ; les lignes sont
 * sa repartition. On y coche les factures que le frais vise : cocher une
 * facture affiche ses lignes, la decocher les retire ;
 * la repartition est par defaut celle du parametrage (valeur, poids), calculee
 * seule ; elle reste modifiable : saisir les montants passe le frais en
 * repartition manuelle. Tant que la somme n'egale pas le montant, le frais est
 * « non reparti » et la cloture le refuse.
 */
function LiquidationFrais({
  d, ecrire, choix, setChoix,
}: { d: DossierComplet; ecrire: boolean; choix: string; setChoix: (idFrais: string) => void }) {
  const idDossier = d.dossier.id_dossier
  const rafraichir = useRafraichir(idDossier)
  const inclus = d.frais.filter((f) => f.inclus_dans_cout === 1)
  const frais = inclus.find((f) => f.id_ligne_frais === choix) ?? inclus[0]
  const toutes = d.lignes
  // LE CHOIX SE FAIT PAR FACTURE : une facture cochee porte le frais sur toutes
  // ses lignes. Sans ligne visee, le frais porte sur tout le dossier ; en
  // repartition manuelle, sur les factures qui ont un montant (aucune : le
  // frais n'est pas reparti).
  const avecMontant = (idFacture: string) =>
    d.repartition.some((a) => a.id_ligne_frais === frais?.id_ligne_frais
      && toutes.some((l) => l.id_ligne === a.id_article_dossier && l.id_facture === idFacture))
  const facturesServeur = new Set(
    d.factures
      .filter((fa) => !frais
        || (frais.cibles.length > 0
          ? toutes.some((l) => l.id_facture === fa.id_facture && frais.cibles.includes(l.id_ligne))
          : frais.methode_repartition !== 'MANUEL' || avecMontant(fa.id_facture)))
      .map((fa) => fa.id_facture),
  )
  const [factures, setFactures] = useState<Set<string> | null>(null)
  const cochees = factures ?? facturesServeur
  const visees = new Set(toutes.filter((l) => cochees.has(l.id_facture)).map((l) => l.id_ligne))
  const ciblesModifiees = factures !== null
    && (factures.size !== facturesServeur.size || [...factures].some((x) => !facturesServeur.has(x)))
  const partServeur = (idLigne: string) =>
    d.repartition.find((a) => a.id_ligne_frais === frais?.id_ligne_frais && a.id_article_dossier === idLigne)?.montant_alloue_dhs
  const [saisie, setSaisie] = useState<Record<string, string>>({})
  const valeur = (idLigne: string) => saisie[idLigne] ?? String(partServeur(idLigne) ?? '')
  const montantsModifies = Object.keys(saisie).length > 0
  // LE CHOIX DE LA REPARTITION, ici aussi : celle du parametrage par defaut.
  // Corriger un montant la passe en manuelle.
  const [methode, setMethode] = useState<MethodeRepartition | null>(null)
  const methodeAffichee: MethodeRepartition | undefined = montantsModifies ? 'MANUEL' : (methode ?? frais?.methode_repartition)
  const methodeModifiee = methode !== null && methode !== frais?.methode_repartition
  const modifie = ciblesModifiees || montantsModifies || methodeModifiee
  // Un recalcul attend l'enregistrement : le reste affiche serait faux.
  const recalculEnAttente = !montantsModifies && methodeAffichee !== 'MANUEL' && (ciblesModifiees || methodeModifiee)
  const total = toutes.filter((l) => visees.has(l.id_ligne)).reduce((t, l) => t + nombre(valeur(l.id_ligne)), 0)
  const reste = frais ? Math.round((frais.montant_dhs - total) * 100) / 100 : 0
  const cocher = (idFacture: string, oui: boolean) =>
    setFactures(() => {
      const n = new Set(cochees)
      if (oui) n.add(idFacture)
      else n.delete(idFacture)
      return n
    })
  const reinitialiser = () => {
    setSaisie({})
    setFactures(null)
    setMethode(null)
  }

  // Les lignes visees d'abord (tout coche = tout le dossier), puis les montants.
  const enregistrer = useMutation({
    mutationFn: async () => {
      if (montantsModifies && total > frais!.montant_dhs + 0.005) {
        throw new Error(
          `${fmt.nombre(total, 2)} DH répartis : plus que le montant du frais (${fmt.nombre(frais!.montant_dhs, 2)} DH). Corrigez avant d’enregistrer.`,
        )
      }
      if (ciblesModifiees || (methodeModifiee && !montantsModifies)) {
        const corps: Record<string, unknown> = {}
        if (ciblesModifiees) corps.cibles = cochees.size === d.factures.length ? [] : [...visees]
        if (methodeModifiee && !montantsModifies) corps.methode_repartition = methode === frais!.methode_type ? '' : methode
        await api.patch(`/api/import/frais/${frais!.id_ligne_frais}`, corps)
      }
      // Aucune facture cochee : le frais reste a repartir (manuel, sans montant).
      if (montantsModifies || cochees.size === 0) {
        await api.put(`/api/import/frais/${frais!.id_ligne_frais}/repartition`, {
          montants: toutes.filter((l) => visees.has(l.id_ligne)).map((l) => ({ id_ligne: l.id_ligne, montant_dhs: nombre(valeur(l.id_ligne)) })),
        })
      }
    },
    onSuccess: () => {
      if (cochees.size === 0) {
        toast.warning('Enregistré sans facture : le frais n’est pas réparti — la clôture le refusera tant qu’il le reste.')
      } else if (montantsModifies && Math.abs(reste) > 0.005) {
        toast.warning(`Répartition enregistrée, mais incomplète : reste ${fmt.nombre(reste, 2)} DH à répartir — le frais reste « non réparti » et la clôture le refusera.`)
      } else {
        toast.success(montantsModifies ? 'Répartition enregistrée — le frais est réparti à la main' : 'Enregistré — la répartition est recalculée')
      }
      reinitialiser()
      rafraichir()
    },
    // Le depassement est refuse ici, avec son message ; le serveur le refuse aussi.
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Opération impossible.'),
  })

  if (!frais) {
    return <Alerte ton="info">Aucun frais inclus dans le coût : saisissez-les d’abord dans l’onglet Frais.</Alerte>
  }
  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Répartition d’un frais</CarteTitre>
      </CarteEntete>
      <CarteCorps className="grid grid-cols-1 gap-3 border-b border-bordure md:grid-cols-3 xl:grid-cols-6">
        <div className="md:col-span-2">
          <Etiq htmlFor="liq-frais">Frais</Etiq>
          <Selecteur id="liq-frais" className="w-full" value={frais.id_ligne_frais}
            onChange={(e) => { setChoix(e.target.value); reinitialiser() }}>
            {inclus.map((f) => (
              <option key={f.id_ligne_frais} value={f.id_ligne_frais}>
                {f.frais_libelle}{f.libelle ? ` — ${f.libelle}` : ''}{nonReparti(f) ? ' (non réparti)' : ''}
              </option>
            ))}
          </Selecteur>
        </div>
        <div>
          <Etiq>Pièce</Etiq>
          <div className="py-1.5 text-[13px]">{frais.numero_piece ?? '—'}</div>
        </div>
        <div>
          <Etiq>Montant</Etiq>
          <div className="py-1.5 text-[13px] font-semibold tabular-nums">{fmt.nombre(frais.montant_dhs, 2)} DH</div>
        </div>
        <div>
          <Etiq htmlFor="liq-methode">Répartition</Etiq>
          {ecrire ? (
            <Selecteur id="liq-methode" className="w-full" value={methodeAffichee}
              onChange={(e) => { setMethode(e.target.value as MethodeRepartition); setSaisie({}) }}>
              {([...new Set(['VALEUR', 'POIDS', frais.methode_type, 'MANUEL'])] as MethodeRepartition[]).map((m) => (
                <option key={m} value={m}>{METHODE_REPARTITION[m]}{m === frais.methode_type ? ' (paramétrage)' : ''}</option>
              ))}
            </Selecteur>
          ) : (
            <div className="py-1.5 text-[13px]">
              {METHODE_REPARTITION[frais.methode_repartition]}
              {frais.methode_repartition === frais.methode_type && <span className="text-attenue-texte"> (paramétrage)</span>}
            </div>
          )}
        </div>
        <div>
          <Etiq>Factures visées</Etiq>
          <div className="py-1.5 text-[13px]">
            {cochees.size === d.factures.length ? 'Tout le dossier' : `${cochees.size} facture(s) sur ${d.factures.length}`}
          </div>
        </div>
      </CarteCorps>
      <CarteCorps className="p-0">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-bordure">
              <th className={cn(th, 'w-8')} />
              <th className={cn(th, 'text-left')}>Ligne</th>
              <th className={cn(th, 'text-right')}>Valeur DH</th>
              <th className={cn(th, 'text-right')}>Poids kg</th>
              <th className={cn(th, 'text-right')}>Montant DH</th>
              <th className={cn(th, 'text-right')}>%</th>
            </tr>
          </thead>
          <tbody>
            {d.factures.map((fa) => {
              const ls = toutes.filter((l) => l.id_facture === fa.id_facture)
              const cochee = cochees.has(fa.id_facture)
              const sousTotal = ls.filter((l) => visees.has(l.id_ligne)).reduce((t, l) => t + nombre(valeur(l.id_ligne)), 0)
              return (
                <Fragment key={fa.id_facture}>
                  <tr className="border-b border-bordure bg-attenue/40 font-semibold">
                    <td className={td}>
                      <input type="checkbox" aria-label={`Viser la facture ${fa.numero_facture}`} disabled={!ecrire}
                        checked={cochee} onChange={(e) => cocher(fa.id_facture, e.target.checked)} />
                    </td>
                    <td className={td} colSpan={3}>Facture {fa.numero_facture} <span className="font-normal text-attenue-texte">· {fa.fournisseur_nom}</span></td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(sousTotal, 2)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {frais.montant_dhs > 0 ? `${fmt.nombre((sousTotal * 100) / frais.montant_dhs, 2)} %` : '—'}
                    </td>
                  </tr>
                  {/* Cochee, la facture montre ses lignes ; decochee, elle les retire. */}
                  {cochee && ls.map((l) => {
                    const v = nombre(valeur(l.id_ligne))
                    return (
                      <tr key={l.id_ligne} className="border-b border-bordure/60">
                        <td className={td} />
                        <td className={td}>
                          {l.type_ligne === 'ERP' ? l.code_reference : l.designation}
                          {l.type_ligne === 'HORS_ERP' && <em className="text-attenue-texte"> (hors ERP)</em>}
                        </td>
                        <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(l.valeur_achat_dhs, 2)}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(l.poids_net_kg ?? 0, 0)}</td>
                        <td className={cn(td, 'text-right')}>
                          {ecrire ? (
                            <Champ className="ml-auto h-7 w-28 text-right" inputMode="decimal"
                              aria-label={`Part de ${l.code_reference ?? l.designation ?? 'la ligne'}`}
                              value={valeur(l.id_ligne)} placeholder="0"
                              onChange={(e) => setSaisie((x) => ({ ...x, [l.id_ligne]: e.target.value }))} />
                          ) : (
                            <span className="tabular-nums">{fmt.nombre(v, 2)}</span>
                          )}
                        </td>
                        <td className={cn(td, 'text-right tabular-nums')}>
                          {frais.montant_dhs > 0 ? `${fmt.nombre((v * 100) / frais.montant_dhs, 2)} %` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className={td} />
              <td className={td} colSpan={3}>
                Total réparti
                {recalculEnAttente ? (
                  <span className="ml-2 font-normal text-attenue-texte">la répartition se recalcule à l’enregistrement</span>
                ) : reste < -0.005 ? (
                  <span className="ml-2 font-normal text-danger">dépasse le montant de {fmt.nombre(-reste, 2)} DH</span>
                ) : reste > 0.005 ? (
                  <span className="ml-2 font-normal text-alerte">non réparti : reste {fmt.nombre(reste, 2)} DH</span>
                ) : null}
              </td>
              <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(total, 2)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>
                {frais.montant_dhs > 0 ? `${fmt.nombre((total * 100) / frais.montant_dhs, 2)} %` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </CarteCorps>
      {ecrire && (
        <CarteCorps className="flex flex-wrap justify-end gap-2 border-t border-bordure">
          {modifie && <Bouton variante="contour" onClick={reinitialiser}>Annuler</Bouton>}
          <Bouton disabled={!modifie} chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            <Save />
            Enregistrer
          </Bouton>
        </CarteCorps>
      )}
    </Carte>
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
        <CarteTitre>Ce que la clôture et les avoirs ont fait au CUMP</CarteTitre>
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
                    {a.origine && a.origine !== 'FRAIS' ? (
                      <span>
                        {a.origine === 'AVOIR_PRIX' ? 'Avoir de prix' : 'Avoir pour retour'}{' '}
                        <span className="text-attenue-texte">{a.numero_piece}</span>
                      </span>
                    ) : (
                      'Frais'
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

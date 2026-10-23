/**
 * UN INVENTAIRE, SUR SA PAGE (13/10/2026) : l'en-tête et les lignes de
 * comptage, comme un bon de commande. La liste est ailleurs (`/inventaires`).
 *
 *   BROUILLON  le magasinier compte et corrige ; « Enregistrer le comptage »
 *              envoie toutes les lignes modifiées d'un coup ;
 *   VALIDÉ     un AUTRE compte que ceux qui ont compté fige le comptage
 *              (droit Valider ; l'Administrateur dispensé) — rien n'a encore
 *              touché le stock ; « Renvoyer au comptage » le rouvre, motif à
 *              l'appui ;
 *   CLÔTURÉ    droit Valider : les écarts passent au stock.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ClipboardCheck, ClipboardList, Printer, RotateCcw, Save, ShieldCheck, Undo2, XCircle } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { ActionMotivee } from '../../composants/ActionMotivee'
import { BoutonDevalider } from '../../composants/BoutonDevalider'
import { Alerte, Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Chargement, Etiq, Selecteur } from '../../composants/ui/base'
import { Aide, useConfirmation } from '../../composants/ui/surcouches'
import { useGardeSaisie } from '../../hooks/useGardeSaisie'
import { useOuvrirVue } from '../../lib/navigation'
import { cn, fmt } from '../../lib/utils'
import { libelleLot } from '../../lib/lots'
import { nouvelIdentifiant } from '../../lib/identifiant'
import {
  LIBELLE_STATUT,
  LotTrouve,
  MODULE,
  TON,
  TableComptage,
  analyser,
  empreinte,
  saisieServeur,
  useToleranceMotif,
  type LigneInv,
  type LigneVue,
  type Saisie,
} from './comptage'

interface EnTeteInventaire {
  id_inventaire: string
  numero_inventaire: string
  date_inventaire: string
  type_inventaire: string
  code_magasin: string
  magasin_nom: string | null
  statut: string
  responsable: string | null
  valide_par: string | null
  date_validation: string | null
  date_cloture: string | null
  motif_renvoi: string | null
  motif_annulation: string | null
  nb_lignes: number
  nb_a_compter: number
  j_ai_compte: boolean
}

const LIBELLE_TYPE: Record<string, string> = {
  GLOBAL: 'Global — tout le catalogue',
  TOURNANT: 'Tournant — le stock existant',
  CIBLE: 'Ciblé — le stock existant',
}

const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

export function Inventaire() {
  const { id = 'nouveau' } = useParams()
  if (id === 'nouveau') return <NouvelInventaire />
  return <DocumentInventaire key={id} id={id} />
}

// ============================================================================
// Le document
// ============================================================================

function DocumentInventaire({ id }: { id: string }) {
  const droits = useDroits(MODULE)
  const { moi } = useAuth()
  const naviguer = useNavigate()
  const ouvrirEtat = useOuvrirVue()
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const tolMotif = useToleranceMotif()
  const [annulation, setAnnulation] = useState(false)
  const [renvoi, setRenvoi] = useState(false)
  /**
   * LE COMPTAGE EN COURS DE FRAPPE, par ligne. Rien n'est écrit en base avant
   * « Enregistrer le comptage » : on peut corriger, revenir, tout annuler.
   */
  const [brouillon, setBrouillon] = useState<Record<string, Saisie>>({})

  const qInv = useQuery({
    queryKey: ['inventaire', id],
    queryFn: ({ signal }) => api.get<EnTeteInventaire>(`/api/inventaires/${id}`, { signal }),
  })
  const qLignes = useQuery({
    queryKey: ['lignes-inventaire', id],
    queryFn: ({ signal }) => api.get<LigneInv[]>(`/api/inventaires/${id}/lignes`, { signal }),
  })
  const inv = qInv.data

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['inventaires'] })
    void qc.invalidateQueries({ queryKey: ['inventaire', id] })
    void qc.invalidateQueries({ queryKey: ['lignes-inventaire', id] })
  }

  const brouillonInv = inv?.statut === 'BROUILLON'
  const saisissable = brouillonInv && droits.peutEcrire

  /** Chaque ligne avec sa saisie courante et ce qu'on en calcule. */
  const vues = useMemo<LigneVue[]>(
    () =>
      (qLignes.data ?? []).map((ligne) => {
        const serveur = saisieServeur(ligne)
        const saisie = brouillon[ligne.id_ligne_inv] ?? serveur
        return {
          ligne,
          saisie,
          analyse: analyser(ligne, saisie, tolMotif),
          modifiee: empreinte(saisie) !== empreinte(serveur),
        }
      }),
    [qLignes.data, brouillon, tolMotif],
  )
  const modifiees = vues.filter((v) => v.modifiee)
  const enErreur = modifiees.filter((v) => v.analyse.erreurs.length > 0)
  const quitter = useGardeSaisie(modifiees.length > 0)

  /** Lignes enregistrées hors tolérance sans motif : elles bloquent la validation. */
  const injustifiees = (qLignes.data ?? []).filter(
    (l) =>
      ((l.ecart_pct != null && Math.abs(Number(l.ecart_pct)) > tolMotif) ||
        (Number(l.quantite_theorique_kg ?? 0) === 0 && Number(l.quantite_comptee_kg ?? 0) > 0)) &&
      !l.motif_ecart?.trim(),
  )
  const restantes = (qLignes.data ?? []).filter((l) => l.statut_ligne === 'A_TRAITER').length

  /**
   * TOUTES LES LIGNES MODIFIÉES PARTENT ENSEMBLE, en un seul envoi : le
   * serveur les écrit dans une seule transaction, tout ou rien.
   */
  const enregistrer = useMutation({
    mutationFn: async (lignes: LigneVue[]) => {
      await api.put(`/api/inventaires/${id}/lignes`, {
        comptages: lignes.map(({ ligne, saisie, analyse }) => ({
          code_reference: ligne.code_reference,
          code_magasin: ligne.code_magasin,
          lot_fournisseur: ligne.lot_fournisseur,
          quantite_comptee_kg: analyse.kg,
          motif_ecart: saisie.motif.trim() || null,
          nb_bobines: analyse.bobines,
          nb_palettes: analyse.palettes,
        })),
      })
      return lignes.map((v) => v.ligne.id_ligne_inv)
    },
    onSuccess: (ids) => {
      toast.success(`Comptage enregistré : ${ids.length} ligne(s).`)
      setBrouillon((b) => {
        const reste = { ...b }
        for (const x of ids) delete reste[x]
        return reste
      })
      rafraichir()
    },
    onError: echec,
  })

  /** Le lot trouvé au comptage : une ligne à part, envoyée tout de suite. */
  const ajouterLot = useMutation({
    mutationFn: (c: { code_reference: string; code_magasin: string; lot_fournisseur: string; quantite_comptee_kg: number }) =>
      api.put(`/api/inventaires/${id}/lignes`, { comptages: [c] }),
    onSuccess: rafraichir,
    onError: echec,
  })

  const preparer = useMutation({
    mutationFn: () => api.post<{ lignes_a_compter: number }>(`/api/inventaires/${id}/preparer`),
    onSuccess: (r) => {
      toast.success(`${r.lignes_a_compter} ligne(s) à compter.`)
      rafraichir()
    },
    onError: echec,
  })

  const valider = useMutation({
    mutationFn: () => api.post(`/api/inventaires/${id}/valider`),
    onSuccess: () => {
      toast.success('Comptage validé : il est figé.')
      rafraichir()
    },
    onError: echec,
  })

  const cloturer = useMutation({
    mutationFn: () =>
      api.post<{ lignes_ajustees: number; impact_valorisation_mad: number }>(`/api/inventaires/${id}/cloturer`),
    onSuccess: (r) => {
      toast.success(`Inventaire clôturé : ${r.lignes_ajustees} ajustement(s), impact ${fmt.mad(r.impact_valorisation_mad)}.`)
      rafraichir()
      void qc.invalidateQueries({ queryKey: ['stock-projete'] })
      void qc.invalidateQueries({ queryKey: ['cockpit'] })
    },
    onError: echec,
  })

  if (qInv.isLoading) return <Chargement texte="Lecture de l’inventaire…" />
  if (!inv) return <Alerte ton="alerte">Inventaire introuvable.</Alerte>

  const admin = moi?.role === 'ADMIN'
  const bloqueValidation =
    modifiees.length > 0
      ? 'Enregistrez d’abord le comptage en cours.'
      : restantes > 0
        ? `${restantes} ligne(s) encore à compter.`
        : injustifiees.length > 0
          ? `${injustifiees.length} écart(s) à justifier.`
          : inv.j_ai_compte && !admin
            ? 'Vous avez compté des lignes : la validation revient à un autre compte.'
            : null

  return (
    <div className="space-y-4">
      <EnTetePage
        titre={`Inventaire ${inv.numero_inventaire}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge ton={TON[inv.statut] ?? 'neutre'}>{LIBELLE_STATUT[inv.statut] ?? inv.statut}</Badge>
            <span>
              {inv.magasin_nom ?? inv.code_magasin} · {inv.type_inventaire.toLowerCase()}
            </span>
          </span>
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/inventaires'))}>
              <ArrowLeft />
              Inventaires
            </Bouton>
            {inv.nb_lignes > 0 && (
              <Bouton
                variante="contour"
                taille="icone"
                onClick={() => ouvrirEtat(`/etats/inventaire/${inv.id_inventaire}/comptage`)}
                aria-label="Feuille de comptage"
                title="Imprimer la feuille de comptage"
              >
                <ClipboardList />
              </Bouton>
            )}
            <Bouton
              variante="contour"
              taille="icone"
              onClick={() => ouvrirEtat(`/etats/inventaire/${inv.id_inventaire}`)}
              aria-label="Procès-verbal"
              title="Imprimer le procès-verbal"
            >
              <Printer />
            </Bouton>
            {(brouillonInv || inv.statut === 'VALIDE') && droits.peutValider && (
              <Bouton variante="contour" className="text-danger hover:bg-danger/10" onClick={() => setAnnulation(true)}>
                <XCircle />
                Annuler
              </Bouton>
            )}
            {inv.statut === 'VALIDE' && droits.peutValider && (
              <Bouton variante="contour" onClick={() => setRenvoi(true)}>
                <RotateCcw />
                Renvoyer au comptage
              </Bouton>
            )}
            <BoutonDevalider
              document="inventaires"
              id={inv.id_inventaire}
              statut={inv.statut}
              consequence="L’inventaire redevient validé ; « Renvoyer au comptage » le rouvre si le comptage était faux."
            />
            {brouillonInv && droits.peutValider && inv.nb_lignes > 0 && (
              <Bouton
                chargement={valider.isPending}
                disabled={!!bloqueValidation}
                title={bloqueValidation ?? undefined}
                onClick={() =>
                  confirmation.demander({
                    titre: `Valider le comptage de ${inv.numero_inventaire} ?`,
                    description:
                      'Le comptage sera figé : plus de saisie. Rien ne touche encore le stock ; la clôture passera les écarts.',
                    libelleConfirmer: 'Valider',
                    action: () => valider.mutate(),
                  })
                }
              >
                <ShieldCheck />
                Valider le comptage
              </Bouton>
            )}
            {inv.statut === 'VALIDE' && droits.peutValider && (
              <Bouton
                chargement={cloturer.isPending}
                onClick={() =>
                  confirmation.demander({
                    titre: `Clôturer ${inv.numero_inventaire} ?`,
                    description:
                      "Les écarts seront convertis en mouvements d'ajustement. Le grand livre étant immuable, " +
                      'ces mouvements ne s’effacent pas : pour revenir dessus il faudra les contre-passer, puis dévalider l’inventaire.',
                    libelleConfirmer: 'Clôturer',
                    action: () => cloturer.mutate(),
                  })
                }
              >
                <ClipboardCheck />
                Clôturer et ajuster
              </Bouton>
            )}
          </>
        }
      />

      {/* --- L'en-tete ------------------------------------------------------- */}
      <Carte>
        <CarteCorps className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] lg:grid-cols-4">
          <Info libelle="Magasin" valeur={inv.magasin_nom ?? inv.code_magasin} />
          <Info libelle="Type" valeur={LIBELLE_TYPE[inv.type_inventaire] ?? inv.type_inventaire} />
          <Info libelle="Date" valeur={fmt.date(inv.date_inventaire)} />
          <Info libelle="Créé par" valeur={inv.responsable ?? '—'} />
          <Info
            libelle="Lignes comptées"
            valeur={inv.nb_lignes === 0 ? '—' : `${inv.nb_lignes - inv.nb_a_compter} / ${inv.nb_lignes}`}
          />
          <Info
            libelle="Validé par"
            valeur={inv.valide_par ? `${inv.valide_par} · ${fmt.date(inv.date_validation)}` : '—'}
          />
          <Info libelle="Clôturé le" valeur={inv.date_cloture ? fmt.date(inv.date_cloture) : '—'} />
          <Info libelle="Statut" valeur={LIBELLE_STATUT[inv.statut] ?? inv.statut} />
        </CarteCorps>
      </Carte>

      {inv.statut === 'ANNULE' && inv.motif_annulation && (
        <Alerte ton="danger" titre="Inventaire annulé">{inv.motif_annulation}</Alerte>
      )}
      {brouillonInv && inv.motif_renvoi && (
        <Alerte ton="alerte" titre="Renvoyé au comptage">{inv.motif_renvoi}</Alerte>
      )}
      {inv.statut === 'VALIDE' && (
        <Alerte ton="info">
          Comptage validé et figé. Rien n’a encore touché le stock : la clôture passe les écarts ; « Renvoyer au
          comptage » le rouvre si un recomptage s’impose.
        </Alerte>
      )}
      {brouillonInv && inv.nb_lignes === 0 && (
        <Alerte ton="alerte" titre="Lignes à préparer">
          Cet inventaire a été créé avant que ses lignes ne se préparent à la création.{' '}
          {droits.peutEcrire && (
            <Bouton taille="sm" className="ml-2" chargement={preparer.isPending} onClick={() => preparer.mutate()}>
              Préparer les lignes
            </Bouton>
          )}
        </Alerte>
      )}
      {brouillonInv && injustifiees.length > 0 && (
        <Alerte ton="alerte" titre={`${injustifiees.length} écart(s) à justifier`}>
          Un écart supérieur à {fmt.nombre(tolMotif, 1)} % exige un motif : la validation est bloquée tant qu’il en
          reste un sans justification.
        </Alerte>
      )}

      {/* --- Les lignes ------------------------------------------------------ */}
      {saisissable && (
        <LotTrouve
          magasin={inv.code_magasin}
          references={[...new Set((qLignes.data ?? []).map((l) => l.code_reference))]}
          enCours={ajouterLot.isPending}
          ajouter={(c) => ajouterLot.mutateAsync({ ...c, code_magasin: inv.code_magasin })}
        />
      )}

      <TableComptage
        vues={vues}
        chargement={qLignes.isLoading}
        erreur={qLignes.error}
        saisissable={saisissable}
        tolMotif={tolMotif}
        setBrouillon={setBrouillon}
      />

      {/* LE SEUL BOUTON QUI ÉCRIT LE COMPTAGE. Toujours présent tant que le
          comptage se saisit, désactivé quand il n'y a rien à envoyer. */}
      {saisissable && (
        <div
          className={cn(
            'sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            modifiees.length > 0 ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="text-[13px]">
            {enErreur.length > 0 ? (
              <span className="text-danger">
                {enErreur.length} ligne(s) à compléter avant d’enregistrer —{' '}
                {enErreur
                  .slice(0, 3)
                  .map(
                    (v) =>
                      `${v.ligne.code_reference}${v.ligne.lot_fournisseur ? ` (${libelleLot(v.ligne.lot_fournisseur)})` : ''} : ${v.analyse.erreurs.join(', ')}`,
                  )
                  .join(' · ')}
                {enErreur.length > 3 && ' …'}
              </span>
            ) : modifiees.length > 0 ? (
              <>
                <span className="font-medium">{modifiees.length} ligne(s) modifiée(s)</span>
                <span className="text-alerte"> — rien n’est encore enregistré.</span>
              </>
            ) : (
              <span className="text-attenue-texte">
                Saisissez les quantités comptées sur les lignes, puis enregistrez le comptage d’un seul coup.
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton
              variante="contour"
              disabled={modifiees.length === 0 || enregistrer.isPending}
              onClick={() => setBrouillon({})}
            >
              <Undo2 />
              Annuler les modifications
            </Bouton>
            <Bouton
              disabled={modifiees.length === 0 || enErreur.length > 0}
              chargement={enregistrer.isPending}
              onClick={() => enregistrer.mutate(modifiees)}
            >
              <Save />
              Enregistrer le comptage
            </Bouton>
          </div>
        </div>
      )}

      <ActionMotivee
        ouvert={annulation}
        surFermeture={() => setAnnulation(false)}
        titre={`Annuler ${inv.numero_inventaire}`}
        description="L'inventaire passera à « annulé » ; il ne pourra plus être clôturé."
        libelleBouton="Annuler l'inventaire"
        chemin={`/api/inventaires/${inv.id_inventaire}/annuler`}
        consequence={
          <>
            Aucun ajustement n'a encore été passé : le stock ne bouge pas. Les lignes déjà comptées restent
            consultables. Un autre inventaire pourra ensuite être créé sur ce magasin.
          </>
        }
        surSucces={rafraichir}
      />
      <ActionMotivee
        ouvert={renvoi}
        surFermeture={() => setRenvoi(false)}
        titre={`Renvoyer ${inv.numero_inventaire} au comptage`}
        description="L'inventaire redevient brouillon : le comptage se saisit de nouveau, puis se revalide."
        libelleBouton="Renvoyer au comptage"
        chemin={`/api/inventaires/${inv.id_inventaire}/renvoyer`}
        consequence={<>Rien n’a touché le stock. Le motif reste affiché sur l’inventaire.</>}
        surSucces={rafraichir}
      />
      {confirmation.element}
    </div>
  )
}

function Info({ libelle, valeur }: { libelle: string; valeur: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-attenue-texte">{libelle}</div>
      <div className="truncate text-texte">{valeur}</div>
    </div>
  )
}

// ============================================================================
// La creation, sur sa page
// ============================================================================

function NouvelInventaire() {
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const droits = useDroits(MODULE)
  const [form, setForm] = useState({ code_magasin: '', type_inventaire: 'GLOBAL' })

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: ({ signal }) => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1', { signal }),
  })

  // L'identifiant du document, tire a l'ouverture : un second envoi du meme
  // formulaire rend le meme document (audit P3, 19/10/2026).
  const [idDocument] = useState(nouvelIdentifiant)
  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_inventaire: string; numero_inventaire: string; lignes_a_compter: number; avis?: string[] }>('/api/inventaires', { ...form, id_document: idDocument }),
    onSuccess: (r) => {
      toast.success(`Inventaire ${r.numero_inventaire} créé : ${r.lignes_a_compter} ligne(s) à compter.`)
      /* CE QUI ETAIT EN ROUTE VERS LE MAGASIN, desormais gele (23/10/2026) : un
         avis, pas un blocage. */
      for (const a of r.avis ?? []) toast.warning(a, { duration: 12000 })
      void qc.invalidateQueries({ queryKey: ['inventaires'] })
      naviguer(`/inventaires/${r.id_inventaire}`, { replace: true })
    },
    onError: echec,
  })

  if (!droits.peutEcrire) return <Alerte ton="info">La création d’un inventaire demande le droit d’écrire.</Alerte>

  return (
    <div className="space-y-4">
      <EnTetePage
        titre="Nouvel inventaire"
        description="Ses lignes se préparent à la création : la photo du stock du magasin."
        actions={
          <>
            <Bouton variante="contour" onClick={() => naviguer('/inventaires')}>
              <ArrowLeft />
              Inventaires
            </Bouton>
            <Bouton chargement={creer.isPending} disabled={!form.code_magasin} onClick={() => creer.mutate()}>
              Créer
            </Bouton>
          </>
        }
      />
      <Alerte ton="alerte">
        Dès la création, le magasin est gelé : aucun mouvement n’y entre ni n’en sort (sorties, réceptions,
        transferts, fiches machine) jusqu’à la clôture ou l’annulation de l’inventaire.
      </Alerte>
      <Carte>
        <CarteEntete>
          <CarteTitre>L’inventaire</CarteTitre>
        </CarteEntete>
        <CarteCorps className="grid gap-3 sm:grid-cols-2">
          <div>
            <Etiq htmlFor="mag" obligatoire>
              Magasin
            </Etiq>
            <Selecteur id="mag" value={form.code_magasin} onChange={(e) => setForm({ ...form, code_magasin: e.target.value })}>
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
              <Aide>
                Global : toutes les références actives du catalogue, avec un théorique à zéro là où la base ne
                connaît pas de stock. C’est le seul qui découvre une marchandise ignorée. Tournant et ciblé :
                seulement les références déjà en stock dans ce magasin.
              </Aide>
            </Etiq>
            <Selecteur id="type" value={form.type_inventaire} onChange={(e) => setForm({ ...form, type_inventaire: e.target.value })}>
              <option value="GLOBAL">{LIBELLE_TYPE.GLOBAL}</option>
              <option value="TOURNANT">{LIBELLE_TYPE.TOURNANT}</option>
              <option value="CIBLE">{LIBELLE_TYPE.CIBLE}</option>
            </Selecteur>
          </div>
        </CarteCorps>
      </Carte>
    </div>
  )
}

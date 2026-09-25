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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Send, ShieldCheck, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { BoutonDevalider } from '../composants/BoutonDevalider'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import {
  GrilleLignes,
  type ColonneGrille,
  type LigneSaisie,
  type RefLigne,
} from '../composants/GrilleLignes'
import {
  type Conditionnement,
  depuisKg,
  facteurVersKg,
  pourChamp,
} from '../lib/conditionnement'
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
import { Aide } from '../composants/ui/surcouches'
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
  code_devise?: string
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
  unite_catalogue?: string
  /* LE CONDITIONNEMENT DE LA FICHE, ajoute a la requete : sans lui, la grille
     ne sait pas convertir une pesee en palettes ni en bobines. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  bobines_par_lot?: number | null
  densite_kg_ml?: number | null
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
  /* Le conditionnement de la fiche : la grille en a besoin pour convertir. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  bobines_par_lot?: number | null
  densite_kg_ml?: number | null
  date_livraison_prevue: string | null
  retard_jours: number | null
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

/**
 * Une ligne deja pesee entre dans la grille — la MEME que celle du bon de
 * commande.
 *
 * La reception saisit toujours des KILOS : c'est une pesee. La base, elle,
 * archive l'expression declaree (`quantite_pesee_unite` dans `unite_saisie`),
 * et la traduction se fait ici a la lecture, comme a l’envoi.
 *
 * `extra` PORTE CE QUE LA GRILLE NE CONNAIT PAS : lot, magasin, qualite,
 * quantite annoncee au bon de livraison, colis. La grille les range et les
 * rend ; c'est cet ecran qui sait ce qu'ils veulent dire.
 */
function depuisLigneReception(l: LigneRec): LigneSaisie {
  const cond: Conditionnement = {
    poids_bobine_kg: l.poids_bobine_kg,
    bobines_par_palette: l.bobines_par_palette,
    bobines_par_lot: l.bobines_par_lot,
    densite_kg_ml: l.densite_kg_ml,
  }
  const colis = depuisKg(l.quantite_stock_kg, cond)
  return {
    cle: l.id_ligne_reception,
    idExistant: l.id_ligne_reception,
    nature: 'MARCHANDISE',
    code_reference: l.code_reference,
    intitule: l.reference_designation ?? l.code_reference,
    cond,
    unite_catalogue: l.unite_catalogue ?? 'kg',
    fournisseur_habituel: null,
    suggere_kg: l.quantite_commandee_kg,
    qte: pourChamp(l.quantite_stock_kg, 3),
    unite: l.unite_saisie,
    palettes: pourChamp(colis.palettes),
    bobines: pourChamp(colis.bobines),
    prix: l.prix_kg_devise != null ? String(l.prix_kg_devise) : '',
    reference_fournisseur: '',
    couleur: '',
    code_couleur: '',
    extra: {
      bl: l.quantite_bl_kg != null ? String(l.quantite_bl_kg) : '',
      colis: l.nb_colis_ligne != null ? String(l.nb_colis_ligne) : '',
      lot: l.lot_fournisseur ?? '',
      magasin: l.code_magasin_dest,
      qualite: l.statut_qualite,
    },
  }
}

/**
 * Ce que le serveur attend pour UNE ligne de reception.
 *
 * LA PESEE EST EN KILOS, L'ARCHIVE DANS L'UNITE DECLAREE. Six decimales : la
 * colonne n'en garde que quatre, mais le serveur deduit les KILOS de ce nombre
 * avant que la base n'arrondisse. Arrondir ici deplacerait le poids RECU de
 * quelques grammes — et une reception fausse cree du stock qui n’existe pas.
 *
 * Facteur inconnu : on envoie des kilos plutot qu'un nombre faux dans une
 * unite qu'on ne sait pas convertir.
 */
function corpsReception(l: LigneSaisie) {
  const kg = Number(l.qte)
  const f = facteurVersKg(l.unite, l.cond)
  const e = l.extra ?? {}
  const nombre = (v: string | undefined) => {
    const n = Number(v)
    return v && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined
  }
  return {
    unite_saisie: f ? l.unite : 'kg',
    quantite_pesee_unite: f ? Number((kg / f).toFixed(6)) : kg,
    quantite_bl_kg: nombre(e.bl),
    nb_colis_ligne: nombre(e.colis) != null ? Math.round(nombre(e.colis) as number) : undefined,
    lot_fournisseur: e.lot?.trim() || undefined,
    code_magasin_dest: e.magasin,
    statut_qualite: e.qualite,
  }
}
export function Reception() {
  const { id = '' } = useParams()
  const droits = useDroits(MODULE)
  const { moi } = useAuth()
  const qc = useQueryClient()
  const naviguer = useNavigate()

  const [entete, setEntete] = useState({
    num_bon_livraison: '',
    numero_facture: '',
    transporteur: '',
    nombre_colis: '',
    poids_total_brut_kg: '',
  })
  /*
   * UNE SEULE SOURCE POUR LES LIGNES, comme sur le bon de commande.
   *
   * `pesees` et `supprimees` tenaient chacun la moitie de la verite, et
   * l'enregistrement groupe devait les reconcilier. Sur le bon de commande, la
   * meme construction a fait disparaitre une ligne de 36 tonnes sans rien
   * signaler. Ici aussi elle supprimait puis recreait chaque ligne corrigee.
   */
  const [nouvelles, setNouvelles] = useState<LigneSaisie[]>([])
  const amorcee = useRef<string | null>(null)
  /** Ce que chaque ligne valait a son dernier enregistrement, par identifiant. */
  const [initiales, setInitiales] = useState<Map<string, string>>(new Map())
  /** Les lignes dont un envoi est en cours : leurs boutons attendent. */
  const [enCours, setEnCours] = useState<Set<string>>(new Set())

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
    toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

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

  /* DECLARE AVANT L'EFFET QUI LE LIT. `const` n'est pas remonte : plus bas, il
     levait « used before its declaration » et la page entiere tombait. */
  const modifiable =
    !!droits.peutEcrire && (rec?.statut === 'BROUILLON' || rec?.statut === 'A_CONTROLER')

  const lignesServeur = useMemo(() => qLignes.data ?? [], [qLignes.data])

  /*
   * LES LIGNES PESEES ENTRENT DANS LA GRILLE, une fois par reception.
   *
   * On n'amorce que sur `isSuccess`, jamais sur « plus en chargement » : une
   * requete EN ERREUR n'est pas en chargement, et franchirait le garde avec
   * zero ligne — la grille resterait vide pour de bon, meme apres reparation.
   */
  useEffect(() => {
    if (!modifiable || !id || !qLignes.isSuccess) return
    if (amorcee.current === id) return
    amorcee.current = id
    const chargees = lignesServeur.map(depuisLigneReception)
    setInitiales(
      new Map(chargees.map((l) => [l.idExistant as string, JSON.stringify(corpsReception(l))])),
    )
    setNouvelles(chargees)
  }, [id, modifiable, qLignes.isSuccess, lignesServeur])

  const [mode, setMode] = useState<'PLAN' | 'CATALOGUE'>('PLAN')

  const qMagasins = useQuery({
    queryKey: ['magasins'],
    queryFn: () =>
      api.get<{ code_magasin: string; nom: string; est_quarantaine: number }[]>(
        '/api/magasins',
      ),
  })

  /*
   * CE QUE LE BON DE COMMANDE ATTEND ENCORE, propose comme references.
   *
   * C'est l'equivalent du plan d'achat sur un bon : ce qui reste a livrer chez
   * ce fournisseur. Le catalogue entier reste accessible — une livraison hors
   * commande arrive, et la refuser ne la ferait pas disparaitre du quai.
   */
  const qAttendues = useQuery({
    queryKey: ['lignes-attendues', id, rec?.code_fournisseur],
    queryFn: () =>
      api.get<LigneAttendue[]>(
        `/api/lignes-attendues?id_reception=${id}&code_fournisseur=${encodeURIComponent(
          rec?.code_fournisseur ?? "",
        )}`,
      ),
    enabled: !!id && !!rec?.code_fournisseur,
  })

  const proposees = useMemo<RefLigne[]>(
    () =>
      (qAttendues.data ?? [])
        .filter((a) => a.quantite_restante_kg > 0.001)
        .map((a) => ({
          code_reference: a.code_reference,
          designation: a.designation,
          unite_catalogue: a.unite_catalogue,
          code_fournisseur: rec?.code_fournisseur ?? null,
          poids_bobine_kg: a.poids_bobine_kg,
          bobines_par_palette: a.bobines_par_palette,
          bobines_par_lot: a.bobines_par_lot,
          densite_kg_ml: a.densite_kg_ml,
          // Le RESTE a livrer sert de proposition : c’est ce qu’on attend,
          // et c’est presque toujours ce qui arrive.
          qte_a_commander_kg: a.quantite_restante_kg,
          prix_suggere_devise: a.prix_kg_devise,
        })),
    [qAttendues.data, rec?.code_fournisseur],
  )

  const chercherCatalogue = async (motif: string): Promise<RefLigne[]> => {
    const q = new URLSearchParams({
      code_fournisseur: rec?.code_fournisseur ?? '',
      toutes: '1',
      recherche: motif,
      limite: '25',
    })
    return api.get<RefLigne[]>(`/api/references-commandables?${q}`)
  }

  /*
   * LES COLONNES QUE LA RECEPTION AJOUTE A LA GRILLE.
   *
   * La grille ne sait pas ce qu'est un lot ni un magasin de destination : elle
   * les range dans `extra` et les rend par ces descriptions. C’est ce qui lui
   * permet de servir quatre documents sans porter les champs des trois autres.
   */
  const colonnesReception: ColonneGrille[] = [
    {
      cle: 'bl',
      entete: 'Qté BL (kg)',
      largeur: 'w-28',
      alignement: 'right',
      rendu: (l, poser) => (
        <Champ
          type="number"
          step="any"
          min="0"
          value={l.extra?.bl ?? ''}
          onChange={(e) => poser(e.target.value)}
          className="h-9 text-right tabular-nums"
          aria-label="Quantité annoncée au bon de livraison, en kilos"
        />
      ),
    },
    {
      cle: 'colis',
      entete: 'Colis',
      largeur: 'w-20',
      alignement: 'right',
      rendu: (l, poser) => (
        <Champ
          type="number"
          min="0"
          value={l.extra?.colis ?? ''}
          onChange={(e) => poser(e.target.value)}
          className="h-9 text-right tabular-nums"
          aria-label="Nombre de colis"
        />
      ),
    },
    {
      cle: 'lot',
      entete: 'Lot fournisseur',
      largeur: 'w-32',
      rendu: (l, poser) => (
        <Champ
          value={l.extra?.lot ?? ''}
          onChange={(e) => poser(e.target.value)}
          className="h-9"
          aria-label="Lot du fournisseur"
        />
      ),
    },
    {
      cle: 'magasin',
      entete: 'Magasin',
      largeur: 'w-36',
      rendu: (l, poser) => (
        <Selecteur
          value={l.extra?.magasin ?? ''}
          onChange={(e) => poser(e.target.value)}
          className="h-9"
          aria-label="Magasin de destination"
        >
          <option value="">—</option>
          {(qMagasins.data ?? []).map((m) => (
            <option key={m.code_magasin} value={m.code_magasin}>
              {m.nom}
            </option>
          ))}
        </Selecteur>
      ),
    },
    {
      cle: 'qualite',
      entete: 'Qualité',
      largeur: 'w-36',
      rendu: (l, poser) => (
        <Selecteur
          value={l.extra?.qualite ?? 'CONFORME'}
          onChange={(e) => poser(e.target.value)}
          className="h-9"
          aria-label="Statut qualité de la ligne"
        >
          <option value="CONFORME">Conforme</option>
          <option value="QUARANTAINE">Quarantaine</option>
          <option value="NON_CONFORME">Non conforme</option>
        </Selecteur>
      ),
    },
  ]
  const marquer = (cle: string, actif: boolean) =>
    setEnCours((s) => {
      const n = new Set(s)
      if (actif) n.add(cle)
      else n.delete(cle)
      return n
    })

  /**
   * Enregistrer UNE pesee : la creer si elle est neuve, la corriger sinon.
   *
   * `idExistant` DECIDE DU VERBE. Le PATCH existe depuis peu ; avant lui,
   * corriger un poids obligeait a supprimer la ligne et a la reposter — ce qui
   * changeait son numero et inscrivait une SUPPRESSION au journal d'audit pour
   * une virgule deplacee.
   */
  const enregistrerLigne = async (l: LigneSaisie) => {
    if (!id || enCours.has(l.cle)) return
    marquer(l.cle, true)
    try {
      const corps = corpsReception(l)
      if (l.idExistant) {
        await api.patch(`/api/receptions/${id}/lignes/${l.idExistant}`, corps)
        setInitiales((m) => new Map(m).set(l.idExistant as string, JSON.stringify(corps)))
      } else {
        const r = await api.post<{ id_ligne_reception: string }>(
          `/api/receptions/${id}/lignes`,
          { ...corps, code_reference: l.code_reference, id_ligne_bc: l.extra?.id_ligne_bc },
        )
        setInitiales((m) => new Map(m).set(r.id_ligne_reception, JSON.stringify(corps)))
        setNouvelles((ls) =>
          ls.map((x) => (x.cle === l.cle ? { ...x, idExistant: r.id_ligne_reception } : x)),
        )
      }
      toast.success(`Ligne ${l.code_reference} enregistrée`)
      rafraichir()
    } catch (e) {
      echec(e)
    } finally {
      marquer(l.cle, false)
    }
  }

  /**
   * Retirer une pesee deja enregistree.
   *
   * La ligne ne quitte la grille QU'UNE FOIS le serveur d'accord : la retirer
   * d'abord montrerait un ecran qui ment si la suppression est refusee.
   */
  const supprimerLigne = async (l: LigneSaisie) => {
    if (!id || !l.idExistant || enCours.has(l.cle)) return
    marquer(l.cle, true)
    try {
      await api.delete(`/api/receptions/${id}/lignes/${l.idExistant}`)
      setInitiales((m) => {
        const n = new Map(m)
        n.delete(l.idExistant as string)
        return n
      })
      setNouvelles((ls) => ls.filter((x) => x.cle !== l.cle))
      toast.success(`Ligne ${l.code_reference} retirée`)
      rafraichir()
    } catch (e) {
      echec(e)
    } finally {
      marquer(l.cle, false)
    }
  }
  const enteteModifie =
    !!rec &&
    (entete.num_bon_livraison !== (rec.num_bon_livraison ?? '') ||
      entete.numero_facture !== (rec.numero_facture ?? '') ||
      entete.transporteur !== (rec.transporteur ?? '') ||
      entete.nombre_colis !== (rec.nombre_colis?.toString() ?? '') ||
      entete.poids_total_brut_kg !== (rec.poids_total_brut_kg?.toString() ?? ''))

  const lignes = qLignes.data ?? []
  /**
   * L'EN-TETE S'ENREGISTRE SEUL. Les lignes ont chacune leur bouton.
   *
   * L'enregistrement groupe allait chercher dans deux registres paralleles ce
   * qu'il devait creer et supprimer. Pire : faute de PATCH cote serveur, il
   * SUPPRIMAIT puis RECREAIT chaque ligne corrigee — le numero de ligne
   * changeait, et le journal d'audit enregistrait un retrait de marchandise
   * pour une virgule deplacee.
   */
  const enregistrer = useMutation({
    mutationFn: () =>
      api.patch(`/api/receptions/${id}`, {
        num_bon_livraison: entete.num_bon_livraison || undefined,
        numero_facture: entete.numero_facture || undefined,
        transporteur: entete.transporteur || undefined,
        nombre_colis: entete.nombre_colis ? Number(entete.nombre_colis) : undefined,
        poids_total_brut_kg: entete.poids_total_brut_kg
          ? Number(entete.poids_total_brut_kg)
          : undefined,
      }),
    onSuccess: () => {
      toast.success('En-tete enregistre')
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

  /*
   * PLUS DE FUSION ENTRE LE SERVEUR ET UN BROUILLON LOCAL.
   *
   * L'ecran melangeait les lignes du serveur et les pesees pas encore
   * envoyees, en fabriquant pour celles-ci de faux identifiants « pesee: » et
   * de faux ecarts calcules a la main. Deux verites coexistaient, et les
   * ecarts affiches n'etaient pas ceux que le serveur calculerait.
   *
   * Desormais la grille tient les lignes modifiables et le tableau n'affiche
   * que ce que le serveur a vraiment enregistre.
   */
  const lignesAffichees: LigneRec[] = lignes

  const horsTolerance = useMemo(
    () => lignesAffichees.filter((l) => Math.abs(l.ecart_pct ?? 0) > TOLERANCE_PCT).length,
    [lignesAffichees],
  )

  const colonnes: ColonneDT<LigneRec>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
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
      entete: 'Écart',
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
      entete: 'Écart commande',
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
      entete: 'Qualité',
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
    /* LA COLONNE « ETAT » A DISPARU. Elle distinguait « nouvelle », « a
       retirer » et « enregistree » — trois etats qui n'existaient que le temps
       d'un brouillon local. Maintenant qu'une ligne part au serveur au moment
       ou on la valide, ce tableau ne montre que des lignes enregistrees : la
       colonne n'aurait plus qu'un seul mot a dire. */
  ]

  if (qRec.isLoading) return <Chargement />
  if (!rec) {
    return (
      <div>
        <EnTetePage titre="Réception" description="Introuvable." />
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
            {/* Le bouton « Peser des lignes » est parti avec son panneau : on
                ajoute une ligne dans la grille, comme sur un bon de commande. */}
            {droits.peutEcrire && rec.statut === 'BROUILLON' && (
              <Bouton
                variante="contour"
                onClick={() => changerStatut.mutate('A_CONTROLER')}
                disabled={lignes.length === 0 || enteteModifie}
                title={
                  lignes.length === 0
                    ? 'Aucune ligne pesee'
                    : enteteModifie
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
            {/* ROUVRIR LE CONTROLE. Le serveur refusera tant que les entrees de
                stock nees de cette reception vivent encore : le papier ne
                recule pas pendant que la marchandise avance. */}
            <BoutonDevalider
              document="receptions"
              id={id}
              statut={rec.statut}
              taille="md"
              consequence="Les lignes redeviendront modifiables et devront etre controlees a nouveau."
            />
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
        <Alerte ton="alerte" titre="Écart de pesee" className="mb-3">
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
            <Indicateur libelle="Délai reel" valeur={rec.delai_reel_jours} suffixe=" j" />
            <Indicateur libelle="Délai promis" valeur={rec.delai_prevu_jours} suffixe=" j" />
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
              <Etiq htmlFor="fact">
                N° de facture
                <Aide>Souvent absente a la livraison : elle se saisit plus tard.</Aide>
              </Etiq>
              <Champ
                id="fact"
                value={entete.numero_facture}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, numero_facture: e.target.value })}
              />
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
              <Etiq htmlFor="brut">
                Poids brut (kg)
                <Aide>Releve au pont-bascule, emballage compris.</Aide>
              </Etiq>
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
            </div>
          </CarteCorps>
        </Carte>

        <Carte repliable="reception.2">
          <CarteEntete>
            <CarteTitre>Pesees</CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            {modifiable ? (
              /* LA MEME GRILLE QUE LE BON DE COMMANDE. Les colonnes propres a
                 la reception — BL, colis, lot, magasin, qualite — lui sont
                 decrites ; elle les place et les rend, sans avoir a les
                 comprendre. Le prix et les champs fournisseur sont masques :
                 une reception ne negocie rien, son prix vient du bon. */
              <GrilleLignes
                codeFournisseur={rec.code_fournisseur ?? ''}
                devise={rec.code_devise ?? 'MAD'}
                lignes={nouvelles}
                setLignes={setNouvelles}
                mode={mode}
                setMode={setMode}
                proposees={proposees}
                chercherCatalogue={chercherCatalogue}
                sansPrix
                sansFournisseur
                colonnesSupplementaires={colonnesReception}
                surEnregistrerLigne={enregistrerLigne}
                surSupprimerLigne={supprimerLigne}
                enCours={enCours}
                modifiees={
                  new Set(
                    nouvelles
                      .filter(
                        (n) =>
                          n.idExistant &&
                          JSON.stringify(corpsReception(n)) !== initiales.get(n.idExistant),
                      )
                      .map((n) => n.cle),
                  )
                }
              />
            ) : (
              <DataTable<LigneRec>
                exportable="lignes-de-reception"
                imprimable="Lignes de reception"
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
                videDescription="Cette reception ne porte aucune ligne."
              />
            )}
          </CarteCorps>
        </Carte>
      </div>

      {modifiable && (
        <div
          className={cn(
            'sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            enteteModifie ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="text-[13px]">
            {enteteModifie ? (
              <>
                <span className="font-medium">En-tête modifié</span>
                <span className="text-alerte"> — pas encore enregistré.</span>
              </>
            ) : (
              <span className="text-attenue-texte">
                Chaque pesée s’enregistre sur sa ligne. Cette barre ne concerne que
                l’en-tête.
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton
              variante="contour"
              disabled={!enteteModifie}
              onClick={() => {
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
              Annuler les modifications de l’en-tête
            </Bouton>
            <Bouton
              onClick={() => enregistrer.mutate()}
              chargement={enregistrer.isPending}
              disabled={!enteteModifie}
            >
              <Save />
              Enregistrer l’en-tête
            </Bouton>
          </div>
        </div>
      )}

      {/* LE PANNEAU « PESER » A DISPARU. Il ouvrait une fenetre pour choisir
          des lignes attendues, alors que la grille propose exactement les
          memes par son champ de recherche — deux chemins pour un seul geste,
          et deux endroits ou corriger le jour ou la regle change. */}
    </div>
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

/**
 * Nouvelle reception — saisie en cascade, dans la forme des ERP du marche.
 *
 * La disposition suit MIGO (SAP) et les pages de reception d'Oracle, parce que
 * c'est celle qui tient au quai :
 *
 *   1. une BARRE DE REPRISE ou l'on appelle un bon de commande ; ses lignes
 *      s'AJOUTENT a la grille sans effacer les precedentes, donc un camion qui
 *      porte deux bons se saisit en une fois ;
 *   2. une GRILLE dense, une ligne par article, avec le drapeau « retenue » de
 *      MIGO : on decoche ce qui n'est pas descendu du camion plutot que de le
 *      supprimer, et l'on garde sous les yeux ce qui etait attendu ;
 *   3. un PANNEAU DE DETAIL pour la ligne pointee — ce qui ne tient pas en
 *      colonne (colis, dates, prix, observations) y est range par onglets,
 *      comme les onglets d'article de MIGO.
 *
 * L'arrivage SANS COMMANDE se saisit ici aussi : la marchandise est au quai, la
 * refuser n'est pas une option. Le serveur cree alors le bon manquant en
 * brouillon ; la reception ne se validera qu'une fois ce bon regularise.
 *
 * Rien ne part au serveur avant le clic final : en-tete, lignes et bon de
 * regularisation partent dans une seule transaction.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCheck, Plus, Save, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
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
/** Au-dela, le controle qualite exigera une derogation motivee (controle C10). */
const TOLERANCE_PCT = 2

interface LigneAttendue extends Record<string, unknown> {
  id_ligne_bc: string
  id_bc: string
  numero_bc: string
  date_livraison_prevue: string | null
  retard_jours: number | null
  code_reference: string
  designation: string
  quantite_commandee_kg: number
  quantite_recue_kg: number
  quantite_restante_kg: number
  prix_kg_devise?: number
  code_devise?: string
  unite_catalogue: string
  suivi_lot: number
  /** References que le fournisseur peut legitimement livrer a la place. */
  equivalents_recevables: string | null
}

interface RefCatalogue extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  suivi_lot: number
  prix_catalogue_kg?: number
  code_devise_catalogue?: string
}

/** Une ligne de la grille. `retenue` est le drapeau « OK » de MIGO. */
interface Ligne {
  cle: string
  retenue: boolean
  id_ligne_bc: string | null
  id_bc: string | null
  numero_bc: string | null
  date_livraison_prevue: string | null
  retard_jours: number | null
  code_reference: string
  designation: string
  reste_kg: number | null
  unite_catalogue: string
  suivi_lot: number
  devise: string | null
  /** Reference REELLEMENT recue : elle peut differer de celle commandee. */
  code_recu: string
  equivalents: string[]
  motif_substitution: string
  qte: string
  qteBl: string
  unite: string
  colis: string
  lot: string
  fabrication: string
  peremption: string
  magasin: string
  qualite: string
  prix: string
  notes: string
}

export function ReceptionNouvelle() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()

  const [entete, setEntete] = useState({
    code_fournisseur: '',
    num_bon_livraison: '',
    numero_facture: '',
    transporteur: '',
    nombre_colis: '',
    poids_total_brut_kg: '',
  })
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [pointee, setPointee] = useState<string | null>(null)
  const [bonAReprendre, setBonAReprendre] = useState('')
  const [horsCommande, setHorsCommande] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const voitPrix = droits.visible('prix_kg_devise')

  const qFrs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: () =>
      api.get<{ code_fournisseur: string; nom: string }[]>('/api/fournisseurs?actif=1&limite=500'),
  })
  const fournisseur = qFrs.data?.find((f) => f.code_fournisseur === entete.code_fournisseur)

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })
  const magasinDefaut = qMag.data?.[0]?.code_magasin ?? 'MP-01'

  const qAtt = useQuery({
    queryKey: ['lignes-attendues-frs', entete.code_fournisseur],
    queryFn: () =>
      api.get<LigneAttendue[]>(
        `/api/lignes-attendues?code_fournisseur=${encodeURIComponent(entete.code_fournisseur)}`,
      ),
    enabled: !!entete.code_fournisseur,
  })

  const attendues = useMemo(
    () => (qAtt.data ?? []).filter((l) => l.quantite_restante_kg > 0.001),
    [qAtt.data],
  )

  /** Bons reprenables, avec ce qu'il reste a en tirer une fois la grille servie. */
  const bonsDisponibles = useMemo(() => {
    const prises = new Set(lignes.map((l) => l.id_ligne_bc).filter(Boolean))
    const m = new Map<string, { numero: string; restantes: number; total: number }>()
    for (const a of attendues) {
      const e = m.get(a.numero_bc) ?? { numero: a.numero_bc, restantes: 0, total: 0 }
      e.total += 1
      if (!prises.has(a.id_ligne_bc)) e.restantes += 1
      m.set(a.numero_bc, e)
    }
    return [...m.values()].sort((a, b) => a.numero.localeCompare(b.numero))
  }, [attendues, lignes])

  const bonsRepris = useMemo(
    () => [...new Set(lignes.map((l) => l.numero_bc).filter(Boolean) as string[])].sort(),
    [lignes],
  )

  const reprendre = (numeroBc: string) => {
    const prises = new Set(lignes.map((l) => l.id_ligne_bc).filter(Boolean))
    const nouvelles = attendues
      .filter((a) => a.numero_bc === numeroBc && !prises.has(a.id_ligne_bc))
      .map<Ligne>((a) => ({
        cle: `bc:${a.id_ligne_bc}`,
        retenue: true,
        id_ligne_bc: a.id_ligne_bc,
        id_bc: a.id_bc,
        numero_bc: a.numero_bc,
        date_livraison_prevue: a.date_livraison_prevue,
        retard_jours: a.retard_jours,
        code_reference: a.code_reference,
        designation: a.designation,
        code_recu: a.code_reference,
        equivalents: (a.equivalents_recevables ?? '').split(',').filter(Boolean),
        motif_substitution: '',
        reste_kg: a.quantite_restante_kg,
        unite_catalogue: a.unite_catalogue,
        suivi_lot: a.suivi_lot,
        devise: a.code_devise ?? null,
        // Le reste a livrer sert de proposition : c'est ce qu'on attend, et
        // c'est presque toujours ce qui arrive.
        qte: String(Math.round(a.quantite_restante_kg * 1000) / 1000),
        qteBl: String(Math.round(a.quantite_restante_kg * 1000) / 1000),
        unite: 'kg',
        colis: '',
        lot: '',
        fabrication: '',
        peremption: '',
        magasin: magasinDefaut,
        qualite: 'CONFORME',
        prix: a.prix_kg_devise != null ? String(a.prix_kg_devise) : '',
        notes: '',
      }))
    if (nouvelles.length === 0) {
      toast.info(`${numeroBc} : toutes ses lignes sont deja dans la grille.`)
      return
    }
    setLignes((l) => [...l, ...nouvelles])
    setPointee(nouvelles[0].cle)
    setBonAReprendre('')
  }

  const retirerBon = (numeroBc: string) =>
    setLignes((l) => l.filter((x) => x.numero_bc !== numeroBc))

  const ajouterHorsCommande = (refs: { ref: RefCatalogue; qte: number }[]) =>
    setLignes((l) => [
      ...l,
      ...refs.map<Ligne>(({ ref, qte }, i) => ({
        cle: `hors:${Date.now()}:${i}`,
        retenue: true,
        id_ligne_bc: null,
        id_bc: null,
        numero_bc: null,
        date_livraison_prevue: null,
        retard_jours: null,
        code_reference: ref.code_reference,
        designation: ref.designation,
        code_recu: ref.code_reference,
        equivalents: [],
        motif_substitution: '',
        reste_kg: null,
        unite_catalogue: ref.unite_catalogue,
        suivi_lot: ref.suivi_lot,
        devise: ref.code_devise_catalogue ?? null,
        qte: String(qte),
        qteBl: String(qte),
        unite: 'kg',
        colis: '',
        lot: '',
        fabrication: '',
        peremption: '',
        magasin: magasinDefaut,
        qualite: 'CONFORME',
        prix: ref.prix_catalogue_kg != null ? String(ref.prix_catalogue_kg) : '',
        notes: '',
      })),
    ])

  const maj = (cle: string, champ: keyof Ligne, v: string | boolean) =>
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, [champ]: v } : x)))

  const retenues = lignes.filter((l) => l.retenue)
  const nbHorsCommande = retenues.filter((l) => !l.id_ligne_bc).length
  const totalKg = retenues.reduce((s, l) => s + (Number(l.qte) || 0), 0)
  const sansQte = retenues.filter((l) => !(Number(l.qte) > 0))
  const sansLot = retenues.filter((l) => l.suivi_lot === 1 && !l.lot.trim())
  // Une substitution sans motif serait acceptee par la base mais illisible dans
  // six mois : c'est l'ecran qui exige l'explication, au moment ou on l'a.
  const sansMotif = retenues.filter(
    (l) => l.code_recu !== l.code_reference && !l.motif_substitution.trim(),
  )
  const pret =
    !!entete.code_fournisseur &&
    retenues.length > 0 &&
    !sansQte.length &&
    !sansLot.length &&
    !sansMotif.length

  const ecartDe = (l: Ligne) =>
    l.reste_kg && l.reste_kg > 0 ? ((Number(l.qte) - l.reste_kg) / l.reste_kg) * 100 : null

  const creer = useMutation({
    mutationFn: () =>
      api.post<{
        id_reception: string
        numero_reception: string
        lignes: number
        numero_bc_regularisation: string | null
      }>('/api/receptions', {
        // Toutes les lignes du meme bon : la reception s'y rattache. Sinon on la
        // laisse sans bon d'entete — chaque ligne garde le sien, et pretendre
        // qu'elle n'en couvre qu'un serait faux.
        id_bc:
          bonsRepris.length === 1 && nbHorsCommande === 0
            ? (retenues.find((l) => l.id_bc)?.id_bc ?? undefined)
            : undefined,
        code_fournisseur: entete.code_fournisseur,
        num_bon_livraison: entete.num_bon_livraison || undefined,
        numero_facture: entete.numero_facture || undefined,
        transporteur: entete.transporteur || undefined,
        nombre_colis: entete.nombre_colis ? Number(entete.nombre_colis) : undefined,
        poids_total_brut_kg: entete.poids_total_brut_kg
          ? Number(entete.poids_total_brut_kg)
          : undefined,
        lignes: retenues.map((l) => ({
          // C'est la reference REELLEMENT descendue du camion qui entre en
          // stock, pas celle du bon. Envoyer celle du bon creerait du stock sur
          // une matiere qui n'est jamais arrivee.
          code_reference: l.code_recu,
          id_ligne_bc: l.id_ligne_bc ?? undefined,
          substitution_acceptee: l.code_recu !== l.code_reference ? true : undefined,
          motif_substitution:
            l.code_recu !== l.code_reference ? l.motif_substitution.trim() : undefined,
          unite_saisie: l.unite,
          quantite_pesee_unite: Number(l.qte),
          quantite_bl_kg: l.qteBl ? Number(l.qteBl) : undefined,
          nb_colis_ligne: l.colis ? Number(l.colis) : undefined,
          code_magasin_dest: l.magasin,
          lot_fournisseur: l.lot || undefined,
          date_fabrication: l.fabrication || undefined,
          date_peremption: l.peremption || undefined,
          statut_qualite: l.qualite,
          // Le prix n'accompagne que les lignes hors commande : ailleurs c'est
          // le prix ENGAGE du bon qui fait foi, et le renvoyer l'ecraserait.
          prix_kg_devise: !l.id_ligne_bc && l.prix ? Number(l.prix) : undefined,
          notes: l.notes || undefined,
        })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.numero_reception} enregistree`, {
        description: r.numero_bc_regularisation
          ? `${r.lignes} pesee(s). Bon de regularisation ${r.numero_bc_regularisation} cree en brouillon : a valider et envoyer avant le controle.`
          : `${r.lignes} pesee(s) · en saisie, rien n'est encore entre en stock.`,
        duration: r.numero_bc_regularisation ? 12000 : undefined,
      })
      void qc.invalidateQueries({ queryKey: ['receptions'] })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      naviguer(`/receptions/${r.id_reception}`)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  const ligneP = lignes.find((l) => l.cle === pointee) ?? null

  return (
    <div>
      <EnTetePage
        titre="Nouvelle reception"
        description="Reprenez un ou plusieurs bons du fournisseur, corrigez les pesees, enregistrez l'ensemble en une fois."
        actions={
          <Bouton variante="contour" onClick={() => naviguer('/receptions')}>
            <ArrowLeft />
            Retour
          </Bouton>
        }
      />

      {erreur && (
        <Alerte ton="danger" titre="Enregistrement refuse" className="mb-3">
          {erreur}
        </Alerte>
      )}

      <div className="space-y-3">
        {/* ---- En-tete ---------------------------------------------------- */}
        <Carte>
          <CarteEntete>
            <CarteTitre>En-tete</CarteTitre>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Etiq htmlFor="frs" obligatoire>
                Fournisseur
              </Etiq>
              <Selecteur
                id="frs"
                value={entete.code_fournisseur}
                onChange={(e) => {
                  setEntete({ ...entete, code_fournisseur: e.target.value })
                  setLignes([])
                  setPointee(null)
                }}
              >
                <option value="">Choisir…</option>
                {qFrs.data?.map((f) => (
                  <option key={f.code_fournisseur} value={f.code_fournisseur}>
                    {f.nom}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq htmlFor="bl">Bon de livraison</Etiq>
              <Champ
                id="bl"
                value={entete.num_bon_livraison}
                onChange={(e) => setEntete({ ...entete, num_bon_livraison: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="fact">N° de facture</Etiq>
              <Champ
                id="fact"
                value={entete.numero_facture}
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
                onChange={(e) => setEntete({ ...entete, poids_total_brut_kg: e.target.value })}
                className="text-right tabular-nums"
              />
              <p className="mt-1 text-[11px] text-attenue-texte">
                Releve au pont-bascule, emballage compris.
              </p>
            </div>
          </CarteCorps>
        </Carte>

        {!entete.code_fournisseur ? (
          <Alerte ton="info">
            Choisissez un fournisseur : ses bons en attente de livraison deviendront reprenables,
            un par un, et leurs lignes s'ajouteront a la grille de saisie.
          </Alerte>
        ) : (
          <>
            {/* ---- Barre de reprise ---------------------------------------- */}
            <Carte>
              <CarteEntete>
                <CarteTitre>Reprise des commandes de {fournisseur?.nom}</CarteTitre>
              </CarteEntete>
              <CarteCorps className="space-y-2">
                {qAtt.isLoading && <Chargement texte="Lecture des bons de commande…" />}

                {!qAtt.isLoading && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-56 flex-1">
                      <Etiq htmlFor="bon">Bon de commande</Etiq>
                      <Selecteur
                        id="bon"
                        value={bonAReprendre}
                        onChange={(e) => setBonAReprendre(e.target.value)}
                      >
                        <option value="">
                          {bonsDisponibles.length === 0
                            ? 'Aucun bon en attente de livraison'
                            : 'Choisir un bon a reprendre…'}
                        </option>
                        {bonsDisponibles.map((b) => (
                          <option key={b.numero} value={b.numero} disabled={b.restantes === 0}>
                            {b.numero} — {b.restantes} ligne(s) a reprendre sur {b.total}
                          </option>
                        ))}
                      </Selecteur>
                    </div>
                    <Bouton
                      variante="contour"
                      onClick={() => bonAReprendre && reprendre(bonAReprendre)}
                      disabled={!bonAReprendre}
                    >
                      <Plus />
                      Reprendre les lignes
                    </Bouton>
                    <Bouton variante="contour" onClick={() => setHorsCommande(true)}>
                      <Plus />
                      Article hors commande
                    </Bouton>
                  </div>
                )}

                {bonsRepris.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-attenue-texte">Bons repris :</span>
                    {bonsRepris.map((b) => (
                      <span
                        key={b}
                        className="inline-flex items-center gap-1 rounded-full border border-bordure px-2 py-0.5 text-[11px] tabular-nums"
                      >
                        {b}
                        <button
                          type="button"
                          onClick={() => retirerBon(b)}
                          className="text-attenue-texte hover:text-danger"
                          aria-label={`Retirer ${b}`}
                          title="Retirer toutes ses lignes de la grille"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {nbHorsCommande > 0 && (
                  <Alerte ton="alerte" titre="Marchandise sans commande">
                    {nbHorsCommande} ligne(s) n'ont aucun bon derriere elles. A l'enregistrement, un
                    bon de commande sera cree en brouillon pour les couvrir. La reception ne pourra
                    etre <strong>controlee</strong> qu'une fois ce bon valide puis envoye — c'est ce
                    qui evite qu'une marchandise entre en stock sans engagement.
                  </Alerte>
                )}
              </CarteCorps>
            </Carte>

            {/* ---- Grille -------------------------------------------------- */}
            <Carte>
              <CarteEntete>
                <CarteTitre>
                  Lignes de la reception
                  {lignes.length > 0 && ` (${retenues.length}/${lignes.length})`}
                </CarteTitre>
                {lignes.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Bouton
                      variante="discret"
                      taille="sm"
                      onClick={() => setLignes((l) => l.map((x) => ({ ...x, retenue: true })))}
                    >
                      <CheckCheck />
                      Tout retenir
                    </Bouton>
                    <Bouton
                      variante="discret"
                      taille="sm"
                      onClick={() => setLignes((l) => l.map((x) => ({ ...x, retenue: false })))}
                    >
                      Tout decocher
                    </Bouton>
                  </div>
                )}
              </CarteEntete>
              <CarteCorps className="p-0">
                {lignes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-attenue-texte">
                    Reprenez un bon de commande, ou ajoutez un article hors commande.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                          <th className="w-10 px-2 py-2" title="Ligne retenue pour cette reception">
                            OK
                          </th>
                          <th className="w-10 px-1 py-2 text-right">#</th>
                          <th className="px-2 py-2 text-left">Reference</th>
                          <th className="w-32 px-2 py-2 text-left">Bon</th>
                          <th className="w-24 px-2 py-2 text-right">Reste</th>
                          <th className="w-28 px-2 py-2 text-right">Qte BL</th>
                          <th className="w-32 px-2 py-2 text-right">Qte pesee</th>
                          <th className="w-24 px-2 py-2 text-left">Unite</th>
                          <th className="w-24 px-2 py-2 text-right">Ecart</th>
                          <th className="w-32 px-2 py-2 text-left">Lot</th>
                          <th className="w-28 px-2 py-2 text-left">Magasin</th>
                          <th className="w-10 px-1 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lignes.map((l, i) => {
                          const ecart = ecartDe(l)
                          const hors = ecart != null && Math.abs(ecart) > TOLERANCE_PCT
                          const manqueLot = l.retenue && l.suivi_lot === 1 && !l.lot.trim()
                          const manqueQte = l.retenue && !(Number(l.qte) > 0)
                          return (
                            <tr
                              key={l.cle}
                              onClick={() => setPointee(l.cle)}
                              className={cn(
                                'cursor-pointer border-b border-bordure/60 align-middle',
                                pointee === l.cle && 'bg-primaire/5',
                                !l.retenue && 'opacity-45',
                              )}
                            >
                              <td className="px-2 py-1 text-center">
                                <input
                                  type="checkbox"
                                  checked={l.retenue}
                                  onChange={(e) => maj(l.cle, 'retenue', e.target.checked)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="size-4"
                                  aria-label={`Retenir ${l.code_reference}`}
                                />
                              </td>
                              <td className="px-1 py-1 text-right tabular-nums text-attenue-texte">
                                {i + 1}
                              </td>
                              <td className="max-w-64 px-2 py-1">
                                {l.equivalents.length > 0 ? (
                                  <Selecteur
                                    value={l.code_recu}
                                    onChange={(e) => maj(l.cle, 'code_recu', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                      'h-7',
                                      l.code_recu !== l.code_reference && 'border-alerte',
                                    )}
                                    aria-label="Reference reellement recue"
                                  >
                                    <option value={l.code_reference}>{l.code_reference}</option>
                                    {l.equivalents.map((e) => (
                                      <option key={e} value={e}>
                                        {e} (equivalent)
                                      </option>
                                    ))}
                                  </Selecteur>
                                ) : (
                                  <div className="truncate font-medium">{l.code_reference}</div>
                                )}
                                <div className="truncate text-[11px] text-attenue-texte">
                                  {l.code_recu === l.code_reference ? (
                                    l.designation
                                  ) : (
                                    <span className="text-alerte">
                                      commande : {l.code_reference}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1">
                                {l.numero_bc ? (
                                  <div>
                                    <div className="tabular-nums text-[12px]">{l.numero_bc}</div>
                                    {(l.retard_jours ?? 0) > 0 && (
                                      <div className="text-[11px] text-danger">
                                        {l.retard_jours} j de retard
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <Badge ton="alerte">hors commande</Badge>
                                )}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-attenue-texte">
                                {l.reste_kg == null ? '—' : fmt.nombre(l.reste_kg, 0)}
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={l.qteBl}
                                  onChange={(e) => maj(l.cle, 'qteBl', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-right tabular-nums"
                                  aria-label="Quantite du bon de livraison"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  type="number"
                                  step="any"
                                  min="0.0001"
                                  value={l.qte}
                                  onChange={(e) => maj(l.cle, 'qte', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn(
                                    'h-7 text-right font-medium tabular-nums',
                                    (hors || manqueQte) && 'border-danger',
                                  )}
                                  aria-label="Quantite pesee"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Selecteur
                                  value={l.unite}
                                  onChange={(e) => maj(l.cle, 'unite', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7"
                                  aria-label="Unite de saisie"
                                >
                                  <option value="kg">kg</option>
                                  {l.unite_catalogue !== 'kg' && (
                                    <option value={l.unite_catalogue}>{l.unite_catalogue}</option>
                                  )}
                                </Selecteur>
                              </td>
                              <td
                                className={cn(
                                  'px-2 py-1 text-right tabular-nums',
                                  hors && 'font-medium text-danger',
                                )}
                              >
                                {ecart == null ? (
                                  '—'
                                ) : (
                                  <>
                                    {ecart > 0 ? '+' : ''}
                                    {fmt.nombre(ecart, 1)} %
                                  </>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  value={l.lot}
                                  onChange={(e) => maj(l.cle, 'lot', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn('h-7', manqueLot && 'border-danger')}
                                  placeholder={l.suivi_lot === 1 ? 'obligatoire' : ''}
                                  aria-label="Lot fournisseur"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Selecteur
                                  value={l.magasin}
                                  onChange={(e) => maj(l.cle, 'magasin', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7"
                                  aria-label="Magasin destinataire"
                                >
                                  {(qMag.data ?? []).map((m) => (
                                    <option key={m.code_magasin} value={m.code_magasin}>
                                      {m.code_magasin}
                                    </option>
                                  ))}
                                </Selecteur>
                              </td>
                              <td className="px-1 py-1">
                                <Bouton
                                  variante="discret"
                                  taille="icone-xs"
                                  className="text-danger hover:bg-danger/10"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setLignes((x) => x.filter((y) => y.cle !== l.cle))
                                    if (pointee === l.cle) setPointee(null)
                                  }}
                                  aria-label="Supprimer la ligne"
                                  title="Retirer la ligne de la grille"
                                >
                                  <Trash2 />
                                </Bouton>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CarteCorps>
            </Carte>

            {/* ---- Detail de la ligne pointee ------------------------------ */}
            {ligneP && (
              <PanneauDetail
                ligne={ligneP}
                maj={maj}
                voitPrix={voitPrix}
                magasins={qMag.data ?? []}
                rang={lignes.findIndex((l) => l.cle === ligneP.cle) + 1}
              />
            )}
          </>
        )}
      </div>

      {entete.code_fournisseur && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            {retenues.length === 0 ? (
              <span className="text-attenue-texte">Aucune ligne retenue.</span>
            ) : (
              <>
                <span className="font-medium">{retenues.length} ligne(s) retenue(s)</span>
                <span className="text-attenue-texte"> · total </span>
                <span className="font-semibold tabular-nums">{fmt.nombre(totalKg, 0)} kg</span>
                {bonsRepris.length > 1 && (
                  <span className="text-attenue-texte"> · {bonsRepris.length} bons</span>
                )}
                {sansQte.length > 0 && (
                  <span className="text-danger"> — quantite manquante sur {sansQte.length}</span>
                )}
                {sansLot.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    — lot obligatoire : {sansLot.map((l) => l.code_reference).join(', ')}
                  </span>
                )}
                {sansMotif.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    — motif de substitution manquant sur{' '}
                    {sansMotif.map((l) => l.code_recu).join(', ')}
                  </span>
                )}
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={() => naviguer('/receptions')}>
              Annuler
            </Bouton>
            <Bouton
              onClick={() => {
                setErreur(null)
                creer.mutate()
              }}
              chargement={creer.isPending}
              disabled={!pret || !droits.peutEcrire}
            >
              <Save />
              Enregistrer la reception
            </Bouton>
          </div>
        </div>
      )}

      {horsCommande && (
        <PanneauHorsCommande
          voitPrix={voitPrix}
          surFermeture={() => setHorsCommande(false)}
          surAjout={(refs) => {
            ajouterHorsCommande(refs)
            setHorsCommande(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * Detail de la ligne pointee — ce qui ne tient pas en colonne.
 *
 * Par onglets, comme les onglets d'article de MIGO : on ne descend ici que pour
 * les cas particuliers (conditionnement inattendu, peremption, litige), et la
 * grille suffit au train-train.
 */
function PanneauDetail({
  ligne,
  maj,
  voitPrix,
  magasins,
  rang,
}: {
  ligne: Ligne
  maj: (cle: string, champ: keyof Ligne, v: string | boolean) => void
  voitPrix: boolean
  magasins: { code_magasin: string; nom: string }[]
  rang: number
}) {
  const [onglet, setOnglet] = useState<'quantite' | 'stockage' | 'commande' | 'qualite'>('quantite')
  const poidsColis = Number(ligne.colis) > 0 ? Number(ligne.qte) / Number(ligne.colis) : null
  const ecartBl = ligne.qteBl !== '' ? Number(ligne.qte) - Number(ligne.qteBl) : null

  const onglets = [
    { cle: 'quantite' as const, nom: 'Quantite' },
    { cle: 'stockage' as const, nom: 'Stockage et lot' },
    { cle: 'commande' as const, nom: 'Commande' },
    { cle: 'qualite' as const, nom: 'Qualite' },
  ]

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>
          Ligne {rang} — {ligne.code_reference}
        </CarteTitre>
        <div className="flex flex-wrap gap-0.5">
          {onglets.map((o) => (
            <button
              key={o.cle}
              type="button"
              onClick={() => setOnglet(o.cle)}
              className={cn(
                'rounded-[var(--radius)] px-2.5 py-1 text-[12px]',
                onglet === o.cle
                  ? 'bg-primaire/10 font-medium text-primaire'
                  : 'text-attenue-texte hover:bg-bordure/40',
              )}
            >
              {o.nom}
            </button>
          ))}
        </div>
      </CarteEntete>
      <CarteCorps>
        {onglet === 'quantite' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Etiq>Quantite annoncee au BL</Etiq>
              <Champ
                type="number"
                step="any"
                min="0"
                value={ligne.qteBl}
                onChange={(e) => maj(ligne.cle, 'qteBl', e.target.value)}
                className="text-right tabular-nums"
              />
              {ecartBl != null && Math.abs(ecartBl) > 0.001 && (
                <p className="mt-1 text-[11px] text-danger">
                  {ecartBl > 0 ? '+' : ''}
                  {fmt.nombre(ecartBl, 2)} kg a la pesee — litige de transport
                </p>
              )}
            </div>
            <div>
              <Etiq obligatoire>Quantite pesee</Etiq>
              <Champ
                type="number"
                step="any"
                min="0.0001"
                value={ligne.qte}
                onChange={(e) => maj(ligne.cle, 'qte', e.target.value)}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq>Nombre de colis</Etiq>
              <Champ
                type="number"
                min="1"
                value={ligne.colis}
                onChange={(e) => maj(ligne.cle, 'colis', e.target.value)}
                className="text-right tabular-nums"
              />
              {poidsColis != null && (
                <p className="mt-1 text-[11px] text-attenue-texte">
                  {fmt.nombre(poidsColis, 2)} kg par colis
                </p>
              )}
            </div>
            <div>
              <Etiq>Unite de saisie</Etiq>
              <Selecteur
                value={ligne.unite}
                onChange={(e) => maj(ligne.cle, 'unite', e.target.value)}
              >
                <option value="kg">kg</option>
                {ligne.unite_catalogue !== 'kg' && (
                  <option value={ligne.unite_catalogue}>{ligne.unite_catalogue}</option>
                )}
              </Selecteur>
              <p className="mt-1 text-[11px] text-attenue-texte">
                Converti en kg a l'enregistrement.
              </p>
            </div>
          </div>
        )}

        {onglet === 'stockage' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Etiq obligatoire={ligne.suivi_lot === 1}>Lot fournisseur</Etiq>
              <Champ
                value={ligne.lot}
                onChange={(e) => maj(ligne.cle, 'lot', e.target.value)}
                className={cn(ligne.suivi_lot === 1 && !ligne.lot.trim() && 'border-danger')}
              />
              {ligne.suivi_lot === 1 && (
                <p className="mt-1 text-[11px] text-attenue-texte">
                  Reference suivie par lot : sans lot, pas d'entree en stock.
                </p>
              )}
            </div>
            <div>
              <Etiq>Magasin destinataire</Etiq>
              <Selecteur
                value={ligne.magasin}
                onChange={(e) => maj(ligne.cle, 'magasin', e.target.value)}
              >
                {magasins.map((m) => (
                  <option key={m.code_magasin} value={m.code_magasin}>
                    {m.nom}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq>Date de fabrication</Etiq>
              <Champ
                type="date"
                value={ligne.fabrication}
                onChange={(e) => maj(ligne.cle, 'fabrication', e.target.value)}
              />
            </div>
            <div>
              <Etiq>Date de peremption</Etiq>
              <Champ
                type="date"
                value={ligne.peremption}
                onChange={(e) => maj(ligne.cle, 'peremption', e.target.value)}
              />
            </div>
          </div>
        )}

        {onglet === 'commande' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info libelle="Bon de commande" valeur={ligne.numero_bc ?? 'aucun'} />
            <Info
              libelle="Livraison promise"
              valeur={ligne.date_livraison_prevue ? fmt.date(ligne.date_livraison_prevue) : '—'}
              alerte={(ligne.retard_jours ?? 0) > 0}
              complement={
                (ligne.retard_jours ?? 0) > 0 ? `${ligne.retard_jours} j de retard` : undefined
              }
            />
            <Info
              libelle="Reste a livrer"
              valeur={ligne.reste_kg == null ? '—' : `${fmt.nombre(ligne.reste_kg, 0)} kg`}
            />
            {voitPrix && (
              <div>
                <Etiq>Prix ({ligne.devise ?? 'devise'}/kg)</Etiq>
                {ligne.id_ligne_bc ? (
                  <>
                    <div className="mt-1 text-[15px] font-medium tabular-nums">
                      {ligne.prix ? fmt.nombre(Number(ligne.prix), 4) : '—'}
                    </div>
                    <p className="mt-1 text-[11px] text-attenue-texte">
                      Prix engage du bon : il fait foi, la reception ne le change pas.
                    </p>
                  </>
                ) : (
                  <>
                    <Champ
                      type="number"
                      step="any"
                      min="0"
                      value={ligne.prix}
                      onChange={(e) => maj(ligne.cle, 'prix', e.target.value)}
                      className="text-right tabular-nums"
                    />
                    <p className="mt-1 text-[11px] text-attenue-texte">
                      Portera le bon de regularisation. A defaut, le prix catalogue.
                    </p>
                  </>
                )}
              </div>
            )}
            {!ligne.id_ligne_bc && (
              <div className="sm:col-span-2 lg:col-span-4">
                <Alerte ton="alerte">
                  Aucune commande derriere cette ligne. Un bon sera cree en brouillon a
                  l'enregistrement, et devra etre valide puis envoye avant le controle qualite.
                </Alerte>
              </div>
            )}
          </div>
        )}

        {onglet === 'qualite' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Etiq>Statut qualite</Etiq>
              <Selecteur
                value={ligne.qualite}
                onChange={(e) => maj(ligne.cle, 'qualite', e.target.value)}
              >
                <option value="CONFORME">Conforme</option>
                <option value="QUARANTAINE">Quarantaine</option>
                <option value="NON_CONFORME">Non conforme</option>
              </Selecteur>
              {ligne.qualite !== 'CONFORME' && (
                <p className="mt-1 text-[11px] text-alerte">
                  Une ligne non conforme doit etre dirigee vers un magasin de quarantaine.
                </p>
              )}
            </div>
            <div>
              <Etiq>Observations</Etiq>
              <Champ
                value={ligne.notes}
                onChange={(e) => maj(ligne.cle, 'notes', e.target.value)}
                placeholder="Emballage abime, couleur douteuse…"
              />
            </div>
            {ligne.code_recu !== ligne.code_reference && (
              <div className="sm:col-span-2">
                <Alerte ton="alerte" titre="Substitution">
                  Le fournisseur livre <strong>{ligne.code_recu}</strong> a la place de{' '}
                  <strong>{ligne.code_reference}</strong>. Les deux appartiennent au meme groupe
                  d'equivalence. La ligne de commande sera soldee en kg, et l'ecart restera trace.
                </Alerte>
                <div className="mt-2">
                  <Etiq obligatoire>Motif de la substitution</Etiq>
                  <Champ
                    value={ligne.motif_substitution}
                    onChange={(e) => maj(ligne.cle, 'motif_substitution', e.target.value)}
                    placeholder="Rupture chez le fournisseur, lot disponible…"
                    className={cn(!ligne.motif_substitution.trim() && 'border-danger')}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
}

function Info({
  libelle,
  valeur,
  complement,
  alerte,
}: {
  libelle: string
  valeur: string
  complement?: string
  alerte?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] text-attenue-texte">{libelle}</div>
      <div className={cn('mt-1 text-[15px] font-medium tabular-nums', alerte && 'text-danger')}>
        {valeur}
      </div>
      {complement && <div className="text-[11px] text-danger">{complement}</div>}
    </div>
  )
}

/**
 * Ajout d'un article qu'aucun bon ne couvre.
 *
 * Le cas est reel : reliquat, remplacement, envoi anticipe. On saisit ce qui est
 * la, et le serveur cree le bon manquant — la marchandise entre dans le systeme,
 * mais l'anomalie reste visible jusqu'a sa regularisation.
 */
function PanneauHorsCommande({
  voitPrix,
  surFermeture,
  surAjout,
}: {
  voitPrix: boolean
  surFermeture: () => void
  surAjout: (refs: { ref: RefCatalogue; qte: number }[]) => void
}) {
  const [filtre, setFiltre] = useState('')
  const [choix, setChoix] = useState<Record<string, string>>({})

  const q = useQuery({
    queryKey: ['catalogue-reception'],
    queryFn: () => api.get<RefCatalogue[]>('/api/catalogue?actif=1&limite=2000'),
  })

  const refs = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    const l = q.data ?? []
    if (!f) return l.slice(0, 40)
    return l
      .filter(
        (r) =>
          r.code_reference.toLowerCase().includes(f) ||
          (r.designation ?? '').toLowerCase().includes(f),
      )
      .slice(0, 40)
  }, [q.data, filtre])

  const retenues = Object.entries(choix).filter(([, v]) => Number(v) > 0)

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        cote="droite"
        titre="Article hors commande"
        description="La marchandise est au quai sans bon derriere elle. Saisissez-la : le bon manquant sera cree."
      >
        <div className="mb-2 flex items-center gap-2">
          <Search className="size-3.5 shrink-0 text-attenue-texte" />
          <Champ
            placeholder="Reference ou designation…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            className="h-8"
            autoFocus
          />
        </div>

        {q.isLoading && <Chargement texte="Lecture du catalogue…" />}

        {!q.isLoading && refs.length === 0 && (
          <Alerte ton="info">Aucune reference ne correspond.</Alerte>
        )}

        <div className="space-y-1">
          {refs.map((r) => (
            <div
              key={r.code_reference}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius)] border p-2',
                Number(choix[r.code_reference]) > 0
                  ? 'border-primaire bg-primaire/5'
                  : 'border-bordure',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{r.code_reference}</span>
                  {r.suivi_lot === 1 && <Badge ton="info">lot obligatoire</Badge>}
                </div>
                <div className="truncate text-[11px] text-attenue-texte">{r.designation}</div>
                {voitPrix && r.prix_catalogue_kg != null && (
                  <div className="text-[11px] tabular-nums text-attenue-texte">
                    catalogue {fmt.nombre(r.prix_catalogue_kg, 4)} {r.code_devise_catalogue}/kg
                  </div>
                )}
              </div>
              <Champ
                type="number"
                step="any"
                min="0"
                placeholder="kg"
                value={choix[r.code_reference] ?? ''}
                onChange={(e) => setChoix((c) => ({ ...c, [r.code_reference]: e.target.value }))}
                className="h-8 w-28 text-right tabular-nums"
                aria-label={`Quantite pour ${r.code_reference}`}
              />
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-bordure bg-surface px-4 pt-3">
          <span className="text-[11px] text-attenue-texte">
            {retenues.length} article(s) — ajoutes a la grille, rien n'est encore enregistre
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton
              disabled={!retenues.length}
              onClick={() =>
                surAjout(
                  retenues.map(([code, v]) => ({
                    ref: (q.data ?? []).find((r) => r.code_reference === code)!,
                    qte: Number(v),
                  })),
                )
              }
            >
              <Plus />
              Ajouter {retenues.length || ''}
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

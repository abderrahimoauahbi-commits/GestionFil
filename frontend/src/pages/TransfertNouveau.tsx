/**
 * Saisie d'un transfert — en-tete ET lignes ensemble, a la creation comme a la
 * reprise.
 *
 * Un transfert est un DOCUMENT : deux magasins, une date, un responsable, et ce
 * qu'on charge. Le creer vide puis lui ajouter des lignes une par une laissait
 * des transferts sans contenu au milieu de la numerotation, et obligeait a
 * revenir dessus pour comprendre ce qu'ils portaient.
 *
 * Le meme ecran REPREND un brouillon : tant que rien n'est parti, une quantite
 * mal comptee ou une palette oubliee se corrigent ici. Passe l'expedition,
 * l'ecran devient consultatif — les mouvements sont au grand livre, que R03
 * rend immuable.
 *
 * Les lignes portent le CONDITIONNEMENT reellement charge — bobines, palettes —
 * en plus du poids. Ce n'est pas une conversion du kg : un camion emporte trois
 * palettes completes et quatre bobines isolees, et c'est ce decompte que le
 * magasin destinataire verifiera au dechargement.
 *
 * Rien ne part au serveur avant le clic final.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Plus, Save, Search, Trash2, XCircle } from 'lucide-react'
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
import { Dialogue, DialogueContenu, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'MOUVEMENTS'

interface RefStock extends Record<string, unknown> {
  code_reference: string
  designation: string
  code_magasin: string
  quantite_kg: number
  lot_fournisseur?: string | null
}

interface RefCatalogue extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  suivi_lot: number
}

/**
 * La ligne ne porte QUE ce que l'operateur saisit.
 *
 * Le poids d'une bobine, le suivi de lot, le stock disponible sont lus dans le
 * catalogue et dans le stock au moment de l'affichage. Les recopier ici les
 * figerait a l'instant du chargement : un brouillon repris trois jours plus tard
 * afficherait un stock qui n'existe plus.
 */
interface Ligne {
  cle: string
  code_reference: string
  designation: string
  quantite: string
  unite: string
  bobines: string
  palettes: string
  lot: string
}

interface DossierLigne extends Record<string, unknown> {
  ligne_numero: number
  code_reference: string
  designation: string
  quantite_kg: number
  quantite_saisie: number | null
  unite_saisie: string | null
  nb_bobines: number | null
  nb_palettes: number | null
  lot_fournisseur: string | null
}

interface DossierEntete extends Record<string, unknown> {
  numero_transfert: string
  statut: string
  code_magasin_source: string
  code_magasin_dest: string
  date_transfert: string
  responsable: string | null
  transporteur: string | null
  observations: string | null
}

export function TransfertNouveau() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const confirmation = useConfirmation()
  const { id } = useParams()
  const reprise = !!id

  const [entete, setEntete] = useState({
    code_magasin_source: '',
    code_magasin_dest: '',
    date_transfert: new Date().toISOString().slice(0, 10),
    responsable: '',
    transporteur: '',
    observations: '',
  })
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [ajout, setAjout] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // --- Reprise d'un brouillon ---------------------------------------------
  const qDossier = useQuery({
    queryKey: ['dossier-transfert', id],
    queryFn: () =>
      api.get<{ entete: DossierEntete; lignes: DossierLigne[] }>(`/api/transferts/${id}`),
    enabled: reprise,
    // Un document en cours de saisie ne se relit pas sous les doigts de celui
    // qui le remplit : un retour sur la fenetre relancerait la requete et
    // ecraserait ce qu'il vient de taper.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  // Le formulaire se remplit UNE FOIS depuis le serveur, a l'ouverture du
  // document. Le relier a chaque arrivee de donnees ferait de la saisie un
  // combat : chaque rafraichissement rendrait au champ sa valeur d'origine, et
  // la correction d'une faute de frappe semblerait simplement impossible.
  const rempli = useRef<string | null>(null)

  useEffect(() => {
    const d = qDossier.data
    if (!d?.entete || rempli.current === id) return
    rempli.current = id ?? null
    setEntete({
      code_magasin_source: d.entete.code_magasin_source ?? '',
      code_magasin_dest: d.entete.code_magasin_dest ?? '',
      date_transfert: (d.entete.date_transfert ?? '').slice(0, 10),
      responsable: d.entete.responsable ?? '',
      transporteur: d.entete.transporteur ?? '',
      observations: d.entete.observations ?? '',
    })
    setLignes(
      d.lignes.map((l) => ({
        cle: `l:${l.ligne_numero}`,
        code_reference: l.code_reference,
        designation: l.designation ?? '',
        // La quantite se reprend DANS L'UNITE SAISIE : reafficher des kg
        // obligerait a reconvertir de tete ce qui avait ete compte en bobines.
        quantite: String(l.quantite_saisie ?? l.quantite_kg),
        unite: l.unite_saisie ?? 'kg',
        bobines: l.nb_bobines != null ? String(l.nb_bobines) : '',
        palettes: l.nb_palettes != null ? String(l.nb_palettes) : '',
        lot: l.lot_fournisseur ?? '',
      })),
    )
  }, [qDossier.data, id])

  const statut = qDossier.data?.entete?.statut
  const parti = reprise && !!statut && statut !== 'BROUILLON'

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })

  // Ce que le magasin source a REELLEMENT en stock : on ne transfere pas ce
  // qu'on n'a pas, et R02 le refuserait de toute facon a l'expedition.
  const qStock = useQuery({
    queryKey: ['stock-magasin', entete.code_magasin_source],
    queryFn: () =>
      api.get<RefStock[]>(
        `/api/stock?code_magasin=${encodeURIComponent(entete.code_magasin_source)}&limite=2000`,
      ),
    enabled: !!entete.code_magasin_source,
  })

  const qCat = useQuery({
    queryKey: ['catalogue-transfert'],
    queryFn: () => api.get<RefCatalogue[]>('/api/catalogue?actif=1&limite=2000'),
  })

  const catalogue = useMemo(() => {
    const m = new Map<string, RefCatalogue>()
    for (const r of qCat.data ?? []) m.set(r.code_reference, r)
    return m
  }, [qCat.data])

  const disponibles = useMemo(
    () => (qStock.data ?? []).filter((s) => s.quantite_kg > 0.001),
    [qStock.data],
  )

  const stock = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of qStock.data ?? [])
      m.set(s.code_reference, (m.get(s.code_reference) ?? 0) + s.quantite_kg)
    return m
  }, [qStock.data])

  const dispoDe = (code: string) => stock.get(code) ?? 0

  const ajouter = (choix: { ref: RefStock; qte: number }[]) =>
    setLignes((l) => [
      ...l,
      ...choix.map<Ligne>(({ ref, qte }, i) => ({
        cle: `l:${Date.now()}:${i}`,
        code_reference: ref.code_reference,
        designation: ref.designation ?? catalogue.get(ref.code_reference)?.designation ?? '',
        quantite: String(qte),
        unite: 'kg',
        bobines: '',
        palettes: '',
        lot: ref.lot_fournisseur ?? '',
      })),
    ])

  const maj = (cle: string, champ: keyof Ligne, v: string) =>
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, [champ]: v } : x)))

  /** Conversion en kg, pour totaliser et alerter avant l'envoi. */
  const enKg = (l: Ligne) => {
    const q = Number(l.quantite) || 0
    const c = catalogue.get(l.code_reference)
    if (l.unite === 'Bobine') return q * (c?.poids_bobine_kg ?? 0)
    if (l.unite === 'Palette')
      return q * (c?.poids_bobine_kg ?? 0) * (c?.bobines_par_palette ?? 0)
    return q
  }

  const totalKg = lignes.reduce((s, l) => s + enKg(l), 0)
  const totalBobines = lignes.reduce((s, l) => s + (Number(l.bobines) || 0), 0)
  const totalPalettes = lignes.reduce((s, l) => s + (Number(l.palettes) || 0), 0)

  const sansQte = lignes.filter((l) => !(Number(l.quantite) > 0))
  const sansLot = lignes.filter(
    (l) => catalogue.get(l.code_reference)?.suivi_lot === 1 && !l.lot.trim(),
  )
  const auDela = lignes.filter((l) => enKg(l) > dispoDe(l.code_reference) + 0.001)
  const memeMagasin =
    !!entete.code_magasin_source && entete.code_magasin_source === entete.code_magasin_dest

  const pret =
    !parti &&
    !!entete.code_magasin_source &&
    !!entete.code_magasin_dest &&
    !memeMagasin &&
    lignes.length > 0 &&
    !sansQte.length &&
    !sansLot.length &&
    !auDela.length

  const charge = () => ({
    code_magasin_source: entete.code_magasin_source,
    code_magasin_dest: entete.code_magasin_dest,
    date_transfert: entete.date_transfert || undefined,
    responsable: entete.responsable || undefined,
    transporteur: entete.transporteur || undefined,
    observations: entete.observations || undefined,
    lignes: lignes.map((l) => ({
      code_reference: l.code_reference,
      quantite_saisie: Number(l.quantite),
      unite_saisie: l.unite,
      lot_fournisseur: l.lot || undefined,
      nb_bobines: l.bobines ? Number(l.bobines) : undefined,
      nb_palettes: l.palettes ? Number(l.palettes) : undefined,
    })),
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['transferts'] })
    if (id) void qc.invalidateQueries({ queryKey: ['dossier-transfert', id] })
  }

  const echec = (e: unknown) =>
    setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.')

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_transfert: string; numero_transfert: string; lignes: number }>(
        '/api/transferts',
        charge(),
      ),
    onSuccess: (r) => {
      toast.success(`${r.numero_transfert} cree`, {
        description:
          `${r.lignes} ligne(s). Rien n'a encore bouge : la marchandise quittera le magasin ` +
          `source a l'expedition.`,
        duration: 8000,
      })
      rafraichir()
      naviguer('/transferts')
    },
    onError: echec,
  })

  const enregistrer = useMutation({
    mutationFn: () => api.put<{ lignes: number }>(`/api/transferts/${id}`, charge()),
    onSuccess: (r) => {
      toast.success(`${qDossier.data?.entete.numero_transfert} mis a jour`, {
        description: `${r.lignes} ligne(s). Le document reste en preparation.`,
        duration: 6000,
      })
      rafraichir()
      naviguer('/transferts')
    },
    onError: echec,
  })

  const abandonner = useMutation({
    mutationFn: () => api.delete(`/api/transferts/${id}`),
    onSuccess: () => {
      toast.success('Transfert abandonne', {
        description:
          `Le document garde son numero, marque « annule » : un trou dans la ` +
          `numerotation ne se comprend plus des semaines apres.`,
        duration: 8000,
      })
      rafraichir()
      naviguer('/transferts')
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Abandon impossible.'),
  })

  if (reprise && qDossier.isLoading) return <Chargement texte="Lecture du transfert…" />
  if (reprise && !qDossier.data?.entete) {
    return (
      <div>
        <EnTetePage titre="Transfert" description="Introuvable." />
        <Alerte ton="alerte">
          Ce transfert n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/transferts')}>
            Revenir a la liste
          </button>
        </Alerte>
      </div>
    )
  }

  const enCours = creer.isPending || enregistrer.isPending

  return (
    <div>
      <EnTetePage
        titre={reprise ? `Transfert ${qDossier.data?.entete.numero_transfert}` : 'Nouveau transfert'}
        description={
          parti
            ? "Ce transfert est parti : son contenu ne se modifie plus."
            : "En-tete et lignes saisis ensemble. Le document ne bouge aucun stock : c'est l'expedition qui sort la marchandise."
        }
        actions={
          <>
            {reprise && !parti && droits.peutEcrire && (
              <Bouton
                variante="contour"
                className="text-danger"
                onClick={() =>
                  confirmation.demander({
                    titre: 'Abandonner ce transfert ?',
                    description:
                      "Le document restera visible, marque « annule ». Aucun stock n'a bouge, " +
                      "rien n'est donc a rattraper.",
                    libelleConfirmer: 'Abandonner',
                    destructif: true,
                    action: () => abandonner.mutate(),
                  })
                }
              >
                <XCircle />
                Abandonner
              </Bouton>
            )}
            <Bouton variante="contour" onClick={() => naviguer('/transferts')}>
              <ArrowLeft />
              Retour
            </Bouton>
          </>
        }
      />

      {parti && (
        <Alerte ton="info" titre="Document fige" className="mb-3">
          La marchandise a quitte le magasin source : ses mouvements sont inscrits au grand livre,
          que R03 rend immuable. Un ecart constate a l'arrivee se regularise par un inventaire, pas
          en retouchant le bon.
        </Alerte>
      )}

      {erreur && (
        <Alerte ton="danger" titre="Enregistrement refuse" className="mb-3">
          {erreur}
        </Alerte>
      )}

      <fieldset disabled={parti} className="contents">
        <div className="space-y-3">
          <Carte>
            <CarteEntete>
              <CarteTitre>En-tete</CarteTitre>
            </CarteEntete>
            <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Etiq htmlFor="src" obligatoire>
                  Magasin source
                </Etiq>
                <Selecteur
                  id="src"
                  value={entete.code_magasin_source}
                  onChange={(e) => {
                    // Changer de magasin source invalide ce qui a ete charge :
                    // ces references ne sont pas forcement en stock ailleurs.
                    setEntete({ ...entete, code_magasin_source: e.target.value })
                    setLignes([])
                  }}
                >
                  <option value="">Choisir…</option>
                  {qMag.data?.map((m) => (
                    <option key={m.code_magasin} value={m.code_magasin}>
                      {m.nom}
                    </option>
                  ))}
                </Selecteur>
              </div>
              <div>
                <Etiq htmlFor="dst" obligatoire>
                  Magasin destinataire
                </Etiq>
                <Selecteur
                  id="dst"
                  value={entete.code_magasin_dest}
                  onChange={(e) => setEntete({ ...entete, code_magasin_dest: e.target.value })}
                  className={cn(memeMagasin && 'border-danger')}
                >
                  <option value="">Choisir…</option>
                  {qMag.data?.map((m) => (
                    <option key={m.code_magasin} value={m.code_magasin}>
                      {m.nom}
                    </option>
                  ))}
                </Selecteur>
                {memeMagasin && (
                  <p className="mt-1 text-[11px] text-danger">
                    Source et destination doivent differer.
                  </p>
                )}
              </div>
              <div>
                <Etiq htmlFor="dt">Date du document</Etiq>
                <Champ
                  id="dt"
                  type="date"
                  value={entete.date_transfert}
                  onChange={(e) => setEntete({ ...entete, date_transfert: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-attenue-texte">
                  La date de sortie sera celle de l'expedition, la date d'arrivee celle de la
                  reception.
                </p>
              </div>
              <div>
                <Etiq htmlFor="resp">Responsable</Etiq>
                <Champ
                  id="resp"
                  value={entete.responsable}
                  onChange={(e) => setEntete({ ...entete, responsable: e.target.value })}
                  placeholder="Qui repond de la marchandise en route"
                />
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
                <Etiq htmlFor="obs">Observations</Etiq>
                <Champ
                  id="obs"
                  value={entete.observations}
                  onChange={(e) => setEntete({ ...entete, observations: e.target.value })}
                />
              </div>
            </CarteCorps>
          </Carte>

          {!entete.code_magasin_source ? (
            <Alerte ton="info">
              Choisissez le magasin source : seules ses references en stock pourront etre chargees.
            </Alerte>
          ) : (
            <Carte>
              <CarteEntete>
                <CarteTitre>
                  Lignes{lignes.length > 0 && ` (${lignes.length})`}
                  {entete.code_magasin_dest && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[12px] font-normal text-attenue-texte">
                      {entete.code_magasin_source}
                      <ArrowRight className="size-3" />
                      {entete.code_magasin_dest}
                    </span>
                  )}
                </CarteTitre>
                {!parti && (
                  <Bouton variante="contour" taille="sm" onClick={() => setAjout(true)}>
                    <Plus />
                    Charger une reference
                  </Bouton>
                )}
              </CarteEntete>
              <CarteCorps className="p-0">
                {lignes.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-attenue-texte">
                    Aucune ligne. Chargez ce que le camion emporte.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                          <th className="w-10 px-1 py-2 text-right">#</th>
                          <th className="px-2 py-2 text-left">Reference</th>
                          <th className="w-28 px-2 py-2 text-right">Dispo</th>
                          <th className="w-28 px-2 py-2 text-right">Quantite</th>
                          <th className="w-24 px-2 py-2 text-left">Unite</th>
                          <th className="w-24 px-2 py-2 text-right">En kg</th>
                          <th className="w-24 px-2 py-2 text-right">Bobines</th>
                          <th className="w-24 px-2 py-2 text-right">Palettes</th>
                          <th className="w-36 px-2 py-2 text-left">Lot fournisseur</th>
                          <th className="w-10 px-1 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lignes.map((l, i) => {
                          const c = catalogue.get(l.code_reference)
                          const dispo = dispoDe(l.code_reference)
                          const kg = enKg(l)
                          const trop = kg > dispo + 0.001
                          const manqueLot = c?.suivi_lot === 1 && !l.lot.trim()
                          return (
                            <tr key={l.cle} className="border-b border-bordure/60">
                              <td className="px-1 py-1 text-right tabular-nums text-attenue-texte">
                                {i + 1}
                              </td>
                              <td className="max-w-56 px-2 py-1">
                                <div className="truncate font-medium">{l.code_reference}</div>
                                <div className="truncate text-[11px] text-attenue-texte">
                                  {l.designation}
                                </div>
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-attenue-texte">
                                {fmt.nombre(dispo, 0)} kg
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  type="number"
                                  step="any"
                                  min="0.0001"
                                  value={l.quantite}
                                  onChange={(e) => maj(l.cle, 'quantite', e.target.value)}
                                  className={cn(
                                    'h-7 text-right tabular-nums',
                                    (trop || !(Number(l.quantite) > 0)) && 'border-danger',
                                  )}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Selecteur
                                  value={l.unite}
                                  onChange={(e) => maj(l.cle, 'unite', e.target.value)}
                                  className="h-7"
                                >
                                  <option value="kg">kg</option>
                                  {c?.poids_bobine_kg != null && (
                                    <option value="Bobine">Bobine</option>
                                  )}
                                  {c?.poids_bobine_kg != null && c?.bobines_par_palette != null && (
                                    <option value="Palette">Palette</option>
                                  )}
                                </Selecteur>
                              </td>
                              <td
                                className={cn(
                                  'px-2 py-1 text-right tabular-nums',
                                  trop && 'font-medium text-danger',
                                )}
                              >
                                {fmt.nombre(kg, 1)}
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  type="number"
                                  min="0"
                                  value={l.bobines}
                                  onChange={(e) => maj(l.cle, 'bobines', e.target.value)}
                                  className="h-7 text-right tabular-nums"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  type="number"
                                  min="0"
                                  value={l.palettes}
                                  onChange={(e) => maj(l.cle, 'palettes', e.target.value)}
                                  className="h-7 text-right tabular-nums"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Champ
                                  value={l.lot}
                                  onChange={(e) => maj(l.cle, 'lot', e.target.value)}
                                  className={cn('h-7', manqueLot && 'border-danger')}
                                  placeholder={c?.suivi_lot === 1 ? 'obligatoire' : ''}
                                />
                              </td>
                              <td className="px-1 py-1">
                                {!parti && (
                                  <Bouton
                                    variante="discret"
                                    taille="icone-xs"
                                    className="text-danger hover:bg-danger/10"
                                    onClick={() =>
                                      setLignes((x) => x.filter((y) => y.cle !== l.cle))
                                    }
                                    aria-label="Retirer"
                                  >
                                    <Trash2 />
                                  </Bouton>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-bordure font-medium">
                          <td colSpan={5} className="px-2 py-2 text-right">
                            Total charge
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {fmt.nombre(totalKg, 1)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {totalBobines || '—'}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {totalPalettes || '—'}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CarteCorps>
            </Carte>
          )}
        </div>
      </fieldset>

      {entete.code_magasin_source && !parti && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            {lignes.length === 0 ? (
              <span className="text-attenue-texte">Aucune ligne chargee.</span>
            ) : (
              <>
                <span className="font-medium">{lignes.length} ligne(s)</span>
                <span className="text-attenue-texte"> · </span>
                <span className="font-semibold tabular-nums">{fmt.nombre(totalKg, 1)} kg</span>
                {totalPalettes > 0 && (
                  <span className="text-attenue-texte"> · {totalPalettes} palette(s)</span>
                )}
                {totalBobines > 0 && (
                  <span className="text-attenue-texte"> · {totalBobines} bobine(s)</span>
                )}
                {auDela.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    — au-dela du stock disponible : {auDela.map((l) => l.code_reference).join(', ')}
                  </span>
                )}
                {sansLot.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    — lot obligatoire : {sansLot.map((l) => l.code_reference).join(', ')}
                  </span>
                )}
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={() => naviguer('/transferts')}>
              Annuler
            </Bouton>
            <Bouton
              onClick={() => {
                setErreur(null)
                if (reprise) enregistrer.mutate()
                else creer.mutate()
              }}
              chargement={enCours}
              disabled={!pret || !droits.peutEcrire}
            >
              <Save />
              {reprise ? 'Enregistrer les modifications' : 'Enregistrer le transfert'}
            </Bouton>
          </div>
        </div>
      )}

      {ajout && (
        <PanneauChargement
          references={disponibles}
          deja={lignes.map((l) => l.code_reference)}
          chargement={qStock.isLoading}
          surFermeture={() => setAjout(false)}
          surChoix={(c) => {
            ajouter(c)
            setAjout(false)
          }}
        />
      )}

      {confirmation.element}
    </div>
  )
}

/** Ce que le magasin source peut reellement fournir. */
function PanneauChargement({
  references,
  deja,
  chargement,
  surFermeture,
  surChoix,
}: {
  references: RefStock[]
  deja: string[]
  chargement: boolean
  surFermeture: () => void
  surChoix: (c: { ref: RefStock; qte: number }[]) => void
}) {
  const [filtre, setFiltre] = useState('')
  const [choix, setChoix] = useState<Record<string, string>>({})

  const liste = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    return references
      .filter((r) => !deja.includes(r.code_reference))
      .filter(
        (r) =>
          !f ||
          r.code_reference.toLowerCase().includes(f) ||
          (r.designation ?? '').toLowerCase().includes(f),
      )
      .slice(0, 60)
  }, [references, deja, filtre])

  const retenues = Object.entries(choix).filter(([, v]) => Number(v) > 0)

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        cote="droite"
        titre="Charger des references"
        description="Seul ce que le magasin source a en stock peut partir."
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

        {chargement && <Chargement texte="Lecture du stock…" />}

        {!chargement && liste.length === 0 && (
          <Alerte ton="info">
            Aucune reference disponible dans ce magasin pour ce filtre.
          </Alerte>
        )}

        <div className="space-y-1">
          {liste.map((r) => (
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
                  <Badge ton="neutre">{fmt.nombre(r.quantite_kg, 0)} kg</Badge>
                </div>
                <div className="truncate text-[11px] text-attenue-texte">{r.designation}</div>
              </div>
              <Champ
                type="number"
                step="any"
                min="0"
                max={r.quantite_kg}
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
            {retenues.length} reference(s) — ajoutees au document, rien n est enregistre
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton
              disabled={!retenues.length}
              onClick={() =>
                surChoix(
                  retenues.map(([code, v]) => ({
                    ref: references.find((r) => r.code_reference === code)!,
                    qte: Number(v),
                  })),
                )
              }
            >
              <Plus />
              Charger {retenues.length || ''}
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

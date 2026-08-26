/**
 * Grand livre des mouvements et saisie.
 *
 * Concu tablette d'abord : c'est un ecran de magasin. La quantite se saisit
 * dans l'unite de manutention (bobine, palette, ml) et la conversion vers le kg
 * est affichee AVANT validation — l'operateur doit voir ce qui va reellement
 * entrer en stock.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  PanneauFiltres,
  useFiltres,
  type ChampFiltre,
} from '../composants/PanneauFiltres'

import { Panneau } from '../components/Formulaire'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { Bouton, Etiquette, Message, fmt } from '../components/ui'

const MODULE = 'MOUVEMENTS'

interface LigneLivre extends Record<string, unknown> {
  numero_mouvement: string
  date_mouvement: string
  code_type_mvt: string
  code_magasin: string
  code_reference: string
  quantite_kg: number
  prix_kg_mad?: number | null
  total_mad?: number
  lot_fournisseur: string | null
  numero_of: string | null
  utilisateur: string
  signe: number
}

/**
 * Le grand livre est immuable : on ne le corrige pas, on l'interroge.
 *
 * Les valeurs des listes sortent des lignes affichees : un magasin sans
 * mouvement ne figure pas au filtre, puisque le choisir ne montrerait rien.
 */
const CHAMPS_MVT: ChampFiltre<LigneLivre>[] = [
  { cle: 'periode', libelle: 'Periode', type: 'periode', valeur: (l) => l.date_mouvement },
  { cle: 'type', libelle: 'Type', type: 'liste', valeur: (l) => l.code_type_mvt },
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (l) => l.code_magasin },
  { cle: 'reference', libelle: 'Reference', type: 'liste', valeur: (l) => l.code_reference },
  { cle: 'lot', libelle: 'Lot', type: 'texte', valeur: (l) => l.lot_fournisseur },
  { cle: 'of', libelle: "N° d'OF", type: 'texte', valeur: (l) => l.numero_of },
  { cle: 'utilisateur', libelle: 'Saisi par', type: 'liste', valeur: (l) => l.utilisateur },
]

interface TypeMvt {
  code_type_mvt: string
  libelle: string
  signe: number
  exige_prix: number
  exige_of: number
  exige_motif_ligne: number
}

interface RefCatalogue {
  code_reference: string
  designation: string
  unite_catalogue: string
  facteur_kg: number | null
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  densite_kg_ml: number | null
  suivi_lot: number
}

interface Saisie {
  code_reference: string
  quantite_saisie: string
  unite_saisie: string
  prix_kg_mad: string
  lot_fournisseur: string
  code_motif_ligne: string
}

const LIGNE_VIDE: Saisie = {
  code_reference: '',
  quantite_saisie: '',
  unite_saisie: 'kg',
  prix_kg_mad: '',
  lot_fournisseur: '',
  code_motif_ligne: '',
}

/** Facteur de conversion vers le kg, ou null si la reference ne le permet pas. */
function facteur(r: RefCatalogue | undefined, unite: string): number | null {
  if (!r) return null
  switch (unite) {
    case 'kg':
      return 1
    case 'Bobine':
      return r.poids_bobine_kg && r.poids_bobine_kg > 0 ? r.poids_bobine_kg : null
    case 'Palette':
      return r.poids_bobine_kg && r.bobines_par_palette
        ? r.poids_bobine_kg * r.bobines_par_palette
        : null
    case 'ml':
      return r.densite_kg_ml && r.densite_kg_ml > 0 ? r.densite_kg_ml : null
    default:
      return null
  }
}

export function Mouvements() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const [saisieOuverte, setSaisieOuverte] = useState(false)
  const [filtreRef, setFiltreRef] = useState('')
  const [sens, setSens] = useState('')
  const filtres = useFiltres(CHAMPS_MVT)

  const params = new URLSearchParams({ limite: '300' })
  if (filtreRef) params.set('code_reference', filtreRef)

  const qLivre = useQuery({
    queryKey: ['mouvements', filtreRef],
    queryFn: () => api.get<LigneLivre[]>(`/api/mouvements?${params}`),
  })

  const colonnes: Colonne<LigneLivre>[] = [
    {
      champ: 'date_mouvement',
      entete: 'Date',
      rendu: (l) => fmt.date(l.date_mouvement),
    },
    {
      champ: 'numero_mouvement',
      entete: 'Numero',
      rendu: (l) => <span className="font-mono text-xs">{l.numero_mouvement}</span>,
      secondaire: true,
    },
    {
      champ: 'code_type_mvt',
      entete: 'Type',
      rendu: (l) => (
        <Etiquette ton={l.signe > 0 ? 'vert' : 'ambre'}>
          {l.signe > 0 ? '+' : '−'} {l.code_type_mvt}
        </Etiquette>
      ),
    },
    { champ: 'code_reference', entete: 'Reference' },
    { champ: 'code_magasin', entete: 'Magasin' },
    {
      champ: 'quantite_kg',
      entete: 'Quantite (kg)',
      numerique: true,
      rendu: (l) => (
        <span className={l.signe > 0 ? 'text-emerald-700' : 'text-alerte'}>
          {l.signe > 0 ? '+' : '−'}
          {fmt.nombre(l.quantite_kg, 2)}
        </span>
      ),
    },
    {
      champ: 'prix_kg_mad',
      entete: 'Prix (MAD/kg)',
      numerique: true,
      rendu: (l) => (l.prix_kg_mad == null ? '—' : fmt.nombre(l.prix_kg_mad, 4)),
    },
    {
      champ: 'total_mad',
      entete: 'Total',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.total_mad ? fmt.mad(l.total_mad) : '—'),
    },
    { champ: 'lot_fournisseur', entete: 'Lot', rendu: (l) => fmt.texte(l.lot_fournisseur) },
    { champ: 'numero_of', entete: 'OF', rendu: (l) => fmt.texte(l.numero_of), secondaire: true },
    { champ: 'utilisateur', entete: 'Par', secondaire: true },
  ]

  const toutesLignes = qLivre.data ?? []

  // Les compteurs se lisent sur le jeu ramene, avant le rail : ils disent ce que
  // chaque choix montrera, et ne suivent donc pas le choix en cours.
  const comptesMvt = toutesLignes.reduce<Record<string, number>>((m, l) => {
    const c = l.signe > 0 ? 'ENTREE' : 'SORTIE'
    m[c] = (m[c] ?? 0) + 1
    m[`T:${l.code_type_mvt}`] = (m[`T:${l.code_type_mvt}`] ?? 0) + 1
    return m
  }, {})

  const typesPresents = [...new Set(toutesLignes.map((l) => l.code_type_mvt))].sort()

  const groupesMvt: GroupeRail[] = [
    {
      entrees: [
        { cle: '', libelle: 'Tous les mouvements', compte: toutesLignes.length },
      ],
    },
    {
      titre: 'Par sens',
      entrees: [
        {
          cle: 'ENTREE',
          libelle: 'Entrees',
          resume: 'Le stock monte',
          compte: comptesMvt.ENTREE ?? 0,
          ton: 'succes' as const,
        },
        {
          cle: 'SORTIE',
          libelle: 'Sorties',
          resume: 'Le stock descend',
          compte: comptesMvt.SORTIE ?? 0,
          ton: 'alerte' as const,
        },
      ],
    },
    {
      titre: 'Par type',
      entrees: typesPresents.map((t) => ({
        cle: `T:${t}`,
        libelle: t,
        compte: comptesMvt[`T:${t}`] ?? 0,
      })),
    },
  ]

  const lignesSens = toutesLignes.filter((l) => {
    if (!sens) return true
    if (sens.startsWith('T:')) return l.code_type_mvt === sens.slice(2)
    return sens === 'ENTREE' ? l.signe > 0 : l.signe < 0
  })
  const lignesVues = lignesSens.filter(filtres.retenir)

  return (
    <div>
      <EnTetePage
        titre="Mouvements de stock"
        sous_titre="Grand livre immuable : une correction se fait par un mouvement inverse"
        actions={
          droits.peutEcrire && (
            <Bouton onClick={() => setSaisieOuverte(true)}>Saisir un mouvement</Bouton>
          )
        }
      />

      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral
              groupes={groupesMvt}
              actif={sens}
              surChoix={setSens}
              recherche={{
                valeur: filtreRef,
                surChangement: setFiltreRef,
                placeholder: 'Reference exacte…',
              }}
            />
            <PanneauFiltres
              champs={CHAMPS_MVT}
              lignes={lignesSens}
              valeurs={filtres.valeurs}
              definir={filtres.definir}
              reinitialiser={filtres.reinitialiser}
              actifs={filtres.actifs}
            />
          </div>
        }
      >
        {(filtres.actifs > 0 || sens) && (
          <div className="mb-2 text-[12px] text-attenue-texte">
            {lignesVues.length} ligne(s) sur {toutesLignes.length} apres filtrage.
          </div>
        )}
        <TableDroits
          module={MODULE}
          colonnes={colonnes}
          lignes={lignesVues}
          chargement={qLivre.isLoading}
          cle={(l) => `${l.numero_mouvement}-${l.code_reference}-${l.quantite_kg}`}
          titreCarte={(l) => `${l.code_reference} · ${l.code_type_mvt}`}
          texteVide="Aucun mouvement."
        />
      </PageAvecRail>

      {saisieOuverte && (
        <SaisieMouvement
          surFermeture={() => setSaisieOuverte(false)}
          surSucces={() => {
            setSaisieOuverte(false)
            void qc.invalidateQueries({ queryKey: ['mouvements'] })
            void qc.invalidateQueries({ queryKey: ['stock-projete'] })
            void qc.invalidateQueries({ queryKey: ['cockpit'] })
          }}
        />
      )}
    </div>
  )
}

function SaisieMouvement({
  surFermeture,
  surSucces,
}: {
  surFermeture: () => void
  surSucces: () => void
}) {
  const [entete, setEntete] = useState({
    code_type_mvt: '',
    code_magasin: '',
    code_motif: '',
    numero_of: '',
    observations_globales: '',
  })
  const [lignes, setLignes] = useState<Saisie[]>([{ ...LIGNE_VIDE }])
  const [erreur, setErreur] = useState<string | null>(null)

  // Le stock disponible par reference. Sur une SORTIE, c'est lui qui dit si la
  // saisie passera : R02 refuse un stock negatif, et decouvrir le refus a
  // l'enregistrement fait perdre tout le formulaire.
  const qStock = useQuery({
    queryKey: ['stock-projete-mvt'],
    queryFn: () =>
      api.get<{ code_reference: string; stock_mrp_kg: number }[]>('/api/stock/projete'),
  })
  const stockPar = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of qStock.data ?? []) m.set(x.code_reference, x.stock_mrp_kg ?? 0)
    return m
  }, [qStock.data])

  const qTypes = useQuery({
    queryKey: ['types-mouvement'],
    queryFn: async () => {
      // Le registre n'expose pas les types : ils viennent du referentiel.
      const r = await api.get<TypeMvt[]>('/api/types-mouvement')
      return r
    },
    retry: false,
  })
  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })
  const qMotifs = useQuery({
    queryKey: ['motifs-mouvement'],
    queryFn: () => api.get<{ code_motif: string; libelle: string }[]>('/api/motifs-mouvement'),
    retry: false,
  })
  const qRefs = useQuery({
    queryKey: ['catalogue-saisie'],
    queryFn: () => api.get<RefCatalogue[]>('/api/catalogue?actif=1&limite=2000'),
  })

  const typeActif = useMemo(
    () => qTypes.data?.find((t) => t.code_type_mvt === entete.code_type_mvt),
    [qTypes.data, entete.code_type_mvt],
  )

  const parReference = useMemo(() => {
    const m = new Map<string, RefCatalogue>()
    qRefs.data?.forEach((r) => m.set(r.code_reference, r))
    return m
  }, [qRefs.data])

  const enregistrer = useMutation({
    mutationFn: () =>
      api.post('/api/mouvements', {
        ...entete,
        numero_of: entete.numero_of || null,
        observations_globales: entete.observations_globales || null,
        lignes: lignes
          .filter((l) => l.code_reference && l.quantite_saisie)
          .map((l) => ({
            code_reference: l.code_reference,
            quantite_saisie: Number(l.quantite_saisie),
            unite_saisie: l.unite_saisie,
            prix_kg_mad: l.prix_kg_mad ? Number(l.prix_kg_mad) : null,
            lot_fournisseur: l.lot_fournisseur || null,
            code_motif_ligne: l.code_motif_ligne || null,
          })),
      }),
    onSuccess: surSucces,
    onError: (e) =>
      setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  const majLigne = (i: number, champ: keyof Saisie, valeur: string) =>
    setLignes((ls) => ls.map((l, k) => (k === i ? { ...l, [champ]: valeur } : l)))

  const champ =
    'w-full rounded-lg border border-champ px-3 py-2 text-sm outline-none focus:border-anneau'

  const pretes = lignes.filter((l) => l.code_reference && Number(l.quantite_saisie) > 0)
  const totalKg = pretes.reduce((s, l) => {
    const f = facteur(parReference.get(l.code_reference), l.unite_saisie)
    return s + (f ? Number(l.quantite_saisie) * f : 0)
  }, 0)

  return (
    <Panneau
      titre="Saisir un mouvement"
      sous_titre="La quantite est convertie en kilogrammes avant enregistrement"
      surFermeture={surFermeture}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setErreur(null)
          enregistrer.mutate()
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Type de mouvement <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={entete.code_type_mvt}
              onChange={(e) => setEntete({ ...entete, code_type_mvt: e.target.value })}
              className={champ}
            >
              <option value="">—</option>
              {qTypes.data?.map((t) => (
                <option key={t.code_type_mvt} value={t.code_type_mvt}>
                  {t.signe > 0 ? '+ ' : '− '}
                  {t.libelle}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Magasin <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={entete.code_magasin}
              onChange={(e) => setEntete({ ...entete, code_magasin: e.target.value })}
              className={champ}
            >
              <option value="">—</option>
              {qMag.data?.map((m) => (
                <option key={m.code_magasin} value={m.code_magasin}>
                  {m.nom}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Motif <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={entete.code_motif}
              onChange={(e) => setEntete({ ...entete, code_motif: e.target.value })}
              className={champ}
            >
              <option value="">—</option>
              {qMotifs.data?.map((m) => (
                <option key={m.code_motif} value={m.code_motif}>
                  {m.libelle}
                </option>
              ))}
            </select>
          </div>

          {typeActif?.exige_of === 1 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-texte">
                Numero d ordre de fabrication <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={entete.numero_of}
                onChange={(e) => setEntete({ ...entete, numero_of: e.target.value })}
                className={champ}
              />
            </div>
          )}
        </div>

        {/* --- Lignes ------------------------------------------------------ */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-texte">Lignes</span>
            <button
              type="button"
              onClick={() => setLignes((l) => [...l, { ...LIGNE_VIDE }])}
              className="rounded border border-champ px-2 py-1 text-xs text-texte hover:bg-attenue"
            >
              + Ajouter une ligne
            </button>
          </div>

          {lignes.map((l, i) => {
            const r = parReference.get(l.code_reference)
            const f = facteur(r, l.unite_saisie)
            const kg = f && l.quantite_saisie ? Number(l.quantite_saisie) * f : null

            // Sur une sortie, la quantite demandee depasse-t-elle le stock ?
            const type = qTypes.data?.find((t) => t.code_type_mvt === entete.code_type_mvt)
            const sortie = (type?.signe ?? 1) < 0
            const dispo = stockPar.get(l.code_reference)
            const manque =
              sortie && dispo != null && kg != null && kg > dispo ? kg - dispo : null

            return (
              <div key={i} className="rounded-lg border border-bordure bg-attenue p-3">
                <div className="grid gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <input
                      list="refs"
                      placeholder="Reference"
                      value={l.code_reference}
                      onChange={(e) => majLigne(i, 'code_reference', e.target.value)}
                      className={champ}
                    />
                    {sortie && dispo != null && (
                      <div className="mt-0.5 text-[11px] text-attenue-texte">
                        Stock disponible{' '}
                        <span className="tabular-nums">{fmt.nombre(dispo, 0)} kg</span>
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Quantite"
                      value={l.quantite_saisie}
                      onChange={(e) => majLigne(i, 'quantite_saisie', e.target.value)}
                      className={champ}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <select
                      value={l.unite_saisie}
                      onChange={(e) => majLigne(i, 'unite_saisie', e.target.value)}
                      className={champ}
                    >
                      <option value="kg">kg</option>
                      <option value="Bobine">Bobine</option>
                      <option value="Palette">Palette</option>
                      <option value="ml">ml</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-end sm:col-span-1">
                    {lignes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLignes((ls) => ls.filter((_, k) => k !== i))}
                        className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
                        aria-label="Retirer la ligne"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {typeActif?.exige_prix === 1 && (
                    <div className="sm:col-span-4">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Prix MAD/kg"
                        value={l.prix_kg_mad}
                        onChange={(e) => majLigne(i, 'prix_kg_mad', e.target.value)}
                        className={champ}
                      />
                    </div>
                  )}
                  {r?.suivi_lot === 1 && (
                    <div className="sm:col-span-4">
                      <input
                        placeholder="Lot fournisseur (obligatoire)"
                        value={l.lot_fournisseur}
                        onChange={(e) => majLigne(i, 'lot_fournisseur', e.target.value)}
                        className={champ}
                      />
                    </div>
                  )}
                  {typeActif?.exige_motif_ligne === 1 && (
                    <div className="sm:col-span-4">
                      <input
                        placeholder="Motif (R1 a R6)"
                        value={l.code_motif_ligne}
                        onChange={(e) => majLigne(i, 'code_motif_ligne', e.target.value)}
                        className={champ}
                      />
                    </div>
                  )}
                </div>

                {/* Conversion affichee avant enregistrement : l'operateur doit
                    voir ce qui entrera reellement en stock. */}
                {l.code_reference && (
                  <div className="mt-2 text-xs">
                    {f === null ? (
                      <span className="text-red-600">
                        Conversion impossible : facteur absent pour cette unite. La saisie sera
                        refusee.
                      </span>
                    ) : (
                      <span className="text-attenue-texte">
                        {r?.designation} · 1 {l.unite_saisie} = {f} kg
                        {kg !== null && (
                          <strong className="ml-1 text-texte">
                            → {fmt.nombre(kg, 3)} kg
                          </strong>
                        )}
                      </span>
                    )}
                  </div>
                )}

                {manque != null && (
                  <EquivalentsDispo
                    reference={l.code_reference}
                    manque={manque}
                    surChoix={(code) => majLigne(i, 'code_reference', code)}
                  />
                )}
              </div>
            )
          })}

          <datalist id="refs">
            {qRefs.data?.map((r) => (
              <option key={r.code_reference} value={r.code_reference}>
                {r.designation}
              </option>
            ))}
          </datalist>
        </div>

        {pretes.length > 0 && (
          <Message ton="info">
            {pretes.length} ligne(s) · total <strong>{fmt.nombre(totalKg, 3)} kg</strong>
          </Message>
        )}
        {erreur && <Message ton="erreur">{erreur}</Message>}

        <div className="flex justify-end gap-2">
          <Bouton type="button" variante="secondaire" onClick={surFermeture}>
            Annuler
          </Bouton>
          <Bouton type="submit" disabled={enregistrer.isPending || pretes.length === 0}>
            {enregistrer.isPending ? 'Enregistrement...' : 'Enregistrer le mouvement'}
          </Bouton>
        </div>
      </form>
    </Panneau>
  )
}

/**
 * Les equivalents disponibles, quand le stock demande manque.
 *
 * L'ecran PROPOSE, il ne contourne rien : R02 reste porte par les triggers, et
 * une sortie superieure au stock sera refusee quoi qu'il arrive. Ce qui change,
 * c'est le moment ou l'atelier l'apprend — devant le formulaire, avec la
 * solution a portee de clic, plutot qu'apres un refus sec.
 *
 * Le stock affiche est le TOTAL toutes zones MRP confondues. Il ne garantit pas
 * que la matiere soit dans le magasin choisi : c'est une piste, pas une
 * promesse, et le dire evite de faire croire a une reservation.
 */
function EquivalentsDispo({
  reference,
  manque,
  surChoix,
}: {
  reference: string
  manque: number
  surChoix: (code: string) => void
}) {
  const q = useQuery({
    queryKey: ['equivalences', reference],
    queryFn: () =>
      api.get<
        {
          equivalent_reference: string
          equivalent_designation: string
          equivalent_stock_kg: number
          interchangeable: number
        }[]
      >(`/api/equivalences?code_reference=${encodeURIComponent(reference)}`),
    enabled: !!reference,
  })

  const utiles = (q.data ?? []).filter(
    (e) => e.interchangeable === 1 && e.equivalent_stock_kg > 0,
  )

  return (
    <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
      <div className="text-[12px] font-medium text-red-700 dark:text-red-300">
        Stock insuffisant : il manque {fmt.nombre(manque, 0)} kg.
      </div>

      {utiles.length === 0 ? (
        <div className="mt-1 text-[11px] text-attenue-texte">
          Aucune reference equivalente ne dispose de stock. La sortie sera refusee (R02) :
          reduisez la quantite, ou approvisionnez d'abord.
        </div>
      ) : (
        <>
          <div className="mt-1 text-[11px] text-attenue-texte">
            Ces references sont declarees interchangeables avec celle-ci et ont du stock. Le total
            est toutes zones confondues : verifiez qu'il est bien dans votre magasin.
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {utiles.map((e) => (
              <button
                key={e.equivalent_reference}
                type="button"
                onClick={() => surChoix(e.equivalent_reference)}
                className="rounded border border-bordure bg-surface px-2 py-1 text-left text-[11px] hover:border-primaire"
                title={e.equivalent_designation}
              >
                <span className="font-medium">{e.equivalent_reference}</span>
                <span className="ml-1.5 tabular-nums text-attenue-texte">
                  {fmt.nombre(e.equivalent_stock_kg, 0)} kg
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

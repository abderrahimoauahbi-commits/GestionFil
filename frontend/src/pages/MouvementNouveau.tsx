/**
 * SAISIR UN MOUVEMENT — un ecran, pas une fenetre.
 *
 * Un mouvement est un DOCUMENT : un en-tete — type, motif, magasin, date, qui
 * remet la marchandise — et des lignes. Il se saisissait jusqu'ici dans une
 * fenetre modale, ou ni l'en-tete ni la grille ne tiennent : on ne relit pas ce
 * qu'on tape, et l'on valide sans avoir vu l'ensemble. Tous les autres
 * documents de l'ERP ont leur ecran ; celui-ci le rejoint.
 *
 * LA QUANTITE SE SAISIT DANS L'UNITE DE MANUTENTION — bobine, palette, metre
 * lineaire — et la conversion vers le kilo se lit AVANT d'enregistrer. Le
 * facteur ne vient pas de l'ecran : il est porte par la REFERENCE, dans son
 * poids de bobine et ses bobines par palette. Une reference qui ne les porte
 * pas ne se saisit qu'en kilos, et l'ecran le dit plutot que de deviner.
 *
 * RIEN NE PART AU SERVEUR AVANT LE CLIC FINAL. En-tete et lignes voyagent
 * ensemble : un mouvement a moitie enregistre n'aurait aucun sens au grand
 * livre, que R03 rend immuable.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link2, Unlink2 } from 'lucide-react'
import { api, ErreurApi } from '../api/client'
import { EnTetePage } from '../components/Layout'
import { Bouton, Message, fmt } from '../components/ui'
import {
  depuisBobines,
  depuisPalettes,
  depuisUnite,
  facteurVersKg,
  pourChamp,
} from '../lib/conditionnement'

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
  /** Les colis REELLEMENT COMPTES, qui ne se deduisent pas du poids. */
  nb_palettes: string
  nb_bobines: string
  lot_fournisseur: string
  code_motif_ligne: string
  /**
   * LE CALCUL EST-IL LIE SUR CETTE LIGNE ?
   *
   * Lie, saisir un des trois colis remplit les deux autres. Detache, chacun se
   * saisit seul — c'est le cas d'une palette incomplete, d'un reliquat, d'un
   * comptage qui ne suit pas la theorie. La formule ne sait pas cela ;
   * l'operateur, si.
   */
  lie: boolean
}

const LIGNE_VIDE: Saisie = {
  code_reference: '',
  quantite_saisie: '',
  unite_saisie: 'kg',
  prix_kg_mad: '',
  nb_palettes: '',
  nb_bobines: '',
  lot_fournisseur: '',
  code_motif_ligne: '',
  lie: true,
}

/** La date du jour, au format d'un `<input type="date">` et en heure locale. */
function aujourdhui(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
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

/**
 * La liste des mouvements, UN DOCUMENT PAR LIGNE.
 *
 * POURQUOI ELLE EXISTE A COTE DU GRAND LIVRE. Le livre montre une ligne par
 * reference : c'est la vue de l'auditeur, qui cherche ce qu'est devenue une
 * matiere. Ce n'est pas celle du magasin, qui manipule des camions et des
 * equipes. Devant le livre seul, il fallait additionner de tete les lignes d'un
 * meme bon pour savoir combien de kilos etaient sortis — et personne ne le
 * faisait.
 *
 * Les deux vues restent, parce que les deux lectures sont legitimes.
 */
export function MouvementNouveau() {
  const naviguer = useNavigate()
  // Le retour et la reussite menent au meme endroit : le grand livre, ou l'on
  // verifie que le mouvement est bien entre.
  const surFermeture = () => naviguer('/mouvements')
  const surSucces = () => naviguer('/mouvements')
  const [entete, setEntete] = useState({
    code_type_mvt: '',
    code_magasin: '',
    code_motif: '',
    // LA DATE DU FAIT, pre-remplie a aujourd'hui. Elle etait imposee par la
    // base a l'instant de l'enregistrement, ce qui obligeait a tout saisir le
    // jour meme sous peine de fausser le journal.
    date_mouvement: aujourdhui(),
    responsable: '',
    reference_document: '',
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
        responsable: entete.responsable.trim() || null,
        reference_document: entete.reference_document.trim() || null,
        numero_of: entete.numero_of || null,
        observations_globales: entete.observations_globales.trim() || null,
        lignes: lignes
          .filter((l) => l.code_reference && l.quantite_saisie)
          .map((l) => ({
            code_reference: l.code_reference,
            quantite_saisie: Number(l.quantite_saisie),
            unite_saisie: l.unite_saisie,
            prix_kg_mad: l.prix_kg_mad ? Number(l.prix_kg_mad) : null,
            nb_palettes: l.nb_palettes ? Number(l.nb_palettes) : null,
            nb_bobines: l.nb_bobines ? Number(l.nb_bobines) : null,
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

  /**
   * LES TROIS COLIS SE REPONDENT : palettes, bobines, quantite.
   *
   * On saisit celui qu'on a sous les yeux — au quai des palettes, sur la
   * machine des bobines, a la bascule des kilos — et les deux autres se
   * calculent par les PARAMETRES DE LA REFERENCE. Obliger l'operateur a
   * convertir de tete, c'est garantir l'erreur ; lui faire saisir les trois
   * separement, c'est garantir qu'elles se contrediront.
   *
   * Les champs calcules restent MODIFIABLES : une palette incomplete reste une
   * palette a manutentionner, et c'est l'operateur qui le sait. Le dernier
   * champ touche commande, les deux autres suivent.
   */
  const majColis = (i: number, source: 'quantite' | 'palettes' | 'bobines', valeur: string) =>
    setLignes((ls) =>
      ls.map((l, k) => {
        if (k !== i) return l
        const r = parReference.get(l.code_reference)
        // Lien detache : chaque champ se saisit seul, rien ne se recalcule.
        if (!r || !l.lie) {
          const champ = source === 'quantite' ? 'quantite_saisie'
            : source === 'palettes' ? 'nb_palettes' : 'nb_bobines'
          return { ...l, [champ]: valeur }
        }
        const c =
          source === 'palettes' ? depuisPalettes(valeur, r)
          : source === 'bobines' ? depuisBobines(valeur, r)
          : depuisUnite(valeur, l.unite_saisie, r)

        // La quantite se reexprime dans l'unite choisie pour la ligne.
        const quantite =
          source === 'quantite'
            ? valeur
            : l.unite_saisie === 'Palette' ? pourChamp(c.palettes)
            : l.unite_saisie === 'Bobine' ? pourChamp(c.bobines)
            : (() => {
                const f = facteurVersKg(l.unite_saisie, r)
                return c.kg !== null && f ? pourChamp(c.kg / f, 3) : ''
              })()

        return {
          ...l,
          quantite_saisie: quantite,
          nb_palettes: source === 'palettes' ? valeur : pourChamp(c.palettes),
          nb_bobines: source === 'bobines' ? valeur : pourChamp(c.bobines),
        }
      }),
    )

  const champ =
    'w-full rounded-lg border border-champ px-3 py-2 text-sm outline-none focus:border-anneau'

  const pretes = lignes.filter((l) => l.code_reference && Number(l.quantite_saisie) > 0)
  const totalKg = pretes.reduce((s, l) => {
    const f = facteur(parReference.get(l.code_reference), l.unite_saisie)
    return s + (f ? Number(l.quantite_saisie) * f : 0)
  }, 0)

  return (
    <>
      <EnTetePage
        titre="Saisir un mouvement"
        sous_titre="La quantité est convertie en kilogrammes avant enregistrement, par les paramètres de la référence."
      />
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

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Date du mouvement <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              max={aujourdhui()}
              value={entete.date_mouvement}
              onChange={(e) => setEntete({ ...entete, date_mouvement: e.target.value })}
              className={champ}
            />
            <p className="mt-0.5 text-[11px] text-attenue-texte">
              La date du fait, qui peut differer du jour de saisie. Jamais dans le futur.
            </p>
          </div>

          {/* DEUX RESPONSABLES, ET C'EST VOULU. Le compte connecte dit qui a
              TAPE ; ce champ dit qui a REMIS ou RECU. Le magasinier saisit
              souvent pour un chef d'equipe ou un chauffeur, et c'est ce dernier
              qu'on cherche quand un ecart apparait trois jours plus tard. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Responsable de la marchandise
            </label>
            <input
              value={entete.responsable}
              onChange={(e) => setEntete({ ...entete, responsable: e.target.value })}
              placeholder="Qui remet ou recoit"
              className={champ}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-texte">
              Document de reference
            </label>
            <input
              value={entete.reference_document}
              onChange={(e) => setEntete({ ...entete, reference_document: e.target.value })}
              placeholder="N BL, bon de commande, OF..."
              className={champ}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-texte">Observations</label>
          <textarea
            rows={2}
            value={entete.observations_globales}
            onChange={(e) => setEntete({ ...entete, observations_globales: e.target.value })}
            className={champ}
          />
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
                      placeholder="Référence"
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
                      placeholder="Quantité"
                      value={l.quantite_saisie}
                      onChange={(e) => majColis(i, 'quantite', e.target.value)}
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
                  {/* LES COLIS COMPTES. Une palette incomplete reste une
                      palette a manutentionner : le compte reel ne se deduit pas
                      du poids, il se compte sur le quai. */}
                  {/* L'INTERRUPTEUR DU CALCUL, au plus pres des colis qu'il
                      relie. Lie, les trois se repondent ; detache, chacun se
                      saisit seul — une palette incomplete, un reliquat. */}
                  <div className="flex items-center justify-center sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => majLigne(i, 'lie', !l.lie as unknown as string)}
                      title={
                        l.lie
                          ? 'Calcul lié : saisir un colis remplit les autres. Cliquez pour détacher.'
                          : 'Calcul détaché : chaque colis se saisit seul. Cliquez pour relier.'
                      }
                      aria-label={l.lie ? 'Détacher le calcul' : 'Relier le calcul'}
                      className={
                        'grid size-8 place-items-center rounded-lg border ' +
                        (l.lie
                          ? 'border-anneau text-anneau'
                          : 'border-bordure text-attenue-texte')
                      }
                    >
                      {l.lie ? <Link2 className="size-4" /> : <Unlink2 className="size-4" />}
                    </button>
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Palettes"
                      value={l.nb_palettes}
                      onChange={(e) => majColis(i, 'palettes', e.target.value)}
                      className={champ}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Bobines"
                      value={l.nb_bobines}
                      onChange={(e) => majColis(i, 'bobines', e.target.value)}
                      className={champ}
                    />
                  </div>

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
    </>
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

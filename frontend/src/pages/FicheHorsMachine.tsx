/**
 * LA FICHE HORS MACHINE (decision du 22/10/2026).
 *
 * Ce n'est NI une table NI un document de plus : une INTERFACE DE SAISIE
 * SIMPLIFIEE pour ceux qui manipulent les autres matieres — colle, latex, bande,
 * jute, plastique — celles qui ne montent jamais sur une machine (fiche article
 * en mode de consommation DIRECTE). Date, responsable, OF, et des lignes :
 * reference, lot, quantite, et le SENS.
 *
 *   - SORTIE : la consommation directe existante (`CONSO_DIRECTE`), au CMUP du
 *     magasin, rangee sous l'OF ;
 *   - RETOUR au magasin : le reste revient (`RETOUR_CONSO`), au CMUP du magasin,
 *     sans effet sur le CMUP, jamais plus que ce que l'OF a sorti de cette
 *     reference — la base le garantit.
 *
 * CONSOMMATION DE L'OF = SORTI - RENDU.
 *
 * LA QUALITE EXPLICITE (23/10/2026) : « quand on choisit un OF ou non, on doit
 * explicitement definir la qualite ». Avec un OF, c'est la sienne, affichee ;
 * sans OF, elle est obligatoire (le serveur et la base la refusent absente), et
 * un retour sans OF est borne par ce que la qualite a sorti sans OF.
 *
 * PALETTES, BOBINES, KILOS LIES (23/10/2026) : on tape dans une case, les deux
 * autres suivent, avec le conditionnement DU LOT choisi (sinon de la fiche
 * article). La case tapee garde sa valeur ; les bobines sont entieres ; rien
 * n'est arrondi a la palette pleine. Facteur manquant : seule la case des
 * kilos. Les kilos partent au serveur — l'unite canonique.
 *
 * Deux sens, donc au plus deux mouvements, chacun avec son identifiant tire a
 * l'ouverture : renvoyer la fiche apres une panne ne double rien.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { api, ErreurApi } from '../api/client'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Bouton, SaisieNombre } from '../composants/ui/base'
import { ChampLot } from '../composants/ChampLot'
import { ChoixOF, ChoixQualite, qualiteDeLOf, useOfOuverts } from '../composants/ChoixOF'
import { useConditionnementsLots } from '../hooks/useConditionnementLots'
import {
  type ChampColis, type Colisage, type Conditionnement, conditionnementDuLot, depuisChamp, facteurVersKg, pourChamp,
} from '../lib/conditionnement'
import { lireNombre } from '../lib/nombres'
import { AvisInventaireOuvert } from '../composants/AvisInventaireOuvert'
import { phraseGel, useGelInventaire } from '../lib/inventairesOuverts'
import { nouvelIdentifiant } from '../lib/identifiant'
import { cn, fmt } from '../lib/utils'

type Sens = 'SORTIE' | 'RETOUR'

interface Ligne {
  cle: string
  sens: Sens
  code_reference: string
  lot: string
  /** La case tapee (kilos, palettes ou bobines) et sa valeur : les deux autres s'en deduisent. */
  saisiePar: ChampColis
  valeur: string
}

interface StockMagasin {
  code_reference: string
  designation: string
  quantite_kg: number
  suivi_lot: number | null
  mode_consommation?: string | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
}

interface Magasin {
  code_magasin: string
  nom: string
}

/** Ce que l'OF a sorti et rendu, par reference. */
interface BilanOf {
  code_reference: string
  designation: string
  kg_sorti: number
  kg_rendu: number
  reste_kg: number
}

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' })
let compteur = 0
const ligneVide = (sens: Sens = 'SORTIE'): Ligne => ({
  cle: `h${++compteur}`, sens, code_reference: '', lot: '', saisiePar: 'quantite', valeur: '',
})

const LIBELLE_SENS: Record<Sens, string> = { SORTIE: 'Sortie (consommée)', RETOUR: 'Retour au magasin' }

const champ = 'min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]'

export function FicheHorsMachine() {
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const [entete, setEntete] = useState({ date: aujourdhui(), responsable: '', magasin: '', id_of: '', code_qualite: '' })
  const [lignes, setLignes] = useState<Ligne[]>(() => [ligneVide()])
  const [ids, setIds] = useState(() => ({ sortie: nouvelIdentifiant(), retour: nouvelIdentifiant() }))
  const [resultat, setResultat] = useState<string[] | null>(null)

  const qMag = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: ({ signal }) => api.get<Magasin[]>('/api/magasins?actif=1', { signal }),
  })
  const qStock = useQuery({
    queryKey: ['stock-magasin', entete.magasin],
    queryFn: ({ signal }) =>
      api.get<StockMagasin[]>(`/api/stock?code_magasin=${encodeURIComponent(entete.magasin)}&limite=2000`, { signal }),
    enabled: !!entete.magasin,
  })
  /* CE QUE L'OF — ou, sans OF, la qualite — a deja sorti et rendu : ce qu'un retour peut encore rendre. */
  const qBilan = useQuery({
    queryKey: ['of-hors-machine', entete.id_of, entete.id_of ? '' : entete.code_qualite],
    queryFn: ({ signal }) =>
      api.get<BilanOf[]>(
        entete.id_of
          ? `/api/machines/of-ouverts/${encodeURIComponent(entete.id_of)}/hors-machine`
          : `/api/machines/qualites/${encodeURIComponent(entete.code_qualite)}/hors-machine`,
        { signal },
      ),
    enabled: !!entete.id_of || !!entete.code_qualite,
  })
  const ofs = useOfOuverts()
  const ofChoisi = (ofs.data ?? []).find((o) => o.id_of === entete.id_of)
  /** Ce qui porte la consommation : l'OF, ou a defaut la qualite. */
  const porteur = entete.id_of ? 'l’OF' : 'la qualité (sans OF)'

  /* LES ARTICLES EN MODE DIRECTE SEULEMENT : le fil sort par les fiches machine. */
  const articles = useMemo(() => {
    const m = new Map<string, StockMagasin>()
    for (const s of qStock.data ?? []) {
      if (s.mode_consommation !== 'DIRECTE') continue
      const deja = m.get(s.code_reference)
      m.set(s.code_reference, deja ? { ...deja, quantite_kg: deja.quantite_kg + (s.quantite_kg ?? 0) } : { ...s })
    }
    return [...m.values()].sort((a, b) => a.designation.localeCompare(b.designation))
  }, [qStock.data])
  const article = (code: string) => articles.find((a) => a.code_reference === code)
  const bilan = (code: string) => (qBilan.data ?? []).find((b) => b.code_reference === code)

  /* LE CONDITIONNEMENT DE LA LIGNE : celui de son lot, sinon de la fiche article. */
  const { condLot } = useConditionnementsLots(lignes.filter((l) => l.lot.trim()).map((l) => l.code_reference))
  const condDe = (l: Ligne): Conditionnement => {
    const a = article(l.code_reference)
    return conditionnementDuLot(
      { poids_bobine_kg: a?.poids_bobine_kg ?? null, bobines_par_palette: a?.bobines_par_palette ?? null },
      condLot(l.code_reference, l.lot),
    )
  }
  /** Les trois cases de la ligne : celle tapee telle quelle, les deux autres deduites. */
  const colisDe = (l: Ligne): Colisage => depuisChamp(l.saisiePar, l.valeur, condDe(l))
  /** Les kilos de la ligne : l'unite canonique, ce qui part au serveur. */
  const kgDe = (l: Ligne): number => {
    const k = l.saisiePar === 'quantite' ? lireNombre(l.valeur) : colisDe(l).kg
    return k !== null && Number.isFinite(k) && k > 0 ? Math.round(k * 10_000) / 10_000 : 0
  }

  function maj(cle: string, patch: Partial<Ligne>) {
    setResultat(null)
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))
  }

  const utiles = lignes.filter((l) => l.code_reference && kgDe(l) > 0)

  /* LE MAGASIN GELE PAR UN INVENTAIRE OUVERT (23/10/2026) : la base refuse. Un
     global gele tout le magasin ; un tournant ou un cible, ses seules references
     (2026-10-24a) : le gel ne touche alors que si une ligne en porte une. */
  const gel = useGelInventaire(
    [entete.magasin],
    lignes.map((l) => ({ magasin: entete.magasin, reference: l.code_reference })),
  )

  /** CE QUI MANQUE, dit en clair : la premiere chose qui empeche d'enregistrer. */
  const manque = ((): string | null => {
    if (gel.length > 0) return phraseGel(gel)
    if (!entete.date) return 'Indiquez la date.'
    if (!entete.responsable.trim()) return 'Indiquez le responsable.'
    if (!entete.magasin) return 'Choisissez le magasin.'
    if (!entete.id_of && !entete.code_qualite)
      return 'Choisissez l’ordre de fabrication, ou sans OF la qualité : toute consommation de fabrication nomme sa qualité.'
    if (utiles.length === 0) return 'Saisissez au moins une ligne (référence et quantité).'
    for (const l of utiles) {
      const a = article(l.code_reference)
      const qui = a?.designation ?? l.code_reference
      if (a?.suivi_lot === 1 && !l.lot.trim()) return `Indiquez le lot de ${qui} : la référence est suivie par lot.`
      if (l.sens === 'SORTIE' && a && kgDe(l) > a.quantite_kg + 1e-6)
        return `${qui} : ${fmt.nombre(kgDe(l), 2)} kg à sortir, ${fmt.nombre(a.quantite_kg, 2)} kg au magasin.`
    }
    // UN RETOUR NE REND PAS PLUS QUE L'OF (sans OF : la qualite) N'A SORTI de cette reference (la base le garantit aussi).
    const rendus = new Map<string, number>()
    for (const l of utiles.filter((x) => x.sens === 'RETOUR'))
      rendus.set(l.code_reference, (rendus.get(l.code_reference) ?? 0) + kgDe(l))
    for (const [code, kg] of rendus) {
      const reste = bilan(code)?.reste_kg ?? 0
      if (kg > reste + 1e-6) {
        const qui = article(code)?.designation ?? code
        return `${qui} : ${fmt.nombre(kg, 2)} kg rendus, ${porteur} n’en a sorti que ${fmt.nombre(reste, 2)} kg non encore rendus.`
      }
    }
    return null
  })()

  const enregistrer = useMutation({
    mutationFn: async () => {
      const faits: string[] = []
      for (const sens of ['SORTIE', 'RETOUR'] as Sens[]) {
        const ls = utiles.filter((l) => l.sens === sens)
        if (ls.length === 0) continue
        const r = await api.post<{ numero_mouvement: string }>('/api/mouvements', {
          id_document: sens === 'SORTIE' ? ids.sortie : ids.retour,
          code_type_mvt: sens === 'SORTIE' ? 'CONSO_DIRECTE' : 'RETOUR_CONSO',
          code_magasin: entete.magasin,
          code_motif: sens === 'SORTIE' ? 'PRODUCTION' : 'RETOUR_PROD',
          date_mouvement: entete.date,
          responsable: entete.responsable.trim(),
          id_of: entete.id_of || null,
          // Avec un OF, la base pose sa qualite ; sans OF, celle choisie.
          code_qualite: entete.id_of ? null : entete.code_qualite,
          observations_globales: `Fiche hors machine${ofChoisi ? ` · OF ${ofChoisi.numero}` : ` · qualité ${entete.code_qualite}`}`,
          lignes: ls.map((l) => {
            const colis = colisDe(l)
            return {
              code_reference: l.code_reference,
              // LES KILOS, unite canonique ; les colis comptes les accompagnent.
              quantite_saisie: kgDe(l),
              unite_saisie: 'kg',
              nb_bobines: colis.bobines != null && colis.bobines > 0 ? colis.bobines : null,
              nb_palettes: colis.palettes != null && colis.palettes > 0 ? colis.palettes : null,
              lot_fournisseur: l.lot.trim() || null,
            }
          }),
        })
        faits.push(`${sens === 'SORTIE' ? 'Sortie' : 'Retour'} ${r.numero_mouvement}`)
      }
      return faits
    },
    onSuccess: (faits) => {
      setResultat(faits)
      setLignes([ligneVide()])
      setIds({ sortie: nouvelIdentifiant(), retour: nouvelIdentifiant() })
      for (const k of ['stock-magasin', 'of-hors-machine', 'mouvements', 'documents-mouvement'])
        void qc.invalidateQueries({ queryKey: [k] })
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Fiche hors machine"
        description="Colle, latex, jute, bande, plastique… : ce qui sort pour un OF, et ce qui revient au magasin."
        actions={
          <Bouton variante="contour" onClick={() => naviguer('/mouvements')}>
            <ArrowLeft />
            Mouvements
          </Bouton>
        }
      />
      <AvisInventaireOuvert inventaires={gel} />

      {/* --- L'entete ---------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Date</span>
          <input type="date" value={entete.date} onChange={(e) => setEntete({ ...entete, date: e.target.value })} className={champ} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Responsable</span>
          <input value={entete.responsable} onChange={(e) => setEntete({ ...entete, responsable: e.target.value })}
                 placeholder="Qui a pris ou rendu la matière" className={champ} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Magasin</span>
          <select value={entete.magasin} onChange={(e) => setEntete({ ...entete, magasin: e.target.value })} className={champ}>
            <option value="">—</option>
            {(qMag.data ?? []).map((m) => (
              <option key={m.code_magasin} value={m.code_magasin}>{m.nom}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Ordre de fabrication</span>
          <ChoixOF valeur={entete.id_of} onChange={(id) => setEntete({ ...entete, id_of: id, code_qualite: id ? '' : entete.code_qualite })}
                   vide="— aucun OF : choisir la qualité —" />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">
            Qualité {!entete.id_of && <span className="text-danger">*</span>}
          </span>
          <ChoixQualite valeur={entete.code_qualite} onChange={(q) => setEntete({ ...entete, code_qualite: q })}
                        imposee={entete.id_of ? (qualiteDeLOf(ofs.data, entete.id_of) ?? '…') : null}
                        invalide={!entete.id_of && !entete.code_qualite} className="w-full" />
        </div>
      </div>

      {/* --- Les lignes : une carte par ligne, sans defilement horizontal ------- */}
      <div className="flex flex-col gap-2">
        {lignes.map((l) => {
          const a = article(l.code_reference)
          const b = bilan(l.code_reference)
          const cond = condDe(l)
          const colis = colisDe(l)
          /* FACTEUR MANQUANT : seule la case des kilos (jamais un facteur 1). */
          const parBobine = facteurVersKg('Bobine', cond) !== null
          const parPalette = facteurVersKg('Palette', cond) !== null
          const vue = (champ: ChampColis, calcule: number | null, decimales = 0) =>
            l.saisiePar === champ ? l.valeur : pourChamp(calcule, decimales)
          return (
            <div key={l.cle} className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-2 sm:grid-cols-[11rem_1fr_11rem_auto] sm:items-start">
              <select value={l.sens} onChange={(e) => maj(l.cle, { sens: e.target.value as Sens })}
                      aria-label="Sens" className={cn(champ, l.sens === 'RETOUR' && 'border-primaire')}>
                <option value="SORTIE">{LIBELLE_SENS.SORTIE}</option>
                <option value="RETOUR">{LIBELLE_SENS.RETOUR}</option>
              </select>
              <div className="flex flex-col gap-0.5">
                <select value={l.code_reference} onChange={(e) => maj(l.cle, { code_reference: e.target.value, lot: '' })}
                        aria-label="Référence" disabled={!entete.magasin} className={champ}>
                  <option value="">{entete.magasin ? 'Référence (mode DIRECTE)…' : 'Choisissez d’abord le magasin'}</option>
                  {articles.map((x) => (
                    <option key={x.code_reference} value={x.code_reference}>{x.designation}</option>
                  ))}
                </select>
                {a && (
                  <span className="text-[11px] text-attenue-texte">
                    {fmt.nombre(a.quantite_kg, 2)} kg au magasin
                    {b && ` · ${entete.id_of ? 'OF' : 'qualité sans OF'} : ${fmt.nombre(b.kg_sorti, 2)} kg sortis, ${fmt.nombre(b.kg_rendu, 2)} rendus`}
                  </span>
                )}
              </div>
              {l.code_reference && entete.magasin ? (
                <ChampLot reference={l.code_reference} magasin={entete.magasin} valeur={l.lot}
                          onChange={(v) => maj(l.cle, { lot: v })} invalide={a?.suivi_lot === 1 && !l.lot.trim()}
                          proposerPlusAncien={l.sens === 'SORTIE'} className={cn(champ, 'w-full font-mono text-[12px]')} />
              ) : (
                <span className="min-h-[34px] py-2 text-[12px] text-attenue-texte">lot</span>
              )}
              <button type="button" aria-label="Retirer la ligne" onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))}
                      className="min-h-[34px] px-2 text-attenue-texte hover:text-danger">
                <Trash2 className="size-4" />
              </button>
              {/* ↳ LA QUANTITE : palettes, bobines, kilos lies par le conditionnement du lot. */}
              <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
                <span className="text-[12px] text-attenue-texte">↳</span>
                <label className="flex items-center gap-1">
                  <SaisieNombre min={0} step={1} value={vue('palettes', colis.palettes)} aria-label="Palettes"
                                disabled={!parPalette} title={parPalette ? undefined : 'Ni le lot ni la fiche article ne disent les bobines par palette'}
                                onChange={(e) => maj(l.cle, { saisiePar: 'palettes', valeur: e.target.value })}
                                className={cn(champ, 'w-20 text-right tabular-nums')} />
                  <span className="text-[12px] text-attenue-texte">palettes</span>
                </label>
                <label className="flex items-center gap-1">
                  <SaisieNombre min={0} step={1} value={vue('bobines', colis.bobines)} aria-label="Bobines"
                                disabled={!parBobine} title={parBobine ? undefined : 'Ni le lot ni la fiche article ne disent le poids d’une bobine'}
                                onChange={(e) => {
                                  /* UNE BOBINE NE SE COUPE PAS : un entier. */
                                  const n = lireNombre(e.target.value)
                                  maj(l.cle, { saisiePar: 'bobines', valeur: n === null ? '' : String(Math.max(0, Math.round(n))) })
                                }}
                                className={cn(champ, 'w-24 text-right tabular-nums')} />
                  <span className="text-[12px] text-attenue-texte">bobines</span>
                </label>
                <label className="flex items-center gap-1">
                  <SaisieNombre min={0} step={0.1} value={vue('quantite', colis.kg, 3)} aria-label="Quantité (kg)"
                                onChange={(e) => maj(l.cle, { saisiePar: 'quantite', valeur: e.target.value })}
                                className={cn(champ, 'w-28 text-right tabular-nums')} />
                  <span className="text-[12px] text-attenue-texte">kg</span>
                </label>
                {l.lot && cond.poids_bobine_kg != null && (
                  <span className="text-[11px] text-attenue-texte">
                    lot : {fmt.nombre(Number(cond.poids_bobine_kg), 3)} kg la bobine
                    {cond.bobines_par_palette != null && `, ${cond.bobines_par_palette} par palette`}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        <div className="flex flex-wrap gap-2">
          <Bouton variante="contour" onClick={() => setLignes((ls) => [...ls, ligneVide('SORTIE')])}>
            <Plus />
            Une sortie
          </Bouton>
          <Bouton variante="contour" onClick={() => setLignes((ls) => [...ls, ligneVide('RETOUR')])}>
            <Plus />
            Un retour au magasin
          </Bouton>
        </div>
      </div>

      {(entete.id_of || entete.code_qualite) && (qBilan.data ?? []).length > 0 && (
        <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3 text-[12.5px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
            {entete.id_of ? 'Déjà sur cet OF' : 'Déjà sur cette qualité, sans OF'} — consommation = sorti − rendu
          </div>
          <ul className="m-0 list-none space-y-0.5 p-0 tabular-nums">
            {(qBilan.data ?? []).map((b) => (
              <li key={b.code_reference}>
                {b.designation} : {fmt.nombre(b.kg_sorti, 2)} kg sortis − {fmt.nombre(b.kg_rendu, 2)} rendus ={' '}
                <strong>{fmt.nombre(b.kg_sorti - b.kg_rendu, 2)} kg</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {enregistrer.isError && (
        <Alerte ton="danger" titre="Enregistrement refusé">
          {enregistrer.error instanceof ErreurApi ? enregistrer.error.message : String(enregistrer.error)}
        </Alerte>
      )}
      {resultat && (
        <Alerte ton="succes" titre="Fiche enregistrée">{resultat.join(' · ')}</Alerte>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Bouton disabled={!!manque || enregistrer.isPending} onClick={() => enregistrer.mutate()}>
          {enregistrer.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Enregistrer
        </Bouton>
        <span className="text-[12px] text-attenue-texte">{manque ?? ''}</span>
      </div>
    </div>
  )
}

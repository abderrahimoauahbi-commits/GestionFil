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
 * CONSOMMATION DE L'OF = SORTI - RENDU. L'OF est obligatoire ici ; le serveur
 * accepte une sortie sans OF (l'ecran des mouvements), mais la signale (C62).
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
import { ChoixOF, useOfOuverts } from '../composants/ChoixOF'
import { nouvelIdentifiant } from '../lib/identifiant'
import { cn, fmt } from '../lib/utils'

type Sens = 'SORTIE' | 'RETOUR'

interface Ligne {
  cle: string
  sens: Sens
  code_reference: string
  lot: string
  kg: number
}

interface StockMagasin {
  code_reference: string
  designation: string
  quantite_kg: number
  suivi_lot: number | null
  mode_consommation?: string | null
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
const ligneVide = (sens: Sens = 'SORTIE'): Ligne => ({ cle: `h${++compteur}`, sens, code_reference: '', lot: '', kg: 0 })

const LIBELLE_SENS: Record<Sens, string> = { SORTIE: 'Sortie (consommée)', RETOUR: 'Retour au magasin' }

const champ = 'min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]'

export function FicheHorsMachine() {
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const [entete, setEntete] = useState({ date: aujourdhui(), responsable: '', magasin: '', id_of: '' })
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
  const qBilan = useQuery({
    queryKey: ['of-hors-machine', entete.id_of],
    queryFn: ({ signal }) =>
      api.get<BilanOf[]>(`/api/machines/of-ouverts/${encodeURIComponent(entete.id_of)}/hors-machine`, { signal }),
    enabled: !!entete.id_of,
  })
  const ofs = useOfOuverts()
  const ofChoisi = (ofs.data ?? []).find((o) => o.id_of === entete.id_of)

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

  function maj(cle: string, patch: Partial<Ligne>) {
    setResultat(null)
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))
  }

  const utiles = lignes.filter((l) => l.code_reference && l.kg > 0)

  /** CE QUI MANQUE, dit en clair : la premiere chose qui empeche d'enregistrer. */
  const manque = ((): string | null => {
    if (!entete.date) return 'Indiquez la date.'
    if (!entete.responsable.trim()) return 'Indiquez le responsable.'
    if (!entete.magasin) return 'Choisissez le magasin.'
    if (!entete.id_of) return 'Choisissez l’ordre de fabrication : la consommation se range sous son OF.'
    if (utiles.length === 0) return 'Saisissez au moins une ligne (référence et quantité).'
    for (const l of utiles) {
      const a = article(l.code_reference)
      const qui = a?.designation ?? l.code_reference
      if (a?.suivi_lot === 1 && !l.lot.trim()) return `Indiquez le lot de ${qui} : la référence est suivie par lot.`
      if (l.sens === 'SORTIE' && a && l.kg > a.quantite_kg + 1e-6)
        return `${qui} : ${fmt.nombre(l.kg, 2)} kg à sortir, ${fmt.nombre(a.quantite_kg, 2)} kg au magasin.`
    }
    // UN RETOUR NE REND PAS PLUS QUE L'OF N'A SORTI de cette reference (la base le garantit aussi).
    const rendus = new Map<string, number>()
    for (const l of utiles.filter((x) => x.sens === 'RETOUR'))
      rendus.set(l.code_reference, (rendus.get(l.code_reference) ?? 0) + l.kg)
    for (const [code, kg] of rendus) {
      const reste = bilan(code)?.reste_kg ?? 0
      if (kg > reste + 1e-6) {
        const qui = article(code)?.designation ?? code
        return `${qui} : ${fmt.nombre(kg, 2)} kg rendus, l’OF n’en a sorti que ${fmt.nombre(reste, 2)} kg non encore rendus.`
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
          id_of: entete.id_of,
          observations_globales: `Fiche hors machine${ofChoisi ? ` · OF ${ofChoisi.numero}` : ''}`,
          lignes: ls.map((l) => ({
            code_reference: l.code_reference,
            quantite_saisie: l.kg,
            unite_saisie: 'kg',
            lot_fournisseur: l.lot.trim() || null,
          })),
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

      {/* --- L'entete ---------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <span className="text-[11px] text-attenue-texte">Ordre de fabrication <span className="text-danger">*</span></span>
          <ChoixOF valeur={entete.id_of} onChange={(id) => setEntete({ ...entete, id_of: id })}
                   vide="Choisir l’OF…" invalide={!entete.id_of} />
        </label>
      </div>

      {/* --- Les lignes : une carte par ligne, sans defilement horizontal ------- */}
      <div className="flex flex-col gap-2">
        {lignes.map((l) => {
          const a = article(l.code_reference)
          const b = bilan(l.code_reference)
          return (
            <div key={l.cle} className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-2 sm:grid-cols-[11rem_1fr_11rem_8rem_auto] sm:items-start">
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
                    {entete.id_of && b && ` · OF : ${fmt.nombre(b.kg_sorti, 2)} kg sortis, ${fmt.nombre(b.kg_rendu, 2)} rendus`}
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
              <div className="flex items-center gap-1">
                <SaisieNombre min={0} step={0.1} value={l.kg || ''} aria-label="Quantité (kg)"
                              onChange={(e) => maj(l.cle, { kg: Math.max(0, Number(e.target.value) || 0) })}
                              className={cn(champ, 'w-full text-right tabular-nums')} />
                <span className="text-[12px] text-attenue-texte">kg</span>
              </div>
              <button type="button" aria-label="Retirer la ligne" onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))}
                      className="min-h-[34px] px-2 text-attenue-texte hover:text-danger">
                <Trash2 className="size-4" />
              </button>
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

      {entete.id_of && (qBilan.data ?? []).length > 0 && (
        <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3 text-[12.5px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
            Déjà sur cet OF — consommation = sorti − rendu
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

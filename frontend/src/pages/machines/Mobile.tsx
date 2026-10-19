/**
 * Machines — l'interface de terrain.
 *
 * CE N'EST PAS LE TABLEAU DE BUREAU RETRECI. L'operateur est debout devant sa
 * machine, souvent d'une main, parfois gante. D'ou un principe unique : UNE
 * CHOSE A LA FOIS. Une liste, puis une zone, puis une ligne — jamais une
 * grille de dix colonnes qu'il faudrait faire glisser.
 *
 * Trois regles qui ne se negocient pas :
 *   1. aucun defilement horizontal ;
 *   2. LE CONSTAT ET LA CONSOMMATION S'AFFICHENT AU-DESSUS DU CHAMP DE SAISIE —
 *      clavier ouvert, tout ce qui est en dessous est cache, et c'est
 *      precisement ce qu'on relit en tapant ;
 *   3. cibles d'au moins 48 px, 56 px pour le bouton qui valide.
 */
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Layers, Loader2, Plus, Search, X,
} from 'lucide-react'
import { api } from '../../api/client'
import { Alerte, Chargement, SaisieNombre } from '../../composants/ui/base'
import { cn } from '../../lib/utils'
import { couleurEcart, libelleLot, SANS_LOT, useTolerancesLot } from '../../lib/lots'
import {
  CLASSE_ECART, destinationsDe, ecartPoidsBobine, estimer, fmtDate, LIBELLE_DESTINATION, LIBELLE_EFFET,
  LIBELLE_TYPE, ligneNeuve, machinesApi, nb, rappelCatalogue, signePct,
  type Destination, type Machine, type TypeFiche, type Zone,
  RAISONS_SURPLUS, TON_ECART,
} from './noyau'
import { useFiche } from './useFiche'
import { ChampScan } from '../../composants/ChampScan'
import { useValiderFiche } from './Questions'
import { DemandesDerogation } from './Derogation'

interface Magasin {
  code_magasin: string
  nom: string
}


/** Ce que le magasin tient d'une reference, tous lots confondus. */
interface StockMagasin {
  code_reference: string
  designation: string
  quantite_kg: number
  suivi_lot: number
  poids_bobine_kg: number | null
}

/** Une reference du catalogue, pour charger ce que le stock ne connait pas. */
interface RefCatalogue {
  code_reference: string
  designation: string
  poids_bobine_kg: number | null
}

/** Un lot en stock dans un magasin — ce qu'on peut monter sur la machine. */
interface LotDispo {
  code_reference: string
  designation: string
  poids_bobine_kg: number | null
  lot_fournisseur: string
  code_couleur: string | null
  quantite_kg: number
  nb_bobines: number
  date_premiere_entree: string
}

export function MachinesMobile() {
  const [machine, setMachine] = useState<Machine | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)
  const [type, setType] = useState<TypeFiche | null>(null)

  const qMachines = useQuery({ queryKey: ['machines'], queryFn: machinesApi.liste })
  const qPlan = useQuery({
    queryKey: ['machine-plan', machine?.code_machine],
    queryFn: () => machinesApi.plan(machine!.code_machine),
    enabled: !!machine && !zone,
  })

  if (qMachines.isLoading) return <Chargement texte="Lecture des machines…" />

  // --- Ecran 4 : la fiche ---------------------------------------------------
  if (machine && zone && type) {
    return (
      <FicheMobile machine={machine} zone={zone} type={type} retour={() => setType(null)} />
    )
  }

  // --- Ecran 3 : la zone ----------------------------------------------------
  if (machine && zone) {
    return (
      <ZoneMobile
        machine={machine}
        zone={zone}
        retour={() => setZone(null)}
        ouvrir={setType}
      />
    )
  }

  // --- Ecran 2 : le plan ----------------------------------------------------
  if (machine) {
    const zones = qPlan.data ?? []
    const etages = zones.filter((z) => z.role === 'ETAGE')
    const hors = zones.filter((z) => z.role !== 'ETAGE')
    return (
      <div className="flex flex-col gap-3 pb-4">
        <Fil titre={machine.nom} sous={machine.code_machine} retour={() => setMachine(null)} />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
          Étages
        </p>
        <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
          {etages.map((z) => (
            <CarteZone key={z.code_emplacement} z={z} ouvrir={setZone} />
          ))}
        </div>
        {hors.length > 0 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
              Hors étages
            </p>
            <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
              {hors.map((z) => (
                <CarteZone key={z.code_emplacement} z={z} ouvrir={setZone} />
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // --- Ecran 1 : les machines -----------------------------------------------
  return (
    <div className="flex flex-col gap-2 pb-4">
      <h1 className="text-[17px] font-semibold text-texte">Machines</h1>
      {(qMachines.data ?? []).map((m) => {
        const part = m.capacite_bobines
          ? Math.min(100, (m.bobines_presentes / m.capacite_bobines) * 100)
          : 0
        return (
          <button
            key={m.code_machine}
            type="button"
            onClick={() => setMachine(m)}
            className="flex min-h-[64px] items-center gap-3 rounded-[var(--radius)] border
                       border-bordure bg-surface px-3 py-2.5 text-left active:bg-attenue"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium text-texte">{m.nom}</div>
              <div className="text-[12px] tabular-nums text-attenue-texte">
                {m.bobines_presentes} / {m.capacite_bobines} bobines · {nb(m.quantite_kg, 0)} kg
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-attenue">
                <div className="h-full rounded-full bg-primaire" style={{ width: `${part}%` }} />
              </div>
            </div>
            <ChevronRight className="size-5 shrink-0 text-attenue-texte" />
          </button>
        )
      })}
      {(qMachines.data ?? []).length === 0 && (
        <Alerte ton="info" titre="Aucune machine">
          Créez une machine depuis un poste de bureau.
        </Alerte>
      )}
    </div>
  )
}

function Fil({ titre, sous, retour }: { titre: string; sous?: string; retour: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={retour}
        aria-label="Retour"
        className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)]
                   border border-bordure text-attenue-texte active:bg-attenue"
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="min-w-0">
        <div className="truncate text-[16px] font-semibold text-texte">{titre}</div>
        {sous && <div className="truncate text-[11px] text-attenue-texte">{sous}</div>}
      </div>
    </div>
  )
}

function CarteZone({ z, ouvrir }: { z: Zone; ouvrir: (z: Zone) => void }) {
  const part = z.capacite_bobines
    ? Math.min(100, (z.bobines_presentes / z.capacite_bobines) * 100)
    : 0
  return (
    <button
      type="button"
      onClick={() => ouvrir(z)}
      className="flex min-h-[60px] w-full items-center gap-3 px-3 py-2.5 text-left active:bg-attenue"
    >
      <Layers className="size-4 shrink-0 text-attenue-texte" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium text-texte">{z.libelle}</div>
        <div className="text-[12px] tabular-nums text-attenue-texte">
          {z.bobines_presentes} / {z.capacite_bobines} · {nb(z.quantite_kg, 0)} kg
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-attenue">
          <div className="h-full rounded-full bg-primaire" style={{ width: `${part}%` }} />
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-attenue-texte" />
    </button>
  )
}

// =============================================================================
// ECRAN 3 : LA ZONE
// =============================================================================

function ZoneMobile({
  machine, zone, retour, ouvrir,
}: {
  machine: Machine
  zone: Zone
  retour: () => void
  ouvrir: (t: TypeFiche) => void
}) {
  const [deplie, setDeplie] = useState<string | null>(null)
  const tolerances = useTolerancesLot()
  const q = useQuery({
    queryKey: ['machine-etat', machine.code_machine, zone.code_emplacement],
    queryFn: () => machinesApi.etat(machine.code_machine, zone.code_emplacement),
  })
  const lignes = q.data ?? []

  return (
    <div className="flex flex-col gap-3 pb-28 max-md:pb-48">
      <Fil titre={zone.libelle} sous={machine.nom} retour={retour} />

      <div className="rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 text-[12px] tabular-nums">
        <div className="flex justify-between">
          <span className="text-attenue-texte">Emplacements</span>
          <span className="font-medium text-texte">
            {lignes.reduce((s, l) => s + l.nb_bobines, 0)} / {zone.capacite_bobines}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-attenue-texte">Poids constaté</span>
          <span className="font-medium text-texte">
            {nb(lignes.reduce((s, l) => s + l.kg, 0))} kg
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-attenue-texte">Dernier constat</span>
          <span className="text-texte">{fmtDate(zone.dernier_constat)}</span>
        </div>
      </div>

      {/* LA LIGNE QUI SE COMPLETE EN BAS. Deux chiffres visibles, le reste se
          deplie — une seule ligne ouverte a la fois. */}
      <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
        {lignes.map((l) => {
          const cle = l.code_reference + l.lot_fournisseur
          const ouvert = deplie === cle
          return (
            <div key={cle}>
              <button
                type="button"
                onClick={() => setDeplie(ouvert ? null : cle)}
                aria-expanded={ouvert}
                className="flex min-h-[52px] w-full items-center gap-2 px-3 py-2 text-left active:bg-attenue"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-texte">{l.designation}</div>
                  <div className="font-mono text-[11px] text-attenue-texte">{libelleLot(l.lot_fournisseur)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[14px] font-semibold tabular-nums text-texte">
                    {nb(l.kg, 0)}
                    <span className="ml-0.5 text-[10px] font-normal text-attenue-texte">kg</span>
                  </div>
                  <div className="text-[11px] tabular-nums text-attenue-texte">
                    {l.nb_bobines} bob · {nb(l.pourcentage, 0)} %
                  </div>
                </div>
                <ChevronDown
                  className={cn('size-4 shrink-0 text-attenue-texte transition-transform', ouvert && 'rotate-180')}
                />
              </button>
              {ouvert && (() => {
                /* L'ECART AU CATALOGUE, a cote du poids constate : le meme
                   calcul et les memes couleurs que pendant la saisie. */
                const pct = ecartPoidsBobine({
                  poids: l.poids_unitaire_kg ?? 0,
                  poids_catalogue: l.poids_catalogue_kg,
                })
                const c = couleurEcart(pct, tolerances)
                return (
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 bg-attenue px-3 pb-3 pt-1 text-[12px]">
                  <D
                    t="Poids par bobine"
                    v={`${nb(l.poids_unitaire_kg, 3)} kg`}
                    suffixe={
                      pct != null && c ? (
                        <span className={cn('ml-1.5 font-medium', CLASSE_ECART[c])}>{signePct(pct)}</span>
                      ) : null
                    }
                  />
                  <D t="Catalogue" v={`${nb(l.poids_catalogue_kg, 3)} kg`} />
                  <D t="Mode du constat" v={l.mode_constat === 'PESEE' ? 'Pesée' : 'Estimation'} />
                  <D t="Constaté le" v={fmtDate(l.date_constat)} />
                  <D t="Par" v={l.responsable ?? '—'} />
                </dl>
                )
              })()}
            </div>
          )
        })}
        {lignes.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-attenue-texte">Zone vide.</p>
        )}
      </div>

      {/* La barre de gestes, collee en bas au-dessus de la zone sûre. */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 max-md:bottom-[calc(3.2rem+var(--marge-sure-bas,0px))] grid grid-cols-3 gap-1.5 border-t border-bordure
                   bg-surface p-2 shadow-[0_-2px_12px_rgba(0,0,0,.08)]"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {/* TROIS GESTES. La consommation ne s'y trouve pas : elle n'est jamais
            saisie, elle se deduit du constat. */}
        {(['CHARGE', 'DECHARGE', 'MAJ'] as TypeFiche[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => ouvrir(t)}
            className="min-h-[52px] rounded-[var(--radius-sm)] border border-bordure
                       text-[12px] font-medium text-texte active:bg-attenue"
          >
            {t === 'CHARGE' ? 'Charger' : t === 'DECHARGE' ? 'Décharger' : 'Constater'}
          </button>
        ))}
      </div>
    </div>
  )
}

function D({ t, v, suffixe }: { t: string; v: string; suffixe?: ReactNode }) {
  return (
    <>
      <dt className="text-attenue-texte">{t}</dt>
      <dd className="text-right tabular-nums text-texte">
        {v}
        {suffixe}
      </dd>
    </>
  )
}

// =============================================================================
// ECRAN 4 : LA FICHE, UNE LIGNE A LA FOIS
// =============================================================================

function FicheMobile({
  machine, zone, type, retour,
}: {
  machine: Machine
  zone: Zone
  type: TypeFiche
  retour: () => void
}) {
  const f = useFiche(machine.code_machine, zone, type)
  const v = useValiderFiche(f)
  const [active, setActive] = useState(0)
  const tolerances = useTolerancesLot()
  const qMag = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: ({ signal }) => api.get<Magasin[]>('/api/magasins?actif=1', { signal }),
    enabled: type === 'CHARGE' || type === 'DECHARGE',
  })

  const l = f.lignes[active]
  const toucheMagasin = type === 'CHARGE' || type === 'DECHARGE'
  const [choix, setChoix] = useState(false)

  /* LES LOTS DU MAGASIN D'ORIGINE, LE PLUS ANCIEN D'ABORD (FIFO). */
  const qLots = useQuery({
    queryKey: ['stock-lots-magasin', f.entete.magasin],
    queryFn: () =>
      api.get<LotDispo[]>(`/api/stock/lots?code_magasin=${encodeURIComponent(f.entete.magasin)}&limite=5000`),
    enabled: type === 'CHARGE' && !!f.entete.magasin,
  })
  const qStock = useQuery({
    queryKey: ['stock-magasin', f.entete.magasin],
    queryFn: () =>
      api.get<StockMagasin[]>(`/api/stock?code_magasin=${encodeURIComponent(f.entete.magasin)}&limite=5000`),
    enabled: type === 'CHARGE' && !!f.entete.magasin,
  })
  const lotsDe = (code: string) => (qLots.data ?? []).filter((x) => x.code_reference === code)
  const ajouterLot = (code: string, designation: string, poids: number | null, lot: string) => {
    f.ajouter({ ...ligneNeuve(code, designation, poids ?? 0, poids), lot_fournisseur: lot })
    setActive(f.lignes.length)
    setChoix(false)
  }

  if (f.envoi.isSuccess) {
    return (
      <div className="flex flex-col gap-3 pb-4">
        <Fil titre="Décision validée" sous={zone.libelle} retour={retour} />
        <Alerte ton="succes" titre={`Validation n°${f.envoi.data?.numero_validation}`}>
          {f.envoi.data?.mouvement
            ? `Mouvement ${f.envoi.data.mouvement} enregistré au magasin.`
            : 'Aucun mouvement de magasin.'}
          {` Consommation : ${nb(f.envoi.data?.consomme_kg ?? 0, 1)} kg.`}
        </Alerte>
        <button
          type="button"
          onClick={retour}
          className="min-h-[56px] rounded-[var(--radius-sm)] bg-primaire text-[15px] font-semibold text-primaire-texte"
        >
          Retour à la zone
        </button>
      </div>
    )
  }

  if (choix) {
    return (
      <ChoixLot
        magasin={f.entete.magasin}
        lots={qLots.data ?? []}
        stock={(qStock.data ?? []).filter((x) => x.quantite_kg > 0)}
        chargement={qLots.isLoading || qStock.isLoading}
        dejaPris={new Set(f.lignes.map((x) => `${x.code_reference}|${x.lot_fournisseur}`))}
        choisir={ajouterLot}
        fermer={() => setChoix(false)}
      />
    )
  }

  const e = l ? estimer(type, l) : null
  const motif = l ? f.motifDe(l.code_motif) : undefined
  const destinations = destinationsDe(motif)
  const effets = (motif?.effets_permis ?? '').split(',').filter(Boolean)
  const toutRetire = !!l && type === 'DECHARGE' && l.mouvementees > 0 && l.mouvementees >= l.avant_bobines

  return (
    <div className="flex flex-col gap-3 pb-28 max-md:pb-56">
      <Fil titre={LIBELLE_TYPE[type]} sous={zone.libelle} retour={retour} />

      {/* --- L'entete ------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-2">
        <ChampM label="Date" type="date" v={f.entete.date}
                set={(x) => f.setEntete({ ...f.entete, date: x })} />
        <ChampM label="Responsable" v={f.entete.responsable}
                set={(x) => f.setEntete({ ...f.entete, responsable: x })} />
        {toucheMagasin && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] text-attenue-texte">
              {type === 'CHARGE' ? 'Magasin d’origine' : 'Magasin de retour'}
            </span>
            <select
              value={f.entete.magasin}
              onChange={(ev) => f.setEntete({ ...f.entete, magasin: ev.target.value })}
              className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
            >
              <option value="">—</option>
              {(qMag.data ?? []).map((m) => (
                <option key={m.code_magasin} value={m.code_magasin}>{m.nom}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {type === 'CHARGE' && f.entete.magasin && <ChampScan surLecture={f.scanner} />}
      {type === 'CHARGE' && (
        <button
          type="button"
          disabled={!f.entete.magasin}
          onClick={() => setChoix(true)}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[var(--radius-sm)]
                     border border-dashed border-primaire text-[14px] font-medium text-primaire
                     disabled:border-bordure disabled:text-attenue-texte"
        >
          <Plus className="size-4" />
          {f.entete.magasin ? 'Ajouter une référence' : 'Choisissez d’abord le magasin d’origine'}
        </button>
      )}

      {/* --- Le selecteur de ligne ------------------------------------------- */}
      {f.lignes.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {f.lignes.map((x, i) => (
            <button
              key={x.cle}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'min-h-[40px] shrink-0 rounded-[var(--radius-sm)] px-3 text-[12px] font-medium',
                i === active ? 'bg-primaire text-primaire-texte' : 'border border-bordure',
                (type === 'MAJ' || x.mouvementees > 0) && i !== active && 'border-primaire/60',
              )}
            >
              {x.designation.slice(0, 14)}
            </button>
          ))}
        </div>
      )}

      {l && e && (
        <>
          {/* --- L'ETAT AVANT ET L'ESTIMATION, AU-DESSUS DU CLAVIER ----------- */}
          <div className="rounded-[var(--radius-sm)] border-y-2 border-primaire bg-attenue px-3 py-2">
            <div className="mb-1 truncate text-[13px] font-medium text-texte">{l.designation}</div>
            <R t="Avant" v={`${l.avant_bobines} bob · ${l.avant_pourcentage != null ? nb(l.avant_pourcentage, 1) + ' %' : '—'} · ${nb(l.avant_kg, 1)} kg`} />
            {l.avant_date && <R t="Dernier état le" v={fmtDate(l.avant_date)} />}
            <R t="Après (estimé)" v={`${e.nbApres} bob · ${nb(e.kgApres, 1)} kg`} fort />
            {type === 'CHARGE' && e.theorique != null && <R t="% théorique" v={`${nb(e.theorique, 1)} %`} />}
            <R t="Écart" v={`${nb(e.ecart, 1)} kg`} alerte={e.ecart < -0.0005} />
          </div>

          {/* --- La saisie ------------------------------------------------------ */}
          {type === 'CHARGE' && l.avant_bobines === 0 ? (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-attenue-texte">Lot (le plus ancien d’abord)</span>
              <select
                value={l.lot_fournisseur}
                onChange={(ev) => f.majLigne(l.cle, 'lot_fournisseur', ev.target.value)}
                className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
              >
                {!lotsDe(l.code_reference).some((x) => x.lot_fournisseur === l.lot_fournisseur) &&
                  l.lot_fournisseur !== SANS_LOT && (
                    <option value={l.lot_fournisseur}>{l.lot_fournisseur || '—'}</option>
                  )}
                {lotsDe(l.code_reference)
                  .filter((x) => x.lot_fournisseur !== SANS_LOT)
                  .map((x) => (
                    <option key={x.lot_fournisseur} value={x.lot_fournisseur}>
                      {x.lot_fournisseur} · {nb(x.quantite_kg, 0)} kg · {fmtDate(x.date_premiere_entree)}
                    </option>
                  ))}
                <option value={SANS_LOT}>Sans lot</option>
              </select>
            </label>
          ) : (
            <div className="flex items-baseline justify-between rounded-[var(--radius-sm)] border border-bordure bg-attenue px-2.5 py-2">
              <span className="text-[12px] text-attenue-texte">Lot</span>
              <span className="font-mono text-[13px]">{libelleLot(l.lot_fournisseur)}</span>
            </div>
          )}

          {type === 'CHARGE' && (
            <>
              <ChampNum label="Bobines à charger" v={l.mouvementees} set={(x) => f.majLigne(l.cle, 'mouvementees', x)} />
              <ChampNum label="Poids par bobine chargée (kg)" v={l.poids_retenu} pas={0.001}
                        set={(x) => f.majLigne(l.cle, 'poids_retenu', x)}
                        aide={(() => {
                          const rappel = rappelCatalogue({ poids: l.poids_retenu, poids_catalogue: l.poids_catalogue })
                          if (!rappel) return 'Pas de poids de bobine au catalogue'
                          const c = couleurEcart(ecartPoidsBobine({ poids: l.poids_retenu, poids_catalogue: l.poids_catalogue }), tolerances)
                          return <span className={cn('font-medium', c ? CLASSE_ECART[c] : 'text-attenue-texte')}>{rappel}</span>
                        })()} />
              <ChampNum label="% de toute la ligne après le chargement" v={l.pourcentage} pas={0.1} max={500}
                        set={(x) => f.majLigne(l.cle, 'pourcentage', x)} grand />
            </>
          )}
          {type === 'DECHARGE' && (
            <>
              <ChampNum label={`Bobines à retirer (sur ${l.avant_bobines})`} v={l.mouvementees} max={l.avant_bobines}
                        set={(x) => f.majLigne(l.cle, 'mouvementees', x)} />
              <ChampNum label="% des bobines retirées" v={l.pct_retirees} pas={0.1} max={500}
                        set={(x) => f.majLigne(l.cle, 'pct_retirees', x)} />
              {!toutRetire && (
                <ChampNum label="% des bobines qui restent" v={l.pourcentage} pas={0.1} max={500}
                          set={(x) => f.majLigne(l.cle, 'pourcentage', x)} grand />
              )}
            </>
          )}
          {type === 'MAJ' && (
            <>
              <ChampNum label="Bobines présentes" v={l.presentes} set={(x) => f.majLigne(l.cle, 'presentes', x)} />
              <ChampNum label="% constaté" v={l.pourcentage} pas={0.1} max={500}
                        set={(x) => f.majLigne(l.cle, 'pourcentage', x)} grand />
            </>
          )}

          {(type === 'MAJ' || l.mouvementees > 0) && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-attenue-texte">Motif</span>
                <select
                  value={l.code_motif}
                  onChange={(ev) => f.majLigne(l.cle, 'code_motif', ev.target.value)}
                  className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
                >
                  <option value="">—</option>
                  {f.motifs.map((m) => (
                    <option key={m.code_motif} value={m.code_motif}>{m.libelle}</option>
                  ))}
                </select>
              </label>
              {type === 'DECHARGE' && destinations.length > 1 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-attenue-texte">Destination des bobines retirées</span>
                  <select
                    value={l.destination}
                    onChange={(ev) => f.majLigne(l.cle, 'destination', ev.target.value as Destination)}
                    className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
                  >
                    <option value="">—</option>
                    {destinations.map((d) => (
                      <option key={d} value={d}>{LIBELLE_DESTINATION[d]}</option>
                    ))}
                  </select>
                </label>
              )}
              {motif && !motif.effet_defaut && (
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-attenue-texte">L’écart compte comme</span>
                  <select
                    value={l.effet_ecart}
                    onChange={(ev) => f.majLigne(l.cle, 'effet_ecart', ev.target.value)}
                    className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
                  >
                    <option value="">—</option>
                    {effets.map((x) => (
                      <option key={x} value={x}>{LIBELLE_EFFET[x] ?? x}</option>
                    ))}
                  </select>
                </label>
              )}
              <ChampM label="Précision (obligatoire si l’écart est rouge)" v={l.motif_texte}
                      set={(x) => f.majLigne(l.cle, 'motif_texte', x)} liste={RAISONS_SURPLUS} />
            </>
          )}
        </>
      )}

      {f.calculer.isError && (
        <Alerte ton="danger" titre="Aperçu impossible">{(f.calculer.error as Error).message}</Alerte>
      )}
      {f.envoi.isError && (
        <Alerte ton="danger" titre="Validation refusée">{(f.envoi.error as Error).message}</Alerte>
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-20 max-md:bottom-[calc(3.2rem+var(--marge-sure-bas,0px))] border-t border-bordure bg-surface p-2
                   shadow-[0_-2px_12px_rgba(0,0,0,.08)]"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-1.5 flex justify-between px-1 text-[12px] tabular-nums">
          <span className={cn(f.totaux.apres > f.totaux.places ? 'font-medium text-danger' : 'text-attenue-texte')}>
            {f.totaux.apres} / {f.totaux.places} places
          </span>
          <span className="font-medium text-texte">écart {nb(f.totaux.ecart, 1)} kg</span>
        </div>

        {/* L'APERCU, EN COURT : ce qui bloque, ou le feu vert. */}
        {f.apercu && f.apercu.blocages.length === 0 && (
          <div className="mb-2 max-h-[30vh] space-y-1 overflow-auto rounded-[var(--radius)] border border-l-[3px] border-succes/30 border-l-succes bg-succes/[0.06] px-3 py-2 text-[12.5px] tabular-nums">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">Ce que la validation enregistrera</p>
            {f.apercu.lignes.map((l) => (
              <div key={l.ligne_numero}>
                <span className="font-mono text-[11px]">{l.lot_fournisseur}</span>{' '}
                {l.nb_avant} · {nb(l.kg_avant, 1)} → <strong>{l.nb_apres} · {nb(l.kg_apres, 1)} kg</strong>
                <span className={TON_ECART[l.niveau_ecart ?? ''] ?? 'text-attenue-texte'}>
                  {' '}· écart {nb(l.ecart_kg, 1)} kg{l.ecart_kg !== 0 && ` (${LIBELLE_EFFET[l.effet_ecart] ?? l.effet_ecart})`}
                </span>
              </div>
            ))}
          </div>
        )}
        {f.apercu && f.apercu.blocages.length > 0 && (
          <div className="mb-2 rounded-[var(--radius)] border border-l-[3px] border-danger/30 border-l-danger bg-danger/[0.07] px-3 py-2 text-[13px]">
            {f.apercu.blocages.map((b) => (
              <p key={b}>{b.replace(/^(STOCK|LOT)-INSUFFISANT : (chargement bloque — )?/, '').replace(/\. Prevenez le directeur.*$/, '')}</p>
            ))}
            {f.stockCourt && <p className="mt-1 font-medium">Prévenez le directeur ou l’administrateur.</p>}
            <DemandesDerogation derogations={f.apercu.derogations ?? []} surDemande={() => f.calculer.mutate()} />
          </div>
        )}
        {f.apercuPerime && (
          <p className="mb-2 px-1 text-[12px] text-alerte">Saisie modifiée : refaites l’aperçu.</p>
        )}

        {v.element}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!f.pret || f.calculer.isPending}
            onClick={() => f.calculer.mutate()}
            className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-primaire text-[15px] font-semibold text-primaire disabled:opacity-40"
          >
            {f.calculer.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Aperçu
          </button>
          <button
            type="button"
            disabled={!f.peutValider || f.envoi.isPending}
            onClick={v.valider}
            className="inline-flex min-h-[56px] flex-[2] items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-primaire text-[15px] font-semibold text-primaire-texte disabled:opacity-40"
          >
            {f.envoi.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Valider
          </button>
        </div>
        {f.manque && <p className="text-center text-[13px] text-attenue-texte">{f.manque}</p>}
      </div>
    </div>
  )
}

function R({ t, v, fort, alerte }: { t: string; v: string; fort?: boolean; alerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-attenue-texte">{t}</span>
      <span
        className={cn(
          'tabular-nums',
          fort ? 'text-[17px] font-semibold' : 'text-[13px]',
          alerte ? 'text-danger' : 'text-texte',
        )}
      >
        {v}
      </span>
    </div>
  )
}

function ChampM({
  label, v, set, type = 'text', liste,
}: { label: string; v: string; set: (v: string) => void; type?: string; liste?: string[] }) {
  const idListe = liste ? `liste-${label.length}-${liste.length}` : undefined
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">{label}</span>
      {liste && (
        <datalist id={idListe}>
          {liste.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
      <input
        type={type}
        list={idListe}
        value={v}
        onChange={(e) => set(e.target.value)}
        className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2.5 text-[14px]"
      />
    </label>
  )
}

function ChampNum({
  label, v, set, pas = 1, max, grand, aide,
}: {
  label: string
  v: number
  set: (v: number) => void
  pas?: number
  max?: number
  grand?: boolean
  /** Une ligne de rappel sous le champ (le catalogue, par exemple). */
  aide?: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">{label}</span>
      <SaisieNombre
        inputMode="decimal"
        step={pas}
        max={max}
        value={v || ''}
        onChange={(e) => set(Math.min(max ?? Infinity, Number(e.target.value) || 0))}
        className={cn(
          'min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2.5 tabular-nums',
          grand ? 'text-[20px]' : 'text-[16px]',
        )}
      />
      {aide && <span className="text-[13px] tabular-nums text-attenue-texte">{aide}</span>}
    </label>
  )
}

/**
 * CHOISIR CE QU'ON CHARGE — toute reference, avec ou sans lot.
 *
 * Le point de depart est le STOCK DU MAGASIN : chaque reference qu'il tient,
 * avec le detail de ses lots quand elle en a, le plus ancien d'abord (FIFO), et
 * « Sans lot » pour ce que les lots n'expliquent pas. Une reference qui ne se
 * gere pas par lot se choisit d'un geste, sans lot.
 *
 * ET SI LE MAGASIN NE LA CONNAIT PAS ? La recherche s'ouvre a tout le
 * catalogue : la matiere est parfois la sans que le stock le sache. Le
 * chargement le dira a la validation, et proposera la correction.
 *
 * Un ecran entier, pas une fenetre : au telephone, devant le metier, on lit
 * une liste a la fois.
 */
function ChoixLot({
  magasin, lots, stock, chargement, dejaPris, choisir, fermer,
}: {
  magasin: string
  lots: LotDispo[]
  stock: StockMagasin[]
  chargement: boolean
  dejaPris: Set<string>
  choisir: (code: string, designation: string, poids: number | null, lot: string) => void
  fermer: () => void
}) {
  const [motif, setMotif] = useState('')
  const [catalogue, setCatalogue] = useState(false)
  const qCat = useQuery({
    queryKey: ['catalogue-machine'],
    queryFn: ({ signal }) => api.get<RefCatalogue[]>('/api/catalogue?actif=1&limite=2000', { signal }),
    enabled: catalogue,
  })
  const mots = motif.toLowerCase().split(/\s+/).filter(Boolean)
  const correspond = (t: string) => mots.every((m) => t.toLowerCase().includes(m))

  // Par reference du magasin : ses lots (le plus ancien d'abord), puis ce que
  // les lots n'expliquent pas.
  const refs = stock
    .map((st) => {
      const ls = lots
        .filter((x) => x.code_reference === st.code_reference && x.lot_fournisseur !== SANS_LOT)
        .sort((a, b) => a.date_premiere_entree.localeCompare(b.date_premiere_entree))
      const sansLot = st.quantite_kg - ls.reduce((t, x) => t + x.quantite_kg, 0)
      return { st, ls, sansLot }
    })
    .filter(({ st, ls }) =>
      correspond(`${st.code_reference} ${st.designation} ${ls.map((x) => `${x.lot_fournisseur} ${x.code_couleur ?? ''}`).join(' ')}`),
    )
  const horsStock = (qCat.data ?? []).filter(
    (c) => !stock.some((x) => x.code_reference === c.code_reference) && correspond(`${c.code_reference} ${c.designation}`),
  )

  const Choix = ({ code, designation, poids, lot, kg, detail, ancien }: {
    code: string; designation: string; poids: number | null; lot: string; kg?: number; detail?: string; ancien?: boolean
  }) => {
    const pris = dejaPris.has(`${code}|${lot}`)
    return (
      <button
        type="button"
        disabled={pris}
        onClick={() => choisir(code, designation, poids, lot)}
        className="flex min-h-[52px] w-full items-center gap-2 px-3 py-2 text-left active:bg-attenue disabled:opacity-40"
      >
        <div className="min-w-0 flex-1">
          <div className={cn('text-[13px] text-texte', lot === SANS_LOT ? 'italic' : 'font-mono')}>
            {libelleLot(lot)}
            {ancien && (
              <span className="ml-2 rounded-full bg-info/15 px-1.5 py-0.5 font-sans text-[10px] font-medium not-italic text-info">
                le plus ancien
              </span>
            )}
          </div>
          {detail && <div className="text-[11px] text-attenue-texte">{detail}</div>}
        </div>
        <div className="shrink-0 text-right tabular-nums">
          {kg != null && (
            <div className="text-[14px] font-semibold text-texte">
              {nb(kg, 0)}<span className="ml-0.5 text-[10px] font-normal text-attenue-texte">kg</span>
            </div>
          )}
          {pris && <div className="text-[11px] text-attenue-texte">déjà sur la fiche</div>}
        </div>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      <Fil titre="Choisir une référence" sous={`Magasin ${magasin}`} retour={fermer} />
      <label className="flex min-h-[48px] items-center gap-2 rounded-[var(--radius-sm)] border border-bordure bg-fond px-3">
        <Search className="size-4 shrink-0 text-attenue-texte" />
        <input
          autoFocus
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder="Référence, lot, couleur…"
          aria-label="Chercher une référence ou un lot"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        {motif && (
          <button type="button" onClick={() => setMotif('')} aria-label="Effacer" className="p-1 text-attenue-texte">
            <X className="size-4" />
          </button>
        )}
      </label>

      {chargement && <Chargement texte="Lecture du magasin…" />}
      {!chargement && refs.length === 0 && (
        <p className="py-3 text-center text-[13px] text-attenue-texte">
          {stock.length === 0 ? 'Ce magasin ne tient aucun stock.' : 'Rien ne correspond dans ce magasin.'}
        </p>
      )}

      {refs.map(({ st, ls, sansLot }) => (
        <div key={st.code_reference} className="overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
          <div className="border-b border-bordure bg-attenue px-3 py-1.5">
            <div className="truncate text-[13px] font-medium text-texte">{st.designation}</div>
            <div className="text-[11px] text-attenue-texte">
              {st.code_reference} · {nb(st.quantite_kg, 0)} kg en stock{st.suivi_lot ? '' : ' · ne se gère pas par lot'}
            </div>
          </div>
          <div className="divide-y divide-bordure">
            {ls.map((x, i) => (
              <Choix key={x.lot_fournisseur} code={st.code_reference} designation={st.designation}
                poids={st.poids_bobine_kg} lot={x.lot_fournisseur} kg={x.quantite_kg}
                detail={`${x.code_couleur ? `${x.code_couleur} · ` : ''}entré le ${fmtDate(x.date_premiere_entree)}`}
                ancien={i === 0 && ls.length > 1} />
            ))}
            {(ls.length === 0 || sansLot > 0.0005) && (
              <Choix code={st.code_reference} designation={st.designation} poids={st.poids_bobine_kg}
                lot={SANS_LOT} kg={ls.length === 0 ? st.quantite_kg : sansLot}
                detail={st.suivi_lot ? 'stock dont le lot n’est pas connu' : undefined} />
            )}
          </div>
        </div>
      ))}

      {/* HORS DU STOCK DE CE MAGASIN : tout le catalogue, sans lot. */}
      {!catalogue ? (
        <button
          type="button"
          onClick={() => setCatalogue(true)}
          className="min-h-[48px] rounded-[var(--radius-sm)] border border-dashed border-bordure text-[14px] text-attenue-texte"
        >
          Chercher dans tout le catalogue
        </button>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
          <div className="border-b border-bordure bg-attenue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
            Hors du stock de ce magasin
          </div>
          {qCat.isLoading && <Chargement texte="Lecture du catalogue…" />}
          <div className="divide-y divide-bordure">
            {horsStock.slice(0, 40).map((c) => (
              <div key={c.code_reference}>
                <div className="px-3 pt-2 text-[13px] font-medium text-texte">{c.designation}</div>
                <Choix code={c.code_reference} designation={c.designation} poids={c.poids_bobine_kg}
                  lot={SANS_LOT} detail={`${c.code_reference} · aucun stock connu ici`} />
              </div>
            ))}
            {!qCat.isLoading && horsStock.length === 0 && (
              <p className="px-3 py-3 text-[13px] text-attenue-texte">Rien ne correspond.</p>
            )}
            {horsStock.length > 40 && (
              <p className="px-3 py-2 text-[11px] text-attenue-texte">Précisez la recherche : {horsStock.length} références.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

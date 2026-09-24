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
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Layers, Loader2,
} from 'lucide-react'
import { api } from '../../api/client'
import { Alerte, Chargement } from '../../composants/ui/base'
import { cn } from '../../lib/utils'
import {
  etatKg, fmtDate, LIBELLE_TYPE, machinesApi, nb,
  type Machine, type TypeFiche, type Zone,
} from './noyau'
import { useFiche } from './useFiche'

interface Magasin {
  code_magasin: string
  nom: string
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
  const q = useQuery({
    queryKey: ['machine-etat', machine.code_machine, zone.code_emplacement],
    queryFn: () => machinesApi.etat(machine.code_machine, zone.code_emplacement),
  })
  const lignes = q.data ?? []

  return (
    <div className="flex flex-col gap-3 pb-28">
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
                  <div className="font-mono text-[11px] text-attenue-texte">{l.lot_fournisseur}</div>
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
              {ouvert && (
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 bg-attenue px-3 pb-3 pt-1 text-[12px]">
                  <D t="Poids par bobine" v={`${nb(l.poids_unitaire_kg, 3)} kg`} />
                  <D t="Catalogue" v={`${nb(l.poids_catalogue_kg, 3)} kg`} />
                  <D t="Mode du constat" v={l.mode_constat === 'PESEE' ? 'Pesée' : 'Estimation'} />
                  <D t="Constaté le" v={fmtDate(l.date_constat)} />
                  <D t="Par" v={l.responsable ?? '—'} />
                </dl>
              )}
            </div>
          )
        })}
        {lignes.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-attenue-texte">Zone vide.</p>
        )}
      </div>

      {/* La barre de gestes, collee en bas au-dessus de la zone sûre. */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-1.5 border-t border-bordure
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
            {t === 'CHARGE' ? 'Charger' : t === 'DECHARGE' ? 'Décharger' : 'Mettre à jour'}
          </button>
        ))}
      </div>
    </div>
  )
}

function D({ t, v }: { t: string; v: string }) {
  return (
    <>
      <dt className="text-attenue-texte">{t}</dt>
      <dd className="text-right tabular-nums text-texte">{v}</dd>
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
  const [active, setActive] = useState(0)
  const qMag = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: () => api.get<Magasin[]>('/api/magasins?actif=1'),
    enabled: type === 'CHARGE' || type === 'DECHARGE',
  })

  const l = f.lignes[active]
  const toucheMagasin = type === 'CHARGE' || type === 'DECHARGE'

  if (f.envoi.isSuccess) {
    return (
      <div className="flex flex-col gap-3 pb-4">
        <Fil titre="Fiche validée" sous={zone.libelle} retour={retour} />
        <Alerte ton="succes" titre="Constat enregistré">
          {f.envoi.data?.mouvement
            ? `Mouvement ${f.envoi.data.mouvement} enregistré au magasin.`
            : 'Aucun mouvement : cette fiche ne touche aucun magasin.'}
        </Alerte>
        <button
          type="button"
          onClick={retour}
          className="min-h-[56px] rounded-[var(--radius-sm)] bg-primaire text-[15px]
                     font-semibold text-primaire-texte"
        >
          Retour à la zone
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-28">
      <Fil titre={LIBELLE_TYPE[type]} sous={zone.libelle} retour={retour} />

      {/* --- L'entete, replie en trois champs -------------------------- */}
      <div className="grid grid-cols-2 gap-2">
        <ChampM label="Date" type="date" v={f.entete.date}
                set={(v) => f.setEntete({ ...f.entete, date: v })} />
        <ChampM label="Responsable" v={f.entete.responsable}
                set={(v) => f.setEntete({ ...f.entete, responsable: v })} />
        {/* LE NOMBRE D'EMPLACEMENTS FAIT AUTORITE. Le magasinier constate le
            physique : s'il declare 1300 la ou le parametrage en porte 1344,
            c'est la zone qui passera a 1300 a la validation. */}
        {type !== 'MAJ' && (
          <ChampNum label="Emplacements de la zone" v={f.entete.bobinesEtage}
                    set={(v) => f.setEntete({ ...f.entete, bobinesEtage: v })} />
        )}
        {toucheMagasin && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] text-attenue-texte">
              {type === 'CHARGE' ? 'Magasin d’origine' : 'Magasin de retour'}
            </span>
            <select
              value={f.entete.magasin}
              onChange={(e) => f.setEntete({ ...f.entete, magasin: e.target.value })}
              className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
            >
              <option value="">—</option>
              {(qMag.data ?? []).map((m) => (
                <option key={m.code_magasin} value={m.code_magasin}>
                  {m.nom}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* --- Le sélecteur de ligne -------------------------------------- */}
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
              )}
            >
              {x.designation.slice(0, 14)}
            </button>
          ))}
        </div>
      )}

      {l && (
        <>
          {/* --- LE CONSTAT, AU-DESSUS DU CLAVIER ---------------------- */}
          <div className="rounded-[var(--radius-sm)] border-y-2 border-primaire bg-attenue px-3 py-2">
            <div className="mb-1 truncate text-[13px] font-medium text-texte">{l.designation}</div>
            <R t="Avant" v={`${l.avant_bobines} bob · ${nb(l.avant_kg)} kg`} />
            {l.avant_date && <R t="Constaté le" v={fmtDate(l.avant_date)} />}
            <R t="Constaté maintenant" v={`${nb(etatKg(l))} kg`} fort />
            {/* PAS DE CONSOMMATION ICI. Elle ne s'attribue pas a un
                chargement : elle se lit en cumul, dans le journal. Afficher un
                chiffre par ligne inviterait a le croire. */}
            <R t="Écart avec l’état d’avant" v={`${nb(etatKg(l) - l.avant_kg)} kg`} />
          </div>

          {/* --- La saisie, un champ par ligne ------------------------- */}
          <ChampM label="Lot" v={l.lot_fournisseur}
                  set={(v) => f.majLigne(l.cle, 'lot_fournisseur', v)} />
          {(type === 'CHARGE' || type === 'DECHARGE') && (
            <ChampNum
              label={type === 'DECHARGE' ? 'Bobines retirées' : 'Bobines chargées'}
              v={l.mouvementees}
              set={(v) => f.majLigne(l.cle, 'mouvementees', v)}
            />
          )}
          {/* UNE MISE A JOUR NE CHANGE QUE LES POURCENTAGES. Le compte ne
              baisse que par un dechargement ou une redistribution — les deux
              passent par une autre fiche. */}
          {type === 'MAJ' ? (
            <div className="flex items-baseline justify-between rounded-[var(--radius-sm)]
                            border border-bordure bg-attenue px-2.5 py-2">
              <span className="text-[12px] text-attenue-texte">Bobines présentes</span>
              <span className="text-[16px] font-medium tabular-nums text-texte">{l.presentes}</span>
            </div>
          ) : (
            <ChampNum
              label={`Bobines présentes après (max ${zone.capacite_bobines})`}
              v={l.presentes}
              set={(v) => f.majLigne(l.cle, 'presentes', v)}
            />
          )}
          <ChampNum label="Poids par bobine (kg)" v={l.poids_unitaire} pas={0.001}
                    set={(v) => f.majLigne(l.cle, 'poids_unitaire', v)} />
          <ChampNum label="Pourcentage restant" v={l.pourcentage} pas={0.1} max={100}
                    set={(v) => f.majLigne(l.cle, 'pourcentage', v)} grand />
        </>
      )}

      {f.totaux.ecart !== 0 && (
        <Alerte
          ton="danger"
          titre={f.totaux.ecart < 0 ? 'Compte incomplet' : 'Trop de bobines'}
        >
          {f.totaux.ecart < 0
            ? `Il manque ${-f.totaux.ecart} bobines sur ${f.entete.bobinesEtage}. Saisissez ce que vous avez monté : les présentes suivront.`
            : `${f.totaux.ecart} bobines de trop sur ${f.entete.bobinesEtage}.`}
        </Alerte>
      )}
      {f.envoi.isError && (
        <Alerte ton="danger" titre="Validation refusée">
          {(f.envoi.error as Error).message}
        </Alerte>
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-bordure bg-surface p-2
                   shadow-[0_-2px_12px_rgba(0,0,0,.08)]"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-1.5 flex justify-between px-1 text-[12px] tabular-nums">
          <span className={cn(f.totaux.ecart !== 0 ? 'font-medium text-danger' : 'text-attenue-texte')}>
            {f.totaux.presentes} / {f.entete.bobinesEtage} bobines
          </span>
          <span className="font-medium text-texte">{nb(f.totaux.etatKg)} kg constatés</span>
        </div>
        {/* MEME QUESTION QU'AU BUREAU, en plus court : sur un telephone tenu
            d'une main devant un metier, on lit trois lignes, pas dix. */}
        {f.lotCourt && (
          <div className="mb-2 rounded-[var(--radius)] border border-l-[3px] border-alerte/30
                          border-l-alerte bg-alerte/[0.09] px-3 py-2.5 text-[13px]">
            <p className="leading-relaxed">
              Le solde connu de ce lot ne couvre pas la sortie. Les retours de machine
              sont imputes au juge : la matiere est peut-etre bien la.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={f.envoi.isPending}
                onClick={() => f.envoi.mutate(true)}
                className="min-h-[44px] flex-1 rounded-[var(--radius-sm)] bg-alerte px-3
                           text-[14px] font-semibold text-surface disabled:opacity-40"
              >
                Charger quand meme
              </button>
              <button
                type="button"
                onClick={f.oublierLotCourt}
                className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure px-3
                           text-[14px] font-medium"
              >
                Corriger
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!f.pret || f.envoi.isPending}
          onClick={() => f.envoi.mutate(undefined)}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2
                     rounded-[var(--radius-sm)] bg-primaire text-[15px] font-semibold
                     text-primaire-texte disabled:opacity-40"
        >
          {f.envoi.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Valider la fiche
        </button>
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
  label, v, set, type = 'text',
}: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
        className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2.5 text-[14px]"
      />
    </label>
  )
}

function ChampNum({
  label, v, set, pas = 1, max, grand,
}: {
  label: string
  v: number
  set: (v: number) => void
  pas?: number
  max?: number
  grand?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">{label}</span>
      <input
        type="number"
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
    </label>
  )
}

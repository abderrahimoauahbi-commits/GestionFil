/**
 * Machines — l'interface de bureau.
 *
 * CE N'EST PAS L'ECRAN MOBILE ELARGI. Un poste de bureau sert a comparer, a
 * verifier et a corriger.
 *
 *   /machines          la liste des machines
 *   /machines/:code    une machine : ses etages, ses fiches, sa consommation,
 *                      filtres par l'etage choisi (?etage=…)
 *
 * Les fiches s'ouvrent sur leur propre ecran (`Fiche.tsx`), jamais en fenetre
 * surgissante : ce sont des documents.
 *
 * LE MODELE DU 05/10/2026 : chaque validation est une DECISION. Seule la
 * derniere decision d'un etage se devalide ou s'annule ; les autres se
 * reparent par un constat « Correction ».
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Cog, Eye, Minus, Pencil, PencilLine, Plus, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { Alerte, Badge, Bouton, Chargement } from '../../composants/ui/base'
import { Onglet, OngletContenu, Onglets, OngletsListe } from '../../composants/ui/surcouches'
import { EnTetePage } from '../../composants/Coquille'
import { cn, fmt } from '../../lib/utils'
import { useEtatDepuisParam, useOuvrirVue } from '../../lib/navigation'
import { useAuth } from '../../auth/AuthContext'
import {
  cheminMachine, cheminNouvelleFiche, fmtDate, LIBELLE_TYPE, machinesApi, nb,
  type Fiche, type LigneConso, type Machine, type TypeFiche, type Zone,
} from './noyau'
import { GesteRetrait } from './Fiche'
import { PanneRequetes } from '../../composants/PanneRequetes'
import { StatutBadge } from '../../composants/StatutBadge'

// =============================================================================
// LA LISTE DES MACHINES
// =============================================================================

export function MachinesBureau() {
  const ouvrir = useOuvrirVue()
  /* CET ECRAN NE DECLARE PAS DE MACHINE, ET C'EST VOULU : le parc est du
     parametrage, il vit sous PARAMETRES. On garde le chemin, pour qui a le droit. */
  const { peut } = useAuth()
  const parametrable = peut('PARAMETRES', 'ECRIRE')
  const qMachines = useQuery({ queryKey: ['machines'], queryFn: machinesApi.liste })
  if (qMachines.isLoading) return <Chargement texte="Lecture des machines…" />
  const machines = qMachines.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Machines"
        description="Ce que chaque métier porte, et les trois gestes du magasin."
        actions={parametrable ? <LienParc libelle="Le parc" /> : null}
      />
      <PanneRequetes requetes={[['Les machines', qMachines]]} />
      {qMachines.isError ? null : machines.length === 0 ? (
        <Vide
          texte={
            parametrable
              ? 'Aucune machine declaree. Passez par « Le parc » pour en saisir une.'
              : 'Aucune machine declaree. La direction doit les saisir.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
          <table className="grille w-full text-[12.5px]">
            <thead>
              <tr className="bg-attenue">
                {['Machine', 'Etages', 'Bobines', 'Charge', 'Etat', ''].map((e, i) => (
                  <th
                    key={e || i}
                    className={cn(
                      'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-attenue-texte',
                      i >= 1 && i <= 2 && 'text-right',
                    )}
                  >
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => {
                const part = m.capacite_bobines > 0 ? (m.bobines_presentes / m.capacite_bobines) * 100 : 0
                return (
                  <tr
                    key={m.code_machine}
                    className="cursor-pointer transition-colors hover:bg-primaire/5"
                    onClick={() => ouvrir(cheminMachine(m.code_machine))}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-texte">{m.nom}</div>
                      <div className="text-[11px] text-attenue-texte">{m.code_machine}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.nb_etages}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m.bobines_presentes} / {m.capacite_bobines}
                    </td>
                    <td className="px-3 py-2"><Jauge part={part} /></td>
                    <td className="px-3 py-2"><StatutBadge entite="machine" code={m.etat} /></td>
                    <td className="px-3 py-2 text-right text-[12px] text-primaire">Ouvrir</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LienParc({ libelle }: { libelle: string }) {
  return (
    <Link
      to="/parc-machines"
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-bordure px-2.5 py-1.5
                 text-[12px] font-medium transition-colors hover:bg-attenue"
    >
      <Cog className="size-3.5" />
      {libelle}
    </Link>
  )
}

function Jauge({ part }: { part: number }) {
  return (
    <div className="h-2 w-24 rounded-full bg-attenue">
      <div
        className={cn('h-full rounded-full', part > 90 ? 'bg-succes' : part > 40 ? 'bg-primaire' : 'bg-alerte')}
        style={{ width: `${Math.min(100, part)}%` }}
      />
    </div>
  )
}

function Vide({ texte }: { texte: string }) {
  return <p className="px-3 py-6 text-center text-[13px] text-attenue-texte">{texte}</p>
}

// =============================================================================
// UNE MACHINE
// =============================================================================

type Vue = 'etages' | 'fiches' | 'mouvements' | 'conso'

/**
 * UNE MACHINE, FILTREE PAR L'ETAGE CHOISI. L'etage se choisit en tete (ou en
 * cliquant sa ligne) et s'applique aux trois onglets : son contenu, ses
 * fiches, sa consommation. « Toute la machine » les montre tous.
 */
export function MachineEcran() {
  const { code = '' } = useParams()
  const ouvrir = useOuvrirVue()
  const { peut } = useAuth()
  const [etage, setEtage] = useEtatDepuisParam('etage')
  const [vue, setVue] = useState<Vue>(etage ? 'fiches' : 'etages')

  const qMachines = useQuery({ queryKey: ['machines'], queryFn: machinesApi.liste })
  const qPlan = useQuery({ queryKey: ['machine-plan', code], queryFn: () => machinesApi.plan(code) })
  if (qMachines.isLoading || qPlan.isLoading) return <Chargement texte="Lecture de la machine…" />
  const machine = (qMachines.data ?? []).find((m) => m.code_machine === code)
  if (!machine) return <Alerte ton="danger" titre="Machine introuvable">{code}</Alerte>
  const zones = qPlan.data ?? []
  const zone = zones.find((z) => z.code_emplacement === etage)

  const choisir = (c: string, versFiches = false) => {
    setEtage(c)
    if (versFiches && c) setVue('fiches')
  }

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={zone ? `${machine.nom} · ${zone.libelle}` : machine.nom}
        description={`${machine.code_machine} · ${machine.bobines_presentes} / ${machine.capacite_bobines} bobines`}
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir('/machines')}>
              <ArrowLeft />
              Toutes les machines
            </Bouton>
            {zone && <Gestes machine={machine} zone={zone} />}
            {peut('PARAMETRES', 'ECRIRE') && <LienParc libelle="Modifier la machine" />}
          </>
        }
      />

      {/* --- Le choix de l'etage : il filtre tout l'ecran ------------------- */}
      <div className="flex flex-wrap gap-1.5">
        <Puce actif={!etage} onClick={() => choisir('')}>
          Toute la machine
        </Puce>
        {zones.map((z) => (
          <Puce key={z.code_emplacement} actif={etage === z.code_emplacement} onClick={() => choisir(z.code_emplacement)}>
            {z.libelle}
            <span className="ml-1.5 tabular-nums opacity-70">
              {z.bobines_presentes}/{z.capacite_bobines}
            </span>
          </Puce>
        ))}
      </div>

      <Onglets value={vue} onValueChange={(v) => setVue(v as Vue)}>
        <OngletsListe>
          <Onglet value="etages">{zone ? 'Contenu de l’étage' : 'Étages'}</Onglet>
          <Onglet value="fiches">{zone ? 'Fiches de l’étage' : 'Fiches'}</Onglet>
          <Onglet value="mouvements">Mouvements</Onglet>
          <Onglet value="conso">Consommation</Onglet>
        </OngletsListe>
        <OngletContenu value="etages" className="mt-3">
          <TableEtages machine={machine} zones={zones} etage={etage} choisir={(c) => choisir(c, true)} />
        </OngletContenu>
        <OngletContenu value="fiches" className="mt-3">
          <FichesMachine machine={machine} zones={zones} etage={etage} />
        </OngletContenu>
        <OngletContenu value="mouvements" className="mt-3">
          <MouvementsMachine machine={machine} etage={etage} />
        </OngletContenu>
        <OngletContenu value="conso" className="mt-3">
          <JournalMachine machine={machine} etage={etage} />
        </OngletContenu>
      </Onglets>
    </div>
  )
}

function Puce({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        'inline-flex min-h-[30px] items-center rounded-full border px-3 text-[12.5px] transition-colors',
        actif
          ? 'border-primaire bg-primaire text-primaire-texte'
          : 'border-bordure bg-surface text-texte hover:border-primaire/50 hover:bg-primaire/5',
      )}
    >
      {children}
    </button>
  )
}

/** Les trois gestes du magasin sur un etage : chacun ouvre une fiche sur son ecran. */
function Gestes({ machine, zone, compact }: { machine: Machine; zone: Zone; compact?: boolean }) {
  const ouvrir = useOuvrirVue()
  /* LA CORRECTION (F22, 09/10/2026) : quand l'erreur n'est pas sur la derniere
     fiche de l'etage, on ne remonte pas le temps — on constate l'etat reel avec
     le motif « Correction », juge par les seuils (regle 2). */
  const gestes: [TypeFiche, string, React.ComponentType<{ className?: string }>, string][] = [
    ['CHARGE', 'Charger', Plus, ''],
    ['DECHARGE', 'Décharger', Minus, ''],
    ['MAJ', 'Constater', RefreshCw, ''],
    ['MAJ', 'Corriger', PencilLine, '?motif=MJ_CORRECTION'],
  ]
  return (
    <div className="inline-flex gap-1">
      {gestes.map(([type, titre, Icone, suite]) => (
        <button
          key={titre}
          type="button"
          title={`${titre} — ${zone.libelle}`}
          aria-label={titre}
          onClick={(e) => {
            e.stopPropagation()
            ouvrir(cheminNouvelleFiche(machine.code_machine, type, zone.code_emplacement) + suite)
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-bordure text-attenue-texte',
            'transition-colors hover:border-primaire/50 hover:bg-primaire/10 hover:text-primaire',
            compact ? 'size-6 justify-center' : 'min-h-[32px] px-2.5 text-[12.5px] font-medium',
          )}
        >
          <Icone className="size-3.5" />
          {!compact && titre}
        </button>
      ))}
    </div>
  )
}

// =============================================================================
// LES ETAGES ET LEUR CONTENU
// =============================================================================

/**
 * TOUS LES ETAGES (OU LE SEUL CHOISI) ET LEUR CONTENU. Les etages vides y
 * figurent : c'est la qu'il faut charger. Un clic sur un etage le choisit et
 * montre ses fiches ; les trois gestes sont sur la ligne.
 */
function TableEtages({
  machine, zones, etage, choisir,
}: { machine: Machine; zones: Zone[]; etage: string; choisir: (code: string) => void }) {
  const q = useQuery({
    queryKey: ['machine-contenu', machine.code_machine],
    queryFn: () => machinesApi.contenu(machine.code_machine),
  })
  if (q.isLoading) return <Chargement texte="Lecture de la machine…" />

  const lignes = (q.data ?? []).filter((l) => !etage || l.code_emplacement === etage)
  const parZone = new Map<string, typeof lignes>()
  for (const l of lignes) {
    if (!parZone.has(l.code_emplacement)) parZone.set(l.code_emplacement, [])
    parZone.get(l.code_emplacement)!.push(l)
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
      <div className="max-h-[70vh] overflow-auto">
        <table className="grille w-full text-[12.5px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-attenue">
              {['Etage', 'Reference', 'Couleur', 'Lot', 'Bobines', '%', 'Kg', 'Constat', ''].map((e, i) => (
                <th
                  key={e || i}
                  className={cn(
                    'bg-attenue px-2.5 py-1.5 text-left text-[10px] font-semibold',
                    'uppercase tracking-wider text-attenue-texte whitespace-nowrap',
                    i >= 4 && i <= 6 && 'text-right',
                  )}
                >
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...parZone.entries()].map(([code, contenu]) => {
              const zone = zones.find((z) => z.code_emplacement === code)
              const montees = contenu.reduce((s, x) => s + (x.nb_bobines ?? 0), 0)
              const choisi = etage === code
              return contenu.map((l, i) => (
                <tr
                  key={`${code}-${l.code_reference ?? 'vide'}-${l.lot_fournisseur ?? i}`}
                  onClick={() => choisir(code)}
                  title={`Voir les fiches de ${l.zone_libelle}`}
                  className={cn('cursor-pointer transition-colors hover:bg-primaire/5', choisi && 'bg-primaire/5')}
                >
                  {i === 0 && (
                    <td rowSpan={contenu.length} className="whitespace-nowrap px-2.5 py-1.5 align-top font-medium">
                      {l.zone_libelle}
                      <div className="text-[10.5px] font-normal text-attenue-texte">
                        {montees} / {l.capacite_bobines}
                      </div>
                    </td>
                  )}
                  {l.code_reference ? (
                    <>
                      <td className="px-2.5 py-1.5">{l.code_reference}</td>
                      <td className="px-2.5 py-1.5 text-attenue-texte">{l.couleur ?? '—'}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[11px]">{l.lot_fournisseur ?? '—'}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{l.nb_bobines ?? '—'}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {l.pourcentage != null ? `${nb(l.pourcentage, 1)} %` : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{nb(l.kg ?? 0)}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-attenue-texte">
                        {l.date_constat ? fmtDate(l.date_constat) : '—'}
                      </td>
                    </>
                  ) : (
                    <td colSpan={7} className="px-2.5 py-1.5 text-attenue-texte">
                      Vide — {l.capacite_bobines} emplacements disponibles
                    </td>
                  )}
                  {i === 0 && (
                    <td rowSpan={contenu.length} className="w-px px-2 py-1.5 align-top">
                      {zone && <Gestes machine={machine} zone={zone} compact />}
                    </td>
                  )}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// =============================================================================
// LES FICHES
// =============================================================================

const STATUT: Record<string, { libelle: string; ton: 'alerte' | 'succes' | 'neutre' }> = {
  BROUILLON: { libelle: 'Brouillon', ton: 'alerte' },
  VALIDE: { libelle: 'Validée', ton: 'succes' },
  ANNULE: { libelle: 'Annulée', ton: 'neutre' },
}

/**
 * LES FICHES DE LA MACHINE, OU DU SEUL ETAGE CHOISI, la plus recente en tete.
 * Un clic ouvre la fiche sur son ecran. « Dévalider » et « Annuler » ne
 * figurent que sur la DERNIERE decision de chaque etage : c'est la seule qui
 * se retire seule (les autres se reparent par un constat « Correction »).
 */
function FichesMachine({ machine, zones, etage }: { machine: Machine; zones: Zone[]; etage: string }) {
  const ouvrir = useOuvrirVue()
  // Devalider ou annuler une decision validee demande VALIDER (regle 15).
  const { peut } = useAuth()
  const peutRetirer = peut('MOUVEMENTS', 'VALIDER')
  const [geste, setGeste] = useState<{ fiche: Fiche; mode: 'devalider' | 'annuler' } | null>(null)
  const q = useQuery({
    queryKey: ['machine-fiches', machine.code_machine, etage],
    queryFn: () => machinesApi.fiches(machine.code_machine, etage || undefined),
  })
  if (q.isLoading) return <Chargement texte="Lecture des fiches…" />
  const fiches = q.data ?? []
  const libelleZone = (c: string) => zones.find((z) => z.code_emplacement === c)?.libelle ?? c

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
      <div className="max-h-[70vh] overflow-auto">
        <table className="grille w-full text-[12.5px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="bg-attenue px-2.5 py-1.5 text-left">Fiche</th>
              <th className="bg-attenue px-2.5 py-1.5 text-left">Type</th>
              {!etage && <th className="bg-attenue px-2.5 py-1.5 text-left">Etage</th>}
              <th className="bg-attenue px-2.5 py-1.5 text-left">Date</th>
              <th className="bg-attenue px-2.5 py-1.5 text-left">Responsable</th>
              <th className="bg-attenue px-2.5 py-1.5 text-left">Validée par</th>
              <th className="bg-attenue px-2.5 py-1.5 text-left">Statut</th>
              <th className="bg-attenue px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {fiches.map((f) => {
              const tete = Number(f.est_tete) === 1
              const s = STATUT[f.statut] ?? STATUT.ANNULE
              return (
                <tr
                  key={f.id_fiche}
                  onClick={() => ouvrir(`/machines/fiches/${f.id_fiche}`)}
                  className={cn('cursor-pointer transition-colors hover:bg-primaire/5', tete && 'bg-succes/[0.04]')}
                >
                  <td className="px-2.5 py-1.5 font-mono text-[11.5px]">{f.numero_fiche}</td>
                  <td className="px-2.5 py-1.5">{LIBELLE_TYPE[f.type_fiche]}</td>
                  {!etage && <td className="px-2.5 py-1.5">{libelleZone(f.code_emplacement)}</td>}
                  <td className="px-2.5 py-1.5 tabular-nums">{fmtDate(f.date_fiche)}</td>
                  <td className="px-2.5 py-1.5 text-attenue-texte">{f.responsable}</td>
                  <td className="px-2.5 py-1.5 text-attenue-texte">{f.statut === 'VALIDE' ? f.valide_par ?? '—' : '—'}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    <Badge ton={s.ton}>{s.libelle}</Badge>
                    {tete && <Badge ton="info" className="ml-1">dernière de l’étage</Badge>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      {f.statut === 'BROUILLON' ? (
                        <BoutonFiche titre="Reprendre" Icone={Pencil} onClick={() => ouvrir(`/machines/fiches/${f.id_fiche}`)} />
                      ) : (
                        <BoutonFiche titre="Ouvrir" Icone={Eye} onClick={() => ouvrir(`/machines/fiches/${f.id_fiche}`)} />
                      )}
                      {f.statut === 'VALIDE' && tete && peutRetirer && (
                        <BoutonFiche titre="Dévalider" Icone={RotateCcw} onClick={() => setGeste({ fiche: f, mode: 'devalider' })} />
                      )}
                      {(f.statut === 'BROUILLON' || (f.statut === 'VALIDE' && tete && peutRetirer)) && (
                        <BoutonFiche titre="Annuler" Icone={XCircle} onClick={() => setGeste({ fiche: f, mode: 'annuler' })} />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {fiches.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2.5 py-6 text-center text-attenue-texte">
                  {etage ? `Aucune fiche sur ${libelleZone(etage)}.` : 'Aucune fiche.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {geste && <GesteRetrait fiche={geste.fiche} mode={geste.mode} fermer={() => setGeste(null)} />}
    </div>
  )
}

function BoutonFiche({
  titre, Icone, onClick,
}: { titre: string; Icone: React.ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button
      type="button"
      title={titre}
      aria-label={titre}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-bordure px-1.5 py-0.5
                 text-[11px] text-attenue-texte transition-colors hover:border-primaire/50 hover:text-primaire"
    >
      <Icone className="size-3" />
      {titre}
    </button>
  )
}

// =============================================================================
// LE JOURNAL DE CONSOMMATION
// =============================================================================

/**
 * LA CONSOMMATION EST LA SOMME DES ECARTS QUALIFIES « consommation » des
 * decisions actives (05/10/2026). Les pertes, dechets, casses, les ecarts non
 * qualifies et les regularisations sont montres a part : ils ne sont pas du
 * fil tisse.
 */
function JournalMachine({ machine, etage }: { machine: Machine; etage: string }) {
  const [texte, setTexte] = useState('')
  const q = useQuery({
    queryKey: ['machine-conso', machine.code_machine],
    queryFn: () => machinesApi.consommation(machine.code_machine),
  })
  if (q.isLoading) return <Chargement texte="Lecture du journal…" />

  const tout = (q.data ?? []).filter((l) => !etage || l.code_emplacement === etage)
  const motif = texte.trim().toLowerCase()
  const lignes = tout.filter(
    (l) =>
      !motif ||
      (l.code_reference ?? '').toLowerCase().includes(motif) ||
      (l.lot_fournisseur ?? '').toLowerCase().includes(motif),
  )

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-bordure bg-attenue/60 px-3 py-2">
        <span className="text-[11px] text-attenue-texte">
          {lignes.length} ligne(s){lignes.length !== tout.length ? ` sur ${tout.length}` : ''}
        </span>
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Référence ou lot…"
          className="ml-auto w-52 rounded-[var(--radius-sm)] border border-bordure bg-surface px-2.5 py-1 text-[12px]
                     outline-none focus:border-primaire/60"
        />
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <TableConso lignes={lignes} />
      </div>
    </div>
  )
}

/**
 * LES MOUVEMENTS MACHINE (F22, 09/10/2026) : le cote machine, isole du grand
 * livre. Chaque decision, ligne par ligne, avec le mouvement magasin qui en est
 * l'autre moitie — et son annulation quand la fiche a ete retiree. Seule la
 * derniere decision d'un etage se retire ; on remonte ainsi pas a pas.
 */
function MouvementsMachine({ machine, etage }: { machine: Machine; etage: string }) {
  const ouvrir = useOuvrirVue()
  const q = useQuery({
    queryKey: ['machine-mouvements', machine.code_machine, etage],
    queryFn: () => machinesApi.mouvements(machine.code_machine, etage || undefined),
  })
  if (q.isLoading) return <Chargement texte="Lecture des mouvements…" />
  if (q.isError) return <Alerte ton="danger">Les mouvements de la machine n’ont pas pu être lus.</Alerte>
  const lignes = q.data ?? []
  if (lignes.length === 0) return <Vide texte="Aucune décision sur cette machine." />
  const kg = (v: number | null | undefined) => (v == null ? '—' : fmt.nombre(v, 1))
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
      <div className="max-h-[70vh] overflow-auto">
        <table className="grille w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="bg-attenue px-2 py-1.5 text-left">Date</th>
              <th className="bg-attenue px-2 py-1.5 text-left">Fiche</th>
              {!etage && <th className="bg-attenue px-2 py-1.5 text-left">Étage</th>}
              <th className="bg-attenue px-2 py-1.5 text-left">Référence · lot</th>
              <th className="bg-attenue px-2 py-1.5 text-right">Avant</th>
              <th className="bg-attenue px-2 py-1.5 text-right">Chargé / retiré</th>
              <th className="bg-attenue px-2 py-1.5 text-right">Après</th>
              <th className="bg-attenue px-2 py-1.5 text-right">Écart</th>
              <th className="bg-attenue px-2 py-1.5 text-left">Mouvement magasin</th>
              <th className="bg-attenue px-2 py-1.5 text-left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const retire = l.nature === 'DECHARGE'
              return (
                <tr key={`${l.id_decision}-${l.ligne_numero}`} className={cn(l.statut !== 'ACTIVE' && 'text-attenue-texte line-through decoration-attenue-texte/40')}>
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums">{fmtDate(l.date_decision)}</td>
                  <td className="px-2 py-1">
                    {l.id_fiche ? (
                      <button type="button" className="font-mono text-[11.5px] text-primaire hover:underline"
                        onClick={() => ouvrir(`/machines/fiches/${l.id_fiche}`)}>
                        {l.numero_fiche}
                      </button>
                    ) : '—'}
                    <div className="text-[10.5px] text-attenue-texte">{LIBELLE_TYPE[l.nature as TypeFiche] ?? l.nature}</div>
                  </td>
                  {!etage && <td className="px-2 py-1">{l.zone ?? l.code_emplacement}</td>}
                  <td className="px-2 py-1">
                    {l.code_reference}
                    <div className="text-[10.5px] text-attenue-texte">{l.lot_fournisseur || '—'}</div>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{kg(l.kg_avant)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.kg_mouvementes ? `${retire ? '−' : '+'}${kg(l.kg_mouvementes)}` : '—'}
                    {retire && l.destination && <div className="text-[10.5px] text-attenue-texte">{l.destination.toLowerCase()}</div>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{kg(l.kg_apres)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {Math.abs(l.ecart_kg) < 0.0005 ? '—' : kg(l.ecart_kg)}
                    {l.niveau_ecart && l.niveau_ecart !== 'AUCUN' && (
                      <div className="text-[10.5px] text-attenue-texte">{(l.effet_ecart ?? '').toLowerCase()} · {l.niveau_ecart.toLowerCase()}</div>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {l.id_mouvement ? (
                      <button type="button" className="font-mono text-[11.5px] text-primaire hover:underline"
                        onClick={() => ouvrir(`/mouvements/${l.id_mouvement}`)}>
                        {l.numero_mouvement}
                      </button>
                    ) : <span className="text-attenue-texte">aucun (constat)</span>}
                    {l.id_annulation && (
                      <div className="text-[10.5px]">
                        annulé par{' '}
                        <button type="button" className="font-mono text-primaire hover:underline"
                          onClick={() => ouvrir(`/mouvements/${l.id_annulation}`)}>
                          {l.numero_annulation}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <Badge ton={l.statut === 'ACTIVE' ? 'succes' : 'neutre'}>
                      {l.statut === 'ACTIVE' ? 'active' : l.statut === 'RETIREE' ? 'dévalidée' : 'annulée'}
                    </Badge>
                    {l.est_tete === 1 && l.statut === 'ACTIVE' && <Badge ton="info" className="ml-1">dernière</Badge>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TableConso({ lignes }: { lignes: LigneConso[] }) {
  const total = (k: keyof LigneConso) => lignes.reduce((s, l) => s + Number(l[k] ?? 0), 0)
  const enTete = ['Zone', 'Référence', 'Lot', 'Départ', 'Chargé', 'Retour magasin', 'Sorti (perte, déchet…)', 'Fin',
                  'Consommé', 'Déchet / perte / casse', 'Non qualifié', 'Régularisation', 'Erreur de saisie']
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
            {enTete.map((e, i) => (
              <th key={e} className={cn('px-2 py-1.5', i >= 3 ? 'text-right' : 'text-left')}>{e}</th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lignes.map((l, i) => (
            <tr key={i} className="border-t border-bordure">
              <td className="px-2 py-1.5">{l.zone}</td>
              <td className="max-w-[18rem] truncate px-2 py-1.5">{l.designation}</td>
              <td className="px-2 py-1.5 font-mono text-[11px]">{l.lot_fournisseur}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_debut)}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_charge)}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_retourne)}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_sorti_autre)}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_fin)}</td>
              <td className={cn('px-2 py-1.5 text-right font-medium', l.consommation_kg < 0 ? 'text-danger' : 'text-texte')}>
                {nb(l.consommation_kg)}
              </td>
              <td className="px-2 py-1.5 text-right">{nb(l.dechet_perte_casse_kg)}</td>
              <td className={cn('px-2 py-1.5 text-right', l.non_qualifie_kg ? 'text-alerte' : '')}>{nb(l.non_qualifie_kg)}</td>
              <td className={cn('px-2 py-1.5 text-right', l.regularisation_kg ? 'text-alerte' : '')}>{nb(l.regularisation_kg)}</td>
              <td className="px-2 py-1.5 text-right">{nb(l.erreur_saisie_kg)}</td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr>
              <td colSpan={13} className="px-2 py-6 text-center text-attenue-texte">
                Aucune décision enregistrée depuis la fiche de départ.
              </td>
            </tr>
          )}
        </tbody>
        {lignes.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-ink/20 bg-attenue font-semibold tabular-nums">
              <td className="px-2 py-1.5" colSpan={8}>Total</td>
              <td className="px-2 py-1.5 text-right">{nb(total('consommation_kg'))}</td>
              <td className="px-2 py-1.5 text-right">{nb(total('dechet_perte_casse_kg'))}</td>
              <td className="px-2 py-1.5 text-right">{nb(total('non_qualifie_kg'))}</td>
              <td className="px-2 py-1.5 text-right">{nb(total('regularisation_kg'))}</td>
              <td className="px-2 py-1.5 text-right">{nb(total('erreur_saisie_kg'))}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/**
 * Machines — l'interface de bureau.
 *
 * CE N'EST PAS L'ECRAN MOBILE ELARGI. Un poste de bureau sert a comparer, a
 * verifier et a corriger : trois colonnes tiennent a l'ecran, la grille de
 * saisie se remplit au clavier sans jamais lever les mains, et la consommation
 * previsionnelle s'affiche pendant qu'on tape — c'est elle qu'on relit avant
 * de valider, pas les kilos.
 *
 * Le telephone, lui, montre une chose a la fois. Deux ecrans, un seul modele.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Cog, Loader2, Minus, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import { Alerte, Chargement } from '../../composants/ui/base'
import { EnTetePage } from '../../composants/Coquille'
import { cn } from '../../lib/utils'
import {
  etatKg, fmtDate, LIBELLE_TYPE, machinesApi, nb,
  type LigneConso, type Machine, type TypeFiche, type Zone,
} from './noyau'
import { useFiche } from './useFiche'
import { useAuth } from '../../auth/AuthContext'
import { Link } from 'react-router-dom'

interface RefCat {
  code_reference: string
  designation: string
  poids_bobine_kg: number | null
}
interface Magasin {
  code_magasin: string
  nom: string
}

export function MachinesBureau() {
  const [machine, setMachine] = useState<Machine | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)
  const [type, setType] = useState<TypeFiche | null>(null)
  /* CET ECRAN NE DECLARE PAS DE MACHINE, ET C'EST VOULU. Le parc est du
     parametrage — declarer un metier, corriger ses capacites, dire pourquoi il
     ne tourne pas — et il vit sur son propre ecran, sous PARAMETRES. Ici on
     charge, on decharge, on constate : c'est le travail du magasin, tous les
     jours, et il n'a pas a cotoyer un bouton qui change une capacite.
     On garde juste le chemin, pour qui a le droit. */
  const { peut } = useAuth()
  const parametrable = peut('PARAMETRES', 'ECRIRE')

  const qMachines = useQuery({ queryKey: ['machines'], queryFn: machinesApi.liste })
  const qPlan = useQuery({
    queryKey: ['machine-plan', machine?.code_machine],
    queryFn: () => machinesApi.plan(machine!.code_machine),
    enabled: !!machine,
  })

  if (qMachines.isLoading) return <Chargement texte="Lecture des machines…" />
  const machines = qMachines.data ?? []

  /* ----------------------------------------------------------------------
     L'ENCHAINEMENT DEMANDE, ET POURQUOI IL EST MEILLEUR.

     Avant : trois colonnes cote a cote — machines, etages, travail. Choisir
     une machine n'affichait que des nombres d'etages ; il fallait descendre
     dans un etage pour voir quoi que ce soit, et remonter pour passer au
     suivant. Sur un metier a huit etages, huit allers-retours pour faire le
     tour de ce qu'il porte.

     Maintenant : une LISTE de machines, puis UNE PAGE par machine qui montre
     TOUS ses etages et ce qu'ils portent, avec sur chaque ligne les trois
     gestes du magasin — charger, decharger, constater. La saisie s'ouvre en
     fenetre au-dessus de la table, qui reste visible derriere : on voit ce
     qu'on modifie pendant qu'on le modifie.
     ---------------------------------------------------------------------- */
  if (!machine) {
    return (
      <div className="flex flex-col gap-3">
        <EnTetePage
          titre="Machines"
          description="Ce que chaque metier porte, et les trois gestes du magasin."
          actions={
            parametrable ? (
              <Link
                to="/parc-machines"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)]
                           border border-bordure px-2.5 py-1.5 text-[12px] font-medium
                           transition-colors hover:bg-attenue"
              >
                <Cog className="size-3.5" />
                Le parc
              </Link>
            ) : null
          }
        />
        {machines.length === 0 ? (
          <Vide
            texte={
              parametrable
                ? 'Aucune machine declaree. Passez par « Le parc » pour en saisir une.'
                : 'Aucune machine declaree. La direction doit les saisir.'
            }
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure
                          bg-surface shadow-[var(--ombre-pose)]">
            <table className="grille w-full text-[12.5px]">
              <thead>
                <tr className="bg-attenue">
                  {['Machine', 'Etages', 'Bobines', 'Charge', 'Etat', ''].map((e, i) => (
                    <th
                      key={e || i}
                      className={cn(
                        'px-3 py-2 text-left text-[10px] font-semibold uppercase',
                        'tracking-wider text-attenue-texte',
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
                  const part = m.capacite_bobines
                    ? (m.bobines_presentes / m.capacite_bobines) * 100
                    : 0
                  return (
                    <tr
                      key={m.code_machine}
                      className="cursor-pointer transition-colors hover:bg-primaire/5"
                      onClick={() => setMachine(m)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-texte">{m.nom}</div>
                        <div className="text-[11px] text-attenue-texte">{m.code_machine}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.nb_etages}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {m.bobines_presentes} / {m.capacite_bobines}
                      </td>
                      <td className="px-3 py-2">
                        {/* LA CHARGE SE LIT MIEUX EN LONGUEUR QU'EN CHIFFRE :
                            on compare cinq metiers d'un seul coup d'oeil. */}
                        <div className="h-2 w-24 rounded-full bg-attenue">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              part > 90 ? 'bg-succes' : part > 40 ? 'bg-primaire' : 'bg-alerte',
                            )}
                            style={{ width: `${Math.min(100, part)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-[1px] text-[10.5px]',
                            m.etat === 'ACTIVE'
                              ? 'border-succes/30 bg-succes/10 text-succes'
                              : 'border-alerte/30 bg-alerte/10 text-alerte',
                          )}
                        >
                          {m.etat}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-[12px] text-primaire">
                        Consulter
                      </td>
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

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={machine.nom}
        description={`${machine.code_machine} · ${machine.bobines_presentes} / ${machine.capacite_bobines} bobines`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMachine(null)
                setZone(null)
                setType(null)
              }}
              className="rounded-[var(--radius-sm)] border border-bordure px-2.5 py-1.5
                         text-[12px] font-medium transition-colors hover:bg-attenue"
            >
              Toutes les machines
            </button>
            {parametrable && (
              <Link
                to="/parc-machines"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)]
                           border border-bordure px-2.5 py-1.5 text-[12px] font-medium
                           transition-colors hover:bg-attenue"
              >
                <Cog className="size-3.5" />
                Modifier la machine
              </Link>
            )}
          </div>
        }
      />

      <TableEtages
        machine={machine}
        zones={qPlan.data ?? []}
        ouvrir={(z, tp) => {
          setZone(z)
          setType(tp)
        }}
      />

      {/* LE JOURNAL EN ENTIER, PUIS LE FILTRE.
          Il etait enferme dans un onglet d'une zone : on ne voyait que la
          consommation de l'etage ouvert, et il fallait passer les huit etages
          pour faire le compte d'un metier. On montre donc TOUT le journal de
          la machine, et l'on filtre ensuite — c'est l'ordre naturel, on
          regarde d'abord, on restreint apres. */}
      <JournalMachine machine={machine} zones={qPlan.data ?? []} />

      {/* LA SAISIE S'OUVRE AU-DESSUS, la table reste derriere : on voit ce
          qu'on modifie pendant qu'on le modifie. */}
      {zone && type && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto
                     bg-accent/40 p-4 backdrop-blur-[2px]"
        >
          <div
            className="w-full max-w-5xl rounded-[var(--radius-lg)] border border-bordure
                       bg-surface shadow-[var(--ombre-modale)]"
          >
            <FicheBureau
              machine={machine}
              zone={zone}
              type={type}
              fermer={() => {
                setType(null)
                setZone(null)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * TOUS LES ETAGES ET LEUR CONTENU, DANS UNE SEULE TABLE.
 *
 * C'est la « consultation globale » : on choisit une machine, on voit ce
 * qu'elle porte — etage par etage, reference par reference, lot par lot — sans
 * descendre nulle part. Les etages VIDES y figurent : un etage sans fil est
 * une information de travail, c'est la qu'il faut charger.
 *
 * LES TROIS GESTES SONT SUR LA LIGNE DE L'ETAGE, pas dans un menu. Charger,
 * decharger, constater : ce sont les seules choses que le magasin fait, et
 * elles doivent etre a un clic de ce qu'elles concernent.
 */
function TableEtages({
  machine,
  zones,
  ouvrir,
}: {
  machine: Machine
  zones: Zone[]
  ouvrir: (z: Zone, t: TypeFiche) => void
}) {
  const [filtre, setFiltre] = useState('')

  const q = useQuery({
    queryKey: ['machine-contenu', machine.code_machine],
    queryFn: () => machinesApi.contenu(machine.code_machine),
  })
  if (q.isLoading) return <Chargement texte="Lecture de la machine…" />

  const lignes = q.data ?? []
  const visibles = filtre ? lignes.filter((l) => l.code_emplacement === filtre) : lignes

  const parZone = new Map<string, typeof lignes>()
  for (const l of visibles) {
    if (!parZone.has(l.code_emplacement)) parZone.set(l.code_emplacement, [])
    parZone.get(l.code_emplacement)!.push(l)
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface
                 shadow-[var(--ombre-pose)]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-bordure bg-attenue/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
          Etages et composants
        </span>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-attenue-texte">
          Etage
          <select
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-bordure bg-surface px-2 py-1
                       text-[12px] text-texte outline-none focus:border-primaire/60"
          >
            <option value="">Tous</option>
            {zones.map((z) => (
              <option key={z.code_emplacement} value={z.code_emplacement}>
                {z.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="grille w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-attenue">
              {['Etage', 'Reference', 'Couleur', 'Lot', 'Bobines', '%', 'Kg', 'Constat', ''].map(
                (e, i) => (
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
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {[...parZone.entries()].map(([code, contenu]) => {
              const zone = zones.find((z) => z.code_emplacement === code)
              const montees = contenu.reduce((s, x) => s + (x.nb_bobines ?? 0), 0)
              return contenu.map((l, i) => (
                <tr key={`${code}-${l.code_reference ?? 'vide'}-${l.lot_fournisseur ?? i}`}>
                  {/* Le nom de l'etage ne se repete pas sur chaque ligne : il
                      fusionne sur toute la hauteur de son contenu. */}
                  {i === 0 && (
                    <td
                      rowSpan={contenu.length}
                      className="whitespace-nowrap px-2.5 py-1.5 align-top font-medium"
                    >
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
                      <td className="px-2.5 py-1.5 font-mono text-[11px]">
                        {l.lot_fournisseur ?? '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {l.nb_bobines ?? '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {l.pourcentage != null ? `${l.pourcentage} %` : '—'}
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
                      <div className="flex items-center gap-1">
                        <BoutonGeste
                          titre="Charger"
                          zone={zone}
                          type="CHARGE"
                          ouvrir={ouvrir}
                          Icone={Plus}
                        />
                        <BoutonGeste
                          titre="Decharger"
                          zone={zone}
                          type="DECHARGE"
                          ouvrir={ouvrir}
                          Icone={Minus}
                        />
                        <BoutonGeste
                          titre="Mettre a jour"
                          zone={zone}
                          type="MAJ"
                          ouvrir={ouvrir}
                          Icone={RefreshCw}
                        />
                      </div>
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

/** Un des trois gestes du magasin, pose sur la ligne de son etage. */
function BoutonGeste({
  titre,
  zone,
  type,
  ouvrir,
  Icone,
}: {
  titre: string
  zone: Zone | undefined
  type: TypeFiche
  ouvrir: (z: Zone, t: TypeFiche) => void
  Icone: React.ComponentType<{ className?: string }>
}) {
  if (!zone) return null
  return (
    <button
      type="button"
      title={titre}
      aria-label={titre}
      onClick={() => ouvrir(zone, type)}
      className="grid size-6 place-items-center rounded-[var(--radius-sm)] border border-bordure
                 text-attenue-texte transition-colors hover:border-primaire/50
                 hover:bg-primaire/10 hover:text-primaire"
    >
      <Icone className="size-3" />
    </button>
  )
}

function Vide({ texte }: { texte: string }) {
  return <p className="px-3 py-6 text-center text-[13px] text-attenue-texte">{texte}</p>
}

// =============================================================================
// LE CONSTAT D'UNE ZONE
/**
 * LE JOURNAL DE CONSOMMATION, EN CUMUL.
 *
 * Une ligne par zone, reference et lot : ce qui a ete charge, ce qui est
 * revenu, l'etat au depart et a l'arrivee, et le reste. Aucune repartition par
 * fiche — personne ne sait quel chargement a ete tisse quand.
 */
/**
 * LE JOURNAL DE CONSOMMATION D'UNE MACHINE, EN ENTIER.
 *
 * LA CONSOMMATION NE SE SAISIT PAS, elle se deduit en cumul : etat au depart,
 * plus les charges, moins les retours, moins l'etat de cloture. C'est la regle
 * du modele, et elle explique pourquoi ce tableau n'a aucun bouton : il n'y a
 * rien a y corriger, seulement a lire.
 *
 * ON AFFICHE TOUT, PUIS ON FILTRE. Le journal etait enferme dans un onglet de
 * zone — on ne voyait que l'etage ouvert. Ici la machine entiere est la, et
 * les deux filtres — etage, reference — reduisent sans changer d'ecran.
 */
function JournalMachine({ machine, zones }: { machine: Machine; zones: Zone[] }) {
  const [zone, setZone] = useState('')
  const [texte, setTexte] = useState('')

  const q = useQuery({
    queryKey: ['machine-conso', machine.code_machine],
    queryFn: () => machinesApi.consommation(machine.code_machine),
  })
  if (q.isLoading) return <Chargement texte="Lecture du journal…" />

  const tout = q.data ?? []
  const motif = texte.trim().toLowerCase()
  const lignes = tout.filter(
    (l) =>
      (!zone || l.zone === zone) &&
      (!motif ||
        (l.code_reference ?? '').toLowerCase().includes(motif) ||
        (l.lot_fournisseur ?? '').toLowerCase().includes(motif)),
  )

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface
                    shadow-[var(--ombre-pose)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-bordure bg-attenue/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
          Journal de consommation
        </span>
        <span className="text-[11px] text-attenue-texte">
          {lignes.length} ligne(s){lignes.length !== tout.length ? ` sur ${tout.length}` : ''}
        </span>
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Référence ou lot…"
          className="ml-auto w-52 rounded-[var(--radius-sm)] border border-bordure bg-surface
                     px-2.5 py-1 text-[12px] outline-none focus:border-primaire/60"
        />
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-bordure bg-surface px-2 py-1
                     text-[12px] text-texte outline-none focus:border-primaire/60"
        >
          <option value="">Tous les étages</option>
          {zones.map((z) => (
            <option key={z.code_emplacement} value={z.libelle}>{z.libelle}</option>
          ))}
        </select>
      </div>
      <div className="max-h-[50vh] overflow-auto">
        <TableConso lignes={lignes} />
      </div>
    </div>
  )
}

function TableConso({ lignes }: { lignes: LigneConso[] }) {
  const total = lignes.reduce((s, l) => s + l.consommation_kg, 0)
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
            <th className="px-2 py-1.5 text-left">Zone</th>
            <th className="px-2 py-1.5 text-left">Référence</th>
            <th className="px-2 py-1.5 text-left">Lot</th>
            <th className="px-2 py-1.5 text-right">État au départ</th>
            <th className="px-2 py-1.5 text-right">Chargé</th>
            <th className="px-2 py-1.5 text-right">Retourné</th>
            <th className="px-2 py-1.5 text-right">État constaté</th>
            <th className="px-2 py-1.5 text-right">Consommé</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lignes.map((l, i) => (
            <tr key={i} className="border-t border-bordure">
              <td className="px-2 py-1.5">{l.zone}</td>
              <td className="max-w-[18rem] truncate px-2 py-1.5">{l.designation}</td>
              <td className="px-2 py-1.5 font-mono text-[11px]">{l.lot_fournisseur}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">
                {nb(l.kg_debut)}
                {l.date_debut && (
                  <span className="ml-1 text-[10px]">{fmtDate(l.date_debut)}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_charge)}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">{nb(l.kg_retourne)}</td>
              <td className="px-2 py-1.5 text-right text-attenue-texte">
                {nb(l.kg_fin)}
                {l.date_fin && <span className="ml-1 text-[10px]">{fmtDate(l.date_fin)}</span>}
              </td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right font-medium',
                  l.consommation_kg < 0 ? 'text-danger' : 'text-texte',
                )}
              >
                {nb(l.consommation_kg)}
              </td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr>
              <td colSpan={8} className="px-2 py-6 text-center text-attenue-texte">
                Aucun chargement enregistré.
              </td>
            </tr>
          )}
        </tbody>
        {lignes.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-ink/20 bg-attenue font-semibold">
              <td className="px-2 py-1.5" colSpan={7}>
                Total consommé
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{nb(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// =============================================================================
// LA FICHE, EN GRILLE
// =============================================================================

function FicheBureau({
  machine, zone, type, fermer,
}: {
  machine: Machine
  zone: Zone
  type: TypeFiche
  fermer: () => void
}) {
  const f = useFiche(machine.code_machine, zone, type)
  const [ajout, setAjout] = useState(false)

  const qMag = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: () => api.get<Magasin[]>('/api/magasins?actif=1'),
  })
  const qCat = useQuery({
    queryKey: ['catalogue-machine'],
    queryFn: () => api.get<RefCat[]>('/api/catalogue?actif=1&limite=2000'),
    enabled: ajout,
  })

  const toucheMagasin = type === 'CHARGE' || type === 'DECHARGE'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-texte">
          {LIBELLE_TYPE[type]} · {zone.libelle}
        </h2>
        <button
          type="button"
          onClick={fermer}
          className="inline-flex min-h-[34px] items-center gap-1 rounded-[var(--radius-sm)]
                     border border-bordure px-3 text-[13px] hover:bg-attenue"
        >
          <X className="size-3.5" />
          Fermer
        </button>
      </div>

      {/* --- L'entete, sur une ligne ---------------------------------- */}
      <div className="grid grid-cols-2 gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3 lg:grid-cols-5">
        <Champ label="Date" type="date" v={f.entete.date} set={(v) => f.setEntete({ ...f.entete, date: v })} />
        {toucheMagasin && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-attenue-texte">
              {type === 'CHARGE' ? 'Magasin d’origine' : 'Magasin de retour'}
            </span>
            <select
              value={f.entete.magasin}
              onChange={(e) => f.setEntete({ ...f.entete, magasin: e.target.value })}
              className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
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
        <Champ label="Bobines de l’étage" type="number" v={String(f.entete.bobinesEtage)}
               set={(v) => f.setEntete({ ...f.entete, bobinesEtage: Number(v) || 0 })} />
        <Champ label="Ordre de fabrication" v={f.entete.of} set={(v) => f.setEntete({ ...f.entete, of: v })} />
        <Champ label="Responsable" v={f.entete.responsable} set={(v) => f.setEntete({ ...f.entete, responsable: v })} />
      </div>

      {/* --- La grille de saisie -------------------------------------- */}
      <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface">
        <table className="w-full min-w-[62rem] text-[12px]">
          <thead>
            <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="px-2 py-1.5 text-left">Référence</th>
              <th className="px-2 py-1.5 text-left">Lot</th>
              <th className="px-2 py-1.5 text-right">Avant</th>
              <th className="px-2 py-1.5 text-right">
                {type === 'DECHARGE' ? 'Retirées' : 'Chargées'}
              </th>
              <th className="px-2 py-1.5 text-right">Présentes</th>
              <th className="px-2 py-1.5 text-right">Poids/bob.</th>
              <th className="px-2 py-1.5 text-right">%</th>
              <th className="px-2 py-1.5 text-right">Constaté kg</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {f.lignes.map((l) => (
                <tr key={l.cle} className="border-t border-bordure">
                  <td className="max-w-[16rem] truncate px-2 py-1 text-texte">{l.designation}</td>
                  <td className="px-1 py-1">
                    <input
                      value={l.lot_fournisseur}
                      onChange={(e) => f.majLigne(l.cle, 'lot_fournisseur', e.target.value)}
                      className="min-h-[30px] w-28 rounded-[3px] border border-bordure bg-fond px-1.5 font-mono text-[11px]"
                    />
                  </td>
                  <td className="px-2 py-1 text-right text-attenue-texte">
                    {l.avant_bobines} · {nb(l.avant_kg, 1)}
                  </td>
                  <td className="px-1 py-1">
                    <Case v={l.mouvementees} set={(v) => f.majLigne(l.cle, 'mouvementees', v)}
                          desactive={type === 'MAJ'} />
                  </td>
                  <td className="px-1 py-1">
                    <Case v={l.presentes} set={(v) => f.majLigne(l.cle, 'presentes', v)}
                          desactive={type === 'MAJ'} />
                  </td>
                  <td className="px-1 py-1">
                    <Case v={l.poids_unitaire} pas={0.001}
                          set={(v) => f.majLigne(l.cle, 'poids_unitaire', v)} />
                  </td>
                  <td className="px-1 py-1">
                    <Case v={l.pourcentage} pas={0.1} max={100}
                          set={(v) => f.majLigne(l.cle, 'pourcentage', v)} />
                  </td>
                  <td className="px-2 py-1 text-right font-medium text-texte">{nb(etatKg(l))}</td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => f.retirer(l.cle)}
                      className="text-attenue-texte hover:text-danger"
                      aria-label="Retirer"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink/20 bg-attenue font-semibold">
              <td className="px-2 py-1.5" colSpan={3}>
                Total
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f.totaux.mouvementees}</td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right tabular-nums',
                  f.totaux.ecart !== 0 && 'text-danger',
                )}
              >
                {f.totaux.presentes} / {f.entete.bobinesEtage}
              </td>
              <td colSpan={2} />
              <td className="px-2 py-1.5 text-right tabular-nums">{nb(f.totaux.etatKg)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* --- Ajouter une reference qui n'etait pas sur la zone --------- */}
      {type === 'CHARGE' && (
        <div>
          {ajout ? (
            <div className="flex gap-2">
              <select
                onChange={(e) => {
                  const r = (qCat.data ?? []).find((x) => x.code_reference === e.target.value)
                  if (r) {
                    f.ajouter({
                      cle: '', code_reference: r.code_reference, designation: r.designation,
                      lot_fournisseur: '', mouvementees: 0, presentes: 0, nb_palettes: null,
                      poids_unitaire: r.poids_bobine_kg ?? 0, pourcentage: 100,
                      mode: 'ESTIMATION', pese_kg: 0,
                      avant_bobines: 0, avant_pourcentage: null, avant_kg: 0, avant_date: null,
                    })
                    setAjout(false)
                  }
                }}
                className="min-h-[34px] flex-1 rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
                defaultValue=""
              >
                <option value="">Choisir une référence…</option>
                {(qCat.data ?? []).map((r) => (
                  <option key={r.code_reference} value={r.code_reference}>
                    {r.designation}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setAjout(false)}
                      className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure px-3 text-[13px]">
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAjout(true)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[var(--radius-sm)]
                         border border-bordure px-3 text-[13px] hover:bg-attenue"
            >
              <Plus className="size-3.5" />
              Ajouter une référence
            </button>
          )}
        </div>
      )}

      {f.totaux.ecart !== 0 && (
        <Alerte
          ton="danger"
          titre={f.totaux.ecart < 0 ? 'Le compte est incomplet' : 'Trop de bobines déclarées'}
        >
          {f.entete.bobinesEtage} emplacements à l’entête, {f.totaux.presentes} déclarées —
          {f.totaux.ecart < 0
            ? ` il manque ${-f.totaux.ecart} bobines.`
            : ` ${f.totaux.ecart} de trop.`}{' '}
          {f.totaux.ecart < 0 && (type === 'CHARGE' || type === 'DECHARGE')
            ? 'Indiquez ce que vous avez monté dans la colonne des bobines mouvementées — les présentes suivront — ou corrigez le nombre d’emplacements de l’entête.'
            : 'Les emplacements ne restent jamais à moitié déclarés.'}
        </Alerte>
      )}

      {f.envoi.isError && (
        <Alerte ton="danger" titre="Validation refusée">
          {(f.envoi.error as Error).message}
        </Alerte>
      )}

      {f.envoi.isSuccess && (
        <Alerte ton="succes" titre="Fiche validée">
          Le constat est enregistré
          {f.envoi.data?.mouvement && ` · mouvement ${f.envoi.data.mouvement}`}.
          La consommation se lit dans le journal, en cumul.
        </Alerte>
      )}

      {/* LE SOLDE DU LOT NE COUVRE PAS : ON DEMANDE, ON NE REFUSE PAS.
          Le magasinier a les bobines dans les mains. Lui opposer un mur le
          pousse a ne plus saisir du tout, ce qui coute bien plus cher que
          l'imprecision qu'on voulait eviter. La question est posee une fois,
          la reponse part avec la fiche et reste au journal. */}
      {f.lotCourt && (
        <Alerte ton="alerte" titre="Le solde connu de ce lot ne couvre pas la sortie">
          <p className="leading-relaxed">
            Quand une bobine redescend d un metier, personne ne sait de quel lot elle
            venait : le retour est impute au juge, et les soldes par lot derivent. La
            matiere est donc peut-etre bien la.
          </p>
          <p className="mt-1 leading-relaxed">
            Le solde du <strong>magasin</strong>, lui, reste verifie — on ne charge jamais
            plus que ce que le magasin porte.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={f.envoi.isPending}
              onClick={() => f.envoi.mutate(true)}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-[var(--radius-sm)]
                         bg-alerte px-3 text-[13px] font-semibold text-surface
                         disabled:opacity-40"
            >
              {f.envoi.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Charger quand meme
            </button>
            <button
              type="button"
              onClick={f.oublierLotCourt}
              className="min-h-[36px] rounded-[var(--radius-sm)] border border-bordure px-3
                         text-[13px] font-medium"
            >
              Corriger la saisie
            </button>
          </div>
        </Alerte>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!f.pret || f.envoi.isPending}
          onClick={() => f.envoi.mutate(undefined)}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)]
                     bg-primaire px-4 text-[14px] font-semibold text-primaire-texte
                     disabled:opacity-40"
        >
          {f.envoi.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Valider la fiche
        </button>
        <span className="text-[12px] tabular-nums text-attenue-texte">
          <Cog className="mr-1 inline size-3" />
          {f.totaux.presentes} bobines · {nb(f.totaux.etatKg)} kg constatés
        </span>
      </div>
    </div>
  )
}

function Champ({
  label, v, set, type = 'text',
}: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-attenue-texte">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
        className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
      />
    </label>
  )
}

function Case({
  v, set, pas = 1, max, desactive,
}: { v: number; set: (v: number) => void; pas?: number; max?: number; desactive?: boolean }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={pas}
      max={max}
      disabled={desactive}
      value={v || ''}
      onChange={(e) => set(Math.min(max ?? Infinity, Number(e.target.value) || 0))}
      className={cn(
        'min-h-[30px] w-20 rounded-[3px] border border-bordure bg-fond px-1.5 text-right tabular-nums',
        desactive && 'opacity-40',
      )}
    />
  )
}

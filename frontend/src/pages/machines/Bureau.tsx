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
import { Check, Cog, Layers, Loader2, Plus, Trash2, X } from 'lucide-react'
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
  const [onglet, setOnglet] = useState<'etat' | 'conso'>('etat')
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

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage titre="Machines" />

      <div className="grid gap-3 lg:grid-cols-[15rem_16rem_1fr]">
        {/* --- Colonne 1 : les machines --------------------------------- */}
        <Colonne
          titre="Machines"
          action={
            parametrable ? (
              <Link
                to="/parc-machines"
                className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5
                           text-[11px] font-medium text-primaire hover:bg-primaire/10"
              >
                <Cog className="size-3" />
                Le parc
              </Link>
            ) : null
          }
        >
          {machines.length === 0 && (
            <Vide
              texte={
                parametrable
                  ? 'Aucune machine déclarée. Passez par « Le parc » pour en saisir une.'
                  : 'Aucune machine déclarée. La direction doit les saisir.'
              }
            />
          )}
          {machines.map((m) => (
            <button
              key={m.code_machine}
              type="button"
              onClick={() => {
                setMachine(m)
                setZone(null)
                setType(null)
              }}
              className={cn(
                'flex w-full flex-col gap-0.5 border-b border-bordure px-3 py-2 text-left',
                machine?.code_machine === m.code_machine ? 'bg-primaire/10' : 'hover:bg-attenue',
              )}
            >
              <span className="truncate text-[13px] font-medium text-texte">{m.nom}</span>
              <span className="text-[11px] tabular-nums text-attenue-texte">
                {m.bobines_presentes} / {m.capacite_bobines} bob. · {nb(m.quantite_kg, 0)} kg
              </span>
            </button>
          ))}
        </Colonne>

        {/* --- Colonne 2 : les zones ------------------------------------ */}
        <Colonne titre={machine ? machine.nom : 'Zones'}>
          {!machine && <Vide texte="Choisissez une machine." />}
          {machine &&
            (qPlan.data ?? []).map((z) => (
              <button
                key={z.code_emplacement}
                type="button"
                onClick={() => {
                  setZone(z)
                  setType(null)
                }}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-bordure px-3 py-2 text-left',
                  zone?.code_emplacement === z.code_emplacement
                    ? 'bg-primaire/10'
                    : 'hover:bg-attenue',
                )}
              >
                <Layers className="size-3.5 shrink-0 text-attenue-texte" />
                <span className="flex-1 text-[13px] text-texte">{z.libelle}</span>
                <span className="text-[11px] tabular-nums text-attenue-texte">
                  {z.bobines_presentes}/{z.capacite_bobines}
                </span>
              </button>
            ))}
        </Colonne>

        {/* --- Colonne 3 : le travail ----------------------------------- */}
        <div className="min-w-0">
          {!zone && <Vide texte="Choisissez une zone pour voir son constat." />}
          {zone && !type && (
            <ZoneBureau
              machine={machine!}
              zone={zone}
              onglet={onglet}
              setOnglet={setOnglet}
              ouvrirFiche={setType}
            />
          )}
          {zone && type && (
            <FicheBureau
              machine={machine!}
              zone={zone}
              type={type}
              fermer={() => setType(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function Colonne({
  titre, children, action,
}: {
  titre: string
  children: React.ReactNode
  /** Bouton d'en-tete, a droite du titre. Absent pour qui n'y a pas droit. */
  action?: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-bordure bg-attenue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
        <span className="truncate">{titre}</span>
        {action}
      </div>
      <div className="max-h-[70vh] overflow-y-auto">{children}</div>
    </div>
  )
}

function Vide({ texte }: { texte: string }) {
  return <p className="px-3 py-6 text-center text-[13px] text-attenue-texte">{texte}</p>
}

// =============================================================================
// LE CONSTAT D'UNE ZONE
// =============================================================================

function ZoneBureau({
  machine, zone, onglet, setOnglet, ouvrirFiche,
}: {
  machine: Machine
  zone: Zone
  onglet: 'etat' | 'conso'
  setOnglet: (o: 'etat' | 'conso') => void
  ouvrirFiche: (t: TypeFiche) => void
}) {
  const qEtat = useQuery({
    queryKey: ['machine-etat', machine.code_machine, zone.code_emplacement],
    queryFn: () => machinesApi.etat(machine.code_machine, zone.code_emplacement),
  })
  const qConso = useQuery({
    queryKey: ['machine-conso', machine.code_machine],
    queryFn: () => machinesApi.consommation(machine.code_machine),
    enabled: onglet === 'conso',
  })

  const lignes = qEtat.data ?? []
  const totalKg = lignes.reduce((s, l) => s + l.kg, 0)
  const totalBob = lignes.reduce((s, l) => s + l.nb_bobines, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2">
        <div>
          <div className="text-[15px] font-semibold text-texte">{zone.libelle}</div>
          <div className="text-[12px] tabular-nums text-attenue-texte">
            {totalBob} / {zone.capacite_bobines} emplacements · {nb(totalKg)} kg ·
            dernier constat {fmtDate(zone.dernier_constat)}
          </div>
        </div>
        <div className="flex gap-1.5">
          {/* TROIS FICHES, PAS QUATRE. La consommation ne se saisit pas : elle est
              le residu entre deux constats, et l'offrir en saisie inviterait a
              la declarer deux fois. */}
          {(['CHARGE', 'DECHARGE', 'MAJ'] as TypeFiche[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => ouvrirFiche(t)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-sm)]
                         border border-bordure px-3 text-[13px] hover:bg-attenue"
            >
              <Plus className="size-3.5" />
              {LIBELLE_TYPE[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        {(
          [
            ['etat', 'Constat courant'],
            ['conso', 'Journal de consommation'],
          ] as ['etat' | 'conso', string][]
        ).map(([c, libelle]) => (
          <button
            key={c}
            type="button"
            onClick={() => setOnglet(c)}
            className={cn(
              'min-h-[34px] rounded-[var(--radius-sm)] px-3 text-[13px] font-medium',
              onglet === c ? 'bg-primaire text-primaire-texte' : 'border border-bordure',
            )}
          >
            {libelle}
          </button>
        ))}
      </div>

      {onglet === 'etat' ? (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
                <th className="px-2 py-1.5 text-left">Référence</th>
                <th className="px-2 py-1.5 text-left">Lot</th>
                <th className="px-2 py-1.5 text-right">Bobines</th>
                <th className="px-2 py-1.5 text-right">Poids/bob.</th>
                <th className="px-2 py-1.5 text-right">%</th>
                <th className="px-2 py-1.5 text-right">Total kg</th>
                <th className="px-2 py-1.5 text-left">Constaté le</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lignes.map((l) => (
                <tr key={l.code_reference + l.lot_fournisseur} className="border-t border-bordure">
                  <td className="max-w-[20rem] truncate px-2 py-1.5 text-texte">{l.designation}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{l.lot_fournisseur}</td>
                  <td className="px-2 py-1.5 text-right">{l.nb_bobines}</td>
                  <td className="px-2 py-1.5 text-right">{nb(l.poids_unitaire_kg, 3)}</td>
                  <td className="px-2 py-1.5 text-right">{nb(l.pourcentage, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-texte">{nb(l.kg)}</td>
                  <td className="px-2 py-1.5">{fmtDate(l.date_constat)}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-attenue-texte">
                    Zone vide.
                  </td>
                </tr>
              )}
            </tbody>
            {lignes.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-ink/20 bg-attenue font-semibold">
                  <td className="px-2 py-1.5" colSpan={2}>
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{totalBob}</td>
                  <td colSpan={2} />
                  <td className="px-2 py-1.5 text-right tabular-nums">{nb(totalKg)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <TableConso lignes={qConso.data ?? []} />
      )}
    </div>
  )
}

/**
 * LE JOURNAL DE CONSOMMATION, EN CUMUL.
 *
 * Une ligne par zone, reference et lot : ce qui a ete charge, ce qui est
 * revenu, l'etat au depart et a l'arrivee, et le reste. Aucune repartition par
 * fiche — personne ne sait quel chargement a ete tisse quand.
 */
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!f.pret || f.envoi.isPending}
          onClick={() => f.envoi.mutate()}
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

/**
 * Machines — les ECRANS DE FICHE, chacun avec son adresse.
 *
 *   /machines/:code/fiche/:type/:zone   une decision neuve sur un etage
 *   /machines/fiches/:id                une fiche : en brouillon, on la saisit ;
 *                                       validee ou annulee, on la lit
 *
 * PAS DE FENETRE SURGISSANTE (05/10/2026) : une fiche est un document, elle
 * s'ouvre sur un ecran a part entiere, depuis la liste de la machine, comme
 * une facture ou une reception. On y revient par son adresse.
 *
 * LE MODELE DU 05/10/2026 : chaque validation est une DECISION — etat avant,
 * saisie par ligne Reference + Lot, apercu, validation, etat resultant.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { ArrowLeft, Check, Eye, Loader2, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Alerte, Badge, Bouton, Chargement } from '../../composants/ui/base'
import { EnTetePage } from '../../composants/Coquille'
import { ActionMotivee } from '../../composants/ActionMotivee'
import { Onglet, OngletContenu, Onglets, OngletsListe } from '../../composants/ui/surcouches'
import { useOuvrirVue } from '../../lib/navigation'
import { cn } from '../../lib/utils'
import { couleurEcart, libelleLot, SANS_LOT, useTolerancesLot } from '../../lib/lots'
import { ChampLot } from '../../composants/ChampLot'
import {
  cheminMachine, CLASSE_ECART, destinationsDe, ecartPoidsBobine, estimer, fmtDate, fmtInstant, LIBELLE_DESTINATION,
  LIBELLE_EFFET, LIBELLE_TYPE, ligneNeuve, machinesApi, nb, rappelCatalogue,
  type Apercu, type Destination, type Fiche, type FicheDetail, type LigneSaisie, type Machine,
  type TypeFiche, type Zone,
  TON_ECART,
} from './noyau'
import { useFiche } from './useFiche'
import { useValiderFiche } from './Questions'

interface RefCat {
  code_reference: string
  designation: string
  poids_bobine_kg: number | null
}
interface Magasin {
  code_magasin: string
  nom: string
}

const TYPES: TypeFiche[] = ['CHARGE', 'DECHARGE', 'MAJ']

/** La machine et ses etages, pour les ecrans qui n'arrivent qu'avec un code. */
function useMachine(code: string | undefined) {
  const qMachines = useQuery({ queryKey: ['machines'], queryFn: machinesApi.liste, enabled: !!code })
  const qPlan = useQuery({
    queryKey: ['machine-plan', code],
    queryFn: () => machinesApi.plan(code!),
    enabled: !!code,
  })
  return {
    machine: (qMachines.data ?? []).find((m) => m.code_machine === code),
    zones: qPlan.data ?? [],
    chargement: qMachines.isLoading || qPlan.isLoading,
  }
}

// =============================================================================
// UNE DECISION NEUVE
// =============================================================================

export function NouvelleFicheMachine() {
  const { code = '', type = '', zone: codeZone = '' } = useParams()
  const ouvrir = useOuvrirVue()
  const { machine, zones, chargement } = useMachine(code)
  if (chargement) return <Chargement texte="Lecture de la machine…" />
  const zone = zones.find((z) => z.code_emplacement === codeZone)
  if (!machine || !zone || !TYPES.includes(type as TypeFiche)) {
    return <Alerte ton="danger" titre="Fiche introuvable">Machine, étage ou type de fiche inconnu.</Alerte>
  }
  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={`${LIBELLE_TYPE[type as TypeFiche]} · ${zone.libelle}`}
        description={`${machine.nom} · nouvelle décision`}
        actions={
          <Bouton variante="contour" onClick={() => ouvrir(cheminMachine(code, codeZone))}>
            <ArrowLeft />
            {machine.nom}
          </Bouton>
        }
      />
      <FicheBureau
        key={`${codeZone}-${type}`}
        machine={machine}
        zones={zones}
        zone={zone}
        type={type as TypeFiche}
      />
    </div>
  )
}

// =============================================================================
// UNE FICHE EXISTANTE : la saisir (brouillon) ou la lire
// =============================================================================

export function FicheMachine() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['machine-fiche', id], queryFn: () => machinesApi.fiche(id) })
  const { machine, zones, chargement } = useMachine(q.data?.entete.code_machine)
  if (q.isLoading || chargement) return <Chargement texte="Lecture de la fiche…" />
  if (q.isError || !q.data) {
    return <Alerte ton="danger" titre="Fiche introuvable">{(q.error as Error | null)?.message ?? ''}</Alerte>
  }
  const d = q.data
  if (!machine) return <Alerte ton="danger" titre="Machine introuvable">{d.entete.code_machine}</Alerte>
  return d.entete.statut === 'BROUILLON' && d.entete.type_fiche !== 'CONSO'
    ? <BrouillonMachine d={d} machine={machine} zones={zones} />
    : <DetailFiche d={d} machine={machine} zones={zones} />
}

function BrouillonMachine({ d, machine, zones }: { d: FicheDetail; machine: Machine; zones: Zone[] }) {
  const ouvrir = useOuvrirVue()
  const [geste, setGeste] = useState<'annuler' | null>(null)
  const zone = zones.find((z) => z.code_emplacement === d.entete.code_emplacement)
  if (!zone) return <Chargement texte="Lecture des étages…" />
  const e = d.entete
  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={`${e.numero_fiche} · ${LIBELLE_TYPE[e.type_fiche]}`}
        description={
          <span className="inline-flex items-center gap-2">
            {machine.nom} · {zone.libelle}
            <Badge ton="alerte">Brouillon</Badge>
            {e.nb_validations > 0 && <span className="text-alerte">dévalidée — corrigez puis revalidez</span>}
          </span>
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir(cheminMachine(machine.code_machine, e.code_emplacement))}>
              <ArrowLeft />
              {machine.nom}
            </Bouton>
            <Bouton variante="contour" onClick={() => setGeste('annuler')}>
              <XCircle />
              Annuler la fiche
            </Bouton>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Badge ton="alerte">Brouillon</Badge>
        <span className="text-attenue-texte">{machine.nom} · {zone.libelle}</span>
        {e.nb_validations > 0 && (
          <span className="text-alerte">
            Dévalidée : l’étage est revenu à son état précédent. Corrigez la saisie (l’étage aussi si besoin), puis revalidez.
          </span>
        )}
      </div>
      <FicheBureau
        key={e.id_fiche}
        machine={machine}
        zones={zones}
        zone={zone}
        type={e.type_fiche}
        idFiche={e.id_fiche}
      />
      {geste && <GesteRetrait fiche={e} mode={geste} fermer={() => setGeste(null)} />}
    </div>
  )
}

/**
 * DEVALIDER OU ANNULER, avec sa raison. Seule la derniere decision d'un etage
 * se retire seule : l'appelant n'ouvre ce geste que pour elle (ou un brouillon).
 */
export function GesteRetrait({
  fiche, mode, fermer,
}: {
  fiche: Pick<Fiche, 'id_fiche' | 'numero_fiche' | 'statut'>
  mode: 'devalider' | 'annuler'
  fermer: () => void
}) {
  const brouillon = fiche.statut === 'BROUILLON'
  return (
    <ActionMotivee
      ouvert
      surFermeture={fermer}
      titre={mode === 'devalider' ? `Dévalider ${fiche.numero_fiche}` : `Annuler ${fiche.numero_fiche}`}
      consequence={
        brouillon ? (
          <p>Le brouillon est clos sans rien changer à l’étage ni au magasin. Il reste consultable.</p>
        ) : (
          <div className="space-y-1.5">
            <p>
              L’étage revient <strong>exactement à l’état validé qui précédait</strong> cette fiche. Côté
              magasin, ses mouvements reçoivent une <strong>annulation administrative</strong> rattachée,
              à leur valeur d’origine — jamais un faux mouvement physique.
            </p>
            <p>
              {mode === 'devalider'
                ? 'La fiche revient en brouillon : vous pourrez la corriger (son étage aussi) et la revalider.'
                : 'La fiche est close ; elle reste consultable avec tout son historique.'}
            </p>
          </div>
        )
      }
      libelleBouton={mode === 'devalider' ? 'Dévalider' : 'Annuler la fiche'}
      chemin={`/api/machines/fiches/${fiche.id_fiche}/${mode}`}
      surSucces={fermer}
    />
  )
}

// =============================================================================
// LE DETAIL D'UNE FICHE VALIDEE OU ANNULEE
// =============================================================================

const LIBELLE_STATUT_DECISION: Record<string, string> = {
  ACTIVE: 'Active',
  RETIREE: 'Dévalidée',
  ANNULEE: 'Annulée',
}

const LIBELLE_EVENEMENT: Record<string, string> = {
  VALIDATION: 'Validation',
  DEVALIDATION: 'Dévalidation',
  ANNULATION: 'Annulation',
  CHANGEMENT_ETAGE: 'Changement d’étage',
}

function DetailFiche({ d, machine, zones }: { d: FicheDetail; machine: Machine; zones: Zone[] }) {
  // Devalider ou annuler une decision validee demande VALIDER (regle 15).
  const peutRetirer = useAuth().peut('MOUVEMENTS', 'VALIDER')
  const ouvrir = useOuvrirVue()
  const [geste, setGeste] = useState<'devalider' | 'annuler' | null>(null)
  const e = d.entete
  const libelleZone = (c: string | null) => zones.find((z) => z.code_emplacement === c)?.libelle ?? c ?? '—'
  const tete = d.decisions.some((x) => x.statut === 'ACTIVE' && Number(x.est_tete) === 1)
  const active = d.decisions.find((x) => x.statut === 'ACTIVE')
  const avant = d.etats.filter((x) => x.moment === 'AVANT')
  const apres = d.etats.filter((x) => x.moment === 'APRES')
  const designations = Object.fromEntries(d.lignes_decision.map((l) => [l.code_reference, l.designation]))
  const consomme = d.lignes_decision
    .filter((l) => l.effet_ecart === 'CONSOMMATION')
    .reduce((s, l) => s + l.ecart_kg, 0)

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={`${e.numero_fiche} · ${LIBELLE_TYPE[e.type_fiche]}`}
        description={
          <span className="inline-flex items-center gap-2">
            {machine.nom} · {libelleZone(e.code_emplacement)}
            <Badge ton={e.statut === 'VALIDE' ? 'succes' : 'neutre'}>{e.statut === 'VALIDE' ? 'Validée' : 'Annulée'}</Badge>
            {tete && <Badge ton="info">dernière décision de l’étage</Badge>}
          </span>
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir(cheminMachine(machine.code_machine, e.code_emplacement))}>
              <ArrowLeft />
              {machine.nom}
            </Bouton>
            {e.statut === 'VALIDE' && tete && peutRetirer && (
              <>
                <Bouton variante="contour" onClick={() => setGeste('devalider')}>
                  <RotateCcw />
                  Dévalider
                </Bouton>
                <Bouton variante="contour" onClick={() => setGeste('annuler')}>
                  <XCircle />
                  Annuler
                </Bouton>
              </>
            )}
          </>
        }
      />

      {e.statut === 'VALIDE' && !tete && d.decisions.length > 0 && (
        <Alerte ton="info" titre="Cette décision n’est plus la dernière de l’étage">
          Une décision plus récente s’est appuyée sur elle : elle ne se dévalide plus seule. Pour la corriger,
          faites un constat avec le motif « Correction » sur {libelleZone(e.code_emplacement)}.
        </Alerte>
      )}

      {/* --- L'en-tete du document ------------------------------------------ */}
      <Bloc titre="En-tête">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] md:grid-cols-4">
          <Info
            t="Statut"
            v={
              <span className="inline-flex flex-wrap items-center gap-1">
                <Badge ton={e.statut === 'VALIDE' ? 'succes' : 'neutre'}>{e.statut === 'VALIDE' ? 'Validée' : 'Annulée'}</Badge>
                {tete && <Badge ton="info">dernière décision de l’étage</Badge>}
              </span>
            }
          />
          <Info t="Machine · étage" v={`${machine.nom} · ${libelleZone(e.code_emplacement)}`} />
          <Info t="Date de la fiche" v={fmtDate(e.date_fiche)} />
          <Info t="Responsable" v={e.responsable || '—'} />
          {e.type_fiche !== 'MAJ' && (
            <Info t={e.type_fiche === 'CHARGE' ? 'Magasin d’origine' : 'Magasin de retour'} v={e.code_magasin ?? '—'} />
          )}
          <Info t="Ordre de fabrication" v={e.numero_of || '—'} />
          <Info t="Validée le" v={active ? `${fmtInstant(active.date_decision)} par ${active.auteur ?? '—'}` : '—'} />
          <Info t="Consommation retenue" v={d.lignes_decision.length ? `${nb(consomme, 1)} kg` : '—'} fort />
          {e.observations && <Info t="Observations" v={e.observations} large />}
          {e.motif_annulation && <Info t="Motif d’annulation" v={e.motif_annulation} large />}
        </dl>
      </Bloc>

      {/* --- Ce que la decision a fait ---------------------------------------- */}
      <Bloc
        titre={active
          ? `Décision n°${active.numero_validation} — ce qu’elle a enregistré`
          : 'Dernière décision — ce qu’elle avait enregistré'}
      >
        {d.lignes_decision.length === 0 ? (
          <p className="text-[12.5px] text-attenue-texte">
            Aucune décision enregistrée
            {e.statut === 'VALIDE' ? ' : fiche validée avant le modèle de décisions (05/10/2026).' : '.'}
          </p>
        ) : (
          <TableApercu type={e.type_fiche} lignes={d.lignes_decision} designations={designations} motifs />
        )}
      </Bloc>

      {/* --- L'etage avant / apres, les validations, le journal : en onglets -- */}
      <Onglets defaultValue="etage">
        <OngletsListe>
          <Onglet value="etage">{libelleZone(e.code_emplacement)} avant / après</Onglet>
          <Onglet value="validations">Validations ({d.decisions.length})</Onglet>
          <Onglet value="journal">Journal ({d.journal.length})</Onglet>
        </OngletsListe>
        <OngletContenu value="etage" className="mt-3">
          {avant.length === 0 && apres.length === 0 ? (
            <p className="text-[12.5px] text-attenue-texte">Pas d’état archivé pour cette fiche.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <Bloc titre="Avant la décision">
                <TableEtat lignes={avant} />
              </Bloc>
              <Bloc titre="État résultant">
                <TableEtat lignes={apres} />
              </Bloc>
            </div>
          )}
        </OngletContenu>
        <OngletContenu value="validations" className="mt-3">
          <Bloc titre="Validations">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-attenue-texte">
                <th className="py-1 pr-2">N°</th>
                <th className="py-1 pr-2">Le</th>
                <th className="py-1 pr-2">Par</th>
                <th className="py-1 pr-2">Statut</th>
                <th className="py-1">Retrait</th>
              </tr>
            </thead>
            <tbody>
              {d.decisions.map((x) => (
                <tr key={x.numero_validation} className="border-t border-bordure align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{x.numero_validation}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{fmtInstant(x.date_decision)}</td>
                  <td className="py-1.5 pr-2">{x.auteur ?? '—'}</td>
                  <td className="py-1.5 pr-2">
                    <Badge ton={x.statut === 'ACTIVE' ? 'succes' : 'neutre'}>{LIBELLE_STATUT_DECISION[x.statut]}</Badge>
                  </td>
                  <td className="py-1.5 text-attenue-texte">
                    {x.motif_retrait
                      ? `${fmtInstant(x.date_retrait)} · ${x.auteur_retrait ?? '—'} — ${x.motif_retrait}`
                      : '—'}
                  </td>
                </tr>
              ))}
              {d.decisions.length === 0 && (
                <tr><td colSpan={5} className="py-2 text-attenue-texte">Aucune validation.</td></tr>
              )}
            </tbody>
          </table>
        </Bloc>
        </OngletContenu>
        <OngletContenu value="journal" className="mt-3">
          <Bloc titre="Journal de la fiche">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-attenue-texte">
                <th className="py-1 pr-2">Le</th>
                <th className="py-1 pr-2">Événement</th>
                <th className="py-1 pr-2">Étage</th>
                <th className="py-1 pr-2">Par</th>
                <th className="py-1">Motif</th>
              </tr>
            </thead>
            <tbody>
              {d.journal.map((j, i) => (
                <tr key={i} className="border-t border-bordure align-top">
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{fmtInstant(j.horodatage)}</td>
                  <td className="py-1.5 pr-2 font-medium">{LIBELLE_EVENEMENT[j.evenement] ?? j.evenement}</td>
                  <td className="py-1.5 pr-2">{j.code_emplacement ? libelleZone(j.code_emplacement) : '—'}</td>
                  <td className="py-1.5 pr-2">{j.auteur ?? '—'}</td>
                  <td className="py-1.5 text-attenue-texte">{j.motif ?? '—'}</td>
                </tr>
              ))}
              {d.journal.length === 0 && (
                <tr><td colSpan={5} className="py-2 text-attenue-texte">Journal vide.</td></tr>
              )}
            </tbody>
          </table>
        </Bloc>
        </OngletContenu>
      </Onglets>

      {geste && <GesteRetrait fiche={e} mode={geste} fermer={() => setGeste(null)} />}
    </div>
  )
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-bordure bg-surface shadow-[var(--ombre-pose)]">
      <h2 className="border-b border-bordure bg-attenue/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
        {titre}
      </h2>
      <div className="p-3">{children}</div>
    </section>
  )
}

function Info({ t, v, fort, large }: { t: string; v: React.ReactNode; fort?: boolean; large?: boolean }) {
  return (
    <div className={cn(large && 'col-span-2 md:col-span-4')}>
      <dt className="text-[11px] text-attenue-texte">{t}</dt>
      <dd className={cn('mt-0.5', fort && 'font-semibold')}>{v}</dd>
    </div>
  )
}

function TableEtat({ lignes }: { lignes: FicheDetail['etats'] }) {
  if (lignes.length === 0) return <p className="text-[12.5px] text-attenue-texte">Étage vide.</p>
  const totalNb = lignes.reduce((s, l) => s + l.nb_bobines, 0)
  const totalKg = lignes.reduce((s, l) => s + l.kg, 0)
  return (
    <table className="w-full text-[12.5px] tabular-nums">
      <thead>
        <tr className="text-[10.5px] uppercase tracking-wide text-attenue-texte">
          <th className="py-1 pr-2 text-left">Référence</th>
          <th className="py-1 pr-2 text-left">Lot</th>
          <th className="py-1 pr-2 text-right">Bobines</th>
          <th className="py-1 pr-2 text-right">%</th>
          <th className="py-1 text-right">Kg</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i} className="border-t border-bordure">
            <td className="max-w-[16rem] truncate py-1.5 pr-2">{l.designation}</td>
            <td className="py-1.5 pr-2 font-mono text-[11px]">{l.lot_fournisseur}</td>
            <td className="py-1.5 pr-2 text-right">{l.nb_bobines}</td>
            <td className="py-1.5 pr-2 text-right">{l.pourcentage != null ? `${nb(l.pourcentage, 1)} %` : '—'}</td>
            <td className="py-1.5 text-right">{nb(l.kg)}</td>
          </tr>
        ))}
      </tbody>
      {lignes.length > 1 && (
        <tfoot>
          <tr className="border-t-2 border-ink/20 font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>Total</td>
            <td className="py-1.5 pr-2 text-right">{totalNb}</td>
            <td />
            <td className="py-1.5 text-right">{nb(totalKg)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

// =============================================================================
// L'APERCU D'UNE DECISION
// =============================================================================

/** L'apercu (ou le resultat) d'une decision, ligne par ligne. */
export function TableApercu({
  type, lignes, designations, motifs,
}: {
  type: TypeFiche
  lignes: (Apercu['lignes'][number] & { motif?: string })[]
  designations: Record<string, string>
  /** Montrer la colonne du motif (detail d'une fiche validee). */
  motifs?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px] tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-attenue-texte">
            <th className="py-1 pr-2 text-left">Référence · lot</th>
            <th className="py-1 pr-2 text-right">Avant</th>
            {type !== 'MAJ' && <th className="py-1 pr-2 text-right">{type === 'CHARGE' ? 'Chargé' : 'Retiré'}</th>}
            <th className="py-1 pr-2 text-right">{type === 'MAJ' ? 'Constaté' : 'Après'}</th>
            <th className="py-1 pr-2 text-right">% déclaré</th>
            <th className="py-1 pr-2 text-right">% théorique</th>
            <th className="py-1 pr-2 text-right">Écart</th>
            <th className="py-1 pr-2 text-left">Compte comme</th>
            {motifs && <th className="py-1 text-left">Motif</th>}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.ligne_numero} className="border-t border-bordure">
              <td className="max-w-[16rem] py-1 pr-2">
                <div className="truncate">{designations[l.code_reference] ?? l.code_reference}</div>
                <div className="font-mono text-[10px] text-attenue-texte">{l.lot_fournisseur}</div>
              </td>
              <td className="py-1 pr-2 text-right">{l.nb_avant} · {nb(l.kg_avant, 1)} kg</td>
              {type !== 'MAJ' && (
                <td className="py-1 pr-2 text-right">
                  {`${l.nb_mouvementees} · ${nb(l.kg_mouvementes, 1)} kg`}
                  {l.destination && <div className="text-[10px] text-attenue-texte">{LIBELLE_DESTINATION[l.destination]}</div>}
                </td>
              )}
              <td className="py-1 pr-2 text-right">{l.nb_apres} · {nb(l.kg_apres, 1)} kg</td>
              <td className="py-1 pr-2 text-right">{l.pourcentage_apres != null ? `${nb(l.pourcentage_apres, 1)} %` : '—'}</td>
              <td className="py-1 pr-2 text-right text-attenue-texte">{l.pourcentage_theorique != null ? `${nb(l.pourcentage_theorique, 1)} %` : '—'}</td>
              <td className={cn('py-1 pr-2 text-right font-medium', TON_ECART[l.niveau_ecart ?? ''] ?? (l.ecart_kg < -0.0005 && 'text-alerte'))}
                title={l.niveau_ecart && l.niveau_ecart !== 'AUCUN' ? `Écart ${l.niveau_ecart.toLowerCase()}` : undefined}>
                {nb(l.ecart_kg, 1)} kg
              </td>
              <td className={cn('py-1 pr-2', l.effet_ecart === 'NON_QUALIFIE' || l.effet_ecart === 'REGULARISATION' ? 'text-alerte' : 'text-attenue-texte')}>
                {LIBELLE_EFFET[l.effet_ecart] ?? l.effet_ecart}
              </td>
              {motifs && (
                <td className="py-1 text-attenue-texte">
                  {l.motif ?? l.code_motif}
                  {l.motif_texte && <div className="text-[10.5px] italic">{l.motif_texte}</div>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =============================================================================
// LA SAISIE, EN GRILLE
// =============================================================================

export function FicheBureau({
  machine, zones, zone, type, idFiche,
}: {
  machine: Machine
  zones: Zone[]
  zone: Zone
  type: TypeFiche
  idFiche?: string
}) {
  const ouvrir = useOuvrirVue()
  const f = useFiche(machine.code_machine, zone, type, idFiche)
  const v = useValiderFiche(f)
  const [ajout, setAjout] = useState(false)
  const tolerances = useTolerancesLot()

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
  const designations = Object.fromEntries(f.lignes.map((l) => [l.code_reference, l.designation]))

  /** Le motif d'une ligne, et ce qu'il demande en plus. Une fonction, pas un composant :
      un composant declare ici serait recree a chaque frappe et ferait perdre le focus. */
  const choixMotif = (l: LigneSaisie) => {
    const m = f.motifDe(l.code_motif)
    const effets = (m?.effets_permis ?? '').split(',').filter(Boolean)
    return (
      <div className="flex flex-col gap-1">
        <select
          value={l.code_motif}
          onChange={(e) => f.majLigne(l.cle, 'code_motif', e.target.value)}
          aria-label="Motif"
          className={cn('min-h-[30px] w-40 rounded-[3px] border bg-fond px-1 text-[11.5px]', l.code_motif ? 'border-bordure' : 'border-danger')}
        >
          <option value="">Motif…</option>
          {f.motifs.map((x) => (
            <option key={x.code_motif} value={x.code_motif}>{x.libelle}</option>
          ))}
        </select>
        {m && !m.effet_defaut && (
          <select
            value={l.effet_ecart}
            onChange={(e) => f.majLigne(l.cle, 'effet_ecart', e.target.value)}
            aria-label="L'écart compte comme"
            className={cn('min-h-[28px] w-40 rounded-[3px] border bg-fond px-1 text-[11px]', l.effet_ecart ? 'border-bordure' : 'border-danger')}
          >
            <option value="">L’écart compte comme…</option>
            {effets.map((e) => (
              <option key={e} value={e}>{LIBELLE_EFFET[e] ?? e}</option>
            ))}
          </select>
        )}
        <input
          value={l.motif_texte}
          onChange={(e) => f.majLigne(l.cle, 'motif_texte', e.target.value)}
          placeholder="Précision (obligatoire si l’écart est rouge)"
          aria-label="Précision du motif"
          className="min-h-[26px] w-40 rounded-[3px] border border-bordure bg-fond px-1.5 text-[11px]"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* --- L'entete ---------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3 lg:grid-cols-5">
        {idFiche ? (
          /* UNE FICHE REPRISE PEUT CHANGER D'ETAGE : c'est le cas de l'erreur
             d'emplacement. Le journal garde l'etage d'origine. */
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-attenue-texte">Étage</span>
            <select
              value={f.zone?.code_emplacement}
              onChange={(e) => {
                const z = zones.find((x) => x.code_emplacement === e.target.value)
                if (z) f.changerZone(z)
              }}
              className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
            >
              {zones.map((z) => (
                <option key={z.code_emplacement} value={z.code_emplacement}>{z.libelle}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-attenue-texte">Étage</span>
            <span className="min-h-[34px] py-2 text-[13px]">{f.zone?.libelle}</span>
          </div>
        )}
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
                <option key={m.code_magasin} value={m.code_magasin}>{m.nom}</option>
              ))}
            </select>
          </label>
        )}
        <Champ label="Ordre de fabrication" v={f.entete.of} set={(v) => f.setEntete({ ...f.entete, of: v })} />
        <Champ label="Responsable" v={f.entete.responsable} set={(v) => f.setEntete({ ...f.entete, responsable: v })} />
      </div>

      {/* --- La grille de saisie : les colonnes du type de fiche ------------ */}
      <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface">
        <table className="w-full min-w-[66rem] text-[12px]">
          <thead>
            <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="px-2 py-1.5 text-left">Référence</th>
              <th className="px-2 py-1.5 text-left">Lot</th>
              <th className="px-2 py-1.5 text-right">Avant</th>
              {type === 'CHARGE' && (
                <>
                  <th className="px-2 py-1.5 text-right">À charger</th>
                  <th className="px-2 py-1.5 text-right">Poids/bob.</th>
                  <th className="px-2 py-1.5 text-right">% ligne après</th>
                </>
              )}
              {type === 'DECHARGE' && (
                <>
                  <th className="px-2 py-1.5 text-right">À retirer</th>
                  <th className="px-2 py-1.5 text-right">% retirées</th>
                  <th className="px-2 py-1.5 text-left">Destination</th>
                  <th className="px-2 py-1.5 text-right">% restantes</th>
                </>
              )}
              {type === 'MAJ' && (
                <>
                  <th className="px-2 py-1.5 text-right">Présentes</th>
                  <th className="px-2 py-1.5 text-right">% constaté</th>
                </>
              )}
              <th className="px-2 py-1.5 text-right">Après (estimé)</th>
              <th className="px-2 py-1.5 text-right">Écart</th>
              <th className="px-2 py-1.5 text-left">Motif</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {f.lignes.map((l) => {
              const e = estimer(type, l)
              const touchee = type === 'MAJ' || l.mouvementees > 0
              const destinations = destinationsDe(f.motifDe(l.code_motif))
              const toutRetire = type === 'DECHARGE' && l.mouvementees >= l.avant_bobines && l.mouvementees > 0
              return (
                <tr key={l.cle} className={cn('border-t border-bordure align-top', !touchee && 'opacity-60')}>
                  <td className="max-w-[15rem] truncate px-2 py-1 text-texte">{l.designation}</td>
                  <td className="px-1 py-1">
                    {type === 'CHARGE' && f.entete.magasin && l.avant_bobines === 0 ? (
                      <ChampLot
                        reference={l.code_reference}
                        magasin={f.entete.magasin}
                        valeur={l.lot_fournisseur}
                        onChange={(v) => f.majLigne(l.cle, 'lot_fournisseur', v)}
                        invalide={!l.lot_fournisseur}
                        className="min-h-[30px] w-40 rounded-[3px] border border-bordure bg-fond px-1.5 font-mono text-[11px]"
                      />
                    ) : l.lot_fournisseur === SANS_LOT ? (
                      <span className="inline-flex min-h-[30px] items-center px-1.5 text-[11px] italic text-attenue-texte">
                        {libelleLot(l.lot_fournisseur)}
                      </span>
                    ) : l.avant_bobines > 0 ? (
                      <span className="inline-flex min-h-[30px] items-center px-1.5 font-mono text-[11px]">{l.lot_fournisseur}</span>
                    ) : (
                      <input
                        value={l.lot_fournisseur}
                        onChange={(ev) => f.majLigne(l.cle, 'lot_fournisseur', ev.target.value)}
                        aria-label="Lot fournisseur"
                        className="min-h-[30px] w-28 rounded-[3px] border border-bordure bg-fond px-1.5 font-mono text-[11px]"
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right text-attenue-texte">
                    {l.avant_bobines} · {l.avant_pourcentage != null ? `${nb(l.avant_pourcentage, 1)} %` : '—'}
                    <div className="text-[10.5px]">{nb(l.avant_kg, 1)} kg</div>
                  </td>
                  {type === 'CHARGE' && (
                    <>
                      <td className="px-1 py-1">
                        <Case v={l.mouvementees} set={(n) => f.majLigne(l.cle, 'mouvementees', n)} />
                      </td>
                      <td className="px-1 py-1 text-right">
                        <Case v={l.poids_retenu} pas={0.001} set={(n) => f.majLigne(l.cle, 'poids_retenu', n)} />
                        {(() => {
                          const rappel = rappelCatalogue({ poids: l.poids_retenu, poids_catalogue: l.poids_catalogue })
                          if (!rappel) return null
                          const c = couleurEcart(ecartPoidsBobine({ poids: l.poids_retenu, poids_catalogue: l.poids_catalogue }), tolerances)
                          return (
                            <div className={cn('mt-0.5 whitespace-nowrap text-[10.5px]', c ? CLASSE_ECART[c] : 'text-attenue-texte')}>
                              {rappel}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-1 py-1 text-right">
                        <Case v={l.pourcentage} pas={0.1} max={500} set={(n) => f.majLigne(l.cle, 'pourcentage', n)} />
                        {touchee && e.theorique != null && (
                          <div className="mt-0.5 whitespace-nowrap text-[10.5px] text-attenue-texte">théorique {nb(e.theorique, 1)} %</div>
                        )}
                      </td>
                    </>
                  )}
                  {type === 'DECHARGE' && (
                    <>
                      <td className="px-1 py-1">
                        <Case v={l.mouvementees} max={l.avant_bobines} set={(n) => f.majLigne(l.cle, 'mouvementees', n)} />
                      </td>
                      <td className="px-1 py-1">
                        <Case v={l.pct_retirees} pas={0.1} max={500} set={(n) => f.majLigne(l.cle, 'pct_retirees', n)} />
                      </td>
                      <td className="px-1 py-1">
                        {destinations.length === 1 ? (
                          <span className="inline-flex min-h-[30px] items-center text-[11.5px]">{LIBELLE_DESTINATION[destinations[0]]}</span>
                        ) : (
                          <select
                            value={l.destination}
                            onChange={(ev) => f.majLigne(l.cle, 'destination', ev.target.value as Destination)}
                            aria-label="Destination"
                            className={cn('min-h-[30px] w-36 rounded-[3px] border bg-fond px-1 text-[11.5px]', touchee && !l.destination ? 'border-danger' : 'border-bordure')}
                          >
                            <option value="">Destination…</option>
                            {destinations.map((d) => (
                              <option key={d} value={d}>{LIBELLE_DESTINATION[d]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {toutRetire ? (
                          <span className="inline-flex min-h-[30px] items-center text-[11px] text-attenue-texte">ligne vidée</span>
                        ) : (
                          <Case v={l.pourcentage} pas={0.1} max={500} set={(n) => f.majLigne(l.cle, 'pourcentage', n)} />
                        )}
                      </td>
                    </>
                  )}
                  {type === 'MAJ' && (
                    <>
                      <td className="px-1 py-1">
                        <Case v={l.presentes} set={(n) => f.majLigne(l.cle, 'presentes', n)} zero />
                      </td>
                      <td className="px-1 py-1">
                        <Case v={l.pourcentage} pas={0.1} max={500} set={(n) => f.majLigne(l.cle, 'pourcentage', n)} zero />
                      </td>
                    </>
                  )}
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    {touchee ? (
                      <>
                        {e.nbApres} bob.
                        <div className="text-[10.5px] text-attenue-texte">{nb(e.kgApres, 1)} kg</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className={cn('whitespace-nowrap px-2 py-1 text-right font-medium', e.ecart < -0.0005 && 'text-alerte')}>
                    {touchee ? `${nb(e.ecart, 1)} kg` : '—'}
                  </td>
                  <td className="px-1 py-1">{touchee ? choixMotif(l) : null}</td>
                  <td className="px-1 py-1">
                    {l.avant_bobines === 0 && (
                      <button type="button" onClick={() => f.retirer(l.cle)} className="text-attenue-texte hover:text-danger" aria-label="Retirer la ligne">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink/20 bg-attenue font-semibold">
              <td className="px-2 py-1.5" colSpan={type === 'DECHARGE' ? 7 : type === 'CHARGE' ? 6 : 5}>
                Étage après : <span className={cn('tabular-nums', f.totaux.apres > f.totaux.places && 'text-danger')}>
                  {f.totaux.apres} / {f.totaux.places} places
                </span>
                {f.totaux.apres < f.totaux.places && (
                  <span className="ml-2 font-normal text-attenue-texte">({f.totaux.places - f.totaux.apres} libres)</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{nb(f.totaux.kgApres, 1)} kg</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{nb(f.totaux.ecart, 1)} kg</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* --- Ajouter une reference qui n'etait pas sur l'etage (chargement) -- */}
      {type === 'CHARGE' && (
        <div>
          {ajout ? (
            <div className="flex gap-2">
              <select
                onChange={(e) => {
                  const r = (qCat.data ?? []).find((x) => x.code_reference === e.target.value)
                  if (r) {
                    f.ajouter(ligneNeuve(r.code_reference, r.designation, r.poids_bobine_kg ?? 0, r.poids_bobine_kg))
                    setAjout(false)
                  }
                }}
                className="min-h-[34px] flex-1 rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
                defaultValue=""
              >
                <option value="">Choisir une référence…</option>
                {(qCat.data ?? []).map((r) => (
                  <option key={r.code_reference} value={r.code_reference}>{r.designation}</option>
                ))}
              </select>
              <button type="button" onClick={() => setAjout(false)} className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure px-3 text-[13px]">
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAjout(true)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-bordure px-3 text-[13px] hover:bg-attenue"
            >
              <Plus className="size-3.5" />
              Ajouter une référence
            </button>
          )}
        </div>
      )}

      {f.totaux.apres > f.totaux.places && (
        <Alerte ton="danger" titre="Capacité dépassée">
          L’étage porterait {f.totaux.apres} bobines pour {f.totaux.places} places.
        </Alerte>
      )}

      {/* --- L'apercu : ce que la decision enregistrera ------------------- */}
      {f.apercu && (
        <div className="rounded-[var(--radius)] border border-bordure p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
            Aperçu — ce que la validation enregistrera
          </div>
          <TableApercu type={type} lignes={f.apercu.lignes} designations={designations} />
          {f.apercu.blocages.length > 0 && (
            <Alerte ton="danger" titre={f.stockCourt ? (f.stockCourt.startsWith('LOT') ? 'Chargement bloqué : ce lot n’est pas au magasin en quantité suffisante' : 'Chargement bloqué : stock insuffisant au magasin') : 'La décision ne peut pas être validée'} className="mt-2">
              <ul className="list-disc space-y-1 pl-4">
                {f.apercu.blocages.map((b) => (
                  <li key={b}>{b.replace(/^(STOCK|LOT)-INSUFFISANT : (chargement bloque — )?/, '').replace(/\. Prevenez le directeur.*$/, '')}</li>
                ))}
              </ul>
              {f.stockCourt && (
                <p className="mt-1.5 font-medium">
                  Prévenez le directeur ou l’administrateur : la correction de stock doit être faite et validée par eux avant ce chargement.
                </p>
              )}
            </Alerte>
          )}
        </div>
      )}
      {f.apercuPerime && (
        <Alerte ton="alerte" titre="Saisie modifiée depuis l’aperçu">
          Refaites l’aperçu avant de valider : il doit montrer exactement ce qui sera enregistré.
        </Alerte>
      )}

      {f.calculer.isError && (
        <Alerte ton="danger" titre="Aperçu impossible">{(f.calculer.error as Error).message}</Alerte>
      )}
      {f.envoi.isError && (
        <Alerte ton="danger" titre="Validation refusée">{(f.envoi.error as Error).message}</Alerte>
      )}
      {f.envoi.isSuccess && (
        <Alerte ton="succes" titre={`Décision validée — ${f.envoi.data?.numero_fiche ?? ''}`}>
          Validation n°{f.envoi.data?.numero_validation}
          {f.envoi.data?.mouvement && ` · mouvement ${f.envoi.data.mouvement}`}
          {` · consommation ${nb(f.envoi.data?.consomme_kg ?? 0, 1)} kg.`}
          <span className="ml-2 inline-flex gap-2">
            {f.envoi.data?.id_fiche && (
              <button type="button" onClick={() => ouvrir(`/machines/fiches/${f.envoi.data!.id_fiche}`)}
                      className="font-medium text-primaire underline-offset-2 hover:underline">
                Voir la fiche
              </button>
            )}
            <button type="button" onClick={() => ouvrir(`/machines/${encodeURIComponent(machine.code_machine)}?etage=${encodeURIComponent(f.zone?.code_emplacement ?? '')}`)}
                    className="font-medium text-primaire underline-offset-2 hover:underline">
              Retour à la machine
            </button>
          </span>
          <div className="mt-1 text-[12px] text-attenue-texte">La saisie ci-dessus repart de l’état résultant : vous pouvez enchaîner une autre décision sur cet étage.</div>
        </Alerte>
      )}

      {v.element}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!f.pret || f.calculer.isPending}
          onClick={() => f.calculer.mutate()}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] border border-primaire px-4 text-[14px] font-semibold text-primaire disabled:opacity-40"
        >
          {f.calculer.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          Aperçu
        </button>
        <button
          type="button"
          disabled={!f.peutValider || f.envoi.isPending}
          onClick={v.valider}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] bg-primaire px-4 text-[14px] font-semibold text-primaire-texte disabled:opacity-40"
        >
          {f.envoi.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Valider la décision
        </button>
        <span className="text-[12px] text-attenue-texte">
          {f.manque ?? (!f.apercu ? 'Faites l’aperçu, relisez-le, puis validez.' : '')}
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

/** Une case numerique. `zero` : afficher 0 plutot qu'une case vide. */
function Case({
  v, set, pas = 1, max, zero,
}: { v: number; set: (v: number) => void; pas?: number; max?: number; zero?: boolean }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={pas}
      min={0}
      max={max}
      value={zero ? v : v || ''}
      onChange={(e) => set(Math.min(max ?? Infinity, Math.max(0, Number(e.target.value) || 0)))}
      className="min-h-[30px] w-20 rounded-[3px] border border-bordure bg-fond px-1.5 text-right tabular-nums"
    />
  )
}

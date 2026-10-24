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
import { ArrowLeft, Check, Eye, Loader2, MessageSquarePlus, Pencil, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react'
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
import { ChampScan } from '../../composants/ChampScan'
import { AvisInventaireOuvert } from '../../composants/AvisInventaireOuvert'
import { SaisieNombre } from '../../composants/ui/base'
import {
  bobinesVoie, cheminMachine, CLASSE_ECART, destinationsDe, ecartPoidsBobine, estimer, fmtDate, fmtInstant, LIBELLE_DESTINATION,
  LIBELLE_EFFET, LIBELLE_TYPE, ligneNeuve, machinesApi, nb, rappelCatalogue, signePct,
  type Apercu, type Destination, type Fiche, type FicheDetail, type LigneSaisie, type Machine, type Motif,
  type TypeFiche, type Zone,
  RAISONS_SURPLUS, TON_ECART,
} from './noyau'
import { useFiche } from './useFiche'
import { useValiderFiche } from './Questions'
import { DemandesDerogation } from './Derogation'
import { ChoixOF, ChoixQualite, qualiteDeLOf, useOfOuverts, type OfOuvert } from '../../composants/ChoixOF'
import { ChampReference } from '../../composants/ChampReference'
import { QualiteLigne } from './qualiteLigne'
import { resumeQualite, useEcranLarge } from './ligneMachine'
import { FicheMobile } from './Mobile'
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
  const large = useEcranLarge()
  if (chargement) return <Chargement texte="Lecture de la machine…" />
  const zone = zones.find((z) => z.code_emplacement === codeZone)
  if (!machine || !zone || !TYPES.includes(type as TypeFiche)) {
    return <Alerte ton="danger" titre="Fiche introuvable">Machine, étage ou type de fiche inconnu.</Alerte>
  }
  /* SOUS 1024 PX, L'INTERFACE DE TERRAIN (24/10/2026) : le meme seuil que /machines ;
     la meme saisie (useFiche), donc le meme corps envoye. */
  if (!large) {
    return (
      <FicheMobile
        key={`${codeZone}-${type}`}
        machine={machine}
        zone={zone}
        type={type as TypeFiche}
        retour={() => ouvrir(cheminMachine(code, codeZone))}
      />
    )
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
  const large = useEcranLarge()
  const zone = zones.find((z) => z.code_emplacement === d.entete.code_emplacement)
  if (!zone) return <Chargement texte="Lecture des étages…" />
  const e = d.entete
  if (!large) {
    return (
      <>
        <FicheMobile
          key={e.id_fiche}
          machine={machine}
          zone={zone}
          type={e.type_fiche}
          idFiche={e.id_fiche}
          retour={() => ouvrir(cheminMachine(machine.code_machine, e.code_emplacement))}
          annuler={() => setGeste('annuler')}
        />
        {geste && <GesteRetrait fiche={e} mode={geste} fermer={() => setGeste(null)} />}
      </>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={`${e.numero_fiche} · ${LIBELLE_TYPE[e.type_fiche]}`}
        description={
          <span className="inline-flex items-center gap-2">
            {machine.nom} · {zone.libelle}
            <Badge ton="alerte">Brouillon</Badge>
            {e.nb_validations > 0 && <span className="text-alerte">dévalidée</span>}
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
      {e.nb_validations > 0 && (
        <p className="text-[12.5px] text-alerte">
          Dévalidée : l’étage est revenu à son état précédent. Corrigez la saisie (l’étage aussi si besoin), puis revalidez.
        </p>
      )}
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
  /* L'APERCU AVANT D'ANNULER (F22, 09/10/2026) : on voit l'etat auquel l'etage
     reviendra et les mouvements magasin qui seront annules, au lieu d'un motif
     demande a l'aveugle. */
  const qApercu = useQuery({
    queryKey: ['machine-retrait-apercu', fiche.id_fiche],
    queryFn: () => machinesApi.apercuRetrait(fiche.id_fiche),
    enabled: !brouillon,
  })
  const ap = qApercu.data
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
            {ap?.decision && ap.derniere === false && (
              <p className="text-danger">
                Ce n’est pas la dernière décision de l’étage : elle ne se retire pas seule. Corrigez par un constat «
                Correction ».
              </p>
            )}
            {ap?.etat_avant && (
              <div className="rounded-[var(--radius-sm)] border border-bordure p-2 text-[12px]">
                <div className="font-medium">L’étage reviendra à :</div>
                {ap.etat_avant.length === 0 ? (
                  <div className="text-attenue-texte">vide</div>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {ap.etat_avant.map((e) => (
                      <li key={`${e.code_reference}-${e.lot_fournisseur}`}>
                        {e.code_reference} · {e.lot_fournisseur || 'sans lot'} — {e.nb_bobines} bobines,{' '}
                        {nb(e.kg, 1)} kg
                      </li>
                    ))}
                  </ul>
                )}
                {(ap.mouvements ?? []).length > 0 && (
                  <>
                    <div className="mt-1.5 font-medium">Mouvements magasin annulés :</div>
                    <ul className="m-0 list-none p-0">
                      {(ap.mouvements ?? []).map((m) => (
                        <li key={m.numero_mouvement}>
                          {m.numero_mouvement} ({m.code_type_mvt === 'CHARGE_MACHINE' ? 'chargement' : 'retour'},{' '}
                          {m.code_magasin}) — {nb(m.kg, 1)} kg
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
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
          <Info t="Ordre de fabrication" v={e.numero_of_lien || e.numero_of || '—'} />
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
            <td className="py-1.5 pr-2 font-mono text-[11px]">
              {l.lot_fournisseur}
              {(l.numero_of || l.largeur_voie_m != null) && (
                <div className="font-sans text-[10px] text-attenue-texte">
                  {l.numero_of ?? ''}{l.numero_of && l.largeur_voie_m != null ? ' · ' : ''}
                  {l.largeur_voie_m != null ? `voie ${nb(l.largeur_voie_m, 2)} m` : ''}
                </div>
              )}
            </td>
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
            <th className="py-1 pr-2 text-left" title="L’écart appartient à l’OF de la période qui se termine (l’OF sortant)">OF de la période → nouveau</th>
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
              <td className="py-1 pr-2 text-attenue-texte">
                {/* LA REGLE DE FRONTIERE (22/10/2026) : l'ecart est range sous l'OF de la periode. */}
                <span className={cn(l.numero_of_periode && 'font-medium text-texte')}>{l.numero_of_periode ?? '—'}</span>
                {(l.numero_of ?? null) !== (l.numero_of_periode ?? null) && <> → {l.numero_of ?? '—'}</>}
                {l.largeur_voie_m != null && (
                  <div className="text-[10px]">
                    voie {nb(l.largeur_voie_m, 2)} m{l.bobines_voie != null && ` · ${l.bobines_voie} bobines`}
                  </div>
                )}
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

type EtatFiche = ReturnType<typeof useFiche>

/**
 * UNE LIGNE MODIFIEE, pour l'ecran seulement : elle reste ouverte. Rien de ce
 * qui part au serveur n'en depend — le corps est celui de `corpsFiche`.
 */
function modifiee(type: TypeFiche, l: LigneSaisie) {
  if (type !== 'MAJ' && l.mouvementees > 0) return true
  if (type === 'MAJ' && (l.presentes !== l.avant_bobines || l.pourcentage !== (l.avant_pourcentage ?? 100))) return true
  return !!(l.id_of || l.code_qualite || l.motif_texte.trim() || l.effet_ecart)
}

/** Une ligne qui part au serveur et qu'il faut encore completer (motif, effet) : elle s'ouvre d'elle-meme. */
function aCompleter(type: TypeFiche, l: LigneSaisie, m: Motif | undefined) {
  if (type !== 'MAJ' && l.mouvementees === 0) return false
  return !l.code_motif || (!!m && !m.effet_defaut && !l.effet_ecart)
}

const LIBELLE_NIVEAU: Record<string, string> = { VERT: 'vert', ORANGE: 'orange', ROUGE: 'rouge' }

/* LES LARGEURS DE LA GRILLE (24/10/2026) : fixes, en table `fixed`, pour qu'elle
   tienne dans la largeur sans defiler — 1 366 px avec la barre laterale laissent
   ~1 090 px. La reference et son lot prennent le reste. */
const COL = {
  avant: 'w-[4.75rem]',
  saisie: 'w-[5rem]',
  poids: 'w-[4.75rem]',
  apres: 'w-[4.5rem]',
  ecart: 'w-[4.5rem]',
  of: 'w-[9.75rem]',
  motif: 'w-[8.75rem]',
  geste: 'w-[4.25rem]',
} as const

const CHAMP = 'h-7 w-full min-w-0 rounded-[3px] border bg-fond px-1 text-[11px]'

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
  const ofs = useOfOuverts()
  const v = useValiderFiche(f)
  const [ajout, setAjout] = useState(false)
  /** Les lignes ouvertes a la main (« Modifier ») ; les autres se lisent. */
  const [ouvertes, setOuvertes] = useState<Set<string>>(() => new Set())
  /** Les lignes dont on a demande la precision, quand elle ne tient pas sur la rangee. */
  const [precisions, setPrecisions] = useState<Set<string>>(() => new Set())
  const tolerances = useTolerancesLot()

  const qMag = useQuery({
    queryKey: ['magasins', 'actifs'],
    queryFn: ({ signal }) => api.get<Magasin[]>('/api/magasins?actif=1', { signal }),
  })

  const toucheMagasin = type === 'CHARGE' || type === 'DECHARGE'
  const designations = Object.fromEntries(f.lignes.map((l) => [l.code_reference, l.designation]))
  /** LE NIVEAU D'UN ECART est celui du serveur (seuils, effet, surplus) : il vient de l'apercu a jour. */
  const niveauDe = (l: LigneSaisie) =>
    f.apercu?.lignes.find((x) => x.code_reference === l.code_reference && x.lot_fournisseur === l.lot_fournisseur)?.niveau_ecart
  const numeroOf = (id: string) => (ofs.data ?? []).find((o) => o.id_of === id)?.numero ?? '…'
  const ajouterA = (s: Set<string>, cle: string) => new Set([...s, cle])
  const nbColonnes = type === 'CHARGE' ? 10 : type === 'DECHARGE' ? 10 : 9

  return (
    <div className="flex flex-col gap-3">
      {toucheMagasin && <AvisInventaireOuvert inventaires={f.gel} />}
      {/* --- L'entete, sur une rangee quand elle tient ----------------------- */}
      <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3">
        {idFiche && (
          /* UNE FICHE REPRISE PEUT CHANGER D'ETAGE : c'est le cas de l'erreur
             d'emplacement. Le journal garde l'etage d'origine. */
          <label className="flex w-[7rem] flex-col gap-1">
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
        )}
        <Champ label="Date" type="date" className="w-[8.75rem]" v={f.entete.date} set={(x) => f.setEntete({ ...f.entete, date: x })} />
        {toucheMagasin && (
          <label className="flex w-[9.5rem] flex-col gap-1">
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
        {/* L'OF EN LIEN (22/10/2026) : la fiche le choisit, il sert de defaut a ses
            lignes. Jamais impose par la machine. Le numero reste dans le texte
            d'historique. */}
        <label className="flex min-w-[11rem] flex-1 flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Ordre de fabrication</span>
          <ChoixOF
            valeur={f.entete.id_of}
            inconnu={f.entete.of || null}
            vide={f.entete.of && !f.entete.id_of ? `${f.entete.of} (texte ancien)` : '— l’OF de chaque ligne —'}
            onChange={(id, numero) =>
              f.setEntete({ ...f.entete, id_of: id, of: id ? numero : f.entete.of, code_qualite: id ? '' : f.entete.code_qualite })
            }
          />
        </label>
        {/* LA QUALITE DE LA FICHE (23/10/2026) : le defaut des lignes d'un
            chargement sans OF ; avec un OF, la sienne. */}
        {type === 'CHARGE' && (
          <div className="flex w-[11rem] flex-col gap-1">
            <span className="text-[11px] text-attenue-texte">Qualité (sans OF)</span>
            <ChoixQualite
              valeur={f.entete.code_qualite}
              onChange={(q) => f.setEntete({ ...f.entete, code_qualite: q })}
              imposee={f.entete.id_of ? (qualiteDeLOf(ofs.data, f.entete.id_of) ?? '…') : null}
              vide="— la qualité de chaque ligne —"
            />
          </div>
        )}
        <Champ label="Responsable" className="w-[9.5rem]" v={f.entete.responsable} set={(x) => f.setEntete({ ...f.entete, responsable: x })} />
        {/* LES OBSERVATIONS partaient deja (corpsFiche) sans champ pour les dire (24/10/2026). */}
        <Champ label="Observations" className="min-w-[10rem] flex-[1.3]" v={f.entete.observations}
               set={(x) => f.setEntete({ ...f.entete, observations: x })} />
      </div>

      {/* --- La grille : une rangee par ligne, sans defilement horizontal ----- */}
      <div className="rounded-[var(--radius)] border border-bordure bg-surface">
        <table data-grille-machine className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="whitespace-nowrap bg-attenue text-left text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="px-1.5 py-1.5">Référence · lot</th>
              <th className={cn(COL.avant, 'px-1 py-1.5 text-right')}>Avant</th>
              {type === 'CHARGE' && (
                <>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')}>À charger</th>
                  <th className={cn(COL.poids, 'px-1 py-1.5 text-right')}>Poids/bob.</th>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')} title="% de toute la ligne après le chargement">% après</th>
                </>
              )}
              {type === 'DECHARGE' && (
                <>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')}>À retirer</th>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')} title="% des bobines retirées">% retirées</th>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')} title="% des bobines qui restent">% restantes</th>
                </>
              )}
              {type === 'MAJ' && (
                <>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')}>Présentes</th>
                  <th className={cn(COL.saisie, 'px-1 py-1.5 text-right')}>% constaté</th>
                </>
              )}
              <th className={cn(COL.apres, 'px-1 py-1.5 text-right')} title="Après la décision, estimé pendant la saisie">Après</th>
              <th className={cn(COL.ecart, 'px-1 py-1.5 text-right')} title="Le niveau (vert, orange, rouge) vient de l’aperçu">Écart</th>
              <th className={cn(COL.of, 'px-1 py-1.5')} title="L’OF que la ligne servira, sa qualité, et sa voie (largeur) : le nombre de bobines à manipuler">OF · qualité · voie</th>
              <th className={cn(COL.motif, 'px-1 py-1.5')}>{type === 'DECHARGE' ? 'Motif · destination' : 'Motif'}</th>
              <th className={cn(COL.geste, 'px-1 py-1.5')}><span className="sr-only">Geste</span></th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {f.lignes.map((l) => (
              <LigneBureau
                key={l.cle}
                f={f}
                l={l}
                type={type}
                machine={machine}
                zone={zone}
                ofs={ofs.data}
                tolerances={tolerances}
                ouverte={ouvertes.has(l.cle) || l.avant_bobines === 0 || modifiee(type, l) || aCompleter(type, l, f.motifDe(l.code_motif))}
                ouvrir={() => setOuvertes((s) => ajouterA(s, l.cle))}
                precisionDemandee={precisions.has(l.cle)}
                demanderPrecision={() => setPrecisions((s) => ajouterA(s, l.cle))}
                niveau={niveauDe(l)}
                numeroOf={numeroOf}
                nbColonnes={nbColonnes}
              />
            ))}
          </tbody>
        </table>
        {/* LA RAISON D'UN SURPLUS AU CHARGEMENT (regle 2, 09/10/2026) : le serveur
            attend l'une des trois de la liste ; le champ reste libre pour le
            commentaire d'un ecart rouge. */}
        <datalist id="raisons-surplus">
          {RAISONS_SURPLUS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>

      {/* --- Ajouter une reference qui n'etait pas sur l'etage (chargement) -- */}
      {type === 'CHARGE' && (
        <div className="flex flex-wrap items-start gap-2">
          {f.entete.magasin && <ChampScan surLecture={f.scanner} className="w-full max-w-md" />}
          {ajout ? (
            <div className="flex min-w-[18rem] flex-1 items-start gap-2">
              {/* LA RECHERCHE SE FAIT AU SERVEUR (24/10/2026) : « code — désignation »,
                  comme partout ; plus de liste du catalogue entier. */}
              <ChampReference
                valeur=""
                autoFocus
                placeholder="Tapez une référence à charger…"
                ariaLabel="Ajouter une référence"
                className="max-w-xl flex-1"
                surChoix={(r) => {
                  f.ajouter(ligneNeuve(r.code_reference, r.designation ?? r.code_reference, r.poids_bobine_kg ?? 0, r.poids_bobine_kg))
                  setAjout(false)
                }}
              />
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
          {(f.apercu.signaux ?? []).length > 0 && (
            <Alerte ton="alerte" titre="À vérifier (n’empêche pas la validation)" className="mt-2">
              <ul className="list-disc space-y-1 pl-4">
                {(f.apercu.signaux ?? []).map((x) => <li key={x}>{x}</li>)}
              </ul>
            </Alerte>
          )}
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
              <DemandesDerogation derogations={f.apercu.derogations ?? []} surDemande={() => f.calculer.mutate()} />
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

      {/* --- LA BARRE D'ACTIONS, COLLEE EN BAS (24/10/2026) : l'etage apres, l'ecart,
          ce qui manque, l'apercu et la validation restent a portee pendant la saisie. */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
          <span>
            Étage après :{' '}
            <span className={cn('font-semibold', f.totaux.apres > f.totaux.places && 'text-danger')}>
              {f.totaux.apres} / {f.totaux.places} places
            </span>
            {f.totaux.apres < f.totaux.places && (
              <span className="text-attenue-texte"> ({f.totaux.places - f.totaux.apres} libres)</span>
            )}
          </span>
          <span className="text-attenue-texte">{nb(f.totaux.kgApres, 1)} kg</span>
          <span>
            écart <span className="font-semibold">{nb(f.totaux.ecart, 1)} kg</span>
          </span>
          <span className="text-[12px] text-attenue-texte">
            {f.manque ?? (!f.apercu ? 'Faites l’aperçu, relisez-le, puis validez.' : '')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!f.pret || f.calculer.isPending}
            onClick={() => f.calculer.mutate()}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-[var(--radius-sm)] border border-primaire px-4 text-[14px] font-semibold text-primaire disabled:opacity-40"
          >
            {f.calculer.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            Aperçu
          </button>
          <button
            type="button"
            disabled={!f.peutValider || f.envoi.isPending}
            onClick={v.valider}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-[var(--radius-sm)] bg-primaire px-4 text-[14px] font-semibold text-primaire-texte disabled:opacity-40"
          >
            {f.envoi.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Valider la décision
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * UNE LIGNE DE LA GRILLE. Fermee, elle se lit (aucune case) ; « Modifier »
 * l'ouvre. Ouverte, tout tient sur une rangee ; la precision ne descend sur une
 * rangee « ↳ » que si la colonne du motif est deja prise (effet a choisir,
 * destination) et qu'elle est demandee ou necessaire (ecart orange ou rouge).
 * Declaree au niveau du module : son identite ne change pas a chaque frappe.
 */
function LigneBureau({
  f, l, type, machine, zone, ofs, tolerances, ouverte, ouvrir, precisionDemandee, demanderPrecision, niveau, numeroOf,
  nbColonnes,
}: {
  f: EtatFiche
  l: LigneSaisie
  type: TypeFiche
  machine: Machine
  zone: Zone
  ofs: OfOuvert[] | undefined
  tolerances: ReturnType<typeof useTolerancesLot>
  ouverte: boolean
  ouvrir: () => void
  precisionDemandee: boolean
  demanderPrecision: () => void
  niveau: string | undefined
  numeroOf: (id: string) => string
  nbColonnes: number
}) {
  const e = estimer(type, l)
  // Comme avant : une ligne « touchee » part au serveur et montre son estimation.
  const touchee = type === 'MAJ' || l.mouvementees > 0
  const m = f.motifDe(l.code_motif)
  const destinations = destinationsDe(m)
  const effets = (m?.effets_permis ?? '').split(',').filter(Boolean)
  const effetAChoisir = !!m && !m.effet_defaut
  const toutRetire = type === 'DECHARGE' && l.mouvementees >= l.avant_bobines && l.mouvementees > 0
  const maj = <K extends keyof LigneSaisie>(champ: K, x: LigneSaisie[K]) => f.majLigne(l.cle, champ, x)
  const libelle = l.designation || l.code_reference
  const cap = bobinesVoie(zone.capacite_bobines, machine.largeur_m, l.largeur_voie)
  const depasse = cap != null && touchee && e.nbApres > cap

  /* LA COLONNE DU MOTIF : le motif, puis UNE seconde commande — l'effet s'il est a
     choisir, sinon la destination (dechargement), sinon la precision. */
  const secondePrise = effetAChoisir || type === 'DECHARGE'
  const niveauFort = niveau === 'ORANGE' || niveau === 'ROUGE'
  const suite = ouverte && touchee && secondePrise && (precisionDemandee || !!l.motif_texte.trim() || niveauFort)

  const champPrecision = (classe: string) => (
    <input
      list="raisons-surplus"
      value={l.motif_texte}
      onChange={(ev) => maj('motif_texte', ev.target.value)}
      placeholder={niveauFort ? 'Précision (obligatoire si rouge)' : 'Précision…'}
      title="Précision du motif : obligatoire si l’écart est rouge"
      aria-label="Précision du motif"
      className={cn(CHAMP, 'border-bordure', classe)}
    />
  )

  const voie = cap != null ? (
    type === 'CHARGE' && cap > l.avant_bobines && l.mouvementees === 0 ? (
      <button
        type="button"
        onClick={() => maj('mouvementees', cap - l.avant_bobines)}
        className="text-[10.5px] font-medium text-primaire underline-offset-2 hover:underline"
        title={`Proposer de charger la voie jusqu’à sa capacité (${cap} bobines)`}
      >
        charger {cap - l.avant_bobines}
      </button>
    ) : (
      <span className={cn('text-[10.5px]', depasse ? 'text-alerte' : 'text-attenue-texte')}
            title={`${cap} bobines pour cette voie${depasse ? ` — ${e.nbApres} prévues, au-delà` : ''}`}>
        voie {cap}{depasse && ' !'}
      </span>
    )
  ) : l.largeur_voie && !machine.largeur_m ? (
    <span className="text-[10.5px] text-attenue-texte" title="Largeur de la machine inconnue">voie ?</span>
  ) : null

  const lu = (x: React.ReactNode) => <span className="text-[11.5px] text-attenue-texte">{x}</span>

  return (
    <>
      <tr data-ligne={l.cle} className={cn('border-t border-bordure align-top', !ouverte && 'text-attenue-texte')}>
        {/* Reference et lot, un seul bloc */}
        <td className="min-w-0 px-1.5 py-1">
          <div className={cn('truncate text-[12px]', ouverte ? 'text-texte' : '')} title={`${l.code_reference} — ${l.designation}`}>
            {libelle}
          </div>
          <div className="mt-0.5">
            {ouverte && type === 'CHARGE' && f.entete.magasin && l.avant_bobines === 0 ? (
              <ChampLot
                reference={l.code_reference}
                magasin={f.entete.magasin}
                valeur={l.lot_fournisseur}
                onChange={(x) => maj('lot_fournisseur', x)}
                invalide={!l.lot_fournisseur}
                className="h-7 w-full max-w-[14rem] rounded-[3px] border border-bordure bg-fond px-1 font-mono text-[11px]"
                proposerPlusAncien
              />
            ) : l.lot_fournisseur === SANS_LOT ? (
              <span className="text-[11px] italic text-attenue-texte">{libelleLot(l.lot_fournisseur)}</span>
            ) : l.avant_bobines > 0 || !ouverte ? (
              <span className="font-mono text-[11px] text-attenue-texte">{l.lot_fournisseur || '—'}</span>
            ) : (
              <input
                value={l.lot_fournisseur}
                onChange={(ev) => maj('lot_fournisseur', ev.target.value)}
                aria-label="Lot fournisseur"
                placeholder="Lot fournisseur"
                className={cn(CHAMP, 'max-w-[14rem] border-bordure font-mono')}
              />
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-1 py-1 text-right text-[11px] text-attenue-texte">
          {l.avant_bobines} · {l.avant_pourcentage != null ? `${nb(l.avant_pourcentage, 1)} %` : '—'}
          <div>{nb(l.avant_kg, 1)} kg</div>
        </td>

        {type === 'CHARGE' && (ouverte ? (
          <>
            <td className="px-1 py-1 text-right">
              <Case v={l.mouvementees} libelle={`À charger, ${libelle}`} set={(n) => maj('mouvementees', n)} />
              {voie}
            </td>
            <td className="px-1 py-1 text-right">
              <Case v={l.poids_retenu} pas={0.001} libelle={`Poids par bobine, ${libelle}`} set={(n) => maj('poids_retenu', n)} />
              {(() => {
                const rappel = rappelCatalogue({ poids: l.poids_retenu, poids_catalogue: l.poids_catalogue })
                if (!rappel) return null
                const pct = ecartPoidsBobine({ poids: l.poids_retenu, poids_catalogue: l.poids_catalogue })
                const c = couleurEcart(pct, tolerances)
                return (
                  <div className={cn('whitespace-nowrap text-[10.5px]', c ? CLASSE_ECART[c] : 'text-attenue-texte')} title={rappel}>
                    {pct != null ? `cat. ${signePct(pct)}` : rappel}
                  </div>
                )
              })()}
            </td>
            <td className="px-1 py-1 text-right">
              <Case v={l.pourcentage} pas={0.1} max={500} libelle={`% de la ligne après, ${libelle}`} set={(n) => maj('pourcentage', n)} />
              {touchee && e.theorique != null && (
                <div className="whitespace-nowrap text-[10.5px] text-attenue-texte" title="% théorique">th. {nb(e.theorique, 1)}</div>
              )}
            </td>
          </>
        ) : (
          <>
            <td className="px-1 py-1 text-right">{lu('—')}</td>
            <td className="px-1 py-1 text-right">{lu(nb(l.poids_retenu, 3))}</td>
            <td className="px-1 py-1 text-right">{lu(nb(l.pourcentage, 1))}</td>
          </>
        ))}

        {type === 'DECHARGE' && (ouverte ? (
          <>
            <td className="px-1 py-1 text-right">
              <Case v={l.mouvementees} max={l.avant_bobines} libelle={`À retirer, ${libelle}`} set={(n) => maj('mouvementees', n)} />
              {voie}
            </td>
            <td className="px-1 py-1 text-right">
              <Case v={l.pct_retirees} pas={0.1} max={500} libelle={`% des retirées, ${libelle}`} set={(n) => maj('pct_retirees', n)} />
            </td>
            <td className="px-1 py-1 text-right">
              {toutRetire ? (
                <span className="inline-flex h-7 items-center text-[11px] text-attenue-texte">vidée</span>
              ) : (
                <Case v={l.pourcentage} pas={0.1} max={500} libelle={`% des restantes, ${libelle}`} set={(n) => maj('pourcentage', n)} />
              )}
            </td>
          </>
        ) : (
          <>
            <td className="px-1 py-1 text-right">{lu('—')}</td>
            <td className="px-1 py-1 text-right">{lu(nb(l.pct_retirees, 1))}</td>
            <td className="px-1 py-1 text-right">{lu(nb(l.pourcentage, 1))}</td>
          </>
        ))}

        {type === 'MAJ' && (ouverte ? (
          <>
            <td className="px-1 py-1 text-right">
              <Case v={l.presentes} zero libelle={`Présentes, ${libelle}`} set={(n) => maj('presentes', n)} />
              {voie}
            </td>
            <td className="px-1 py-1 text-right">
              <Case v={l.pourcentage} pas={0.1} max={500} zero libelle={`% constaté, ${libelle}`} set={(n) => maj('pourcentage', n)} />
            </td>
          </>
        ) : (
          <>
            <td className="px-1 py-1 text-right">{lu(l.presentes)}</td>
            <td className="px-1 py-1 text-right">{lu(nb(l.pourcentage, 1))}</td>
          </>
        ))}

        <td className="whitespace-nowrap px-1 py-1 text-right text-[11.5px]">
          {touchee ? (
            <>
              {e.nbApres} bob.
              <div className="text-[10.5px] text-attenue-texte">{nb(e.kgApres, 1)} kg</div>
            </>
          ) : '—'}
        </td>
        <td
          className={cn(
            'whitespace-nowrap px-1 py-1 text-right text-[11.5px] font-medium',
            niveau && TON_ECART[niveau] ? TON_ECART[niveau] : touchee && e.ecart < -0.0005 && 'text-alerte',
          )}
          title={niveau && LIBELLE_NIVEAU[niveau] ? `Écart ${LIBELLE_NIVEAU[niveau]} (aperçu)` : 'Le niveau de l’écart vient de l’aperçu'}
        >
          {touchee ? `${nb(e.ecart, 1)} kg` : '—'}
          {touchee && niveau && LIBELLE_NIVEAU[niveau] && (
            <div className="text-[10px] font-normal">{LIBELLE_NIVEAU[niveau]}</div>
          )}
        </td>

        {/* OF · qualite · voie */}
        <td className="min-w-0 px-1 py-1">
          {ouverte ? (
            <div className="flex flex-col gap-1">
              <ChoixOF
                valeur={l.id_of ?? ''}
                onChange={(id) => maj('id_of', id)}
                vide={f.entete.id_of ? 'OF de la fiche' : l.avant_numero_of ? `garde ${l.avant_numero_of}` : '— aucun OF —'}
                ariaLabel="OF de la ligne"
                className="h-7 min-h-0 w-full min-w-0 px-1 text-[11px]"
              />
              <div className="flex min-w-0 items-center gap-1">
                <QualiteLigne
                  l={l}
                  entete={f.entete}
                  type={type}
                  ofs={ofs}
                  onChange={(q) => maj('code_qualite', q)}
                  className="h-7 min-h-0 min-w-0 flex-1 px-1 text-[11px]"
                />
                <SaisieNombre
                  min={0}
                  step={0.01}
                  value={l.largeur_voie || ''}
                  onChange={(ev) => maj('largeur_voie', Math.max(0, Number(ev.target.value) || 0))}
                  placeholder="voie"
                  title="Largeur de la voie, en mètres"
                  aria-label="Largeur de la voie (m)"
                  className="h-7 w-11 shrink-0 rounded-[3px] border border-bordure bg-fond px-1 text-right text-[11px] tabular-nums"
                />
              </div>
            </div>
          ) : (
            <div className="text-[11px] leading-tight">
              <div className="truncate">
                {l.id_of ? numeroOf(l.id_of) : f.entete.id_of ? 'OF de la fiche' : l.avant_numero_of ?? 'aucun OF'}
              </div>
              <div className="truncate">
                {resumeQualite(l, f.entete, type, ofs)}
                {!!l.largeur_voie && ` · voie ${nb(l.largeur_voie, 2)} m`}
              </div>
            </div>
          )}
        </td>

        {/* Motif, et la seconde commande */}
        <td className="min-w-0 px-1 py-1">
          {ouverte && touchee ? (
            <div className="flex flex-col gap-1">
              <select
                value={l.code_motif}
                onChange={(ev) => maj('code_motif', ev.target.value)}
                aria-label="Motif"
                className={cn(CHAMP, l.code_motif ? 'border-bordure' : 'border-danger')}
              >
                <option value="">Motif…</option>
                {f.motifs.map((x) => (
                  <option key={x.code_motif} value={x.code_motif}>{x.libelle}</option>
                ))}
              </select>
              {effetAChoisir ? (
                <select
                  value={l.effet_ecart}
                  onChange={(ev) => maj('effet_ecart', ev.target.value)}
                  aria-label="L'écart compte comme"
                  className={cn(CHAMP, l.effet_ecart ? 'border-bordure' : 'border-danger')}
                >
                  <option value="">L’écart compte comme…</option>
                  {effets.map((x) => (
                    <option key={x} value={x}>{LIBELLE_EFFET[x] ?? x}</option>
                  ))}
                </select>
              ) : type === 'DECHARGE' ? (
                destinations.length === 1 ? (
                  <span className="inline-flex h-7 items-center truncate text-[11px]">{LIBELLE_DESTINATION[destinations[0]]}</span>
                ) : (
                  <select
                    value={l.destination}
                    onChange={(ev) => maj('destination', ev.target.value as Destination)}
                    aria-label="Destination"
                    className={cn(CHAMP, !l.destination ? 'border-danger' : 'border-bordure')}
                  >
                    <option value="">Destination…</option>
                    {destinations.map((d) => (
                      <option key={d} value={d}>{LIBELLE_DESTINATION[d]}</option>
                    ))}
                  </select>
                )
              ) : (
                champPrecision('')
              )}
            </div>
          ) : touchee ? (
            <div className="text-[11px] leading-tight">
              <div className="truncate">{m?.libelle ?? '—'}</div>
              {type === 'DECHARGE' && (l.destination || destinations.length === 1) && (
                <div className="truncate">{LIBELLE_DESTINATION[(l.destination || destinations[0]) as Destination]}</div>
              )}
            </div>
          ) : null}
        </td>

        <td className="px-1 py-1">
          <div className="flex items-center justify-end gap-1.5">
            {!ouverte ? (
              <button
                type="button"
                onClick={ouvrir}
                aria-label={`Modifier la ligne ${libelle} · ${l.lot_fournisseur}`}
                className="inline-flex h-7 items-center gap-1 rounded-[3px] border border-bordure px-1.5 text-[11px] font-medium text-primaire hover:bg-attenue"
              >
                <Pencil className="size-3" />
                Modifier
              </button>
            ) : (
              <>
                {touchee && secondePrise && !suite && (
                  <button type="button" onClick={demanderPrecision} title="Ajouter une précision au motif"
                          aria-label={`Ajouter une précision, ${libelle}`} className="text-attenue-texte hover:text-primaire">
                    <MessageSquarePlus className="size-3.5" />
                  </button>
                )}
                {l.avant_bobines === 0 && (
                  <button type="button" onClick={() => f.retirer(l.cle)} className="text-attenue-texte hover:text-danger" aria-label="Retirer la ligne">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {suite && (
        <tr data-suite={l.cle} className="align-top">
          <td colSpan={nbColonnes} className="px-1.5 pb-1.5 pt-0">
            <div className="flex items-center gap-2 pl-3 text-[11px] text-attenue-texte">
              <span aria-hidden>↳</span>
              <span className="shrink-0">Précision du motif{niveauFort && niveau === 'ROUGE' ? ' (obligatoire : écart rouge)' : ''}</span>
              {champPrecision('max-w-[28rem] flex-1')}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Champ({
  label, v, set, type = 'text', className,
}: { label: string; v: string; set: (v: string) => void; type?: string; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11px] text-attenue-texte">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
        className="min-h-[34px] w-full min-w-0 rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
      />
    </label>
  )
}

/** Une case numerique. `zero` : afficher 0 plutot qu'une case vide. */
function Case({
  v, set, pas = 1, max, zero, libelle,
}: { v: number; set: (v: number) => void; pas?: number; max?: number; zero?: boolean; libelle?: string }) {
  return (
    <SaisieNombre
      inputMode="decimal"
      step={pas}
      min={0}
      max={max}
      aria-label={libelle}
      value={zero ? v : v || ''}
      onChange={(e) => set(Math.min(max ?? Infinity, Math.max(0, Number(e.target.value) || 0)))}
      className="h-7 w-full min-w-0 rounded-[3px] border border-bordure bg-fond px-1 text-right text-[12px] tabular-nums"
    />
  )
}

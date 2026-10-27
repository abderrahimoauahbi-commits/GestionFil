/**
 * LE DÉTAIL D'UNE RÉFERENCE AU MOTEUR DE COUVERTURE — le contenu de la grande
 * fenêtre (27/10/2026), partagé par le plan d'achat (onglet « À commander ») et
 * le stock projeté (/stock).
 *
 * Au plan d'achat, TOUT le détail d'avant, rien de retiré : réglages et leur
 * source, courbe du solde, calcul de la première proposition, propositions
 * suivantes, ressources et arrivages, chronologie, plan mois par mois.
 *
 * Au stock projeté (`enrichi`), le même détail ENRICHI : la situation d'un coup
 * d'œil (stocks, arrivages, besoin jusqu'à livraison, couverture, sécurité, à
 * commander, montant), l'approvisionnement (les réglages qui entrent dans le
 * calcul, avec leur source, et ceux de la fiche qui ne sont que des ALERTES),
 * la projection chronologique en tableau (par événements ou jour par jour), et
 * le résultat MRP qui permet de RECONSTITUER la proposition.
 *
 * Rien ne se recalcule ici : chaque chiffre vient du moteur (`GET
 * /api/couverture/{ref}`), au plus additionné ou soustrait pour l'affichage
 * (écart à la sécurité, somme du plan entre deux jours du moteur).
 */
import { useState, type ReactNode } from 'react'
import { FlaskConical } from 'lucide-react'
import { useDetailCouverture } from './lecture'
import { Alerte, Badge, Bouton, Chargement } from '../ui/base'
import { cn, fmt } from '../../lib/utils'
import { CourbeSolde } from './CourbeSolde'
import {
  CATEGORIES,
  NATURES,
  SOURCES_PRIX,
  dateCourte,
  kg,
  libelleArrivage,
  positif,
  source,
  type DetailCouverture,
  type Evenement,
  type Jour,
  type Proposition,
  type VueAnalyse,
} from './types'

export function Titre({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">{children}</h3>
  )
}

/** Le détail d'une référence : la grande fenêtre du plan d'achat et du stock projeté. */
export function DetailReference({
  reference,
  enrichi = false,
  surSimuler,
}: {
  reference: string
  /** Le stock projeté : situation, approvisionnement, projection, résultat MRP. */
  enrichi?: boolean
  /** Ouvre l'espace « Simulation » sur cette référence (stock projeté). */
  surSimuler?: (reference: string) => void
}) {
  const q = useDetailCouverture(reference)
  if (q.isLoading) return <Chargement />
  if (q.error || !q.data)
    return (
      <p className="text-[12.5px] text-attenue-texte">
        Le détail de {reference} n’a pas pu être lu
        {q.error instanceof Error && q.error.message ? ` : ${q.error.message}` : '.'}
      </p>
    )
  const d = q.data
  const premiere = d.propositions?.[0]
  return (
    <div className="min-w-0 space-y-5 text-[12.5px] whitespace-normal" onClick={(e) => e.stopPropagation()}>
      {surSimuler && (
        <div className="flex justify-end">
          <Bouton taille="sm" variante="contour" onClick={() => surSimuler(reference)}>
            <FlaskConical /> Simuler cette référence
          </Bouton>
        </div>
      )}
      {enrichi && <Situation d={d} />}
      {enrichi ? <Approvisionnement d={d} /> : <LigneReglages d={d} />}
      {!enrichi && d.reglages?.defaut_donnees && (
        <p className="text-alerte">Défaut de données, signalé (jamais bloquant) : {d.reglages.defaut_donnees}.</p>
      )}

      {(d.jours?.length ?? 0) > 1 && (
        <section>
          <Titre>Solde projeté jour par jour</Titre>
          <CourbeSolde jours={d.jours} propositions={d.propositions ?? []} />
        </section>
      )}

      {enrichi && (
        <section>
          <Titre>Projection chronologique</Titre>
          <Projection d={d} />
        </section>
      )}

      {enrichi && <ResultatMrp d={d} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="min-w-0">
          <Titre>À commander — le calcul</Titre>
          {premiere ? (
            <CalculProposition p={premiere} d={d} />
          ) : (
            <Alerte ton="info" taille="compacte">
              Rien à commander : {d.motif_sans_proposition ?? 'aucune proposition sur l’horizon du plan'}.
            </Alerte>
          )}
          <PropositionsSuivantes d={d} />
        </section>
        <section className="min-w-0">
          <Ressources d={d} />
        </section>
      </div>

      {!enrichi && (
        <section>
          <Titre>Chronologie</Titre>
          <Chronologie evenements={d.evenements ?? []} />
        </section>
      )}

      {(d.plan_mois?.length ?? 0) > 0 && <PlanParMois d={d} ouvert={enrichi} />}
    </div>
  )
}

/** Les réglages du calcul, en une phrase, chacun avec sa source. */
export function LigneReglages({ d }: { d: Pick<VueAnalyse, 'reglages'> }) {
  const r = d.reglages
  if (!r) return null
  return (
    <p className="text-attenue-texte">
      Délai fournisseur <b className="text-texte">{r.delai_j} j</b>
      {source(r.source_delai)} · couverture d’une commande <b className="text-texte">{r.couverture_commande_j} j</b>
      {source(r.source_couverture)} · sécurité <b className="text-texte">{fmt.nombre(r.jours_securite, 0)} j</b>
      {source(r.source_securite)} · minimum de commande{' '}
      <b className="text-texte">{r.moq_kg ? `${kg(r.moq_kg)} kg` : 'aucun'}</b> · arrondi :{' '}
      {r.multiple_kg ? `${kg(r.multiple_kg)} kg, ` : ''}
      {r.source_multiple}
      {r.kg_palette ? ` · palette ordinaire ${kg(r.kg_palette)} kg (fiche)` : ''}
    </p>
  )
}

// ============================================================================
// Le détail enrichi (stock projeté)
// ============================================================================

/** Une paire intitulé / valeur ; l'intitulé (`dt`) reçoit son ⓘ du catalogue d'aide. */
function Paire({ libelle, children, note }: { libelle: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 border-b border-ligne py-1">
      <dt className="text-[11px] text-attenue-texte">{libelle}</dt>
      <dd className="tabular-nums">
        {children}
        {note && <span className="ml-1 text-[11px] text-attenue-texte">{note}</span>}
      </dd>
    </div>
  )
}

const kgOuTiret = (v: unknown) => (typeof v === 'number' ? `${kg(v)} kg` : '—')

function Situation({ d }: { d: DetailCouverture }) {
  const s = d.synthese
  const achat = d.achat ?? {}
  const couverture = s.couvert_tout_horizon
    ? `tout l’horizon (jusqu’au ${dateCourte(s.couvert_jusqu_au)})`
    : s.jours_couverture != null
      ? `${s.jours_couverture} j${s.couvert_jusqu_au ? ` — jusqu’au ${dateCourte(s.couvert_jusqu_au)}` : ' — rupture aujourd’hui'}`
      : '—'
  return (
    <section>
      <Titre>Situation</Titre>
      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
        <Paire libelle="Référence">{d.reference.code_reference}</Paire>
        <Paire libelle="Désignation">{d.reference.designation ?? '—'}</Paire>
        <Paire libelle="Fournisseur">{d.reference.fournisseur_nom ?? '—'}</Paire>
        <Paire libelle="Délai fournisseur" note={source(s.source_delai)}>
          {typeof s.delai_j === 'number' ? `${s.delai_j} j` : '—'}
        </Paire>
        {'prix_estime_mad' in achat && (
          <Paire libelle="Prix d’achat" note={achat.source_prix ? SOURCES_PRIX[achat.source_prix] ?? achat.source_prix : undefined}>
            {typeof achat.prix_estime_mad === 'number' ? `${fmt.nombre(achat.prix_estime_mad, 4)} MAD/kg` : '—'}
          </Paire>
        )}
        <Paire libelle="Stock total" note="physique, compté ou non">
          {kgOuTiret(d.ressources?.stock_physique_kg)}
        </Paire>
        <Paire libelle="Disponible (compté)">{kgOuTiret(s.disponible_kg)}</Paire>
        <Paire libelle="Sur machine">{kgOuTiret(s.machine_kg)}</Paire>
        <Paire libelle="Disponible hors quarantaine" note="magasins comptés">
          {kgOuTiret(s.magasin_kg)}
        </Paire>
        <Paire libelle="Arrivages prévus" note="comptés à leur date">
          {kgOuTiret(s.arrivages_comptes_kg)}
        </Paire>
        <Paire libelle="Besoin jusqu’à livraison">{kgOuTiret(s.besoin_jusqu_livraison_kg)}</Paire>
        <Paire libelle="Stock y compris arrivages">{kgOuTiret(s.stock_total_projete_kg)}</Paire>
        <Paire libelle="Couverture planifiée">{couverture}</Paire>
        <Paire libelle="Seuil de sécurité" note={typeof s.jours_securite === 'number' ? `${fmt.nombre(s.jours_securite, 0)} j de plan` : undefined}>
          {kgOuTiret(s.securite_aujourdhui_kg)}
        </Paire>
        <Paire libelle="Plan / mois">{kgOuTiret(s.plan_mois_kg)}</Paire>
        <Paire libelle="Réel / mois" note="12 mois pleins">
          {kgOuTiret(d.approvisionnement?.reel_mois_kg)}
        </Paire>
        <Paire libelle="À commander">
          {positif(s.qte_a_commander_kg) ? (
            <b>{kg(s.qte_a_commander_kg)} kg</b>
          ) : 'qte_a_commander_kg' in s ? (
            'rien'
          ) : (
            '—'
          )}
        </Paire>
        {'montant_estime_mad' in achat && (
          <Paire libelle="Montant de la commande">
            {typeof achat.montant_estime_mad === 'number' ? fmt.mad(achat.montant_estime_mad) : '—'}
          </Paire>
        )}
      </dl>
    </section>
  )
}

function Approvisionnement({ d }: { d: DetailCouverture }) {
  const r = d.reglages
  const a = d.approvisionnement ?? {}
  const ref = d.reference
  const palette =
    r?.kg_palette != null
      ? `${kg(r.kg_palette)} kg${ref.poids_bobine_kg && ref.bobines_par_palette ? ` (${ref.bobines_par_palette} bobines × ${fmt.nombre(ref.poids_bobine_kg, 2)} kg)` : ''}`
      : 'inconnue de la fiche'
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <Titre>Approvisionnement — ce que le calcul utilise</Titre>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Paire libelle="Délai fournisseur" note={source(r?.source_delai)}>
            {r ? `${r.delai_j} j` : '—'}
          </Paire>
          <Paire libelle="Couverture d’une commande" note={source(r?.source_couverture)}>
            {r ? `${r.couverture_commande_j} j` : '—'}
          </Paire>
          <Paire libelle="Jours de sécurité" note={source(r?.source_securite)}>
            {r ? `${fmt.nombre(r.jours_securite, 0)} j` : '—'}
          </Paire>
          <Paire libelle="Horizon du plan" note={d.plan?.libelle ?? undefined}>
            {d.fin_horizon ? `jusqu’au ${dateCourte(d.fin_horizon)}` : 'aucun plan en service'}
          </Paire>
          <Paire libelle="Minimum de commande">{r?.moq_kg ? `${kg(r.moq_kg)} kg` : 'aucun'}</Paire>
          <Paire libelle="Règle d’arrondi">
            {r?.multiple_kg ? `${kg(r.multiple_kg)} kg — ` : ''}
            {r?.source_multiple ?? '—'}
          </Paire>
          <Paire libelle="Unité / palette" note={a.unite_catalogue ? `unité du catalogue : ${a.unite_catalogue}` : undefined}>
            {palette}
          </Paire>
        </dl>
        {r?.defaut_donnees && (
          <p className="mt-1 text-alerte">Défaut de données, signalé (jamais bloquant) : {r.defaut_donnees}.</p>
        )}
      </div>
      <div className="min-w-0">
        <Titre>Fiche article — des alertes, pas des termes du calcul</Titre>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Paire libelle="Stock minimum (fiche)">{kgOuTiret(a.stock_min_fiche_kg)}</Paire>
          <Paire
            libelle="Couverture minimale"
            note={a.couverture_min_fiche_mois == null && a.couverture_min_parametre_mois != null ? '(P_CouvMinMois)' : '(fiche)'}
          >
            {(a.couverture_min_fiche_mois ?? a.couverture_min_parametre_mois) != null
              ? `${fmt.nombre(a.couverture_min_fiche_mois ?? a.couverture_min_parametre_mois, 1)} mois`
              : '—'}
          </Paire>
          <Paire libelle="Seuil d’alerte" note="(P_SeuilAlerte)">
            {a.seuil_alerte_j != null ? `${fmt.nombre(a.seuil_alerte_j, 0)} j` : '—'}
          </Paire>
        </dl>
        <p className="mt-1 text-[11.5px] text-attenue-texte">
          Décision du 10/10/2026 : le plan d’achat suit le plan de production seul. Le stock minimum, la couverture
          minimale et le seuil d’alerte de la fiche peuvent alerter ; le moteur ne les lit pas. La sécurité du calcul
          vient des jours de sécurité de la classe ABC.
        </p>
      </div>
    </section>
  )
}

/** Une rangée de la projection : ce qu'elle couvre, depuis la rangée précédente. */
interface RangeeProjection {
  date: string
  natures?: string[]
  debut: number
  besoin: number
  arrivages: number
  stock: number
  securite: number
  nonCouvert: number
}

function rangeesEvenements(evenements: Evenement[], depart: number): RangeeProjection[] {
  let debut = depart
  return evenements.map((e) => {
    const r = {
      date: e.date,
      natures: e.natures,
      debut,
      besoin: e.conso_prevue_kg,
      arrivages: e.arrivee_kg,
      stock: e.solde_apres_kg,
      securite: e.securite_kg,
      nonCouvert: e.plan_non_couvert_kg,
    }
    debut = e.solde_apres_kg
    return r
  })
}

function rangeesJours(jours: Jour[], depart: number): RangeeProjection[] {
  let debut = depart
  return jours.map((j) => {
    const r = {
      date: j.date,
      debut,
      besoin: j.conso_prevue_kg,
      arrivages: j.arrivee_kg,
      stock: j.solde_kg,
      securite: j.securite_kg,
      nonCouvert: j.plan_non_couvert_kg,
    }
    debut = j.solde_kg
    return r
  })
}

/**
 * LA PROJECTION EN TABLEAU — par événements (comme la chronologie) ou jour par
 * jour. Stock début = le stock projeté de la rangée précédente (aujourd'hui :
 * le disponible compté) ; écart à la sécurité = stock projeté − sécurité.
 */
export function Projection({ d }: { d: Pick<VueAnalyse, 'evenements' | 'jours' | 'synthese'> }) {
  const [parJour, setParJour] = useState(false)
  const depart = d.synthese?.disponible_kg ?? 0
  const rangees = parJour ? rangeesJours(d.jours ?? [], depart) : rangeesEvenements(d.evenements ?? [], depart)
  if (!rangees.length) return <p className="text-attenue-texte">Aucune projection : pas de plan en service.</p>
  const ecart = (r: RangeeProjection) => r.stock - r.securite
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="text-attenue-texte">Afficher :</span>
        <Bouton taille="xs" variante={parJour ? 'contour' : 'primaire'} aria-pressed={!parJour} onClick={() => setParJour(false)}>
          Par événements
        </Bouton>
        <Bouton taille="xs" variante={parJour ? 'primaire' : 'contour'} aria-pressed={parJour} onClick={() => setParJour(true)}>
          Jour par jour
        </Bouton>
        <span className="text-attenue-texte">
          {parJour ? `${rangees.length} jours` : 'chaque rangée cumule depuis la précédente'}
        </span>
      </div>
      <div className={cn(parJour && 'max-h-[26rem] overflow-y-auto')}>
        <table className="hidden w-full text-[12px] sm:table">
          <thead className={cn(parJour && 'sticky top-0 bg-surface')}>
            <tr className="border-b border-bordure text-[10.5px] uppercase tracking-wider text-attenue-texte">
              <th className="py-1 pr-2 text-left font-semibold">Date</th>
              <th className="py-1 pr-2 text-right font-semibold">Stock début</th>
              <th className="py-1 pr-2 text-right font-semibold">Besoin planifié</th>
              <th className="py-1 pr-2 text-right font-semibold">Arrivages</th>
              <th className="py-1 pr-2 text-right font-semibold">Stock projeté</th>
              <th className="py-1 pr-2 text-right font-semibold">Sécurité</th>
              <th className="py-1 pr-2 text-right font-semibold">Écart à la sécurité</th>
              <th className="py-1 text-right font-semibold">Besoin non couvert</th>
            </tr>
          </thead>
          <tbody>
            {rangees.map((r) => {
              const rupture = r.natures?.includes('RUPTURE') || (parJour && positif(r.nonCouvert))
              return (
                <tr key={r.date} className={cn('border-b border-ligne align-baseline', rupture && 'bg-danger/5')}>
                  <td className="py-0.5 pr-2">
                    <span className="whitespace-nowrap tabular-nums">{dateCourte(r.date)}</span>
                    {r.natures && r.natures.length > 0 && (
                      <span className={cn('block text-[10.5px] text-attenue-texte', rupture && 'text-danger')}>
                        {r.natures.map((n) => NATURES[n] ?? n).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{kg(r.debut)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{positif(r.besoin) ? `− ${kg(r.besoin)}` : '—'}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums text-succes">{positif(r.arrivages) ? `+ ${kg(r.arrivages)}` : ''}</td>
                  <td className="py-0.5 pr-2 text-right font-medium tabular-nums">{kg(r.stock)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums text-attenue-texte">{kg(r.securite)}</td>
                  <td className={cn('py-0.5 pr-2 text-right tabular-nums', ecart(r) < -0.05 ? 'text-alerte' : 'text-attenue-texte')}>
                    {ecart(r) > 0.05 ? '+ ' : ecart(r) < -0.05 ? '− ' : ''}
                    {kg(Math.abs(ecart(r)))}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-danger">{positif(r.nonCouvert) ? kg(r.nonCouvert) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {/* Au téléphone, une pile : pas de défilement horizontal. */}
        <ul className="space-y-1.5 sm:hidden">
          {rangees.map((r) => (
            <li key={r.date} className="border-b border-ligne pb-1">
              <div className={cn(positif(r.nonCouvert) && 'text-danger')}>
                <b className="tabular-nums">{dateCourte(r.date)}</b>
                {r.natures && r.natures.length > 0 && <> — {r.natures.map((n) => NATURES[n] ?? n).join(' · ')}</>}
              </div>
              <div className="text-[11.5px] tabular-nums text-attenue-texte">
                début {kg(r.debut)} · besoin − {kg(r.besoin)}
                {positif(r.arrivages) && <> · arrivages + {kg(r.arrivages)}</>} · projeté {kg(r.stock)} kg · sécurité{' '}
                {kg(r.securite)} (écart {ecart(r) < -0.05 ? '−' : '+'}
                {kg(Math.abs(ecart(r)))})
                {positif(r.nonCouvert) && <span className="text-danger"> · non couvert {kg(r.nonCouvert)}</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * LE RÉSULTAT MRP : les dates et les quantités que le moteur a trouvées, puis
 * la RECONSTITUTION de la proposition au jour déterminant t*, à partir des seuls
 * jours du moteur : plan de D à t* + sécurité − S(D) − arrivages de ]D, t*] =
 * besoin de réapprovisionnement ; + minimum ; + arrondi = quantité proposée.
 */
function ResultatMrp({ d }: { d: DetailCouverture }) {
  const s = d.synthese
  const p = d.propositions?.[0]
  const suivante = d.propositions?.[1]
  const achat = d.achat ?? {}
  const jours = d.jours ?? []
  const iD = p ? jours.findIndex((j) => j.date === p.date_disponibilite) : -1
  const iT = p ? jours.findIndex((j) => j.date === p.jour_determinant) : -1
  const reconstitution =
    p && iD >= 0 && iT >= iD
      ? {
          planDT: jours.slice(iD, iT + 1).reduce((t, j) => t + j.conso_prevue_kg, 0),
          arrDT: jours.slice(iD + 1, iT + 1).reduce((t, j) => t + j.arrivee_kg, 0),
        }
      : null
  return (
    <section>
      <Titre>Résultat MRP</Titre>
      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
        <Paire libelle="1re date sous la sécurité">{dateCourte(s.premier_passage_securite)}</Paire>
        <Paire libelle="1re rupture">{s.premiere_rupture ? dateCourte(s.premiere_rupture) : 'aucune sur l’horizon'}</Paire>
        <Paire libelle="Besoin non couvert">{kgOuTiret(s.plan_non_couvert_kg)}</Paire>
        <Paire libelle="Quantité proposée">
          {p && typeof p.quantite_proposee_kg === 'number' ? `${kg(p.quantite_proposee_kg)} kg` : p ? '—' : 'rien'}
        </Paire>
        <Paire libelle="Date limite de commande">{p ? dateCourte(p.date_limite_commande) : '—'}</Paire>
        <Paire libelle="Disponible le (D)">{p ? dateCourte(p.date_disponibilite) : '—'}</Paire>
        <Paire libelle="Prochaine proposition">
          {suivante
            ? `${typeof suivante.quantite_proposee_kg === 'number' ? `${kg(suivante.quantite_proposee_kg)} kg ` : ''}le ${dateCourte(suivante.date_disponibilite)}`
            : 'aucune'}
        </Paire>
        {'montant_estime_mad' in achat && (
          <Paire libelle="Montant">
            {typeof achat.montant_estime_mad === 'number' ? fmt.mad(achat.montant_estime_mad) : '—'}
          </Paire>
        )}
      </dl>
      {p && reconstitution && typeof p.besoin_theorique_kg === 'number' && (
        <div className="mt-2">
          <p className="mb-1 text-[11.5px] text-attenue-texte">
            La proposition se reconstitue au jour déterminant ({dateCourte(p.jour_determinant)}), le jour de la fenêtre
            [D, F[ — D inclus, F exclu — où le besoin est le plus fort :
          </p>
          <table className="w-full max-w-xl">
            <tbody>
              <Etape
                libelle="Plan de D au jour déterminant"
                valeur={`${kg(reconstitution.planDT)} kg`}
                note={`du ${dateCourte(p.date_disponibilite)} au ${dateCourte(p.jour_determinant)} inclus`}
              />
              <Etape signe="+" libelle="Sécurité" valeur={`${kg(p.securite_kg)} kg`} />
              <Etape signe="−" libelle="S(D)" valeur={`${kg(p.solde_debut_d_kg)} kg`} note="solde au début de D, arrivages du jour D compris" />
              <Etape signe="−" libelle="Arrivages après D" valeur={`${kg(reconstitution.arrDT)} kg`} note="jusqu’au jour déterminant" />
              <Etape
                signe="="
                libelle="Besoin de réapprovisionnement"
                valeur={`${kg(p.besoin_theorique_kg)} kg`}
                note={`besoin théorique du moteur ; le besoin de couverture (plan sur la fenêtre) est de ${kg(p.plan_fenetre_kg)} kg`}
                fort
              />
              {typeof p.apres_minimum_kg === 'number' && (
                <Etape signe="+" libelle="Minimum" valeur={`${kg(p.apres_minimum_kg)} kg`} note={p.moq_kg ? `minimum ${kg(p.moq_kg)} kg` : 'aucun minimum'} />
              )}
              {typeof p.quantite_proposee_kg === 'number' && (
                <Etape
                  signe="+"
                  libelle="Arrondi"
                  valeur={`${kg(p.quantite_proposee_kg)} kg`}
                  note={p.multiple_kg ? `au multiple de ${kg(p.multiple_kg)} kg` : 'aucun multiple'}
                />
              )}
              {typeof p.quantite_proposee_kg === 'number' && (
                <Etape signe="=" libelle="Quantité proposée" valeur={`${kg(p.quantite_proposee_kg)} kg`} fort />
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ============================================================================
// Le détail d'avant (plan d'achat), gardé tel quel
// ============================================================================

/** Une étape du calcul : signe, libellé, valeur, explication. */
function Etape({
  signe,
  libelle,
  valeur,
  note,
  fort,
}: {
  signe?: string
  libelle: ReactNode
  valeur: ReactNode
  note?: ReactNode
  fort?: boolean
}) {
  return (
    <tr className={cn('align-baseline', fort && 'border-t border-bordure font-semibold')}>
      <td className="w-5 py-0.5 pr-1 text-center text-attenue-texte">{signe}</td>
      <td className="min-w-[9.5rem] py-0.5 pr-3">{libelle}</td>
      <td className="whitespace-nowrap py-0.5 pr-3 text-right tabular-nums">{valeur}</td>
      <td className="py-0.5 text-[11.5px] font-normal text-attenue-texte">{note}</td>
    </tr>
  )
}

export function CalculProposition({ p, d }: { p: Proposition; d: Pick<VueAnalyse, 'reglages'> }) {
  const r = d.reglages
  const pourquoiD =
    p.motif_date === 'délai'
      ? `aujourd’hui + délai de ${r?.delai_j ?? '?'} j${source(r?.source_delai)} : une commande ne peut pas arriver avant ; le solde passe sous la sécurité dès le ${dateCourte(p.date_sous_securite)}`
      : `premier jour où le solde projeté passe sous la sécurité${
          p.date_au_plus_tot ? ` (aujourd’hui + délai, le ${dateCourte(p.date_au_plus_tot)}, tombe avant)` : ''
        }`
  return (
    <table className="w-full">
      <tbody>
        <Etape libelle="D — disponibilité de la commande" valeur={dateCourte(p.date_disponibilite)} note={pourquoiD} />
        <Etape
          libelle="F — fin de la fenêtre (exclue)"
          valeur={dateCourte(p.date_fin_fenetre)}
          note={`D + couverture de ${r?.couverture_commande_j ?? p.jours_fenetre} j${source(r?.source_couverture)} : couvre jusqu’au ${dateCourte(p.dernier_jour_couvert)} inclus, ${p.jours_fenetre} j${p.fenetre_bornee_horizon ? ', bornée à la fin de l’horizon du plan' : ''}`}
        />
        <Etape
          libelle="Plan sur la fenêtre"
          valeur={`${kg(p.plan_fenetre_kg)} kg`}
          note={`le besoin de couverture, soit ${fmt.nombre(p.conso_moyenne_kg_j, 1)} kg/j en moyenne au plan`}
        />
        <Etape
          signe="+"
          libelle="Sécurité"
          valeur={`${kg(p.securite_kg)} kg`}
          note={`${fmt.nombre(p.jours_securite ?? r?.jours_securite ?? 0, 0)} j × ${fmt.nombre(p.conso_moyenne_kg_j, 1)} kg/j${source(r?.source_securite)}`}
        />
        <Etape
          signe="−"
          libelle="S(D) — solde au début de D"
          valeur={`${kg(p.solde_debut_d_kg)} kg`}
          note="arrivages du jour D compris, sans la commande ; jamais négatif : le plan non couvert avant D n’est pas reporté"
        />
        <Etape signe="−" libelle="Arrivages dans la fenêtre, après D" valeur={`${kg(p.arrivages_fenetre_kg)} kg`} />
        {typeof p.besoin_theorique_kg === 'number' && (
          <Etape
            signe="="
            libelle="Besoin théorique"
            valeur={`${kg(p.besoin_theorique_kg)} kg`}
            note={`le besoin de réapprovisionnement, contrôlé chaque jour t de la fenêtre : sécurité + plan de D à t − arrivages après D jusqu’à t − S(D) ; le plus fort le ${dateCourte(p.jour_determinant)} (jour déterminant)`}
            fort
          />
        )}
        {typeof p.apres_minimum_kg === 'number' && (
          <Etape
            signe="+"
            libelle="Minimum de commande"
            valeur={`${kg(p.apres_minimum_kg)} kg`}
            note={p.moq_kg ? `minimum : ${kg(p.moq_kg)} kg` : 'aucun minimum'}
          />
        )}
        {typeof p.quantite_proposee_kg === 'number' && (
          <Etape
            signe="+"
            libelle="Arrondi vers le haut"
            valeur={`${kg(p.quantite_proposee_kg)} kg`}
            note={p.multiple_kg ? `au multiple de ${kg(p.multiple_kg)} kg — ${r?.source_multiple ?? ''}` : r?.source_multiple ?? 'aucun multiple : kg'}
          />
        )}
        {typeof p.quantite_proposee_kg === 'number' && (
          <Etape
            signe="="
            libelle="Quantité proposée"
            valeur={`${kg(p.quantite_proposee_kg)} kg`}
            note={
              p.palettes_equivalentes != null
                ? `≈ ${fmt.nombre(p.palettes_equivalentes, 2)} palette(s) ordinaire(s)${r?.kg_palette ? ` de ${kg(r.kg_palette)} kg` : ''}, pour information`
                : 'palette inconnue de la fiche'
            }
            fort
          />
        )}
        <Etape libelle="À commander avant le" valeur={dateCourte(p.date_limite_commande)} note={`D − délai de ${r?.delai_j ?? '?'} j`} fort />
      </tbody>
    </table>
  )
}

export function PropositionsSuivantes({ d }: { d: Pick<VueAnalyse, 'propositions' | 'propositions_plafonnees'> & { max_propositions?: number } }) {
  if ((d.propositions?.length ?? 0) <= 1) return null
  return (
    <div className="mt-3">
      <p className="mb-1 text-attenue-texte">Propositions suivantes, indicatives (elles supposent les précédentes commandées) :</p>
      <ul className="space-y-0.5">
        {d.propositions.slice(1).map((p) => (
          <li key={p.rang} className="tabular-nums">
            n° {p.rang} — disponible le {dateCourte(p.date_disponibilite)}
            {typeof p.quantite_proposee_kg === 'number' && (
              <>
                {' '}
                : <b>{kg(p.quantite_proposee_kg)} kg</b>
              </>
            )}
            {p.palettes_equivalentes != null && (
              <span className="text-attenue-texte"> ≈ {fmt.nombre(p.palettes_equivalentes, 1)} pal.</span>
            )}
            , à commander avant le {dateCourte(p.date_limite_commande)}
          </li>
        ))}
      </ul>
      {d.propositions_plafonnees && (
        <p className="mt-1 text-attenue-texte">
          Le calcul s’arrête à {d.max_propositions ?? 12} propositions ; l’horizon va plus loin.
        </p>
      )}
    </div>
  )
}

function Ressources({ d }: { d: DetailCouverture }) {
  const res = d.ressources
  const info = res?.information
  const restes = (res?.lots ?? []).filter((l) => l.compte)
  return (
    <div className="space-y-3">
      {res && (
        <div>
          <Titre>Ressources d’aujourd’hui — comptées {kg(res.compte_kg)} kg</Titre>
          <ul className="space-y-0.5">
            {res.magasins.map((m) => (
              <li key={m.code_magasin} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{m.nom ?? m.code_magasin}</span>
                <span className="tabular-nums">{kg(m.quantite_kg)} kg</span>
                {m.etat === 'COMPTE' ? (
                  <Badge ton="succes">compté {kg(m.compte_kg)} kg</Badge>
                ) : (
                  <Badge ton="neutre">non compté</Badge>
                )}
                <span className="text-[11.5px] text-attenue-texte">{m.raison}</span>
              </li>
            ))}
            {res.machine.map((e) => (
              <li key={`${e.code_emplacement}-${e.lot_fournisseur ?? ''}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">Métier {e.code_emplacement}</span>
                {e.lot_fournisseur && <span className="text-attenue-texte">lot {e.lot_fournisseur}</span>}
                <span className="tabular-nums">{kg(e.kg)} kg</span>
                <Badge ton={e.compte ? 'succes' : 'neutre'}>{e.compte ? 'compté' : 'non compté'}</Badge>
                <span className="text-[11.5px] text-attenue-texte">
                  constat du {dateCourte(e.date_constat)}
                  {e.age_constat_j != null ? ` (${e.age_constat_j} j)` : ''} — {e.raison}
                </span>
              </li>
            ))}
            {res.lots.filter((l) => !l.compte).map((l) => (
              <li key={`${l.code_magasin}-${l.lot_fournisseur}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-attenue-texte">
                  {l.code_magasin} · lot {l.lot_fournisseur}
                </span>
                <span className="tabular-nums">{kg(l.kg)} kg</span>
                <Badge ton="neutre">non compté</Badge>
                <span className="text-[11.5px] text-attenue-texte">{l.raison}</span>
              </li>
            ))}
            {res.magasins.length + res.machine.length === 0 && (
              <li className="text-attenue-texte">Aucun stock, ni en magasin ni sur métier.</li>
            )}
          </ul>
          {restes.length > 0 && (
            <details className="mt-1 text-[11.5px] text-attenue-texte">
              <summary className="cursor-pointer select-none hover:text-texte">
                Restes : {restes.length} lot(s), {kg(restes.reduce((t, l) => t + l.kg, 0))} kg — comptés
              </summary>
              <ul className="mt-0.5 pl-4">
                {restes.map((l) => (
                  <li key={`${l.code_magasin}-${l.lot_fournisseur}`} className="tabular-nums">
                    {l.code_magasin} · lot {l.lot_fournisseur} · {kg(l.kg)} kg
                  </li>
                ))}
              </ul>
            </details>
          )}
          {info && (positif(info.restes_kg) || positif(info.quarantaine_kg) || positif(info.bloque_kg) || positif(info.hors_plan_kg)) && (
            <p className="mt-1 text-[11.5px] text-attenue-texte">
              {[
                positif(info.restes_kg) && `restes ${kg(info.restes_kg)} kg (compris)`,
                positif(info.quarantaine_kg) && `quarantaine ${kg(info.quarantaine_kg)} kg (non comptée)`,
                positif(info.bloque_kg) && `bloqué ${kg(info.bloque_kg)} kg (non compté)`,
                positif(info.hors_plan_kg) && `magasins hors plan ${kg(info.hors_plan_kg)} kg (non comptés)`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
      )}
      <div>
        <Titre>Arrivages</Titre>
        <ListeArrivages arrivages={d.arrivages ?? []} />
      </div>
    </div>
  )
}

export function ListeArrivages({ arrivages }: { arrivages: VueAnalyse['arrivages'] }) {
  if (arrivages.length === 0) return <p className="text-attenue-texte">Aucun bon ouvert, aucun import ni transfert en route.</p>
  return (
    <ul className="space-y-0.5">
      {arrivages.map((a, i) => {
        const c = CATEGORIES[a.categorie] ?? { libelle: a.categorie, ton: 'neutre' as const }
        return (
          <li key={a.cle ?? i} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{libelleArrivage(a)}</span>
            <span className="tabular-nums">{kg(a.kg)} kg</span>
            {a.date && (
              <span className="tabular-nums">
                le {dateCourte(a.date)}
                {a.source_date && !a.hypothese && (
                  <span className="text-attenue-texte">
                    {' '}
                    ({a.source_date === 'ligne'
                      ? 'date de la ligne'
                      : a.source_date === 'en-tête'
                        ? 'date de l’en-tête'
                        : a.source_date})
                  </span>
                )}
              </span>
            )}
            <Badge ton={c.ton}>{a.compte ? 'compté' : `non compté · ${c.libelle}`}</Badge>
            {a.hypothese && <Badge ton="info">{a.hypothese}</Badge>}
            <span className="text-[11.5px] text-attenue-texte">{a.raison}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function Chronologie({ evenements }: { evenements: Evenement[] }) {
  if (!evenements.length) return <p className="text-attenue-texte">Aucun événement.</p>
  const libelles = (e: Evenement) => e.natures.map((n) => NATURES[n] ?? n).join(' · ')
  return (
    <>
      {/* Au bureau, un tableau ; au téléphone, une pile (pas de défilement horizontal). */}
      <table className="hidden w-full text-[12px] sm:table">
        <thead>
          <tr className="border-b border-bordure text-[10.5px] uppercase tracking-wider text-attenue-texte">
            <th className="py-1 pr-3 text-left font-semibold">Date</th>
            <th className="py-1 pr-3 text-left font-semibold">Événement</th>
            <th className="py-1 pr-3 text-right font-semibold" title="Depuis la ligne précédente">Besoin planifié</th>
            <th className="py-1 pr-3 text-right font-semibold">Arrivée</th>
            <th className="py-1 pr-3 text-right font-semibold">Solde après</th>
            <th className="py-1 text-right font-semibold" title="Depuis la ligne précédente">Plan non couvert</th>
          </tr>
        </thead>
        <tbody>
          {evenements.map((e) => {
            const rupture = e.natures.includes('RUPTURE')
            return (
              <tr key={e.date} className={cn('border-b border-ligne', rupture && 'bg-danger/5')}>
                <td className="whitespace-nowrap py-0.5 pr-3 tabular-nums">{dateCourte(e.date)}</td>
                <td className={cn('py-0.5 pr-3', rupture && 'text-danger')}>{libelles(e)}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{positif(e.conso_prevue_kg) ? `− ${kg(e.conso_prevue_kg)}` : '—'}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums text-succes">{positif(e.arrivee_kg) ? `+ ${kg(e.arrivee_kg)}` : ''}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{kg(e.solde_apres_kg)}</td>
                <td className="py-0.5 text-right tabular-nums text-danger">{positif(e.plan_non_couvert_kg) ? kg(e.plan_non_couvert_kg) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ul className="space-y-1.5 sm:hidden">
        {evenements.map((e) => (
          <li key={e.date} className="border-b border-ligne pb-1">
            <div className={cn(e.natures.includes('RUPTURE') && 'text-danger')}>
              <b className="tabular-nums">{dateCourte(e.date)}</b> — {libelles(e)}
            </div>
            <div className="text-[11.5px] tabular-nums text-attenue-texte">
              {positif(e.conso_prevue_kg) && <>besoin − {kg(e.conso_prevue_kg)} · </>}
              {positif(e.arrivee_kg) && <>arrivée + {kg(e.arrivee_kg)} · </>}
              solde {kg(e.solde_apres_kg)} kg
              {positif(e.plan_non_couvert_kg) && <span className="text-danger"> · non couvert {kg(e.plan_non_couvert_kg)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function PlanParMois({ d, ouvert }: { d: DetailCouverture; ouvert?: boolean }) {
  return (
    <details className="rounded-[var(--radius)] border border-bordure px-3 py-1.5" open={ouvert}>
      <summary className="cursor-pointer select-none font-medium">Besoins du plan mois par mois, par qualité</summary>
      <p className="mt-1 text-[11.5px] text-attenue-texte">
        Les kilos du mois viennent de la photo du besoin du plan ; la part par qualité, des recettes actuelles. Le plan
        des jours passés du mois en cours est perdu, jamais reporté.
      </p>
      <ul className="mt-2 space-y-2">
        {d.plan_mois.map((m) => (
          <li key={m.annee_mois} className="border-b border-ligne pb-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
              <b>{m.annee_mois}</b>
              <span>
                {kg(m.kg_mois)} kg sur {m.jours_mois} j
              </span>
              <span className="text-attenue-texte">{fmt.nombre(m.kg_jour, 1)} kg/j</span>
              <span className="text-attenue-texte">
                dans l’horizon : {m.jours_dans_horizon} j, {kg(m.kg_dans_horizon)} kg
              </span>
            </div>
            {m.qualites.length > 0 && (
              <div className="mt-0.5 text-[11.5px] text-attenue-texte">
                {m.qualites.map((q) => `${q.code_qualite} ${kg(q.kg)} kg`).join(' · ')}
                {Math.abs(m.kg_qualites - m.kg_mois) > 1 && <> — total des qualités {kg(m.kg_qualites)} kg (recettes actuelles)</>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

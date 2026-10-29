/**
 * LE DÉTAIL D'UNE RÉFERENCE AU MOTEUR DE COUVERTURE — le contenu de la grande
 * fenêtre (27/10/2026), partagé par le plan d'achat (onglet « À commander ») et
 * le stock projeté (/stock).
 *
 * MOTEUR v2, LA COUVERTURE CIBLE (§ 15.5, 27/10/2026) : en tête, la COUVERTURE
 * de la référence — couverture actuelle et date de rupture, cible C et sa
 * source, écart, date de besoin D*, date limite de commande, sécurité X (creux
 * tS, point bas b sous le seuil NS) ou « non appliquée », stock minimum
 * respecté ou franchi, l'état et ses signaux en pastilles à part. Puis la
 * proposition décomposée : Q0 (besoin net de la fenêtre) + X (sécurité) +
 * arrondi = Q, la fenêtre couverte et le stock projeté après réception.
 *
 * Au plan d'achat : réglages et leur source, courbe du solde, calcul de la
 * première proposition, propositions suivantes, ressources et arrivages,
 * chronologie, plan mois par mois. Au stock projeté (`enrichi`), en plus : la
 * situation des stocks, l'approvisionnement (L, N, S, C chacun avec sa source),
 * la projection chronologique en tableau et le résultat MRP.
 *
 * Rien ne se recalcule ici : chaque chiffre vient du moteur (`GET
 * /api/couverture/{ref}`), au plus additionné ou soustrait pour l'affichage.
 */
import { useState, type ReactNode } from 'react'
import { FlaskConical } from 'lucide-react'
import { useDetailCouverture } from './lecture'
import { Alerte, Badge, Bouton, Chargement } from '../ui/base'
import { cn, fmt } from '../../lib/utils'
import { libelleStatut } from '../../lib/statuts'
import { StatutBadge } from '../StatutBadge'
import { CourbeSolde } from './CourbeSolde'
import { FenetreStockProjete } from './FenetreStockProjete'
import {
  CATEGORIES,
  NATURES,
  dateCourte,
  kg,
  libelleArrivage,
  positif,
  source,
  type DetailCouverture,
  type Evenement,
  type Jour,
  type Proposition,
  type SignalCouverture,
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
  // LE STOCK PROJETÉ (27/10/2026, soir) : sa propre fenêtre, validée avec l'utilisateur.
  if (enrichi) return <FenetreStockProjete d={d} surSimuler={surSimuler} />
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
      <Couverture d={d} />
      <LigneReglages d={d} />

      {(d.jours?.length ?? 0) > 1 && (
        <section>
          <Titre>Solde projeté jour par jour</Titre>
          <CourbeSolde jours={d.jours} propositions={d.propositions ?? []} />
        </section>
      )}

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

      <section>
        <Titre>Chronologie</Titre>
        <Chronologie evenements={d.evenements ?? []} />
      </section>

      {(d.plan_mois?.length ?? 0) > 0 && <PlanParMois d={d} />}
    </div>
  )
}

/** Les réglages du calcul, en une phrase, chacun avec sa source. */
export function LigneReglages({ d }: { d: Pick<VueAnalyse, 'reglages'> }) {
  const r = d.reglages
  if (!r) return null
  return (
    <p className="text-attenue-texte">
      Couverture cible{' '}
      <b className="text-texte">
        {r.couverture_cible_j != null ? `${r.couverture_cible_j} j` : 'non définie'}
      </b>
      {r.couverture_cible_mois != null && ` (${fmt.nombre(r.couverture_cible_mois, 1)} mois)`}
      {source(r.source_cible)} · délai fournisseur <b className="text-texte">{r.delai_j} j</b>
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

/** Les signaux du moteur, en pastilles distinctes de l'état ; le message en infobulle. */
export function PastillesSignaux({ signaux, compact = false }: { signaux?: SignalCouverture[] | null; compact?: boolean }) {
  if (!signaux?.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {signaux.map((sg) => (
        <StatutBadge
          key={sg.code}
          entite="signal_couverture"
          code={sg.code}
          title={sg.message}
          className={cn('border-dashed', compact && 'px-1 text-[10.5px]')}
        />
      ))}
    </span>
  )
}

/**
 * LA COUVERTURE (§ 15.5) : couverture actuelle, cible, écart, rupture, D*, date
 * limite, sécurité, stock minimum ; l'état et les signaux à part.
 */
function Couverture({ d }: { d: DetailCouverture }) {
  const c = d.situation
  if (!c) return null
  const r = d.reglages
  const sec = c.securite
  const ecart = c.ecart_cible_j
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Titre>Couverture — {c.source}</Titre>
        <StatutBadge entite="statut_stock" code={c.etat} title="L’état, calculé sans proposition ; le plus grave l’emporte" />
        {d.synthese?.raison_etat && <span className="text-[12.5px]">{d.synthese.raison_etat}</span>}
        <PastillesSignaux signaux={c.signaux} />
      </div>
      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
        <Paire libelle="Couverture actuelle" note={c.premiere_rupture ? `rupture le ${dateCourte(c.premiere_rupture)}` : undefined}>
          {c.couverture_actuelle_j != null ? `${c.couverture_actuelle_j} j` : 'aucune rupture sur l’horizon'}
        </Paire>
        <Paire
          libelle="Couverture cible"
          note={r?.source_cible ? `${r.couverture_cible_mois != null ? `${fmt.nombre(r.couverture_cible_mois, 1)} mois, ` : ''}${r.source_cible}` : undefined}
        >
          {c.couverture_cible_j != null ? `${c.couverture_cible_j} j` : <span className="text-alerte">non définie</span>}
        </Paire>
        <Paire libelle="Écart" note="couverture − cible">
          {ecart != null ? (
            <span className={cn(ecart < 0 && 'font-medium text-alerte')}>
              {ecart > 0 ? '+ ' : ecart < 0 ? '− ' : ''}
              {Math.abs(ecart)} j
            </span>
          ) : (
            '—'
          )}
        </Paire>
        <Paire libelle="Rupture projetée" note={c.reste_rupture_kg != null ? `reste ${kg(c.reste_rupture_kg)} kg ce jour-là` : undefined}>
          {c.premiere_rupture ? dateCourte(c.premiere_rupture) : 'aucune sur l’horizon'}
        </Paire>
        <Paire libelle="Date de besoin (D*)" note="rupture − cible : la réception normale">
          {dateCourte(c.date_besoin)}
        </Paire>
        <Paire libelle="Date limite de commande" note={r ? `D* − délai de ${r.delai_j} j` : undefined}>
          <span className={cn(c.date_limite_commande && d.aujourdhui && c.date_limite_commande < d.aujourdhui && 'font-medium text-danger')}>
            {dateCourte(c.date_limite_commande)}
          </span>
        </Paire>
        <Paire
          libelle="Sécurité"
          note={`${fmt.nombre(sec.jours, 0)} j de plan${source(r?.source_securite)}, sur [aujourd’hui, aujourd’hui + délai]`}
        >
          {sec.appliquee ? (
            <span>
              appliquée : <b>{kg(sec.x_kg)} kg</b>, creux le {dateCourte(sec.premier_franchissement)} (b ={' '}
              {kg(sec.point_bas_creux_kg)} kg sous NS = {kg(sec.seuil_creux_kg)} kg le {dateCourte(sec.jour_creux)})
            </span>
          ) : (
            'non appliquée'
          )}
        </Paire>
        <Paire libelle="Stock minimum" note={c.stock_minimum.kg != null ? `${kg(c.stock_minimum.kg)} kg, garde-fou : un signal, jamais une quantité` : 'aucun sur la fiche'}>
          {c.stock_minimum.kg == null ? (
            '—'
          ) : c.stock_minimum.franchi_le ? (
            <span className="text-alerte">
              franchi le {dateCourte(c.stock_minimum.franchi_le)} ({kg(c.stock_minimum.point_bas_kg)} kg) — vérifier le plan
            </span>
          ) : (
            'respecté'
          )}
        </Paire>
      </dl>
      {c.signaux.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11.5px] text-attenue-texte">
          {c.signaux.map((sg) => (
            <li key={sg.code}>
              <span className="font-medium text-texte">{libelleStatut('signal_couverture', sg.code)}</span> : {sg.message}
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const w = p.fenetres?.[0]
  const pourquoiD = p.en_retard
    ? `la date de besoin (${dateCourte(p.date_besoin)}) tombe avant aujourd’hui + délai de ${r?.delai_j ?? '?'} j${source(r?.source_delai)} : réception au plus tôt, en retard sur la cible`
    : `rupture du ${dateCourte(p.date_rupture)} − cible de ${r?.couverture_cible_j ?? '?'} j${source(r?.source_cible)}`
  return (
    <table className="w-full">
      <tbody>
        <Etape
          libelle="R — rupture"
          valeur={dateCourte(p.date_rupture)}
          note={w && !p.rupture_inevitable ? `reste ${kg(w.reste_kg)} kg au début de ce jour` : undefined}
        />
        <Etape libelle="D — réception" valeur={dateCourte(p.date_disponibilite)} note={pourquoiD} />
        <Etape
          libelle="Fenêtre couverte"
          valeur={`${dateCourte(p.date_debut_fenetre)} → ${dateCourte(p.dernier_jour_couvert)}`}
          note={`${p.jours_fenetre} j : [${p.rupture_inevitable ? 'D' : 'R'}, ${p.rupture_inevitable ? 'D' : 'R'} + N[, N = ${r?.couverture_commande_j ?? '?'} j${source(r?.source_couverture)}${p.fenetre_bornee_horizon ? ', bornée à la fin de l’horizon' : ''}${p.consolidee ? ` ; ${p.fenetres.length} fenêtres reçues ensemble` : ''}`}
        />
        <Etape libelle="Plan de la fenêtre" valeur={`${kg(p.plan_fenetre_kg)} kg`} note="le plan daté, jour par jour" />
        <Etape signe="−" libelle="Reste au début" valeur={`${kg(p.reste_kg)} kg`} note={p.rupture_inevitable ? 'le stock au début de D, à zéro au plus bas' : 'reste(R)'} />
        <Etape signe="−" libelle="Arrivages datés dans la fenêtre" valeur={`${kg(p.arrivages_fenetre_kg)} kg`} />
        {typeof p.besoin_net_kg === 'number' && (
          <Etape
            signe="="
            libelle="Q0 — besoin net"
            valeur={`${kg(p.besoin_net_kg)} kg`}
            note={
              p.consolidee
                ? p.fenetres.map((f) => `${dateCourte(f.debut)} → ${dateCourte(f.dernier_jour_couvert)} : ${kg(f.besoin_net_kg)} kg`).join(' ; ')
                : 'le moins qu’il faut recevoir en D pour qu’aucune rupture ne tombe avant la fin de la fenêtre'
            }
            fort
          />
        )}
        {positif(p.manque_inevitable_kg) && (
          <Etape
            libelle="Manque avant la réception"
            valeur={<span className="text-danger">{kg(p.manque_inevitable_kg)} kg</span>}
            note="rupture inévitable : affiché, pas commandé"
          />
        )}
        {typeof p.securite_kg === 'number' && (
          <Etape
            signe="+"
            libelle="X — sécurité"
            valeur={`${kg(p.securite_kg)} kg`}
            note={positif(p.securite_kg) ? 'le creux sous le seuil dans le délai ; 1re proposition seulement' : 'non appliquée'}
          />
        )}
        {typeof p.arrondi_kg === 'number' && (
          <Etape
            signe="+"
            libelle="Arrondi"
            valeur={`${kg(p.arrondi_kg)} kg`}
            note={[
              p.moq_kg ? `minimum ${kg(p.moq_kg)} kg` : 'aucun minimum',
              p.multiple_kg ? `multiple de ${kg(p.multiple_kg)} kg — ${r?.source_multiple ?? ''}` : r?.source_multiple ?? 'aucun multiple : kg',
            ].join(' ; ')}
          />
        )}
        {typeof p.quantite_proposee_kg === 'number' && (
          <Etape
            signe="="
            libelle="Q — quantité proposée"
            valeur={`${kg(p.quantite_proposee_kg)} kg`}
            note={
              p.palettes_equivalentes != null
                ? `≈ ${fmt.nombre(p.palettes_equivalentes, 2)} palette(s) ordinaire(s)${r?.kg_palette ? ` de ${kg(r.kg_palette)} kg` : ''}, pour information`
                : 'palette inconnue de la fiche'
            }
            fort
          />
        )}
        {typeof p.stock_apres_reception_kg === 'number' && (
          <Etape
            libelle="Stock après réception"
            valeur={`${kg(p.stock_apres_reception_kg)} kg`}
            note={typeof p.stock_fin_fenetre_kg === 'number' ? `le soir de D ; ${kg(p.stock_fin_fenetre_kg)} kg à la fin de la fenêtre` : 'le soir de D'}
          />
        )}
        <Etape
          libelle="À commander avant le"
          valeur={<span className={cn(p.en_retard && 'text-danger')}>{dateCourte(p.date_limite_commande)}</span>}
          note={`D* − délai de ${r?.delai_j ?? '?'} j${p.en_retard ? ' : date dépassée' : ''}`}
          fort
        />
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

function PlanParMois({ d }: { d: DetailCouverture }) {
  return (
    <details className="rounded-[var(--radius)] border border-bordure px-3 py-1.5">
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

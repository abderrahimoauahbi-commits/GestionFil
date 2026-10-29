/**
 * LA FENÊTRE DU STOCK PROJETÉ (décision du 27/10/2026, soir) — le détail d'une
 * référence ouvert au clic sur une ligne de /stock › Stock projeté, dans la
 * grande fenêtre modale (jamais déplié sous la ligne).
 *
 *   1. En-tête : l'état (pastille) et sa raison chiffrée, les liens vers les
 *      lots et les mouvements, les signaux s'il y en a.
 *   2. Les tuiles : stock total, sur métiers, disponible hors quarantaine,
 *      besoin jusqu'à réception, stock à la réception, couverture actuelle, à
 *      commander.
 *   3. L'approvisionnement : ce que le calcul utilise, chacun avec sa source.
 *   4. Le calcul de la quantité : Q0 + X + arrondi = Q.
 *   5. Le classement et le risque : SEULEMENT ce que les vues fournissent déjà.
 *   6. Où se trouve la matière : une cascade dont chaque total est la somme
 *      exacte des lignes au-dessus.
 *   7. Les onglets : besoins du plan, projection, lots, métiers, historique.
 *
 * Rien ne se recalcule ici : tout vient de `GET /api/couverture/{ref}` (le
 * moteur et les vues existantes) ; l'écran ne fait qu'afficher.
 */
import { type ReactNode } from 'react'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { Badge, Bouton } from '../ui/base'
import { IndiceChamp } from '../ui/Indice'
import { Onglet, OngletContenu, Onglets, OngletsListe } from '../ui/surcouches'
import { StatutBadge } from '../StatutBadge'
import { cn, fmt } from '../../lib/utils'
import { libelleStatut } from '../../lib/statuts'
import { useOuvrirVue } from '../../lib/navigation'
import { CourbeSolde } from './CourbeSolde'
import { CalculProposition, Chronologie, ListeArrivages, Titre } from './DetailCouverture'
import { SOURCES_PRIX, dateCourte, kg, libelleArrivage, positif, source, type DetailCouverture } from './types'

const kgOuTiret = (v: unknown) => (typeof v === 'number' ? `${kg(v)} kg` : '—')

/** Une tuile : l'intitulé (et son ⓘ), la valeur, une précision. */
function Tuile({ libelle, valeur, precision, ton }: { libelle: string; valeur: ReactNode; precision?: ReactNode; ton?: 'danger' | 'alerte' }) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-bordure bg-surface px-2.5 py-2">
      <div className="flex items-start gap-1 text-[11px] leading-tight text-attenue-texte">
        <span>{libelle}</span>
        <IndiceChamp intitule={libelle} />
      </div>
      <div className={cn('mt-0.5 text-[15px] font-semibold tabular-nums', ton === 'danger' && 'text-danger', ton === 'alerte' && 'text-alerte')}>
        {valeur}
      </div>
      {precision && <div className="mt-0.5 text-[11px] leading-snug text-attenue-texte">{precision}</div>}
    </div>
  )
}

/** Une paire intitulé / valeur. */
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

/** Une ligne de la cascade : signe, libellé, kilos ; un total en gras. */
function Cascade({ signe, libelle, valeur, total, note }: { signe?: string; libelle: ReactNode; valeur: number | null | undefined; total?: boolean; note?: ReactNode }) {
  return (
    <tr className={cn('align-baseline', total && 'border-t border-bordure font-semibold')}>
      <td className="w-5 py-0.5 pr-1 text-center text-attenue-texte">{signe}</td>
      <td className="py-0.5 pr-3">
        {libelle}
        {note && <span className="ml-1 text-[11px] font-normal text-attenue-texte">{note}</span>}
      </td>
      <td className="whitespace-nowrap py-0.5 text-right tabular-nums">{kgOuTiret(valeur)}</td>
    </tr>
  )
}

export function FenetreStockProjete({ d, surSimuler }: { d: DetailCouverture; surSimuler?: (reference: string) => void }) {
  const ouvrir = useOuvrirVue()
  const sp = d.stock_projete
  const c = d.situation
  const r = d.reglages
  const s = d.synthese
  const p = d.propositions?.[0]
  const a = d.approvisionnement ?? {}
  const achat = d.achat ?? {}
  const ref = d.reference.code_reference
  if (!sp || !c) return null
  const t = sp.tuiles
  const k = sp.cascade
  const cl = sp.classement
  const ecart = t.ecart_cible_j

  return (
    <div className="min-w-0 space-y-5 text-[12.5px] whitespace-normal" onClick={(e) => e.stopPropagation()}>
      {/* 1. L'en-tête : l'état et sa raison, les liens, les signaux. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatutBadge entite="statut_stock" code={c.etat} className="text-[12px]" />
          <span className="text-[13px]">{t.raison_etat}</span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Bouton taille="xs" variante="discret" onClick={() => ouvrir('/lots')} title="L’écran des lots ne se filtre pas encore par référence : cherchez-la dans la liste">
              Voir les lots <ArrowRight />
            </Bouton>
            <Bouton taille="xs" variante="discret" onClick={() => ouvrir(`/mouvements?reference=${encodeURIComponent(ref)}`)}>
              Ses mouvements <ArrowRight />
            </Bouton>
            {surSimuler && (
              <Bouton taille="xs" variante="contour" onClick={() => surSimuler(ref)}>
                <FlaskConical /> Simuler cette référence
              </Bouton>
            )}
          </span>
        </div>
        {c.signaux.length > 0 && (
          <div className="rounded-[var(--radius)] border border-dashed border-alerte/40 bg-alerte/5 px-3 py-1.5">
            <span className="mr-2 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Signaux</span>
            <ul className="mt-0.5 space-y-0.5">
              {c.signaux.map((sg) => (
                <li key={sg.code}>
                  <StatutBadge entite="signal_couverture" code={sg.code} className="mr-1.5" />
                  <span className="text-attenue-texte">{sg.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 2. Les tuiles. */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        <Tuile libelle="Stock total" valeur={kgOuTiret(t.stock_total_kg)} precision="magasins + métiers, compté ou non" />
        <Tuile libelle="Sur métiers" valeur={kgOuTiret(t.sur_metiers_kg)} precision="monté, pas encore tissé" />
        <Tuile libelle="Disponible hors quarantaine" valeur={kgOuTiret(t.disponible_kg)} precision="hors quarantaine et lots bloqués" />
        <Tuile
          libelle="Besoin jusqu’à réception"
          valeur={kgOuTiret(t.besoin_jusqu_reception_kg)}
          precision={
            t.date_reception
              ? `jusqu’au ${dateCourte(t.date_reception)}${t.plan_commande_kg != null ? ` ; puis ${kg(t.plan_commande_kg)} kg sur les ${t.couverture_commande_j} j que couvre une commande` : ''}`
              : 'aucune réception proposée'
          }
        />
        <Tuile libelle="Stock à la réception" valeur={kgOuTiret(t.stock_a_la_reception_kg)} precision="avant la commande proposée" />
        <Tuile
          libelle="Couverture actuelle"
          valeur={t.couverture_actuelle_j != null ? `${t.couverture_actuelle_j} j` : `> ${t.horizon_j} j`}
          ton={ecart != null && ecart < 0 ? 'alerte' : undefined}
          precision={
            t.couverture_cible_j != null
              ? `cible ${t.couverture_cible_j} j${ecart != null ? ` : écart ${ecart > 0 ? '+' : ''}${ecart} j` : ''}`
              : 'cible non définie'
          }
        />
        <Tuile
          libelle="À commander"
          valeur={
            positif(t.qte_a_commander_kg) ? (
              <>
                {kg(t.qte_a_commander_kg)} kg
                {typeof t.palettes_equivalentes === 'number' && (
                  <span className="text-[12px] font-normal text-attenue-texte"> ≈ {fmt.nombre(t.palettes_equivalentes, 1)} pal.</span>
                )}
              </>
            ) : 'qte_a_commander_kg' in t ? (
              'rien'
            ) : (
              '—'
            )
          }
          precision={t.date_limite_commande ? `avant le ${dateCourte(t.date_limite_commande)}` : undefined}
          ton={t.date_limite_commande && d.aujourdhui && t.date_limite_commande < d.aujourdhui ? 'danger' : undefined}
        />
      </section>

      {/* 3. L'approvisionnement. */}
      <section>
        <Titre>Approvisionnement</Titre>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <Paire libelle="Fournisseur">{d.reference.fournisseur_nom ?? '—'}</Paire>
          <Paire libelle="Délai fournisseur" note={source(r?.source_delai)}>
            {r ? `${r.delai_j} j` : '—'}
          </Paire>
          <Paire libelle="Couverture d’une commande" note={source(r?.source_couverture)}>
            {r ? `${r.couverture_commande_j} j` : '—'}
          </Paire>
          {'prix_devise' in achat && (
            <Paire
              libelle="Prix en devise"
              note={achat.source_prix ? `prix retenu : ${SOURCES_PRIX[achat.source_prix] ?? achat.source_prix}` : undefined}
            >
              {typeof achat.prix_devise === 'number' ? `${fmt.nombre(achat.prix_devise, 4)} ${achat.code_devise ?? ''}/kg` : '—'}
            </Paire>
          )}
          <Paire libelle="Minimum / multiple">
            {r?.moq_kg ? `${kg(r.moq_kg)} kg` : 'aucun minimum'} · {r?.multiple_kg ? `multiple ${kg(r.multiple_kg)} kg` : 'aucun multiple'}
          </Paire>
          {'montant_estime_mad' in achat && (
            <Paire libelle="Montant">
              {typeof achat.montant_estime_mad === 'number' ? fmt.mad(achat.montant_estime_mad) : '—'}
              {typeof achat.montant_devise === 'number' && achat.code_devise && achat.code_devise !== 'MAD' && (
                <span className="text-attenue-texte"> · {fmt.nombre(achat.montant_devise, 2)} {achat.code_devise}</span>
              )}
            </Paire>
          )}
          <Paire libelle="Couverture cible" note={r?.source_cible ? `(${r.source_cible})` : undefined}>
            {r?.couverture_cible_j != null ? `${r.couverture_cible_j} j` : <span className="text-alerte">non définie</span>}
          </Paire>
          <Paire libelle="Jours de sécurité" note={source(r?.source_securite)}>
            {r ? `${fmt.nombre(r.jours_securite, 0)} j` : '—'}
          </Paire>
          <Paire libelle="Date réception proposée">
            {t.date_reception ? dateCourte(t.date_reception) : '—'}
            {t.reception_en_retard && <span className="ml-1 font-medium text-danger">en retard</span>}
          </Paire>
          <Paire libelle="Avant le">{dateCourte(t.date_limite_commande)}</Paire>
          <Paire libelle="Stock minimum" note={c.stock_minimum.kg != null ? `${kg(c.stock_minimum.kg)} kg` : undefined}>
            {c.stock_minimum.kg == null ? (
              'aucun sur la fiche'
            ) : c.stock_minimum.franchi_le ? (
              <span className="text-alerte">garde-fou : franchi le {dateCourte(c.stock_minimum.franchi_le)}</span>
            ) : (
              'garde-fou : respecté'
            )}
          </Paire>
          <Paire libelle="Plan / mois" note="indicateur">
            {kgOuTiret(s.plan_mois_kg)}
          </Paire>
          <Paire libelle="Réel / mois" note="12 mois">
            {kgOuTiret(a.reel_mois_kg)}
          </Paire>
        </dl>
      </section>

      {/* 4. Le calcul de la quantité. */}
      <section>
        <Titre>Calcul de la quantité</Titre>
        {p ? (
          <CalculProposition p={p} d={d} />
        ) : (
          <p className="text-attenue-texte">Rien à commander : {d.motif_sans_proposition ?? 'aucune proposition sur l’horizon du plan'}.</p>
        )}
      </section>

      {/* 5. Le classement et le risque : ce que les vues fournissent déjà. */}
      {cl && (
        <section>
          <Titre>Classement et risque</Titre>
          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            <Paire libelle="Classe ABC" note={cl.rang != null ? `rang ${cl.rang}${cl.pct_cumule != null ? `, ${fmt.nombre(cl.pct_cumule, 1)} % cumulé` : ''}` : undefined}>
              {cl.classe_abc ?? '—'}
            </Paire>
            {'valeur_conso_annuelle_mad' in cl && (
              <Paire libelle="Valeur réelle 12 mois">
                {typeof cl.valeur_conso_annuelle_mad === 'number' ? fmt.mad(cl.valeur_conso_annuelle_mad) : '—'}
              </Paire>
            )}
            <Paire libelle="Classe XYZ" note={cl.politique ?? undefined}>
              {cl.classe_xyz ?? '—'}
            </Paire>
            <Paire libelle="Sourcing" note={cl.risque_source ? cl.risque_source.replace(/_/g, ' ').toLowerCase() : undefined}>
              {cl.nb_sources != null ? `${cl.nb_sources} source(s)` : '—'}
            </Paire>
            <Paire libelle="Groupe d’équivalence" note={cl.nb_fournisseurs_groupe != null ? `${cl.nb_fournisseurs_groupe} fournisseur(s) dans le groupe` : undefined}>
              {cl.groupe_libelle ?? cl.code_groupe_equiv ?? 'aucun'}
            </Paire>
            <Paire libelle="Dernière sortie">{dateCourte(cl.derniere_sortie)}</Paire>
            <Paire libelle="Sans mouvement depuis">{cl.jours_sans_mouvement != null ? `${cl.jours_sans_mouvement} j` : '—'}</Paire>
            <Paire libelle="Dormant">{cl.dormant ? <Badge ton="alerte">oui</Badge> : 'non'}</Paire>
          </dl>
        </section>
      )}

      {/* 6. Où se trouve la matière. */}
      <section>
        <Titre>Où se trouve la matière</Titre>
        <table className="w-full max-w-2xl">
          <tbody>
            {k.magasins.map((m) => (
              <Cascade key={m.code_magasin} signe="+" libelle={m.nom ?? m.code_magasin} valeur={m.kg} note="magasin compté, hors restes" />
            ))}
            <Cascade signe="+" libelle="Sur métiers" valeur={k.sur_metiers_kg} note="hors restes" />
            <Cascade signe="+" libelle="Restes constatés" valeur={k.restes_kg} />
            <Cascade signe="=" libelle="Disponible hors quarantaine" valeur={k.disponible_kg} total />
            {k.date_reception ? (
              <>
                <Cascade signe="+" libelle="Arrivages datés avant la réception proposée" valeur={k.arrivages_avant_reception_kg} />
                <Cascade signe="−" libelle="Besoin jusqu’à réception" valeur={k.besoin_jusqu_reception_kg} note={`jusqu’au ${dateCourte(k.date_reception)}`} />
                <Cascade signe="=" libelle="Stock à la réception" valeur={k.stock_a_la_reception_kg} total />
              </>
            ) : (
              <tr>
                <td />
                <td colSpan={2} className="py-0.5 text-attenue-texte">Aucune réception proposée.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-2 space-y-1 text-[11.5px] text-attenue-texte">
          <p className="font-medium text-texte">Hors calcul</p>
          {k.arrivages_apres.length > 0 && (
            <p>
              Arrivages datés après la réception proposée (comptés plus tard) :{' '}
              {k.arrivages_apres.map((x) => `${libelleArrivage(x)} ${kg(x.kg)} kg le ${dateCourte(x.date)}`).join(' · ')}
            </p>
          )}
          {k.arrivages_non_comptes.length > 0 && (
            <div>
              <p>Arrivages non comptés :</p>
              <ListeArrivages arrivages={k.arrivages_non_comptes} />
            </div>
          )}
          <p>
            Quarantaine {kg(k.quarantaine_kg)} kg · lots bloqués {kg(k.bloque_kg)} kg
            {positif(k.hors_plan_kg) && <> · magasins hors plan {kg(k.hors_plan_kg)} kg</>} — non comptés
          </p>
        </div>
      </section>

      {/* 7. Les onglets. */}
      <Onglets defaultValue="besoins">
        <OngletsListe className="mb-2 h-auto max-w-full flex-wrap gap-y-0">
          <Onglet value="besoins">Besoins du plan</Onglet>
          <Onglet value="projection">Projection</Onglet>
          <Onglet value="lots">Lots ({sp.lots.length})</Onglet>
          <Onglet value="metiers">Sur les métiers ({d.ressources?.machine.length ?? 0})</Onglet>
          {sp.historique && <Onglet value="historique">Historique</Onglet>}
        </OngletsListe>
        <OngletContenu value="besoins">
          <BesoinsDuPlan d={d} />
        </OngletContenu>
        <OngletContenu value="projection">
          {(d.jours?.length ?? 0) > 1 && <CourbeSolde jours={d.jours} propositions={d.propositions ?? []} />}
          <div className="mt-3">
            <Chronologie evenements={d.evenements ?? []} />
          </div>
        </OngletContenu>
        <OngletContenu value="lots">
          {sp.lots.length === 0 ? (
            <p className="text-attenue-texte">Aucun lot en stock.</p>
          ) : (
            <ul className="space-y-0.5">
              {sp.lots.map((l) => (
                <li key={`${l.code_magasin}-${l.lot_fournisseur}`} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{l.lot_fournisseur}</span>
                  <span className="text-attenue-texte">{l.magasin_nom ?? l.code_magasin}</span>
                  <span className="tabular-nums">{kg(l.kg)} kg</span>
                  {l.nb_bobines != null && <span className="tabular-nums text-attenue-texte">{l.nb_bobines} bobines</span>}
                  {l.statut_lot && <StatutBadge entite="lot" code={l.statut_lot} />}
                  {l.categorie && <span className="text-[11px] text-attenue-texte">{l.categorie.toLowerCase()}</span>}
                  {l.quarantaine && <Badge ton="alerte">quarantaine</Badge>}
                  {l.date_premiere_entree && <span className="text-[11px] text-attenue-texte">entré le {dateCourte(l.date_premiere_entree)}</span>}
                </li>
              ))}
            </ul>
          )}
        </OngletContenu>
        <OngletContenu value="metiers">
          {(d.ressources?.machine.length ?? 0) === 0 ? (
            <p className="text-attenue-texte">Rien sur les métiers.</p>
          ) : (
            <ul className="space-y-0.5">
              {d.ressources!.machine.map((e) => (
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
            </ul>
          )}
        </OngletContenu>
        {sp.historique && (
          <OngletContenu value="historique">
            {sp.historique.length === 0 ? (
              <p className="text-attenue-texte">Aucun mouvement.</p>
            ) : (
              <ul className="space-y-0.5">
                {sp.historique.map((m, i) => (
                  <li key={`${m.numero_mouvement ?? ''}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="tabular-nums">{dateCourte(m.date_mouvement)}</span>
                    <span className="font-medium">{m.type_libelle ?? m.code_type_mvt}</span>
                    <span className="text-attenue-texte">{m.numero_mouvement}</span>
                    <span className={cn('tabular-nums', (m.signe ?? 0) < 0 ? 'text-danger' : (m.signe ?? 0) > 0 ? 'text-succes' : '')}>
                      {(m.signe ?? 0) < 0 ? '− ' : (m.signe ?? 0) > 0 ? '+ ' : ''}
                      {kg(m.kg)} kg
                    </span>
                    {m.code_magasin && <span className="text-[11px] text-attenue-texte">{m.code_magasin}</span>}
                    {m.lot_fournisseur && <span className="text-[11px] text-attenue-texte">lot {m.lot_fournisseur}</span>}
                  </li>
                ))}
              </ul>
            )}
          </OngletContenu>
        )}
      </Onglets>
      <p className="text-[11px] text-attenue-texte">
        Source : {c.source} · état : {libelleStatut('statut_stock', c.etat)}.
      </p>
    </div>
  )
}

/**
 * LES BESOINS DU PLAN, MOIS PAR MOIS ET PAR QUALITÉ : kg/m² de la recette, les
 * douze premiers mois, le total ; la dernière ligne, le besoin du plan (la photo
 * du MRP). Au téléphone, une pile par mois (pas de défilement horizontal).
 */
function BesoinsDuPlan({ d }: { d: DetailCouverture }) {
  const mois = (d.plan_mois ?? []).slice(0, 12)
  if (mois.length === 0) return <p className="text-attenue-texte">Aucun besoin au plan en service.</p>
  const qualites = [...new Set(mois.flatMap((m) => m.qualites.map((q) => q.code_qualite)))].sort()
  const kgM2 = (q: string) => mois.flatMap((m) => m.qualites).find((x) => x.code_qualite === q)?.kg_m2
  const de = (m: (typeof mois)[number], q: string) => m.qualites.find((x) => x.code_qualite === q)?.kg ?? 0
  const court = (am: string) => `${am.slice(5, 7)}/${am.slice(2, 4)}`
  return (
    <>
      <table className="hidden w-full text-[11.5px] md:table">
        <thead>
          <tr className="border-b border-bordure text-[10px] uppercase tracking-wider text-attenue-texte">
            <th className="py-1 pr-2 text-left font-semibold">Qualité</th>
            <th className="py-1 pr-2 text-right font-semibold">kg/m²</th>
            {mois.map((m) => (
              <th key={m.annee_mois} className="py-1 pr-1 text-right font-semibold">{court(m.annee_mois)}</th>
            ))}
            <th className="py-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {qualites.map((q) => (
            <tr key={q} className="border-b border-ligne">
              <td className="py-0.5 pr-2 font-medium">{q}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums text-attenue-texte">{fmt.nombre(kgM2(q) ?? 0, 3)}</td>
              {mois.map((m) => (
                <td key={m.annee_mois} className="py-0.5 pr-1 text-right tabular-nums">{positif(de(m, q)) ? kg(de(m, q)) : '—'}</td>
              ))}
              <td className="py-0.5 text-right font-medium tabular-nums">{kg(mois.reduce((t, m) => t + de(m, q), 0))}</td>
            </tr>
          ))}
          <tr className="border-t border-bordure font-semibold">
            <td className="py-0.5 pr-2" colSpan={2}>Besoin du plan</td>
            {mois.map((m) => (
              <td key={m.annee_mois} className="py-0.5 pr-1 text-right tabular-nums">{kg(m.kg_mois)}</td>
            ))}
            <td className="py-0.5 text-right tabular-nums">{kg(mois.reduce((t, m) => t + m.kg_mois, 0))}</td>
          </tr>
        </tbody>
      </table>
      <ul className="space-y-1.5 md:hidden">
        {mois.map((m) => (
          <li key={m.annee_mois} className="border-b border-ligne pb-1">
            <div className="flex justify-between font-medium tabular-nums">
              <span>{m.annee_mois}</span>
              <span>besoin du plan {kg(m.kg_mois)} kg</span>
            </div>
            <div className="text-[11.5px] tabular-nums text-attenue-texte">
              {m.qualites.map((q) => `${q.code_qualite} ${kg(q.kg)} kg`).join(' · ') || '—'}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-attenue-texte">
        Les kilos du mois viennent de la photo du besoin du plan ; la part par qualité, des recettes actuelles.
      </p>
    </>
  )
}

/**
 * LA FENÊTRE DU STOCK PROJETÉ (§ 16 ; disposition « pont de calcul » choisie le
 * 31/10/2026) — le détail d'une référence ouvert au clic sur une ligne de
 * /stock. Le Stock projeté dit COMBIEN COMMANDER, sans chronologie : ni date de
 * rupture, ni courbe (la Surveillance s'en charge). De haut en bas, la lecture
 * d'un rapport d'analyse : la conclusion d'abord, la preuve ensuite, le détail
 * à la demande.
 *
 *   1. L'en-tête : l'état (pastille), sa raison chiffrée en une phrase (et les
 *      jours sans fil jusqu'au prochain approvisionnement), les liens, les signaux.
 *   2. LA DÉCISION : à commander (kg, palettes), montant, avant le, réception
 *      théorique — ou pourquoi rien.
 *   3. Quatre chiffres : couverture (en négatif : jours sans fil), couverture à
 *      la livraison, position, délai.
 *   4. LE PONT : stock compté + arrivages − plan jusqu'à C + N = solde ; + la
 *      quantité = après la commande. Chaque total est la somme exacte des lignes
 *      au-dessus (`projete.pont`, `domain/projete.rs`).
 *   5. Côte à côte : où se trouve la matière (une barre, un magasin par segment,
 *      machines, restes, quarantaine, en route, commandé) et les arrivages.
 *   6. Les onglets : calcul (approvisionnement, quantité, formation de la
 *      couverture), besoins du plan, lots, métiers, classement, historique.
 *
 * Rien ne se recalcule ici : tout vient de `GET /api/couverture/{ref}` (bloc
 * `projete`) ; l'écran ne fait qu'afficher.
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
import { ListeArrivages, Titre } from './DetailCouverture'
import { useClassementReference } from './lecture'
import { SOURCES_PRIX, dateCourte, kg, positif, source, type Arrivage, type DetailCouverture } from './types'

const kgOuTiret = (v: unknown) => (typeof v === 'number' ? `${kg(v)} kg` : '—')
const jours = (v: number | null | undefined, horizon?: number) =>
  v == null ? (horizon != null ? `> ${horizon} j` : '—') : `${v} j`

/** Une tuile : l'intitulé (et son ⓘ), la valeur, une précision. */
function Tuile({ libelle, valeur, precision, ton }: { libelle: string; valeur: ReactNode; precision?: ReactNode; ton?: 'danger' | 'alerte' }) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2">
      <div className="flex items-start gap-1 text-[11.5px] leading-tight text-attenue-texte">
        <span>{libelle}</span>
        <IndiceChamp intitule={libelle} />
      </div>
      <div className={cn('mt-0.5 text-[17px] font-semibold tabular-nums', ton === 'danger' && 'text-danger', ton === 'alerte' && 'text-alerte')}>
        {valeur}
      </div>
      {precision && <div className="mt-0.5 text-[11.5px] leading-snug text-attenue-texte">{precision}</div>}
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

/** Le cadre de la décision, à la couleur de l'état. */
const CADRE_ETAT: Record<string, string> = {
  ALERTE: 'border-danger/50 bg-danger/5',
  SOUS_CIBLE: 'border-alerte/50 bg-alerte/5',
  COUVERT: 'border-succes/40 bg-succes/5',
}

export function FenetreStockProjete({ d, surSimuler }: { d: DetailCouverture; surSimuler?: (reference: string) => void }) {
  const ouvrir = useOuvrirVue()
  const sp = d.stock_projete
  const p = d.projete
  const r = d.reglages
  const s = d.synthese
  const a = d.approvisionnement ?? {}
  const achat = d.achat ?? {}
  const ref = d.reference.code_reference
  // Le classement se lit à part : la fenêtre s'ouvre sans l'attendre.
  const qClassement = useClassementReference(sp?.classement ? null : ref)
  if (!sp || !p) return null
  const k = sp.cascade
  const cl = sp.classement ?? qClassement.data ?? null
  const q = p.quantite
  const quantiteVisible = 'quantite' in p
  const avantLePasse = !!(p.avant_le && d.aujourdhui && p.avant_le < d.aujourdhui)
  const sansFil = p.jours_sans_fil ?? 0
  // Hors calcul au stock projeté : seuls un bon non validé et un arrivage sans
  // date ; un bon en retard compte aujourd'hui, un arrivage lointain à sa date.
  // Les réglages P_Projete* (31/10/2026) : un arrivage sans date peut compter.
  const o = p.options
  const horsCalcul = k.arrivages_non_comptes.filter(
    (x) => x.categorie === 'NON_VALIDE' || (x.categorie === 'SANS_DATE' && !o?.sans_date),
  )
  const enRetard = k.arrivages_non_comptes.filter((x) => x.categorie === 'EN_RETARD')
  const libelleRattrapage = p.rattrapage ? 'rattrapé : le manque reste dû' : 'non rattrapé : le manque est perdu'

  return (
    <div className="min-w-0 space-y-5 text-[13px] whitespace-normal" onClick={(e) => e.stopPropagation()}>
      {/* 1. L'en-tête : l'état et sa raison, les liens, les signaux. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatutBadge entite="statut_projete" code={p.etat} className="text-[12px]" />
          <span className="text-[13.5px]">
            {p.raison}
            {sansFil > 0 && (
              <span className="font-medium text-danger">
                {' '}
                · {sansFil} jour(s) sans fil jusqu’au prochain approvisionnement
                {positif(p.manque_kg) && ` (${kg(p.manque_kg)} kg non servis)`}
              </span>
            )}
          </span>
          {/* Le palier de rupture (31/10/2026) : quand le fil manque. */}
          {p.palier && (
            <span className="inline-flex items-center gap-1.5">
              <StatutBadge entite="palier_rupture" code={p.palier} />
              <span className="text-[12px] text-attenue-texte">
                {p.rupture_le ? `rupture le ${dateCourte(p.rupture_le)}` : ''}
                {p.palier_suivant && p.date_palier_suivant
                  ? ` · → ${libelleStatut('palier_rupture', p.palier_suivant)} le ${dateCourte(p.date_palier_suivant)}`
                  : ''}
              </span>
            </span>
          )}
          {p.a_sec && (
            <Badge ton="danger" title="Commander ne suffit plus : faire avancer la livraison, ou acheter sur place">
              à sec le {dateCourte(p.a_sec.date_sec)}, camion le {dateCourte(p.a_sec.date_arrivage)}
            </Badge>
          )}
          <Badge ton="neutre">rattrapage {p.rattrapage ? 'inclus' : 'exclu'}</Badge>
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
        {p.signaux.length > 0 && (
          <div className="rounded-[var(--radius)] border border-dashed border-alerte/40 bg-alerte/5 px-3 py-1.5">
            <span className="mr-2 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Signaux</span>
            <ul className="mt-0.5 space-y-0.5">
              {p.signaux.map((sg) => (
                <li key={sg.code}>
                  <StatutBadge entite="signal_couverture" code={sg.code} className="mr-1.5" />
                  <span className="text-attenue-texte">{sg.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 2. La décision. */}
      <section
        aria-label="Décision"
        className={cn('flex flex-wrap items-end gap-x-8 gap-y-2 rounded-[var(--radius)] border px-4 py-3', CADRE_ETAT[p.etat] ?? 'border-bordure')}
      >
        {q ? (
          <>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">À commander</div>
              <div className="text-[24px] font-semibold leading-tight tabular-nums">
                {kg(q.quantite_kg)} kg
                {typeof q.palettes === 'number' && (
                  <span className="ml-1.5 text-[13px] font-normal text-attenue-texte">≈ {fmt.nombre(q.palettes, 1)} palettes</span>
                )}
              </div>
            </div>
            {'montant_estime_mad' in p && (
              <div>
                <div className="text-[11px] text-attenue-texte">Montant</div>
                <div className="text-[15px] font-medium tabular-nums">
                  {typeof p.montant_estime_mad === 'number' ? fmt.mad(p.montant_estime_mad) : '—'}
                  {typeof p.montant_devise === 'number' && achat.code_devise && achat.code_devise !== 'MAD' && (
                    <span className="text-[12px] font-normal text-attenue-texte"> · {fmt.nombre(p.montant_devise, 2)} {achat.code_devise}</span>
                  )}
                </div>
              </div>
            )}
            <div>
              <div className="text-[11px] text-attenue-texte">Avant le</div>
              <div className={cn('text-[15px] font-medium tabular-nums', avantLePasse && 'text-danger')}>
                {p.avant_le ? `${dateCourte(p.avant_le)}${avantLePasse ? ' · dépassé' : ''}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-attenue-texte">Réception théorique</div>
              <div className="text-[15px] font-medium tabular-nums">{dateCourte(q.date_reception)}</div>
            </div>
            <div className="min-w-0 basis-full text-[11.5px] text-attenue-texte sm:basis-auto">
              chez {d.reference.fournisseur_nom ?? 'fournisseur non renseigné'}
              {r ? `, délai ${r.delai_j} j` : ''}
            </div>
          </>
        ) : quantiteVisible ? (
          <p>
            <span className="font-semibold">Rien à commander</span>
            <span className="text-attenue-texte">
              {' '}
              :{' '}
              {p.motif_sans_quantite ??
                (p.cible_j == null
                  ? 'la couverture cible n’est pas définie'
                  : `la couverture projetée (${jours(p.couverture_j, p.horizon_j)}) atteint la cible (${p.cible_j} j)`)}
              .
            </span>
          </p>
        ) : (
          <p className="text-attenue-texte">La quantité ne se lit pas avec vos droits.</p>
        )}
      </section>

      {/* 3. Quatre chiffres. */}
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tuile
          libelle="Couverture"
          valeur={sansFil > 0 ? `−${sansFil} j` : jours(p.couverture_j, p.horizon_j)}
          ton={sansFil > 0 ? 'danger' : p.ecart_cible_j != null && p.ecart_cible_j < 0 ? 'alerte' : undefined}
          precision={
            sansFil > 0
              ? `jours sans fil jusqu’au prochain approvisionnement ; couverture projetée ${jours(p.couverture_j, p.horizon_j)}`
              : p.cible_j != null
                ? `cible ${p.cible_j} j${p.ecart_cible_j != null ? ` : écart ${p.ecart_cible_j > 0 ? '+' : ''}${p.ecart_cible_j} j` : ''}`
                : 'cible non définie'
          }
        />
        <Tuile
          libelle="Couverture à la livraison"
          valeur={jours(p.couverture_livraison_j, p.horizon_j)}
          ton={p.etat === 'ALERTE' ? 'danger' : undefined}
          precision={`seuil d’alerte ${p.seuil_alerte_j} j`}
        />
        <Tuile libelle="Position" valeur={kgOuTiret(p.position_kg)} precision="stock compté + arrivages" />
        <Tuile
          libelle="Délai"
          valeur={r ? `${r.delai_j} j` : '—'}
          precision={`besoin pendant le délai ${kgOuTiret(p.besoin_delai_kg)}`}
        />
      </section>

      {/* 4. Le pont. */}
      <section>
        <Titre>Comment on arrive à la quantité</Titre>
        {p.pont ? (
          <PontQuantite d={d} />
        ) : (
          <p className="text-attenue-texte">Sans couverture cible, aucun niveau visé : rien ne se calcule.</p>
        )}
      </section>

      {/* 5. Où se trouve la matière, et les arrivages. */}
      <section className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="min-w-0">
          <Titre>Où se trouve la matière</Titre>
          <Repartition d={d} />
        </div>
        <div className="min-w-0">
          <Titre>Arrivages</Titre>
          <ArrivagesProjete arrivages={d.arrivages ?? []} aujourdhui={d.aujourdhui} />
        </div>
      </section>

      {/* 6. Les onglets. */}
      <Onglets defaultValue="calcul">
        <OngletsListe className="mb-2 h-auto max-w-full flex-wrap gap-y-0">
          <Onglet value="calcul">Calcul</Onglet>
          <Onglet value="besoins">Besoins du plan</Onglet>
          <Onglet value="lots">Lots ({sp.lots.length})</Onglet>
          <Onglet value="metiers">Sur les métiers ({d.ressources?.machine.length ?? 0})</Onglet>
          <Onglet value="classement">Classement</Onglet>
          {sp.historique && <Onglet value="historique">Historique</Onglet>}
        </OngletsListe>
        <OngletContenu value="calcul" className="space-y-5">
          <div>
            <Titre>Approvisionnement</Titre>
            <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <Paire libelle="Fournisseur">{d.reference.fournisseur_nom ?? '—'}</Paire>
              <Paire libelle="Délai fournisseur" note={source(r?.source_delai)}>
                {r ? `${r.delai_j} j` : '—'}
              </Paire>
              <Paire libelle="Couverture d’une commande" note={source(r?.source_couverture)}>
                {r ? `${r.couverture_commande_j} j de consommation` : '—'}
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
              <Paire libelle="Couverture cible" note={r?.source_cible ? `(${r.source_cible})` : undefined}>
                {p.cible_j != null ? `${p.cible_j} j` : <span className="text-alerte">non définie</span>}
              </Paire>
              <Paire libelle="Jours de sécurité" note={source(r?.source_securite)}>
                {r ? `${fmt.nombre(r.jours_securite, 0)} j` : '—'}
              </Paire>
              <Paire libelle="Stock minimum" note="pour information : il ne change jamais la quantité">
                {r?.stock_min_kg != null ? `${kg(r.stock_min_kg)} kg${p.stock_min_j != null ? ` ≈ ${p.stock_min_j} j de plan` : ''}` : 'aucun sur la fiche'}
              </Paire>
              <Paire libelle="Seuil d’alerte" note="sécurité + stock minimum en jours">
                {r ? `${fmt.nombre(r.jours_securite, 0)} j + ${p.stock_min_j ?? 0} j = ${p.seuil_alerte_j} j` : `${p.seuil_alerte_j} j`}
              </Paire>
              <Paire libelle="Plan / mois" note="indicateur">
                {kgOuTiret(s.plan_mois_kg)}
              </Paire>
              <Paire libelle="Réel / mois" note="12 mois">
                {kgOuTiret(a.reel_mois_kg)}
              </Paire>
            </dl>
          </div>
          <div>
            <Titre>Calcul de la quantité</Titre>
            {q ? (
              <table className="w-full max-w-2xl">
                <tbody>
                  <Cascade
                    signe=""
                    libelle={`Besoin pour atteindre ${q.niveau_vise_j} j de couverture`}
                    valeur={q.besoin_kg}
                    note={`cible ${p.cible_j ?? '—'} j + une commande ${r?.couverture_commande_j ?? '—'} j, reçu le ${dateCourte(q.date_reception)}`}
                  />
                  <Cascade
                    signe="="
                    libelle="Après le minimum de commande"
                    valeur={q.apres_minimum_kg}
                    note={q.moq_kg ? `minimum ${kg(q.moq_kg)} kg` : 'aucun minimum'}
                  />
                  <Cascade
                    signe="+"
                    libelle="Arrondi au multiple"
                    valeur={q.complement_multiple_kg}
                    note={q.multiple_kg ? `multiple ${kg(q.multiple_kg)} kg` : 'aucun multiple'}
                  />
                  <Cascade signe="=" libelle="À commander" valeur={q.quantite_kg} total />
                </tbody>
              </table>
            ) : (
              <p className="text-attenue-texte">Aucune quantité.</p>
            )}
          </div>
          <div>
            <Titre>Formation de la couverture</Titre>
            <table className="w-full max-w-2xl">
              <tbody>
                {k.magasins.map((m) => (
                  <Cascade key={m.code_magasin} signe="+" libelle={m.nom ?? m.code_magasin} valeur={m.kg} note="magasin compté, hors restes" />
                ))}
                <Cascade signe="+" libelle="Sur métiers" valeur={k.sur_metiers_kg} note="hors restes" />
                <Cascade signe="+" libelle="Restes constatés" valeur={k.restes_kg} />
                <Cascade signe="=" libelle="Stock compté" valeur={k.disponible_kg} total />
                {p.etapes.map((e, i) =>
                  e.nature === 'ARRIVAGE' ? (
                    <FormationArrivage key={i} e={e} libelleRattrapage={libelleRattrapage} />
                  ) : (
                    <Cascade
                      key={i}
                      signe="−"
                      libelle={`Consommation jusqu’au ${dateCourte(e.date)}`}
                      valeur={e.conso_kg}
                      note={`${positif(e.manque_kg) ? `dont ${kg(e.manque_kg)} kg non servis ; ` : ''}couvert jusqu’au ${dateCourte(e.date)}`}
                    />
                  ),
                )}
                {p.couverture_j == null && (
                  <tr>
                    <td />
                    <td colSpan={2} className="py-0.5 text-attenue-texte">
                      Couvert sur tout l’horizon du plan ({p.horizon_j} j).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="mt-2 space-y-1 text-[11.5px] text-attenue-texte">
              {positif(p.manque_kg) && (
                <p>
                  Manque avant arrivage : <span className="font-medium text-texte">{kg(p.manque_kg)} kg</span>, {libelleRattrapage}.
                </p>
              )}
              {enRetard.length > 0 && (
                <p>
                  Bons en retard : comptés à partir d’aujourd’hui{o?.retard_j ? ` + ${o.retard_j} j` : ''} (pas de commande en double).
                </p>
              )}
              {o && (
                <p>
                  Réglages : quarantaine {o.quarantaine ? 'comptée' : 'non comptée'} · sans date{' '}
                  {o.sans_date ? 'compté à aujourd’hui + délai' : 'hors calcul'} · constat machine{' '}
                  {o.age_constat_max_j > 0 ? `compté jusqu’à ${o.age_constat_max_j} j` : 'compté quel que soit son âge'} ·
                  minimum et multiple {o.min_multiple ? 'appliqués' : 'non appliqués'} · stock minimum{' '}
                  {o.minimum_alerte ? 'dans le seuil d’alerte' : 'hors du seuil d’alerte'}.
                </p>
              )}
              {horsCalcul.length > 0 && (
                <div>
                  <p className="font-medium text-texte">Hors calcul (bon non validé, aucune date)</p>
                  <ListeArrivages arrivages={horsCalcul} />
                </div>
              )}
              <p>
                Quarantaine {kg(k.quarantaine_kg)} kg · lots bloqués {kg(k.bloque_kg)} kg
                {positif(k.hors_plan_kg) && <> · magasins hors plan {kg(k.hors_plan_kg)} kg</>} — non comptés
              </p>
            </div>
          </div>
        </OngletContenu>
        <OngletContenu value="besoins">
          <BesoinsDuPlan d={d} />
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
        <OngletContenu value="classement">
          {cl ? (
            <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <Paire libelle="Classe ABC" note={cl.rang != null ? `rang ${cl.rang}${cl.pct_cumule != null ? `, ${fmt.nombre(cl.pct_cumule, 1)} % cumulé` : ''}` : undefined}>
                {cl.classe_abc ?? '—'}
              </Paire>
              {'valeur_conso_annuelle_mad' in cl && (
                <Paire libelle="Valeur réelle 12 mois">
                  {typeof cl.valeur_conso_annuelle_mad === 'number' ? fmt.mad(cl.valeur_conso_annuelle_mad) : '—'}
                </Paire>
              )}
              <Paire libelle="Classe XYZ" note={cl.coef_variation_xyz != null ? `coefficient de variation ${fmt.nombre(cl.coef_variation_xyz, 2)}` : undefined}>
                {cl.classe_xyz ?? '—'}
              </Paire>
              <Paire libelle="Politique ABC / XYZ">{cl.politique ?? '—'}</Paire>
              <Paire libelle="Palier de montant">{cl.tier ? cl.tier.replace('TIER_', 'palier ') : '—'}</Paire>
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
          ) : (
            <p className="text-attenue-texte">{qClassement.isLoading ? 'Lecture du classement…' : 'Aucun classement.'}</p>
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
        Source : stock projeté (plan au jour, profil uniforme dans le mois ; toutes les commandes ouvertes à leur date) ·
        état : {libelleStatut('statut_projete', p.etat)} · rattrapage {p.rattrapage ? 'inclus' : 'exclu'}.
      </p>
    </div>
  )
}

/**
 * LE PONT (31/10/2026) : une cascade en barres, du stock compté au niveau visé
 * C + N. Chaque barre part de là où la précédente s'arrête ; les totaux partent
 * de zéro. Les chiffres viennent du moteur (`projete.pont`, `projete.quantite`).
 */
function PontQuantite({ d }: { d: DetailCouverture }) {
  const p = d.projete!
  const pont = p.pont!
  const q = p.quantite
  const stock = d.stock_projete!.cascade.disponible_kg
  const apresArrivages = stock + pont.arrivages_kg
  const solde = pont.solde_kg
  const tardifs = p.arrivages_kg - pont.arrivages_kg
  type Barre = { signe: string; libelle: string; note?: string; de: number; a: number; total?: boolean; valeur: number }
  const barres: Barre[] = [
    { signe: '', libelle: 'Stock compté', note: 'magasins, métiers, restes', de: 0, a: stock, total: true, valeur: stock },
    {
      signe: '+',
      libelle: `Arrivages avant le ${dateCourte(pont.date_vise)}`,
      note: positif(tardifs) ? `${kg(tardifs)} kg arrivent après : hors du pont` : undefined,
      de: stock,
      a: apresArrivages,
      valeur: pont.arrivages_kg,
    },
    {
      signe: '−',
      libelle: `Plan jusqu’au ${dateCourte(pont.date_vise)}`,
      note: `${pont.vise_j} j = cible ${p.cible_j ?? '—'} j + une commande`,
      de: apresArrivages,
      a: solde,
      valeur: -pont.plan_kg,
    },
    { signe: '=', libelle: `Solde au ${dateCourte(pont.date_vise)}`, note: solde < 0 ? 'manque' : undefined, de: 0, a: solde, total: true, valeur: solde },
  ]
  if (q) {
    const calendrier = q.besoin_kg - Math.max(-solde, 0)
    barres.push({
      signe: '+',
      libelle: 'Besoin à commander',
      note: positif(calendrier)
        ? `dont ${kg(calendrier)} kg dus au calendrier (reçu le ${dateCourte(q.date_reception)}, arrivage après l’épuisement)`
        : undefined,
      de: solde,
      a: solde + q.besoin_kg,
      valeur: q.besoin_kg,
    })
    const arrondi = q.quantite_kg - q.besoin_kg
    if (positif(arrondi))
      barres.push({
        signe: '+',
        libelle: 'Minimum et multiple',
        de: solde + q.besoin_kg,
        a: solde + q.quantite_kg,
        valeur: arrondi,
      })
    barres.push({ signe: '=', libelle: 'Après la commande', de: 0, a: solde + q.quantite_kg, total: true, valeur: solde + q.quantite_kg })
  }
  const bornes = barres.flatMap((b) => [b.de, b.a])
  const bas = Math.min(0, ...bornes)
  const haut = Math.max(0, ...bornes)
  const etendue = haut - bas || 1
  const pc = (v: number) => `${((v - bas) / etendue) * 100}%`
  return (
    <div className="space-y-1">
      {barres.map((b, i) => (
        <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_6.5rem] items-center gap-x-2 sm:grid-cols-[1.25rem_15rem_minmax(0,1fr)_6.5rem]">
          <span className="text-center text-attenue-texte">{b.signe}</span>
          <span className={cn('min-w-0 leading-snug', b.total && 'font-semibold')}>
            {b.libelle}
            {b.note && <span className="block text-[11px] font-normal text-attenue-texte">{b.note}</span>}
          </span>
          <span className="relative col-span-3 col-start-1 row-start-2 h-3.5 sm:col-span-1 sm:col-start-3 sm:row-start-1" aria-hidden>
            <span className="absolute inset-y-0 w-px bg-bordure" style={{ left: pc(0) }} />
            <span
              className={cn(
                'absolute inset-y-0 rounded-sm',
                b.total ? (b.a < 0 ? 'bg-danger' : 'bg-primaire') : b.a >= b.de ? 'bg-succes/70' : 'bg-danger/70',
              )}
              style={{ left: pc(Math.min(b.de, b.a)), width: `max(2px, ${(Math.abs(b.a - b.de) / etendue) * 100}%)` }}
            />
          </span>
          <span className={cn('text-right tabular-nums', b.total && 'font-semibold', b.total && b.valeur < 0 && 'text-danger')}>
            {b.valeur < 0 ? '−' : ''}
            {kg(Math.abs(b.valeur))} kg
          </span>
        </div>
      ))}
    </div>
  )
}

/** Les couleurs des segments : les magasins en dégradé de la couleur principale. */
const TEINTES_MAGASIN = ['bg-primaire', 'bg-primaire/65', 'bg-primaire/40', 'bg-primaire/25']

/**
 * OÙ SE TROUVE LA MATIÈRE (31/10/2026) : une barre, un segment par endroit —
 * chaque magasin au plan (hors restes), les machines, les restes, la
 * quarantaine, en route (transferts), commandé — et sa légende chiffrée. Le
 * total est le stock global après l'arrivage de l'onglet Emplacements.
 */
function Repartition({ d }: { d: DetailCouverture }) {
  const l = d.projete?.ligne ?? {}
  const segments = [
    ...Object.entries(l.stock_par_magasin ?? {})
      .sort((x, y) => y[1] - x[1])
      .map(([m, v], i) => ({ libelle: m, kg: v, teinte: TEINTES_MAGASIN[Math.min(i, TEINTES_MAGASIN.length - 1)] })),
    { libelle: 'Sur machines', kg: l.machine_hors_restes_kg ?? 0, teinte: 'bg-info' },
    { libelle: 'Restes', kg: l.restant_kg ?? 0, teinte: 'bg-or' },
    { libelle: 'Quarantaine', kg: l.quarantaine_kg ?? 0, teinte: 'bg-alerte' },
    { libelle: 'En route (transferts)', kg: l.transit_kg ?? 0, teinte: 'bg-succes' },
    { libelle: 'Commandé', kg: l.commande_kg ?? 0, teinte: 'bg-succes/40' },
  ].filter((s) => positif(s.kg))
  const total = segments.reduce((t, s) => t + s.kg, 0)
  if (!positif(total)) return <p className="text-attenue-texte">Aucun stock, rien en route ni commandé.</p>
  return (
    <div className="space-y-2">
      <div className="flex h-4 w-full overflow-hidden rounded-sm bg-attenue" role="img" aria-label="Répartition du stock">
        {segments.map((s) => (
          <span key={s.libelle} className={s.teinte} style={{ width: `${(s.kg / total) * 100}%` }} title={`${s.libelle} : ${kg(s.kg)} kg`} />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.libelle} className="flex items-baseline gap-2 border-b border-ligne py-0.5">
            <span className={cn('size-2.5 shrink-0 self-center rounded-sm', s.teinte)} />
            <span className="min-w-0 flex-1 truncate" title={s.libelle}>{s.libelle}</span>
            <span className="tabular-nums">{kg(s.kg)} kg</span>
            <span className="w-11 text-right text-[11px] tabular-nums text-attenue-texte">{fmt.nombre((s.kg / total) * 100, 0)} %</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-x-4 text-[12px]">
        <span>
          Disponible total <span className="font-medium tabular-nums">{kgOuTiret(l.disponible_kg)}</span>
        </span>
        <span>
          Stock global après l’arrivage <span className="font-semibold tabular-nums">{kg(total)} kg</span>
        </span>
      </div>
    </div>
  )
}

/** Le libellé d'un arrivage : son document. */
function documentArrivage(a: Arrivage): string {
  if (a.origine === 'TRANSFERT') return `Transfert ${a.numero_transfert ?? ''}`.trim()
  if (a.origine === 'IMPORT_SANS_BON')
    return `Import ${a.numero_dossier ?? ''}${a.numero_facture ? ` · ${a.numero_facture}` : ''}`.trim()
  return `Bon ${a.numero_bc ?? ''}${a.ligne_numero != null ? ` · ligne ${a.ligne_numero}` : ''}`.trim()
}

/**
 * LES ARRIVAGES tels que le stock projeté les compte : chacun à sa date, une
 * date passée à aujourd'hui ; seuls un bon non validé et un arrivage sans date
 * restent hors calcul.
 */
function ArrivagesProjete({ arrivages, aujourdhui }: { arrivages: Arrivage[]; aujourdhui?: string | null }) {
  if (arrivages.length === 0) return <p className="text-attenue-texte">Aucun bon ouvert, aucun import ni transfert en route.</p>
  const tries = [...arrivages].sort((x, y) => (x.date ?? '9999').localeCompare(y.date ?? '9999'))
  return (
    <ul className="space-y-0.5">
      {tries.map((a, i) => {
        const compte = a.categorie !== 'NON_VALIDE' && !!a.date
        const retard = compte && !!aujourdhui && a.date! < aujourdhui
        return (
          <li key={a.cle ?? i} className="flex flex-wrap items-baseline gap-x-2 border-b border-ligne py-0.5">
            <span className="w-[4.5rem] shrink-0 tabular-nums">{a.date ? dateCourte(a.date) : 'sans date'}</span>
            <span className="min-w-0 flex-1 font-medium">{documentArrivage(a)}</span>
            <span className="tabular-nums">{kg(a.kg)} kg</span>
            {compte ? (
              <Badge ton={retard ? 'alerte' : 'succes'}>{retard ? 'en retard : compté aujourd’hui' : 'compté'}</Badge>
            ) : (
              <Badge ton="neutre" title={a.raison}>
                hors calcul
              </Badge>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Un arrivage dans la formation de la couverture : la consommation qui le précède, le manque éventuel, l'arrivage, le solde. */
function FormationArrivage({ e, libelleRattrapage }: { e: NonNullable<DetailCouverture['projete']>['etapes'][number]; libelleRattrapage: string }) {
  return (
    <>
      <Cascade
        signe="−"
        libelle={`Consommation jusqu’au ${dateCourte(e.date)}`}
        valeur={e.conso_kg}
        note={positif(e.manque_kg) ? `dont ${kg(e.manque_kg)} kg non servis, ${libelleRattrapage}` : undefined}
      />
      <Cascade signe="+" libelle={`Arrivage du ${dateCourte(e.date)}`} valeur={e.arrivee_kg} />
      <Cascade signe="=" libelle={`Stock au ${dateCourte(e.date)}`} valeur={e.solde_kg} total />
    </>
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

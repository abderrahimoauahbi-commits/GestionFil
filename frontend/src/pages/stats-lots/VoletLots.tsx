/**
 * Statistiques — l'onglet « Lots ».
 *
 * Quatre questions, dans l'ordre ou la direction les pose :
 *
 *   1. Ou est le stock ? Compte pour le plan (Projet), reste a ecouler
 *      (Restes), immobilise par la qualite (bloque) ou oublie (dormant).
 *   2. Depuis quand ? L'age des lots, par tranche, Projet et Restes separes.
 *   3. Les bobines pesent-elles ce que dit le catalogue ? Par fournisseur, par
 *      mois, par article — les couleurs suivent les tolerances REGLEES dans
 *      les parametres, jamais un seuil ecrit ici.
 *   4. Les autorisations tiennent-elles le rythme ? File, delai, refus.
 *
 * Tout vient de `GET /api/stats/lots` (migration 2026-10-02c) : l'ecran ne
 * recalcule rien qu'une somme ou une moyenne ponderee.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Hourglass, Moon, Package, Scale, ShieldCheck } from 'lucide-react'
import { useDroits } from '../../auth/AuthContext'
import { BarreRepartition, CarteStat } from '../../composants/CarteStat'
import { BarresRangees, ColonnesTemps } from '../../composants/graphiques/Graphiques'
import { Alerte, Badge, Carte, CarteCorps, CarteEntete, CarteTitre } from '../../composants/ui/base'
import { couleurEcart, useTolerancesLot, type CouleurEcart } from '../../lib/lots'
import { cn, fmt } from '../../lib/utils'

type Ligne = Record<string, unknown>

const nb = (l: Ligne | null | undefined, c: string) =>
  l == null || l[c] == null ? null : Number(l[c])
const txt = (l: Ligne, c: string) => (l[c] == null ? null : String(l[c]))
const somme = (lignes: Ligne[], c: string) => lignes.reduce((s, l) => s + (nb(l, c) ?? 0), 0)

/** La couleur d'un ecart, en classe de texte : les tokens, rien d'autre. */
const TEXTE_ECART: Record<CouleurEcart, string> = {
  vert: 'text-succes',
  orange: 'text-alerte',
  rouge: 'text-danger',
}

/** La meme couleur, dans le vocabulaire des graphiques maison. */
const ETAT_GRAPHIQUE: Record<CouleurEcart, 'bon' | 'alerte' | 'critique'> = {
  vert: 'bon',
  orange: 'alerte',
  rouge: 'critique',
}

/** Ce que demande chaque type d'autorisation, dit en clair. */
const LIBELLE_DEMANDE: Record<string, string> = {
  ECART_POIDS: 'Écart de poids hors tolérance',
  MELANGE_FOURNISSEURS: 'Mélange de fournisseurs',
  LOT_BLOQUE: 'Utiliser un lot bloqué',
  RESTES_PRODUCTION: 'Restes en production',
  RETOUR_PRINCIPAL: 'Retour au magasin principal',
  DORMANT: 'Lot dormant',
  FUSION: 'Fusion de lots',
  STOCK_INSUFFISANT: 'Stock insuffisant',
}

/** Un ecart en %, signe, colore selon les tolerances. */
function Ecart({ pct, t }: { pct: number | null; t: { orange: number; rouge: number } }) {
  const c = couleurEcart(pct, t)
  if (pct == null || c == null) return <span className="text-attenue-texte">—</span>
  return (
    <span className={cn('font-medium tabular-nums', TEXTE_ECART[c])}>
      {pct > 0 ? '+' : ''}
      {fmt.nombre(pct, 2)} %
    </span>
  )
}

const TH = 'px-2 py-2 text-[11px] font-medium uppercase tracking-wider text-attenue-texte'

export function VoletLots({ d }: { d: Record<string, unknown> }) {
  const naviguer = useNavigate()
  const t = useTolerancesLot()
  const droits = useDroits('STOCK')
  // La valeur suit le droit du champ `valeur_mad` du stock : un role qui ne
  // voit pas la valeur d'un lot ne la voit pas davantage en somme.
  const voitValeur = droits.visible('valeur_mad')

  const tableau = (cle: string) => (Array.isArray(d[cle]) ? (d[cle] as Ligne[]) : [])
  const categories = tableau('categories')
  const ages = tableau('ages')
  const parFournisseur = tableau('divergence_fournisseur')
  const parArticle = tableau('divergence_article')
  const parMois = tableau('divergence_mois')
  const derive = tableau('derive_fournisseur')
  const autorisations = tableau('autorisations')
  const evaluation = tableau('evaluation_conditionnement')
  const suivi = tableau('suivi_conditionnement')
  const cockpit = (d.cockpit ?? null) as Ligne | null

  const kg = {
    projet: somme(categories, 'projet_kg'),
    restes: somme(categories, 'restes_kg'),
    bloque: somme(categories, 'bloque_kg'),
    dormant: somme(categories, 'dormant_kg'),
    total: somme(categories, 'total_kg'),
  }
  const mad = {
    projet: somme(categories, 'projet_mad'),
    restes: somme(categories, 'restes_mad'),
    total: somme(categories, 'total_mad'),
  }
  const nbLots = somme(categories, 'nb_lots')
  const nbABasculer = somme(categories, 'nb_a_basculer')

  /* L'ECART MOYEN GLOBAL, pondere par les bobines : une ligne de 2 400
     bobines pese plus qu'une ligne de 10, comme dans la vue serveur. */
  const ecartGlobal = useMemo(() => {
    let poids = 0
    let cumul = 0
    for (const f of parFournisseur) {
      const b = nb(f, 'bobines') ?? 0
      const p = nb(f, 'ecart_moyen_pct')
      if (p == null || b <= 0) continue
      poids += b
      cumul += p * b
    }
    return poids > 0 ? cumul / poids : null
  }, [parFournisseur])

  /* Les autorisations, toutes categories confondues. Le delai moyen se pondere
     par le nombre de demandes tranchees ; le taux de refus se rapporte aux
     seules demandes tranchees, comme dans la vue. */
  const auto = useMemo(() => {
    let attente = 0
    let accordees = 0
    let refusees = 0
    let delaiPoids = 0
    let delaiCumul = 0
    for (const a of autorisations) {
      attente += nb(a, 'en_attente') ?? 0
      const ac = nb(a, 'accordees') ?? 0
      const re = nb(a, 'refusees') ?? 0
      accordees += ac
      refusees += re
      const dm = nb(a, 'delai_moyen_h')
      if (dm != null && ac + re > 0) {
        delaiPoids += ac + re
        delaiCumul += dm * (ac + re)
      }
    }
    return {
      attente,
      tranchees: accordees + refusees,
      delai: delaiPoids > 0 ? delaiCumul / delaiPoids : null,
      refus: accordees + refusees > 0 ? (100 * refusees) / (accordees + refusees) : null,
    }
  }, [autorisations])

  if (categories.length === 0 && parFournisseur.length === 0 && autorisations.length === 0 && suivi.length === 0) {
    return (
      <Alerte ton="info" titre="Aucun lot suivi pour l'instant">
        Le registre des lots se remplit avec les réceptions et les mouvements. Les statistiques
        apparaîtront dès qu'un lot portera du stock ou qu'une bobine aura été pesée.
      </Alerte>
    )
  }

  const tolerance = `vert jusqu'à ${fmt.nombre(t.orange, 1)} %, orange jusqu'à ${fmt.nombre(t.rouge, 1)} %, rouge au-delà`

  return (
    <div className="space-y-4">
      {/* ---- 1. OU EST LE STOCK ------------------------------------------ */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <CarteStat
          Icone={Package}
          libelle="Stock Projet"
          valeur={fmt.compact(kg.projet)}
          unite="kg"
          ton="primaire"
          precision={voitValeur ? `${fmt.compact(mad.projet)} MAD — compte pour le plan` : 'compte pour le plan'}
          surClic={() => naviguer('/lots?vue=projet')}
        />
        <CarteStat
          Icone={Hourglass}
          libelle="Restes"
          valeur={fmt.compact(kg.restes)}
          unite="kg"
          ton={kg.restes > 0 ? 'alerte' : 'neutre'}
          precision={
            nbABasculer > 0
              ? `${nbABasculer} lot${nbABasculer > 1 ? 's' : ''} à basculer en Restes`
              : voitValeur
                ? `${fmt.compact(mad.restes)} MAD à écouler`
                : 'à écouler'
          }
          surClic={() => naviguer(nbABasculer > 0 ? '/lots?vue=a_basculer' : '/lots?vue=restes')}
        />
        <CarteStat
          Icone={Ban}
          libelle="Bloqué qualité"
          valeur={fmt.compact(kg.bloque)}
          unite="kg"
          ton={kg.bloque > 0 ? 'danger' : 'succes'}
          precision={`${fmt.entier(nb(cockpit, 'lots_bloques') ?? 0)} lot(s) en attente de décision`}
          surClic={() => naviguer('/lots?vue=bloques')}
        />
        <CarteStat
          Icone={Moon}
          libelle="Dormant"
          valeur={fmt.compact(kg.dormant)}
          unite="kg"
          ton={kg.dormant > 0 ? 'alerte' : 'succes'}
          precision={`${fmt.entier(nb(cockpit, 'lots_dormants') ?? 0)} lot(s) sans activité`}
          surClic={() => naviguer('/lots?vue=dormants')}
        />
      </div>

      <Carte repliable="statistiques.lots.repartition">
        <CarteEntete>
          <CarteTitre>Répartition du stock par lot</CarteTitre>
          <span className="text-[11px] text-attenue-texte">
            {fmt.entier(nbLots)} lots portent {fmt.nombre(kg.total, 0)} kg
            {voitValeur ? ` — ${fmt.nombre(mad.total, 0)} MAD` : ''}
          </span>
        </CarteEntete>
        <CarteCorps className="space-y-3">
          <BarreRepartition
            parts={[
              { libelle: 'Projet (kg)', valeur: Math.round(kg.projet), ton: 'primaire' },
              { libelle: 'Restes (kg)', valeur: Math.round(kg.restes), ton: 'alerte' },
              { libelle: 'Bloqué (kg)', valeur: Math.round(kg.bloque), ton: 'danger' },
              { libelle: 'Dormant (kg)', valeur: Math.round(kg.dormant), ton: 'neutre' },
            ]}
          />
          {voitValeur && (
            <p className="text-[12px] text-attenue-texte">
              Valeur : Projet <strong className="text-texte">{fmt.nombre(mad.projet, 0)} MAD</strong>
              {' · '}Restes <strong className="text-texte">{fmt.nombre(mad.restes, 0)} MAD</strong>
              {' · '}bloqué ou dormant{' '}
              <strong className="text-texte">
                {fmt.nombre(Math.max(0, mad.total - mad.projet - mad.restes), 0)} MAD
              </strong>
            </p>
          )}
          <p className="text-[11px] text-attenue-texte">
            Projet et Restes ne comptent que les lots libres et actifs ; un lot bloqué ou dormant
            n'est compté qu'une fois, dans sa colonne. La somme refait le stock comptable.
          </p>
        </CarteCorps>
      </Carte>

      {/* ---- 2. DEPUIS QUAND ---------------------------------------------- */}
      <AgesEmpiles ages={ages} />

      {/* ---- 3. LE POIDS DES BOBINES ---------------------------------------- */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <CarteStat
          Icone={Scale}
          libelle="Écart moyen par bobine"
          valeur={ecartGlobal == null ? '—' : `${ecartGlobal > 0 ? '+' : ''}${fmt.nombre(ecartGlobal, 2)}`}
          unite={ecartGlobal == null ? undefined : '%'}
          ton={
            couleurEcart(ecartGlobal, t) === 'rouge'
              ? 'danger'
              : couleurEcart(ecartGlobal, t) === 'orange'
                ? 'alerte'
                : ecartGlobal == null
                  ? 'neutre'
                  : 'succes'
          }
          precision="pondéré par les bobines pesées"
        />
        <CarteStat
          Icone={Scale}
          libelle="Lots en dérive de poids"
          valeur={fmt.entier(nb(cockpit, 'lots_en_derive') ?? 0)}
          ton={(nb(cockpit, 'lots_en_derive') ?? 0) > 0 ? 'alerte' : 'succes'}
          precision="écart cumulé hors tolérance"
          surClic={() => naviguer('/lots?vue=derive')}
        />
        <CarteStat
          Icone={ShieldCheck}
          libelle="Autorisations en attente"
          valeur={fmt.entier(auto.attente)}
          ton={auto.attente > 0 ? 'alerte' : 'succes'}
          precision={auto.delai == null ? 'aucune demande tranchée' : `délai moyen ${fmt.nombre(auto.delai, 1)} h`}
          surClic={() => naviguer('/autorisations')}
        />
        <CarteStat
          Icone={ShieldCheck}
          libelle="Taux de refus"
          valeur={auto.refus == null ? '—' : fmt.nombre(auto.refus, 1)}
          unite={auto.refus == null ? undefined : '%'}
          precision={`sur ${fmt.entier(auto.tranchees)} demande(s) tranchée(s)`}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {parFournisseur.length > 0 && (
          <BarresRangees
            titre="Écart de poids par bobine, par fournisseur"
            sousTitre={`écart moyen en valeur absolue — (+) plus lourd, (−) plus léger que le catalogue · ${tolerance}`}
            unite="% du poids catalogue"
            donnees={parFournisseur.map((f, i) => {
              const p = nb(f, 'ecart_moyen_pct') ?? 0
              const c = couleurEcart(p, t)
              return {
                cle: txt(f, 'code_fournisseur') ?? `sans-${i}`,
                libelle: `${txt(f, 'fournisseur_nom') ?? txt(f, 'code_fournisseur') ?? 'Fournisseur inconnu'} (${p > 0 ? '+' : p < 0 ? '−' : '='})`,
                valeur: Math.abs(p),
                etat: c ? ETAT_GRAPHIQUE[c] : undefined,
              }
            })}
          />
        )}
        {parMois.length > 1 && (
          <ColonnesTemps
            titre="Écart de poids par bobine, mois par mois"
            sousTitre={`écart moyen en valeur absolue · ${tolerance}`}
            unite="% du poids catalogue"
            donnees={parMois.map((m) => {
              const cle = txt(m, 'mois') ?? ''
              const p = nb(m, 'ecart_moyen_pct') ?? 0
              const c = couleurEcart(p, t)
              return {
                cle,
                libelle: cle.length === 7 ? `${cle.slice(5)}/${cle.slice(2, 4)}` : cle,
                valeur: Math.abs(p),
                etat: c ? ETAT_GRAPHIQUE[c] : undefined,
              }
            })}
          />
        )}
      </div>

      {parArticle.length > 0 && (
        <Carte repliable="statistiques.lots.articles">
          <CarteEntete>
            <CarteTitre>Les articles les plus divergents</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              poids catalogue d'une bobine face au poids réel moyen pesé
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-[13px] lg:min-w-0">
                <thead>
                  <tr className="border-b border-bordure">
                    <th className={cn(TH, 'px-3 text-left')}>Article</th>
                    <th className={cn(TH, 'text-left')}>Fournisseur</th>
                    <th className={cn(TH, 'w-20 text-right')}>Lignes</th>
                    <th className={cn(TH, 'w-24 text-right')}>Bobines</th>
                    <th className={cn(TH, 'w-28 text-right')}>Catalogue</th>
                    <th className={cn(TH, 'w-28 text-right')}>Réel moyen</th>
                    <th className={cn(TH, 'w-24 text-right')}>Écart</th>
                    <th className={cn(TH, 'w-28 text-right')}>Écart kg</th>
                  </tr>
                </thead>
                <tbody>
                  {parArticle.slice(0, 15).map((a, i) => (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="max-w-64 px-3 py-1.5">
                        <div className="truncate font-medium">{txt(a, 'code_reference')}</div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {txt(a, 'designation')}
                        </div>
                      </td>
                      <td className="max-w-48 truncate px-2 py-1.5">
                        {txt(a, 'fournisseur_nom') ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(a, 'nb_lignes') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(a, 'bobines') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(a, 'poids_catalogue_kg') == null
                          ? '—'
                          : `${fmt.nombre(nb(a, 'poids_catalogue_kg'), 3)} kg`}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(a, 'poids_reel_moyen_kg') == null
                          ? '—'
                          : `${fmt.nombre(nb(a, 'poids_reel_moyen_kg'), 3)} kg`}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Ecart pct={nb(a, 'ecart_moyen_pct')} t={t} />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(a, 'ecart_kg') ?? 0, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parArticle.length > 15 && (
              <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                Les 15 articles les plus divergents, sur {parArticle.length} pesés. L'état « Écart
                de poids par fournisseur » porte le détail imprimable.
              </p>
            )}
          </CarteCorps>
        </Carte>
      )}

      {derive.length > 0 && (
        <Carte repliable="statistiques.lots.derive">
          <CarteEntete>
            <CarteTitre>Dérive cumulée des lots, par fournisseur</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              l'écart cumulé d'un lot additionne toutes ses pesées depuis l'entrée
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[13px] lg:min-w-0">
                <thead>
                  <tr className="border-b border-bordure">
                    <th className={cn(TH, 'px-3 text-left')}>Fournisseur</th>
                    <th className={cn(TH, 'w-24 text-right')}>Lots pesés</th>
                    <th className={cn(TH, 'w-24 text-right')}>Orange</th>
                    <th className={cn(TH, 'w-24 text-right')}>Rouge</th>
                    <th className={cn(TH, 'w-32 text-right')}>Écart cumulé</th>
                    <th className={cn(TH, 'w-28 text-right')}>Écart moyen</th>
                  </tr>
                </thead>
                <tbody>
                  {derive.map((f, i) => {
                    const orange = nb(f, 'lots_orange') ?? 0
                    const rouges = nb(f, 'lots_rouges') ?? 0
                    return (
                      <tr key={i} className="border-b border-bordure/60">
                        <td className="max-w-64 px-3 py-1.5">
                          <div className="truncate font-medium">
                            {txt(f, 'fournisseur_nom') ?? 'Fournisseur inconnu'}
                          </div>
                          <div className="truncate text-[11px] text-attenue-texte">
                            {txt(f, 'code_fournisseur')}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt.entier(nb(f, 'nb_lots') ?? 0)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {orange > 0 ? <Badge ton="alerte">{orange}</Badge> : <span className="text-attenue-texte">0</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {rouges > 0 ? <Badge ton="danger">{rouges}</Badge> : <span className="text-attenue-texte">0</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt.nombre(nb(f, 'ecart_cumule_kg') ?? 0, 1)} kg
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Ecart pct={nb(f, 'ecart_moyen_pct')} t={t} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CarteCorps>
        </Carte>
      )}

      {/* ---- 4. LES AUTORISATIONS ------------------------------------------- */}
      {autorisations.length > 0 && (
        <Carte repliable="statistiques.lots.autorisations">
          <CarteEntete>
            <CarteTitre>Suivi des autorisations</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              le délai court de la demande à la décision ; le refus se rapporte aux demandes tranchées
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-[13px] lg:min-w-0">
                <thead>
                  <tr className="border-b border-bordure">
                    <th className={cn(TH, 'px-3 text-left')}>Demande</th>
                    <th className={cn(TH, 'w-24 text-left')}>Niveau</th>
                    <th className={cn(TH, 'w-20 text-right')}>Total</th>
                    <th className={cn(TH, 'w-24 text-right')}>En attente</th>
                    <th className={cn(TH, 'w-24 text-right')}>Accordées</th>
                    <th className={cn(TH, 'w-24 text-right')}>Refusées</th>
                    <th className={cn(TH, 'w-28 text-right')}>Délai moyen</th>
                    <th className={cn(TH, 'w-24 text-right')}>Refus</th>
                  </tr>
                </thead>
                <tbody>
                  {autorisations.map((a, i) => {
                    const type = txt(a, 'type_demande') ?? ''
                    const niveau = txt(a, 'niveau')
                    const attente = nb(a, 'en_attente') ?? 0
                    return (
                      <tr key={i} className="border-b border-bordure/60">
                        <td className="px-3 py-1.5">{LIBELLE_DEMANDE[type] ?? type}</td>
                        <td className="px-2 py-1.5">
                          {niveau && (
                            <Badge ton={niveau === 'ROUGE' ? 'danger' : 'alerte'}>
                              {niveau === 'ROUGE' ? 'rouge' : 'orange'}
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt.entier(nb(a, 'total') ?? 0)}
                        </td>
                        <td className={cn('px-2 py-1.5 text-right tabular-nums', attente > 0 && 'font-medium text-alerte')}>
                          {fmt.entier(attente)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-succes">
                          {fmt.entier(nb(a, 'accordees') ?? 0)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-danger">
                          {fmt.entier(nb(a, 'refusees') ?? 0)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {nb(a, 'delai_moyen_h') == null ? '—' : `${fmt.nombre(nb(a, 'delai_moyen_h'), 1)} h`}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {nb(a, 'taux_refus_pct') == null ? '—' : `${fmt.nombre(nb(a, 'taux_refus_pct'), 1)} %`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CarteCorps>
        </Carte>
      )}

      {/* ---- 5. POIDS, COLISAGE ET PRIX A CHAQUE RECEPTION ----------------- */}
      {evaluation.length > 0 && (
        <Carte repliable="statistiques.lots.evaluation">
          <CarteEntete>
            <CarteTitre>Évaluation des fournisseurs : poids, colisage, prix</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              chaque réception mesure le poids d’une bobine et les bobines par palette, et met la fiche à jour
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-[13px] lg:min-w-0">
                <thead>
                  <tr className="border-b border-bordure">
                    <th className={cn(TH, 'px-3 text-left')}>Fournisseur</th>
                    <th className={cn(TH, 'w-24 text-right')}>Réceptions</th>
                    <th className={cn(TH, 'w-24 text-right')}>Articles</th>
                    <th className={cn(TH, 'w-32 text-right')}>Variation poids</th>
                    <th className={cn(TH, 'w-28 text-right')}>Hors tolérance</th>
                    <th className={cn(TH, 'w-28 text-right')}>Colisage changé</th>
                    <th className={cn(TH, 'w-32 text-right')}>Variation prix</th>
                    <th className={cn(TH, 'w-24 text-right')}>Hausses</th>
                    <th className={cn(TH, 'w-28 text-right')}>Mesures écartées</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.map((e, i) => {
                    const prix = nb(e, 'variation_prix_moyenne_pct')
                    return (
                      <tr key={i} className="border-b border-bordure/60">
                        <td className="px-3 py-1.5">{txt(e, 'fournisseur_nom') ?? txt(e, 'code_fournisseur') ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt.entier(nb(e, 'nb_receptions') ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt.entier(nb(e, 'nb_references') ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Ecart pct={nb(e, 'variation_poids_moyenne_pct')} t={t} />
                        </td>
                        <td className={cn('px-2 py-1.5 text-right tabular-nums', (nb(e, 'poids_hors_tolerance') ?? 0) > 0 && 'text-alerte')}>
                          {fmt.entier(nb(e, 'poids_hors_tolerance') ?? 0)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt.entier(nb(e, 'colisages_changes') ?? 0)}</td>
                        <td className={cn('px-2 py-1.5 text-right tabular-nums', prix != null && prix > 0 ? 'text-danger' : prix != null && prix < 0 ? 'text-succes' : '')}>
                          {prix == null ? '—' : `${prix > 0 ? '+' : ''}${fmt.nombre(prix, 2)} %`}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt.entier(nb(e, 'hausses_prix') ?? 0)}</td>
                        <td className={cn('px-2 py-1.5 text-right tabular-nums', (nb(e, 'mesures_ecartees') ?? 0) > 0 && 'text-danger')}>
                          {fmt.entier(nb(e, 'mesures_ecartees') ?? 0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CarteCorps>
        </Carte>
      )}

      {suivi.length > 0 && (
        <Carte repliable="statistiques.lots.suivi" replieParDefaut>
          <CarteEntete>
            <CarteTitre>Suivi réception par réception</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              la fiche avant la livraison, la mesure de la livraison ; une mesure à plus de 50 % de la fiche est
              gardée mais écartée
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-[13px] lg:min-w-0">
                <thead>
                  <tr className="border-b border-bordure">
                    <th className={cn(TH, 'w-24 px-3 text-left')}>Date</th>
                    <th className={cn(TH, 'w-32 text-left')}>Réception</th>
                    <th className={cn(TH, 'text-left')}>Article</th>
                    <th className={cn(TH, 'w-40 text-right')}>Poids / bobine</th>
                    <th className={cn(TH, 'w-32 text-right')}>Bobines / palette</th>
                    <th className={cn(TH, 'w-40 text-right')}>Prix au kilo</th>
                  </tr>
                </thead>
                <tbody>
                  {suivi.map((h, i) => {
                    const mesure = nb(h, 'poids_bobine_mesure')
                    const ecarte = mesure != null && nb(h, 'poids_applique') === 0
                    const bpo = nb(h, 'bobines_palette_observe')
                    const prix = nb(h, 'prix_kg_devise')
                    const vp = nb(h, 'variation_prix_pct')
                    return (
                      <tr key={i} className="border-b border-bordure/60">
                        <td className="px-3 py-1.5 tabular-nums">{fmt.date(txt(h, 'date_evenement'))}</td>
                        <td className="px-2 py-1.5 text-[12px]">
                          {txt(h, 'numero_document') ?? '—'}
                          <div className="text-[10.5px] text-attenue-texte">{txt(h, 'fournisseur_nom') ?? ''}</div>
                        </td>
                        <td className="px-2 py-1.5">{txt(h, 'code_reference')}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {mesure == null ? (
                            <span className="text-attenue-texte">non pesé en bobines</span>
                          ) : (
                            <>
                              <span className={cn(ecarte && 'text-danger line-through')}>{fmt.nombre(mesure, 3)} kg</span>
                              <div className="text-[10.5px]">
                                {ecarte ? (
                                  <span className="text-danger">écartée — fiche à {fmt.nombre(nb(h, 'poids_bobine_avant'), 3)}</span>
                                ) : nb(h, 'poids_bobine_avant') == null ? (
                                  <span className="text-attenue-texte">premier poids</span>
                                ) : (
                                  <span className="text-attenue-texte">
                                    fiche {fmt.nombre(nb(h, 'poids_bobine_avant'), 3)} ·{' '}
                                    <Ecart pct={nb(h, 'variation_poids_pct')} t={t} />
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {bpo == null ? (
                            <span className="text-attenue-texte">—</span>
                          ) : (
                            <>
                              {fmt.entier(bpo)}
                              {nb(h, 'bobines_palette_avant') != null && bpo !== nb(h, 'bobines_palette_avant') && (
                                <div className="text-[10.5px] text-alerte">
                                  avant {fmt.entier(nb(h, 'bobines_palette_avant') ?? 0)}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {prix == null ? (
                            '—'
                          ) : (
                            <>
                              {fmt.nombre(prix, 3)} <span className="text-[11px] text-attenue-texte">{txt(h, 'code_devise')}</span>
                              {vp != null && vp !== 0 && (
                                <div className={cn('text-[10.5px]', vp > 0 ? 'text-danger' : 'text-succes')}>
                                  {vp > 0 ? '+' : ''}{fmt.nombre(vp, 2)} % sur la précédente
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CarteCorps>
        </Carte>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* L'age des lots                                                              */
/* -------------------------------------------------------------------------- */

/**
 * L'AGE SE LIT DANS L'ORDRE DES TRANCHES. `BarresEmpilees` trie ses barres par
 * total, ce qui convient a des fournisseurs et pas a des ages : « plus d'un
 * an » se retrouverait entre « 0-90 j » et « 90-180 j ». Meme dessin, meme
 * teintes de serie, mais l'ordre est celui du temps.
 */
function AgesEmpiles({ ages }: { ages: Ligne[] }) {
  const tranches = useMemo(() => {
    const par = new Map<string, { ordre: number; projet: number; restes: number; lots: number }>()
    for (const a of ages) {
      const cle = txt(a, 'tranche') ?? '—'
      const tr = par.get(cle) ?? { ordre: nb(a, 'ordre') ?? 9, projet: 0, restes: 0, lots: 0 }
      const kg = nb(a, 'kg') ?? 0
      if (txt(a, 'categorie') === 'RESTES') tr.restes += kg
      else tr.projet += kg
      tr.lots += nb(a, 'nb_lots') ?? 0
      par.set(cle, tr)
    }
    return [...par.entries()].sort((x, y) => x[1].ordre - y[1].ordre)
  }, [ages])

  if (tranches.length === 0) return null
  const echelle = Math.max(...tranches.map(([, v]) => v.projet + v.restes), 0) || 1
  const series = [
    { cle: 'projet' as const, libelle: 'Projet', couleur: 'var(--viz-serie-1)' },
    { cle: 'restes' as const, libelle: 'Restes', couleur: 'var(--viz-serie-2)' },
  ]

  return (
    <figure
      className="viz m-0 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-bordure
                 bg-surface p-4 shadow-[var(--ombre-pose)]"
    >
      <figcaption>
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-texte">
          Âge des lots qui portent du stock
        </h3>
        <p className="mt-0.5 text-[11.5px] leading-snug text-attenue-texte">
          depuis la création du lot, en kilos — Projet et Restes
        </p>
      </figcaption>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <li key={s.cle} className="flex items-center gap-1.5 text-[11.5px] text-attenue-texte">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: s.couleur }} />
            {s.libelle}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-[5px]">
        {tranches.map(([cle, v]) => (
          <div key={cle} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-2.5">
            <span className="truncate text-[11.5px] text-attenue-texte">
              {cle} <span className="text-[10.5px]">· {v.lots} lot{v.lots > 1 ? 's' : ''}</span>
            </span>
            <div className="flex items-center gap-2.5">
              <div className="flex h-4 min-w-0 flex-1 gap-[2px]">
                {series.map((s) => {
                  const val = v[s.cle]
                  if (val <= 0) return null
                  return (
                    <div
                      key={s.cle}
                      className="h-full first:rounded-l-[2px] last:rounded-r-[4px]"
                      style={{ width: `${(val / echelle) * 100}%`, background: s.couleur }}
                      title={`${s.libelle} : ${fmt.nombre(val, 0)} kg`}
                    />
                  )
                })}
              </div>
              <span className="w-20 shrink-0 text-right text-[11.5px] font-medium tabular-nums text-texte">
                {fmt.nombre(v.projet + v.restes, 0)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-right text-[10px] text-attenue-texte">kg</p>
    </figure>
  )
}

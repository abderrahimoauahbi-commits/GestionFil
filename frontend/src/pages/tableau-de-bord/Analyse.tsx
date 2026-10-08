/**
 * Tableau de bord — Analyse (06/10/2026).
 *
 * Ce que disent les chiffres : la concentration de la dépense (Pareto), la
 * dépense par fournisseur, le coût matière dans le temps, la distribution des
 * couvertures, les classes ABC croisées au statut, le cycle de trésorerie, les
 * lots, puis la concentration et les dépendances. Mêmes données que l'ancienne
 * vue « Analytique », dessinées avec les graphiques en dégradé.
 */
import { useQuery } from '@tanstack/react-query'
import { Coins, Gauge, Landmark, Package, RefreshCcw, Scale, Truck } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { CarteStat } from '../../composants/CarteStat'
import { Squelette } from '../../composants/ui/base'
import { BarresClassees, Colonnes, CourbesTemps, ParetoDegrade, TON, compact } from '../../composants/graphiques/Visuels'
import { couleurEcart, useTolerancesLot } from '../../lib/lots'
import { cn, fmt } from '../../lib/utils'
import { Concentration } from '../Cockpit'
import { OngletsTableauDeBord } from './Onglets'
import { Bloc, EnPanne, Vide, libelleMois } from './commun'

interface Analyse {
  couverture: { rang: number; libelle: string; nb_references: number }[]
  cout_mensuel: { annee_mois: string; quantite_kg: number; cout_mad: number }[]
  pareto: { code_reference: string; classe_abc: string | null; valeur_conso_annuelle_mad: number; rang: number; pct_cumule: number }[]
  fournisseurs: { fournisseur_nom: string; nb_references: number; budget_annuel_mad: number }[]
  abc_statut: { classe_abc: string; en_alerte: number; attention: number; ok: number }[]
  tresorerie?: {
    valeur_stock_mad: number
    cout_matiere_annuel_mad: number
    dio_jours: number
    dso_jours: number
    dpo_jours: number
    ccc_jours: number
    rotation_annuelle: number
  }
  indicateurs?: {
    couverture_ponderee_jours: number | null
    ecart_pesee_moyen_pct: number | null
    valeur_dormante_mad?: number
    pct_valeur_dormante?: number | null
    nb_classe_a: number
    nb_classe_b: number
    nb_classe_c: number
    nb_non_classees: number
  }
}

/** Un indicateur dans un panneau : libellé, valeur, unité. */
function Tuile({ libelle, valeur, unite, ton, aide }: { libelle: string; valeur: string; unite?: string; ton?: 'danger' | 'alerte' | 'succes'; aide?: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] bg-attenue/60 px-3 py-2.5" title={aide}>
      <div className="truncate text-[11px] text-attenue-texte">{libelle}</div>
      <div className={cn('mt-0.5 truncate text-[18px] font-semibold tabular-nums', ton === 'danger' ? 'text-danger' : ton === 'alerte' ? 'text-alerte' : ton === 'succes' ? 'text-succes' : 'text-texte')}>
        {valeur}
        {unite && <span className="ml-1 text-[11px] font-normal text-attenue-texte">{unite}</span>}
      </div>
    </div>
  )
}

export function AnalyseTableau() {
  const droits = useDroits('COCKPIT')
  const { peut } = useAuth()
  const lisStock = peut('STOCK', 'LIRE')
  const q = useQuery({ queryKey: ['cockpit-analyse'], queryFn: () => api.get<Analyse>('/api/cockpit/analyse') })
  const qc = useQuery({ queryKey: ['cockpit'], queryFn: () => api.get<Record<string, unknown>>('/api/cockpit') })
  const ql = useQuery({ queryKey: ['stats', 'lots'], queryFn: () => api.get<Record<string, unknown>>('/api/stats/lots'), enabled: lisStock })
  const tolerances = useTolerancesLot()

  const d = q.data
  const t = d?.tresorerie
  const ind = d?.indicateurs
  const k = qc.data ?? {}
  const n = (c: string) => Number(k[c] ?? 0)
  const voitMontants = droits.visible('valeur_stock_mad')

  const lots = (ql.data?.cockpit ?? null) as Record<string, number | null> | null
  const nlot = (c: string) => Number(lots?.[c] ?? 0)
  const ecartBobine = (() => {
    const f = Array.isArray(ql.data?.divergence_fournisseur) ? (ql.data.divergence_fournisseur as Record<string, number | null>[]) : []
    let poids = 0
    let cumul = 0
    for (const l of f) {
      const b = Number(l.bobines ?? 0)
      if (l.ecart_moyen_pct == null || b <= 0) continue
      poids += b
      cumul += Number(l.ecart_moyen_pct) * b
    }
    return poids > 0 ? cumul / poids : null
  })()
  const tonEcart = couleurEcart(ecartBobine, tolerances)

  return (
    <div className="space-y-4">
      <EnTetePage titre="Tableau de bord" description="Analyse — où va l'argent, comment tourne le stock, ce que coûte la matière." />
      <OngletsTableauDeBord />

      {q.isError ? (
        <EnPanne quoi="Analyse" />
      ) : q.isLoading || !d ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Squelette key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          {/* ---- Chiffres clés ------------------------------------------------ */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <CarteStat Icone={Package} libelle="Valeur du stock" valeur={voitMontants && t ? compact(t.valeur_stock_mad) : '—'} unite="MAD" precision={`${n('nb_references')} références suivies`} ton="primaire" courbe={voitMontants && d.cout_mensuel.length >= 3 ? d.cout_mensuel.map((m) => m.cout_mad) : undefined} />
            <CarteStat Icone={Gauge} libelle="Couverture pondérée" valeur={ind?.couverture_ponderee_jours == null ? '—' : fmt.nombre(ind.couverture_ponderee_jours, 0)} unite="jours" precision="pondérée par la valeur consommée" ton="succes" />
            <CarteStat Icone={RefreshCcw} libelle="Rotation du stock" valeur={t ? fmt.nombre(t.rotation_annuelle, 1) : '—'} unite="× / an" precision={t ? `DIO ${fmt.nombre(t.dio_jours, 0)} jours` : undefined} ton={t && t.rotation_annuelle < 1 ? 'alerte' : 'neutre'} />
            <CarteStat Icone={Scale} libelle="Écart de pesée moyen" valeur={ind?.ecart_pesee_moyen_pct == null ? '—' : fmt.nombre(ind.ecart_pesee_moyen_pct, 2)} unite="%" precision="facturé face au pesé" ton="neutre" />
            <CarteStat Icone={Truck} libelle="Fournisseurs actifs" valeur={String(n('nb_fournisseurs_actifs'))} precision={`${n('nb_bc_ouverts')} bons ouverts`} ton="neutre" />
            <CarteStat Icone={Coins} libelle="Stock dormant" valeur={voitMontants && ind?.valeur_dormante_mad != null ? compact(ind.valeur_dormante_mad) : '—'} unite="MAD" precision={ind?.pct_valeur_dormante == null ? `${n('nb_refs_dormantes')} références` : `${fmt.nombre(ind.pct_valeur_dormante, 1)} % du stock`} ton={(ind?.pct_valeur_dormante ?? 0) > 5 ? 'alerte' : 'succes'} />
          </div>

          {/* ---- Pareto | Fournisseurs ------------------------------------------- */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Bloc className="xl:col-span-2" titre="Concentration de la dépense" sousTitre={`Les ${d.pareto.length} références qui portent le budget, et la part cumulée — la ligne des 80 % marque la classe A`} lien={{ vers: '/classification', libelle: 'ABC / XYZ' }}>
              {d.pareto.length === 0 ? (
                <Vide texte="Classification non calculée." />
              ) : !voitMontants ? (
                <Vide texte="Montants réservés aux rôles qui voient la valeur du stock." />
              ) : (
                <ParetoDegrade
                  donnees={d.pareto.map((p) => ({ cle: p.code_reference, libelle: p.code_reference, valeur: p.valeur_conso_annuelle_mad, cumulPct: p.pct_cumule, classe: p.classe_abc }))}
                />
              )}
            </Bloc>
            <Bloc titre="Budget par fournisseur" sousTitre="Consommation annuelle valorisée au CMUP" lien={{ vers: '/fournisseurs', libelle: 'Fournisseurs' }}>
              {voitMontants ? (
                <BarresClassees
                  donnees={d.fournisseurs.slice(0, 8).map((f, i) => ({ cle: f.fournisseur_nom + i, libelle: f.fournisseur_nom, detail: `${f.nb_references} réf.`, valeur: f.budget_annuel_mad }))}
                  format={(v) => `${compact(v)} MAD`}
                />
              ) : (
                <Vide texte="Montants réservés aux rôles qui voient la valeur du stock." />
              )}
            </Bloc>
          </div>

          {/* ---- Coût matière | Couvertures --------------------------------------- */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Bloc className="xl:col-span-2" titre="Coût matière par mois" sousTitre="Ce que coûte la matière consommée, valorisée au CMUP">
              {d.cout_mensuel.length === 0 ? (
                <Vide texte="Pas encore de consommation enregistrée." />
              ) : !voitMontants ? (
                <Vide texte="Montants réservés aux rôles qui voient la valeur du stock." />
              ) : (
                <CourbesTemps
                  libelles={d.cout_mensuel.map((m) => libelleMois(m.annee_mois))}
                  unite="MAD"
                  series={[{ cle: 'c', libelle: 'Coût matière', valeurs: d.cout_mensuel.map((m) => m.cout_mad) }]}
                />
              )}
            </Bloc>
            <Bloc titre="Distribution des couvertures" sousTitre="Combien de références dans chaque tranche de jours">
              <Colonnes
                hauteur={220}
                libelles={[...d.couverture].sort((a, b) => a.rang - b.rang).map((c) => c.libelle)}
                unite="références"
                series={[{ cle: 'n', libelle: 'Références', valeurs: [...d.couverture].sort((a, b) => a.rang - b.rang).map((c) => c.nb_references), couleur: TON.secondaire }]}
              />
            </Bloc>
          </div>

          {/* ---- ABC | Trésorerie | Lots ----------------------------------------- */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Bloc titre="Classes ABC croisées au statut" sousTitre={`A ${ind?.nb_classe_a ?? 0} · B ${ind?.nb_classe_b ?? 0} · C ${ind?.nb_classe_c ?? 0} · non classées ${ind?.nb_non_classees ?? 0}`}>
              <Colonnes
                empilees
                hauteur={200}
                libelles={d.abc_statut.map((x) => `Classe ${x.classe_abc}`)}
                series={[
                  { cle: 'ok', libelle: 'Au vert', valeurs: d.abc_statut.map((x) => x.ok), couleur: TON.succes },
                  { cle: 'at', libelle: 'Attention', valeurs: d.abc_statut.map((x) => x.attention), couleur: TON.alerte },
                  { cle: 'al', libelle: 'En alerte', valeurs: d.abc_statut.map((x) => x.en_alerte), couleur: TON.danger },
                ]}
              />
            </Bloc>

            {voitMontants && t && (
              <Bloc titre="Cycle de trésorerie" sousTitre="Combien de jours l'argent reste immobilisé dans la matière">
                <div className="grid grid-cols-2 gap-2">
                  <Tuile libelle="Stock immobilisé" valeur={compact(t.valeur_stock_mad)} unite="MAD" />
                  <Tuile libelle="Coût matière annuel" valeur={compact(t.cout_matiere_annuel_mad)} unite="MAD" />
                  <Tuile libelle="Stock en jours (DIO)" valeur={fmt.nombre(t.dio_jours, 0)} unite="j" ton={t.dio_jours > 180 ? 'alerte' : undefined} />
                  <Tuile libelle="Délai fournisseur (DPO)" valeur={fmt.nombre(t.dpo_jours, 0)} unite="j" />
                  <Tuile libelle="Matière par mois" valeur={compact(t.cout_matiere_annuel_mad / 12)} unite="MAD" />
                  <Tuile libelle="Cycle (CCC)" valeur={fmt.nombre(t.ccc_jours, 0)} unite="j" ton={t.ccc_jours > 90 ? 'danger' : t.ccc_jours > 0 ? 'alerte' : 'succes'} aide="DIO + DSO − DPO. Négatif, le fournisseur finance le cycle." />
                </div>
              </Bloc>
            )}

            {lisStock && lots && (
              <Bloc titre="Lots" sousTitre="Où est le stock, et ce que pèsent les bobines" lien={{ vers: '/lots', libelle: 'Lots' }}>
                <div className="grid grid-cols-2 gap-2">
                  <Tuile libelle="Stock Projet" valeur={fmt.nombre(nlot('projet_kg'), 0)} unite="kg" aide="Lots libres de catégorie Projet : ce qui compte pour le plan d'achat." />
                  <Tuile libelle="Restes" valeur={fmt.nombre(nlot('restes_kg'), 0)} unite="kg" ton={nlot('lots_a_basculer') > 0 ? 'alerte' : undefined} />
                  <Tuile libelle="Lots en dérive" valeur={fmt.nombre(nlot('lots_en_derive'), 0)} ton={nlot('lots_en_derive') > 0 ? 'alerte' : 'succes'} />
                  <Tuile
                    libelle="Écart moyen par bobine"
                    valeur={ecartBobine == null ? '—' : `${ecartBobine > 0 ? '+' : ''}${fmt.nombre(ecartBobine, 2)}`}
                    unite={ecartBobine == null ? undefined : '%'}
                    ton={tonEcart === 'rouge' ? 'danger' : tonEcart === 'orange' ? 'alerte' : tonEcart === 'vert' ? 'succes' : undefined}
                    aide="Poids pesé face au poids catalogue d'une bobine, pondéré par les bobines pesées."
                  />
                </div>
              </Bloc>
            )}
          </div>
        </>
      )}

      {/* ---- Concentration et dépendances -------------------------------------- */}
      <Bloc titre="Concentration et dépendances" sousTitre="Fournisseurs, poids dans le budget et fiabilité" corpsSansMarge>
        <div className="p-4">
          <Concentration />
        </div>
      </Bloc>
      <p className="flex items-center gap-1.5 pb-2 text-[11px] text-attenue-texte">
        <Landmark className="size-3" /> Montants en MAD, valorisés au CMUP.
      </p>
    </div>
  )
}

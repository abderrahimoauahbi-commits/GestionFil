/**
 * Les zones du cockpit reprises du classeur.
 *
 * Le classeur organise son poste de pilotage en six zones, dans un ordre qui
 * n'est pas decoratif : on lit d'abord ce qui brule (zone 1), puis ce qu'il
 * faut commander (zone 2), puis ce qu'on pourrait economiser (zone 4), puis
 * l'etat financier (zone 5), puis les fragilites de fond (zone 6). Cet ordre
 * est conserve tel quel — c'est celui dans lequel un acheteur decide.
 *
 * TOUT EST AGREGE PAR LE SERVEUR. Croiser 124 references par 12 mois et par
 * classe dans le navigateur demanderait de descendre toute la base a chaque
 * ouverture. Les vues `v_cockpit_*` font le calcul, l'ecran dispose.
 */
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Coins, Landmark, Layers, Package, ShoppingCart, Truck } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import {
  BarresEmpilees,
  BarresRangees,
  ColonnesTemps,
  Pareto,
  type BarrePareto,
} from '../composants/graphiques/Graphiques'
import { Alerte, Carte, CarteCorps, CarteEntete, CarteTitre, Squelette } from '../composants/ui/base'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'

const MODULE = 'COCKPIT'

interface Analyse {
  couverture: { rang: number; libelle: string; nb_references: number }[]
  cout_mensuel: { annee_mois: string; quantite_kg: number; cout_mad: number }[]
  economies: {
    code_reference: string
    designation: string | null
    fournisseur_actuel: string | null
    prix_actuel_mad: number
    prix_min_mad: number
    fournisseur_alternatif: string | null
    economie_annuelle_mad: number
  }[]
  devises: { code_devise: string; nb_references: number; montant_mad: number; part_pct: number }[]
  mono_source: {
    code_reference: string
    fournisseur_nom: string | null
    delai_livraison_jours: number | null
    statut: string
    jours_couverture: number | null
    budget_annuel_mad: number
  }[]
  pareto: {
    code_reference: string
    designation: string | null
    classe_abc: string | null
    valeur_conso_annuelle_mad: number
    rang: number
    pct_cumule: number
  }[]
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
    dso_est_un_parametre: boolean
  }
  /** Zone 2 du classeur : les references en alerte, les plus urgentes d'abord. */
  alertes: {
    code_reference: string
    designation: string | null
    categorie_libelle: string | null
    couleur: string | null
    fournisseur_nom: string | null
    unite_catalogue: string | null
    stock_physique_net_kg: number | null
    conso_mensuelle_kg: number | null
    jours_couverture: number | null
    delai_livraison_jours: number | null
    qte_a_commander_kg: number | null
    statut: string
  }[]
  /** Zone 5 du classeur : ce qui manquait aux blocs financiers. */
  indicateurs?: {
    nb_refs_en_alerte: number
    nb_classe_a: number
    nb_classe_b: number
    nb_classe_c: number
    nb_non_classees: number
    couverture_ponderee_jours: number | null
    ecart_pesee_moyen_pct: number | null
    economies_total_mad?: number
    nb_opportunites: number
    budget_ruptures_mad?: number
    valeur_dormante_mad?: number
    pct_valeur_dormante?: number | null
  }
}

const TON_STATUT: Record<string, string> = {
  RUPTURE: 'bg-danger/15 text-danger',
  CRITIQUE: 'bg-danger/10 text-danger',
  ATTENTION: 'bg-alerte/15 text-alerte',
}

/** Un indicateur : sa valeur, son libelle, et le mot qui dit l'unite. */
function Kpi({
  libelle,
  valeur,
  unite,
  ton,
  aide,
}: {
  libelle: string
  valeur: string
  unite?: string
  ton?: 'danger' | 'alerte' | 'succes'
  aide?: string
}) {
  return (
    <div className="min-w-0" title={aide}>
      <div className="truncate text-[11px] text-attenue-texte">{libelle}</div>
      <div
        className={cn(
          'truncate text-[17px] font-semibold tabular-nums',
          ton === 'danger' ? 'text-danger' : ton === 'alerte' ? 'text-alerte' : ton === 'succes' ? 'text-succes' : 'text-texte',
        )}
      >
        {valeur}
        {unite && <span className="ml-1 text-[11px] font-normal text-attenue-texte">{unite}</span>}
      </div>
    </div>
  )
}

function BlocKpi({
  titre,
  Icone,
  children,
}: {
  titre: string
  Icone: typeof Coins
  children: React.ReactNode
}) {
  return (
    <Carte>
      <CarteEntete>
        <CarteTitre className="flex items-center gap-1.5 text-[12px]">
          <Icone className="size-3.5" />
          {titre}
        </CarteTitre>
      </CarteEntete>
      <CarteCorps className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</CarteCorps>
    </Carte>
  )
}

export function CockpitAnalyse() {
  const droits = useDroits(MODULE)
  const q = useQuery({
    queryKey: ['cockpit-analyse'],
    queryFn: () => api.get<Analyse>('/api/cockpit/analyse'),
  })
  // Les compteurs du poste de travail : meme requete, meme cache que les chiffres cles.
  const qc = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<Record<string, number | string | null>>('/api/cockpit'),
  })

  if (q.isLoading) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Squelette key={i} className="h-56" />
        ))}
      </div>
    )
  }
  const d = q.data
  if (!d) return null

  // LE TOTAL DES ECONOMIES VIENT DU SERVEUR, sur toutes les opportunites : il
  // additionnait ici les vingt premieres lignes seulement.
  const ind = d.indicateurs
  const totalEconomies =
    ind?.economies_total_mad ?? d.economies.reduce((s, e) => s + e.economie_annuelle_mad, 0)
  const top5 = d.economies.slice(0, 5)
  const t = d.tresorerie
  const k = qc.data
  const n = (c: string) => Number(k?.[c] ?? 0)
  const voitMontants = droits.visible('valeur_stock_mad')

  const pareto: BarrePareto[] = d.pareto.map((p) => ({
    cle: p.code_reference,
    libelle: p.code_reference,
    valeur: p.valeur_conso_annuelle_mad,
    cumul: p.pct_cumule,
    classe: p.classe_abc,
  }))

  const rouges = n('nb_ruptures') + n('nb_critiques')

  return (
    <div className="flex flex-col gap-3">
      {/* ---- ZONE 1 — les constats du jour, en phrases ---------------------
          Le classeur ouvre sur quatre phrases avant tout chiffre : ce qui est
          rouge, ce qui est en attention, ce qu'on pourrait economiser, ce qui
          n'a qu'une source. */}
      <Carte>
        <CarteEntete>
          <CarteTitre className="text-[12px]">Constats du jour</CarteTitre>
        </CarteEntete>
        <CarteCorps className="flex flex-col gap-1 text-[13px]">
          <p className={rouges > 0 ? 'text-danger' : 'text-succes'}>
            {rouges > 0
              ? `${rouges} référence(s) en alerte rouge — ${n('nb_ruptures')} rupture(s), ${n('nb_critiques')} critique(s)`
              : 'Aucune rupture ni alerte critique'}
          </p>
          <p className={n('nb_attention') > 0 ? 'text-alerte' : 'text-attenue-texte'}>
            {n('nb_attention') > 0
              ? `${n('nb_attention')} référence(s) en attention — lancer la consultation sous 30 jours`
              : 'Aucune référence en attention'}
          </p>
          {voitMontants && ind && ind.nb_opportunites > 0 && (
            <p>
              {fmt.nombre(totalEconomies, 0)} MAD par an d’économies théoriques sur{' '}
              {ind.nb_opportunites} référence(s) — à valider avant de basculer
            </p>
          )}
          {d.mono_source.length > 0 && (
            <p className="text-alerte">
              {d.mono_source.length} référence(s) en tension sans seconde source chez un autre fournisseur
            </p>
          )}
        </CarteCorps>
      </Carte>

      {/* ---- ZONE 2 — les references en alerte, par ordre d'urgence -------- */}
      {d.alertes.length > 0 && (
        <Carte repliable="cockpit.alertes">
          <CarteEntete>
            <CarteTitre className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              Références en alerte — {d.alertes.length} plus urgentes
              {ind ? ` sur ${ind.nb_refs_en_alerte}` : ''}
            </CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="defilement-x">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Référence</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Catégorie</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Couleur</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Fournisseur</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Stock (kg)</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Conso / mois</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Couv. (j)</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Délai (j)</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">À commander (kg)</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {d.alertes.map((a) => (
                    <tr key={a.code_reference} className="hover:bg-attenue/60">
                      <td className="max-w-[240px] truncate px-2.5 py-1 font-mono text-[11px]">
                        {a.code_reference}
                      </td>
                      <td className="px-2.5 py-1">{a.categorie_libelle ?? '—'}</td>
                      <td className="px-2.5 py-1">{a.couleur ?? '—'}</td>
                      <td className="px-2.5 py-1">{a.fournisseur_nom ?? '—'}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(a.stock_physique_net_kg ?? 0, 0)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {a.conso_mensuelle_kg == null ? '—' : fmt.nombre(a.conso_mensuelle_kg, 0)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {a.jours_couverture == null ? '—' : fmt.nombre(a.jours_couverture, 0)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {a.delai_livraison_jours ?? '—'}
                      </td>
                      <td className="px-2.5 py-1 text-right font-medium tabular-nums">
                        {a.qte_a_commander_kg == null ? '—' : fmt.nombre(a.qte_a_commander_kg, 0)}
                      </td>
                      <td className="px-2.5 py-1">
                        <span className={cn('rounded-[3px] px-1.5 py-px text-[11px] font-medium', TON_STATUT[a.statut])}>
                          {a.statut}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
              Triées par couverture croissante : une couverture négative veut dire que les besoins
              du plan dépassent déjà le stock et les commandes. La liste complète est au plan d’achat.
            </p>
          </CarteCorps>
        </Carte>
      )}

      {/* ---- ZONE 5 — stock, achats, classification, stock dormant -------- */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BlocKpi titre="Stock" Icone={Package}>
          {voitMontants && t && (
            <Kpi libelle="Valeur du stock" valeur={fmt.nombre(t.valeur_stock_mad / 1e6, 2)} unite="M MAD" />
          )}
          <Kpi libelle="Références suivies" valeur={fmt.nombre(n('nb_references'), 0)} />
          <Kpi
            libelle="Couverture pondérée"
            valeur={ind?.couverture_ponderee_jours == null ? '—' : fmt.nombre(ind.couverture_ponderee_jours, 0)}
            unite="j"
            aide="Valeur du stock physique divisée par la valeur consommée par jour. Les références chères pèsent davantage."
          />
          <Kpi libelle="Ruptures" valeur={fmt.nombre(n('nb_ruptures'), 0)} ton={n('nb_ruptures') > 0 ? 'danger' : 'succes'} />
        </BlocKpi>
        <BlocKpi titre="Achats" Icone={ShoppingCart}>
          <Kpi libelle="Bons ouverts" valeur={fmt.nombre(n('nb_bc_ouverts'), 0)} />
          {voitMontants && (
            <Kpi libelle="Engagé" valeur={fmt.nombre(n('montant_bc_ouverts_mad') / 1e6, 2)} unite="M MAD" />
          )}
          <Kpi
            libelle="Écart de pesée moyen"
            valeur={ind?.ecart_pesee_moyen_pct == null ? '—' : fmt.nombre(ind.ecart_pesee_moyen_pct, 2)}
            unite="%"
            aide="Moyenne des écarts entre poids facturé et poids pesé, sur les réceptions archivées."
          />
          <Kpi libelle="Fournisseurs actifs" valeur={fmt.nombre(n('nb_fournisseurs_actifs'), 0)} />
        </BlocKpi>
        <BlocKpi titre="Classification ABC" Icone={Layers}>
          <Kpi libelle="Classe A (80 % de la valeur)" valeur={fmt.nombre(ind?.nb_classe_a ?? 0, 0)} />
          <Kpi libelle="Classe B (15 %)" valeur={fmt.nombre(ind?.nb_classe_b ?? 0, 0)} />
          <Kpi libelle="Classe C (5 %)" valeur={fmt.nombre(ind?.nb_classe_c ?? 0, 0)} />
          <Kpi
            libelle="Non classées"
            valeur={fmt.nombre(ind?.nb_non_classees ?? 0, 0)}
            ton={(ind?.nb_non_classees ?? 0) > 0 ? 'alerte' : undefined}
            aide="Lancer « Calculer la classification » pour les classer."
          />
        </BlocKpi>
        <BlocKpi titre="Stock dormant" Icone={Coins}>
          <Kpi libelle="Références dormantes" valeur={fmt.nombre(n('nb_refs_dormantes'), 0)} />
          {voitMontants && ind && (
            <>
              <Kpi libelle="Valeur dormante" valeur={fmt.nombre((ind.valeur_dormante_mad ?? 0) / 1e6, 2)} unite="M MAD" />
              <Kpi
                libelle="Part du stock"
                valeur={ind.pct_valeur_dormante == null ? '—' : fmt.nombre(ind.pct_valeur_dormante, 1)}
                unite="%"
                ton={(ind.pct_valeur_dormante ?? 0) > 5 ? 'alerte' : undefined}
              />
              <Kpi
                libelle="Budget des ruptures"
                valeur={fmt.nombre((ind.budget_ruptures_mad ?? 0) / 1e6, 2)}
                unite="M MAD"
                aide="Montant du plan d’achat pour les seules références en rupture : ce qu’il faut dépenser maintenant."
              />
            </>
          )}
        </BlocKpi>
      </div>

      {/* ---- Les cinq graphiques, deux par rangee ------------------------- */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Pareto
          titre="Concentration de la depense"
          sousTitre={`Les ${pareto.length} references qui portent le budget, et la part cumulee`}
          unite="MAD de consommation annuelle"
          donnees={pareto}
        />

        <BarresRangees
          titre="Budget par fournisseur"
          sousTitre="Consommation annuelle valorisee au CMUP"
          unite="MAD par an"
          maximum={10}
          donnees={d.fournisseurs.map((f) => ({
            cle: f.fournisseur_nom,
            libelle: f.fournisseur_nom,
            valeur: f.budget_annuel_mad,
          }))}
        />

        <BarresRangees
          titre="Distribution des couvertures"
          sousTitre="Combien de références dans chaque tranche de jours"
          unite="references"
          maximum={6}
          // L'ordre des tranches EST l'information : trier par effectif melangeait
          // « rupture » et « plus de 180 jours ».
          trier={false}
          donnees={d.couverture.map((c) => ({
            cle: c.libelle,
            libelle: c.libelle,
            valeur: c.nb_references,
            etat:
              c.rang === 1 ? ('critique' as const)
              : c.rang === 2 ? ('alerte' as const)
              : c.rang >= 5 ? ('bon' as const)
              : undefined,
          }))}
        />

        <ColonnesTemps
          titre="Coût matiere par mois"
          sousTitre="Besoin du plan valorise — quand la tresorerie sera sollicitee"
          unite="MAD"
          donnees={d.cout_mensuel.map((m) => ({
            cle: m.annee_mois,
            // Mois ET annee : le plan chevauche deux annees civiles.
            libelle: `${m.annee_mois.slice(5)}/${m.annee_mois.slice(2, 4)}`,
            valeur: m.cout_mad,
          }))}
        />

        <BarresEmpilees
          titre="Classe ABC croisee au statut"
          sousTitre="Une référence de classe A en alerte ne se traite pas comme une classe C"
          unite="references"
          series={[
            { cle: 'en_alerte', libelle: 'Rupture ou critique' },
            { cle: 'attention', libelle: 'Attention' },
            { cle: 'ok', libelle: 'OK' },
          ]}
          donnees={d.abc_statut.map((a) => ({
            cle: a.classe_abc,
            libelle: `Classe ${a.classe_abc}`,
            parts: { en_alerte: a.en_alerte, attention: a.attention, ok: a.ok },
          }))}
        />

        {/* ---- Tresorerie : les quatre indicateurs de cycle --------------- */}
        {t && droits.visible('valeur_stock_mad') && (
          <BlocKpi titre="Cycle de tresorerie" Icone={Landmark}>
            <Kpi
              libelle="Stock immobilisé"
              valeur={fmt.nombre(t.valeur_stock_mad / 1e6, 2)}
              unite="M MAD"
            />
            <Kpi
              libelle="Coût matiere annuel"
              valeur={fmt.nombre(t.cout_matiere_annuel_mad / 1e6, 2)}
              unite="M MAD"
            />
            <Kpi
              libelle="Rotation du stock"
              valeur={fmt.nombre(t.rotation_annuelle, 2)}
              unite="fois / an"
              ton={t.rotation_annuelle < 1 ? 'alerte' : undefined}
              aide="Coût matière annuel divise par la valeur du stock. Sous 1, le stock represente plus d une annee de consommation."
            />
            <Kpi
              libelle="Stock en jours (DIO)"
              valeur={fmt.nombre(t.dio_jours, 0)}
              unite="j"
              ton={t.dio_jours > 180 ? 'alerte' : undefined}
            />
            <Kpi
              libelle="Délai fournisseur (DPO)"
              valeur={fmt.nombre(t.dpo_jours, 0)}
              unite="j"
              aide="Delais de paiement des fournisseurs, ponderes par le budget annuel de chacun."
            />
            <Kpi
              libelle="Matière consommée par mois"
              valeur={fmt.nombre(t.cout_matiere_annuel_mad / 12 / 1e6, 2)}
              unite="M MAD"
            />
            <Kpi
              libelle="Cycle de conversion (CCC)"
              valeur={fmt.nombre(t.ccc_jours, 0)}
              unite="j"
              ton={t.ccc_jours > 90 ? 'danger' : t.ccc_jours > 0 ? 'alerte' : 'succes'}
              aide="DIO + DSO - DPO. Negatif, le fournisseur finance le cycle."
            />
          </BlocKpi>
        )}
      </div>

      {t?.dso_est_un_parametre && droits.visible('valeur_stock_mad') && (
        <p className="text-[11px] text-attenue-texte">
          Le DSO retenu pour le cycle est le parametre <span className="font-mono">P_DSODefaut</span>{' '}
          ({fmt.nombre(t.dso_jours, 0)} j) : sans module de vente, l ERP ne peut pas le mesurer. Il
          le declare plutot que de l inventer.
        </p>
      )}

      {/* ---- Economies possibles ------------------------------------------ */}
      {droits.visible('valeur_stock_mad') && d.economies.length > 0 && (
        <Carte repliable="cockpit.eco">
          <CarteEntete>
            <CarteTitre className="flex items-center gap-1.5">
              <Coins className="size-3.5" />
              Economies theoriques — {fmt.nombre(totalEconomies / 1e6, 2)} M MAD par an
            </CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="defilement-x">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Référence</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Fournisseur actuel</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Prix actuel</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Prix mini du groupe</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Source alternative</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Economie / an</th>
                  </tr>
                </thead>
                <tbody>
                  {top5.map((e) => (
                    <tr key={e.code_reference} className="hover:bg-attenue/60">
                      <td className="max-w-[240px] truncate px-2.5 py-1 font-mono text-[11px]">
                        {e.code_reference}
                      </td>
                      <td className="px-2.5 py-1">{e.fournisseur_actuel ?? '—'}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(e.prix_actuel_mad, 2)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums text-succes">
                        {fmt.nombre(e.prix_min_mad, 2)}
                      </td>
                      <td className="px-2.5 py-1">{e.fournisseur_alternatif ?? '—'}</td>
                      <td className="px-2.5 py-1 text-right font-medium tabular-nums">
                        {fmt.nombre(e.economie_annuelle_mad, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Le mot « theoriques » n'est pas une precaution de style : il
                nomme trois hypotheses que l'acheteur doit verifier avant de
                basculer. Les taire ferait passer une piste pour un acquis. */}
            <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
              Ce montant suppose que l equivalent tient la meme qualite, que le fournisseur suit le
              volume, et que le delai ne se degrade pas. Il se verifie avant de basculer.
              {ind && ind.nb_opportunites > 5 && ` ${ind.nb_opportunites - 5} autres références au-delà du top 5.`}
            </p>
          </CarteCorps>
        </Carte>
      )}

      {/* ---- Fragilites de fond ------------------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-2">
        {d.mono_source.length > 0 && (
          <Carte repliable="cockpit.mono">
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                Mono-source en tension — {d.mono_source.length}
              </CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-0">
              <div className="defilement-x">
                <table className="grille w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue">
                      <th className="px-2.5 py-1.5 text-left font-semibold">Référence</th>
                      <th className="px-2.5 py-1.5 text-left font-semibold">Fournisseur unique</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Délai</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Couverture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.mono_source.slice(0, 8).map((m) => (
                      <tr key={m.code_reference} className="hover:bg-attenue/60">
                        <td className="max-w-[200px] truncate px-2.5 py-1 font-mono text-[11px]">
                          {m.code_reference}
                        </td>
                        <td className="px-2.5 py-1">{m.fournisseur_nom ?? '—'}</td>
                        <td className="px-2.5 py-1 text-right tabular-nums">
                          {m.delai_livraison_jours ?? '—'} j
                        </td>
                        <td className="px-2.5 py-1 text-right tabular-nums">
                          {m.jours_couverture == null ? '—' : `${fmt.nombre(m.jours_couverture, 0)} j`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                Aucune reference equivalente n est rattachee a ces articles : une defaillance du
                fournisseur arrete la ligne. Qualifier une seconde source les sort de cette liste.
              </p>
            </CarteCorps>
          </Carte>
        )}

        {droits.visible('valeur_stock_mad') && d.devises.length > 0 && (
          <Carte repliable="cockpit.devise">
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <Truck className="size-3.5" />
                Concentration par devise
              </CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-0">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Devise</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Références</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Budget annuel</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {d.devises.map((v) => (
                    <tr key={v.code_devise} className="hover:bg-attenue/60">
                      <td className="px-2.5 py-1 font-mono">{v.code_devise}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">{v.nb_references}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(v.montant_mad / 1e6, 2)} M
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        <span
                          className={cn(
                            'inline-block rounded-[3px] px-1.5 py-px',
                            v.part_pct > 60 && v.code_devise !== 'MAD'
                              ? 'bg-alerte/15 font-medium text-alerte'
                              : '',
                          )}
                        >
                          {fmt.nombre(v.part_pct, 1)} %
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.devises.some((v) => v.code_devise !== 'MAD' && v.part_pct > 60) && (
                <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                  Plus de six dixiemes du budget dans une monnaie etrangere : une variation de
                  change se repercute directement sur le cout matiere.
                </p>
              )}
            </CarteCorps>
          </Carte>
        )}
      </div>

      {!droits.visible('valeur_stock_mad') && (
        <Alerte ton="info">
          Les blocs financiers ne sont pas affiches : votre role ne recoit pas les montants. Les
          alertes de stock et les couvertures restent completes.
        </Alerte>
      )}
    </div>
  )
}

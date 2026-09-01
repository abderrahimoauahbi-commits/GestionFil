/**
 * Les rapports financiers.
 *
 * CE QUE CET ECRAN EST, ET CE QU'IL N'EST PAS. Il rassemble ce que l'ERP sait
 * du patrimoine et de la depense matiere : valeur du stock, cout matiere,
 * cycle de tresorerie, concentration. Il n'est PAS une comptabilite — ni
 * balance, ni grand livre general, ni compte de resultat. Ces documents vivent
 * dans votre logiciel comptable, et cet ecran ne pretend pas les remplacer.
 *
 * Il sert a UNE chose : donner a la direction les chiffres matiere sous une
 * forme qui s'imprime et se transmet, sans qu'il faille les recomposer depuis
 * six ecrans differents.
 *
 * TOUT EST DEJA CALCULE AILLEURS. Chaque bloc reprend une vue existante — la
 * valorisation, l'analyse ABC, le cockpit. Recalculer ici donnerait un second
 * jeu de chiffres qui divergerait du premier au premier arrondi.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Coins, Landmark, PieChart, TrendingUp } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Chargement, Selecteur } from '../composants/ui/base'
import { exporterCsv } from '../lib/export'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'

const MODULE = 'VALORISATION'

interface Analyse {
  devises: { code_devise: string; nb_references: number; montant_mad: number; part_pct: number }[]
  fournisseurs: { fournisseur_nom: string; nb_references: number; budget_annuel_mad: number }[]
  cout_mensuel: { annee_mois: string; quantite_kg: number; cout_mad: number }[]
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
}

interface LigneAbc {
  code_reference: string
  designation: string | null
  classe_abc: string | null
  classe_xyz: string | null
  valeur_conso_annuelle_mad?: number | null
  part_pct?: number | null
  valeur_totale_mad?: number | null
  [k: string]: unknown
}

type Rapport = 'synthese' | 'abc' | 'fournisseurs' | 'mensuel'

const RAPPORTS: { cle: Rapport; libelle: string; resume: string }[] = [
  { cle: 'synthese', libelle: 'Synthese patrimoniale', resume: 'Valeur du stock, cout matiere, cycle de tresorerie' },
  { cle: 'abc', libelle: 'Concentration de la valeur', resume: 'Repartition par classe ABC et poids des references' },
  { cle: 'fournisseurs', libelle: 'Engagement par fournisseur', resume: 'Budget annuel et dependance' },
  { cle: 'mensuel', libelle: 'Cout matiere mensuel', resume: 'Ce que le plan engage, mois par mois' },
]

function Chiffre({
  libelle,
  valeur,
  unite,
  aide,
  ton,
}: {
  libelle: string
  valeur: string
  unite?: string
  aide?: string
  ton?: 'alerte' | 'danger' | 'succes'
}) {
  return (
    <Carte>
      <CarteCorps className="p-3" title={aide}>
        <div className="text-[11px] text-attenue-texte">{libelle}</div>
        <div
          className={cn(
            'text-[19px] font-semibold tabular-nums',
            ton === 'danger' ? 'text-danger' : ton === 'alerte' ? 'text-alerte' : ton === 'succes' ? 'text-succes' : '',
          )}
        >
          {valeur}
          {unite && <span className="ml-1 text-[11px] font-normal text-attenue-texte">{unite}</span>}
        </div>
      </CarteCorps>
    </Carte>
  )
}

export function RapportsFinanciers() {
  const droits = useDroits(MODULE)
  const [rapport, setRapport] = useState<Rapport>('synthese')

  const qAnalyse = useQuery({
    queryKey: ['cockpit-analyse'],
    queryFn: () => api.get<Analyse>('/api/cockpit/analyse'),
  })
  const qAbc = useQuery({
    queryKey: ['analyse-abc-xyz'],
    queryFn: () => api.get<LigneAbc[]>('/api/analyse-abc-xyz'),
  })

  const d = qAnalyse.data
  const abc = qAbc.data ?? []

  /* La repartition par classe : combien de references, quelle valeur consommee,
     quelle valeur immobilisee. Les trois ensemble disent si le stock est place
     la ou l'argent circule — une classe C qui porte trente pour cent du stock
     immobilise du capital sur ce qui ne tourne pas. */
  const parClasse = useMemo(() => {
    const m = new Map<string, { n: number; conso: number; stock: number }>()
    for (const l of abc) {
      const k = l.classe_abc ?? '?'
      const c = m.get(k) ?? { n: 0, conso: 0, stock: 0 }
      c.n += 1
      c.conso += l.valeur_conso_annuelle_mad ?? 0
      c.stock += l.valeur_totale_mad ?? 0
      m.set(k, c)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [abc])

  if (qAnalyse.isLoading || qAbc.isLoading) return <Chargement texte="Preparation des rapports…" />

  if (!droits.visible('valeur_totale_mad')) {
    return (
      <div>
        <EnTetePage titre="Rapports financiers" />
        <Alerte ton="info">
          Votre role ne recoit pas les montants : ces rapports n auraient rien a montrer. Les
          etats de stock et de mouvement restent accessibles en quantites.
        </Alerte>
      </div>
    )
  }

  const t = d?.tresorerie
  const totalConso = parClasse.reduce((s, [, c]) => s + c.conso, 0)
  const totalStock = parClasse.reduce((s, [, c]) => s + c.stock, 0)

  const courant = RAPPORTS.find((r) => r.cle === rapport)!

  return (
    <div>
      <EnTetePage
        titre="Rapports financiers"
        sous_titre="Les chiffres matiere de l ERP — ni balance, ni compte de resultat"
        actions={
          <>
            <Selecteur
              value={rapport}
              onChange={(e) => setRapport(e.target.value as Rapport)}
              className="w-64"
            >
              {RAPPORTS.map((r) => (
                <option key={r.cle} value={r.cle}>
                  {r.libelle}
                </option>
              ))}
            </Selecteur>
            <Bouton variante="contour" onClick={() => window.print()}>
              Imprimer
            </Bouton>
          </>
        }
      />

      <p className="sans-impression mb-3 text-[12px] text-attenue-texte">{courant.resume}</p>

      {/* --- Ce qui s'affiche a l'ecran ------------------------------------ */}
      <div className="sans-impression flex flex-col gap-3">
        {rapport === 'synthese' && t && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Chiffre
                libelle="Stock immobilise"
                valeur={fmt.nombre(t.valeur_stock_mad / 1e6, 2)}
                unite="M MAD"
              />
              <Chiffre
                libelle="Cout matiere annuel"
                valeur={fmt.nombre(t.cout_matiere_annuel_mad / 1e6, 2)}
                unite="M MAD"
                aide="Besoin du plan en service, valorise au CMUP."
              />
              <Chiffre
                libelle="Rotation du stock"
                valeur={fmt.nombre(t.rotation_annuelle, 2)}
                unite="fois / an"
                ton={t.rotation_annuelle < 1 ? 'alerte' : undefined}
                aide="Sous 1, le stock represente plus d une annee de consommation."
              />
              <Chiffre
                libelle="Cycle de conversion"
                valeur={fmt.nombre(t.ccc_jours, 0)}
                unite="jours"
                ton={t.ccc_jours > 90 ? 'danger' : t.ccc_jours > 0 ? 'alerte' : 'succes'}
                aide="DIO + DSO - DPO. Negatif, le fournisseur finance le cycle."
              />
            </div>
            <Alerte ton="info">
              Le DSO retenu ({fmt.nombre(t.dso_jours, 0)} jours) vient du parametre
              {' '}<span className="font-mono">P_DSODefaut</span> : sans module de vente, l ERP ne
              peut pas le mesurer. Le DIO ({fmt.nombre(t.dio_jours, 0)} j) et le DPO
              ({fmt.nombre(t.dpo_jours, 0)} j) sont calcules.
            </Alerte>
          </>
        )}

        {rapport === 'abc' && (
          <Carte>
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <PieChart className="size-3.5" />
                Repartition par classe
              </CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-0">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Classe</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">References</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Consommation annuelle</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Part conso</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Stock immobilise</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Part stock</th>
                  </tr>
                </thead>
                <tbody>
                  {parClasse.map(([k, c]) => (
                    <tr key={k} className="hover:bg-attenue/60">
                      <td className="px-2.5 py-1 font-semibold">{k === '?' ? 'Non classees' : k}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">{c.n}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(c.conso, 0)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {totalConso > 0 ? `${fmt.nombre((c.conso / totalConso) * 100, 1)} %` : '—'}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(c.stock, 0)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {totalStock > 0 ? `${fmt.nombre((c.stock / totalStock) * 100, 1)} %` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* La lecture qui compte : comparer les deux parts. */}
              <p className="border-t border-bordure px-3 py-2 text-[11px] leading-relaxed text-attenue-texte">
                Comparez les deux dernieres colonnes. Une classe qui pese plus dans le STOCK que
                dans la CONSOMMATION immobilise du capital sur ce qui ne tourne pas.
              </p>
            </CarteCorps>
          </Carte>
        )}

        {rapport === 'fournisseurs' && d && (
          <Carte>
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <Landmark className="size-3.5" />
                Engagement par fournisseur
              </CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-0">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Fournisseur</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">References</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Budget annuel</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const total = d.fournisseurs.reduce((s, f) => s + f.budget_annuel_mad, 0)
                    return d.fournisseurs.map((f) => {
                      const part = total > 0 ? (f.budget_annuel_mad / total) * 100 : 0
                      return (
                        <tr key={f.fournisseur_nom} className="hover:bg-attenue/60">
                          <td className="px-2.5 py-1">{f.fournisseur_nom}</td>
                          <td className="px-2.5 py-1 text-right tabular-nums">
                            {f.nb_references}
                          </td>
                          <td className="px-2.5 py-1 text-right tabular-nums">
                            {fmt.nombre(f.budget_annuel_mad, 0)}
                          </td>
                          <td className="px-2.5 py-1 text-right tabular-nums">
                            <span
                              className={cn(
                                'inline-block rounded-[3px] px-1.5 py-px',
                                part > 30 ? 'bg-alerte/15 font-medium text-alerte' : '',
                              )}
                            >
                              {fmt.nombre(part, 1)} %
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
              <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                Une part superieure a 30 % marque une dependance : une defaillance de ce
                fournisseur toucherait un tiers de l approvisionnement.
              </p>
            </CarteCorps>
          </Carte>
        )}

        {rapport === 'mensuel' && d && (
          <Carte>
            <CarteEntete>
              <CarteTitre className="flex items-center gap-1.5">
                <TrendingUp className="size-3.5" />
                Cout matiere par mois
              </CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-0">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Mois</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Quantite (kg)</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Cout (MAD)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cout_mensuel.map((m) => (
                    <tr key={m.annee_mois} className="hover:bg-attenue/60">
                      <td className="px-2.5 py-1 tabular-nums">{m.annee_mois}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(m.quantite_kg, 0)}
                      </td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {fmt.nombre(m.cout_mad, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-bordure font-semibold">
                    <td className="px-2.5 py-1.5">Total</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {fmt.nombre(d.cout_mensuel.reduce((s, m) => s + m.quantite_kg, 0), 0)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {fmt.nombre(d.cout_mensuel.reduce((s, m) => s + m.cout_mad, 0), 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CarteCorps>
          </Carte>
        )}

        <div className="flex gap-2">
          <Bouton
            variante="contour"
            onClick={() => {
              if (rapport === 'abc') {
                exporterCsv('rapport-classes', [
                  { champ: 'classe', entete: 'Classe' },
                  { champ: 'n', entete: 'References', numerique: true },
                  { champ: 'conso', entete: 'Consommation annuelle MAD', numerique: true },
                  { champ: 'stock', entete: 'Stock immobilise MAD', numerique: true },
                ], parClasse.map(([k, c]) => ({ classe: k, ...c })))
              } else if (rapport === 'fournisseurs' && d) {
                exporterCsv('rapport-fournisseurs', [
                  { champ: 'fournisseur_nom', entete: 'Fournisseur' },
                  { champ: 'nb_references', entete: 'References', numerique: true },
                  { champ: 'budget_annuel_mad', entete: 'Budget annuel MAD', numerique: true },
                ], d.fournisseurs)
              } else if (rapport === 'mensuel' && d) {
                exporterCsv('rapport-cout-mensuel', [
                  { champ: 'annee_mois', entete: 'Mois' },
                  { champ: 'quantite_kg', entete: 'Quantite kg', numerique: true },
                  { champ: 'cout_mad', entete: 'Cout MAD', numerique: true },
                ], d.cout_mensuel)
              } else if (t) {
                exporterCsv('rapport-synthese', [
                  { champ: 'indicateur', entete: 'Indicateur' },
                  { champ: 'valeur', entete: 'Valeur', numerique: true },
                  { champ: 'unite', entete: 'Unite' },
                ], [
                  { indicateur: 'Stock immobilise', valeur: t.valeur_stock_mad, unite: 'MAD' },
                  { indicateur: 'Cout matiere annuel', valeur: t.cout_matiere_annuel_mad, unite: 'MAD' },
                  { indicateur: 'Rotation du stock', valeur: t.rotation_annuelle, unite: 'fois/an' },
                  { indicateur: 'DIO', valeur: t.dio_jours, unite: 'jours' },
                  { indicateur: 'DSO (parametre)', valeur: t.dso_jours, unite: 'jours' },
                  { indicateur: 'DPO', valeur: t.dpo_jours, unite: 'jours' },
                  { indicateur: 'Cycle de conversion', valeur: t.ccc_jours, unite: 'jours' },
                ])
              }
            }}
          >
            <Coins />
            Exporter ce rapport
          </Bouton>
        </div>
      </div>

      {/* --- Ce qui part au papier ------------------------------------------
          Le rapport imprime porte TOUS les blocs, pas seulement celui qu'on
          regarde : un document financier qui ne montrerait qu'un quart des
          chiffres obligerait a quatre tirages pour une seule reunion. */}
      <div className="hidden print:block">
        <EtatImprimable titre="Rapport financier" sansBarre>
          {t && (
            <>
              <h3 className="mb-1 border-b border-neutral-400 pb-0.5 text-[10px] font-bold uppercase tracking-wide">
                Synthese patrimoniale
              </h3>
              <TableEtat<{ i: string; v: string }>
                colonnes={[
                  { entete: 'Indicateur', valeur: (r) => r.i },
                  { entete: 'Valeur', numerique: true, valeur: (r) => r.v },
                ]}
                lignes={[
                  { i: 'Stock immobilise', v: `${fmt.nombre(t.valeur_stock_mad, 2)} MAD` },
                  { i: 'Cout matiere annuel', v: `${fmt.nombre(t.cout_matiere_annuel_mad, 2)} MAD` },
                  { i: 'Rotation du stock', v: `${fmt.nombre(t.rotation_annuelle, 2)} fois/an` },
                  { i: 'Stock en jours (DIO)', v: `${fmt.nombre(t.dio_jours, 0)} j` },
                  { i: 'Delai client (DSO, parametre)', v: `${fmt.nombre(t.dso_jours, 0)} j` },
                  { i: 'Delai fournisseur (DPO)', v: `${fmt.nombre(t.dpo_jours, 0)} j` },
                  { i: 'Cycle de conversion (CCC)', v: `${fmt.nombre(t.ccc_jours, 0)} j` },
                ]}
              />
            </>
          )}

          <h3 className="mb-1 mt-5 border-b border-neutral-400 pb-0.5 text-[10px] font-bold uppercase tracking-wide">
            Repartition par classe
          </h3>
          <TableEtat<[string, { n: number; conso: number; stock: number }]>
            colonnes={[
              { entete: 'Classe', valeur: ([k]) => (k === '?' ? 'Non classees' : k) },
              { entete: 'References', numerique: true, valeur: ([, c]) => c.n },
              { entete: 'Conso annuelle', numerique: true, valeur: ([, c]) => fmt.nombre(c.conso, 0) },
              { entete: 'Stock', numerique: true, valeur: ([, c]) => fmt.nombre(c.stock, 0) },
            ]}
            lignes={parClasse}
          />

          {d && (
            <>
              <h3 className="mb-1 mt-5 border-b border-neutral-400 pb-0.5 text-[10px] font-bold uppercase tracking-wide">
                Engagement par fournisseur
              </h3>
              <TableEtat<(typeof d.fournisseurs)[number]>
                colonnes={[
                  { entete: 'Fournisseur', valeur: (f) => f.fournisseur_nom },
                  { entete: 'References', numerique: true, valeur: (f) => f.nb_references },
                  {
                    entete: 'Budget annuel MAD',
                    numerique: true,
                    valeur: (f) => fmt.nombre(f.budget_annuel_mad, 0),
                  },
                ]}
                lignes={d.fournisseurs}
              />

              <h3 className="mb-1 mt-5 border-b border-neutral-400 pb-0.5 text-[10px] font-bold uppercase tracking-wide">
                Cout matiere par mois
              </h3>
              <TableEtat<(typeof d.cout_mensuel)[number]>
                colonnes={[
                  { entete: 'Mois', valeur: (m) => m.annee_mois },
                  { entete: 'Quantite kg', numerique: true, valeur: (m) => fmt.nombre(m.quantite_kg, 0) },
                  { entete: 'Cout MAD', numerique: true, valeur: (m) => fmt.nombre(m.cout_mad, 0) },
                ]}
                lignes={d.cout_mensuel}
              />
            </>
          )}

          <p className="mt-4 text-[9px] text-neutral-600">
            Chiffres matiere issus de l ERP Gestion Fil. Ce document n est ni une balance ni un
            compte de resultat : la comptabilite generale reste tenue dans son propre logiciel.
          </p>
        </EtatImprimable>
      </div>
    </div>
  )
}

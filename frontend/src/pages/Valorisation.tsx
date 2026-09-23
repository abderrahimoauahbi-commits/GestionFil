/**
 * Valorisation du stock.
 *
 * Repond a une seule question : combien vaut ce qui est en magasin, et
 * l'evaluation est-elle credible ?
 *
 * Le piege que cet ecran doit desamorcer : `cmup_mad` et `prix_catalogue_kg` ne
 * sont PAS comparables tels quels — le premier est en dirhams, le second dans
 * la devise du fournisseur. La colonne servie `prix_catalogue_mad` est le prix
 * catalogue **converti au taux en vigueur** ; c'est elle qui se compare au CMUP.
 *
 * L'ANCIEN PIEGE (corrige le 17/09/2026) : l'ecart se calculait contre
 * `prix_kg_mad`, qui rend le CMUP des qu'il existe. Le CMUP etait compare a
 * lui-meme et l'ecart valait toujours zero.
 *
 * LA VALEUR est `valeur_stock_mad` : chaque magasin a son CMUP, exactement
 * comme la tuile « Valeur du stock » du tableau de bord.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator, Coins, TrendingDown, TrendingUp } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  Alerte,
  Badge,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Squelette,
} from '../composants/ui/base'
import { BarresRangees } from '../composants/graphiques/Graphiques'
import { cn, fmt } from '../lib/utils'

interface LigneCatalogue {
  code_reference: string
  designation: string | null
  code_categorie: string | null
  code_devise_catalogue: string | null
  stock_total_kg: number | null
  cmup_mad: number | null
  /** Prix catalogue converti au taux en vigueur : la seule base comparable au CMUP. */
  prix_catalogue_mad: number | null
  /** Somme des magasins, chacun a son CMUP. */
  valeur_stock_mad: number | null
  source_prix: string | null
  classe_abc: string | null
}

/** Ecart au-dela duquel la valorisation merite un regard. */
const ECART_NOTABLE = 15

export function Valorisation() {
  const { peut } = useAuth()
  const [filtre, setFiltre] = useState<'tout' | 'ecart' | 'sans-cmup'>('tout')

  const q = useQuery({
    queryKey: ['valorisation'],
    queryFn: () => api.get<LigneCatalogue[]>('/api/catalogue?actif=1&limite=2000'),
    enabled: peut('VALORISATION', 'LIRE') || peut('CATALOGUE', 'LIRE'),
  })

  const lignes = useMemo(() => {
    return (q.data ?? [])
      .map((r) => {
        const kg = r.stock_total_kg ?? 0
        const cmup = r.cmup_mad ?? null
        const catalogue = r.prix_catalogue_mad ?? null
        const valeur = r.valeur_stock_mad ?? (cmup !== null ? kg * cmup : null)
        const ecart =
          cmup !== null && catalogue !== null && catalogue > 0
            ? ((cmup - catalogue) / catalogue) * 100
            : null
        return { ...r, kg, cmup, catalogue, valeur, ecart }
      })
      .filter((r) => r.kg > 0)
  }, [q.data])

  const total = useMemo(
    () => ({
      valeur: lignes.reduce((s, r) => s + (r.valeur ?? 0), 0),
      kg: lignes.reduce((s, r) => s + r.kg, 0),
      sansCmup: lignes.filter((r) => r.cmup === null).length,
      ecarts: lignes.filter((r) => r.ecart !== null && Math.abs(r.ecart) >= ECART_NOTABLE).length,
    }),
    [lignes],
  )

  const visibles = useMemo(() => {
    const base =
      filtre === 'ecart'
        ? lignes.filter((r) => r.ecart !== null && Math.abs(r.ecart) >= ECART_NOTABLE)
        : filtre === 'sans-cmup'
          ? lignes.filter((r) => r.cmup === null)
          : lignes
    return [...base].sort((a, b) => (b.valeur ?? 0) - (a.valeur ?? 0))
  }, [lignes, filtre])

  if (q.isLoading) return <Squelette className="h-96 w-full" />

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Valorisation du stock"
        description="CMUP par référence, et ecart au prix catalogue converti"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Chiffre
          Icone={Coins}
          libelle="Valeur totale"
          valeur={`${fmt.nombre(Math.round(total.valeur))} MAD`}
        />
        <Chiffre libelle="Quantité" valeur={`${fmt.nombre(Math.round(total.kg))} kg`} />
        <Chiffre
          libelle="Sans CMUP"
          valeur={String(total.sansCmup)}
          ton={total.sansCmup > 0 ? 'alerte' : undefined}
<<<<<<< HEAD
          aide="Ni achat, ni prix catalogue convertible (taux absent) : ces références comptent pour zéro."
=======
          aide="Aucune reception valorisee : ces références ne comptent pas dans le total."
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
        />
        <Chiffre
          libelle={`Ecart superieur a ${ECART_NOTABLE} %`}
          valeur={String(total.ecarts)}
          ton={total.ecarts > 0 ? 'alerte' : undefined}
          aide="Le CMUP s'écarte nettement du prix catalogue converti au taux du jour."
        />
      </div>

      {total.sansCmup > 0 && (
        <Alerte ton="alerte" titre="Une partie du stock n'est pas valorisee">
          {total.sansCmup} reference{total.sansCmup > 1 ? 's portent' : ' porte'} du stock sans
          CMUP : ni achat, ni prix catalogue convertible — sa devise n'a pas de taux en vigueur.
          Leur valeur est comptee pour zero dans le total ci-dessus, qui est donc un plancher.
        </Alerte>
      )}

      {/* --- Methode et hypotheses -----------------------------------------
          Le bloc du classeur, et il n'est pas decoratif : un chiffre de
          valorisation sans sa methode n'est pas exploitable par un comptable.
          Il faut pouvoir dire SUR QUOI il repose — quelle formule, quelle
          devise pivot, quelle date — avant de le porter dans un bilan. */}
      <Carte repliable="valorisation.methode">
        <CarteEntete>
          <CarteTitre className="flex items-center gap-1.5">
            <Calculator className="size-3.5" />
            Methode et hypotheses
          </CarteTitre>
        </CarteEntete>
        <CarteCorps className="grid gap-x-8 gap-y-2 text-[12px] md:grid-cols-2">
          <div>
            <div className="text-[11px] text-attenue-texte">Methode</div>
            <div className="font-medium">CMUP — coût moyen unitaire pondere</div>
          </div>
          <div>
            <div className="text-[11px] text-attenue-texte">Formule</div>
            <div className="font-mono text-[11px]">
              (qte x CMUP + entree x prix) / (qte + entree)
            </div>
          </div>
          <div>
            <div className="text-[11px] text-attenue-texte">Assiette</div>
            <div>
              Entrees <span className="font-medium">valorisees</span> ; sans achat, le CMUP est le
              prix catalogue au taux en vigueur, et la premiere reception moyenne avec lui. Une
              sortie ne modifie jamais le CMUP d'un magasin (regle R04)
            </div>
          </div>
          <div>
            <div className="text-[11px] text-attenue-texte">Devise pivot</div>
            <div>
              <span className="font-medium">MAD</span> — conversion au taux en vigueur a la date
              de reception, fige sur la ligne
            </div>
          </div>
          <div>
            <div className="text-[11px] text-attenue-texte">Unité</div>
            <div>
              <span className="font-medium">Kilogramme</span> — toute quantite y est ramenee a la
              saisie (regle R01)
            </div>
          </div>
          <div>
            <div className="text-[11px] text-attenue-texte">Date de valorisation</div>
            <div className="font-medium">{new Date().toLocaleDateString('fr-FR')}</div>
          </div>
        </CarteCorps>
      </Carte>

      <BarresRangees
        titre="Ou dort la valeur"
        sousTitre="Les références qui pesent le plus dans le stock"
        unite="MAD"
        donnees={visibles
          .filter((r) => (r.valeur ?? 0) > 0)
          .map((r) => ({
            cle: r.code_reference,
            libelle: r.code_reference,
            valeur: r.valeur as number,
          }))}
      />

      <div className="flex flex-wrap gap-1">
        {(
          [
            ['tout', `Toutes (${lignes.length})`],
            ['ecart', `Ecart notable (${total.ecarts})`],
            ['sans-cmup', `Sans CMUP (${total.sansCmup})`],
          ] as const
        ).map(([id, libelle]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFiltre(id)}
            className={cn(
              'rounded-[3px] border px-2.5 py-1 text-[12px] transition-colors',
              filtre === id
                ? 'border-primaire bg-primaire text-primaire-texte'
                : 'border-bordure text-attenue-texte hover:bg-attenue hover:text-texte',
            )}
          >
            {libelle}
          </button>
        ))}
      </div>

      <div className="defilement-x rounded-[var(--radius)] border border-bordure bg-surface">
        <table className="grille w-full text-[12px]">
          <thead className="bg-attenue">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Référence</th>
              <th className="px-2 py-1.5 text-left font-medium">Designation</th>
              <th className="px-2 py-1.5 text-center font-medium">ABC</th>
              <th className="px-2 py-1.5 text-right font-medium">Stock (kg)</th>
              <th className="px-2 py-1.5 text-right font-medium">CMUP (MAD)</th>
              <th className="px-2 py-1.5 text-right font-medium">Catalogue (MAD)</th>
              <th className="px-2 py-1.5 text-right font-medium">Écart</th>
              <th className="px-2 py-1.5 text-right font-medium">Valeur (MAD)</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => (
              <tr key={r.code_reference} className="hover:bg-attenue/60">
                <td className="whitespace-nowrap px-2 py-1 font-mono">{r.code_reference}</td>
                <td className="max-w-[18rem] truncate px-2 py-1 text-attenue-texte">
                  {r.designation ?? '—'}
                </td>
                <td className="px-2 py-1 text-center">
                  {r.classe_abc ? <Badge>{r.classe_abc}</Badge> : '—'}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{fmt.nombre(r.kg)}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.cmup !== null ? fmt.nombre(r.cmup) : <span className="text-alerte">—</span>}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-attenue-texte">
                  {r.catalogue !== null ? fmt.nombre(r.catalogue) : '—'}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.ecart === null ? (
                    '—'
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        Math.abs(r.ecart) >= ECART_NOTABLE
                          ? r.ecart > 0
                            ? 'text-danger'
                            : 'text-succes'
                          : 'text-attenue-texte',
                      )}
                    >
                      {r.ecart > 0 ? (
                        <TrendingUp className="size-3" />
                      ) : (
                        <TrendingDown className="size-3" />
                      )}
                      {r.ecart > 0 ? '+' : ''}
                      {r.ecart.toFixed(1)} %
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right font-medium tabular-nums">
                  {r.valeur !== null ? fmt.nombre(Math.round(r.valeur)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Chiffre({
  Icone,
  libelle,
  valeur,
  ton,
  aide,
}: {
  Icone?: React.ComponentType<{ className?: string }>
  libelle: string
  valeur: string
  ton?: 'alerte'
  aide?: string
}) {
  return (
    <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3" title={aide}>
      <div className="flex items-center gap-1.5 text-[11px] text-attenue-texte">
        {Icone && <Icone className="size-3.5" />}
        {libelle}
      </div>
      <div
        className={cn(
          'mt-0.5 text-[20px] font-semibold tabular-nums leading-tight',
          ton === 'alerte' ? 'text-alerte' : 'text-texte',
        )}
      >
        {valeur}
      </div>
    </div>
  )
}

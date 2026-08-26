/**
 * Valorisation du stock.
 *
 * Repond a une seule question : combien vaut ce qui est en magasin, et
 * l'evaluation est-elle credible ?
 *
 * Le piege que cet ecran doit desamorcer : `cmup_mad` et `prix_catalogue_kg` ne
 * sont PAS comparables tels quels — le premier est en dirhams, le second dans
 * la devise du fournisseur. La colonne servie `prix_kg_mad` est le prix
 * catalogue **deja converti** ; c'est elle, et elle seule, qui se compare au
 * CMUP. Les mettre cote a cote sans conversion afficherait un ecart de 9,5 sur
 * les references en dollars, qui n'est que le taux de change.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Coins, TrendingDown, TrendingUp } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Badge, Squelette } from '../composants/ui/base'
import { BarresRangees } from '../composants/graphiques/Graphiques'
import { cn, fmt } from '../lib/utils'

interface LigneCatalogue {
  code_reference: string
  designation: string | null
  code_categorie: string | null
  code_devise_catalogue: string | null
  stock_total_kg: number | null
  cmup_mad: number | null
  /** Prix catalogue converti en dirhams : la seule base comparable au CMUP. */
  prix_kg_mad: number | null
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
        const catalogue = r.prix_kg_mad ?? null
        const valeur = cmup !== null ? kg * cmup : null
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
        description="CMUP par reference, et ecart au prix catalogue converti"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Chiffre
          Icone={Coins}
          libelle="Valeur totale"
          valeur={`${fmt.nombre(Math.round(total.valeur))} MAD`}
        />
        <Chiffre libelle="Quantite" valeur={`${fmt.nombre(Math.round(total.kg))} kg`} />
        <Chiffre
          libelle="Sans CMUP"
          valeur={String(total.sansCmup)}
          ton={total.sansCmup > 0 ? 'alerte' : undefined}
          aide="Aucune reception valorisee : ces references ne comptent pas dans le total."
        />
        <Chiffre
          libelle={`Ecart superieur a ${ECART_NOTABLE} %`}
          valeur={String(total.ecarts)}
          ton={total.ecarts > 0 ? 'alerte' : undefined}
          aide="Le cout reel s'ecarte nettement du prix catalogue."
        />
      </div>

      {total.sansCmup > 0 && (
        <Alerte ton="alerte" titre="Une partie du stock n'est pas valorisee">
          {total.sansCmup} reference{total.sansCmup > 1 ? 's portent' : ' porte'} du stock sans
          CMUP : aucune reception valorisee n'a encore ete saisie dessus. Leur valeur est comptee
          pour zero dans le total ci-dessus, qui est donc un plancher, pas une estimation.
        </Alerte>
      )}

      <BarresRangees
        titre="Ou dort la valeur"
        sousTitre="Les references qui pesent le plus dans le stock"
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
              <th className="px-2 py-1.5 text-left font-medium">Reference</th>
              <th className="px-2 py-1.5 text-left font-medium">Designation</th>
              <th className="px-2 py-1.5 text-center font-medium">ABC</th>
              <th className="px-2 py-1.5 text-right font-medium">Stock (kg)</th>
              <th className="px-2 py-1.5 text-right font-medium">CMUP (MAD)</th>
              <th className="px-2 py-1.5 text-right font-medium">Catalogue (MAD)</th>
              <th className="px-2 py-1.5 text-right font-medium">Ecart</th>
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

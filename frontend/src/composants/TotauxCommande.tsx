/**
 * Les totaux d'un bon de commande : ce qu'on commande, et ce que cela coute.
 *
 * DES QUANTITES ET UN MONTANT HORS TAXES, rien de plus. Le brut, la remise
 * negociee et le net sont des conditions d'ACHAT — c'est la qu'on les negocie,
 * et le net est ce qui valorisera le stock a la reception. La TVA et le TTC
 * appartiennent a la facture du fournisseur, donc a la comptabilite : les
 * afficher ici laisserait croire qu'on paie sur le bon.
 *
 * L'equivalent en dirhams se calcule au taux ENGAGE du bon (RG-09), le seul
 * qui fasse foi tant que le bon court. Sans taux — un bon pas encore cree —
 * la ligne ne s'affiche pas plutot que d'afficher un montant faux.
 */
import type { ReactNode } from 'react'
import { brutDe, kgDe, totalDe, type LigneSaisie } from './GrilleLignes'
import { fmt } from '../lib/utils'

export function TotauxCommande({
  lignes,
  devise,
  taux,
}: {
  lignes: LigneSaisie[]
  devise: string
  taux?: number | null
}) {
  if (lignes.length === 0) return null
  const somme = (f: (l: LigneSaisie) => number) => lignes.reduce((s, l) => s + f(l), 0)
  const nombre = (v: string) => {
    const n = Number(v)
    return v.trim() !== '' && Number.isFinite(n) ? n : 0
  }
  const brut = somme(brutDe)
  const net = somme(totalDe)
  const remise = brut - net
  const argent = (v: number) => `${fmt.nombre(v, 2)} ${devise}`

  const cases: [string, ReactNode][] = [
    ['Poids commandé', `${fmt.nombre(somme((l) => kgDe(l) ?? 0), 2)} kg`],
    ['Palettes', fmt.nombre(somme((l) => nombre(l.palettes)), 2)],
    ['Bobines', fmt.nombre(somme((l) => nombre(l.bobines)), 0)],
    ['Montant brut', argent(brut)],
    ['Remise', remise > 0.005 ? <span className="text-succes">− {argent(remise)}</span> : '—'],
    ['Net HT', <span className="text-primaire">{argent(net)}</span>],
  ]
  if (taux && taux > 0 && devise !== 'MAD') cases.push(['Soit, au taux engagé', fmt.mad(net * taux)])

  return (
    <div className="border-t border-bordure px-3 py-2">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4 lg:grid-cols-7">
        {cases.map(([libelle, contenu]) => (
          <div key={libelle}>
            <dt className="text-[11px] uppercase tracking-wider text-attenue-texte">{libelle}</dt>
            <dd className="font-medium tabular-nums">{contenu}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

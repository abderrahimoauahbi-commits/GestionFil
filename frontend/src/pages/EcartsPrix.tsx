/**
 * LES ECARTS DE PRIX (audit v5, F18). La valorisation en deux temps porte au
 * CMUP ce qui reste en stock ; la part d'une facture, d'un frais, d'un avoir ou
 * d'un retour qui revenait a des kilos deja sortis n'est dans aucun stock. Elle
 * est journalisee « consomme » : ce rapport la donne a lire, par periode, par
 * reference et par fournisseur. Un montant positif est un surcout, negatif un
 * gain.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Chargement, Etiq } from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'

interface LigneEcart {
  circuit: 'LOCAL' | 'IMPORT'
  id_ajustement: string
  date_ecart: string
  document: string
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  origine: string | null
  numero_piece: string | null
  motif: string | null
  montant_mad?: number | null
}

interface Rapport {
  lignes: LigneEcart[]
  par_reference: { code_reference: string; designation: string | null; nb: number; montant_mad?: number | null }[]
  par_fournisseur: { code_fournisseur: string | null; fournisseur_nom: string | null; nb: number; montant_mad?: number | null }[]
}

const ORIGINE: Record<string, string> = {
  CLOTURE: 'Facture',
  FRAIS: 'Frais',
  AVOIR: 'Avoir',
  AVOIR_PRIX: 'Avoir de prix',
  AVOIR_RETOUR: 'Avoir pour retour',
  FACTURE_NETTE: 'Facture nette',
}

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const montant = (v: number | null | undefined) =>
  v == null ? '—' : <span className={cn('tabular-nums', v > 0 ? 'text-danger' : v < 0 ? 'text-succes' : '')}>{fmt.nombre(v, 2)}</span>

export function EcartsPrix() {
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  const q = useQuery({
    queryKey: ['ecarts-prix', du, au],
    queryFn: ({ signal }) => api.get<Rapport>(`/api/ecarts-prix?du=${encodeURIComponent(du)}&au=${encodeURIComponent(au)}`, { signal }),
  })
  const total = (q.data?.lignes ?? []).reduce((t, l) => t + (l.montant_mad ?? 0), 0)

  return (
    <Carte className="mt-3">
      <CarteEntete className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <CarteTitre>Écarts de prix, hors CMUP</CarteTitre>
          <p className="text-[12px] text-attenue-texte">
            La part des factures, frais et avoirs qui revenait à des kilos déjà sortis. Positif : surcoût ; négatif : gain.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="space-y-1">
            <Etiq>Du</Etiq>
            <Champ type="date" value={du} onChange={(e) => setDu(e.target.value)} />
          </label>
          <label className="space-y-1">
            <Etiq>Au</Etiq>
            <Champ type="date" value={au} onChange={(e) => setAu(e.target.value)} />
          </label>
        </div>
      </CarteEntete>
      <CarteCorps className="space-y-4">
        {q.isLoading ? (
          <Chargement />
        ) : !q.data || q.data.lignes.length === 0 ? (
          <p className="text-[12.5px] text-attenue-texte">Aucun écart de prix sur la période : tout a été porté au CMUP.</p>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Totaux titre="Par référence" lignes={q.data.par_reference.map((r) => ({ cle: r.code_reference, libelle: r.code_reference, nb: r.nb, montant: r.montant_mad }))} />
              <Totaux titre="Par fournisseur" lignes={q.data.par_fournisseur.map((r) => ({ cle: r.code_fournisseur ?? '—', libelle: r.fournisseur_nom ?? r.code_fournisseur ?? '—', nb: r.nb, montant: r.montant_mad }))} />
            </div>
            <div className="defilement-x">
              <table className="w-full min-w-[44rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-bordure text-left">
                    <th className={th}>Date</th>
                    <th className={th}>Document</th>
                    <th className={th}>Référence</th>
                    <th className={th}>Origine</th>
                    <th className={th}>Pièce, motif</th>
                    <th className={cn(th, 'text-right')}>Montant (DH)</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.lignes.map((l) => (
                    <tr key={l.id_ajustement} className="border-b border-bordure/60">
                      <td className="px-2 py-1 tabular-nums">{fmt.date(l.date_ecart)}</td>
                      <td className="px-2 py-1">
                        <span className="font-medium">{l.document}</span>{' '}
                        <span className="text-[11px] text-attenue-texte">{l.circuit === 'IMPORT' ? 'import' : 'local'}</span>
                      </td>
                      <td className="px-2 py-1">{l.code_reference}</td>
                      <td className="px-2 py-1">{ORIGINE[l.origine ?? ''] ?? l.origine ?? '—'}</td>
                      <td className="px-2 py-1 text-attenue-texte">{[l.numero_piece, l.motif].filter(Boolean).join(' — ')}</td>
                      <td className="px-2 py-1 text-right">{montant(l.montant_mad)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={5} className="px-2 py-1.5">Total de la période</td>
                    <td className="px-2 py-1.5 text-right">{montant(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </CarteCorps>
    </Carte>
  )
}

function Totaux({ titre, lignes }: { titre: string; lignes: { cle: string; libelle: string; nb: number; montant?: number | null }[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">{titre}</p>
      <ul className="space-y-0.5 text-[12.5px]">
        {lignes.slice(0, 8).map((l) => (
          <li key={l.cle} className="flex gap-3">
            <span className="min-w-0 truncate">{l.libelle}</span>
            <span className="text-attenue-texte">{l.nb}</span>
            <span className="ml-auto">{montant(l.montant)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

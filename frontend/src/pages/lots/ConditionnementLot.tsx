/**
 * LE CONDITIONNEMENT D'UN LOT, sur sa fiche (23/10/2026).
 *
 * « Si un lot a une modification des poids de bobine, tout sera faux, et même
 * pour les nb palettes. » Le lot porte son poids de bobine et ses bobines par
 * palette — mesurés à la réception, à défaut ceux de la fiche article — et
 * c'est avec eux que ses palettes, bobines et kilos se convertissent partout.
 *
 * Il SE CORRIGE ICI, sur la page, pas dans une fenêtre : une décision sur le
 * lot (droit VALIDER sur les lots), motivée, inscrite au journal du
 * conditionnement (immuable) et à l'audit. Une réception suivante ne l'écrase
 * pas : sa mesure est notée, non appliquée.
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'

import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Etiq, SaisieNombre } from '../../composants/ui/base'
import { lireNombre } from '../../lib/nombres'
import { cn, fmt } from '../../lib/utils'
import { MODULE_DECISION, messageErreur, nb, useApresDecision, type Lot } from './modele'

/** Une ligne du journal du conditionnement du lot. */
export interface MesureConditionnement {
  date_evenement: string
  source: 'RECEPTION' | 'CORRECTION'
  document: string | null
  poids_avant: number | null
  poids_mesure: number | null
  poids_apres: number | null
  bobines_palette_avant: number | null
  bobines_palette_mesure: number | null
  bobines_palette_apres: number | null
  applique: boolean
  motif: string
  utilisateur: string | null
}

const ORIGINES: Record<string, string> = {
  RECEPTION: 'mesuré à la réception',
  HISTORIQUE: 'repris de l’historique des réceptions',
  MOUVEMENT: 'repris des entrées du lot',
  FICHE_ARTICLE: 'fiche article',
  CORRECTION: 'corrigé à la main',
}

const origine = (o: string | null | undefined) => (o ? (ORIGINES[o] ?? o) : 'aucune')

export function ConditionnementLot({ lot, historique }: { lot: Lot; historique: MesureConditionnement[] }) {
  const { peut } = useAuth()
  const peutCorriger = peut(MODULE_DECISION, 'VALIDER')
  const apres = useApresDecision()
  const [poids, setPoids] = useState('')
  const [parPalette, setParPalette] = useState('')
  const [motif, setMotif] = useState('')

  const corriger = useMutation({
    mutationFn: () =>
      api.post('/api/lots/conditionnement', {
        code_reference: lot.code_reference,
        lot_fournisseur: lot.lot_fournisseur,
        poids_bobine_kg: poids.trim() ? lireNombre(poids) : null,
        bobines_par_palette: parPalette.trim() ? Math.round(lireNombre(parPalette) ?? 0) : null,
        motif: motif.trim(),
      }),
    onSuccess: async () => {
      setPoids('')
      setParPalette('')
      setMotif('')
      await apres()
      toast.success('Conditionnement du lot corrigé')
    },
    onError: (e) => toast.error(messageErreur(e)),
  })

  const poidsLu = poids.trim() ? lireNombre(poids) : null
  const parPaletteLu = parPalette.trim() ? lireNombre(parPalette) : null
  const manque =
    !poids.trim() && !parPalette.trim()
      ? 'Indiquez le poids d’une bobine ou les bobines par palette.'
      : poids.trim() && !(poidsLu !== null && poidsLu > 0)
        ? 'Le poids d’une bobine est un nombre de kilos positif.'
        : parPalette.trim() && !(parPaletteLu !== null && parPaletteLu > 0 && Number.isInteger(parPaletteLu))
          ? 'Les bobines par palette sont un nombre entier positif.'
          : !motif.trim()
            ? 'Dites pourquoi vous corrigez (pesée de contrôle, comptage…).'
            : null

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Conditionnement du lot</CarteTitre>
      </CarteEntete>
      <CarteCorps className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-attenue-texte">Poids d’une bobine</div>
            <div className="mt-0.5 text-[13px] tabular-nums">
              {lot.poids_bobine_kg == null ? '—' : `${nb(lot.poids_bobine_kg, 4)} kg`}
              <span className="ml-1 text-[11px] text-attenue-texte">({origine(lot.origine_poids_bobine)})</span>
            </div>
            <div className="text-[11px] text-attenue-texte tabular-nums">
              fiche article : {lot.poids_catalogue_bobine_kg == null ? '—' : `${nb(lot.poids_catalogue_bobine_kg, 4)} kg`}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-attenue-texte">Bobines par palette</div>
            <div className="mt-0.5 text-[13px] tabular-nums">
              {lot.bobines_par_palette == null ? '—' : nb(lot.bobines_par_palette)}
              <span className="ml-1 text-[11px] text-attenue-texte">({origine(lot.origine_bobines_palette)})</span>
            </div>
            <div className="text-[11px] text-attenue-texte tabular-nums">
              fiche article : {lot.bobines_par_palette_catalogue == null ? '—' : nb(lot.bobines_par_palette_catalogue)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-attenue-texte">Une palette du lot</div>
            <div className="mt-0.5 text-[13px] tabular-nums">
              {lot.poids_bobine_kg != null && lot.bobines_par_palette != null
                ? `${nb(lot.poids_bobine_kg * lot.bobines_par_palette, 1)} kg`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-attenue-texte">Depuis le</div>
            <div className="mt-0.5 text-[13px]">{lot.date_conditionnement ? fmt.date(lot.date_conditionnement) : '—'}</div>
          </div>
        </div>

        {peutCorriger && (
          <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-bordure p-2">
            <div className="w-32">
              <Etiq htmlFor="cl-poids">Poids d’une bobine (kg)</Etiq>
              <SaisieNombre id="cl-poids" min={0} step={0.001} value={poids} onChange={(e) => setPoids(e.target.value)}
                            placeholder={lot.poids_bobine_kg == null ? '' : String(lot.poids_bobine_kg)} />
            </div>
            <div className="w-32">
              <Etiq htmlFor="cl-bpp">Bobines par palette</Etiq>
              <SaisieNombre id="cl-bpp" min={0} step={1} value={parPalette} onChange={(e) => setParPalette(e.target.value)}
                            placeholder={lot.bobines_par_palette == null ? '' : String(lot.bobines_par_palette)} />
            </div>
            <div className="min-w-[14rem] flex-1">
              <Etiq htmlFor="cl-motif">Motif</Etiq>
              <Champ id="cl-motif" value={motif} onChange={(e) => setMotif(e.target.value)}
                     placeholder="Pesée de contrôle, comptage d’une palette…" />
            </div>
            <Bouton disabled={!!manque} chargement={corriger.isPending} onClick={() => corriger.mutate()} title={manque ?? undefined}>
              <Save />
              Corriger
            </Bouton>
            {manque && (poids || parPalette || motif) && (
              <span className="w-full text-[11px] text-attenue-texte">{manque}</span>
            )}
          </div>
        )}

        {historique.length > 0 && (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-attenue/60 text-[10px] uppercase tracking-wide text-attenue-texte">
                <th className="px-2 py-1 text-left font-medium">Date</th>
                <th className="px-2 py-1 text-left font-medium">Source</th>
                <th className="px-2 py-1 text-right font-medium">Poids (kg)</th>
                <th className="px-2 py-1 text-right font-medium">Bob./palette</th>
                <th className="px-2 py-1 text-left font-medium">Motif</th>
              </tr>
            </thead>
            <tbody>
              {historique.map((h, i) => (
                <tr key={i} className={cn('border-t border-bordure/60', !h.applique && 'text-attenue-texte')}>
                  <td className="px-2 py-1 tabular-nums">{fmt.date(h.date_evenement)}</td>
                  <td className="px-2 py-1">
                    {h.source === 'CORRECTION' ? 'Correction' : `Réception ${h.document ?? ''}`}
                    {h.utilisateur && <span className="text-attenue-texte"> — {h.utilisateur}</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {nb(h.poids_avant, 4)} → {nb(h.poids_apres, 4)}
                    {h.poids_mesure != null && h.poids_mesure !== h.poids_apres && (
                      <span className="block text-[11px]">mesuré {nb(h.poids_mesure, 4)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {nb(h.bobines_palette_avant)} → {nb(h.bobines_palette_apres)}
                    {h.bobines_palette_mesure != null && h.bobines_palette_mesure !== h.bobines_palette_apres && (
                      <span className="block text-[11px]">observé {nb(h.bobines_palette_mesure)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">{h.motif}{!h.applique && ' (non appliquée)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CarteCorps>
    </Carte>
  )
}

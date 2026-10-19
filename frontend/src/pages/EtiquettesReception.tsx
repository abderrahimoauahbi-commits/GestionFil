/**
 * LES ETIQUETTES DE LOT D'UNE RECEPTION (audit P3, 19/10/2026).
 *
 * Une etiquette par bobine ou par palette, a coller sur la marchandise au
 * quai. Elle porte un code court en Code 128 (« E000001234 ») : a la sortie et
 * au chargement machine, la douchette le lit et l'ecran retrouve la reference
 * et le lot en base — on ne les tape plus.
 *
 * Generer ne fabrique que ce qui manque : une ligne deja etiquetee garde ses
 * codes (ceux qui sont colles n'auraient plus de double), et la page sert
 * alors a REIMPRIMER. Le nombre vient du colisage compte sur le quai, a
 * defaut du theorique du catalogue.
 *
 * Deux formats : la planche A4 de 3 x 8 (etiquettes 70 x 37 mm, les plus
 * courantes) et le rouleau d'une imprimante thermique (100 x 50 mm, une
 * etiquette par page).
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer, Tags } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Bouton, Chargement, Selecteur } from '../composants/ui/base'
import { barres } from '../lib/code128'
import { cn, fmt } from '../lib/utils'

interface Etiquette {
  code: string
  nature: 'BOBINE' | 'PALETTE'
  rang: number
  nombre: number
  poids_kg: number | null
  code_reference: string
  designation: string | null
  lot_fournisseur: string | null
  code_magasin_dest: string | null
  numero_reception: string
  date_reception: string | null
  code_fournisseur: string | null
}

interface Planche {
  nature: 'BOBINE' | 'PALETTE'
  etiquettes: Etiquette[]
  lignes_sans_etiquette: { ligne_numero: number; code_reference: string; nombre: number | null }[]
  max_par_ligne: number
}

type Format = 'A4' | 'ROULEAU'

/** Le code-barres en SVG : la largeur suit la boite, la hauteur est fixe. */
export function CodeBarres({ texte, hauteur = 40 }: { texte: string; hauteur?: number }) {
  const { barres: b, largeur } = barres(texte)
  return (
    <svg
      viewBox={`0 0 ${largeur} ${hauteur}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
      role="img"
      aria-label={`Code-barres ${texte}`}
    >
      {b.map((x) => (
        <rect key={x.x} x={x.x} y={0} width={x.l} height={hauteur} fill="currentColor" />
      ))}
    </svg>
  )
}

function Vignette({ e, format }: { e: Etiquette; format: Format }) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-surface text-surface-texte print:bg-transparent',
        format === 'A4'
          ? 'h-[37mm] w-[70mm] px-[3mm] py-[2mm] text-[7.5pt] leading-tight'
          : 'h-[50mm] w-[100mm] px-[4mm] py-[3mm] text-[10pt] leading-snug',
      )}
      style={{ breakInside: 'avoid' }}
    >
      <div className="truncate font-semibold">{e.designation ?? e.code_reference}</div>
      <div className="flex justify-between gap-2">
        <span className="truncate">Lot {e.lot_fournisseur ?? '—'}</span>
        <span className="shrink-0">
          {e.nature === 'BOBINE' ? 'Bobine' : 'Palette'} {e.rang}/{e.nombre}
        </span>
      </div>
      <div className={cn('my-[1mm] min-h-0 flex-1', format === 'A4' ? 'mx-[2mm]' : 'mx-[4mm]')}>
        <CodeBarres texte={e.code} />
      </div>
      <div className="flex justify-between gap-2">
        <span className="font-mono font-semibold tracking-wider">{e.code}</span>
        <span className="truncate">
          {e.poids_kg != null && `≈ ${fmt.nombre(e.poids_kg, 1)} kg · `}
          {e.numero_reception}
        </span>
      </div>
    </div>
  )
}

export function EtiquettesReception() {
  const { id = '' } = useParams()
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const droits = useDroits('RECEPTIONS')
  const [nature, setNature] = useState<'BOBINE' | 'PALETTE'>('BOBINE')
  const [format, setFormat] = useState<Format>('A4')

  const q = useQuery({
    queryKey: ['etiquettes-reception', id, nature],
    queryFn: ({ signal }) =>
      api.get<Planche>(`/api/receptions/${encodeURIComponent(id)}/etiquettes?nature=${nature}`, { signal }),
  })
  const generer = useMutation({
    mutationFn: () =>
      api.post<Planche>(`/api/receptions/${encodeURIComponent(id)}/etiquettes`, { nature }),
    onSuccess: (p) => {
      qc.setQueryData(['etiquettes-reception', id, nature], p)
      toast.success(`${p.etiquettes.length} étiquette(s) prête(s) à imprimer`)
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Génération impossible.'),
  })

  const p = q.data
  const etiquettes = p?.etiquettes ?? []
  const manquantes = p?.lignes_sans_etiquette ?? []

  return (
    <div>
      {/* LE FORMAT DE LA PAGE suit celui des etiquettes : planche A4 a marges
          etroites, ou une etiquette par page sur le rouleau. */}
      <style>
        {format === 'A4'
          ? '@media print { @page { size: A4; margin: 0; } }'
          : '@media print { @page { size: 100mm 50mm; margin: 0; } }'}
      </style>
      <div className="sans-impression">
        <EnTetePage
          titre={`Étiquettes — ${etiquettes[0]?.numero_reception ?? 'réception'}`}
          description="Une étiquette par bobine ou par palette : on la scanne à la sortie et au chargement machine."
          actions={
            <>
              <Bouton variante="contour" onClick={() => naviguer(`/receptions/${encodeURIComponent(id)}`)}>
                <ArrowLeft />
                Retour
              </Bouton>
              {droits.peutEcrire && manquantes.some((l) => (l.nombre ?? 0) > 0) && (
                <Bouton variante="contour" chargement={generer.isPending} onClick={() => generer.mutate()}>
                  <Tags />
                  Générer les étiquettes manquantes
                </Bouton>
              )}
              <Bouton disabled={etiquettes.length === 0} onClick={() => window.print()}>
                <Printer />
                Imprimer
              </Bouton>
            </>
          }
        />
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-[12px]">
            <span className="mb-1 block text-attenue-texte">Une étiquette par</span>
            <Selecteur value={nature} onChange={(e) => setNature(e.target.value as 'BOBINE' | 'PALETTE')}>
              <option value="BOBINE">Bobine</option>
              <option value="PALETTE">Palette</option>
            </Selecteur>
          </label>
          <label className="text-[12px]">
            <span className="mb-1 block text-attenue-texte">Format</span>
            <Selecteur value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              <option value="A4">Planche A4 — 3 × 8 (70 × 37 mm)</option>
              <option value="ROULEAU">Rouleau thermique — 100 × 50 mm</option>
            </Selecteur>
          </label>
        </div>
        {q.isLoading && <Chargement />}
        {manquantes.length > 0 && (
          <Alerte ton="alerte" className="mb-3">
            {manquantes.map((l) => (
              <div key={l.ligne_numero}>
                Ligne {l.ligne_numero} ({l.code_reference}) :{' '}
                {l.nombre == null || l.nombre <= 0
                  ? 'colisage inconnu — comptez les bobines sur la ligne, ou complétez le poids de bobine du catalogue.'
                  : l.nombre > (p?.max_par_ligne ?? 5000)
                    ? `${fmt.nombre(l.nombre, 0)} étiquettes : au-delà de ${p?.max_par_ligne}, vérifiez le colisage.`
                    : `${fmt.nombre(l.nombre, 0)} étiquette(s) à générer.`}
              </div>
            ))}
          </Alerte>
        )}
        {!q.isLoading && etiquettes.length === 0 && manquantes.length === 0 && (
          <Alerte ton="info">Cette réception n’a pas de ligne à étiqueter.</Alerte>
        )}
      </div>

      <div
        className={cn(
          'zone-impression',
          format === 'A4'
            ? 'grid grid-cols-[repeat(auto-fill,70mm)] auto-rows-[37mm] content-start gap-0'
            : 'flex flex-col items-start gap-2',
        )}
      >
        {etiquettes.map((e) => (
          <div key={e.code} className={cn(format === 'ROULEAU' && 'break-after-page border border-bordure print:border-0')}>
            <Vignette e={e} format={format} />
          </div>
        ))}
      </div>
    </div>
  )
}

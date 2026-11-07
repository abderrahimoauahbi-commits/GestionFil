/**
 * LE CHAMP DE SCAN D'UNE ETIQUETTE DE LOT (audit P3, 19/10/2026).
 *
 * Une douchette USB ou Bluetooth se comporte comme un clavier : elle « tape »
 * le code puis Entree. Ce champ attend donc Entree, relit l'etiquette au
 * serveur (`GET /api/etiquettes/{code}`) et la confie a l'ecran, qui ajoute
 * ou complete sa ligne. Le champ se vide et garde le focus : on enchaine les
 * bobines sans toucher la souris.
 *
 * UNE ETIQUETTE NE SE COMPTE QU'UNE FOIS PAR DOCUMENT : la meme bobine passee
 * deux fois devant la douchette est refusee, avec son code. C'est l'erreur la
 * plus banale d'un quai, et la plus difficile a retrouver ensuite.
 */
import { useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { cn } from '../lib/utils'

export interface EtiquetteLue {
  code: string
  nature: 'BOBINE' | 'PALETTE'
  rang: number
  nombre: number
  poids_kg: number | null
  code_reference: string
  designation: string | null
  lot_fournisseur: string | null
  /** Le derive de la bobine (06/11/2026) : celui de sa ligne de reception, sinon
      le seul du lot ; vide quand le lot en a plusieurs et que l'etiquette, plus
      ancienne, ne le dit pas — l'ecran le demande alors. */
  code_derive: string | null
  nb_derives: number | null
  code_magasin_dest: string | null
  numero_reception: string
  statut_reception: string
  unite_catalogue: string | null
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  bobines_par_lot: number | null
  densite_kg_ml: number | null
  suivi_lot: number
}

export function ChampScan({
  surLecture,
  className,
  libelle = 'Scanner une étiquette',
}: {
  /** Rend un message d'erreur si l'ecran refuse l'etiquette ; rien sinon. */
  surLecture: (e: EtiquetteLue) => string | void | Promise<string | void>
  className?: string
  libelle?: string
}) {
  const [valeur, setValeur] = useState('')
  const [occupe, setOccupe] = useState(false)
  const lues = useRef(new Set<string>())

  async function lire() {
    const code = valeur.trim().toUpperCase()
    if (!code || occupe) return
    setValeur('')
    if (lues.current.has(code)) {
      toast.warning(`Étiquette ${code} déjà scannée sur ce document.`)
      return
    }
    setOccupe(true)
    try {
      const e = await api.get<EtiquetteLue>(`/api/etiquettes/${encodeURIComponent(code)}`)
      const refus = await surLecture(e)
      if (refus) {
        toast.error(refus)
        return
      }
      lues.current.add(code)
      toast.success(
        `${e.designation ?? e.code_reference} — lot ${e.lot_fournisseur ?? '—'}` +
          `${(e.nb_derives ?? 0) > 1 && e.code_derive ? ` ${e.code_derive}` : ''} · ` +
          `${e.nature === 'BOBINE' ? 'bobine' : 'palette'} ${e.rang}/${e.nombre}`,
      )
    } catch (err) {
      toast.error(
        err instanceof ErreurApi && err.statut === 404
          ? `Étiquette ${code} inconnue : elle n’a pas été imprimée par l’ERP.`
          : err instanceof ErreurApi
            ? err.message
            : 'Lecture impossible.',
      )
    } finally {
      setOccupe(false)
    }
  }

  return (
    <label className={cn('flex items-center gap-2', className)}>
      <ScanLine className="size-4 shrink-0 text-attenue-texte" aria-hidden />
      <span className="sr-only">{libelle}</span>
      <input
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void lire()
          }
        }}
        placeholder={`${libelle} (E000001234)`}
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        className="h-9 w-full min-w-0 rounded-[var(--radius)] border border-champ bg-surface px-2 font-mono text-[13px] outline-none focus:border-anneau"
        aria-busy={occupe}
      />
    </label>
  )
}

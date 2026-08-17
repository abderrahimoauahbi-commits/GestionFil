/**
 * Recu imprimable d'un transfert : bon de SORTIE ou bon de RECEPTION.
 *
 * Deux documents pour un meme transfert, parce qu'ils servent a deux moments et
 * a deux personnes :
 *
 *   Le BON DE SORTIE part avec le camion. Il dit ce qui a ete charge, qui en
 *   repond, et laisse une place a signer au depart.
 *
 *   Le BON DE RECEPTION se remplit au dechargement. Il porte les memes lignes,
 *   avec une colonne VIDE pour noter ce qu'on compte reellement — c'est en
 *   comparant que l'on decouvre un manque, pas en relisant un chiffre deja
 *   imprime.
 *
 * L'impression passe par la feuille de style du navigateur : `@media print`
 * masque toute l'application autour du document. Pas de PDF genere cote serveur,
 * donc rien a maintenir en double, et le document imprime est exactement celui
 * qu'on voit a l'ecran.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { api } from '../api/client'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Bouton, Chargement } from '../composants/ui/base'
import { fmt } from '../lib/utils'

interface Entete extends Record<string, unknown> {
  numero_transfert: string
  date_transfert: string
  date_sortie: string | null
  date_reception_dest: string | null
  code_magasin_source: string
  magasin_source_nom: string | null
  code_magasin_dest: string
  magasin_dest_nom: string | null
  responsable: string | null
  transporteur: string | null
  observations: string | null
  statut: string
  expediteur: string | null
  receptionnaire: string | null
  nb_lignes: number
  quantite_totale_kg: number
  bobines_totales: number
  palettes_totales: number
  jours_en_transit: number | null
}

interface Ligne extends Record<string, unknown> {
  ligne_numero: number
  code_reference: string
  designation: string
  couleur: string | null
  quantite_kg: number
  quantite_saisie: number | null
  unite_saisie: string | null
  nb_bobines: number | null
  nb_palettes: number | null
  lot_fournisseur: string | null
}

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'En preparation',
  VALIDE: 'En transit',
  TERMINE: 'Recu',
  ANNULE: 'Annule',
}

export function BonTransfert({ type }: { type: 'sortie' | 'reception' }) {
  const { id = '' } = useParams()
  const naviguer = useNavigate()

  const q = useQuery({
    queryKey: ['dossier-transfert', id],
    queryFn: () => api.get<{ entete: Entete; lignes: Ligne[] }>(`/api/transferts/${id}`),
    enabled: !!id,
  })

  if (q.isLoading) return <Chargement />
  if (!q.data?.entete) {
    return (
      <div>
        <EnTetePage titre="Bon de transfert" description="Introuvable." />
        <Alerte ton="alerte">
          Ce transfert n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/transferts')}>
            Revenir a la liste
          </button>
        </Alerte>
      </div>
    )
  }

  const { entete: e, lignes } = q.data
  const sortie = type === 'sortie'
  const titre = sortie ? 'BON DE SORTIE' : 'BON DE RECEPTION'

  return (
    <div>
      {/* Barre d'actions : elle ne s'imprime pas. */}
      <div className="impression-masquee">
        <EnTetePage
          titre={sortie ? 'Bon de sortie' : 'Bon de reception'}
          description={`${e.numero_transfert} · ${LIBELLE_STATUT[e.statut] ?? e.statut}`}
          actions={
            <>
              <Bouton variante="contour" onClick={() => naviguer('/transferts')}>
                <ArrowLeft />
                Retour
              </Bouton>
              <Bouton onClick={() => window.print()}>
                <Printer />
                Imprimer
              </Bouton>
            </>
          }
        />

        {!sortie && e.statut === 'BROUILLON' && (
          <Alerte ton="alerte" className="mb-3">
            Ce transfert n'a pas encore ete expedie. Le bon de reception s'imprime pour preparer le
            dechargement, mais rien n'est parti du magasin source.
          </Alerte>
        )}
      </div>

      {/* ---- Le document ------------------------------------------------- */}
      <div className="zone-impression mx-auto max-w-[210mm] bg-white p-8 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <div className="text-lg font-bold tracking-tight">POLYFASHIONS CARPET MOROCCO</div>
            <div className="text-[11px]">Fabrication de tapis mecaniques</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{titre}</div>
            <div className="font-mono text-[13px]">{e.numero_transfert}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-[12px]">
          <Champ2 libelle="Magasin expediteur" valeur={`${e.magasin_source_nom ?? ''} (${e.code_magasin_source})`} />
          <Champ2 libelle="Magasin destinataire" valeur={`${e.magasin_dest_nom ?? ''} (${e.code_magasin_dest})`} />
          <Champ2 libelle="Date du document" valeur={fmt.date(e.date_transfert)} />
          <Champ2
            libelle="Date de sortie"
            valeur={e.date_sortie ? fmt.date(e.date_sortie) : '— non expedie —'}
          />
          <Champ2 libelle="Responsable" valeur={e.responsable ?? '—'} />
          <Champ2
            libelle={sortie ? 'Transporteur' : "Date d'arrivee"}
            valeur={
              sortie
                ? (e.transporteur ?? '—')
                : e.date_reception_dest
                  ? fmt.date(e.date_reception_dest)
                  : '— a constater —'
            }
          />
          <Champ2 libelle="Expedie par" valeur={e.expediteur ?? '—'} />
          <Champ2 libelle="Recu par" valeur={e.receptionnaire ?? '— a constater —'} />
        </div>

        <table className="mt-5 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-black">
              <th className="w-8 py-1.5 text-right">#</th>
              <th className="py-1.5 text-left">Reference / designation</th>
              <th className="w-28 py-1.5 text-left">Lot</th>
              <th className="w-16 py-1.5 text-right">Bob.</th>
              <th className="w-16 py-1.5 text-right">Pal.</th>
              <th className="w-24 py-1.5 text-right">Poids (kg)</th>
              {!sortie && <th className="w-28 py-1.5 text-right">Recu (kg)</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.ligne_numero} className="border-b border-neutral-300">
                <td className="py-1.5 text-right tabular-nums">{l.ligne_numero}</td>
                <td className="py-1.5">
                  <div className="font-medium">{l.code_reference}</div>
                  <div className="text-[10px] text-neutral-600">
                    {l.designation}
                    {l.couleur && ` · ${l.couleur}`}
                  </div>
                </td>
                <td className="py-1.5 font-mono text-[10px]">{l.lot_fournisseur ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums">{l.nb_bobines ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums">{l.nb_palettes ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt.nombre(l.quantite_kg, 2)}</td>
                {/* Colonne VOLONTAIREMENT vide : c'est en comptant sur place, sans
                    voir le chiffre attendu, qu'on decouvre un manque. */}
                {!sortie && <td className="border-l border-neutral-300 py-1.5"></td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-y-2 border-black font-bold">
              <td colSpan={3} className="py-2 text-right">
                TOTAL — {e.nb_lignes} ligne(s)
              </td>
              <td className="py-2 text-right tabular-nums">{e.bobines_totales || '—'}</td>
              <td className="py-2 text-right tabular-nums">{e.palettes_totales || '—'}</td>
              <td className="py-2 text-right tabular-nums">
                {fmt.nombre(e.quantite_totale_kg, 2)}
              </td>
              {!sortie && <td className="border-l border-neutral-300 py-2"></td>}
            </tr>
          </tfoot>
        </table>

        {e.observations && (
          <div className="mt-4 text-[11px]">
            <span className="font-semibold">Observations : </span>
            {e.observations}
          </div>
        )}

        {!sortie && (
          <p className="mt-4 text-[10px] italic text-neutral-600">
            Portez dans la colonne « Recu » ce que vous comptez reellement, avant de comparer au
            poids annonce. Tout ecart doit etre signale avant de constater la reception dans
            l'application.
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-8 text-[11px]">
          <Signature
            titre={sortie ? "Responsable de l'expedition" : 'Chauffeur / transporteur'}
            nom={sortie ? (e.expediteur ?? '') : (e.transporteur ?? '')}
          />
          <Signature
            titre={sortie ? 'Chauffeur / transporteur' : 'Responsable de la reception'}
            nom={sortie ? (e.transporteur ?? '') : (e.receptionnaire ?? '')}
          />
        </div>

        <div className="mt-6 border-t border-neutral-300 pt-2 text-[9px] text-neutral-500">
          Document emis par ERP Gestion Fil · {e.numero_transfert} ·{' '}
          {LIBELLE_STATUT[e.statut] ?? e.statut}
          {e.jours_en_transit != null && ` · ${e.jours_en_transit} j de transit`}
        </div>
      </div>
    </div>
  )
}

function Champ2({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 font-semibold">{libelle}</span>
      <span className="min-w-0 flex-1 border-b border-dotted border-neutral-400">{valeur}</span>
    </div>
  )
}

function Signature({ titre, nom }: { titre: string; nom: string }) {
  return (
    <div>
      <div className="font-semibold">{titre}</div>
      <div className="mt-1 text-[10px] text-neutral-600">{nom || 'Nom :'}</div>
      <div className="mt-10 border-t border-black pt-1 text-[9px] text-neutral-600">
        Date et signature
      </div>
    </div>
  )
}

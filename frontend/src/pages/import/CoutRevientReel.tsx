/**
 * LE COUT DE REVIENT REEL D'UN DOSSIER (09/10/2026, « comme les leaders, sans
 * comptabilite »).
 *
 * Le stock reste au cours du DEDOUANEMENT, comme la comptabilite : le paiement
 * ne touche jamais le CMUP. Ce tableau dit ce que le dossier a vraiment coute
 * en dirhams : matiere au cours du dedouanement, frais, et l'ecart de change
 * constate a chaque paiement — au cours que la banque a applique.
 *
 * Un dossier dedouane une annee et paye la suivante voit son ecart coupe au
 * cours Bank Al-Maghrib du 31/12 : une part pour chaque exercice. Une facture
 * encore impayee d'une annee echue porte son ecart latent de cette annee.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import { Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Selecteur } from '../../composants/ui/base'
import { useConfirmation } from '../../composants/ui/surcouches'
import { cn, fmt } from '../../lib/utils'
import { lireNombre } from '../../lib/nombres'

interface FactureCout {
  id_facture: string
  numero_facture: string
  code_devise: string
  date_ded: string
  annee_ded: number
  montant_devise: number
  cours_ded: number
  matiere_mad: number | null
  frais_mad: number | null
  paye_devise: number
  paye_mad: number | null
  nb_paiements: number
  reste_devise: number
  cours_fin_annee_ded: number | null
  change_annee_ded_mad: number | null
  change_annee_suivante_mad: number | null
  latent: boolean
}

interface Paiement {
  id_paiement: string
  id_facture: string
  numero_facture: string
  date_paiement: string
  montant_devise: number
  montant_mad: number | null
  cours_paiement: number
  ecart_annee_ded_mad: number | null
  ecart_annee_suivante_mad: number | null
  annee_ded: number
  annee_paiement: number
}

const nombre = (v: string) => (lireNombre(v) ?? 0)
const signe = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${fmt.nombre(n, 2)}`)

export function CoutRevientReel({ idDossier }: { idDossier: string }) {
  const qc = useQueryClient()
  const droits = useDroits('IMPORT')
  const confirmation = useConfirmation()
  const q = useQuery({
    queryKey: ['cout-revient-reel', idDossier],
    queryFn: () =>
      api.get<{ factures: FactureCout[]; paiements: Paiement[] }>(`/api/import/dossiers/${idDossier}/cout-revient-reel`),
  })
  const vide = { id_facture: '', date: new Date().toISOString().slice(0, 10), devise: '', mad: '', reference: '' }
  const [p, setP] = useState(vide)
  const rafraichir = () => void qc.invalidateQueries({ queryKey: ['cout-revient-reel', idDossier] })

  const ajouter = useMutation({
    mutationFn: (confirme?: boolean) =>
      api.post<{ id_paiement: string; avis?: string[] }>(`/api/import/factures/${p.id_facture}/paiements`, {
        date_paiement: p.date,
        montant_devise: nombre(p.devise),
        montant_mad: nombre(p.mad),
        reference_banque: p.reference || null,
        taux_confirme: confirme === true,
      }),
    onSuccess: (r) => {
      toast.success('Paiement enregistré')
      // A11 : un paiement daté avant le dédouanement est signalé (C53), pas refusé.
      for (const a of r.avis ?? []) toast.warning(a)
      setP(vide)
      rafraichir()
    },
    onError: (e) => {
      if (e instanceof ErreurApi && e.estRegle('TAUX-ECART')) {
        confirmation.demander({
          titre: 'Cours éloigné de celui de Bank Al-Maghrib',
          description: e.messageSansCode,
          libelleConfirmer: 'C’est le cours de la banque',
          action: () => ajouter.mutate(true),
        })
        return
      }
      toast.error(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.')
    },
  })
  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/import/paiements/${id}`),
    onSuccess: () => {
      toast.success('Paiement supprimé')
      rafraichir()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Suppression impossible.'),
  })

  const factures = q.data?.factures ?? []
  const paiements = q.data?.paiements ?? []
  if (factures.length === 0) return null
  const aCheval = factures.some((f) => f.change_annee_suivante_mad) || paiements.some((x) => x.annee_paiement > x.annee_ded)
  const anneeDed = factures[0]?.annee_ded
  const total = (k: keyof FactureCout) => factures.reduce((s, f) => s + Number(f[k] ?? 0), 0)
  const cout = (f: FactureCout) =>
    Number(f.matiere_mad ?? 0) + Number(f.frais_mad ?? 0) + Number(f.change_annee_ded_mad ?? 0) +
    Number(f.change_annee_suivante_mad ?? 0)
  const td = 'px-2 py-1 text-right tabular-nums'
  const factureChoisie = factures.find((f) => f.id_facture === p.id_facture)
  const cours = nombre(p.mad) / nombre(p.devise)

  return (
    <Carte repliable="dossier-import.cout-reel">
      <CarteEntete>
        <CarteTitre>Coût de revient réel</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        <p className="m-0 text-[12.5px] text-attenue-texte">
          Le stock reste valorisé au cours du dédouanement, comme la comptabilité. Ce tableau ajoute ce que le change a
          coûté (+) ou rapporté (−) à chaque paiement, au cours appliqué par la banque.
          {aCheval && ' Dossier à cheval sur deux exercices : l’écart est coupé au cours BAM du 31/12.'}
        </p>
        <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure">
          <table className="w-full text-[12px]">
            <thead className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
              <tr>
                <th className="px-2 py-1.5 text-left">Facture</th>
                <th className="px-2 py-1.5 text-right">Matière</th>
                <th className="px-2 py-1.5 text-right">Frais</th>
                <th className="px-2 py-1.5 text-right">Change {anneeDed}</th>
                {aCheval && <th className="px-2 py-1.5 text-right">Change {anneeDed + 1}</th>}
                <th className="px-2 py-1.5 text-right">Coût réel</th>
                <th className="px-2 py-1.5 text-right">Reste à payer</th>
              </tr>
            </thead>
            <tbody>
              {factures.map((f) => (
                <tr key={f.id_facture} className="border-t border-bordure/60">
                  <td className="px-2 py-1">
                    {f.numero_facture}
                    <div className="text-[10.5px] text-attenue-texte">
                      {fmt.nombre(f.montant_devise, 2)} {f.code_devise} au cours {fmt.nombre(f.cours_ded, 4)}
                    </div>
                  </td>
                  <td className={td}>{fmt.nombre(f.matiere_mad ?? 0, 2)}</td>
                  <td className={td}>{fmt.nombre(f.frais_mad ?? 0, 2)}</td>
                  <td className={cn(td, (f.change_annee_ded_mad ?? 0) > 0 ? 'text-danger' : (f.change_annee_ded_mad ?? 0) < 0 ? 'text-succes' : '')}>
                    {f.nb_paiements === 0 && !f.latent ? 'non payé' : signe(f.change_annee_ded_mad)}
                    {f.latent && <div className="text-[10.5px] text-attenue-texte">dont latent au 31/12</div>}
                  </td>
                  {aCheval && <td className={td}>{signe(f.change_annee_suivante_mad)}</td>}
                  <td className={cn(td, 'font-semibold')}>{fmt.nombre(cout(f), 2)}</td>
                  <td className={td}>{f.reste_devise > 0.005 ? `${fmt.nombre(f.reste_devise, 2)} ${f.code_devise}` : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-bordure bg-attenue/40 font-semibold">
                <td className="px-2 py-1">Dossier</td>
                <td className={td}>{fmt.nombre(total('matiere_mad'), 2)}</td>
                <td className={td}>{fmt.nombre(total('frais_mad'), 2)}</td>
                <td className={td}>{signe(total('change_annee_ded_mad'))}</td>
                {aCheval && <td className={td}>{signe(total('change_annee_suivante_mad'))}</td>}
                <td className={td}>{fmt.nombre(factures.reduce((s, f) => s + cout(f), 0), 2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {paiements.length > 0 && (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure">
            <table className="w-full text-[12px]">
              <thead className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
                <tr>
                  <th className="px-2 py-1.5 text-left">Paiement</th>
                  <th className="px-2 py-1.5 text-right">Devise payée</th>
                  <th className="px-2 py-1.5 text-right">MAD débités</th>
                  <th className="px-2 py-1.5 text-right">Cours banque</th>
                  <th className="px-2 py-1.5 text-right">Écart</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {paiements.map((x) => (
                  <tr key={x.id_paiement} className="border-t border-bordure/60">
                    <td className="px-2 py-1">
                      {fmt.date(x.date_paiement)} · {x.numero_facture}
                    </td>
                    <td className={td}>{fmt.nombre(x.montant_devise, 2)}</td>
                    <td className={td}>{fmt.nombre(x.montant_mad ?? 0, 2)}</td>
                    <td className={td}>{fmt.nombre(x.cours_paiement, 4)}</td>
                    <td className={td}>
                      {signe((x.ecart_annee_ded_mad ?? 0) + (x.ecart_annee_suivante_mad ?? 0))}
                      {x.annee_paiement > x.annee_ded && (
                        <div className="text-[10.5px] text-attenue-texte">
                          {x.annee_ded} : {signe(x.ecart_annee_ded_mad)} · {x.annee_paiement} : {signe(x.ecart_annee_suivante_mad)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {droits.peutValider && (
                        <Bouton taille="sm" variante="discret" aria-label="Supprimer le paiement"
                          onClick={() =>
                            confirmation.demander({
                              titre: 'Supprimer ce paiement ?',
                              destructif: true,
                              description: 'Il ne touche ni le stock ni le coût moyen ; la suppression reste au journal.',
                              action: () => supprimer.mutate(x.id_paiement),
                            })
                          }>
                          <Trash2 />
                        </Bouton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {droits.peutValider && (
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-6">
            <label className="flex flex-col gap-0.5 text-[11.5px] text-attenue-texte sm:col-span-2">
              Facture payée
              <Selecteur value={p.id_facture} onChange={(e) => setP({ ...p, id_facture: e.target.value })}>
                <option value="">—</option>
                {factures.map((f) => (
                  <option key={f.id_facture} value={f.id_facture}>
                    {f.numero_facture} ({fmt.nombre(f.reste_devise, 2)} {f.code_devise} à payer)
                  </option>
                ))}
              </Selecteur>
            </label>
            <label className="flex flex-col gap-0.5 text-[11.5px] text-attenue-texte">
              Date
              <Champ type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5 text-[11.5px] text-attenue-texte">
              Payé ({factureChoisie?.code_devise ?? 'devise'})
              <Champ inputMode="decimal" className="text-right" value={p.devise} onChange={(e) => setP({ ...p, devise: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5 text-[11.5px] text-attenue-texte">
              MAD débités
              <Champ inputMode="decimal" className="text-right" value={p.mad} onChange={(e) => setP({ ...p, mad: e.target.value })} />
            </label>
            <Bouton
              disabled={!p.id_facture || !(nombre(p.devise) > 0) || !(nombre(p.mad) > 0)}
              chargement={ajouter.isPending}
              onClick={() => ajouter.mutate(false)}
            >
              Enregistrer
            </Bouton>
            {Number.isFinite(cours) && cours > 0 && (
              <div className="text-[11.5px] text-attenue-texte sm:col-span-6">
                Cours appliqué par la banque : {fmt.nombre(cours, 4)}
              </div>
            )}
          </div>
        )}
        {confirmation.element}
      </CarteCorps>
    </Carte>
  )
}

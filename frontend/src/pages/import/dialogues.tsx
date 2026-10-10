/**
 * Ce que les ecrans du dossier d'importation partagent : l'apercu de cloture,
 * le choix des lignes d'un frais cible, la tuile de chiffre, et trois petites
 * aides de saisie.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { Alerte, Bouton, Chargement } from '../../composants/ui/base'
import { cn, fmt } from '../../lib/utils'
import type { Frais, Ligne } from './types'
import { lireNombre } from '../../lib/nombres'

export const echec = (e: unknown) =>
  toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

/** « 12 584,50 » ou « 12584.5 » : les deux se saisissent. */
export const nombre = (s: string | number | null | undefined) =>
  (lireNombre(String(s ?? '')) ?? 0)

/**
 * Tout ce qu'un geste d'import peut changer. Sans dossier, tous les dossiers :
 * une reception peut en toucher plusieurs.
 */
export function useRafraichir(idDossier?: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: idDossier ? ['import-dossier', idDossier] : ['import-dossier'] })
    void qc.invalidateQueries({ queryKey: ['import-dossiers'] })
    void qc.invalidateQueries({ queryKey: ['import-a-recevoir'] })
    void qc.invalidateQueries({ queryKey: ['import-receptions'] })
  }
}

/**
 * « ENREGISTRER TOUT » (demande du 30/09/2026).
 *
 * Chaque partie du dossier — ses informations, l'engagement et le frais en
 * cours de saisie — SE SIGNALE quand elle a quelque chose a enregistrer, et
 * dit comment. Le bouton du haut les enregistre l'une apres l'autre.
 *
 * LES FONCTIONS VIVENT DANS UNE REFERENCE, pas dans l'etat : elles changent a
 * chaque rendu, et les mettre dans l'etat ferait boucler le rendu. L'etat ne
 * retient que les libelles — ce que le bouton affiche.
 *
 * Une partie enregistree se vide (c'est deja le cas de chacune) : un nouvel
 * essai apres un echec partiel ne recree donc jamais ce qui est deja passe.
 */
export type Signaler = (cle: string, a: { libelle: string; enregistrer: () => Promise<unknown> } | null) => void

export function useEnregistrerTout() {
  const fonctions = useRef(new Map<string, () => Promise<unknown>>())
  const [libelles, setLibelles] = useState<Record<string, string>>({})
  const [enCours, setEnCours] = useState(false)

  const signaler = useCallback<Signaler>((cle, a) => {
    if (a) fonctions.current.set(cle, a.enregistrer)
    else fonctions.current.delete(cle)
    setLibelles((x) => {
      if ((x[cle] ?? null) === (a?.libelle ?? null)) return x
      const y = { ...x }
      if (a) y[cle] = a.libelle
      else delete y[cle]
      return y
    })
  }, [])

  const toutEnregistrer = async () => {
    setEnCours(true)
    const reussis: string[] = []
    const echecs: string[] = []
    // Dans l'ordre : l'en-tete d'abord, il peut changer ce que lisent les autres.
    for (const cle of ['informations', 'engagement', 'frais']) {
      const f = fonctions.current.get(cle)
      if (!f) continue
      try {
        await f()
        reussis.push(libelles[cle] ?? cle)
      } catch (e) {
        echecs.push(`${libelles[cle] ?? cle} : ${e instanceof ErreurApi ? e.message : 'refusé'}`)
      }
    }
    setEnCours(false)
    if (echecs.length === 0) toast.success(`Enregistré : ${reussis.join(', ')}`)
    else
      toast.error(`${echecs.length} partie(s) non enregistrée(s)`, {
        description: [...(reussis.length ? [`Enregistré : ${reussis.join(', ')}.`] : []), ...echecs].join(' — '),
        duration: 10000,
      })
  }

  return { signaler, aEnregistrer: Object.values(libelles), enCours, toutEnregistrer }
}

export function Tuile({
  titre,
  valeur,
  detail,
  ton,
}: {
  titre: string
  valeur: React.ReactNode
  detail?: React.ReactNode
  ton?: 'succes' | 'alerte'
}) {
  return (
    <div className="rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-attenue-texte">{titre}</div>
      <div
        className={cn(
          'text-[15px] font-semibold tabular-nums',
          ton === 'succes' && 'text-succes',
          ton === 'alerte' && 'text-alerte',
        )}
      >
        {valeur}
      </div>
      {detail && <div className="text-[11px] text-attenue-texte">{detail}</div>}
    </div>
  )
}

// ============================================================================
// Un panneau de la page (audit v5, F20) : la repartition d'un frais et la
// cloture du dossier se saisissent dans le dossier, plus dans une fenetre.
// ============================================================================

function Panneau({
  titre,
  description,
  children,
}: {
  titre: string
  description?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Ouvert depuis un bouton plus haut ou plus bas : on l'amene sous les yeux.
  useEffect(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), [])
  return (
    <div ref={ref} className="rounded-[var(--radius)] border border-primaire/40 bg-surface p-4">
      <div className="mb-3">
        <div className="text-[14px] font-semibold">{titre}</div>
        {description && <p className="m-0 mt-0.5 text-[12.5px] text-attenue-texte">{description}</p>}
      </div>
      {children}
    </div>
  )
}

// ============================================================================
// Frais cible : sur quelles lignes il se repartit
// ============================================================================

export function CiblesPanneau({
  idDossier,
  frais,
  lignes,
  surFermer,
}: {
  idDossier: string
  frais: Frais | null
  lignes: Ligne[]
  surFermer: () => void
}) {
  const rafraichir = useRafraichir(idDossier)
  const [cibles, setCibles] = useState<string[]>([])
  useEffect(() => setCibles(frais?.cibles ?? []), [frais])

  const enregistrer = useMutation({
    mutationFn: (c: string[]) => api.patch(`/api/import/frais/${frais!.id_ligne_frais}`, { cibles: c }),
    onSuccess: () => {
      toast.success('Répartition du frais mise à jour')
      rafraichir()
      surFermer()
    },
    onError: echec,
  })

  if (!frais) return null
  return (
    <div className="mt-3">
      <Panneau
        titre={`Répartir « ${frais.frais_libelle ?? ''} »`}
        description="Par défaut un frais se répartit sur tout le dossier. Cochez des lignes pour le limiter à elles — les droits de douane d'une pièce en franchise, par exemple."
      >
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-[var(--radius)] border border-bordure p-2">
          {lignes.map((l) => (
            <label key={l.id_ligne} className="flex items-center gap-2 py-0.5 text-[12.5px]">
              <input
                type="checkbox"
                checked={cibles.includes(l.id_ligne)}
                onChange={(e) =>
                  setCibles((c) => (e.target.checked ? [...c, l.id_ligne] : c.filter((x) => x !== l.id_ligne)))
                }
              />
              <span className="min-w-0 truncate">
                <span className="text-attenue-texte">{l.numero_facture} · </span>
                {l.type_ligne === 'ERP' ? l.code_reference : l.designation}
                {l.type_ligne === 'HORS_ERP' && <em className="text-attenue-texte"> (hors ERP)</em>}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <Bouton variante="contour" onClick={() => enregistrer.mutate([])}>
            Tout le dossier
          </Bouton>
          <div className="flex gap-2">
            <Bouton variante="contour" onClick={surFermer}>Annuler</Bouton>
            <Bouton chargement={enregistrer.isPending} disabled={cibles.length === 0}
              onClick={() => enregistrer.mutate(cibles)}>
              Répartir sur {cibles.length} ligne(s)
            </Bouton>
          </div>
        </div>
      </Panneau>
    </div>
  )
}

// ============================================================================
// Cloture
// ============================================================================

interface ApercuCloture {
  numero: string
  references: {
    code_reference: string
    frais_dhs: number
    recu_kg: number
    stock_kg: number
    ecart_stock_dhs: number
    ecart_consomme_dhs: number
    magasins: { code_magasin: string; stock_kg: number; cump_avant?: number | null; cump_apres?: number | null }[]
  }[]
  ecart_stock_dhs: number
  ecart_consomme_dhs: number
  frais_hors_erp_dhs: number
}

/**
 * La cloture montre d'abord ce qu'elle va faire : le calcul est joue a blanc
 * par le serveur (`simuler`), rien n'est ecrit tant qu'on n'a pas confirme.
 */
export function CloturePanneau({
  idDossier,
  ouvert,
  surFermer,
}: {
  idDossier: string
  ouvert: boolean
  surFermer: () => void
}) {
  const rafraichir = useRafraichir(idDossier)
  const qApercu = useQuery({
    queryKey: ['import-cloture-apercu', idDossier],
    queryFn: () => api.post<ApercuCloture>(`/api/import/dossiers/${idDossier}/cloturer?simuler=1`),
    enabled: ouvert,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })
  const cloturer = useMutation({
    mutationFn: () => api.post<ApercuCloture>(`/api/import/dossiers/${idDossier}/cloturer`),
    onSuccess: (r) => {
      toast.success(`Dossier ${r.numero} clôturé — CUMP ajusté`)
      rafraichir()
      surFermer()
    },
    onError: echec,
  })
  const a = qApercu.data

  if (!ouvert) return null
  return (
    <Panneau
      titre="Clôturer le dossier"
      description="Les frais rejoignent le CUMP du stock encore présent. Après clôture, le dossier ne se modifié plus."
    >
        {qApercu.isLoading && <Chargement texte="Calcul de la clôture…" />}
        {qApercu.error && (
          <Alerte ton="alerte">
            {qApercu.error instanceof ErreurApi ? qApercu.error.message : 'Clôture impossible.'}
          </Alerte>
        )}
        {a && (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <Tuile titre="Au stock présent" valeur={`${fmt.nombre(a.ecart_stock_dhs, 2)} DH`} ton="succes" />
              <Tuile titre="Déjà consommé" valeur={`${fmt.nombre(a.ecart_consomme_dhs, 2)} DH`} />
              <Tuile titre="Lignes hors ERP" valeur={`${fmt.nombre(a.frais_hors_erp_dhs, 2)} DH`} />
            </div>
            <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x rounded-[var(--radius)] border border-bordure focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
              <table className="w-full min-w-[40rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-bordure bg-attenue/40 text-[10.5px] uppercase tracking-wider text-attenue-texte">
                    <th className="px-2 py-1.5 text-left">Référence</th>
                    <th className="px-2 py-1.5 text-right">Frais</th>
                    <th className="px-2 py-1.5 text-right">Reçu / en stock (kg)</th>
                    <th className="px-2 py-1.5 text-right">Au stock</th>
                    <th className="px-2 py-1.5 text-right">Consommé</th>
                    <th className="px-2 py-1.5 text-left">CUMP</th>
                  </tr>
                </thead>
                <tbody>
                  {a.references.map((r) => (
                    <tr key={r.code_reference} className="border-b border-bordure/60 align-top">
                      <td className="px-2 py-1.5 font-medium">{r.code_reference}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt.nombre(r.frais_dhs, 2)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(r.recu_kg, 0)} / {fmt.nombre(r.stock_kg, 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-succes">{fmt.nombre(r.ecart_stock_dhs, 2)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-attenue-texte">{fmt.nombre(r.ecart_consomme_dhs, 2)}</td>
                      <td className="px-2 py-1.5">
                        {r.magasins.length === 0 ? (
                          <span className="text-attenue-texte">plus de stock</span>
                        ) : (
                          r.magasins.map((m) => (
                            <div key={m.code_magasin} className="whitespace-nowrap text-[11.5px] tabular-nums">
                              {m.code_magasin} : {m.cump_avant == null ? '—' : fmt.nombre(m.cump_avant, 4)} →{' '}
                              <strong>{m.cump_apres == null ? '—' : fmt.nombre(m.cump_apres, 4)}</strong>
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11.5px] text-attenue-texte">
              La part « déjà consommé » revenait à du fil sorti avant la clôture : elle est tracée dans le
              journal du dossier, pas réinjectée dans le stock.
            </p>
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Bouton variante="contour" onClick={surFermer}>Annuler</Bouton>
          <Bouton chargement={cloturer.isPending} disabled={!a} onClick={() => cloturer.mutate()}>
            <Lock />
            Clôturer et ajuster le CUMP
          </Bouton>
        </div>
    </Panneau>
  )
}

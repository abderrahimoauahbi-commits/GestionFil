/**
 * Ce que les ecrans du dossier d'importation partagent : l'apercu de cloture,
 * la tuile de chiffre, et trois petites aides de saisie.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { Alerte, Bouton, Chargement } from '../../composants/ui/base'
import { cn, fmt } from '../../lib/utils'
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
 * LE VERROU OPTIMISTE D'UN DOCUMENT D'IMPORT (groupe 3, 20/10/2026).
 *
 * Le dossier (comme chaque facture) porte une `version`. L'ecran la renvoie a
 * chaque enregistrement ; le serveur refuse (409, en nommant l'auteur) si
 * quelqu'un est passe entre-temps. Les frais, engagements, paiements, pieces,
 * la cloture et la validation passent par la version du DOSSIER ; une facture
 * et ses lignes, par celle de la FACTURE.
 *
 * `suivre` enchaine la version que chaque reponse rend : « Enregistrer tout »
 * envoie l'en-tete, puis l'engagement, puis le frais, et chacun presente la
 * version que le precedent a laissee — sans quoi l'ecran se refuserait
 * lui-meme. La version relue du serveur n'est adoptee que si rien n'attend
 * d'etre enregistre (`figee`) : adopter celle d'un autre pendant qu'on saisit
 * desarmerait le verrou. Elle ne recule jamais (une relecture en retard
 * rapporterait une version deja depassee).
 */
export interface VersionDocument {
  /** La version a presenter au prochain enregistrement. */
  lire: () => number | undefined
  /** Enchaine la version rendue par le serveur ; rend la reponse telle quelle. */
  suivre: <T>(r: T) => T
  /** Le refus affiche tel quel ; un 409 relit le dossier pour montrer les changements. */
  echec: (e: unknown) => void
}

export function useVersionSuivie(
  versionServeur: number | undefined,
  figee: boolean,
  rafraichir: () => void,
): VersionDocument {
  const courante = useRef<number | undefined>(versionServeur)
  const serveur = useRef(versionServeur)
  // Apres un 409, la prochaine version relue s'adopte meme si une saisie attend.
  const forcer = useRef(false)
  const relire = useRef(rafraichir)
  useEffect(() => {
    relire.current = rafraichir
    serveur.current = versionServeur
  })
  useEffect(() => {
    if (versionServeur == null) return
    if (courante.current == null || ((!figee || forcer.current) && versionServeur > courante.current)) {
      courante.current = versionServeur
      forcer.current = false
    }
  }, [versionServeur, figee])
  return useMemo<VersionDocument>(
    () => ({
      lire: () => courante.current,
      suivre: <T,>(r: T) => {
        const v = (r as { version?: unknown } | null | undefined)?.version
        if (typeof v === 'number') courante.current = v
        return r
      },
      echec: (e: unknown) => {
        if (e instanceof ErreurApi && e.statut === 409) {
          // LE DOSSIER SE RELIT : ses changements s'affichent, et la version
          // relue devient celle du prochain enregistrement — la saisie refusee
          // se refait sur ce que l'autre a enregistre.
          const connue = serveur.current
          if (connue != null && (courante.current == null || connue > courante.current)) courante.current = connue
          else forcer.current = true
          relire.current()
        }
        echec(e)
      },
    }),
    [],
  )
}

const VersionDossier = createContext<VersionDocument | null>(null)

/** Donne la version suivie du dossier aux parties de son ecran. */
export function FournirVersionDossier({ valeur, children }: { valeur: VersionDocument; children: React.ReactNode }) {
  return <VersionDossier.Provider value={valeur}>{children}</VersionDossier.Provider>
}

/** La version suivie du dossier ouvert (voir `useVersionSuivie`). */
export function useVersionDossier(): VersionDocument {
  const v = useContext(VersionDossier)
  if (!v) throw new Error('useVersionDossier hors de l’écran du dossier')
  return v
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
    // Dans l'ordre : l'en-tete d'abord, il peut changer ce que lisent les autres ;
    // la repartition en dernier, apres un frais qu'elle pourrait viser.
    for (const cle of ['informations', 'engagement', 'frais', 'liquidation']) {
      const f = fonctions.current.get(cle)
      if (!f) continue
      try {
        await f()
        reussis.push(libelles[cle] ?? cle)
      } catch (e) {
        echecs.push(`${libelles[cle] ?? cle} : ${e instanceof Error ? e.message : 'refusé'}`)
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
  const version = useVersionDossier()
  const qApercu = useQuery({
    queryKey: ['import-cloture-apercu', idDossier],
    queryFn: () => api.post<ApercuCloture>(`/api/import/dossiers/${idDossier}/cloturer?simuler=1`),
    enabled: ouvert,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })
  const cloturer = useMutation({
    mutationFn: async () =>
      version.suivre(await api.post<ApercuCloture>(`/api/import/dossiers/${idDossier}/cloturer`, { version: version.lire() })),
    onSuccess: (r) => {
      toast.success(`Dossier ${r.numero} clôturé — CUMP ajusté`)
      rafraichir()
      surFermer()
    },
    onError: version.echec,
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
              <table className="w-full text-[12.5px]">
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

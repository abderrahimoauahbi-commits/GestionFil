/**
 * Equivalences de references — administration.
 *
 * Un groupe d'equivalence declare que plusieurs references sont interchangeables
 * : la meme matiere, la meme couleur, chez deux fournisseurs. C'est ce qui
 * permet, plus loin dans la chaine, d'arbitrer un achat, d'accepter une
 * livraison de substitution ou de sortir une autre bobine quand la premiere
 * manque.
 *
 * L'ecran est en deux niveaux — les groupes a gauche, leurs references a droite
 * — parce que la decision se prend TOUJOURS au niveau du groupe : « qui remplace
 * qui, et dans quel ordre ».
 *
 * Trois choses disqualifient un groupe, et elles sont dites plutot que devinees :
 *   MONO-REFERENCE   il n'offre aucune alternative ;
 *   HETEROGENE       ses references n'ont pas la meme unite ou la meme densite,
 *                    donc substituer fausserait le kg/m2 de la recette ;
 *   MEME FOURNISSEUR deux references du meme fournisseur tombent ensemble — ce
 *                    n'est pas une securite d'approvisionnement.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Link2, Plus, Search, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
} from '../composants/ui/base'
import { Dialogue, DialogueContenu, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'CATALOGUE'

interface Groupe extends Record<string, unknown> {
  code_groupe_equiv: string
  libelle: string
  description: string | null
  actif: number
  nb_references: number
  nb_fournisseurs: number
  nb_unites: number
  nb_densites: number
  nb_categories: number
  nb_preferentielles: number
  nb_avec_stock: number
  nb_avec_besoin: number
  stock_cumule_kg: number
  besoin_cumule_kg: number
  qualification: 'MONO-REFERENCE' | 'HETEROGENE' | 'MEME FOURNISSEUR' | 'ALTERNATIF'
}

/** Un rattachement brut : c'est lui qui existe meme quand le groupe est seul. */
interface Rattachement extends Record<string, unknown> {
  id_ref_grp: string
  code_reference: string
  code_groupe_equiv: string
  priorite: number
  est_preferentielle: number
  actif: number
  designation: string | null
  groupe_libelle: string | null
}

interface Equivalent extends Record<string, unknown> {
  code_reference: string
  code_fournisseur: string | null
  fournisseur_nom: string | null
  stock_kg: number
  besoin_12m_kg: number
  equivalent_reference: string
  equivalent_stock_kg: number
  equivalent_besoin_12m_kg: number
  meme_fournisseur: number
  interchangeable: number
}

interface RefCatalogue {
  code_reference: string
  designation: string
  unite_catalogue: string
  code_fournisseur: string | null
}

const TON_QUALIF: Record<Groupe['qualification'], 'succes' | 'alerte' | 'danger' | 'neutre'> = {
  ALTERNATIF: 'succes',
  'MONO-REFERENCE': 'neutre',
  'MEME FOURNISSEUR': 'alerte',
  HETEROGENE: 'danger',
}

/** Les bandeaux d'alerte n'ont pas de ton neutre : un groupe sans alternative
 *  s'annonce en information, pas en avertissement. */
const TON_ALERTE: Record<Groupe['qualification'], 'succes' | 'alerte' | 'danger' | 'info'> = {
  ALTERNATIF: 'succes',
  'MONO-REFERENCE': 'info',
  'MEME FOURNISSEUR': 'alerte',
  HETEROGENE: 'danger',
}

const EXPLICATION: Record<Groupe['qualification'], string> = {
  ALTERNATIF: 'Vraie alternative : references homogenes chez des fournisseurs distincts.',
  'MONO-REFERENCE': "Une seule reference : le groupe n'offre aucune alternative.",
  'MEME FOURNISSEUR':
    'Toutes les references viennent du meme fournisseur : elles tombent ensemble, ce n est pas une securite d approvisionnement.',
  HETEROGENE:
    'Unite, densite ou categorie differentes : substituer fausserait le calcul kg/m2 de la recette.',
}

export function Equivalences() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const confirmation = useConfirmation()

  const [pointe, setPointe] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')
  const [seulementAlternatifs, setSeulementAlternatifs] = useState(false)
  const [ajout, setAjout] = useState(false)

  const qGroupes = useQuery({
    queryKey: ['groupes-equivalence'],
    queryFn: () => api.get<Groupe[]>('/api/groupes-equivalence'),
  })

  const qMembres = useQuery({
    queryKey: ['reference-groupes', pointe],
    queryFn: () =>
      api.get<Rattachement[]>(
        `/api/reference-groupes?code_groupe_equiv=${encodeURIComponent(pointe!)}&limite=100`,
      ),
    enabled: !!pointe,
  })

  const qEquiv = useQuery({
    queryKey: ['equivalences', pointe],
    queryFn: () =>
      api.get<Equivalent[]>(
        `/api/equivalences?code_groupe_equiv=${encodeURIComponent(pointe!)}`,
      ),
    enabled: !!pointe,
  })

  const groupes = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    return (qGroupes.data ?? [])
      .filter((g) => !seulementAlternatifs || g.qualification === 'ALTERNATIF')
      .filter(
        (g) =>
          !f ||
          g.code_groupe_equiv.toLowerCase().includes(f) ||
          (g.libelle ?? '').toLowerCase().includes(f),
      )
  }, [qGroupes.data, filtre, seulementAlternatifs])

  const groupe = qGroupes.data?.find((g) => g.code_groupe_equiv === pointe) ?? null
  const membres = useMemo(
    () => [...(qMembres.data ?? [])].sort((a, b) => a.priorite - b.priorite),
    [qMembres.data],
  )

  /**
   * Stock, besoin et FOURNISSEUR de chaque membre.
   *
   * Le fournisseur est la donnee qui decide : deux references equivalentes chez
   * la meme maison tombent ensemble, et le groupe ne protege alors de rien.
   */
  const chiffres = useMemo(() => {
    const m = new Map<
      string,
      { stock: number; besoin: number; fournisseur: string | null }
    >()
    for (const e of qEquiv.data ?? []) {
      m.set(e.code_reference, {
        stock: e.stock_kg,
        besoin: e.besoin_12m_kg,
        fournisseur: e.fournisseur_nom ?? e.code_fournisseur,
      })
    }
    return m
  }, [qEquiv.data])

  /** Un seul fournisseur pour tout le groupe : fausse securite. */
  const fournisseursDuGroupe = useMemo(
    () => new Set([...chiffres.values()].map((c) => c.fournisseur).filter(Boolean)),
    [chiffres],
  )

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['groupes-equivalence'] })
    void qc.invalidateQueries({ queryKey: ['reference-groupes'] })
    void qc.invalidateQueries({ queryKey: ['equivalences'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Operation impossible.')

  const reordonner = useMutation({
    mutationFn: (references: string[]) =>
      api.put(`/api/groupes-equivalence/${encodeURIComponent(pointe!)}/ordre`, { references }),
    onSuccess: () => {
      toast.success('Ordre mis a jour', {
        description: 'La premiere reference du groupe devient la preferentielle.',
      })
      rafraichir()
    },
    onError: echec,
  })

  const rattacher = useMutation({
    mutationFn: (code_reference: string) =>
      api.post('/api/reference-groupes', {
        code_reference,
        code_groupe_equiv: pointe,
        // On ajoute TOUJOURS en dernier : promouvoir se fait ensuite, par un
        // geste explicite. Inserer d'office en tete changerait la reference
        // preferentielle du groupe a l'insu de celui qui rattache.
        priorite: membres.length + 1,
        est_preferentielle: membres.length === 0 ? 1 : 0,
      }),
    onSuccess: () => {
      toast.success('Reference rattachee au groupe')
      setAjout(false)
      rafraichir()
    },
    onError: echec,
  })

  const detacher = useMutation({
    mutationFn: (id: string) => api.delete(`/api/reference-groupes/${id}`),
    onSuccess: () => {
      toast.success('Reference detachee')
      rafraichir()
    },
    onError: echec,
  })

  const deplacer = (index: number, sens: -1 | 1) => {
    const cible = index + sens
    if (cible < 0 || cible >= membres.length) return
    const ordre = membres.map((m) => m.code_reference)
    ;[ordre[index], ordre[cible]] = [ordre[cible], ordre[index]]
    reordonner.mutate(ordre)
  }

  const promouvoir = (code: string) =>
    reordonner.mutate([code, ...membres.map((m) => m.code_reference).filter((c) => c !== code)])

  return (
    <div>
      <EnTetePage
        titre="Equivalences de references"
        description="Quelles references sont interchangeables, et dans quel ordre les preferer."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ---- Groupes ---------------------------------------------------- */}
        <Carte className="h-fit">
          <CarteEntete>
            <CarteTitre>Groupes</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              {groupes.length} / {qGroupes.data?.length ?? 0}
            </span>
          </CarteEntete>
          <CarteCorps className="space-y-2">
            <div className="flex items-center gap-2">
              <Search className="size-3.5 shrink-0 text-attenue-texte" />
              <Champ
                placeholder="Code ou libelle…"
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                className="h-8"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-attenue-texte">
              <input
                type="checkbox"
                checked={seulementAlternatifs}
                onChange={(e) => setSeulementAlternatifs(e.target.checked)}
                className="size-3.5"
              />
              Seulement ceux qui offrent une vraie alternative
            </label>

            {qGroupes.isLoading && <Chargement texte="Lecture des groupes…" />}

            <div className="max-h-[32rem] space-y-1 overflow-y-auto">
              {groupes.map((g) => (
                <button
                  key={g.code_groupe_equiv}
                  type="button"
                  onClick={() => setPointe(g.code_groupe_equiv)}
                  className={cn(
                    'w-full rounded-[var(--radius)] border p-2 text-left transition-colors',
                    pointe === g.code_groupe_equiv
                      ? 'border-primaire bg-primaire/5'
                      : 'border-bordure hover:bg-attenue/30',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{g.libelle}</span>
                    <Badge ton={TON_QUALIF[g.qualification]}>{g.nb_references}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-attenue-texte">
                    <span className="tabular-nums">{g.code_groupe_equiv}</span>
                    <span>{g.nb_fournisseurs} fourn.</span>
                    {g.stock_cumule_kg > 0 && (
                      <span className="tabular-nums">{fmt.compact(g.stock_cumule_kg)} kg</span>
                    )}
                  </div>
                </button>
              ))}
              {!qGroupes.isLoading && groupes.length === 0 && (
                <p className="py-4 text-center text-[12px] text-attenue-texte">
                  Aucun groupe ne correspond.
                </p>
              )}
            </div>
          </CarteCorps>
        </Carte>

        {/* ---- Membres du groupe pointe ------------------------------------ */}
        <div className="space-y-3">
          {!groupe ? (
            <Alerte ton="info">
              Choisissez un groupe pour voir ses references, changer leur ordre de preference, en
              rattacher ou en detacher.
            </Alerte>
          ) : (
            <>
              <Alerte ton={TON_ALERTE[groupe.qualification]}>
                <strong>{groupe.qualification}</strong> — {EXPLICATION[groupe.qualification]}
              </Alerte>

              <Carte>
                <CarteEntete>
                  <CarteTitre>
                    {groupe.libelle} · {groupe.nb_references} reference(s)
                  </CarteTitre>
                  {droits.peutEcrire && (
                    <Bouton variante="contour" taille="sm" onClick={() => setAjout(true)}>
                      <Plus />
                      Rattacher une reference
                    </Bouton>
                  )}
                </CarteEntete>
                <CarteCorps className="p-0">
                  {qMembres.isLoading ? (
                    <div className="p-4">
                      <Chargement texte="Lecture des rattachements…" />
                    </div>
                  ) : membres.length === 0 ? (
                    <p className="p-4 text-[13px] text-attenue-texte">
                      Aucune reference rattachee a ce groupe.
                    </p>
                  ) : (
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                          <th className="w-16 px-2 py-2 text-right">Ordre</th>
                          <th className="px-3 py-2 text-left">Reference</th>
                          <th className="w-40 px-2 py-2 text-left">Fournisseur</th>
                          <th className="w-28 px-2 py-2 text-right">Stock</th>
                          <th className="w-28 px-2 py-2 text-right">Besoin 12 m</th>
                          <th className="w-28 px-2 py-2 text-center">Preference</th>
                          {droits.peutEcrire && <th className="w-32 px-2 py-2"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {membres.map((m, i) => {
                          const c = chiffres.get(m.code_reference)
                          const dort = (c?.stock ?? 0) > 0 && (c?.besoin ?? 0) === 0
                          return (
                            <tr key={m.id_ref_grp} className="border-b border-bordure/60">
                              <td className="px-2 py-1.5 text-right tabular-nums text-attenue-texte">
                                {m.priorite}
                              </td>
                              <td className="max-w-72 px-3 py-1.5">
                                <div className="truncate font-medium">{m.code_reference}</div>
                                <div className="truncate text-[11px] text-attenue-texte">
                                  {m.designation}
                                </div>
                              </td>
                              <td className="max-w-40 px-2 py-1.5">
                                {c?.fournisseur ? (
                                  <span
                                    className={cn(
                                      'truncate',
                                      fournisseursDuGroupe.size === 1 &&
                                        membres.length > 1 &&
                                        'text-alerte',
                                    )}
                                  >
                                    {c.fournisseur}
                                  </span>
                                ) : (
                                  <span className="text-attenue-texte">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {c == null ? '—' : fmt.nombre(c.stock, 0)}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                {c == null ? (
                                  '—'
                                ) : (
                                  <span className="tabular-nums">{fmt.nombre(c.besoin, 0)}</span>
                                )}
                                {dort && (
                                  <div className="text-[10px] text-alerte">stock sans besoin</div>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                {m.est_preferentielle === 1 ? (
                                  <Badge ton="succes">preferentielle</Badge>
                                ) : (
                                  <span className="text-[11px] text-attenue-texte">
                                    alternative
                                  </span>
                                )}
                              </td>
                              {droits.peutEcrire && (
                                <td className="px-2 py-1.5">
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Bouton
                                      variante="discret"
                                      taille="icone-xs"
                                      onClick={() => deplacer(i, -1)}
                                      disabled={i === 0 || reordonner.isPending}
                                      aria-label="Monter"
                                      title="Monter dans l ordre de preference"
                                    >
                                      <ArrowUp />
                                    </Bouton>
                                    <Bouton
                                      variante="discret"
                                      taille="icone-xs"
                                      onClick={() => deplacer(i, 1)}
                                      disabled={i === membres.length - 1 || reordonner.isPending}
                                      aria-label="Descendre"
                                      title="Descendre dans l ordre de preference"
                                    >
                                      <ArrowDown />
                                    </Bouton>
                                    <Bouton
                                      variante="discret"
                                      taille="icone-xs"
                                      onClick={() => promouvoir(m.code_reference)}
                                      disabled={m.est_preferentielle === 1 || reordonner.isPending}
                                      aria-label="Rendre preferentielle"
                                      title="Rendre preferentielle"
                                    >
                                      <Star />
                                    </Bouton>
                                    <Bouton
                                      variante="discret"
                                      taille="icone-xs"
                                      className="text-danger hover:bg-danger/10"
                                      onClick={() =>
                                        confirmation.demander({
                                          titre: `Detacher ${m.code_reference} ?`,
                                          destructif: true,
                                          libelleConfirmer: 'Detacher',
                                          description:
                                            "La reference ne sera plus proposee comme substitut des autres membres du groupe. Aucun stock ni mouvement n'est touche.",
                                          action: () => detacher.mutate(m.id_ref_grp),
                                        })
                                      }
                                      aria-label="Detacher"
                                    >
                                      <Trash2 />
                                    </Bouton>
                                  </div>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  {membres.length > 1 && (
                    <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                      La reference de rang 1 est la <strong>preferentielle</strong> : celle que le
                      plan d'achat propose par defaut. Les suivantes sont les substituts, dans
                      l'ordre.
                    </p>
                  )}
                </CarteCorps>
              </Carte>
            </>
          )}
        </div>
      </div>

      {ajout && pointe && (
        <PanneauRattachement
          groupe={pointe}
          dejaMembres={membres.map((m) => m.code_reference)}
          enCours={rattacher.isPending}
          surFermeture={() => setAjout(false)}
          surChoix={(code) => rattacher.mutate(code)}
        />
      )}

      {confirmation.element}
    </div>
  )
}

/**
 * Choix d'une reference a rattacher.
 *
 * On avertit quand la reference n'est pas homogene avec le groupe : meme unite,
 * meme categorie. La base ne l'interdit pas — elle ne peut pas savoir si deux
 * matieres sont commercialement interchangeables — mais un groupe heterogene
 * fausserait le kg/m2 le jour ou quelqu'un substituerait.
 */
function PanneauRattachement({
  groupe,
  dejaMembres,
  enCours,
  surFermeture,
  surChoix,
}: {
  groupe: string
  dejaMembres: string[]
  enCours: boolean
  surFermeture: () => void
  surChoix: (code: string) => void
}) {
  const [filtre, setFiltre] = useState('')
  const [choisie, setChoisie] = useState('')

  const q = useQuery({
    queryKey: ['catalogue-equiv'],
    queryFn: () => api.get<RefCatalogue[]>('/api/catalogue?actif=1&limite=2000'),
  })

  const refs = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    return (q.data ?? [])
      .filter((r) => !dejaMembres.includes(r.code_reference))
      .filter(
        (r) =>
          !f ||
          r.code_reference.toLowerCase().includes(f) ||
          (r.designation ?? '').toLowerCase().includes(f),
      )
      .slice(0, 60)
  }, [q.data, filtre, dejaMembres])

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        cote="droite"
        titre={`Rattacher une reference a ${groupe}`}
        description="Elle deviendra un substitut possible des autres membres du groupe."
      >
        <div className="mb-2 flex items-center gap-2">
          <Search className="size-3.5 shrink-0 text-attenue-texte" />
          <Champ
            placeholder="Reference ou designation…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            className="h-8"
            autoFocus
          />
        </div>

        {q.isLoading && <Chargement texte="Lecture du catalogue…" />}

        <div className="space-y-1">
          {refs.map((r) => (
            <label
              key={r.code_reference}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border p-2',
                choisie === r.code_reference
                  ? 'border-primaire bg-primaire/5'
                  : 'border-bordure hover:bg-attenue/30',
              )}
            >
              <input
                type="radio"
                name="ref"
                checked={choisie === r.code_reference}
                onChange={() => setChoisie(r.code_reference)}
                className="size-4 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.code_reference}</span>
                <span className="block truncate text-[11px] text-attenue-texte">
                  {r.designation} · {r.unite_catalogue}
                  {r.code_fournisseur ? ` · ${r.code_fournisseur}` : ''}
                </span>
              </span>
            </label>
          ))}
          {!q.isLoading && refs.length === 0 && (
            <Alerte ton="info">Aucune reference disponible pour ce filtre.</Alerte>
          )}
        </div>

        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-bordure bg-surface px-4 pt-3">
          <span className="text-[11px] text-attenue-texte">
            Ajoutee en derniere position ; a promouvoir ensuite si besoin.
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton disabled={!choisie} chargement={enCours} onClick={() => surChoix(choisie)}>
              <Link2 />
              Rattacher
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

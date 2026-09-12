/**
 * Un referentiel A DEUX NIVEAUX : une liste a gauche, ses lignes a droite.
 *
 * Deux referentiels de l'ERP ont cette forme, et pour la meme raison — le
 * niveau du bas n'a aucun sens seul :
 *
 *   categorie -> familles          (le jute, ses titrages)
 *   couleur   -> codes fournisseur (le rouge C3, « 7612 » chez Hasirci)
 *
 * La saisie se fait EN LIGNE, comme dans le tableau des frais d'un dossier :
 * on tape dans la grille, on ajoute par la derniere ligne, et rien n'ouvre de
 * fenetre. C'est la forme que l'usage a retenue ici.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import {
  Alerte,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Selecteur,
} from './ui/base'
import { useConfirmation } from './ui/surcouches'
import { cn } from '../lib/utils'

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1'
const champ = 'h-7 px-1.5 text-[12.5px]'

export interface ColonneDetail {
  champ: string
  entete: string
  largeur?: string
  obligatoire?: boolean
  /** Liste fermee : le champ devient un choix. */
  options?: { valeur: string; libelle: string }[]
  placeholder?: string
  /** Non modifiable apres creation (une cle, par exemple). */
  cleCreation?: boolean
}

export interface Ligne extends Record<string, unknown> {}

interface Props {
  titre: string
  module: string
  /** Le niveau du haut. */
  maitre: {
    route: string
    cle: string
    /** Ce qu'on lit dans la liste : un titre et une ligne de detail. */
    libelle: (l: Ligne) => string
    detail?: (l: Ligne) => string
    /** Ses propres champs, modifiables dans l'en-tete du detail. */
    champs?: ColonneDetail[]
    unite: string
  }
  /** Le niveau du bas, filtre par la cle etrangere. */
  detail: {
    route: string
    cle: string
    cleEtrangere: string
    colonnes: ColonneDetail[]
    unite: string
    /** Ce que porte une nouvelle ligne avant saisie. */
    defauts?: Record<string, unknown>
  }
  aide?: string
}

export function MaitreDetail({ titre, module, maitre, detail, aide }: Props) {
  const droits = useDroits(module)
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const [pointe, setPointe] = useState<string | null>(null)
  const [nouvelle, setNouvelle] = useState<Record<string, string>>({})
  const [nouveauMaitre, setNouveauMaitre] = useState<Record<string, string>>({})

  const qMaitre = useQuery({
    queryKey: [maitre.route],
    queryFn: () => api.get<Ligne[]>(`/api/${maitre.route}?actif=1&limite=500`),
  })
  const qDetail = useQuery({
    queryKey: [detail.route],
    queryFn: () => api.get<Ligne[]>(`/api/${detail.route}?limite=1000`),
  })

  const lignes = useMemo(() => {
    const tout = qDetail.data ?? []
    return pointe === null ? [] : tout.filter((l) => String(l[detail.cleEtrangere] ?? '') === pointe)
  }, [qDetail.data, pointe, detail.cleEtrangere])

  const orphelines = useMemo(
    () => (qDetail.data ?? []).filter((l) => !l[detail.cleEtrangere]),
    [qDetail.data, detail.cleEtrangere],
  )

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: [detail.route] })
    void qc.invalidateQueries({ queryKey: [maitre.route] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  const creerMaitre = useMutation({
    mutationFn: (valeurs: Record<string, string>) => api.post(`/api/${maitre.route}`, valeurs),
    onSuccess: (_, valeurs) => {
      toast.success(`${maitre.unite} créé`)
      setNouveauMaitre({})
      setPointe(String(valeurs[maitre.cle] ?? ''))
      rafraichir()
    },
    onError: echec,
  })
  const modifierMaitre = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/api/${maitre.route}/${encodeURIComponent(id)}`, patch),
    onSuccess: rafraichir,
    onError: echec,
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post(`/api/${detail.route}`, {
        ...detail.defauts,
        ...nouvelle,
        [detail.cleEtrangere]: pointe,
      }),
    onSuccess: () => {
      toast.success(`${detail.unite} ajouté`)
      setNouvelle({})
      rafraichir()
    },
    onError: echec,
  })
  const modifier = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/api/${detail.route}/${encodeURIComponent(id)}`, patch),
    onSuccess: rafraichir,
    onError: echec,
  })
  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/${detail.route}/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(`${detail.unite} retiré`)
      rafraichir()
    },
    onError: echec,
  })

  if (qMaitre.isLoading) return <Chargement texte={`Lecture des ${titre.toLowerCase()}…`} />

  const tous = qMaitre.data ?? []
  const courant = tous.find((l) => String(l[maitre.cle]) === pointe)
  const ecrire = droits.peutEcrire
  const complet = detail.colonnes
    .filter((c) => c.obligatoire)
    .every((c) => (nouvelle[c.champ] ?? '').trim())

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
      {/* ---- Le niveau du haut ------------------------------------------- */}
      <Carte className={cn('h-fit', pointe && 'hidden lg:block')}>
        <CarteEntete>
          <CarteTitre>{titre}</CarteTitre>
          <span className="text-[11.5px] text-attenue-texte">{tous.length}</span>
        </CarteEntete>
        <CarteCorps className="p-0">
          <ul className="divide-y divide-bordure/60">
            {tous.map((l) => {
              const id = String(l[maitre.cle])
              const nb = (qDetail.data ?? []).filter(
                (d) => String(d[detail.cleEtrangere] ?? '') === id,
              ).length
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setPointe(id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-attenue/40',
                      pointe === id && 'bg-attenue/60 font-medium',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{maitre.libelle(l)}</span>
                      {maitre.detail && (
                        <span className="block truncate text-[11px] text-attenue-texte">
                          {maitre.detail(l)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-attenue-texte">
                      {nb}
                      <ChevronRight className="size-3.5" />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {ecrire && maitre.champs && (
            <div className="space-y-1.5 border-t border-bordure p-2">
              {maitre.champs.filter((c) => c.cleCreation || c.obligatoire).map((c) => (
                <Champ
                  key={c.champ}
                  className={champ}
                  aria-label={`${c.entete} (nouveau)`}
                  placeholder={c.entete}
                  value={nouveauMaitre[c.champ] ?? ''}
                  onChange={(e) => setNouveauMaitre((n) => ({ ...n, [c.champ]: e.target.value }))}
                />
              ))}
              <Bouton
                taille="sm"
                variante="contour"
                className="w-full"
                disabled={!maitre.champs.filter((c) => c.cleCreation || c.obligatoire)
                  .every((c) => (nouveauMaitre[c.champ] ?? '').trim())}
                chargement={creerMaitre.isPending}
                onClick={() => creerMaitre.mutate(nouveauMaitre)}
              >
                <Plus />
                {maitre.unite}
              </Bouton>
            </div>
          )}
          {orphelines.length > 0 && (
            <div className="border-t border-bordure px-3 py-2 text-[11.5px] text-alerte" data-orphelines>
              {orphelines.length} {detail.unite.toLowerCase()}(s) sans rattachement
            </div>
          )}
        </CarteCorps>
      </Carte>

      {/* ---- Le niveau du bas --------------------------------------------- */}
      <div className={cn('min-w-0 space-y-3', !pointe && 'hidden lg:block')}>
        {!courant ? (
          <Alerte ton="info">{aide ?? 'Choisissez une ligne à gauche.'}</Alerte>
        ) : (
          <Carte>
            <CarteEntete>
              <CarteTitre>{maitre.libelle(courant)}</CarteTitre>
              <Bouton taille="sm" variante="contour" className="lg:hidden" onClick={() => setPointe(null)}>
                Retour
              </Bouton>
            </CarteEntete>
            {maitre.champs && (
              <CarteCorps className="flex flex-wrap gap-2 border-b border-bordure">
                {maitre.champs.filter((c) => !c.cleCreation).map((c) => (
                  <label key={c.champ} className="text-[11px] text-attenue-texte">
                    {c.entete}
                    {c.options ? (
                      <Selecteur
                        className={cn(champ, 'mt-0.5 w-44')}
                        aria-label={c.entete}
                        value={String(courant[c.champ] ?? '')}
                        disabled={!ecrire}
                        onChange={(e) =>
                          modifierMaitre.mutate({
                            id: String(courant[maitre.cle]),
                            patch: { [c.champ]: e.target.value || null },
                          })
                        }
                      >
                        <option value="">—</option>
                        {c.options.map((o) => (
                          <option key={o.valeur} value={o.valeur}>{o.libelle}</option>
                        ))}
                      </Selecteur>
                    ) : (
                      <Champ
                        className={cn(champ, 'mt-0.5 w-44')}
                        aria-label={c.entete}
                        defaultValue={String(courant[c.champ] ?? '')}
                        disabled={!ecrire}
                        key={String(courant[maitre.cle]) + c.champ}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== String(courant[c.champ] ?? '')) {
                            modifierMaitre.mutate({
                              id: String(courant[maitre.cle]),
                              patch: { [c.champ]: v || null },
                            })
                          }
                        }}
                      />
                    )}
                  </label>
                ))}
              </CarteCorps>
            )}
            <CarteCorps className="p-0">
              <div className="defilement-x">
                <table className="w-full min-w-[40rem] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-bordure">
                      {detail.colonnes.map((c) => (
                        <th key={c.champ} className={cn(th, 'text-left', c.largeur)}>
                          {c.entete}
                        </th>
                      ))}
                      {ecrire && <th className={cn(th, 'w-10')} />}
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => {
                      const id = String(l[detail.cle])
                      return (
                        <tr key={id} className="border-b border-bordure/60">
                          {detail.colonnes.map((c) => (
                            <td key={c.champ} className={td}>
                              {c.options ? (
                                <Selecteur
                                  className={champ}
                                  aria-label={c.entete}
                                  value={String(l[c.champ] ?? '')}
                                  disabled={!ecrire || c.cleCreation}
                                  onChange={(e) =>
                                    modifier.mutate({ id, patch: { [c.champ]: e.target.value || null } })
                                  }
                                >
                                  <option value="">—</option>
                                  {c.options.map((o) => (
                                    <option key={o.valeur} value={o.valeur}>
                                      {o.libelle}
                                    </option>
                                  ))}
                                </Selecteur>
                              ) : (
                                <Champ
                                  className={champ}
                                  aria-label={c.entete}
                                  defaultValue={String(l[c.champ] ?? '')}
                                  disabled={!ecrire || c.cleCreation}
                                  placeholder={c.placeholder}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim()
                                    if (v !== String(l[c.champ] ?? '')) {
                                      modifier.mutate({ id, patch: { [c.champ]: v || null } })
                                    }
                                  }}
                                />
                              )}
                            </td>
                          ))}
                          {ecrire && (
                            <td className={td}>
                              <Bouton
                                taille="icone-xs"
                                variante="discret"
                                className="text-danger hover:bg-danger/10"
                                aria-label={`Retirer ${detail.unite}`}
                                onClick={() =>
                                  confirmation.demander({
                                    titre: `Retirer « ${String(l[detail.colonnes[0].champ] ?? id)} » ?`,
                                    destructif: true,
                                    libelleConfirmer: 'Retirer',
                                    description: 'La ligne sera désactivée.',
                                    action: () => supprimer.mutate(id),
                                  })
                                }
                              >
                                <Trash2 />
                              </Bouton>
                            </td>
                          )}
                        </tr>
                      )
                    })}

                    {/* La ligne de saisie, a la suite : on tape et on ajoute. */}
                    {ecrire && (
                      <tr className="border-b border-bordure/60 bg-attenue/25">
                        {detail.colonnes.map((c) => (
                          <td key={c.champ} className={td}>
                            {c.options ? (
                              <Selecteur
                                className={champ}
                                aria-label={`${c.entete} (nouveau)`}
                                value={nouvelle[c.champ] ?? ''}
                                onChange={(e) =>
                                  setNouvelle((n) => ({ ...n, [c.champ]: e.target.value }))
                                }
                              >
                                <option value="">—</option>
                                {c.options.map((o) => (
                                  <option key={o.valeur} value={o.valeur}>
                                    {o.libelle}
                                  </option>
                                ))}
                              </Selecteur>
                            ) : (
                              <Champ
                                className={champ}
                                aria-label={`${c.entete} (nouveau)`}
                                value={nouvelle[c.champ] ?? ''}
                                placeholder={c.placeholder}
                                onChange={(e) =>
                                  setNouvelle((n) => ({ ...n, [c.champ]: e.target.value }))
                                }
                                onKeyDown={(e) => e.key === 'Enter' && complet && creer.mutate()}
                              />
                            )}
                          </td>
                        ))}
                        <td className={td}>
                          <Bouton
                            taille="sm"
                            disabled={!complet}
                            chargement={creer.isPending}
                            onClick={() => creer.mutate()}
                          >
                            <Plus />
                          </Bouton>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CarteCorps>
          </Carte>
        )}
      </div>
    </div>
  )
}

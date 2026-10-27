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
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Search, Trash2 } from 'lucide-react'
import { DialogueSuppression } from './DialogueSuppression'
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
import { cn } from '../lib/utils'
import { ChoixRecherche, type TypeChoix } from './ChoixRecherche'
import { IndiceChamp } from './ui/Indice'

const th = 'px-2 py-2 text-[11px] font-medium uppercase tracking-[0.05em] text-attenue-texte'
const td = 'px-2 py-1'
const champ = 'h-7 px-1.5 text-[12.5px]'
/* UNE CELLULE DEJA SAISIE SE LIT COMME DU TEXTE. Un cadre par cellule
   transformait la grille en formulaire de quarante champs ; le cadre revient
   au survol et a la saisie. En lecture seule, plus de pave gris « desactive ». */
const champLigne =
  champ +
  ' border-transparent bg-transparent hover:border-champ disabled:bg-transparent disabled:text-texte disabled:cursor-default'

export interface ColonneDetail {
  champ: string
  entete: string
  largeur?: string
  obligatoire?: boolean
  /** Liste fermee : le champ devient un choix. */
  options?: { valeur: string; libelle: string }[]
  /**
   * LISTE QUI GRANDIT (24/10/2026) : le champ se CHERCHE au serveur (un
   * fournisseur…) au lieu de se derouler. `libelleChoix` affiche la valeur
   * d'une ligne existante sans la relire.
   */
  choix?: TypeChoix
  libelleChoix?: (l: Ligne) => string | undefined
  placeholder?: string
  /** Non modifiable apres creation (une cle, par exemple). */
  cleCreation?: boolean
}

/* UN ALIAS, PAS UNE INTERFACE VIDE. `interface X extends Y {}` ne dit rien de
   plus que `Y` et laisse croire qu'on ajoutera des membres un jour. */
export type Ligne = Record<string, unknown>

/** La liste paginee du serveur : ses lignes, et combien il y en a en tout. */
interface Enveloppe {
  lignes: Ligne[]
  total: number
}

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
  /**
   * Ce qu'on peut faire de la LISTE ENTIERE — l'imprimer, le plus souvent.
   *
   * L'action se pose dans l'en-tete du niveau du haut, a cote du compte : c'est
   * la que porte le regard quand on cherche quoi faire de ce qu'on voit. La
   * ranger dans le menu general obligerait a quitter l'ecran pour retrouver la
   * meme liste sous un autre nom.
   */
  actions?: React.ReactNode
  /** Ce qu'on peut faire de LA LIGNE POINTEE : sa fiche imprimee, surtout. */
  actionsLigne?: (l: Ligne) => React.ReactNode
}

export function MaitreDetail({
  titre,
  module,
  maitre,
  detail,
  aide,
  actions,
  actionsLigne,
}: Props) {
  const droits = useDroits(module)
  const qc = useQueryClient()
  const [pointe, setPointe] = useState<string | null>(null)
  const [detailASupprimer, setDetailASupprimer] = useState<{ id: string; nom: string; version: unknown } | null>(null)
  const [maitreASupprimer, setMaitreASupprimer] = useState<{ id: string; nom: string; version: unknown } | null>(null)
  const [nouvelle, setNouvelle] = useState<Record<string, string>>({})
  const [nouveauMaitre, setNouveauMaitre] = useState<Record<string, string>>({})
  const [filtre, setFiltre] = useState('')

  /* LA LISTE COUPEE SE DIT (24/10/2026) : l'enveloppe paginee (`offset=0`)
     porte le total ; au-dela de la limite, l'ecran l'annonce au lieu de taire
     les lignes manquantes. */
  const qMaitre = useQuery({
    queryKey: [maitre.route, 'enveloppe'],
    queryFn: ({ signal }) =>
      api.get<Enveloppe>(`/api/${maitre.route}?actif=1&limite=500&offset=0`, { signal }),
  })
  const qDetail = useQuery({
    queryKey: [detail.route, 'enveloppe'],
    queryFn: ({ signal }) => api.get<Enveloppe>(`/api/${detail.route}?limite=2000&offset=0`, { signal }),
  })
  const maitres = qMaitre.data?.lignes
  const details = qDetail.data?.lignes
  const coupes = [qMaitre.data, qDetail.data].filter(
    (e): e is Enveloppe => !!e && e.total > e.lignes.length,
  )

  /*
   * LE PREMIER EST POINTE D'OFFICE. Sans cela l'ecran s'ouvre sur un grand
   * vide au milieu, et l'on croit qu'il n'existe pas : la liste de gauche
   * ressemble alors a tout l'ecran. Montrer d'emblee un cas reel dit ce que
   * l'ecran fait, et ce qu'on peut y saisir.
   */
  useEffect(() => {
    if (pointe !== null) return
    // AU BUREAU SEULEMENT. Au telephone, liste et detail ne tiennent pas
    // ensemble : pointer d'office masquait la liste des l'ouverture, et l'on
    // arrivait sur une categorie qu'on n'avait pas choisie.
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    const premier = maitres?.[0]
    if (premier) setPointe(String(premier[maitre.cle] ?? ''))
  }, [maitres, pointe, maitre.cle])

  const lignes = useMemo(() => {
    const tout = details ?? []
    return pointe === null ? [] : tout.filter((l) => String(l[detail.cleEtrangere] ?? '') === pointe)
  }, [details, pointe, detail.cleEtrangere])

  const orphelines = useMemo(
    () => (details ?? []).filter((l) => !l[detail.cleEtrangere]),
    [details, detail.cleEtrangere],
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

  if (qMaitre.isLoading) return <Chargement texte={`Lecture des ${titre.toLowerCase()}…`} />

  const tous = maitres ?? []
  const f = filtre.trim().toLowerCase()
  const visibles = f
    ? tous.filter((l) =>
        `${maitre.libelle(l)} ${maitre.detail?.(l) ?? ''}`.toLowerCase().includes(f),
      )
    : tous
  const courant = tous.find((l) => String(l[maitre.cle]) === pointe)
  const ecrire = droits.peutEcrire
  const complet = detail.colonnes
    .filter((c) => c.obligatoire)
    .every((c) => (nouvelle[c.champ] ?? '').trim())

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {coupes.length > 0 && (
        <Alerte ton="alerte" className="lg:col-span-2">
          {coupes.map((e) => `${e.lignes.length} premières lignes sur ${e.total}`).join(' · ')} : la liste
          est coupée, les suivantes ne sont pas affichées.
        </Alerte>
      )}
      {/* ---- Le niveau du haut ------------------------------------------- */}
      <Carte className={cn('h-fit', pointe && 'hidden lg:block')}>
        <CarteEntete>
          <CarteTitre>{titre}</CarteTitre>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] tabular-nums text-attenue-texte">{tous.length}</span>
            {actions}
          </div>
        </CarteEntete>
        <CarteCorps className="p-0">
          {/* Chercher des qu'on ne voit plus tout d'un coup d'oeil. */}
          {tous.length > 10 && (
            <div className="relative border-b border-ligne p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-attenue-texte" />
              <Champ
                className="h-8 pl-8 text-[12.5px]"
                placeholder="Chercher…"
                aria-label={`Chercher dans ${titre.toLowerCase()}`}
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
              />
            </div>
          )}
          <ul className="max-h-[calc(100dvh-17rem)] divide-y divide-ligne overflow-y-auto">
            {visibles.length === 0 && (
              <li className="px-3 py-6 text-center text-[12px] text-attenue-texte">
                {tous.length ? 'Aucune ligne ne correspond.' : 'Rien n’est encore saisi.'}
              </li>
            )}
            {visibles.map((l) => {
              const id = String(l[maitre.cle])
              const nb = (details ?? []).filter(
                (d) => String(d[detail.cleEtrangere] ?? '') === id,
              ).length
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setPointe(id)}
                    aria-current={pointe === id ? 'true' : undefined}
                    className={cn(
                      'relative flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[13px] transition-colors',
                      pointe === id
                        ? 'bg-primaire/[0.07] font-medium before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primaire'
                        : 'hover:bg-attenue/60',
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
                    <span
                      className="shrink-0 rounded-full bg-attenue px-2 py-0.5 text-[11px] tabular-nums text-attenue-texte"
                      title={`${nb} ${detail.unite.toLowerCase()}(s)`}
                    >
                      {nb}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {ecrire && maitre.champs && (
            <div className="space-y-1.5 border-t border-bordure bg-attenue/30 p-2.5">
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
              <div className="flex min-w-0 items-center gap-1">
                <Bouton
                  taille="icone-xs"
                  variante="discret"
                  className="-ml-1.5 lg:hidden"
                  aria-label="Retour à la liste"
                  onClick={() => setPointe(null)}
                >
                  <ArrowLeft />
                </Bouton>
                <CarteTitre className="truncate">{maitre.libelle(courant)}</CarteTitre>
              </div>
              <div className="flex items-center gap-2">
                {actionsLigne?.(courant)}
                {/* LE NIVEAU DU HAUT SE SUPPRIME AUSSI. Une categorie creee par
                    erreur n'avait aucune issue : seules ses lignes filles
                    portaient un bouton, et l'on gardait la categorie vide. */}
                {ecrire && (
                  <Bouton
                    taille="icone-xs"
                    variante="discret"
                    className="text-danger hover:bg-danger/10"
                    aria-label={`Supprimer ${maitre.unite}`}
                    onClick={() =>
                      setMaitreASupprimer({
                        id: String(courant[maitre.cle]),
                        nom: maitre.libelle(courant),
                        version: courant.version,
                      })
                    }
                  >
                    <Trash2 />
                  </Bouton>
                )}
              </div>
            </CarteEntete>
            {maitre.champs && (
              <CarteCorps className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 border-b border-bordure bg-attenue/25">
                {maitre.champs.filter((c) => !c.cleCreation).map((c) => (
                  <label key={c.champ} data-indice-gere="" className="flex flex-col gap-1 text-[11px] font-medium text-attenue-texte">
                    <span className="inline-flex items-center gap-1">
                      {c.entete}
                      <IndiceChamp intitule={c.entete} />
                    </span>
                    {c.options ? (
                      <Selecteur
                        className={cn(champ, 'h-8 w-full')}
                        aria-label={c.entete}
                        value={String(courant[c.champ] ?? '')}
                        disabled={!ecrire}
                        onChange={(e) =>
                          modifierMaitre.mutate({
                            id: String(courant[maitre.cle]),
                            patch: { [c.champ]: e.target.value || null, version: courant.version },
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
                        className={cn(champ, 'h-8 w-full')}
                        aria-label={c.entete}
                        defaultValue={String(courant[c.champ] ?? '')}
                        disabled={!ecrire}
                        key={String(courant[maitre.cle]) + c.champ}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== String(courant[c.champ] ?? '')) {
                            modifierMaitre.mutate({
                              id: String(courant[maitre.cle]),
                              patch: { [c.champ]: v || null, version: courant.version },
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
              <div tabIndex={0} role="region" aria-label="Lignes" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
                <table className="grille w-full text-[12.5px]">
                  <thead>
                    <tr className="bg-attenue/50">
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
                        <tr key={id} className="hover:bg-attenue/40">
                          {detail.colonnes.map((c) => (
                            <td key={c.champ} className={td}>
                              {c.choix ? (
                                <ChoixRecherche
                                  type={c.choix}
                                  ariaLabel={c.entete}
                                  valeur={String(l[c.champ] ?? '')}
                                  libelle={c.libelleChoix?.(l)}
                                  desactive={!ecrire || c.cleCreation}
                                  classeChamp="h-7 text-[12.5px]"
                                  onChange={(v) =>
                                    v !== String(l[c.champ] ?? '') &&
                                    modifier.mutate({ id, patch: { [c.champ]: v || null, version: l.version } })
                                  }
                                />
                              ) : c.options ? (
                                <Selecteur
                                  className={champLigne}
                                  aria-label={c.entete}
                                  value={String(l[c.champ] ?? '')}
                                  disabled={!ecrire || c.cleCreation}
                                  onChange={(e) =>
                                    modifier.mutate({ id, patch: { [c.champ]: e.target.value || null, version: l.version } })
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
                                  className={champLigne}
                                  aria-label={c.entete}
                                  defaultValue={String(l[c.champ] ?? '')}
                                  disabled={!ecrire || c.cleCreation}
                                  placeholder={c.placeholder}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim()
                                    if (v !== String(l[c.champ] ?? '')) {
                                      modifier.mutate({ id, patch: { [c.champ]: v || null, version: l.version } })
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
                                /* LE DIALOGUE DIT CE QUI RETIENT AVANT D'EFFACER.
                                   La confirmation precedente annoncait une
                                   desactivation ; le serveur, lui, efface pour
                                   de bon quand rien ne retient. Promettre le
                                   contraire est pire que de ne rien dire. */
                                onClick={() =>
                                  setDetailASupprimer({
                                    id,
                                    nom: String(l[detail.colonnes[0].champ] ?? id),
                                    version: l.version,
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
                      <tr className="bg-primaire/[0.03]">
                        {detail.colonnes.map((c) => (
                          <td key={c.champ} className={td}>
                            {c.choix ? (
                              <ChoixRecherche
                                type={c.choix}
                                ariaLabel={`${c.entete} (nouveau)`}
                                valeur={nouvelle[c.champ] ?? ''}
                                classeChamp="h-7 text-[12.5px]"
                                onChange={(v) => setNouvelle((n) => ({ ...n, [c.champ]: v }))}
                              />
                            ) : c.options ? (
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
                            aria-label="Ajouter la ligne"
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

      <DialogueSuppression
        ouvert={!!detailASupprimer}
        surFermeture={() => setDetailASupprimer(null)}
        entite={detail.route}
        id={detailASupprimer?.id ?? ''}
        version={detailASupprimer?.version}
        libelle={detailASupprimer ? `${detail.unite} « ${detailASupprimer.nom} »` : undefined}
      />

      <DialogueSuppression
        ouvert={!!maitreASupprimer}
        surFermeture={() => setMaitreASupprimer(null)}
        entite={maitre.route}
        id={maitreASupprimer?.id ?? ''}
        version={maitreASupprimer?.version}
        libelle={maitreASupprimer ? `${maitre.unite} « ${maitreASupprimer.nom} »` : undefined}
        surSucces={() => setPointe(null)}
      />
    </div>
  )
}

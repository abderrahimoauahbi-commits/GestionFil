/**
 * Nouveau bon de commande — en-tete ET lignes saisis ensemble.
 *
 * Le fournisseur choisi, l'ecran affiche immediatement ce qu'il faut lui
 * commander : les references issues du plan d'achat qui ne sont pas deja dans
 * un bon, avec pour chacune la quantite proposee, le besoin, le risque,
 * l'importance, le prix, le delai et l'urgence.
 *
 * Tout part en UNE transaction. Un bon a moitie cree — numero attribue, aucune
 * ligne — serait un document fantome que personne ne saurait interpreter, et
 * qui fausserait la numerotation autant que les etats.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Search } from 'lucide-react'
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
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'

const MODULE = 'BONS_COMMANDE'

interface RefCommandable extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  classe_abc: string | null
  moq_kg: number | null
  multiple_achat_kg: number | null
  stock_projete_kg: number | null
  stock_min_kg: number | null
  besoin_12m_kg: number | null
  deja_commande_kg: number | null
  jours_couverture: number | null
  statut_stock: string | null
  qte_a_commander_kg: number | null
  prix_suggere_devise?: number
  prix_mad_suggere?: number
  source_prix?: string
  risque_sourcing: string | null
  delai_livraison_jours: number | null
  tier: string | null
  deja_sur_le_bon: number
  /** Cette reference est l'equivalent d'une reference en tension. */
  equivalent_de: string | null
  besoin_equivalent_kg: number | null
  nb_equivalents: number
}

interface Fournisseur {
  code_fournisseur: string
  nom: string
  code_devise?: string
  delai_livraison_jours?: number
  pays?: string
}

const TON_STOCK: Record<string, 'danger' | 'alerte' | 'succes' | 'neutre'> = {
  RUPTURE: 'danger',
  CRITIQUE: 'danger',
  ATTENTION: 'alerte',
  OK: 'succes',
}

const TON_TIER: Record<string, 'danger' | 'alerte' | 'info' | 'neutre'> = {
  'TIER 1': 'danger',
  'TIER 2': 'alerte',
  'TIER 3': 'info',
  'TIER 4': 'neutre',
}

export function BonCommandeNouveau() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const naviguer = useNavigate()

  const [entete, setEntete] = useState({
    code_fournisseur: '',
    date_bc: new Date().toISOString().slice(0, 10),
    date_livraison_prevue: '',
    motif_creation: 'MRP',
    notes: '',
  })
  const [choix, setChoix] = useState<Record<string, { qte: string; prix: string }>>({})
  const [filtre, setFiltre] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)

  const qFrs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: () => api.get<Fournisseur[]>('/api/fournisseurs?actif=1&limite=500'),
  })
  const fournisseur = qFrs.data?.find((f) => f.code_fournisseur === entete.code_fournisseur)
  const devise = fournisseur?.code_devise ?? 'MAD'

  // Des le fournisseur choisi : ce qu'il faut lui commander. Pas d'etape
  // intermediaire, pas de document vide a ouvrir d'abord.
  const qRefs = useQuery({
    queryKey: ['refs-commandables', entete.code_fournisseur],
    queryFn: () =>
      api.get<RefCommandable[]>(
        `/api/references-commandables?code_fournisseur=${encodeURIComponent(entete.code_fournisseur)}`,
      ),
    enabled: !!entete.code_fournisseur,
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_bc: string; numero_bc: string; lignes: number }>('/api/bons-commande', {
        ...entete,
        lignes: Object.entries(choix).map(([code, v]) => ({
          code_reference: code,
          unite_commande: 'kg',
          quantite_commandee_unite: Number(v.qte),
          prix_unitaire_devise: Number(v.prix),
        })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.numero_bc} cree`, {
        description: `${r.lignes} ligne(s) · brouillon, rien n'est encore engage.`,
      })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
      naviguer(`/bons-commande/${r.id_bc}`)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Creation impossible.'),
  })

  const refs = useMemo(() => {
    const l = qRefs.data ?? []
    const f = filtre.toLowerCase()
    return l.filter(
      (r) =>
        !f ||
        r.code_reference.toLowerCase().includes(f) ||
        (r.designation ?? '').toLowerCase().includes(f),
    )
  }, [qRefs.data, filtre])

  // Trois sections, dans l'ordre ou l'acheteur decide.
  //
  // La deuxieme est la nouveaute : une reference que CE fournisseur livre, sans
  // besoin propre, mais equivalente a une reference en tension achetee ailleurs.
  // Elle tombait auparavant dans « les autres references », ou personne ne
  // faisait le rapprochement — c'est-a-dire au moment precis ou il aurait servi.
  const aCommander = refs.filter((r) => (r.qte_a_commander_kg ?? 0) > 0)
  const equivalentes = refs.filter(
    (r) => !((r.qte_a_commander_kg ?? 0) > 0) && !!r.equivalent_de,
  )
  const autres = refs.filter(
    (r) => !((r.qte_a_commander_kg ?? 0) > 0) && !r.equivalent_de,
  )

  const basculer = (r: RefCommandable) =>
    setChoix((c) => {
      if (c[r.code_reference]) {
        const { [r.code_reference]: _, ...reste } = c
        return reste
      }
      return {
        ...c,
        [r.code_reference]: {
          qte: String(r.qte_a_commander_kg ?? ''),
          prix: r.prix_suggere_devise != null ? String(r.prix_suggere_devise) : '',
        },
      }
    })

  const nb = Object.keys(choix).length
  const complet = Object.values(choix).every((v) => Number(v.qte) > 0 && Number(v.prix) > 0)
  const total = Object.values(choix).reduce((s, v) => s + Number(v.qte) * Number(v.prix), 0)
  const pret = !!entete.code_fournisseur && !!entete.date_bc && nb > 0 && complet

  const Ligne = ({ r }: { r: RefCommandable }) => {
    const coche = !!choix[r.code_reference]
    const deja = r.deja_sur_le_bon > 0
    return (
      <div
        className={cn(
          'rounded-[var(--radius)] border p-2',
          coche ? 'border-primaire bg-primaire/5' : 'border-bordure',
        )}
      >
        <label className={cn('flex items-start gap-2', deja ? 'opacity-60' : 'cursor-pointer')}>
          <input
            type="checkbox"
            checked={coche}
            disabled={deja}
            onChange={() => basculer(r)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{r.code_reference}</span>
              {r.statut_stock && (
                <Badge ton={TON_STOCK[r.statut_stock] ?? 'neutre'}>{r.statut_stock}</Badge>
              )}
              {r.tier && <Badge ton={TON_TIER[r.tier] ?? 'neutre'}>{r.tier}</Badge>}
              {r.classe_abc && <Badge ton="contour">ABC {r.classe_abc}</Badge>}
              {r.risque_sourcing === 'MONO-SOURCE' && <Badge ton="alerte">mono-source</Badge>}
              {r.equivalent_de && <Badge ton="info">equivalent</Badge>}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-attenue-texte">
              {r.designation}
            </span>
            {r.equivalent_de && (
              <span className="mt-1 block text-[11px] text-primaire">
                Remplace <strong>{r.equivalent_de}</strong>
                {r.besoin_equivalent_kg != null && (
                  <> — besoin de {fmt.nombre(r.besoin_equivalent_kg, 0)} kg non couvert</>
                )}
              </span>
            )}
            <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
              <span>
                Besoin{' '}
                <span className="tabular-nums text-texte">
                  {fmt.nombre(r.besoin_12m_kg ?? 0, 0)} kg
                </span>
              </span>
              <span>
                Projete{' '}
                <span className="tabular-nums text-texte">
                  {fmt.nombre(r.stock_projete_kg ?? 0, 0)} kg
                </span>
              </span>
              {(r.deja_commande_kg ?? 0) > 0 && (
                <span>
                  Deja commande{' '}
                  <span className="tabular-nums text-texte">
                    {fmt.nombre(r.deja_commande_kg ?? 0, 0)} kg
                  </span>
                </span>
              )}
              {r.jours_couverture != null && (
                <span>
                  Couverture{' '}
                  <span className="tabular-nums text-texte">
                    {fmt.nombre(r.jours_couverture, 0)} j
                  </span>
                </span>
              )}
              {r.delai_livraison_jours != null && <span>Delai {r.delai_livraison_jours} j</span>}
              {(r.qte_a_commander_kg ?? 0) > 0 && (
                <span>
                  Suggere{' '}
                  <span className="font-medium tabular-nums text-texte">
                    {fmt.nombre(r.qte_a_commander_kg ?? 0, 0)} kg
                  </span>
                </span>
              )}
              {r.prix_suggere_devise != null && (
                <span>
                  Prix{' '}
                  <span className="tabular-nums text-texte">
                    {fmt.nombre(r.prix_suggere_devise, 4)} {devise}
                  </span>
                </span>
              )}
              {r.source_prix === 'CATALOGUE' && (
                <span className="text-alerte">prix catalogue, jamais paye</span>
              )}
              {r.moq_kg != null && <span>MOQ {fmt.nombre(r.moq_kg, 0)} kg</span>}
              {deja && <span>deja sur un bon</span>}
            </span>
          </span>
        </label>

        {coche && (
          <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-3">
            <div>
              <Etiq>Quantite (kg)</Etiq>
              <Champ
                type="number"
                step="any"
                min="0.0001"
                value={choix[r.code_reference].qte}
                onChange={(e) =>
                  setChoix((c) => ({
                    ...c,
                    [r.code_reference]: { ...c[r.code_reference], qte: e.target.value },
                  }))
                }
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq>Prix {devise}/kg</Etiq>
              <Champ
                type="number"
                step="any"
                min="0.0001"
                value={choix[r.code_reference].prix}
                onChange={(e) =>
                  setChoix((c) => ({
                    ...c,
                    [r.code_reference]: { ...c[r.code_reference], prix: e.target.value },
                  }))
                }
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <Etiq>Total ligne</Etiq>
              <div className="flex h-8 items-center justify-end rounded-[var(--radius)] border border-bordure bg-attenue px-2 text-[13px] tabular-nums">
                {fmt.nombre(
                  Number(choix[r.code_reference].qte) * Number(choix[r.code_reference].prix),
                  2,
                )}{' '}
                {devise}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <EnTetePage
        titre="Nouveau bon de commande"
        description="Choisissez le fournisseur : ce qu'il faut lui commander s'affiche aussitot. Tout s'enregistre en une fois."
        actions={
          <Bouton variante="contour" onClick={() => naviguer('/bons-commande')}>
            <ArrowLeft />
            Retour
          </Bouton>
        }
      />

      {erreur && (
        <Alerte ton="danger" titre="Creation refusee" className="mb-3">
          {erreur}
        </Alerte>
      )}

      <div className="space-y-3">
        <Carte>
          <CarteEntete>
            <CarteTitre>En-tete</CarteTitre>
            {fournisseur && (
              <span className="text-[11px] text-attenue-texte">
                Devise {devise}
                {fournisseur.delai_livraison_jours != null &&
                  ` · delai annonce ${fournisseur.delai_livraison_jours} j`}
                {fournisseur.pays && ` · ${fournisseur.pays}`}
              </span>
            )}
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Etiq htmlFor="frs" obligatoire>
                Fournisseur
              </Etiq>
              <Selecteur
                id="frs"
                value={entete.code_fournisseur}
                onChange={(e) => {
                  setEntete({ ...entete, code_fournisseur: e.target.value })
                  setChoix({})
                }}
              >
                <option value="">Choisir…</option>
                {qFrs.data?.map((f) => (
                  <option key={f.code_fournisseur} value={f.code_fournisseur}>
                    {f.nom}
                  </option>
                ))}
              </Selecteur>
              <p className="mt-1 text-[11px] text-attenue-texte">
                Changer de fournisseur remet la selection a zero : la devise et les prix en
                dependent.
              </p>
            </div>
            <div>
              <Etiq htmlFor="datebc" obligatoire>
                Date du bon
              </Etiq>
              <Champ
                id="datebc"
                type="date"
                value={entete.date_bc}
                onChange={(e) => setEntete({ ...entete, date_bc: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="livr">Livraison prevue</Etiq>
              <Champ
                id="livr"
                type="date"
                value={entete.date_livraison_prevue}
                onChange={(e) => setEntete({ ...entete, date_livraison_prevue: e.target.value })}
              />
            </div>
            <div className="lg:col-span-2">
              <Etiq htmlFor="notes">Observations</Etiq>
              <Champ
                id="notes"
                value={entete.notes}
                onChange={(e) => setEntete({ ...entete, notes: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="motif">Motif</Etiq>
              <Selecteur
                id="motif"
                value={entete.motif_creation}
                onChange={(e) => setEntete({ ...entete, motif_creation: e.target.value })}
              >
                <option value="MRP">Issu du MRP</option>
                <option value="MANUEL">Manuel</option>
                <option value="OPPORTUNITE_PRIX">Opportunite de prix</option>
                <option value="ANTICIPATION_RISQUE">Anticipation de risque</option>
              </Selecteur>
            </div>
          </CarteCorps>
        </Carte>

        {!entete.code_fournisseur && (
          <Alerte ton="info">
            Choisissez un fournisseur : les references a lui commander s'afficheront ici, avec
            leur besoin, leur urgence et le prix propose.
          </Alerte>
        )}

        {entete.code_fournisseur && (
          <Carte>
            <CarteEntete>
              <CarteTitre>A commander chez {fournisseur?.nom}</CarteTitre>
              <div className="flex items-center gap-2">
                <Search className="size-3.5 text-attenue-texte" />
                <Champ
                  placeholder="Filtrer…"
                  value={filtre}
                  onChange={(e) => setFiltre(e.target.value)}
                  className="h-7 w-48"
                />
              </div>
            </CarteEntete>
            <CarteCorps>
              {qRefs.isLoading && <Chargement texte="Lecture du plan d'achat…" />}

              {!qRefs.isLoading && aCommander.length > 0 && (
                <>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Proposees par le plan d'achat ({aCommander.length})
                  </div>
                  <div className="space-y-1.5">
                    {aCommander.map((r) => (
                      <Ligne key={r.code_reference} r={r} />
                    ))}
                  </div>
                </>
              )}

              {!qRefs.isLoading && aCommander.length === 0 && (
                <Alerte ton="info" className="mb-3">
                  Le plan d'achat ne propose rien pour ce fournisseur : son stock projete couvre les
                  besoins. Vous pouvez tout de meme commander en choisissant ci-dessous.
                </Alerte>
              )}

              {equivalentes.length > 0 && (
                <>
                  <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Equivalentes a une reference en tension ({equivalentes.length})
                  </div>
                  <p className="mb-2 text-[11px] text-attenue-texte">
                    Ce fournisseur livre ces references, et chacune peut remplacer une reference
                    dont le stock projete ne couvre plus le besoin. Le MRP ne les propose pas — il
                    calcule par reference et ne mutualise jamais le stock d'un groupe — mais elles
                    couvriraient le manque.
                  </p>
                  <div className="space-y-1.5">
                    {equivalentes.map((r) => (
                      <Ligne key={r.code_reference} r={r} />
                    ))}
                  </div>
                </>
              )}

              {autres.length > 0 && (
                <>
                  <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
                    Autres references du fournisseur ({autres.length})
                  </div>
                  <div className="space-y-1.5">
                    {autres.map((r) => (
                      <Ligne key={r.code_reference} r={r} />
                    ))}
                  </div>
                </>
              )}
            </CarteCorps>
          </Carte>
        )}
      </div>

      {entete.code_fournisseur && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            {nb === 0 ? (
              <span className="text-attenue-texte">Aucune reference selectionnee.</span>
            ) : (
              <>
                <span className="font-medium">{nb} ligne(s)</span>
                <span className="text-attenue-texte"> · total </span>
                <span className="font-semibold tabular-nums">
                  {fmt.nombre(total, 2)} {devise}
                </span>
                {!complet && (
                  <span className="text-danger"> — quantite ou prix manquant sur une ligne</span>
                )}
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={() => naviguer('/bons-commande')}>
              Annuler
            </Bouton>
            <Bouton
              onClick={() => {
                setErreur(null)
                creer.mutate()
              }}
              chargement={creer.isPending}
              disabled={!pret || !droits.peutEcrire}
            >
              <Save />
              Creer le bon
            </Bouton>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * L'ESPACE « SIMULATION » DU STOCK PROJETÉ (décision du 27/10/2026) : « et si ? »
 * sur une référence, NON PERSISTANT, SANS AUCUNE APPLICATION — la simulation
 * n'écrit jamais rien, aucun bouton n'enregistre.
 *
 * On choisit une référence, puis des hypothèses que le moteur reçoit déjà en
 * entrée — ajouter un arrivage, changer la date ou les kilos d'un arrivage lu
 * (ou le retirer), simuler une commande, changer le délai fournisseur, la
 * couverture d'une commande, les jours de sécurité, le minimum ou le multiple.
 * À chaque changement, `POST /api/couverture/{ref}/simulation` (une LECTURE :
 * les hypothèses voyagent dans le corps) recalcule par LE MÊME MOTEUR, et
 * l'écran montre la situation réelle et la situation simulée côte à côte.
 * Les hypothèses vivent dans la page : la quitter les efface.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FlaskConical, Plus, RotateCcw, ShoppingCart, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { ChoixRecherche } from '../ChoixRecherche'
import { Alerte, Bouton, Champ, Chargement, Etiq } from '../ui/base'
import { cn, fmt } from '../../lib/utils'
import { CourbeSolde } from './CourbeSolde'
import {
  CalculProposition,
  ListeArrivages,
  LigneReglages,
  Projection,
  PropositionsSuivantes,
  Titre,
} from './DetailCouverture'
import { useDetailCouverture } from './lecture'
import { dateCourte, kg, libelleArrivage, type Arrivage, type ReponseSimulation, type VueAnalyse } from './types'

/** Ce que l'on tape : des textes, lus au moment d'envoyer. */
interface Ajout {
  id: number
  nature: 'arrivage' | 'commande'
  date: string
  kg: string
}

interface Modif {
  date?: string
  kg?: string
  retirer?: boolean
}

interface Saisie {
  delai: string
  couverture: string
  securite: string
  moq: string
  multiple: string
  modifs: Record<string, Modif>
  ajouts: Ajout[]
}

const VIDE: Saisie = { delai: '', couverture: '', securite: '', moq: '', multiple: '', modifs: {}, ajouts: [] }

const nombre = (t: string) => {
  if (t.trim() === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Le corps de la requête : seules les hypothèses saisies et lisibles. */
function corpsDe(s: Saisie, arrivages: Arrivage[]) {
  const corps: Record<string, unknown> = {}
  const entiers: [keyof Saisie, string][] = [
    ['delai', 'delai_j'],
    ['couverture', 'couverture_j'],
  ]
  for (const [cle, champ] of entiers) {
    const n = nombre(s[cle] as string)
    if (n !== undefined) corps[champ] = Math.round(n)
  }
  const securite = nombre(s.securite)
  if (securite !== undefined) corps.jours_securite = securite
  const moq = nombre(s.moq)
  if (moq !== undefined) corps.moq_kg = moq
  const multiple = nombre(s.multiple)
  if (multiple !== undefined) corps.multiple_kg = multiple

  const modifies = []
  for (const a of arrivages) {
    const m = a.cle ? s.modifs[a.cle] : undefined
    if (!m || !a.cle) continue
    const k = m.kg !== undefined ? nombre(m.kg) : undefined
    const date = m.date && m.date !== (a.date ?? '') ? m.date : undefined
    const kgChange = k !== undefined && Math.abs(k - a.kg) > 1e-9 ? k : undefined
    if (m.retirer) modifies.push({ cle: a.cle, retirer: true })
    else if (date || kgChange !== undefined) modifies.push({ cle: a.cle, date, kg: kgChange })
  }
  if (modifies.length) corps.arrivages_modifies = modifies

  const lus = (nature: Ajout['nature']) =>
    s.ajouts
      .filter((a) => a.nature === nature)
      .map((a) => ({ date: a.date, kg: nombre(a.kg) }))
      .filter((a): a is { date: string; kg: number } => !!a.date && a.kg !== undefined && a.kg > 0)
  const ajoutes = lus('arrivage')
  if (ajoutes.length) corps.arrivages_ajoutes = ajoutes
  const commandes = lus('commande')
  if (commandes.length) corps.commandes = commandes
  return corps
}

/** Attendre que la frappe se pose avant de recalculer. */
function useStable<T>(valeur: T, delai = 350) {
  const [stable, setStable] = useState(valeur)
  useEffect(() => {
    const t = setTimeout(() => setStable(valeur), delai)
    return () => clearTimeout(t)
  }, [valeur, delai])
  return stable
}

export function SimulationCouverture({
  reference,
  surReference,
}: {
  reference: string | null
  surReference: (reference: string | null) => void
}) {
  return (
    <div className="space-y-3" data-testid="simulation">
      {/* LE BANDEAU PERMANENT : on ne l'oublie pas en descendant la page. */}
      <div className="sticky top-0 z-10">
        <Alerte ton="info" icone={FlaskConical} titre="Simulation — rien n’est enregistré">
          Les hypothèses ne quittent pas cette page : elles ne changent ni le stock, ni les bons, ni le plan d’achat.
          Le calcul est celui du moteur de couverture, sur les données d’aujourd’hui.
        </Alerte>
      </div>
      <div className="max-w-xl">
        <Etiq htmlFor="simulation-reference">Référence à simuler</Etiq>
        <ChoixRecherche
          id="simulation-reference"
          type="reference"
          valeur={reference ?? ''}
          onChange={(v) => surReference(v || null)}
          vide="Choisir une référence"
          ariaLabel="Référence à simuler"
        />
      </div>
      {reference ? (
        <Espace key={reference} reference={reference} />
      ) : (
        <p className="text-[12.5px] text-attenue-texte">
          Choisissez une référence : sa situation réelle s’affiche, puis chaque hypothèse la recalcule à côté.
        </p>
      )}
    </div>
  )
}

function Espace({ reference }: { reference: string }) {
  const detail = useDetailCouverture(reference)
  const [saisie, setSaisie] = useState<Saisie>(VIDE)
  const prochainId = useRef(1)
  const arrivages = useMemo(() => detail.data?.arrivages ?? [], [detail.data])
  const corps = useStable(useMemo(() => corpsDe(saisie, arrivages), [saisie, arrivages]))
  const cle = JSON.stringify(corps)

  const q = useQuery({
    queryKey: ['couverture-simulation', reference, cle],
    queryFn: () =>
      api.post<ReponseSimulation>(`/api/couverture/${encodeURIComponent(reference)}/simulation`, JSON.parse(cle)),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const changer = (p: Partial<Saisie>) => setSaisie((s) => ({ ...s, ...p }))
  const modifier = (cleArrivage: string, m: Modif) =>
    setSaisie((s) => ({ ...s, modifs: { ...s.modifs, [cleArrivage]: { ...s.modifs[cleArrivage], ...m } } }))
  const ajouter = (nature: Ajout['nature'], date = '', kilos = '') =>
    setSaisie((s) => ({ ...s, ajouts: [...s.ajouts, { id: prochainId.current++, nature, date, kg: kilos }] }))
  const premiere = detail.data?.propositions?.[0]
  const r = detail.data?.reglages
  const nbHypotheses = q.data?.hypotheses.length ?? 0

  if (detail.isLoading) return <Chargement />
  if (detail.error || !detail.data)
    return (
      <Alerte ton="danger" taille="compacte">
        La référence {reference} n’a pas pu être lue
        {detail.error instanceof Error && detail.error.message ? ` : ${detail.error.message}` : '.'}
      </Alerte>
    )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
      {/* ---- Les hypothèses ---------------------------------------------- */}
      <section className="min-w-0 space-y-4 text-[12.5px]" aria-label="Hypothèses">
        <div className="flex items-center gap-2">
          <Titre>Hypothèses</Titre>
          <Bouton
            taille="xs"
            variante="discret"
            className="ml-auto -mt-1.5"
            onClick={() => setSaisie(VIDE)}
            disabled={saisie === VIDE}
            title="Revenir à la situation réelle"
          >
            <RotateCcw /> Tout effacer
          </Bouton>
        </div>

        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-[11.5px] text-attenue-texte">
            Réglages — vide : la valeur actuelle (entre parenthèses)
          </legend>
          <ChampReglage
            id="sim-delai"
            libelle="Délai fournisseur (j)"
            valeur={saisie.delai}
            actuel={r ? `${r.delai_j} j` : undefined}
            surChange={(v) => changer({ delai: v })}
          />
          <ChampReglage
            id="sim-couverture"
            libelle="Couverture d’une commande (j)"
            valeur={saisie.couverture}
            actuel={r ? `${r.couverture_commande_j} j` : undefined}
            surChange={(v) => changer({ couverture: v })}
          />
          <ChampReglage
            id="sim-securite"
            libelle="Jours de sécurité"
            valeur={saisie.securite}
            actuel={r ? `${fmt.nombre(r.jours_securite, 0)} j` : undefined}
            surChange={(v) => changer({ securite: v })}
          />
          <ChampReglage
            id="sim-moq"
            libelle="Minimum de commande (kg)"
            valeur={saisie.moq}
            actuel={r?.moq_kg ? `${kg(r.moq_kg)} kg` : 'aucun'}
            surChange={(v) => changer({ moq: v })}
          />
          <ChampReglage
            id="sim-multiple"
            libelle="Multiple d’achat (kg)"
            valeur={saisie.multiple}
            actuel={r?.multiple_kg ? `${kg(r.multiple_kg)} kg` : 'aucun'}
            surChange={(v) => changer({ multiple: v })}
          />
        </fieldset>

        <div>
          <p className="mb-1 text-[11.5px] text-attenue-texte">Arrivages lus — changer la date, les kilos, ou retirer</p>
          {arrivages.length === 0 && <p className="text-attenue-texte">Aucun arrivage lu.</p>}
          <ul className="space-y-2">
            {arrivages.map((a) => {
              const m = (a.cle && saisie.modifs[a.cle]) || {}
              const modifiable = a.origine !== 'IMPORT_SANS_BON' && !!a.cle
              return (
                <li key={a.cle ?? libelleArrivage(a)} className={cn('rounded border border-ligne p-1.5', m.retirer && 'opacity-60')}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{libelleArrivage(a)}</span>
                    <span className="text-[11px] text-attenue-texte">
                      {kg(a.kg)} kg{a.date ? ` le ${dateCourte(a.date)}` : ', sans date'} · {a.compte ? 'compté' : 'non compté'}
                    </span>
                  </div>
                  {modifiable ? (
                    <div className="mt-1 grid grid-cols-[1fr_6rem_auto] items-center gap-1.5">
                      <Champ
                        type="date"
                        aria-label={`Date de ${libelleArrivage(a)}`}
                        value={m.date ?? a.date ?? ''}
                        disabled={m.retirer}
                        onChange={(e) => modifier(a.cle!, { date: e.target.value })}
                      />
                      <Champ
                        type="number"
                        aria-label={`Kilos de ${libelleArrivage(a)}`}
                        value={m.kg ?? String(a.kg)}
                        disabled={m.retirer}
                        onChange={(e) => modifier(a.cle!, { kg: e.target.value })}
                      />
                      <label className="flex items-center gap-1 text-[11.5px]">
                        <input
                          type="checkbox"
                          checked={!!m.retirer}
                          onChange={(e) => modifier(a.cle!, { retirer: e.target.checked })}
                        />
                        retirer
                      </label>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-attenue-texte">
                      Import en route sans bon : pas de date fiable, la règle le laisse hors couverture.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div>
          <p className="mb-1 text-[11.5px] text-attenue-texte">Arrivages ajoutés et commandes simulées</p>
          <ul className="space-y-1.5">
            {saisie.ajouts.map((a) => (
              <li key={a.id} className="grid grid-cols-[1fr_6rem_auto] items-center gap-1.5">
                <span className="col-span-3 text-[11.5px] font-medium">
                  {a.nature === 'commande' ? 'Commande simulée' : 'Arrivage ajouté'}
                </span>
                <Champ
                  type="date"
                  aria-label={a.nature === 'commande' ? 'Date de disponibilité de la commande' : 'Date de l’arrivage'}
                  value={a.date}
                  onChange={(e) =>
                    changer({ ajouts: saisie.ajouts.map((x) => (x.id === a.id ? { ...x, date: e.target.value } : x)) })
                  }
                />
                <Champ
                  type="number"
                  aria-label="Kilos"
                  placeholder="kg"
                  value={a.kg}
                  onChange={(e) =>
                    changer({ ajouts: saisie.ajouts.map((x) => (x.id === a.id ? { ...x, kg: e.target.value } : x)) })
                  }
                />
                <Bouton
                  taille="icone-xs"
                  variante="discret"
                  aria-label="Retirer cette hypothèse"
                  onClick={() => changer({ ajouts: saisie.ajouts.filter((x) => x.id !== a.id) })}
                >
                  <Trash2 />
                </Bouton>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Bouton taille="xs" variante="contour" onClick={() => ajouter('arrivage')}>
              <Plus /> Ajouter un arrivage
            </Bouton>
            <Bouton
              taille="xs"
              variante="contour"
              onClick={() =>
                ajouter(
                  'commande',
                  premiere?.date_disponibilite ?? '',
                  typeof premiere?.quantite_proposee_kg === 'number' ? String(premiere.quantite_proposee_kg) : '',
                )
              }
              title={premiere ? 'Préremplie avec la première proposition du moteur (D et quantité)' : undefined}
            >
              <ShoppingCart /> Simuler une commande
            </Bouton>
          </div>
        </div>
      </section>

      {/* ---- Le résultat : réel et simulé ----------------------------------- */}
      <section className="min-w-0 space-y-4 text-[12.5px]" aria-label="Résultat de la simulation" aria-busy={q.isFetching}>
        {q.error && (
          <Alerte ton="danger" taille="compacte">
            {q.error instanceof Error ? q.error.message : 'La simulation n’a pas pu être calculée.'}
          </Alerte>
        )}
        {!q.data ? (
          <Chargement />
        ) : (
          <>
            <div>
              <Titre>Réel et simulé</Titre>
              <Comparaison reelle={q.data.reelle} simulee={q.data.simulee} />
              {nbHypotheses > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11.5px] text-attenue-texte">
                  {q.data.hypotheses.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[11.5px] text-attenue-texte">Aucune hypothèse : la simulation rend la situation réelle.</p>
              )}
            </div>
            {(q.data.simulee.jours?.length ?? 0) > 1 && (
              <div>
                <Titre>Solde projeté jour par jour</Titre>
                <CourbeSolde
                  jours={q.data.simulee.jours}
                  propositions={q.data.simulee.propositions ?? []}
                  comparaison={nbHypotheses > 0 ? q.data.reelle.jours : undefined}
                />
              </div>
            )}
            <div>
              <Titre>À commander simulé — le calcul</Titre>
              <LigneReglages d={q.data.simulee} />
              {q.data.simulee.propositions?.[0] ? (
                <div className="mt-1.5">
                  <CalculProposition p={q.data.simulee.propositions[0]} d={q.data.simulee} />
                </div>
              ) : (
                <Alerte ton="info" taille="compacte" className="mt-1.5">
                  Rien à commander : {q.data.simulee.motif_sans_proposition ?? 'aucune proposition sur l’horizon du plan'}.
                </Alerte>
              )}
              <PropositionsSuivantes d={{ ...q.data.simulee, max_propositions: q.data.max_propositions }} />
            </div>
            <div>
              <Titre>Arrivages simulés</Titre>
              <ListeArrivages arrivages={q.data.simulee.arrivages ?? []} />
            </div>
            <div>
              <Titre>Projection simulée</Titre>
              <Projection d={q.data.simulee} />
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ChampReglage({
  id,
  libelle,
  valeur,
  actuel,
  surChange,
}: {
  id: string
  libelle: string
  valeur: string
  actuel?: string
  surChange: (v: string) => void
}) {
  return (
    <div className="min-w-0">
      <Etiq htmlFor={id} className="normal-case tracking-normal">
        {libelle}
      </Etiq>
      <Champ id={id} type="number" value={valeur} placeholder={actuel ? `(${actuel})` : undefined} onChange={(e) => surChange(e.target.value)} />
    </div>
  )
}

/** Une ligne du face-à-face : l'intitulé, le réel, le simulé. */
interface Indicateur {
  libelle: string
  valeur: (v: VueAnalyse) => string
}

const kgDe = (n: unknown) => (typeof n === 'number' ? `${kg(n)} kg` : '—')

const INDICATEURS: Indicateur[] = [
  { libelle: 'Délai fournisseur', valeur: (v) => `${v.reglages?.delai_j ?? '—'} j` },
  { libelle: 'Arrivages comptés', valeur: (v) => kgDe(v.synthese.arrivages_comptes_kg) },
  { libelle: 'Stock y compris arrivages', valeur: (v) => kgDe(v.synthese.stock_total_projete_kg) },
  { libelle: 'Besoin jusqu’à livraison', valeur: (v) => kgDe(v.synthese.besoin_jusqu_livraison_kg) },
  {
    libelle: 'Couverture planifiée',
    valeur: (v) =>
      v.synthese.couvert_tout_horizon
        ? 'tout l’horizon'
        : v.synthese.jours_couverture != null
          ? `${v.synthese.jours_couverture} j (au ${dateCourte(v.synthese.couvert_jusqu_au)})`
          : '—',
  },
  { libelle: 'Passage sous la sécurité', valeur: (v) => dateCourte(v.synthese.premier_passage_securite) },
  { libelle: '1re rupture', valeur: (v) => (v.synthese.premiere_rupture ? dateCourte(v.synthese.premiere_rupture) : 'aucune') },
  { libelle: 'Besoin non couvert', valeur: (v) => kgDe(v.synthese.plan_non_couvert_kg) },
  {
    libelle: 'Quantité à commander',
    valeur: (v) => (v.propositions?.[0] ? kgDe(v.propositions[0].quantite_proposee_kg) : 'rien'),
  },
  { libelle: 'Disponible le (D)', valeur: (v) => dateCourte(v.propositions?.[0]?.date_disponibilite) },
  { libelle: 'Date limite de commande', valeur: (v) => dateCourte(v.propositions?.[0]?.date_limite_commande) },
  { libelle: 'Stock en fin d’horizon', valeur: (v) => kgDe(v.jours?.[v.jours.length - 1]?.solde_kg) },
]

function Comparaison({ reelle, simulee }: { reelle: VueAnalyse; simulee: VueAnalyse }) {
  return (
    <table className="w-full max-w-2xl text-[12px]">
      <thead>
        <tr className="border-b border-bordure text-[10.5px] uppercase tracking-wider text-attenue-texte">
          <th className="py-1 pr-2 text-left font-semibold">Indicateur</th>
          <th className="py-1 pr-2 text-right font-semibold">Réel</th>
          <th className="py-1 text-right font-semibold">Simulé</th>
        </tr>
      </thead>
      <tbody>
        {INDICATEURS.map((i) => {
          const a = i.valeur(reelle)
          const b = i.valeur(simulee)
          return (
            <tr key={i.libelle} className="border-b border-ligne">
              <td className="py-0.5 pr-2">{i.libelle}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums text-attenue-texte">{a}</td>
              <td className={cn('py-0.5 text-right tabular-nums', a !== b && 'font-semibold text-primaire')}>{b}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

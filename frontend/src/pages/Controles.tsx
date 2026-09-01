/**
 * Les controles de coherence, leur etat et leur detail.
 *
 * POURQUOI CET ECRAN. Vingt-neuf controles tournent depuis l'origine. Leur
 * resultat n'apparaissait qu'en resume — un compteur dans la cloche, une ligne
 * dans la barre d'etat. Personne ne pouvait voir QUELLES lignes sont fautives,
 * donc personne ne corrigeait. Cinq controles sortent des anomalies aujourd'hui.
 *
 * L'ECRAN NE JUGE PAS, IL MONTRE. Il n'invente aucun seuil et ne reclasse rien :
 * la criticite vient de la base, le decompte aussi. Un ecran qui repeindrait un
 * BLOQUANT en orange parce qu'il n'y a qu'une ligne fautive tromperait sur la
 * nature de la regle.
 *
 * LE DETAIL EST CHARGE A LA DEMANDE. Vingt-neuf requetes de detail a
 * l'ouverture couteraient cher pour, la plupart du temps, vingt-neuf resultats
 * vides. On ne demande que le controle ouvert.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import { Alerte, Bouton, Carte, CarteCorps, Chargement, EtatVide, Squelette } from '../composants/ui/base'
import { exporterCsv } from '../lib/export'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'

const MODULE = 'COCKPIT'

interface Controle {
  code: string
  controle: string
  criticite: 'BLOQUANT' | 'CRITIQUE' | 'ATTENTION'
  anomalies: number
  [k: string]: unknown
}

/** Une ligne de detail : sa forme depend du controle, d'ou l'index libre. */
type LigneDetail = Record<string, unknown>

const ORDRE: Record<string, number> = { BLOQUANT: 0, CRITIQUE: 1, ATTENTION: 2 }

const TEINTE: Record<string, string> = {
  BLOQUANT: 'text-danger',
  CRITIQUE: 'text-alerte',
  ATTENTION: 'text-alerte',
}

const FOND: Record<string, string> = {
  BLOQUANT: 'bg-danger/12 text-danger',
  CRITIQUE: 'bg-alerte/15 text-alerte',
  ATTENTION: 'bg-alerte/12 text-alerte',
}

/**
 * Ce que chaque niveau engage, dit une fois plutot que repete par ligne.
 *
 * La nuance BLOQUANT / CRITIQUE n'est pas une graduation d'urgence mais une
 * difference de nature : le premier signale une incoherence qui ne devrait pas
 * pouvoir exister, le second une situation metier qui demande une decision.
 */
const SENS: Record<string, string> = {
  BLOQUANT:
    "Une incoherence qui ne devrait pas pouvoir exister. Si le compteur n'est pas a zero, une regle a ete contournee : la cause se cherche avant de corriger la ligne.",
  CRITIQUE:
    'Une situation metier qui demande une decision, pas une correction technique. Elle ne se resorbe pas seule.',
  ATTENTION:
    'Un signal a examiner. Il peut etre normal — une reference neuve sans recette le temps de la composer — comme il peut annoncer un oubli.',
}

function Pastille({ c }: { c: Controle }) {
  if (c.anomalies === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[3px] bg-succes/12 px-1.5 py-px text-[11px] font-medium text-succes">
        <CheckCircle2 className="size-3" />
        au vert
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px text-[11px] font-medium tabular-nums',
        FOND[c.criticite],
      )}
    >
      <TriangleAlert className="size-3" />
      {fmt.nombre(c.anomalies, 0)}
    </span>
  )
}

/** Le detail d'un controle : les lignes reellement fautives. */
function Detail({ code, libelle }: { code: string; libelle: string }) {
  const q = useQuery({
    queryKey: ['controle-detail', code],
    queryFn: () => api.get<LigneDetail[]>(`/api/controles/${code}`),
  })

  if (q.isLoading) return <Squelette className="h-24" />
  const lignes = q.data ?? []
  if (!lignes.length) {
    return (
      <p className="px-3 py-3 text-[12px] text-attenue-texte">
        Aucune ligne en anomalie. Le compteur a pu changer depuis le dernier rafraichissement.
      </p>
    )
  }

  const colonnes = Object.keys(lignes[0])

  return (
    <>
      <div className="defilement-x">
        <table className="grille w-full text-[12px]">
          <thead>
            <tr className="bg-attenue">
              {colonnes.map((c) => (
                <th key={c} className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold">
                  {/* Les noms de colonnes viennent de la vue SQL : on les rend
                      lisibles sans les traduire, faute de savoir ce que chaque
                      controle expose. */}
                  {c.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.slice(0, 200).map((l, i) => (
              <tr key={i} className="hover:bg-attenue/60">
                {colonnes.map((c) => {
                  const v = l[c]
                  const numerique = typeof v === 'number'
                  return (
                    <td
                      key={c}
                      className={cn(
                        'max-w-[280px] truncate px-2.5 py-1',
                        numerique && 'text-right tabular-nums',
                      )}
                    >
                      {v == null ? (
                        <span className="text-attenue-texte">—</span>
                      ) : numerique ? (
                        fmt.nombre(v, Number.isInteger(v) ? 0 : 2)
                      ) : (
                        String(v)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bordure px-3 py-2">
        <span className="text-[11px] text-attenue-texte">
          {lignes.length} ligne(s)
          {lignes.length > 200 && ' — les 200 premieres affichees, toutes exportees'}
        </span>
        <Bouton
          variante="contour"
          taille="sm"
          onClick={() => exporterCsv(`controle-${code}`, colonnes.map((c) => ({
            champ: c,
            entete: c.replace(/_/g, ' '),
            numerique: typeof lignes[0][c] === 'number',
          })), lignes)}
        >
          Exporter le detail
        </Bouton>
      </div>
      <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
        {libelle}
      </p>
    </>
  )
}

export function Controles() {
  const droits = useDroits(MODULE)
  const [filtre, setFiltre] = useState('')
  const [ouvert, setOuvert] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['controles'],
    queryFn: () => api.get<Controle[]>('/api/controles'),
    refetchInterval: 5 * 60_000,
  })

  const tous = q.data ?? []
  const enAnomalie = tous.filter((c) => c.anomalies > 0)
  const vus = filtre
    ? filtre === 'ANOMALIE'
      ? enAnomalie
      : tous.filter((c) => c.criticite === filtre)
    : tous

  /* Tri : par gravite, puis les anomalies avant les controles au vert, puis par
     code. Un BLOQUANT au vert reste plus haut qu'une ATTENTION en anomalie —
     c'est la nature de la regle qui prime, pas son etat du jour. */
  const tries = [...vus].sort(
    (a, b) =>
      ORDRE[a.criticite] - ORDRE[b.criticite] ||
      (b.anomalies > 0 ? 1 : 0) - (a.anomalies > 0 ? 1 : 0) ||
      a.code.localeCompare(b.code),
  )

  const parNiveau = (n: string) => tous.filter((c) => c.criticite === n)
  const groupes: GroupeRail[] = [
    {
      titre: 'Etat',
      entrees: [
        {
          cle: 'ANOMALIE',
          libelle: 'En anomalie',
          resume: `${enAnomalie.length} controle(s)`,
          ton: enAnomalie.length ? ('danger' as const) : ('succes' as const),
        },
      ],
    },
    {
      titre: 'Criticite',
      entrees: (['BLOQUANT', 'CRITIQUE', 'ATTENTION'] as const).map((n) => ({
        cle: n,
        libelle: n === 'BLOQUANT' ? 'Bloquants' : n === 'CRITIQUE' ? 'Critiques' : 'Attention',
        resume: `${parNiveau(n).filter((c) => c.anomalies > 0).length} sur ${parNiveau(n).length}`,
      })),
    },
  ]

  const totalAnomalies = enAnomalie.reduce((s, c) => s + c.anomalies, 0)

  return (
    <div>
      <EnTetePage
        titre="Controles de coherence"
        sous_titre="Ce que la base verifie sur elle-meme, et ce qu elle trouve"
        actions={
          <>
            <Bouton
              variante="contour"
              onClick={() =>
                exporterCsv('controles-coherence', [
                  { champ: 'code', entete: 'Code' },
                  { champ: 'criticite', entete: 'Criticite' },
                  { champ: 'controle', entete: 'Controle' },
                  { champ: 'anomalies', entete: 'Anomalies', numerique: true },
                ], tous)
              }
              disabled={!tous.length}
            >
              Exporter
            </Bouton>
            <Bouton variante="contour" onClick={() => void q.refetch()} chargement={q.isFetching}>
              <RefreshCw />
              Relancer
            </Bouton>
          </>
        }
      />

      <PageAvecRail
        large
        rail={
          <RailLateral
            groupes={groupes}
            actif={filtre}
            surChoix={(c) => setFiltre((v) => (v === c ? '' : c))}
          />
        }
      >
        {q.isLoading ? (
          <Chargement texte="Execution des controles…" />
        ) : !droits.peutLire ? (
          <Alerte ton="info">Module non accessible.</Alerte>
        ) : (
          <>
            {enAnomalie.length === 0 ? (
              <Alerte ton="succes" titre="Aucune anomalie">
                Les {tous.length} controles sont au vert. Ils se relancent a chaque lecture : ce
                resultat est celui de maintenant, pas d un calcul de la nuit.
              </Alerte>
            ) : (
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span className="text-attenue-texte">
                  {enAnomalie.length} controle(s) en anomalie sur {tous.length} ·{' '}
                  <span className="font-medium tabular-nums text-texte">
                    {fmt.nombre(totalAnomalies, 0)} ligne(s) concernee(s)
                  </span>
                </span>
                {parNiveau('BLOQUANT').some((c) => c.anomalies > 0) && (
                  <span className="flex items-center gap-1 text-danger">
                    <ShieldAlert className="size-3.5" />
                    des controles bloquants sont en anomalie
                  </span>
                )}
              </div>
            )}

            {!tries.length ? (
              <EtatVide icone={CheckCircle2} titre="Aucun controle dans cette selection" />
            ) : (
              <div className="flex flex-col gap-1.5">
                {tries.map((c) => {
                  const deplie = ouvert === c.code
                  return (
                    <Carte key={c.code}>
                      <button
                        type="button"
                        onClick={() => setOuvert(deplie ? null : c.code)}
                        disabled={c.anomalies === 0}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 py-2 text-left',
                          c.anomalies > 0 ? 'cursor-pointer hover:bg-attenue/50' : 'cursor-default',
                        )}
                      >
                        <span
                          className={cn(
                            'w-9 shrink-0 font-mono text-[12px] font-semibold',
                            c.anomalies > 0 ? TEINTE[c.criticite] : 'text-attenue-texte',
                          )}
                        >
                          {c.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{c.controle}</span>
                        <span className="hidden shrink-0 text-[10px] uppercase tracking-wider text-attenue-texte sm:inline">
                          {c.criticite}
                        </span>
                        <Pastille c={c} />
                        {c.anomalies > 0 && (
                          <ChevronDown
                            className={cn(
                              'size-4 shrink-0 text-attenue-texte transition-transform duration-150',
                              deplie && 'rotate-180',
                            )}
                          />
                        )}
                      </button>

                      {deplie && (
                        <CarteCorps className="border-t border-bordure p-0">
                          <Detail code={c.code} libelle={SENS[c.criticite]} />
                        </CarteCorps>
                      )}
                    </Carte>
                  )
                })}
              </div>
            )}

            {/* Ce que le compteur ne dit pas, et qui evite une lecture fausse. */}
            <p className="mt-3 text-[11px] leading-relaxed text-attenue-texte">
              Les controles se recalculent a chaque ouverture : ils n ont pas de memoire. Rien ne
              retient depuis quand une anomalie dure, ni ce qui a ete decide. C est l objet du
              journal des alertes, qui reste a raccorder.
            </p>
          </>
        )}
      </PageAvecRail>
    </div>
  )
}

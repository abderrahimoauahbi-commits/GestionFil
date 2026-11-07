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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import { Alerte, Badge, Bouton, Carte, CarteCorps, Champ, Chargement, EtatVide, Squelette } from '../composants/ui/base'
import { exporterCsv } from '../lib/export'
import { cn, fmt } from '../lib/utils'
import { TEXTE_TON, libelleStatut, tonStatut } from '../lib/statuts'

const MODULE = 'COCKPIT'

interface Controle {
  code: string
  controle: string
  criticite: 'BLOQUANT' | 'CRITIQUE' | 'ATTENTION'
  anomalies: number
  /** Les lignes deja vues et acquittees (07/11/2026) ; `anomalies` reste le compte brut. */
  acquittees?: number
  [k: string]: unknown
}

/** Une ligne de detail : sa forme depend du controle, d'ou l'index libre. */
type LigneDetail = Record<string, unknown>

/** Les cles techniques d'une ligne : l'empreinte et l'acquittement, hors colonnes du controle. */
const TECHNIQUES = new Set([
  'empreinte_anomalie',
  'id_acceptation',
  'motif_acceptation',
  'acquittee_par',
  'date_acceptation',
])

const ORDRE: Record<string, number> = { BLOQUANT: 0, CRITIQUE: 1, ATTENTION: 2 }

/**
 * Ce que chaque niveau engage, dit une fois plutot que repete par ligne.
 *
 * La nuance BLOQUANT / CRITIQUE n'est pas une graduation d'urgence mais une
 * difference de nature : le premier signale une incoherence qui ne devrait pas
 * pouvoir exister, le second une situation metier qui demande une decision.
 */
const SENS: Record<string, string> = {
  BLOQUANT:
    "Une incoherence qui ne devrait pas pouvoir exister. Si le compteur n'est pas a zero, une règle a ete contournee : la cause se cherche avant de corriger la ligne.",
  CRITIQUE:
    'Une situation metier qui demande une décision, pas une correction technique. Elle ne se resorbe pas seule.',
  ATTENTION:
    'Un signal a examiner. Il peut etre normal — une référence neuve sans recette le temps de la composer — comme il peut annoncer un oubli.',
}

function Pastille({ c }: { c: Controle }) {
  // Le ton vient de la table des statuts (criticite) : CRITIQUE y est danger,
  // comme partout ailleurs (24/10/2026).
  if (c.anomalies === 0) {
    return (
      <Badge ton="succes">
        <CheckCircle2 className="size-3" />
        au vert
      </Badge>
    )
  }
  return (
    <Badge ton={tonStatut('criticite', c.criticite)} className="tabular-nums" title={libelleStatut('criticite', c.criticite)}>
      <TriangleAlert className="size-3" />
      {fmt.nombre(c.anomalies, 0)}
      {(c.acquittees ?? 0) > 0 && <span className="font-normal opacity-80">· {fmt.nombre(c.acquittees ?? 0, 0)} acquittée(s)</span>}
    </Badge>
  )
}

/**
 * L'ACQUITTEMENT D'UNE LIGNE (07/11/2026) : vue, comprise, laissee — jamais pour
 * un BLOQUANT ; droit VALIDER ; motif exige ; valable tant que l'anomalie existe.
 * Le motif se saisit sur la ligne, pas dans une fenetre.
 */
function CelluleAcquittement({
  code,
  ligne,
  acquittable,
}: {
  code: string
  ligne: LigneDetail
  acquittable: boolean
}) {
  const qc = useQueryClient()
  const [motif, setMotif] = useState<string | null>(null)
  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['controle-detail', code] })
    void qc.invalidateQueries({ queryKey: ['controles'] })
  }
  const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')
  const acquitter = useMutation({
    mutationFn: () =>
      api.post(`/api/controles/${code}/acquittements`, { empreinte: ligne.empreinte_anomalie, motif: motif ?? '' }),
    onSuccess: () => {
      toast.success('Anomalie acquittée')
      setMotif(null)
      rafraichir()
    },
    onError: echec,
  })
  const lever = useMutation({
    mutationFn: () => api.post(`/api/acquittements/${String(ligne.id_acceptation)}/lever`, {}),
    onSuccess: () => {
      toast.success('Acquittement retiré : l’anomalie est de nouveau à traiter')
      rafraichir()
    },
    onError: echec,
  })

  if (ligne.id_acceptation) {
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-attenue-texte" title={String(ligne.motif_acceptation ?? '')}>
          Acquittée par {String(ligne.acquittee_par ?? '—')} le {String(ligne.date_acceptation ?? '')} —{' '}
          {String(ligne.motif_acceptation ?? '')}
        </span>
        {acquittable && (
          <Bouton variante="contour" taille="xs" disabled={lever.isPending} onClick={() => lever.mutate()}>
            Retirer
          </Bouton>
        )}
      </div>
    )
  }
  if (!acquittable) return null
  if (motif === null) {
    return (
      <Bouton variante="contour" taille="xs" onClick={() => setMotif('')}>
        Acquitter
      </Bouton>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <Champ
        autoFocus
        className="h-6 w-56 text-[12px]"
        placeholder="Motif (obligatoire)"
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setMotif(null)
          if (e.key === 'Enter' && motif.trim().length >= 3) acquitter.mutate()
        }}
        aria-label="Motif de l’acquittement"
      />
      <Bouton
        taille="xs"
        disabled={motif.trim().length < 3 || acquitter.isPending}
        onClick={() => acquitter.mutate()}
      >
        Acquitter
      </Bouton>
      <Bouton variante="contour" taille="xs" onClick={() => setMotif(null)}>
        Annuler
      </Bouton>
    </div>
  )
}

/** Le detail d'un controle : les lignes reellement fautives. */
function Detail({ code, libelle, criticite }: { code: string; libelle: string; criticite: string }) {
  const droits = useDroits(MODULE)
  const q = useQuery({
    queryKey: ['controle-detail', code],
    queryFn: ({ signal }) => api.get<LigneDetail[]>(`/api/controles/${code}`, { signal }),
  })
  // Un BLOQUANT ne s'acquitte jamais ; les autres, par le droit VALIDER.
  const acquittable = criticite !== 'BLOQUANT' && !!droits.peutValider

  if (q.isLoading) return <Squelette className="h-24" />
  const lignes = q.data ?? []
  if (!lignes.length) {
    return (
      <p className="px-3 py-3 text-[12px] text-attenue-texte">
        Aucune ligne en anomalie. Le compteur a pu changer depuis le dernier rafraichissement.
      </p>
    )
  }

  const colonnes = Object.keys(lignes[0]).filter((c) => !TECHNIQUES.has(c))
  const avecAcquittement = criticite !== 'BLOQUANT'

  return (
    <>
      <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
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
              {avecAcquittement && <th className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold">Acquittement</th>}
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
                {avecAcquittement && (
                  <td className="px-2.5 py-1">
                    <CelluleAcquittement code={code} ligne={l} acquittable={acquittable} />
                  </td>
                )}
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
          Exporter le détail
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
    queryFn: ({ signal }) => api.get<Controle[]>('/api/controles', { signal }),
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
      titre: 'État',
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
        titre="Contrôles de cohérence"
        sous_titre="Ce que la base vérifie sur elle-même, et ce qu’elle trouve"
        actions={
          <>
            <Bouton
              variante="contour"
              onClick={() =>
                exporterCsv('controles-coherence', [
                  { champ: 'code', entete: 'Code' },
                  { champ: 'criticite', entete: 'Criticite' },
                  { champ: 'controle', entete: 'Contrôle' },
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
          <Chargement texte="Execution des contrôles…" />
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
                    des contrôles bloquants sont en anomalie
                  </span>
                )}
              </div>
            )}

            {!tries.length ? (
              <EtatVide icone={CheckCircle2} titre="Aucun contrôle dans cette sélection" />
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
                            c.anomalies > 0 ? TEXTE_TON[tonStatut('criticite', c.criticite)] : 'text-attenue-texte',
                          )}
                        >
                          {c.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{c.controle}</span>
                        <span className="hidden shrink-0 text-[10px] uppercase tracking-wider text-attenue-texte sm:inline">
                          {libelleStatut('criticite', c.criticite)}
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
                          <Detail code={c.code} libelle={SENS[c.criticite]} criticite={c.criticite} />
                        </CarteCorps>
                      )}
                    </Carte>
                  )
                })}
              </div>
            )}

            {/* Ce que le compteur ne dit pas, et qui evite une lecture fausse. */}
            <p className="mt-3 text-[11px] leading-relaxed text-attenue-texte">
              Les controles se recalculent a chaque ouverture. Une anomalie ATTENTION ou CRITIQUE
              deja examinee s’acquitte, avec son motif : le compteur garde le total, l’acquittement
              dit qu’elle est vue. Il vaut tant que l’anomalie existe ; disparue, il est levé. Un
              BLOQUANT ne s’acquitte jamais.
            </p>
          </>
        )}
      </PageAvecRail>
    </div>
  )
}

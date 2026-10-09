/**
 * LES AUTORISATIONS — la file des demandes adressees aux responsables.
 *
 * Une ligne de document qui depasse la tolerance rouge (ecart de poids,
 * melange de fournisseurs, lot bloque, restes en production…) ne passe pas
 * sans l'accord d'un responsable. La demande arrive ici, motif compris ; le
 * responsable accorde ou refuse — un refus s'explique toujours — et le
 * demandeur peut retirer la sienne.
 *
 * ON N'AUTORISE PAS SA PROPRE DEMANDE (sauf l'administrateur, comme pour la
 * validation des bons) : le serveur le refuse, l'ecran ne propose donc pas le
 * bouton, et dit pourquoi.
 *
 * Decider demande le droit VALIDER du module LOTS, ou la Direction (regle 5).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Check, Printer, TriangleAlert, Undo2 } from 'lucide-react'

import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { TableauImprimable } from '../../composants/Etat'
import { Badge, Bouton, EtatVide, Selecteur, Squelette } from '../../composants/ui/base'
import { Onglet, Onglets, OngletsListe } from '../../composants/ui/surcouches'
import { libelleLot } from '../../lib/lots'
import { cn, fmt } from '../../lib/utils'
import { DecisionMotivee, LienLot } from './commun'
import { MODULE_DECISION, STATUTS_DEMANDE, TYPES_DEMANDE, messageErreur, useApresDecision, type Demande } from './modele'

type Geste = { demande: Demande; decision: 'ACCORDEE' | 'REFUSEE' | 'ANNULEE' }

/** Les details d'une demande, en mots : `{ecart_pct: 4.2}` -> « écart pct : 4,2 ». */
function resumeDetails(d: unknown): string {
  if (!d || typeof d !== 'object') return ''
  return Object.entries(d as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `${k.replace(/_/g, ' ')} : ${typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v)}`)
    .join(' · ')
}

export function Autorisations() {
  const { moi, peut } = useAuth()
  // Regle 5 : le droit VALIDER des lots, ou la Direction.
  const peutDecider = peut(MODULE_DECISION, 'VALIDER') || moi?.role === 'DIRECTION'
  const apres = useApresDecision()
  const [onglet, setOnglet] = useState('attente')
  const [type, setType] = useState('')
  const [geste, setGeste] = useState<Geste | null>(null)

  const q = useQuery({
    queryKey: ['autorisations'],
    queryFn: () => api.get<Demande[]>('/api/autorisations'),
  })

  const toutes = useMemo(() => q.data ?? [], [q.data])
  const enAttente = useMemo(() => toutes.filter((d) => d.statut === 'EN_ATTENTE'), [toutes])
  /* L'HISTORIQUE, LE PLUS RECENT D'ABORD : on y cherche la decision d'hier,
     pas celle de l'an dernier. La file, elle, garde l'ordre d'arrivee — la
     plus ancienne attend depuis le plus longtemps. */
  const historique = useMemo(
    () =>
      toutes
        .filter((d) => d.statut !== 'EN_ATTENTE')
        .sort((a, b) => (b.date_decision ?? b.date_demande).localeCompare(a.date_decision ?? a.date_demande)),
    [toutes],
  )
  const affichees = (onglet === 'attente' ? enAttente : historique).filter((d) => !type || d.type_demande === type)
  const types = useMemo(() => [...new Set(toutes.map((d) => d.type_demande))].sort(), [toutes])

  const estAMoi = (d: Demande) => !!moi && d.id_demandeur === moi.id
  const peutRepondre = (d: Demande) => peutDecider && (!estAMoi(d) || moi?.role === 'ADMIN')

  const envoyer = async (g: Geste, motif: string) => {
    await api.post(`/api/autorisations/${encodeURIComponent(g.demande.id_demande)}/decider`, {
      decision: g.decision,
      motif: motif || null,
    })
    await apres()
    toast.success(
      g.decision === 'ACCORDEE' ? 'Autorisation accordée' : g.decision === 'REFUSEE' ? 'Autorisation refusée' : 'Demande retirée',
    )
  }

  const historiqueVisible = onglet === 'historique'

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Autorisations"
        description="Les demandes qui attendent l’accord d’un responsable : écart de poids hors tolérance, mélange de fournisseurs, lot bloqué…"
        actions={
          <Bouton variante="contour" onClick={() => window.print()} disabled={!affichees.length}>
            <Printer />
            Imprimer
          </Bouton>
        }
      />

      <div className="sans-impression flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Onglets value={onglet} onValueChange={setOnglet}>
            <OngletsListe>
              <Onglet value="attente">
                À décider
                <span
                  className={cn('text-[11px] tabular-nums', enAttente.length ? 'font-semibold text-alerte' : 'text-attenue-texte')}
                >
                  {q.data ? enAttente.length : '…'}
                </span>
              </Onglet>
              <Onglet value="historique">
                Historique
                <span className="text-[11px] tabular-nums text-attenue-texte">{q.data ? historique.length : '…'}</span>
              </Onglet>
            </OngletsListe>
          </Onglets>
          <Selecteur value={type} onChange={(e) => setType(e.target.value)} className="w-full sm:w-64" aria-label="Type de demande">
            <option value="">Tous les types de demande</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPES_DEMANDE[t] ?? t}
              </option>
            ))}
          </Selecteur>
        </div>

        {!peutDecider && onglet === 'attente' && enAttente.length > 0 && (
          <p className="text-[12.5px] text-attenue-texte">
            Vous pouvez consulter la file et retirer vos propres demandes ; accorder ou refuser revient à un responsable.
          </p>
        )}

        {q.isLoading ? (
          <Squelette className="h-64 w-full" />
        ) : q.error ? (
          <EtatVide
            icone={TriangleAlert}
            titre="Les demandes n’ont pas pu être chargées"
            description={`${messageErreur(q.error)} Rechargez la page ; si l’erreur revient, signalez-la.`}
          />
        ) : !affichees.length ? (
          <EtatVide
            titre={onglet === 'attente' ? 'Aucune demande en attente' : 'Aucune décision enregistrée'}
            description={
              onglet === 'attente'
                ? 'Toutes les demandes ont reçu une réponse.'
                : 'Les demandes accordées, refusées ou retirées apparaîtront ici.'
            }
          />
        ) : (
          <div className="overflow-auto rounded-[var(--radius)] border border-bordure bg-surface" style={{ maxHeight: 'calc(100dvh - 17rem)' }}>
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
                  <th className="px-2 py-1.5 text-left font-medium">Demandée le</th>
                  <th className="px-2 py-1.5 text-left font-medium">Demande</th>
                  <th className="px-2 py-1.5 text-left font-medium">Article / lot</th>
                  <th className="px-2 py-1.5 text-left font-medium">Document</th>
                  <th className="px-2 py-1.5 text-left font-medium">Par</th>
                  <th className="px-2 py-1.5 text-left font-medium">Motif de la demande</th>
                  {historiqueVisible && (
                    <>
                      <th className="px-2 py-1.5 text-left font-medium">Réponse</th>
                      <th className="px-2 py-1.5 text-left font-medium">Décidée par</th>
                    </>
                  )}
                  {!historiqueVisible && <th className="px-2 py-1.5 text-right font-medium">Décision</th>}
                </tr>
              </thead>
              <tbody>
                {affichees.map((d) => {
                  const st = STATUTS_DEMANDE[d.statut] ?? { libelle: d.statut, ton: 'neutre' as const }
                  const details = resumeDetails(d.details)
                  return (
                    <tr key={d.id_demande} className="border-t border-bordure align-top hover:bg-attenue/40">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmt.dateHeure(d.date_demande)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-medium">{TYPES_DEMANDE[d.type_demande] ?? d.type_demande}</span>
                          <Badge ton={d.niveau === 'ROUGE' ? 'danger' : 'alerte'}>{d.niveau === 'ROUGE' ? 'Rouge' : 'Orange'}</Badge>
                        </div>
                        {details && <div className="text-[10.5px] text-attenue-texte">{details}</div>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <div className="font-mono text-[11.5px]">{d.code_reference ?? '—'}</div>
                        {d.lot_fournisseur &&
                          (d.code_reference ? (
                            <LienLot reference={d.code_reference} lot={d.lot_fournisseur} className="text-[11.5px]" />
                          ) : (
                            <span className="font-mono text-[11.5px]">{libelleLot(d.lot_fournisseur)}</span>
                          ))}
                        {d.kg_autorises != null && (
                          <div className="text-[10.5px] tabular-nums text-attenue-texte">
                            {fmt.nombre(Number(d.kg_autorises), 1)} kg au plus
                            {d.kg_consommes != null && ` — ${fmt.nombre(Number(d.kg_consommes), 1)} kg employés`}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11.5px]">{d.document ?? '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {d.demandeur ?? '—'}
                        {estAMoi(d) && <span className="ml-1 text-[10.5px] text-attenue-texte">(vous)</span>}
                      </td>
                      <td className="min-w-[14rem] px-2 py-1.5">{d.motif}</td>
                      {historiqueVisible ? (
                        <>
                          <td className="min-w-[12rem] px-2 py-1.5">
                            <Badge ton={st.ton}>{st.libelle}</Badge>
                            {d.motif_decision && <div className="mt-0.5 text-attenue-texte">{d.motif_decision}</div>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {d.decideur ?? (d.statut === 'ANNULEE' ? d.demandeur ?? '—' : '—')}
                            {d.date_decision && (
                              <div className="text-[10.5px] tabular-nums text-attenue-texte">{fmt.dateHeure(d.date_decision)}</div>
                            )}
                          </td>
                        </>
                      ) : (
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap justify-end gap-1">
                            {peutRepondre(d) && (
                              <>
                                <Bouton taille="xs" onClick={() => setGeste({ demande: d, decision: 'ACCORDEE' })}>
                                  <Check />
                                  Accorder
                                </Bouton>
                                <Bouton
                                  taille="xs"
                                  variante="contour"
                                  className="text-danger"
                                  onClick={() => setGeste({ demande: d, decision: 'REFUSEE' })}
                                >
                                  <Ban />
                                  Refuser
                                </Bouton>
                              </>
                            )}
                            {estAMoi(d) && (
                              <Bouton taille="xs" variante="contour" onClick={() => setGeste({ demande: d, decision: 'ANNULEE' })}>
                                <Undo2 />
                                Retirer
                              </Bouton>
                            )}
                            {peutDecider && estAMoi(d) && moi?.role !== 'ADMIN' && (
                              <span className="w-full text-right text-[10.5px] text-attenue-texte">
                                Un autre responsable doit répondre.
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {geste && (
        <DecisionMotivee
          ouvert
          surFermeture={() => setGeste(null)}
          titre={
            geste.decision === 'ACCORDEE'
              ? 'Accorder l’autorisation'
              : geste.decision === 'REFUSEE'
                ? 'Refuser l’autorisation'
                : 'Retirer votre demande'
          }
          consequence={
            <>
              <div className="font-medium">
                {TYPES_DEMANDE[geste.demande.type_demande] ?? geste.demande.type_demande}
                {geste.demande.lot_fournisseur && <> — lot {libelleLot(geste.demande.lot_fournisseur)}</>}
                {geste.demande.code_reference && <> ({geste.demande.code_reference})</>}
                {geste.demande.kg_autorises != null && <> — {fmt.nombre(Number(geste.demande.kg_autorises), 1)} kg au plus</>}
              </div>
              <div className="mt-1 text-attenue-texte">
                Demandé par {geste.demande.demandeur ?? '—'} : « {geste.demande.motif} »
              </div>
              <div className="mt-2">
                {geste.decision === 'ACCORDEE'
                  ? 'Le document en attente pourra passer, une fois. La dérogation est inscrite sur la fiche du lot : dites pourquoi, le motif est obligatoire.'
                  : geste.decision === 'REFUSEE'
                    ? 'Le document en attente reste bloqué. Dites au demandeur pourquoi : le motif est obligatoire.'
                    : 'La demande est retirée de la file ; elle reste dans l’historique.'}
              </div>
            </>
          }
          motifObligatoire={geste.decision !== 'ANNULEE'}
          destructif={geste.decision === 'REFUSEE'}
          libelleBouton={geste.decision === 'ACCORDEE' ? 'Accorder' : geste.decision === 'REFUSEE' ? 'Refuser' : 'Retirer la demande'}
          envoyer={(motif) => envoyer(geste, motif)}
        />
      )}

      <TableauImprimable<Demande>
        titre={onglet === 'attente' ? 'Autorisations en attente' : 'Historique des autorisations'}
        resume={`${affichees.length} demande(s)${type ? ` · ${TYPES_DEMANDE[type] ?? type}` : ''}`}
        lignes={affichees}
        colonnes={[
          { entete: 'Date', valeur: (d) => fmt.dateHeure(d.date_demande) },
          { entete: 'Demande', valeur: (d) => `${TYPES_DEMANDE[d.type_demande] ?? d.type_demande} (${d.niveau.toLowerCase()})` },
          { entete: 'Article', valeur: (d) => d.code_reference ?? '' },
          { entete: 'Lot', valeur: (d) => libelleLot(d.lot_fournisseur) },
          { entete: 'Document', valeur: (d) => d.document ?? '' },
          { entete: 'Par', valeur: (d) => d.demandeur ?? '' },
          { entete: 'Motif', valeur: (d) => d.motif },
          { entete: 'Statut', valeur: (d) => STATUTS_DEMANDE[d.statut]?.libelle ?? d.statut },
          { entete: 'Réponse', valeur: (d) => [d.decideur, d.motif_decision].filter(Boolean).join(' : ') },
        ]}
      />
    </div>
  )
}

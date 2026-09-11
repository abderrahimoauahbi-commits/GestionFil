/**
 * Le parc machine — declarer, configurer, arreter, retirer.
 *
 * SEPARE DE L'ECRAN MACHINES, ET C'EST LE POINT. L'ecran Machines sert au
 * magasinier : charger, decharger, constater. Celui-ci sert a la direction :
 * declarer un metier, corriger ses capacites, dire pourquoi il ne tourne pas.
 * Deux metiers, deux rythmes — on declare une machine une fois, on la charge
 * toutes les semaines — et deux droits : `PARAMETRES/ECRIRE` ici,
 * `MOUVEMENTS/ECRIRE` la-bas.
 *
 * QUATRE ETATS ET PAS UN INTERRUPTEUR. Devant un metier arrete, la question
 * n'est jamais « est-il actif ? » mais « pourquoi ne tourne-t-il pas ? ». Une
 * panne appelle un technicien, un sommeil appelle une commande, un retrait
 * n'appelle rien. Un booleen efface la difference, et avec elle la seule
 * information utile.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Check, Cog, Loader2, Moon, Plus, Power, Trash2, Wrench, X,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Alerte, Chargement } from '../composants/ui/base'
import { EnTetePage } from '../composants/Coquille'
import { cn } from '../lib/utils'
import { EditeurMachine } from './machines/EditeurMachine'
import { fmtDate, machinesApi, nb, type Machine, type Zone } from './machines/noyau'

type Etat = 'ACTIVE' | 'PANNE' | 'SOMMEIL' | 'RETIREE'

/** Ce que chaque etat veut dire, et ce qu'il appelle. */
const ETATS: Record<Etat, { libelle: string; explication: string; Icone: typeof Power; classe: string }> = {
  ACTIVE: {
    libelle: 'En production',
    explication: 'Le métier tourne. Tout est permis.',
    Icone: Power,
    classe: 'border-succes/30 bg-succes/10 text-succes',
  },
  PANNE: {
    libelle: 'En panne',
    explication: 'Arrêtée sur incident. Elle porte peut-être encore du fil : on peut la décharger.',
    Icone: Wrench,
    classe: 'border-danger/30 bg-danger/10 text-danger',
  },
  SOMMEIL: {
    libelle: 'En sommeil',
    explication: 'Arrêtée volontairement — pas de commande, changement de série.',
    Icone: Moon,
    classe: 'border-info/30 bg-info/10 text-info',
  },
  RETIREE: {
    libelle: 'Retirée du parc',
    explication: 'Sortie définitivement. Elle ne doit plus rien porter.',
    Icone: X,
    classe: 'border-bordure bg-attenue text-attenue-texte',
  },
}

export function ParcMachines() {
  const { peut } = useAuth()
  const qc = useQueryClient()
  const parametrable = peut('PARAMETRES', 'ECRIRE')

  const [editee, setEditee] = useState<Machine | null | undefined>(undefined)
  const [etatDe, setEtatDe] = useState<Machine | null>(null)
  const [voirRetirees, setVoirRetirees] = useState(false)

  const qMachines = useQuery({ queryKey: ['machines'], queryFn: machinesApi.liste })
  const qPlan = useQuery({
    queryKey: ['machine-plan', editee?.code_machine],
    queryFn: () => machinesApi.plan(editee!.code_machine),
    enabled: !!editee,
  })

  if (qMachines.isLoading) return <Chargement texte="Lecture du parc…" />

  const toutes = qMachines.data ?? []
  const machines = voirRetirees ? toutes : toutes.filter((m) => m.etat !== 'RETIREE')
  const retirees = toutes.length - toutes.filter((m) => m.etat !== 'RETIREE').length

  /* L'editeur remplace la table : declarer une machine demande toute l'attention,
     et une table qui reste visible derriere invite a cliquer ailleurs au milieu
     d'une saisie. */
  if (editee !== undefined) {
    return (
      <div className="flex flex-col gap-3">
        <EnTetePage titre="Parc machines" />
        <EditeurMachine
          machine={editee}
          plan={(qPlan.data ?? []) as Zone[]}
          fermer={() => setEditee(undefined)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage titre="Parc machines" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[68ch] text-[13px] text-attenue-texte">
          Les métiers de l&rsquo;atelier, leurs zones et leur état. Le chargement et le
          déchargement se font depuis l&rsquo;écran <strong>Machines</strong>&nbsp;; ici on déclare
          et on configure.
        </p>
        <div className="flex items-center gap-2">
          {retirees > 0 && (
            <button
              type="button"
              onClick={() => setVoirRetirees((v) => !v)}
              className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure px-3
                         text-[13px] hover:bg-attenue"
            >
              {voirRetirees ? 'Masquer' : 'Voir'} les {retirees} retirée
              {retirees > 1 ? 's' : ''}
            </button>
          )}
          {parametrable && (
            <button
              type="button"
              onClick={() => setEditee(null)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[var(--radius-sm)]
                         bg-primaire px-3 text-[13px] font-semibold text-primaire-texte"
            >
              <Plus className="size-3.5" />
              Déclarer une machine
            </button>
          )}
        </div>
      </div>

      {machines.length === 0 ? (
        <Alerte ton="info" titre="Aucune machine déclarée">
          {parametrable
            ? 'Commencez par « Déclarer une machine » : code, nom, puis les zones — étages, fil de chaîne, trame, réserve — avec le nombre de bobines de chacune.'
            : 'La direction doit déclarer les métiers avant que le magasin puisse les charger.'}
        </Alerte>
      ) : (
        <>
          {/* UNE TABLE N'EST PAS UNE FORME MOBILE. A 390 px, « Portées »,
              « Dernier constat » et surtout « Actions » sortaient de l'écran, et
              rien ne disait qu'on pouvait faire glisser. Sous 768 px on montre
              donc des cartes ; au-delà, la table, qui reste la meilleure forme
              pour comparer plusieurs machines d'un coup d'œil. */}
        <div className="hidden overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface md:block">
          <table className="w-full min-w-[54rem] text-[13px]">
            <thead>
              <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
                <th className="px-3 py-2 text-left">Machine</th>
                <th className="px-3 py-2 text-left">État</th>
                <th className="px-3 py-2 text-right">Zones</th>
                <th className="px-3 py-2 text-right">Capacité</th>
                <th className="px-3 py-2 text-right">Portées</th>
                <th className="px-3 py-2 text-left">Dernier constat</th>
                {parametrable && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {machines.map((m) => {
                const e = ETATS[(m.etat as Etat) ?? 'ACTIVE']
                return (
                  <tr key={m.code_machine} className="border-t border-bordure">
                    <td className="px-3 py-2">
                      <div className="font-medium text-texte">{m.nom}</div>
                      <div className="font-mono text-[11px] text-attenue-texte">
                        {m.code_machine}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
                          'text-[11px] font-medium',
                          e.classe,
                        )}
                      >
                        <e.Icone className="size-3" />
                        {e.libelle}
                      </span>
                      {m.motif_etat && (
                        <div className="mt-0.5 max-w-[22rem] text-[11px] text-attenue-texte">
                          {m.motif_etat}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-attenue-texte">
                      {m.nb_zones}
                      {m.nb_etages > 0 && (
                        <span className="text-[11px]"> · {m.nb_etages} ét.</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{nb(m.capacite_bobines, 0)}</td>
                    <td className="px-3 py-2 text-right">
                      {m.bobines_presentes > 0 ? (
                        <span className="font-medium text-texte">
                          {nb(m.bobines_presentes, 0)}
                        </span>
                      ) : (
                        <span className="text-attenue-texte">vide</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-attenue-texte">
                      {fmtDate(m.dernier_constat)}
                    </td>
                    {parametrable && (
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditee(m)}
                            className="inline-flex min-h-[30px] items-center gap-1 rounded-[3px]
                                       border border-bordure px-2 text-[12px] hover:bg-attenue"
                          >
                            <Cog className="size-3" />
                            Configurer
                          </button>
                          <button
                            type="button"
                            onClick={() => setEtatDe(m)}
                            className="inline-flex min-h-[30px] items-center gap-1 rounded-[3px]
                                       border border-bordure px-2 text-[12px] hover:bg-attenue"
                          >
                            <Power className="size-3" />
                            État
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* --- La meme chose, en cartes, sur telephone ------------------- */}
        <div className="flex flex-col gap-2 md:hidden">
          {machines.map((m) => {
            const e = ETATS[(m.etat as Etat) ?? 'ACTIVE']
            return (
              <article
                key={m.code_machine}
                className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-bordure
                           bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium text-texte">{m.nom}</div>
                    <div className="font-mono text-[11px] text-attenue-texte">
                      {m.code_machine}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5',
                      'text-[11px] font-medium',
                      e.classe,
                    )}
                  >
                    <e.Icone className="size-3" />
                    {e.libelle}
                  </span>
                </div>

                {m.motif_etat && (
                  <p className="text-[12px] text-attenue-texte">{m.motif_etat}</p>
                )}

                {/* Les chiffres en ligne, avec leur nom : sans etiquette, un
                    nombre seul sur un telephone ne veut rien dire. */}
                <dl className="grid grid-cols-3 gap-2 text-[12px] tabular-nums">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-attenue-texte">
                      Capacité
                    </dt>
                    <dd className="font-medium text-texte">{nb(m.capacite_bobines, 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-attenue-texte">
                      Portées
                    </dt>
                    <dd className={m.bobines_presentes > 0 ? 'font-medium text-texte' : 'text-attenue-texte'}>
                      {m.bobines_presentes > 0 ? nb(m.bobines_presentes, 0) : 'vide'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-attenue-texte">
                      Zones
                    </dt>
                    <dd className="text-texte">
                      {m.nb_zones}
                      {m.nb_etages > 0 && (
                        <span className="text-attenue-texte"> · {m.nb_etages} ét.</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="text-[11px] text-attenue-texte">
                  Dernier constat&nbsp;: {fmtDate(m.dernier_constat)}
                </div>

                {parametrable && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditee(m)}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5
                                 rounded-[var(--radius-sm)] border border-bordure text-[13px]
                                 hover:bg-attenue"
                    >
                      <Cog className="size-3.5" />
                      Configurer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEtatDe(m)}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5
                                 rounded-[var(--radius-sm)] border border-bordure text-[13px]
                                 hover:bg-attenue"
                    >
                      <Power className="size-3.5" />
                      État
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
        </>
      )}

      {etatDe && (
        <PanneauEtat
          machine={etatDe}
          fermer={() => setEtatDe(null)}
          apres={() => {
            void qc.invalidateQueries({ queryKey: ['machines'] })
            setEtatDe(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Changer l'etat, ou supprimer une machine jamais utilisee.
 *
 * SUPPRIMER N'EST PAS RETIRER, et l'ecran doit le dire. Une machine qui a
 * travaille garde des fiches et des mouvements qui la citent : elle se retire,
 * son passe reste lisible. Seule une machine creee par erreur, jamais chargee,
 * s'efface — et le serveur refuse tout le reste, avec le compte de ce qui
 * l'empeche.
 */
function PanneauEtat({
  machine, fermer, apres,
}: {
  machine: Machine
  fermer: () => void
  apres: () => void
}) {
  const [etat, setEtat] = useState<Etat>((machine.etat as Etat) ?? 'ACTIVE')
  const [motif, setMotif] = useState('')

  const changer = useMutation({
    mutationFn: () =>
      api.patch(`/api/machines/${encodeURIComponent(machine.code_machine)}/etat`, {
        etat,
        motif: motif.trim() || null,
      }),
    onSuccess: apres,
  })

  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/machines/${encodeURIComponent(machine.code_machine)}`),
    onSuccess: apres,
  })

  const motifRequis = etat !== 'ACTIVE'
  const pret = etat !== machine.etat && (!motifRequis || motif.trim().length > 0)

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-bordure bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-texte">{machine.nom}</h2>
        <button
          type="button"
          onClick={fermer}
          className="inline-flex min-h-[30px] items-center gap-1 rounded-[var(--radius-sm)]
                     border border-bordure px-2.5 text-[12px] hover:bg-attenue"
        >
          <X className="size-3" />
          Fermer
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(ETATS) as Etat[]).map((k) => {
          const e = ETATS[k]
          return (
            <button
              key={k}
              type="button"
              onClick={() => setEtat(k)}
              className={cn(
                'flex flex-col gap-0.5 rounded-[var(--radius-sm)] border p-2.5 text-left',
                etat === k ? 'border-primaire bg-primaire/5' : 'border-bordure hover:bg-attenue',
              )}
            >
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-texte">
                <e.Icone className="size-3.5" />
                {e.libelle}
              </span>
              <span className="text-[11px] text-attenue-texte">{e.explication}</span>
            </button>
          )
        })}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-attenue-texte">
          Motif {motifRequis ? '(obligatoire)' : '(facultatif)'}
        </span>
        <input
          value={motif}
          onChange={(ev) => setMotif(ev.target.value)}
          placeholder={
            etat === 'PANNE' ? 'Rupture courroie, pièce commandée le 9/09'
              : etat === 'SOMMEIL' ? 'Pas de commande jusqu’en octobre'
              : etat === 'RETIREE' ? 'Vendue / ferraillée'
              : ''
          }
          className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[13px]"
        />
      </label>

      {etat === 'RETIREE' && machine.bobines_presentes > 0 && (
        <Alerte ton="danger" titre="La machine porte encore du fil">
          {nb(machine.bobines_presentes, 0)} bobines sont dessus. Déchargez-la d&rsquo;abord :
          sinon ce fil disparaît des comptes sans qu&rsquo;aucun magasin le reçoive.
        </Alerte>
      )}

      {(changer.isError || supprimer.isError) && (
        <Alerte ton="danger" titre="Refusé">
          {((changer.error ?? supprimer.error) as Error).message}
        </Alerte>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!pret || changer.isPending}
          onClick={() => changer.mutate()}
          className="inline-flex min-h-[38px] items-center gap-2 rounded-[var(--radius-sm)]
                     bg-primaire px-4 text-[14px] font-semibold text-primaire-texte
                     disabled:opacity-40"
        >
          {changer.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Enregistrer l&rsquo;état
        </button>

        {/* SUPPRIMER RESTE A L'ECART, et se justifie a l'ecran. Le serveur refuse
            des qu'une fiche existe : le bouton ne fait que porter la demande. */}
        <button
          type="button"
          disabled={supprimer.isPending}
          onClick={() => supprimer.mutate()}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)]
                     border border-danger/40 px-3 text-[13px] text-danger hover:bg-danger/10
                     disabled:opacity-40"
        >
          {supprimer.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          Supprimer définitivement
        </button>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-attenue-texte">
          <AlertTriangle className="size-3.5" />
          Refusé dès que la machine a servi — retirez-la du parc à la place.
        </span>
      </div>
    </div>
  )
}

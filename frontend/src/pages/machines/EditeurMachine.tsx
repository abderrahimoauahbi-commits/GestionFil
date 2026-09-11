/**
 * Declarer une machine, ou corriger celle qui existe.
 *
 * LA MACHINE SE DECRIT PAR SES ZONES. Pas de « nombre d'etages » ni de
 * « capacite par etage » : l'atelier enumere ce qu'il voit — six etages de 1344
 * bobines, six bobines de trame, un fil de chaine, une reserve — et le total se
 * calcule sous ses yeux. Trois chiffres saisis separement finissaient toujours
 * par se contredire.
 *
 * CHAINE ET TRAME VARIENT D'UNE MACHINE A L'AUTRE, et une machine peut n'avoir
 * aucun etage : le metier qui ne file que chaine et trame se declare ici comme
 * les autres. C'est pour cela que chaque zone porte sa propre capacite.
 *
 * L'ECRAN N'EST PAS UNE SECURITE. Il ne s'affiche qu'avec PARAMETRES/ECRIRE,
 * mais c'est le serveur qui refuse — un magasinier qui appellerait l'API
 * directement recevrait un 403.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Alerte } from '../../composants/ui/base'
import { cn } from '../../lib/utils'
import {
  LIBELLE_ROLE, machinesApi, nb,
  type Machine, type RoleZone, type Zone, type ZoneSaisie,
} from './noyau'

/** Une ligne du tableau, avec la cle stable qu'exige React. */
interface LigneZone extends ZoneSaisie {
  cle: string
}

let compteur = 0
const neuve = (role: RoleZone, numero: number | null, capacite: number): LigneZone => ({
  cle: `z${++compteur}`,
  role,
  numero_etage: numero,
  capacite_bobines: capacite,
})

/** Le plan existant, ramene a des lignes de saisie. */
function depuisPlan(zones: Zone[]): LigneZone[] {
  return zones
    .slice()
    .sort((a, b) =>
      a.role === b.role ? a.numero_etage - b.numero_etage : a.role.localeCompare(b.role),
    )
    .map((z) => neuve(z.role as RoleZone, z.role === 'ETAGE' ? z.numero_etage : null,
                      z.capacite_bobines))
}

export function EditeurMachine({
  machine, plan, fermer,
}: {
  /** Nulle pour une declaration ; renseignee pour une correction. */
  machine: Machine | null
  plan: Zone[]
  fermer: () => void
}) {
  const qc = useQueryClient()
  const correction = !!machine

  const [code, setCode] = useState(machine?.code_machine ?? '')
  const [nom, setNom] = useState(machine?.nom ?? '')
  const [lignes, setLignes] = useState<LigneZone[]>(
    machine ? depuisPlan(plan) : [neuve('ETAGE', 1, 0)],
  )

  const etages = lignes.filter((l) => l.role === 'ETAGE')
  const total = lignes.reduce((s, l) => s + (l.capacite_bobines || 0), 0)

  function majLigne(cle: string, champ: keyof LigneZone, v: unknown) {
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, [champ]: v } : l)))
  }

  /* LES ETAGES SE RENUMEROTENT TOUT SEULS. Le serveur refuse un trou entre deux
     etages ; laisser l'operateur gerer les numeros a la main garantirait ce
     refus au premier retrait d'une ligne du milieu. */
  function retirer(cle: string) {
    setLignes((ls) => {
      const reste = ls.filter((l) => l.cle !== cle)
      let n = 0
      return reste.map((l) => (l.role === 'ETAGE' ? { ...l, numero_etage: ++n } : l))
    })
  }

  function ajouterEtage() {
    setLignes((ls) => [...ls, neuve('ETAGE', ls.filter((l) => l.role === 'ETAGE').length + 1, 0)])
  }

  function ajouterZone(role: RoleZone) {
    if (lignes.some((l) => l.role === role)) return
    setLignes((ls) => [...ls, neuve(role, null, 0)])
  }

  const envoi = useMutation({
    mutationFn: () => {
      const corps = {
        code_machine: code.trim().toUpperCase(),
        nom: nom.trim(),
        zones: lignes.map((l) => ({
          role: l.role,
          numero_etage: l.role === 'ETAGE' ? l.numero_etage : null,
          capacite_bobines: l.capacite_bobines,
        })),
      }
      return correction ? machinesApi.corriger(machine!.code_machine, corps)
                        : machinesApi.declarer(corps)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['machines'] })
      void qc.invalidateQueries({ queryKey: ['machine-plan'] })
      fermer()
    },
  })

  const pret =
    nom.trim().length > 0 &&
    (correction || code.trim().length > 0) &&
    lignes.length > 0 &&
    lignes.every((l) => l.capacite_bobines > 0)

  const manquantes = (['CHAINE', 'TRAME', 'RESERVE'] as RoleZone[]).filter(
    (r) => !lignes.some((l) => l.role === r),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-texte">
          {correction ? `Configurer ${machine!.nom}` : 'Déclarer une machine'}
        </h2>
        <button
          type="button"
          onClick={fermer}
          className="inline-flex min-h-[34px] items-center gap-1 rounded-[var(--radius-sm)]
                     border border-bordure px-3 text-[13px] hover:bg-attenue"
        >
          <X className="size-3.5" />
          Fermer
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-bordure
                      bg-surface p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={correction}
            placeholder="CRM1"
            className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond
                       px-2 font-mono text-[13px] disabled:opacity-50"
          />
          {correction && (
            <span className="text-[11px] text-attenue-texte">
              Le code ne change pas : il est cité par les fiches déjà validées.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-attenue-texte">Nom</span>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Métier Van de Wiele"
            className="min-h-[34px] rounded-[var(--radius-sm)] border border-bordure bg-fond
                       px-2 text-[13px]"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-bordure bg-surface">
        <table className="w-full min-w-[30rem] text-[12px]">
          <thead>
            <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
              <th className="px-2 py-1.5 text-left">Zone</th>
              <th className="px-2 py-1.5 text-right">Bobines</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {lignes.map((l) => (
              <tr key={l.cle} className="border-t border-bordure">
                <td className="px-2 py-1 text-texte">
                  {LIBELLE_ROLE[l.role]}
                  {l.role === 'ETAGE' && ` ${l.numero_etage}`}
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    min={1}
                    value={l.capacite_bobines || ''}
                    onChange={(e) =>
                      majLigne(l.cle, 'capacite_bobines', Number(e.target.value) || 0)
                    }
                    className="min-h-[30px] w-28 rounded-[3px] border border-bordure bg-fond
                               px-1.5 text-right text-[12px]"
                  />
                </td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => retirer(l.cle)}
                    className="text-attenue-texte hover:text-danger"
                    aria-label={`Retirer ${LIBELLE_ROLE[l.role]}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink/20 bg-attenue font-semibold">
              <td className="px-2 py-1.5">
                {etages.length} étage{etages.length > 1 ? 's' : ''} ·{' '}
                {lignes.length - etages.length} autre zone
                {lignes.length - etages.length > 1 ? 's' : ''}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{nb(total, 0)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={ajouterEtage}
          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[var(--radius-sm)]
                     border border-bordure px-2.5 text-[12px] hover:bg-attenue"
        >
          <Plus className="size-3.5" />
          Étage
        </button>
        {manquantes.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => ajouterZone(r)}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[var(--radius-sm)]
                       border border-bordure px-2.5 text-[12px] hover:bg-attenue"
          >
            <Plus className="size-3.5" />
            {LIBELLE_ROLE[r]}
          </button>
        ))}
      </div>

      {/* UNE MACHINE SANS ETAGE EST VALIDE, et il faut le dire : sinon on croit
          a une saisie incomplete. */}
      {etages.length === 0 && lignes.length > 0 && (
        <Alerte ton="info" titre="Machine sans étage">
          Cette machine ne portera que {lignes.map((l) => LIBELLE_ROLE[l.role]).join(' et ')}.
          C&rsquo;est valide — un métier qui ne file que chaîne et trame se déclare ainsi.
        </Alerte>
      )}

      {envoi.isError && (
        <Alerte ton="danger" titre="Refusé">
          {(envoi.error as Error).message}
        </Alerte>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!pret || envoi.isPending}
          onClick={() => envoi.mutate()}
          className={cn(
            'inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)]',
            'bg-primaire px-4 text-[14px] font-semibold text-primaire-texte disabled:opacity-40',
          )}
        >
          {envoi.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {correction ? 'Enregistrer' : 'Déclarer la machine'}
        </button>
        <span className="text-[12px] tabular-nums text-attenue-texte">
          {nb(total, 0)} bobines au total
        </span>
      </div>
    </div>
  )
}

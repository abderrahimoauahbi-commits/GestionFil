/**
 * Machines : le fil pose sur les metiers, tenu au poids reel.
 *
 * TROIS ECRANS, PAS TROIS PAGES. Le magasinier passe de la machine a l'etage
 * puis au geste en quelques secondes, souvent d'une main. Trois routes
 * separees lui coûteraient trois chargements et un retour arriere a chaque
 * erreur de doigt ; un etat local lui coûte un rendu.
 *
 * CE QUI GOUVERNE LA MISE EN PAGE. L'operateur est debout devant sa machine,
 * parfois gante, dans un atelier mal eclaire. D'ou trois regles qui ne se
 * negocient pas :
 *
 *   1. Aucun defilement horizontal. Ce qui ne tient pas en largeur se replie.
 *   2. LE POIDS REEL S'AFFICHE AU-DESSUS DU CHAMP DE SAISIE. Clavier ouvert,
 *      tout ce qui est sous le champ actif est cache — et le poids reel est
 *      precisement ce qu'on relit au moment de taper.
 *   3. Cibles d'au moins 44 px, 56 px pour le bouton qui valide.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, ChevronLeft, ChevronRight, Layers, Loader2, Pencil, Percent, Plus, Scale,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Chargement } from '../composants/ui/base'
import { cn } from '../lib/utils'


// =============================================================================
// LES FORMES RENVOYEES PAR L'API
// =============================================================================

interface Machine {
  code_machine: string
  nom: string
  capacite_bobines: number
  nb_etages: number
  bobines_presentes: number
  quantite_kg: number
  actif: number
}

interface Emplacement {
  code_emplacement: string
  role: 'ETAGE' | 'CHAINE' | 'TRAME'
  numero_etage: number
  libelle: string
  capacite_bobines: number
  bobines_presentes: number
  quantite_kg: number
  nb_lots: number
}

interface LigneContenu {
  code_reference: string
  designation: string
  lot_fournisseur: string
  nb_bobines: number
  quantite_kg: number
  poids_moyen_bobine_kg: number | null
  poids_catalogue_kg: number | null
  ecart_pct: number | null
  date_maj: string
  /** La derniere declaration faite sur ce lot : le point de reference du
   *  comptage. Nulle tant que rien n'a ete declare avec un mode de pesee. */
  d_date: string | null
  d_motif: string | null
  d_mode: string | null
  d_bobines: number | null
  d_poids_unitaire: number | null
  d_pourcentage: number | null
  d_total_kg: number | null
}

const nb = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

// =============================================================================
// L'ECRAN
// =============================================================================

export function Machines() {
  const { peut } = useAuth()
  const [machine, setMachine] = useState<Machine | null>(null)
  const [emplacement, setEmplacement] = useState<Emplacement | null>(null)

  if (machine && emplacement) {
    return (
      <VueEmplacement
        machine={machine}
        emplacement={emplacement}
        retour={() => setEmplacement(null)}
      />
    )
  }
  if (machine) {
    return (
      <VuePlan
        machine={machine}
        retour={() => setMachine(null)}
        ouvrir={setEmplacement}
      />
    )
  }
  return <VueListe ouvrir={setMachine} peutCreer={peut('PARAMETRES', 'ECRIRE')} />
}

// =============================================================================
// 1. LA LISTE DES MACHINES
// =============================================================================

function VueListe({
  ouvrir,
  peutCreer,
}: {
  ouvrir: (m: Machine) => void
  peutCreer: boolean
}) {
  const [formulaire, setFormulaire] = useState(false)
  const q = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.get<Machine[]>('/api/machines'),
  })

  if (q.isLoading) return <Chargement texte="Lecture des machines…" />
  const machines = q.data ?? []

  return (
    <div>
      <EnTetePage
        titre="Machines"
        actions={
          peutCreer ? (
            <button
              type="button"
              onClick={() => setFormulaire((f) => !f)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-sm)]
                         bg-primaire px-3 text-[13px] font-medium text-primaire-texte
                         transition-[filter] hover:brightness-110"
            >
              <Plus className="size-4" />
              Nouvelle machine
            </button>
          ) : undefined
        }
      />

      {formulaire && <FormulaireMachine fermer={() => setFormulaire(false)} />}

      {machines.length === 0 ? (
        <Alerte ton="info" titre="Aucune machine declaree">
          Une machine porte un nom, une capacite totale en bobines, un nombre d etages, et
          eventuellement des bobines de chaine et de trame. Chaque emplacement devient un
          magasin : le fil qui s y trouve est du stock comme un autre.
        </Alerte>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {machines.map((m) => (
            <button
              key={m.code_machine}
              type="button"
              onClick={() => ouvrir(m)}
              className="flex min-h-[44px] flex-col gap-2 rounded-[var(--radius)] border
                         border-bordure bg-surface p-3 text-left active:bg-attenue"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[14px] font-medium text-texte">{m.nom}</span>
                <span className="shrink-0 font-mono text-[11px] text-attenue-texte">
                  {m.code_machine}
                </span>
              </div>
              <Jauge
                presentes={m.bobines_presentes}
                capacite={m.capacite_bobines}
                kg={m.quantite_kg}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** La barre de remplissage, commune a la machine et a l'emplacement. */
function Jauge({
  presentes,
  capacite,
  kg,
}: {
  presentes: number
  capacite: number
  kg: number
}) {
  const part = capacite > 0 ? Math.min(100, (presentes / capacite) * 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12px] tabular-nums">
        <span className="text-attenue-texte">
          {presentes} / {capacite} bobines
        </span>
        <span className="font-medium text-texte">{nb(kg, 1)} kg</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-attenue">
        <div
          className={cn('h-full rounded-full', part > 95 ? 'bg-danger' : 'bg-primaire')}
          style={{ width: `${part}%` }}
        />
      </div>
    </div>
  )
}

// =============================================================================
// 2. LE PLAN DE LA MACHINE
// =============================================================================

function VuePlan({
  machine,
  retour,
  ouvrir,
}: {
  machine: Machine
  retour: () => void
  ouvrir: (e: Emplacement) => void
}) {
  const q = useQuery({
    queryKey: ['machine', machine.code_machine],
    queryFn: () => api.get<Emplacement[]>(`/api/machines/${machine.code_machine}`),
  })

  if (q.isLoading) return <Chargement texte="Lecture du plan…" />
  const tous = q.data ?? []
  const etages = tous.filter((e) => e.role === 'ETAGE')
  const hors = tous.filter((e) => e.role !== 'ETAGE')

  return (
    <div>
      <Fil retour={retour} titre={machine.nom} sous={machine.code_machine} />
      <div className="mb-3">
        <Jauge
          presentes={machine.bobines_presentes}
          capacite={machine.capacite_bobines}
          kg={machine.quantite_kg}
        />
      </div>

      {/* LES ETAGES, DU PLUS HAUT AU PLUS BAS. Le plan reproduit la machine ;
          une liste triee par numero croissant obligerait l'operateur a faire
          la conversion dans sa tete, devant le metier. Le serveur trie deja
          ainsi — l'ecran n'a rien a reconstruire. */}
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
        Etages
      </p>
      <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
        {etages.map((e) => (
          <CarteEmplacement key={e.code_emplacement} e={e} ouvrir={ouvrir} />
        ))}
      </div>

      {hors.length > 0 && (
        <>
          {/* CHAINE ET TRAME NE SONT PAS DANS LA PILE. Elles portent du fil et
              se chargent exactement comme un etage, mais elles ne sont pas des
              etages — c'est la seule chose que le role change, et elle est
              purement visuelle. */}
          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
            Hors etages
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {hors.map((e) => (
              <div
                key={e.code_emplacement}
                className="overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface"
              >
                <CarteEmplacement e={e} ouvrir={ouvrir} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CarteEmplacement({
  e,
  ouvrir,
}: {
  e: Emplacement
  ouvrir: (e: Emplacement) => void
}) {
  return (
    <button
      type="button"
      onClick={() => ouvrir(e)}
      className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2.5 text-left active:bg-attenue"
    >
      <Layers className="size-4 shrink-0 text-attenue-texte" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-texte">{e.libelle}</div>
        <Jauge presentes={e.bobines_presentes} capacite={e.capacite_bobines} kg={e.quantite_kg} />
      </div>
      <ChevronRight className="size-4 shrink-0 text-attenue-texte" />
    </button>
  )
}

function Fil({ retour, titre, sous }: { retour: () => void; titre: string; sous?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={retour}
        aria-label="Retour"
        className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)]
                   border border-bordure text-attenue-texte active:bg-attenue"
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold text-texte">{titre}</div>
        {sous && <div className="font-mono text-[11px] text-attenue-texte">{sous}</div>}
      </div>
    </div>
  )
}

// =============================================================================
// 3. LE CONTENU D'UN EMPLACEMENT, ET LES GESTES
// =============================================================================

type Onglet = 'contenu' | 'charger' | 'deposer' | 'inventaire'

function VueEmplacement({
  machine,
  emplacement,
  retour,
}: {
  machine: Machine
  emplacement: Emplacement
  retour: () => void
}) {
  const [onglet, setOnglet] = useState<Onglet>('contenu')
  const q = useQuery({
    queryKey: ['emplacement', machine.code_machine, emplacement.code_emplacement],
    queryFn: () =>
      api.get<LigneContenu[]>(
        `/api/machines/${machine.code_machine}/emplacements/${emplacement.code_emplacement}`,
      ),
  })

  const contenu = q.data ?? []

  return (
    <div className="pb-24">
      <Fil retour={retour} titre={emplacement.libelle} sous={machine.nom} />
      <div className="mb-3">
        <Jauge
          presentes={emplacement.bobines_presentes}
          capacite={emplacement.capacite_bobines}
          kg={emplacement.quantite_kg}
        />
      </div>

      {onglet === 'contenu' && (
        <>
          {q.isLoading ? (
            <Chargement texte="Lecture du contenu…" />
          ) : contenu.length === 0 ? (
            <Alerte ton="info" titre="Emplacement vide">
              Chargez des bobines pour commencer.
            </Alerte>
          ) : (
            <TableContenu lignes={contenu} />
          )}
        </>
      )}

      {(onglet === 'charger' || onglet === 'deposer') && (
        <FormulaireGeste
          machine={machine}
          emplacement={emplacement}
          sens={onglet}
          contenu={contenu}
          fini={() => {
            setOnglet('contenu')
            void q.refetch()
          }}
        />
      )}

      {onglet === 'inventaire' && (
        <FormulaireInventaire
          machine={machine}
          emplacement={emplacement}
          contenu={contenu}
          fini={() => {
            setOnglet('contenu')
            void q.refetch()
          }}
        />
      )}

      {/* LA BARRE DE GESTES RESTE COLLEE EN BAS, au-dessus de la zone sure de
          l'ecran. Sur telephone, remonter chercher un bouton apres avoir fait
          defiler une liste de lots est exactement ce qui fait abandonner une
          saisie. */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-bordure bg-surface
                   p-2 shadow-[0_-2px_12px_rgba(0,0,0,.08)]"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {(
          [
            ['contenu', 'Contenu'],
            ['charger', 'Charger'],
            ['deposer', 'Deposer'],
            ['inventaire', 'Compter'],
          ] as [Onglet, string][]
        ).map(([cle, libelle]) => (
          <button
            key={cle}
            type="button"
            onClick={() => setOnglet(cle)}
            className={cn(
              'min-h-[48px] flex-1 rounded-[var(--radius-sm)] text-[13px] font-medium',
              onglet === cle
                ? 'bg-primaire text-primaire-texte'
                : 'border border-bordure text-texte active:bg-attenue',
            )}
          >
            {libelle}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * LA LIGNE QUI SE COMPLETE EN BAS.
 *
 * Deux colonnes restent visibles ; le reste se deplie sous la ligne. Une seule
 * ligne ouverte a la fois : deux replis pousseraient hors de l'ecran ce qu'on
 * etait venu comparer.
 */
function TableContenu({ lignes }: { lignes: LigneContenu[] }) {
  const [ouvert, setOuvert] = useState<string | null>(null)

  return (
    <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
      <div className="flex items-center gap-2 bg-attenue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
        <span className="flex-1">Reference</span>
        <span className="w-12 text-right">Bob.</span>
        <span className="w-16 text-right">kg</span>
        <span className="w-6" />
      </div>

      {lignes.map((l) => {
        const cle = `${l.code_reference}|${l.lot_fournisseur}`
        const deplie = ouvert === cle
        return (
          <div key={cle}>
            <button
              type="button"
              onClick={() => setOuvert(deplie ? null : cle)}
              aria-expanded={deplie}
              aria-controls={`detail-${cle}`}
              className="flex min-h-[48px] w-full items-center gap-2 px-3 py-2 text-left active:bg-attenue"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-texte">
                {l.designation || l.code_reference}
              </span>
              <span className="w-12 text-right text-[13px] tabular-nums text-texte">
                {l.nb_bobines}
              </span>
              <span className="w-16 text-right text-[13px] font-medium tabular-nums text-texte">
                {nb(l.quantite_kg, 1)}
              </span>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-attenue-texte transition-transform',
                  deplie && 'rotate-180',
                )}
              />
            </button>

            {deplie && (
              <dl
                id={`detail-${cle}`}
                className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 bg-attenue px-3 pb-3 pt-1 text-[12px]"
              >
                <Detail t="Lot" v={l.lot_fournisseur} />
                <Detail t="Moyenne reelle" v={`${nb(l.poids_moyen_bobine_kg, 3)} kg`} />
                <Detail t="Catalogue" v={`${nb(l.poids_catalogue_kg, 3)} kg`} />
                <Detail
                  t="Ecart"
                  v={l.ecart_pct == null ? '—' : `${nb(l.ecart_pct, 1)} %`}
                  alerte={l.ecart_pct != null && Math.abs(l.ecart_pct) > 10}
                />
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Detail({ t, v, alerte }: { t: string; v: string; alerte?: boolean }) {
  return (
    <>
      <dt className="text-attenue-texte">{t}</dt>
      <dd className={cn('text-right tabular-nums', alerte ? 'font-medium text-danger' : 'text-texte')}>
        {v}
      </dd>
    </>
  )
}

// =============================================================================
// LE FORMULAIRE DE CREATION D'UNE MACHINE
// =============================================================================

interface RefCatalogue {
  code_reference: string
  designation: string
  poids_bobine_kg: number | null
}

function FormulaireMachine({ fermer }: { fermer: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    code_machine: '',
    nom: '',
    capacite_bobines: 600,
    nb_etages: 4,
    capacite_par_etage: 120,
    nb_bobines_chaine: 0,
    nb_bobines_trame: 0,
    nb_bobines_reserve: 0,
  })

  const somme =
    f.nb_etages * f.capacite_par_etage +
    f.nb_bobines_chaine +
    f.nb_bobines_trame +
    f.nb_bobines_reserve

  const m = useMutation({
    mutationFn: () => api.post('/api/machines', f),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['machines'] })
      fermer()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        m.mutate()
      }}
      className="mb-4 flex flex-col gap-3 rounded-[var(--radius)] border border-bordure bg-surface p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Code" v={f.code_machine} set={(v) => setF({ ...f, code_machine: v })} placeholder="MC-04" />
        <Champ label="Nom" v={f.nom} set={(v) => setF({ ...f, nom: v })} placeholder="Metier Van de Wiele" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ChampNombre label="Capacite totale" v={f.capacite_bobines} set={(v) => setF({ ...f, capacite_bobines: v })} />
        <ChampNombre label="Nombre d etages" v={f.nb_etages} set={(v) => setF({ ...f, nb_etages: v })} />
        <ChampNombre label="Bobines par etage" v={f.capacite_par_etage} set={(v) => setF({ ...f, capacite_par_etage: v })} />
        <div />
        {/* CHAINE, TRAME ET RESERVE SE SAISISSENT ICI, a cote des etages,
            parce que c'est ainsi qu'on decrit une machine. Elles n'en sont pas
            pour autant : le systeme leur donne leur propre zone, hors de la
            pile, et zero signifie que la machine n'en a pas. */}
        <ChampNombre label="Bobines chaine" v={f.nb_bobines_chaine} set={(v) => setF({ ...f, nb_bobines_chaine: v })} />
        <ChampNombre label="Bobines trame" v={f.nb_bobines_trame} set={(v) => setF({ ...f, nb_bobines_trame: v })} />
        <ChampNombre label="Bobines reserve" v={f.nb_bobines_reserve} set={(v) => setF({ ...f, nb_bobines_reserve: v })} />
      </div>

      <p className="text-[12px] tabular-nums text-attenue-texte">
        Les emplacements totalisent <b className="text-texte">{somme}</b> bobines sur{' '}
        <b className="text-texte">{f.capacite_bobines}</b> declarees.
        {somme > f.capacite_bobines && (
          <span className="text-danger"> — la capacite totale est trop basse.</span>
        )}
      </p>

      {m.isError && (
        <Alerte ton="danger" titre="Creation refusee">
          {(m.error as Error).message}
        </Alerte>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={m.isPending || somme > f.capacite_bobines}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-sm)]
                     bg-primaire px-4 text-[14px] font-medium text-primaire-texte
                     disabled:opacity-50"
        >
          {m.isPending && <Loader2 className="size-4 animate-spin" />}
          Creer la machine
        </button>
        <button
          type="button"
          onClick={fermer}
          className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure px-4 text-[14px]"
        >
          Annuler
        </button>
      </div>
    </form>
  )
}

/**
 * LA DATE DE L'OPERATION, ET NON CELLE DE LA SAISIE.
 *
 * Un chargement fait le 21 juillet peut se saisir le 23 : l'atelier ne
 * s'arrete pas pour taper. Sans ce champ, la consommation mesuree au comptage
 * serait imputee au mauvais mois, et le cout matiere de l'ordre de fabrication
 * avec elle. Le defaut est aujourd'hui, parce que c'est le cas courant.
 */
function ChampDate({ v, set }: { v: string; set: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">Date de l operation</span>
      <input
        type="date"
        value={v}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => set(e.target.value)}
        className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure bg-fond
                   px-2.5 text-[14px] tabular-nums"
      />
    </label>
  )
}

function Champ({
  label, v, set, placeholder,
}: { label: string; v: string; set: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">{label}</span>
      <input
        value={v}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2.5 text-[14px]"
      />
    </label>
  )
}

function ChampNombre({
  label, v, set,
}: { label: string; v: number; set: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-attenue-texte">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={v}
        min={0}
        onChange={(e) => set(Number(e.target.value) || 0)}
        className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2.5
                   text-[14px] tabular-nums"
      />
    </label>
  )
}

// =============================================================================
// LE GESTE : CHARGER OU DEPOSER
// =============================================================================

type Mode = 'PESEE' | 'ESTIMATION'

interface LigneSaisie {
  code_reference: string
  designation: string
  lot_fournisseur: string
  nb_bobines: number
  poids_unitaire_theorique_kg: number
  mode: Mode
  valeur: number
  kg: number
}

function FormulaireGeste({
  machine, emplacement, sens, contenu, fini,
}: {
  machine: Machine
  emplacement: Emplacement
  sens: 'charger' | 'deposer'
  contenu: LigneContenu[]
  fini: () => void
}) {
  const charge = sens === 'charger'

  const qCat = useQuery({
    queryKey: ['catalogue-machine'],
    queryFn: () => api.get<RefCatalogue[]>('/api/catalogue?actif=1&limite=2000'),
    enabled: charge,
  })
  const qMag = useQuery({
    queryKey: ['magasins-machine'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })

  const [reference, setReference] = useState('')
  const [lot, setLot] = useState('')
  const [bobines, setBobines] = useState(0)
  const [unitaire, setUnitaire] = useState(0)
  const [mode, setMode] = useState<Mode>('PESEE')
  const [valeur, setValeur] = useState(0)
  const [lignes, setLignes] = useState<LigneSaisie[]>([])
  const [magasin, setMagasin] = useState('')
  const [ordre, setOrdre] = useState('')
  const [responsable, setResponsable] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  /* ON PEUT REVENIR SUR UNE LIGNE TANT QUE LE GESTE N'EST PAS VALIDE.
   *
   * Devoir supprimer une ligne pour corriger un chiffre est une punition pour
   * une faute de frappe : on retape tout, y compris ce qui etait juste. Un clic
   * sur la ligne la ramene dans le formulaire ; valider la remet a sa place. */
  const [edition, setEdition] = useState<number | null>(null)

  /* DEPOSER RECOUVRE DEUX GESTES QUI N'ONT PAS LE MEME SENS.
   *
   * « Bobine finie » : ce qu'on declare est ce qui RESTE sur les bobines ; la
   * difference avec ce que la zone portait est partie en production.
   * « Sortie » : on demonte, tout redescend au magasin, RIEN n'a ete consomme.
   *
   * Les confondre ferait apparaitre une consommation qui n'a pas eu lieu, ou
   * l'inverse. Le choix est donc explicite, et l'ecran montre les deux
   * arithmetiques cote a cote. */
  const [demonte, setDemonte] = useState(false)

  // Sur une depose, la reference et le lot viennent de ce qui est REELLEMENT
  // sur l'emplacement : les saisir librement inviterait a deposer un lot qui
  // n'y est pas, et le serveur devrait le refuser apres coup.
  const surPlace = useMemo(
    () => contenu.find((c) => `${c.code_reference}|${c.lot_fournisseur}` === reference),
    [contenu, reference],
  )

  const theorique = bobines * unitaire
  const kg = mode === 'PESEE' ? valeur : (bobines * unitaire * valeur) / 100
  const ecart = theorique > 0 ? ((kg - theorique) / theorique) * 100 : 0
  const avertit = mode === 'ESTIMATION' && Math.abs(ecart) > 10

  // Ce que la depose retirerait vraiment de l'emplacement, au poids moyen.
  const quitte = surPlace && surPlace.nb_bobines > 0
    ? (surPlace.quantite_kg / surPlace.nb_bobines) * bobines
    : 0

  /** LE MODE NE TRANSPORTE JAMAIS SA VALEUR.
   *
   *  Reporter 528 d'un champ a l'autre en ferait 528 %, et un chiffre garde
   *  changerait de sens sans prevenir. On repart de zero — en estimation, de
   *  100 %, qui est le cas courant d'un chargement de bobines neuves. */
  function basculer(m: Mode) {
    setMode(m)
    setValeur(m === 'ESTIMATION' ? 100 : 0)
  }

  function choisirReference(code: string) {
    setReference(code)
    if (charge) {
      const r = qCat.data?.find((x) => x.code_reference === code)
      setUnitaire(r?.poids_bobine_kg ?? 0)
    } else {
      const c = contenu.find((x) => `${x.code_reference}|${x.lot_fournisseur}` === code)
      setUnitaire(c?.poids_catalogue_kg ?? 0)
      setLot(c?.lot_fournisseur ?? '')
      setBobines(c?.nb_bobines ?? 0)
    }
  }

  function reprendre(i: number) {
    const l = lignes[i]
    setEdition(i)
    setReference(charge ? l.code_reference : `${l.code_reference}|${l.lot_fournisseur}`)
    setLot(l.lot_fournisseur)
    setBobines(l.nb_bobines)
    setUnitaire(l.poids_unitaire_theorique_kg)
    setMode(l.mode)
    setValeur(l.valeur)
  }

  function ajouter() {
    const code = charge ? reference : (surPlace?.code_reference ?? '')
    if (!code || !lot || bobines <= 0) return
    const ligne = {
      code_reference: code,
      designation: charge
        ? (qCat.data?.find((x) => x.code_reference === code)?.designation ?? code)
        : (surPlace?.designation ?? code),
      lot_fournisseur: lot,
      nb_bobines: bobines,
      poids_unitaire_theorique_kg: unitaire,
      mode,
      valeur,
      kg,
    }
    setLignes((l) =>
      edition === null ? [...l, ligne] : l.map((x, i) => (i === edition ? ligne : x)),
    )
    setEdition(null)
    setReference('')
    setLot('')
    setBobines(0)
    setUnitaire(0)
    setValeur(mode === 'ESTIMATION' ? 100 : 0)
  }

  const envoi = useMutation({
    mutationFn: () =>
      api.post<{ avertissements?: string[] }>('/api/machines/geste', {
        code_machine: machine.code_machine,
        code_emplacement: emplacement.code_emplacement,
        motif: charge ? 'REMPLISSAGE' : demonte ? 'SORTIE' : 'BOBINE_TERMINEE',
        date_mouvement: date,
        code_magasin_contrepartie: magasin,
        numero_of: ordre || null,
        responsable,
        ajouts: charge ? corps(lignes) : [],
        retraits: charge ? [] : corps(lignes),
      }),
    onSuccess: () => {
      setLignes([])
      fini()
    },
  })

  const total = lignes.reduce((s, l) => s + l.kg, 0)

  return (
    <div className="flex flex-col gap-3">
      {/* --- La ligne en cours ------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-bordure bg-surface p-3">
        {!charge && (
          <div className="grid grid-cols-2 gap-2">
            {[
              [false, 'Bobine finie'],
              [true, 'Sortie (demontage)'],
            ].map(([v, libelle]) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setDemonte(v as boolean)}
                className={cn(
                  'min-h-[44px] rounded-[var(--radius-sm)] text-[13px] font-medium',
                  demonte === v
                    ? 'bg-primaire text-primaire-texte'
                    : 'border border-bordure text-texte active:bg-attenue',
                )}
              >
                {libelle as string}
              </button>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-attenue-texte">Reference</span>
          <select
            value={reference}
            onChange={(e) => choisirReference(e.target.value)}
            className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
          >
            <option value="">—</option>
            {charge
              ? (qCat.data ?? []).map((r) => (
                  <option key={r.code_reference} value={r.code_reference}>
                    {r.designation}
                  </option>
                ))
              : contenu.map((c) => (
                  <option
                    key={`${c.code_reference}|${c.lot_fournisseur}`}
                    value={`${c.code_reference}|${c.lot_fournisseur}`}
                  >
                    {c.designation} · {c.lot_fournisseur} ({c.nb_bobines} bob.)
                  </option>
                ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Champ label="Lot" v={lot} set={setLot} placeholder="LOT-2026-0842" />
          <ChampNombre label={charge ? 'Bobines' : `Bobines (max ${surPlace?.nb_bobines ?? 0})`} v={bobines} set={setBobines} />
        </div>

        <p className="text-[12px] tabular-nums text-attenue-texte">
          Catalogue {nb(unitaire, 3)} kg → theorique <b className="text-texte">{nb(theorique, 2)} kg</b>
        </p>

        {/* CE QUI AVAIT ETE DECLARE, ET QUAND.
            Sur une depose, l'operateur doit savoir d'ou il part : un etage
            declare a 60 % il y a un mois n'appelle pas le meme jugement qu'un
            etage compte hier. Sans ce reperage, il saisit a l'aveugle et
            l'ecart qui en sort n'est interpretable par personne. */}
        {!charge && surPlace?.d_date && (
          <div className="rounded-[var(--radius-sm)] bg-attenue px-2.5 py-2 text-[12px] tabular-nums">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-attenue-texte">
              Derniere declaration
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-texte">
              <span>{fmtDate(surPlace.d_date)}</span>
              <span>{surPlace.d_bobines ?? '—'} bobines</span>
              {surPlace.d_pourcentage != null && <span>{nb(surPlace.d_pourcentage, 1)} %</span>}
              <span className="font-medium">{nb(surPlace.d_total_kg, 2)} kg</span>
            </div>
            <div className="mt-1 text-attenue-texte">
              Aujourd hui sur la zone : {surPlace.nb_bobines} bobines ·{' '}
              {nb(surPlace.quantite_kg, 2)} kg
            </div>
          </div>
        )}

        {/* --- LE RESULTAT, AU-DESSUS DU CHAMP DE SAISIE ------------------
            Clavier ouvert, tout ce qui est en dessous du champ actif est
            cache. Le poids reel est precisement ce qu'on relit au moment de
            taper : il doit rester au-dessus. */}
        <div className="rounded-[var(--radius-sm)] border-y-2 border-primaire bg-attenue px-3 py-2">
          {charge ? (
            <Resultat t="Poids reel" v={`${nb(kg, 2)} kg`} fort />
          ) : (
            <>
              <Resultat t="Quitte la zone" v={`${nb(demonte ? kg : quitte, 2)} kg`} />
              <Resultat t="Revient au magasin" v={`${nb(kg, 2)} kg`} />
              <Resultat
                t="Consomme"
                v={demonte ? '0,00 kg' : `${nb(Math.max(0, quitte - kg), 2)} kg`}
                fort
              />
            </>
          )}
          <Resultat
            t="Moyenne / bobine"
            v={bobines > 0 ? `${nb(kg / bobines, 3)} kg` : '—'}
          />
          <Resultat t="Ecart catalogue" v={`${nb(ecart, 2)} %`} alerte={avertit} />
        </div>

        {/* --- La bascule des deux modes ---------------------------------- */}
        {/* SANS POIDS CATALOGUE, IL N'Y A RIEN A MULTIPLIER. L'estimation est
            donc impossible — et c'est justement le cas d'un reste de stock,
            celui ou la pesee est indispensable. On le dit plutot que de
            laisser le serveur refuser apres coup. */}
        {unitaire <= 0 && reference && (
          <p className="rounded-[var(--radius-sm)] bg-attenue px-2.5 py-2 text-[12px] text-attenue-texte">
            Cette reference n a pas de poids par bobine au catalogue : le lot doit etre pese.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['PESEE', 'Pesee', Scale],
              ['ESTIMATION', 'Estimation', Percent],
            ] as [Mode, string, typeof Scale][]
          ).map(([m, libelle, Icone]) => (
            <button
              key={m}
              type="button"
              disabled={m === 'ESTIMATION' && unitaire <= 0}
              onClick={() => basculer(m)}
              className={cn(
                'inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-[14px] font-medium',
                mode === m
                  ? 'bg-primaire text-primaire-texte'
                  : 'border border-bordure text-texte active:bg-attenue',
                m === 'ESTIMATION' && unitaire <= 0 && 'opacity-40',
              )}
            >
              <Icone className="size-4" />
              {libelle}
            </button>
          ))}
        </div>

        {mode === 'PESEE' ? (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-attenue-texte">
              {charge ? 'Poids total pese (kg)' : 'Poids reel restant (kg)'}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={valeur || ''}
              onChange={(e) => setValeur(Number(e.target.value) || 0)}
              className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond
                         px-2.5 text-[18px] tabular-nums"
            />
          </label>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-attenue-texte">% restant moyen</span>
            {/* UN CHAMP, PAS DES PASTILLES. Les cinq valeurs rondes couvraient
                le cas facile et genaient tous les autres : un etage a 37 % se
                saisit tel quel, pas en cliquant 25 puis en corrigeant. Le
                curseur reste, parce qu'il va vite quand la valeur est vague. */}
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={100}
              value={valeur || ''}
              onChange={(e) => setValeur(Math.min(100, Number(e.target.value) || 0))}
              className="min-h-[48px] rounded-[var(--radius-sm)] border border-bordure bg-fond
                         px-2.5 text-[18px] tabular-nums"
            />
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={valeur}
              onChange={(e) => setValeur(Number(e.target.value))}
              className="w-full"
            />
            {avertit && (
              <p className="text-[12px] text-danger">
                {nb(ecart, 1)} % d ecart au catalogue. Pesez si la bascule est accessible.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={ajouter}
          disabled={!reference || !lot || bobines <= 0}
          className="inline-flex min-h-[48px] items-center justify-center gap-1.5
                     rounded-[var(--radius-sm)] border border-bordure text-[14px]
                     font-medium disabled:opacity-40"
        >
          <Plus className="size-4" />
          {edition === null ? 'Ajouter au geste' : 'Enregistrer la ligne'}
        </button>
      </div>

      {/* --- Les lignes deja saisies ------------------------------------- */}
      {lignes.length > 0 && (
        <div className="divide-y divide-bordure overflow-hidden rounded-[var(--radius)] border border-bordure bg-surface">
          {lignes.map((l, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2 text-[13px]',
                edition === i && 'bg-attenue',
              )}
            >
              <button
                type="button"
                onClick={() => reprendre(i)}
                className="flex min-h-[44px] flex-1 items-center gap-2 px-3 text-left active:bg-attenue"
              >
                <Pencil className="size-3.5 shrink-0 text-attenue-texte" />
                <span className="min-w-0 flex-1 truncate">{l.designation}</span>
                <span className="tabular-nums text-attenue-texte">{l.nb_bobines} bob.</span>
                <span className="w-16 text-right font-medium tabular-nums">{nb(l.kg, 1)}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLignes((x) => x.filter((_, j) => j !== i))
                  if (edition === i) setEdition(null)
                }}
                className="flex size-11 items-center justify-center text-attenue-texte"
                aria-label="Retirer la ligne"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* --- L'entete du document ---------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-attenue-texte">
            {charge ? 'Magasin d origine' : 'Magasin de retour'}
          </span>
          <select
            value={magasin}
            onChange={(e) => setMagasin(e.target.value)}
            className="min-h-[44px] rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[14px]"
          >
            <option value="">—</option>
            {(qMag.data ?? []).map((m) => (
              <option key={m.code_magasin} value={m.code_magasin}>
                {m.nom}
              </option>
            ))}
          </select>
        </label>
        {!charge && !demonte && (
          <Champ label="Ordre de fabrication" v={ordre} set={setOrdre} placeholder="OF-2026-118" />
        )}
        <Champ label="Responsable" v={responsable} set={setResponsable} placeholder="Nom" />
        <ChampDate v={date} set={setDate} />
      </div>

      {envoi.isError && (
        <Alerte ton="danger" titre="Geste refuse">
          {(envoi.error as Error).message}
        </Alerte>
      )}

      <button
        type="button"
        onClick={() => envoi.mutate()}
        disabled={envoi.isPending || lignes.length === 0 || !magasin || !responsable}
        className="inline-flex min-h-[56px] items-center justify-center gap-2
                   rounded-[var(--radius-sm)] bg-primaire text-[15px] font-semibold
                   text-primaire-texte disabled:opacity-40"
      >
        {envoi.isPending && <Loader2 className="size-4 animate-spin" />}
        Valider · {lignes.length} ligne{lignes.length > 1 ? 's' : ''} · {nb(total, 1)} kg
      </button>
    </div>
  )
}

/** Le corps attendu par l'API : le mode y devient une union etiquetee. */
function corps(lignes: LigneSaisie[]) {
  return lignes.map((l) => ({
    code_reference: l.code_reference,
    lot_fournisseur: l.lot_fournisseur,
    nb_bobines: l.nb_bobines,
    poids_unitaire_theorique_kg: l.poids_unitaire_theorique_kg || null,
    saisie:
      l.mode === 'PESEE'
        ? { mode: 'PESEE', poids_total_kg: l.kg }
        : { mode: 'ESTIMATION', pourcentage_restant: l.valeur },
  }))
}

function Resultat({
  t, v, fort, alerte,
}: { t: string; v: string; fort?: boolean; alerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-attenue-texte">{t}</span>
      <span
        className={cn(
          'tabular-nums',
          fort ? 'text-[18px] font-semibold text-texte' : 'text-[13px] text-texte',
          alerte && 'text-danger',
        )}
      >
        {v}
      </span>
    </div>
  )
}

// =============================================================================
// COMPTER : LA CORRECTION D'INVENTAIRE
// =============================================================================

/**
 * L'operateur declare CE QU'IL VOIT, en face de ce qui avait ete declare avant.
 *
 * POURQUOI LA LIGNE PRECEDENTE EST AFFICHEE. Sans elle, on saisit 20 % sans
 * savoir qu'on etait a 60 %, ni depuis quand. On ne peut alors ni verifier son
 * propre chiffre, ni juger si l'ecart est vraisemblable — et un comptage qu'on
 * ne peut pas juger ne vaut rien. La date de la declaration precedente compte
 * autant que son chiffre : un ecart de 1500 kg en un mois n'a pas le meme sens
 * qu'en trois jours.
 *
 * LE NOMBRE DE BOBINES EST MODIFIABLE, lui aussi : on peut en trouver moins
 * qu'annonce, ou plus.
 *
 * UN LOT DECOCHE EST UN LOT PARTI. Ne pas mentionner un lot present serait la
 * facon la plus courante de laisser un manquant en place.
 */
function FormulaireInventaire({
  machine, emplacement, contenu, fini,
}: {
  machine: Machine
  emplacement: Emplacement
  contenu: LigneContenu[]
  fini: () => void
}) {
  const [etat, setEtat] = useState(() =>
    contenu.map((c) => {
      const unitaire = c.d_poids_unitaire ?? c.poids_catalogue_kg ?? 0
      return {
        cle: `${c.code_reference}|${c.lot_fournisseur}`,
        code_reference: c.code_reference,
        designation: c.designation,
        lot_fournisseur: c.lot_fournisseur,
        present: true,
        unitaire,
        // La saisie du jour part de l'etat connu : le plus souvent, seul le
        // pourcentage change.
        bobines: c.nb_bobines,
        mode: (unitaire > 0 ? 'ESTIMATION' : 'PESEE') as Mode,
        pourcentage: c.d_pourcentage ?? 100,
        kg: c.quantite_kg,
        // La ligne d'avant, telle qu'elle a ete declaree.
        av_date: c.d_date ?? null,
        av_bobines: c.d_bobines ?? c.nb_bobines,
        av_unitaire: c.d_poids_unitaire ?? c.poids_catalogue_kg ?? 0,
        av_pourcentage: c.d_pourcentage ?? null,
        av_total: c.d_total_kg ?? c.quantite_kg,
        base_kg: c.quantite_kg,
        base_bobines: c.nb_bobines,
      }
    }),
  )
  const [responsable, setResponsable] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [ordre, setOrdre] = useState('')
  const [consommation, setConsommation] = useState(true)

  function maj(cle: string, champ: string, v: number | boolean | string) {
    setEtat((e) => e.map((l) => (l.cle === cle ? { ...l, [champ]: v } : l)))
  }

  /** Le total du jour, selon le mode choisi pour cette ligne. */
  const total = (l: (typeof etat)[number]) =>
    l.mode === 'PESEE' ? l.kg : l.bobines * l.unitaire * (l.pourcentage / 100)

  const ecartKg = etat.reduce(
    (s, l) => s + ((l.present ? total(l) : 0) - l.base_kg),
    0,
  )

  const envoi = useMutation({
    mutationFn: () =>
      api.post('/api/machines/inventaire', {
        code_machine: machine.code_machine,
        code_emplacement: emplacement.code_emplacement,
        responsable,
        date_mouvement: date,
        numero_of: ordre || null,
        ecart_est_consommation: consommation,
        etat: etat
          .filter((l) => l.present)
          .map((l) => ({
            code_reference: l.code_reference,
            lot_fournisseur: l.lot_fournisseur,
            nb_bobines: l.bobines,
            poids_unitaire_theorique_kg: l.unitaire || null,
            saisie:
              l.mode === 'PESEE'
                ? { mode: 'PESEE', poids_total_kg: l.kg }
                : { mode: 'ESTIMATION', pourcentage_restant: l.pourcentage },
          })),
      }),
    onSuccess: fini,
  })

  if (contenu.length === 0) {
    return (
      <Alerte ton="info" titre="Zone vide">
        Il n y a rien a compter. Chargez des bobines d abord.
      </Alerte>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {etat.map((l) => {
        const jour = total(l)
        const dJour = (l.present ? jour : 0) - l.base_kg
        return (
          <div
            key={l.cle}
            className={cn(
              'overflow-hidden rounded-[var(--radius)] border bg-surface',
              l.present ? 'border-bordure' : 'border-danger/40 opacity-70',
            )}
          >
            <div className="flex items-start justify-between gap-2 border-b border-bordure px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-texte">{l.designation}</div>
                <div className="font-mono text-[11px] text-attenue-texte">{l.lot_fournisseur}</div>
              </div>
              <button
                type="button"
                onClick={() => maj(l.cle, 'present', !l.present)}
                className={cn(
                  'min-h-[40px] shrink-0 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium',
                  l.present
                    ? 'border border-bordure text-attenue-texte'
                    : 'bg-danger text-primaire-texte',
                )}
              >
                {l.present ? 'Present' : 'Absent'}
              </button>
            </div>

            {/* LA COMPARAISON, LIGNE A LIGNE. Deux lignes et un ecart : c'est
                tout ce qu'il faut pour juger un comptage, et c'est illisible
                autrement. Le tableau defile lateralement dans son propre
                cadre — jamais la page. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-[12px]">
                <thead>
                  <tr className="bg-attenue text-[11px] uppercase tracking-wide text-attenue-texte">
                    <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Bobines</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Poids/bob.</th>
                    <th className="px-2 py-1.5 text-right font-semibold">%</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Total kg</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr className="border-b border-bordure text-attenue-texte">
                    <td className="px-2 py-1.5">
                      {l.av_date ? fmtDate(l.av_date) : 'aucune declaration'}
                    </td>
                    <td className="px-2 py-1.5 text-right">{l.av_bobines}</td>
                    <td className="px-2 py-1.5 text-right">{nb(l.av_unitaire, 3)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {l.av_pourcentage == null ? '—' : nb(l.av_pourcentage, 1)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{nb(l.av_total, 2)}</td>
                  </tr>

                  {l.present && (
                    <tr>
                      <td className="px-2 py-1.5 font-medium text-texte">{fmtDate(date)}</td>
                      <td className="px-1 py-1">
                        <CaseNombre v={l.bobines} set={(v) => maj(l.cle, 'bobines', v)} />
                      </td>
                      <td className="px-1 py-1">
                        <CaseNombre
                          v={l.unitaire}
                          pas={0.001}
                          set={(v) => maj(l.cle, 'unitaire', v)}
                        />
                      </td>
                      <td className="px-1 py-1">
                        {l.mode === 'ESTIMATION' ? (
                          <CaseNombre
                            v={l.pourcentage}
                            pas={0.1}
                            set={(v) => maj(l.cle, 'pourcentage', v)}
                          />
                        ) : (
                          <span className="block px-2 text-right text-attenue-texte">pesee</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {l.mode === 'PESEE' ? (
                          <CaseNombre v={l.kg} pas={0.01} set={(v) => maj(l.cle, 'kg', v)} />
                        ) : (
                          <span className="block px-2 text-right font-medium text-texte">
                            {nb(jour, 2)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}

                  <tr className="border-t border-bordure">
                    <td className="px-2 py-1.5 text-attenue-texte">Ecart</td>
                    <td className="px-2 py-1.5 text-right text-attenue-texte">
                      {(l.present ? l.bobines : 0) - l.base_bobines >= 0 ? '+' : ''}
                      {(l.present ? l.bobines : 0) - l.base_bobines}
                    </td>
                    <td colSpan={2} />
                    <td
                      className={cn(
                        'px-2 py-1.5 text-right font-medium',
                        Math.abs(dJour) > 0.005 ? 'text-danger' : 'text-attenue-texte',
                      )}
                    >
                      {dJour >= 0 ? '+' : ''}
                      {nb(dJour, 2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Le mode se choisit par lot : la plupart s'estiment, certains se
                pesent — et sans poids catalogue, la pesee est la seule voie. */}
            <div className="flex gap-2 border-t border-bordure px-3 py-2">
              {(
                [
                  ['ESTIMATION', 'Estimation %'],
                  ['PESEE', 'Pesee kg'],
                ] as [Mode, string][]
              ).map(([m, libelle]) => (
                <button
                  key={m}
                  type="button"
                  disabled={m === 'ESTIMATION' && l.unitaire <= 0}
                  onClick={() => maj(l.cle, 'mode', m)}
                  className={cn(
                    'min-h-[40px] flex-1 rounded-[var(--radius-sm)] text-[12px] font-medium',
                    l.mode === m
                      ? 'bg-primaire text-primaire-texte'
                      : 'border border-bordure text-texte active:bg-attenue',
                    m === 'ESTIMATION' && l.unitaire <= 0 && 'opacity-40',
                  )}
                >
                  {libelle}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      <div className="rounded-[var(--radius-sm)] border-y-2 border-primaire bg-attenue px-3 py-2">
        <Resultat
          t="Ecart total de la zone"
          v={`${ecartKg >= 0 ? '+' : ''}${nb(ecartKg, 2)} kg`}
          fort
          alerte={Math.abs(ecartKg) > 0.005}
        />
      </div>

      {ecartKg < -0.005 && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3">
          <span className="text-[12px] text-attenue-texte">
            La baisse de {nb(Math.abs(ecartKg), 2)} kg correspond a
          </span>
          <div className="grid grid-cols-2 gap-2">
            {[
              [true, 'Consommation machine'],
              [false, 'Ecart d inventaire'],
            ].map(([v, libelle]) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setConsommation(v as boolean)}
                className={cn(
                  'min-h-[44px] rounded-[var(--radius-sm)] text-[13px] font-medium',
                  consommation === v
                    ? 'bg-primaire text-primaire-texte'
                    : 'border border-bordure text-texte active:bg-attenue',
                )}
              >
                {libelle as string}
              </button>
            ))}
          </div>
          {consommation && (
            <Champ label="Ordre de fabrication" v={ordre} set={setOrdre} placeholder="OF-2026-118" />
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Responsable du comptage" v={responsable} set={setResponsable} placeholder="Nom" />
        <ChampDate v={date} set={setDate} />
      </div>

      {envoi.isError && (
        <Alerte ton="danger" titre="Comptage refuse">
          {(envoi.error as Error).message}
        </Alerte>
      )}

      <button
        type="button"
        onClick={() => envoi.mutate()}
        disabled={
          envoi.isPending || !responsable || (ecartKg < -0.005 && consommation && !ordre)
        }
        className="inline-flex min-h-[56px] items-center justify-center gap-2
                   rounded-[var(--radius-sm)] bg-primaire text-[15px] font-semibold
                   text-primaire-texte disabled:opacity-40"
      >
        {envoi.isPending && <Loader2 className="size-4 animate-spin" />}
        Valider le comptage
      </button>
    </div>
  )
}

/** Une case de tableau qui se saisit. Clavier decimal, alignee a droite. */
function CaseNombre({
  v, set, pas = 1,
}: { v: number; set: (v: number) => void; pas?: number }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={pas}
      value={v || ''}
      onChange={(e) => set(Number(e.target.value) || 0)}
      className="min-h-[40px] w-full rounded-[var(--radius-sm)] border border-bordure
                 bg-fond px-2 text-right text-[13px] tabular-nums"
    />
  )
}

/** Une date ISO en jour/mois/annee, sans dependance. */
function fmtDate(d: string): string {
  const s = String(d).slice(0, 10)
  const [a, m, j] = s.split('-')
  return j ? `${j}/${m}/${a}` : s
}

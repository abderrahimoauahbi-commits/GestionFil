/**
 * Filtre personnalise : champ, operateur, valeur — cumulables.
 *
 * Les filtres predefinis repondent aux questions qu'on a prevues. Celui-ci
 * repond aux autres : « les sorties de plus d'une tonne sur MP-01 », « les
 * references dont la couverture tombe sous 45 jours ». Personne ne peut prevoir
 * toutes les questions d'un magasinier ou d'un acheteur, et une question non
 * prevue finit sinon dans un export vers un tableur — ou la reponse ne sera plus
 * jamais confrontee aux donnees.
 *
 * Les conditions se combinent par ET, jamais par OU. C'est une restriction
 * assumee : un melange de ET et de OU sans parentheses produit des resultats que
 * personne ne sait relire, et l'on finit par croire un chiffre faux. Pour un OU,
 * on pose deux filtres successifs et l'on compare.
 *
 * Le filtrage se fait EN MEMOIRE, sur les lignes deja chargees. Les pages
 * concernees tiennent en quelques centaines de lignes ; envoyer chaque condition
 * au serveur imposerait une grammaire de requete, sa validation, et la surface
 * d'attaque qui va avec.
 */
import { useState } from 'react'
import { Filter, Plus, X } from 'lucide-react'
import {
  Alerte,
  Bouton,
  Champ,
  Etiq,
  Selecteur,
} from './ui/base'
import { Dialogue, DialogueContenu } from './ui/surcouches'
import { cn } from '../lib/utils'

export type TypeChamp = 'nombre' | 'texte' | 'date' | 'liste'

export interface ChampFiltrable {
  champ: string
  libelle: string
  type: TypeChamp
  /** Pour le type `liste` : les valeurs proposees. */
  options?: { valeur: string; libelle: string }[]
  unite?: string
}

export type Operateur =
  | 'egal'
  | 'different'
  | 'superieur'
  | 'superieur_egal'
  | 'inferieur'
  | 'inferieur_egal'
  | 'contient'
  | 'ne_contient_pas'
  | 'commence_par'
  | 'vide'
  | 'non_vide'

export interface Condition {
  champ: string
  operateur: Operateur
  valeur: string
}

const LIBELLE_OP: Record<Operateur, string> = {
  egal: 'est egal a',
  different: 'est different de',
  superieur: 'est superieur a',
  superieur_egal: 'est superieur ou egal a',
  inferieur: 'est inferieur a',
  inferieur_egal: 'est inferieur ou egal a',
  contient: 'contient',
  ne_contient_pas: 'ne contient pas',
  commence_par: 'commence par',
  vide: 'est vide',
  non_vide: "n'est pas vide",
}

/** Les operateurs qui ont un sens pour chaque type de champ. */
const OPERATEURS: Record<TypeChamp, Operateur[]> = {
  nombre: [
    'egal',
    'different',
    'superieur',
    'superieur_egal',
    'inferieur',
    'inferieur_egal',
    'vide',
    'non_vide',
  ],
  texte: ['contient', 'ne_contient_pas', 'egal', 'different', 'commence_par', 'vide', 'non_vide'],
  date: ['egal', 'superieur', 'inferieur', 'vide', 'non_vide'],
  liste: ['egal', 'different', 'vide', 'non_vide'],
}

/** Les operateurs qui n'attendent aucune valeur. */
const SANS_VALEUR: Operateur[] = ['vide', 'non_vide']

/**
 * Applique les conditions a un jeu de lignes.
 *
 * Une condition portant sur un champ ABSENT de la ligne ne filtre RIEN plutot
 * que de tout eliminer : le champ peut avoir ete masque par la grille de droits,
 * et faire disparaitre toutes les lignes laisserait croire a une base vide.
 */
export function appliquerConditions<T extends Record<string, unknown>>(
  lignes: T[],
  conditions: Condition[],
  champs: ChampFiltrable[],
): T[] {
  if (conditions.length === 0) return lignes
  const typePar = new Map(champs.map((c) => [c.champ, c.type]))

  return lignes.filter((l) =>
    conditions.every((c) => {
      if (!(c.champ in l)) return true
      const brut = l[c.champ]

      if (c.operateur === 'vide') return brut == null || brut === ''
      if (c.operateur === 'non_vide') return brut != null && brut !== ''
      if (c.valeur === '') return true

      if (typePar.get(c.champ) === 'nombre') {
        const v = Number(brut)
        const cible = Number(c.valeur)
        if (Number.isNaN(v) || Number.isNaN(cible)) return true
        switch (c.operateur) {
          case 'egal':
            return v === cible
          case 'different':
            return v !== cible
          case 'superieur':
            return v > cible
          case 'superieur_egal':
            return v >= cible
          case 'inferieur':
            return v < cible
          case 'inferieur_egal':
            return v <= cible
          default:
            return true
        }
      }

      const v = String(brut ?? '').toLowerCase()
      const cible = c.valeur.toLowerCase()
      switch (c.operateur) {
        case 'egal':
          return v === cible
        case 'different':
          return v !== cible
        case 'contient':
          return v.includes(cible)
        case 'ne_contient_pas':
          return !v.includes(cible)
        case 'commence_par':
          return v.startsWith(cible)
        // Les dates sont des chaines ISO : la comparaison lexicale suffit et
        // evite un fuseau horaire de plus dans le calcul.
        case 'superieur':
          return v > cible
        case 'inferieur':
          return v < cible
        default:
          return true
      }
    }),
  )
}

/**
 * Le bloc du rail : les conditions actives, et de quoi en ajouter.
 */
export function FiltrePersonnalise({
  champs,
  conditions,
  surChangement,
}: {
  champs: ChampFiltrable[]
  conditions: Condition[]
  surChangement: (c: Condition[]) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const libellePar = new Map(champs.map((c) => [c.champ, c.libelle]))

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 px-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-attenue-texte">
          Filtre personnalise
        </span>
        {conditions.length > 0 && (
          <button
            type="button"
            onClick={() => surChangement([])}
            className="text-[10px] text-attenue-texte underline hover:text-danger"
          >
            tout effacer
          </button>
        )}
      </div>

      {conditions.length > 0 && (
        <ul className="mb-1 space-y-1 px-1">
          {conditions.map((c, i) => (
            <li
              key={`${c.champ}-${i}`}
              className="flex items-start gap-1 rounded-[var(--radius)] border border-primaire/40 bg-primaire/5 px-1.5 py-1"
            >
              <span className="min-w-0 flex-1 text-[11px] leading-tight">
                <span className="font-medium">{libellePar.get(c.champ) ?? c.champ}</span>{' '}
                <span className="text-attenue-texte">{LIBELLE_OP[c.operateur]}</span>
                {!SANS_VALEUR.includes(c.operateur) && (
                  <>
                    {' '}
                    <span className="font-medium tabular-nums">{c.valeur}</span>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => surChangement(conditions.filter((_, j) => j !== i))}
                className="shrink-0 text-attenue-texte hover:text-danger"
                aria-label="Retirer la condition"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setOuvert(true)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-[var(--radius)] px-2.5 py-1.5 text-[12px] transition-colors',
          'text-attenue-texte hover:bg-attenue/40 hover:text-texte',
        )}
      >
        <Plus className="size-3.5" />
        {conditions.length === 0 ? 'Ajouter un filtre' : 'Ajouter une condition'}
      </button>

      {conditions.length > 1 && (
        <p className="px-2.5 pt-1 text-[10px] leading-tight text-attenue-texte">
          Les conditions se cumulent : une ligne doit toutes les verifier.
        </p>
      )}

      {ouvert && (
        <DialogueCondition
          champs={champs}
          surFermeture={() => setOuvert(false)}
          surAjout={(c) => {
            surChangement([...conditions, c])
            setOuvert(false)
          }}
        />
      )}
    </div>
  )
}

function DialogueCondition({
  champs,
  surFermeture,
  surAjout,
}: {
  champs: ChampFiltrable[]
  surFermeture: () => void
  surAjout: (c: Condition) => void
}) {
  const [champ, setChamp] = useState(champs[0]?.champ ?? '')
  const def = champs.find((c) => c.champ === champ)
  const operateurs = OPERATEURS[def?.type ?? 'texte']
  const [operateur, setOperateur] = useState<Operateur>(operateurs[0])
  const [valeur, setValeur] = useState('')

  const sansValeur = SANS_VALEUR.includes(operateur)
  const pret = !!champ && (sansValeur || valeur.trim() !== '')

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        titre="Ajouter une condition"
        description="Elle s'ajoutera aux conditions deja posees : une ligne devra toutes les verifier."
      >
        <div className="space-y-3">
          <div>
            <Etiq htmlFor="ch">Champ</Etiq>
            <Selecteur
              id="ch"
              value={champ}
              onChange={(e) => {
                setChamp(e.target.value)
                const t = champs.find((c) => c.champ === e.target.value)?.type ?? 'texte'
                setOperateur(OPERATEURS[t][0])
                setValeur('')
              }}
            >
              {champs.map((c) => (
                <option key={c.champ} value={c.champ}>
                  {c.libelle}
                  {c.unite ? ` (${c.unite})` : ''}
                </option>
              ))}
            </Selecteur>
          </div>

          <div>
            <Etiq htmlFor="op">Operateur</Etiq>
            <Selecteur
              id="op"
              value={operateur}
              onChange={(e) => setOperateur(e.target.value as Operateur)}
            >
              {operateurs.map((o) => (
                <option key={o} value={o}>
                  {LIBELLE_OP[o]}
                </option>
              ))}
            </Selecteur>
          </div>

          {!sansValeur && (
            <div>
              <Etiq htmlFor="val" obligatoire>
                Valeur
              </Etiq>
              {def?.type === 'liste' && def.options ? (
                <Selecteur id="val" value={valeur} onChange={(e) => setValeur(e.target.value)}>
                  <option value="">Choisir…</option>
                  {def.options.map((o) => (
                    <option key={o.valeur} value={o.valeur}>
                      {o.libelle}
                    </option>
                  ))}
                </Selecteur>
              ) : (
                <Champ
                  id="val"
                  type={def?.type === 'nombre' ? 'number' : def?.type === 'date' ? 'date' : 'text'}
                  step={def?.type === 'nombre' ? 'any' : undefined}
                  value={valeur}
                  onChange={(e) => setValeur(e.target.value)}
                  className={def?.type === 'nombre' ? 'text-right tabular-nums' : undefined}
                  autoFocus
                />
              )}
              {def?.unite && (
                <p className="mt-1 text-[11px] text-attenue-texte">Exprimee en {def.unite}.</p>
              )}
            </div>
          )}

          <Alerte ton="info">
            Le filtre s'applique aux lignes <strong>deja chargees</strong>. Les champs que vos
            droits masquent n'y figurent pas, et une condition qui les vise reste sans effet plutot
            que de vider la liste.
          </Alerte>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-bordure pt-3">
          <Bouton variante="contour" onClick={surFermeture}>
            Annuler
          </Bouton>
          <Bouton
            disabled={!pret}
            onClick={() => surAjout({ champ, operateur, valeur: sansValeur ? '' : valeur.trim() })}
          >
            <Filter />
            Appliquer
          </Bouton>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

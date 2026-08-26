/**
 * Formulaire pilote par les droits par champ.
 *
 * Chaque champ declare le nom sous lequel il est connu du serveur. Le niveau de
 * l'utilisateur decide de son sort :
 *
 *   MASQUE    le champ n'est pas rendu du tout
 *   LECTURE   rendu, mais desactive et exclu de l'envoi
 *   ECRITURE  saisissable
 *
 * Exclure les champs en lecture de la charge utile n'est pas un detail : le
 * serveur les refuserait, et la requete entiere echouerait pour un champ que
 * l'utilisateur n'a meme pas touche.
 *
 * L'interface ne protege rien — le serveur applique la meme grille. Elle evite
 * seulement de faire saisir ce qui sera refuse.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useDroits } from '../auth/AuthContext'
import { cn } from '../lib/utils'
import { Alerte, Bouton, Champ, Etiq, Selecteur, Zone } from '../composants/ui/base'
import { Dialogue, DialogueContenu, Interrupteur } from '../composants/ui/surcouches'

export type TypeChamp = 'texte' | 'nombre' | 'entier' | 'date' | 'booleen' | 'liste' | 'zone'

export interface Option {
  valeur: string
  libelle: string
}

export interface ChampDef {
  champ: string
  libelle: string
  type?: TypeChamp
  options?: Option[]
  obligatoire?: boolean
  /** Modifiable uniquement a la creation (identifiants). */
  cleCreation?: boolean
  /**
   * Valeur proposee a la CREATION. Sans elle, un interrupteur s'affiche
   * decoche alors que la base cree la ligne active : l'ecran ment sur ce qui
   * va etre enregistre.
   */
  defaut?: unknown
  aide?: string
  min?: number
  max?: number
  pas?: number
  pleineLargeur?: boolean
}

interface Props {
  module: string
  champs: ChampDef[]
  valeurs?: Record<string, unknown>
  creation?: boolean
  enCours?: boolean
  erreur?: string | null
  libelleValider?: string
  surAnnuler?: () => void
  surValider: (donnees: Record<string, unknown>) => void
  enfants?: ReactNode
}

export function Formulaire({
  module,
  champs,
  valeurs = {},
  creation = false,
  enCours = false,
  erreur,
  libelleValider = 'Enregistrer',
  surAnnuler,
  surValider,
  enfants,
}: Props) {
  const droits = useDroits(module)
  const [donnees, setDonnees] = useState<Record<string, unknown>>({})
  const [manquants, setManquants] = useState<string[]>([])

  useEffect(() => {
    // A la creation, les valeurs par defaut declarees priment sur le vide ; en
    // modification, elles n'ont rien a dire — la ligne existante fait foi.
    const defauts: Record<string, unknown> = {}
    if (creation) {
      for (const c of champs) {
        if (c.defaut !== undefined) defauts[c.champ] = c.defaut
      }
    }
    setDonnees({ ...defauts, ...valeurs })
    setManquants([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(valeurs), creation])

  const visibles = champs.filter((c) => droits.visible(c.champ))

  const saisissable = (c: ChampDef) => {
    // Un identifiant se CHOISIT a la creation et ne se renomme jamais : il est
    // cite par les mouvements, les recettes et les commandes.
    //
    // C'est precisement pour interdire le renommage qu'il est declare en
    // LECTURE dans la grille de droits. Passer cette declaration au meme filtre
    // que les autres champs le rendrait aussi non saisissable A LA CREATION, ou
    // il n'y a pourtant rien a renommer — et plus aucune reference ne pourrait
    // etre creee. Le serveur raisonne deja ainsi : il extrait la cle AVANT le
    // filtre de droits, et c'est la liste `modification` de l'entite, qui ne
    // contient jamais la cle, qui protege reellement du renommage.
    if (c.cleCreation) return creation && droits.peutEcrire
    return droits.modifiable(c.champ)
  }

  function soumettre(e: React.FormEvent) {
    e.preventDefault()

    const absents = visibles
      .filter((c) => c.obligatoire && saisissable(c))
      .filter((c) => {
        const v = donnees[c.champ]
        return v === undefined || v === null || v === ''
      })
      .map((c) => c.champ)

    if (absents.length) {
      setManquants(absents)
      return
    }

    const charge: Record<string, unknown> = {}
    for (const c of visibles) {
      if (!saisissable(c)) continue
      const v = donnees[c.champ]
      if (v === undefined) continue
      charge[c.champ] = v === '' && !c.obligatoire ? null : v
    }
    surValider(charge)
  }

  return (
    <form onSubmit={soumettre} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {visibles.map((c) => {
          const actif = saisissable(c)
          const manque = manquants.includes(c.champ)
          const valeur = donnees[c.champ]
          const type = c.type ?? 'texte'
          const maj = (v: unknown) => setDonnees((d) => ({ ...d, [c.champ]: v }))
          const id = `ch-${c.champ}`

          return (
            <div
              key={c.champ}
              className={cn((c.pleineLargeur || type === 'zone') && 'sm:col-span-2')}
            >
              <Etiq htmlFor={id} obligatoire={c.obligatoire && actif}>
                {c.libelle}
                {!actif && (
                  <span className="ml-1 inline-flex items-center gap-1 text-xs font-normal text-attenue-texte">
                    <Lock className="size-3" />
                    {c.cleCreation && !creation ? 'non modifiable' : 'lecture seule'}
                  </span>
                )}
                {c.aide && (
                  /* La note vit dans l'etiquette, a gauche, et non sous le
                     champ. Sous le champ, elle poussait le suivant d'une ligne
                     et espacait tout le formulaire ; ici elle occupe une place
                     deja disponible et ne deplace rien. */
                  <span className="ml-1 font-normal normal-case text-attenue-texte">
                    — {c.aide}
                  </span>
                )}
              </Etiq>

              {type === 'booleen' ? (
                <div className="flex h-9 items-center gap-2">
                  <Interrupteur
                    id={id}
                    disabled={!actif}
                    checked={valeur === 1 || valeur === true}
                    onCheckedChange={(v) => maj(v ? 1 : 0)}
                  />
                  <span className="text-sm text-attenue-texte">
                    {valeur === 1 || valeur === true ? 'Oui' : 'Non'}
                  </span>
                </div>
              ) : type === 'liste' ? (
                <Selecteur
                  id={id}
                  disabled={!actif}
                  aria-invalid={manque}
                  value={(valeur as string) ?? ''}
                  onChange={(e) => maj(e.target.value)}
                >
                  <option value="">—</option>
                  {c.options?.map((o) => (
                    <option key={o.valeur} value={o.valeur}>
                      {o.libelle}
                    </option>
                  ))}
                </Selecteur>
              ) : type === 'zone' ? (
                <Zone
                  id={id}
                  disabled={!actif}
                  aria-invalid={manque}
                  value={(valeur as string) ?? ''}
                  onChange={(e) => maj(e.target.value)}
                />
              ) : (
                <Champ
                  id={id}
                  type={type === 'date' ? 'date' : type === 'texte' ? 'text' : 'number'}
                  inputMode={type === 'nombre' || type === 'entier' ? 'decimal' : undefined}
                  step={type === 'entier' ? 1 : (c.pas ?? 'any')}
                  min={c.min}
                  max={c.max}
                  disabled={!actif}
                  aria-invalid={manque}
                  value={(valeur as string | number) ?? ''}
                  onChange={(e) => {
                    const t = e.target.value
                    maj(type === 'nombre' || type === 'entier' ? (t === '' ? '' : Number(t)) : t)
                  }}
                />
              )}

            </div>
          )
        })}
      </div>

      {enfants}

      {manquants.length > 0 && (
        <Alerte ton="alerte">Renseignez les champs obligatoires signales.</Alerte>
      )}
      {erreur && <Alerte ton="danger">{erreur}</Alerte>}

      <div className="flex justify-end gap-2">
        {surAnnuler && (
          <Bouton type="button" variante="contour" onClick={surAnnuler}>
            Annuler
          </Bouton>
        )}
        <Bouton type="submit" chargement={enCours}>
          {libelleValider}
        </Bouton>
      </div>
    </form>
  )
}

/** Panneau de saisie : modal centre sur bureau, feuille du bas sur mobile. */
export function Panneau({
  titre,
  sous_titre,
  surFermeture,
  cote = 'centre',
  children,
}: {
  titre: string
  sous_titre?: string
  surFermeture: () => void
  cote?: 'centre' | 'droite'
  children: ReactNode
}) {
  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu titre={titre} description={sous_titre} cote={cote}>
        {children}
      </DialogueContenu>
    </Dialogue>
  )
}

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
import {
  Alerte,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Etiq,
  Selecteur,
  Zone,
} from '../composants/ui/base'
import { Aide, Dialogue, DialogueContenu, Interrupteur } from '../composants/ui/surcouches'

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
  /**
   * LA SECTION DU CHAMP (« Général », « Achat »…). Des qu'un seul champ en
   * declare une, le formulaire se range en cartes titrees, dans l'ordre ou les
   * sections apparaissent ; un champ sans section va dans « Autres
   * informations ». Aucun champ n'en declare : le formulaire reste tel qu'il
   * etait, a l'identique.
   */
  section?: string
  /** Dans un formulaire a sections : le champ occupe deux colonnes au lieu d'une. */
  etendue?: 2
  /**
   * LE CHAMP N'A DE SENS QUE SI UN INTERRUPTEUR EST ALLUME. Eteint, le champ
   * reste visible mais grise, avec la raison ; sa valeur n'est pas envoyee —
   * elle est gardee en base et revient si l'on rallume. Ex. : le stock minimum
   * par lot ne vaut que pour une reference suivie par lot.
   */
  actifSi?: { champ: string; raison: string }
}

/** L'interrupteur dont depend un champ est-il allume ? */
const conditionRemplie = (c: ChampDef, donnees: Record<string, unknown>) =>
  !c.actifSi || donnees[c.actifSi.champ] === 1 || donnees[c.actifSi.champ] === true

/** Le nom de la section qui recueille les champs qui n'en declarent pas. */
const SECTION_PAR_DEFAUT = 'Autres informations'

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
      if (!saisissable(c) || !conditionRemplie(c, donnees)) continue
      const v = donnees[c.champ]
      if (v === undefined) continue
      charge[c.champ] = v === '' && !c.obligatoire ? null : v
    }
    surValider(charge)
  }

  const avecSections = champs.some((c) => c.section)

  /**
   * Un champ, son etiquette et son controle.
   *
   * EN SECTIONS, TOUT CE QUI EST SUR UNE MEME RANGEE A LA MEME HAUTEUR. Le champ
   * texte fait 32 px, l'interrupteur etait pose dans une boite de 36 : sur une
   * grille de trois colonnes, la difference se voyait d'un coup d'oeil, comme un
   * champ decale. L'etiquette garde aussi une hauteur fixe, pour que la mention
   * « lecture seule » ou l'aide n'abaisse pas son seul controle.
   */
  const rendreChamp = (c: ChampDef) => {
    const condition = conditionRemplie(c, donnees)
    const actif = saisissable(c) && condition
    const manque = manquants.includes(c.champ)
    const valeur = donnees[c.champ]
    const type = c.type ?? 'texte'
    const maj = (v: unknown) => setDonnees((d) => ({ ...d, [c.champ]: v }))
    const id = `ch-${c.champ}`
    const large = c.pleineLargeur || type === 'zone'

    return (
            <div
              key={c.champ}
              className={cn(
                avecSections
                  ? large
                    ? 'sm:col-span-2 xl:col-span-3'
                    : c.etendue === 2 && 'sm:col-span-2'
                  : large && 'sm:col-span-2',
                avecSections && 'min-w-0',
              )}
            >
              <Etiq
                htmlFor={id}
                obligatoire={c.obligatoire && actif}
                className={avecSections ? 'h-4 whitespace-nowrap' : undefined}
              >
                {c.libelle}
                {!actif && (
                  <span className="ml-1 inline-flex items-center gap-1 text-xs font-normal text-attenue-texte">
                    <Lock className="size-3" />
                    {!condition && c.actifSi
                      ? c.actifSi.raison
                      : c.cleCreation && !creation ? 'non modifiable' : 'lecture seule'}
                  </span>
                )}
                {c.aide && (
                  /* LA NOTE SE REPLIE DANS UNE INFO-BULLE.
                     Ecrite en toutes lettres — sous le champ hier, dans
                     l'etiquette ensuite — elle faisait passer l'etiquette a la
                     ligne des qu'elle depassait quelques mots. Les champs d'une
                     meme rangee ne commencaient alors plus a la meme hauteur, et
                     le formulaire perdait sa lecture. Repliee, l'explication
                     reste a portee de survol sans rien deplacer. */
                  <Aide>{c.aide}</Aide>
                )}
              </Etiq>

              {type === 'booleen' ? (
                <div className={cn('flex items-center gap-2', avecSections ? 'h-8' : 'h-9')}>
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
  }

  /* Les sections, dans l'ordre ou elles apparaissent ; une section dont tous
     les champs sont masques par les droits disparait, sans carte vide. */
  const sections: { nom: string; champs: ChampDef[] }[] = []
  if (avecSections) {
    for (const c of visibles) {
      const nom = c.section ?? SECTION_PAR_DEFAUT
      let s = sections.find((x) => x.nom === nom)
      if (!s) sections.push((s = { nom, champs: [] }))
      s.champs.push(c)
    }
  }

  return (
    <form onSubmit={soumettre} className={avecSections ? 'space-y-3' : 'space-y-5'}>
      {avecSections ? (
        sections.map((s) => (
          <Carte key={s.nom}>
            <CarteEntete>
              <CarteTitre>{s.nom}</CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-4">
              {/* Une colonne au telephone, deux des 640 px, trois des 1280 px :
                  des colonnes EGALES, pour que les champs s'alignent d'une
                  rangee a l'autre et d'une section a l'autre. */}
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
                {s.champs.map(rendreChamp)}
              </div>
            </CarteCorps>
          </Carte>
        ))
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">{visibles.map(rendreChamp)}</div>
      )}

      {enfants}

      {manquants.length > 0 && (
        <Alerte ton="alerte">Renseignez les champs obligatoires signales.</Alerte>
      )}
      {erreur && <Alerte ton="danger">{erreur}</Alerte>}

      {/* EN SECTIONS, « ENREGISTRER » RESTE A PORTEE. Une fiche de trente champs
          fait plusieurs ecrans de haut au telephone : le bouton, pose en bas,
          obligeait a tout faire defiler pour valider. La barre colle au bas de
          l'ecran, AU-DESSUS de la barre de navigation du telephone
          (`--barre-basse`, publiee par la coquille) — et au ras du bord des
          qu'elle disparait, a partir de 768 px. */}
      <div
        className={cn(
          'flex justify-end gap-2',
          avecSections &&
            'sticky bottom-[var(--barre-basse)] z-20 -mx-3 border-t border-bordure bg-fond/95 ' +
              'px-3 py-2 backdrop-blur-sm sm:-mx-5 sm:px-5 md:bottom-0',
        )}
      >
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

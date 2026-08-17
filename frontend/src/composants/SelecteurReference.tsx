/**
 * Choix d'une matiere au catalogue.
 *
 * Un menu deroulant ne tient pas : le catalogue compte des centaines de
 * references, et il en comptera des milliers. On ouvre donc un panneau avec une
 * recherche, et on montre ce qu'il faut pour trancher — designation, categorie,
 * fournisseur, prix.
 *
 * Le filtre par role est une AIDE, pas une barriere : il est actif par defaut et
 * se leve d'un clic. Surtout, quand il est actif il ne laisse RIEN passer d'un
 * autre role — la version precedente basculait en silence sur tout le catalogue
 * des que le role ne ramenait rien, ce qui donnait exactement l'inverse de ce
 * qu'on demandait. Ici, un role sans matiere le dit et propose de lever le
 * filtre.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Package, Search, X } from 'lucide-react'
import { cn, fmt } from '../lib/utils'
import { Badge, Bouton, Champ } from './ui/base'
import { Dialogue, DialogueContenu } from './ui/surcouches'

export interface RefChoisissable {
  code_reference: string
  designation: string
  code_categorie: string
  categorie_libelle?: string | null
  type_fil?: string | null
  couleur?: string | null
  fournisseur_nom?: string | null
  prix_kg_mad?: number | null
  code_devise_catalogue?: string | null
  actif?: number
}

interface Props {
  ouvert: boolean
  surOuvert: (o: boolean) => void
  references: RefChoisissable[]
  /** Role BOM vise ; sert au filtre par defaut. */
  role: string
  libelleRole: string
  /** Categories destinees a ce role, d'apres le referentiel. */
  categoriesDuRole: Set<string>
  /** Deja employees ailleurs dans la qualite : proposees barrees, non cliquables. */
  dejaPrises: Set<string>
  /** Selection courante de la ligne, s'il y en a une. */
  courante?: string
  /** Les prix sont-ils visibles pour cet utilisateur ? */
  prixVisibles?: boolean
  surChoisir: (code: string) => void
}

export function SelecteurReference({
  ouvert,
  surOuvert,
  references,
  role,
  libelleRole,
  categoriesDuRole,
  dejaPrises,
  courante,
  prixVisibles = true,
  surChoisir,
}: Props) {
  const [recherche, setRecherche] = useState('')
  const [limiterAuRole, setLimiterAuRole] = useState(true)
  const champRef = useRef<HTMLInputElement>(null)

  // A chaque ouverture on repart d'une recherche vide et du filtre par defaut :
  // le panneau ne doit pas garder l'etat d'une saisie precedente.
  useEffect(() => {
    if (!ouvert) return
    setRecherche('')
    setLimiterAuRole(true)
    const t = setTimeout(() => champRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [ouvert])

  const { visibles, totalRole, totalCatalogue } = useMemo(() => {
    const actives = references.filter((r) => r.actif !== 0)
    const duRole = actives.filter((r) => categoriesDuRole.has(r.code_categorie))
    const base = limiterAuRole ? duRole : actives

    const q = recherche.trim().toLowerCase()
    const filtrees = !q
      ? base
      : base.filter((r) =>
          [
            r.code_reference,
            r.designation,
            r.categorie_libelle,
            r.type_fil,
            r.couleur,
            r.fournisseur_nom,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )

    // La selection courante reste toujours visible, meme si elle sort du filtre :
    // sinon on ne verrait pas ce qu'on est en train de remplacer.
    const avecCourante =
      courante && !filtrees.some((r) => r.code_reference === courante)
        ? [...actives.filter((r) => r.code_reference === courante), ...filtrees]
        : filtrees

    return {
      visibles: avecCourante.slice(0, 300),
      totalRole: duRole.length,
      totalCatalogue: actives.length,
      totalFiltre: avecCourante.length,
    }
  }, [references, categoriesDuRole, limiterAuRole, recherche, courante])

  const tropNombreux = visibles.length >= 300

  return (
    <Dialogue open={ouvert} onOpenChange={surOuvert}>
      <DialogueContenu
        cote="droite"
        titre="Choisir une matiere"
        description={`Role ${libelleRole} (${role})`}
        className="max-w-2xl"
      >
        {/* --- Recherche et filtre --------------------------------------- */}
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-2 space-y-2 border-b border-bordure bg-surface px-4 pb-2 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-attenue-texte" />
            <Champ
              ref={champRef}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Code, designation, type, couleur, fournisseur..."
              className="pl-7 pr-7"
            />
            {recherche && (
              <button
                type="button"
                onClick={() => setRecherche('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-attenue-texte hover:text-texte"
                aria-label="Effacer"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-attenue-texte">
              <input
                type="checkbox"
                checked={limiterAuRole}
                onChange={(e) => setLimiterAuRole(e.target.checked)}
                className="size-3.5"
              />
              Matieres du role {libelleRole}
              <Badge ton="contour">{totalRole}</Badge>
            </label>
            <span className="text-[11px] tabular-nums text-attenue-texte">
              {visibles.length} affichee(s)
              {!limiterAuRole && ` sur ${totalCatalogue}`}
            </span>
          </div>
        </div>

        {/* --- Liste ------------------------------------------------------ */}
        {visibles.length === 0 ? (
          <div className="py-10 text-center">
            <Package className="mx-auto size-8 text-attenue-texte" />
            <p className="mt-2 text-[13px] font-medium">
              {limiterAuRole && totalRole === 0
                ? `Aucune matiere n'est rattachee au role ${libelleRole}`
                : 'Aucune matiere ne correspond'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-attenue-texte">
              {limiterAuRole && totalRole === 0
                ? "Le rattachement se declare sur la categorie de matiere, dans Referentiels. En attendant, levez le filtre pour choisir dans tout le catalogue."
                : 'Affinez la recherche, ou levez le filtre de role.'}
            </p>
            {limiterAuRole && (
              <Bouton variante="contour" className="mt-3" onClick={() => setLimiterAuRole(false)}>
                Voir tout le catalogue ({totalCatalogue})
              </Bouton>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {visibles.map((r) => {
              const prise = dejaPrises.has(r.code_reference) && r.code_reference !== courante
              const choisie = r.code_reference === courante
              const horsRole = !categoriesDuRole.has(r.code_categorie)
              return (
                <button
                  key={r.code_reference}
                  type="button"
                  disabled={prise}
                  onClick={() => {
                    surChoisir(r.code_reference)
                    surOuvert(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-[var(--radius-sm)] border p-2 text-left transition-colors',
                    choisie
                      ? 'border-primaire bg-primaire/5'
                      : prise
                        ? 'cursor-not-allowed border-bordure opacity-45'
                        : 'border-bordure hover:border-anneau hover:bg-attenue',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{r.code_reference}</span>
                      {choisie && <Check className="size-3.5 text-primaire" />}
                      {prise && <Badge ton="contour">deja employee</Badge>}
                      {horsRole && <Badge ton="alerte">hors role</Badge>}
                    </div>
                    <div className="truncate text-[11px] text-attenue-texte">{r.designation}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-attenue-texte">
                      <span>{r.categorie_libelle ?? r.code_categorie}</span>
                      {r.type_fil && <span>{r.type_fil}</span>}
                      {r.couleur && <span>{r.couleur}</span>}
                      {r.fournisseur_nom && <span>{r.fournisseur_nom}</span>}
                    </div>
                  </div>
                  {prixVisibles && typeof r.prix_kg_mad === 'number' && (
                    <div className="shrink-0 text-right">
                      <div className="text-[12px] font-medium tabular-nums">
                        {fmt.nombre(r.prix_kg_mad, 2)}
                      </div>
                      <div className="text-[10px] text-attenue-texte">MAD/kg</div>
                    </div>
                  )}
                </button>
              )
            })}
            {tropNombreux && (
              <p className="pt-1 text-center text-[11px] text-attenue-texte">
                300 premieres matieres affichees — affinez la recherche pour voir les suivantes.
              </p>
            )}
          </div>
        )}
      </DialogueContenu>
    </Dialogue>
  )
}

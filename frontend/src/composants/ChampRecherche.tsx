/**
 * LE CHAMP OU L'ON TAPE UNE REFERENCE, au lieu de la chercher dans une liste.
 *
 * POURQUOI IL EXISTE. Les ecrans de saisie de cet ERP proposaient leurs
 * references par une liste a cocher ou un `<datalist>` alimente par le
 * catalogue entier. Sur 124 references cela passait ; sur mille, la liste est
 * illisible, le catalogue pese une seconde de chargement a chaque ouverture
 * d'ecran, et les deux mille `<option>` du datalist encombrent le document pour
 * rien. On ne choisit pas dans mille lignes : on tape ce qu'on a en tete.
 *
 * LA RECHERCHE SE FAIT SUR LE SERVEUR. Il rend les quelques lignes qui
 * correspondent, jamais le catalogue. Chaque mot frappe resserre la recherche —
 * « bleu 1500 » trouve « PP-1500 Dtex-Bleu 6666 » sans qu'on respecte l'ordre
 * des mots, qui n'est de toute facon jamais celui qu'on a en tete.
 *
 * CE QU'IL FAIT QUAND RIEN NE CORRESPOND. Il ne se contente pas de dire non :
 * l'ecran appelant peut proposer une SUITE — creer la reference, ou poser une
 * ligne libre. Une impasse sans porte de sortie renvoie l'utilisateur au
 * referentiel, et l'on perd la saisie en cours.
 *
 * AU CLAVIER, sans la souris : les fleches parcourent, Entree retient, Echap
 * ferme. Une saisie de bon de commande se fait a deux mains sur le clavier,
 * avec le telephone coince sur l'epaule.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { cn } from '../lib/utils'

export interface Suggestion {
  /** Ce qui sera retenu : le code de la reference. */
  valeur: string
  /** Premiere ligne, en evidence. */
  titre: string
  /** Seconde ligne, en retrait : designation, fournisseur, prix. */
  detail?: string
  /** Mention courte a droite : « proposee par le plan », « en rupture ». */
  mention?: string
  /** Ton de la mention. */
  ton?: 'neutre' | 'alerte' | 'primaire'
  /** Deja retenue ailleurs : montree, mais non choisissable. */
  desactivee?: boolean
  /**
   * Ce que l'ecran appelant veut retrouver au moment du choix.
   *
   * La ligne entiere voyage avec la suggestion : l'ecran qui la retient y lit
   * tout de suite le conditionnement, le prix, le stock — sans un second appel
   * au serveur pour redemander ce qu'il vient de recevoir.
   */
  charge?: unknown
}

export function ChampRecherche({
  valeur,
  surChoix,
  chercher,
  cleCache,
  chercherAVide,
  placeholder,
  aide,
  surAucun,
  autoFocus,
  className,
  desactive,
  erreur,
  ariaLabel,
}: {
  /** Ce que porte le champ. Vide tant que rien n'est retenu. */
  valeur: string
  surChoix: (s: Suggestion) => void
  /** Interroge le serveur. Rend au plus une vingtaine de suggestions. */
  chercher: (motif: string) => Promise<Suggestion[]>
  /**
   * CE QUI DISTINGUE DEUX RECHERCHES DU MEME MOT.
   *
   * Le resultat est mis en cache par motif. Si l'ecran change ce qu'il cherche
   * — un autre fournisseur, un autre magasin, le plan puis tout le catalogue —
   * le meme mot doit rendre autre chose. Sans ce discriminant, la seconde
   * recherche renvoyait le resultat de la premiere, et le champ paraissait
   * ignorer le changement de mode.
   */
  cleCache?: unknown[]
  /**
   * OUVRIR SUR UNE PROPOSITION, champ encore vide.
   *
   * Exiger deux caracteres avant de montrer quoi que ce soit oblige a savoir ce
   * qu'on cherche avant de chercher. Quand l'ecran a quelque chose a proposer
   * d'emblee — ce que le plan d'achat reclame, ce qui est en stock dans ce
   * magasin — le simple fait d'entrer dans le champ doit le faire apparaitre.
   * `chercher('')` rend alors cette liste-la.
   */
  chercherAVide?: boolean
  placeholder?: string
  /** Ligne d'aide sous la liste, quand elle est ouverte. */
  aide?: string
  /**
   * Ce qu'on propose quand la frappe ne trouve rien.
   *
   * Rendre `null` affiche simplement « aucune correspondance ». Rendre un
   * element y met des ACTIONS : creer la reference, poser une ligne libre.
   */
  surAucun?: (motif: string) => React.ReactNode
  autoFocus?: boolean
  className?: string
  desactive?: boolean
  erreur?: boolean
  ariaLabel?: string
}) {
  const [frappe, setFrappe] = useState('')
  const [ouvert, setOuvert] = useState(false)
  const [pointe, setPointe] = useState(0)
  const boite = useRef<HTMLDivElement>(null)
  /**
   * LA LISTE N'EST PLUS DANS LA BOITE : elle vit dans un portail, au corps
   * du document. Il faut donc la designer a part pour savoir si un clic est
   * « dedans » — sans ce second reperage, cliquer sur une suggestion comptait
   * comme un clic DEHORS : la liste se fermait au `mousedown`, et le `click`
   * n'atteignait jamais la ligne. Rien ne se selectionnait a la souris ;
   * seul le clavier fonctionnait, ce qui rendait le defaut invisible a un
   * essai automatise.
   */
  const panneau = useRef<HTMLDivElement>(null)


  /**
   * LA FRAPPE EST RETENUE AVANT D'ETRE ENVOYEE.
   *
   * Sans ce delai, chaque lettre part au serveur : taper « bleu » lance quatre
   * requetes dont trois sont deja perimees en arrivant, et la liste clignote
   * pendant qu'on tape. 200 ms est le temps qui separe deux frappes d'une main
   * qui sait ou elle va.
   */
  const [motif, setMotif] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setMotif(frappe.trim()), 200)
    return () => clearTimeout(t)
  }, [frappe])

  const q = useQuery({
    queryKey: ['champ-recherche', motif, ...(cleCache ?? [])],
    queryFn: () => chercher(motif),
    // DEUX CARACTERES AU MOINS — sauf quand l'ecran a une proposition a
    // faire des l'ouverture. Une seule lettre rendrait la moitie du
    // catalogue : ni utile a lire, ni honnete a demander au serveur.
    enabled: ouvert && (motif.length >= 2 || (!!chercherAVide && motif === '')),
    staleTime: 30_000,
  })

  const suggestions = useMemo(() => q.data ?? [], [q.data])
  // La hauteur de la liste change avec le nombre de suggestions : on la
  // replace a chaque fois, sinon elle chevauche la ligne suivante.
  const suggestionsLongueur = suggestions.length

  /**
   * LA LISTE SORT DU TABLEAU, par un portail vers le corps du document.
   *
   * Posee dans la cellule, elle etait ROGNEE : la grille defile
   * horizontalement (`overflow-x`), et tout ce qui depasse d'un conteneur
   * defilant est coupe. On ne voyait que la premiere suggestion, tranchee au
   * ras. Le portail l'affranchit du conteneur ; en echange il faut la placer
   * soi-meme, d'apres la position reelle du champ.
   */
  const [cadre, setCadre] = useState<{ x: number; y: number; l: number } | null>(null)
  useLayoutEffect(() => {
    if (!ouvert) return setCadre(null)
    const placer = () => {
      const r = boite.current?.getBoundingClientRect()
      if (r) setCadre({ x: r.left, y: r.bottom + 2, l: Math.max(r.width, 320) })
    }
    placer()
    // La page peut defiler ou changer de largeur pendant que la liste est
    // ouverte : sans cela elle resterait accrochee a l'ancienne position.
    window.addEventListener('scroll', placer, true)
    window.addEventListener('resize', placer)
    return () => {
      window.removeEventListener('scroll', placer, true)
      window.removeEventListener('resize', placer)
    }
  }, [ouvert, motif, suggestionsLongueur])
  const choisissables = useMemo(() => suggestions.filter((s) => !s.desactivee), [suggestions])

  // Le pointeur revient en tete a chaque nouvelle liste : sans cela il reste
  // sur un rang qui ne designe plus la meme ligne.
  useEffect(() => setPointe(0), [motif])

  // Un clic hors du champ referme la liste. Sans cela elle reste ouverte
  // par-dessus le reste de l'ecran, et l'on croit l'application bloquee.
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node
      if (boite.current?.contains(cible)) return
      if (panneau.current?.contains(cible)) return
      setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const retenir = (s: Suggestion) => {
    if (s.desactivee) return
    surChoix(s)
    setFrappe('')
    setOuvert(false)
  }

  const auClavier = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOuvert(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOuvert(true)
      if (choisissables.length === 0) return
      setPointe((p) => {
        const n = e.key === 'ArrowDown' ? p + 1 : p - 1
        return (n + choisissables.length) % choisissables.length
      })
      return
    }
    if (e.key === 'Enter') {
      const s = choisissables[pointe]
      if (s) {
        e.preventDefault()
        retenir(s)
      }
    }
  }

  const assezTape = motif.length >= 2 || (!!chercherAVide && motif === '')
  const rien = ouvert && motif.length >= 2 && !q.isFetching && suggestions.length === 0

  return (
    <div ref={boite} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-attenue-texte" />
        <input
          value={ouvert ? frappe : valeur || frappe}
          onChange={(e) => {
            setFrappe(e.target.value)
            setOuvert(true)
          }}
          onFocus={() => setOuvert(true)}
          onKeyDown={auClavier}
          placeholder={placeholder ?? 'Tapez une référence…'}
          disabled={desactive}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={ouvert}
          role="combobox"
          className={cn(
            'h-8 w-full rounded-[var(--radius)] border bg-surface pl-7 pr-2 text-[13px] outline-none',
            'focus:border-anneau disabled:opacity-50',
            erreur ? 'border-danger' : 'border-champ',
          )}
        />
        {q.isFetching && (
          <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-attenue-texte" />
        )}
      </div>

      {ouvert &&
        (assezTape || frappe.length > 0) &&
        cadre &&
        createPortal(
        <div
          ref={panneau}
          role="listbox"
          /* `pointerEvents` N'EST PAS DECORATIF ICI.
             Une fenetre modale Radix pose `pointer-events: none` sur le corps
             du document et ne le rend qu'a son propre contenu. Notre liste vit
             dans un portail, DEHORS : elle s'affichait normalement mais ne
             recevait aucun clic — au quai, l'article hors commande etait
             impossible a choisir a la souris. On lui rend ses evenements. */
          style={{
            position: 'fixed',
            left: cadre.x,
            top: cadre.y,
            width: cadre.l,
            pointerEvents: 'auto',
          }}
          className="z-[60] max-h-72 overflow-y-auto rounded-[var(--radius)] border border-bordure bg-surface shadow-lg"
        >
          {!assezTape && (
            <p className="px-3 py-2 text-[11px] text-attenue-texte">
              Tapez au moins deux caractères — le code, un morceau de la désignation, ou la
              couleur.
            </p>
          )}

          {/* LE SILENCE PENDANT LA RECHERCHE EST UNE PANNE APPARENTE. Sans cette
              ligne, le panneau s'ouvrait VIDE le temps que le serveur reponde —
              une boite blanche de zero hauteur, invisible : on croyait que la
              frappe n'avait rien declenche, et l'on retapait. */}
          {assezTape && q.isFetching && suggestions.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-attenue-texte">Recherche…</p>
          )}

          {suggestions.map((s, i) => {
            const rang = choisissables.indexOf(s)
            return (
              <button
                key={s.valeur}
                type="button"
                role="option"
                aria-selected={rang === pointe}
                disabled={s.desactivee}
                onMouseEnter={() => rang >= 0 && setPointe(rang)}
                onClick={() => retenir(s)}
                className={cn(
                  'flex w-full items-start gap-2 border-b border-bordure/50 px-3 py-1.5 text-left last:border-b-0',
                  s.desactivee
                    ? 'cursor-not-allowed opacity-45'
                    : rang === pointe
                      ? 'bg-primaire/10'
                      : 'hover:bg-attenue/50',
                  i === 0 && 'rounded-t-[var(--radius)]',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{s.titre}</span>
                  {s.detail && (
                    <span className="block truncate text-[11px] text-attenue-texte">
                      {s.detail}
                    </span>
                  )}
                </span>
                {s.mention && (
                  <span
                    className={cn(
                      'shrink-0 whitespace-nowrap pt-0.5 text-[10.5px]',
                      s.ton === 'alerte'
                        ? 'text-alerte'
                        : s.ton === 'primaire'
                          ? 'font-medium text-primaire'
                          : 'text-attenue-texte',
                    )}
                  >
                    {s.mention}
                  </span>
                )}
              </button>
            )
          })}

          {rien && (
            <div className="px-3 py-2">
              <p className="text-[12px]">
                Aucune référence ne correspond à <span className="font-medium">{motif}</span>.
              </p>
              {surAucun?.(motif)}
            </div>
          )}

          {aide && suggestions.length > 0 && (
            <p className="border-t border-bordure/60 px-3 py-1.5 text-[10.5px] text-attenue-texte">
              {aide}
            </p>
          )}
        </div>,
          document.body,
        )}
    </div>
  )
}

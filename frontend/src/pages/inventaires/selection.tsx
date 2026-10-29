/**
 * LA LISTE D'UN INVENTAIRE TOURNANT OU CIBLÉ (décision du 23/10/2026,
 * migration 2026-10-24b).
 *
 *   CIBLÉ     on CHOISIT les références à compter : par recherche (code,
 *             désignation — `ChampReference`), ou par famille / catégorie
 *             (toutes celles qui ont du stock dans ce magasin), puis on retire ;
 *   TOURNANT  le serveur PROPOSE les références dues selon leur classe ABC
 *             (jamais comptées dans ce magasin, ou depuis N jours : paramètres
 *             P_ComptageTournantA / B / C ; sans classe = C) ; on retouche, puis
 *             on valide.
 *
 * Rien n'est préparé sans la validation de la liste ; une fois les lignes
 * préparées, la liste est figée (garde en base). La même sélection sert à la
 * création (`/inventaires/nouveau`) et à un inventaire encore sans ligne.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListPlus, RotateCcw, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import { ChampReference } from '../../composants/ChampReference'
import { Alerte, Badge, Bouton, Selecteur } from '../../composants/ui/base'
import { fmt } from '../../lib/utils'
import { tonStatut } from '../../lib/statuts'

/** Une référence en stock dans le magasin, telle que `v_inventaire_candidat` la décrit. */
export interface Candidat {
  code_reference: string
  designation: string | null
  code_famille: string | null
  famille_libelle: string | null
  code_categorie: string | null
  categorie_libelle: string | null
  classe_abc: string | null
  classe_retenue: string
  sans_classe: boolean
  stock_kg: number | null
  dernier_comptage: string | null
  periode_jours: number | null
  jours_depuis: number | null
  du: boolean | null
}

/** Une référence de la liste : un candidat, ou une référence trouvée par recherche (sans stock ici). */
export type Choix = Pick<Candidat, 'code_reference'> & Partial<Omit<Candidat, 'code_reference'>>

export interface Candidats {
  periodes: { A: number; B: number; C: number }
  candidats: Candidat[]
}

export const LIBELLE_TYPE: Record<string, string> = {
  GLOBAL: 'Global — tout le catalogue',
  TOURNANT: 'Tournant — proposé selon la classe ABC',
  CIBLE: 'Ciblé — les références choisies',
}

export function useCandidats(magasin: string | undefined, actif = true) {
  return useQuery({
    queryKey: ['inventaire-candidats', magasin],
    enabled: !!magasin && actif,
    queryFn: ({ signal }) =>
      api.get<Candidats>(`/api/inventaires/candidats?magasin=${encodeURIComponent(magasin ?? '')}`, { signal }),
  })
}

/** La proposition du tournant : les références dues. */
export function proposition(c: Candidats | undefined): Choix[] {
  return (c?.candidats ?? []).filter((x) => x.du)
}

/** L'empreinte d'une liste, pour savoir si elle a changé. */
export function empreinteListe(l: Choix[]): string {
  return l
    .map((c) => c.code_reference)
    .sort()
    .join('\u0001')
}

/**
 * LA LISTE, À CHOISIR OU À RETOUCHER. `liste` et `changer` appartiennent à la
 * page : elle seule sait si la liste a changé et ce que fait son bouton.
 */
export function SelectionReferences({
  type,
  candidats,
  chargement,
  liste,
  changer,
  desactive,
}: {
  type: string
  candidats: Candidats | undefined
  chargement: boolean
  liste: Choix[]
  changer: (l: Choix[]) => void
  desactive?: boolean
}) {
  const [famille, setFamille] = useState('')
  const [categorie, setCategorie] = useState('')
  const dans = useMemo(() => new Set(liste.map((c) => c.code_reference)), [liste])
  const parCode = useMemo(() => new Map((candidats?.candidats ?? []).map((c) => [c.code_reference, c])), [candidats])

  /** Les familles et catégories des références en stock dans ce magasin. */
  const groupes = useMemo(() => {
    const fam = new Map<string, { libelle: string; n: number }>()
    const cat = new Map<string, { libelle: string; n: number }>()
    for (const c of candidats?.candidats ?? []) {
      if (c.code_famille) {
        const g = fam.get(c.code_famille) ?? { libelle: c.famille_libelle ?? c.code_famille, n: 0 }
        g.n++
        fam.set(c.code_famille, g)
      }
      if (c.code_categorie) {
        const g = cat.get(c.code_categorie) ?? { libelle: c.categorie_libelle ?? c.code_categorie, n: 0 }
        g.n++
        cat.set(c.code_categorie, g)
      }
    }
    const trier = (m: Map<string, { libelle: string; n: number }>) =>
      [...m.entries()].sort((a, b) => a[1].libelle.localeCompare(b[1].libelle, 'fr'))
    return { familles: trier(fam), categories: trier(cat) }
  }, [candidats])

  const ajouter = (nouveaux: Choix[]) => {
    const n = nouveaux.filter((c) => !dans.has(c.code_reference))
    if (n.length) changer([...liste, ...n])
  }
  const retirer = (code: string) => changer(liste.filter((c) => c.code_reference !== code))
  const prop = proposition(candidats)
  const per = candidats?.periodes

  return (
    <div className="space-y-3">
      {type === 'TOURNANT' && (
        <Alerte ton="info" className="px-3 py-2 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {chargement ? (
              'Calcul de la proposition…'
            ) : (
              <>
                <span className="font-medium">
                  Proposition : {prop.length} référence(s) due(s) sur {candidats?.candidats.length ?? 0} en stock.
                </span>{' '}
                Due = jamais comptée dans ce magasin, ou pas depuis {per?.A ?? 30} j (classe A), {per?.B ?? 90} j (B),{' '}
                {per?.C ?? 180} j (C ou sans classe).
              </>
            )}
          </span>
          <Bouton
            taille="sm"
            variante="contour"
            disabled={desactive || chargement || empreinteListe(prop) === empreinteListe(liste)}
            onClick={() => changer(prop)}
          >
            <RotateCcw />
            Reprendre la proposition
          </Bouton>
          </div>
        </Alerte>
      )}

      {/* Ajouter : recherche, famille, catégorie. Tout passe à la ligne sur un écran étroit. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <ChampReference
            valeur=""
            surChoix={(r) =>
              ajouter([
                parCode.get(r.code_reference) ?? {
                  code_reference: r.code_reference,
                  designation: r.designation ?? null,
                  stock_kg: 0,
                },
              ])
            }
            dejaPrises={dans}
            mention={(r) => {
              const c = parCode.get(r.code_reference)
              return c ? { texte: `${fmt.nombre(c.stock_kg, 1)} kg ici` } : { texte: 'pas de stock ici', ton: 'alerte' }
            }}
            placeholder="Ajouter une référence — code ou désignation…"
            ariaLabel="Ajouter une référence à compter"
            desactive={desactive}
          />
        </div>
        <div className="flex items-center gap-1">
          <Selecteur
            aria-label="Famille à ajouter"
            className="w-52"
            value={famille}
            disabled={desactive}
            onChange={(e) => setFamille(e.target.value)}
          >
            <option value="">Famille…</option>
            {groupes.familles.map(([code, g]) => (
              <option key={code} value={code}>
                {g.libelle} ({g.n})
              </option>
            ))}
          </Selecteur>
          <Bouton
            taille="sm"
            variante="contour"
            disabled={desactive || !famille}
            onClick={() => {
              ajouter((candidats?.candidats ?? []).filter((c) => c.code_famille === famille))
              setFamille('')
            }}
          >
            <ListPlus />
            Ajouter la famille
          </Bouton>
        </div>
        <div className="flex items-center gap-1">
          <Selecteur
            aria-label="Catégorie à ajouter"
            className="w-44"
            value={categorie}
            disabled={desactive}
            onChange={(e) => setCategorie(e.target.value)}
          >
            <option value="">Catégorie…</option>
            {groupes.categories.map(([code, g]) => (
              <option key={code} value={code}>
                {g.libelle} ({g.n})
              </option>
            ))}
          </Selecteur>
          <Bouton
            taille="sm"
            variante="contour"
            disabled={desactive || !categorie}
            onClick={() => {
              ajouter((candidats?.candidats ?? []).filter((c) => c.code_categorie === categorie))
              setCategorie('')
            }}
          >
            <ListPlus />
            Ajouter la catégorie
          </Bouton>
        </div>
        <Bouton
          taille="sm"
          variante="discret"
          className="text-danger"
          disabled={desactive || liste.length === 0}
          onClick={() => changer([])}
        >
          <Trash2 />
          Tout retirer
        </Bouton>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
        {liste.length} référence(s) à compter
      </div>
      {liste.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-bordure px-3 py-4 text-center text-[12.5px] text-attenue-texte">
          {type === 'TOURNANT'
            ? 'Aucune référence : la proposition est vide ou tout a été retiré. Ajoutez-en par recherche, famille ou catégorie.'
            : 'Aucune référence choisie : ajoutez-en par recherche, famille ou catégorie.'}
        </p>
      ) : (
        <ul className="divide-y divide-bordure rounded-[var(--radius)] border border-bordure" aria-label="Références à compter">
          {liste.map((c0) => {
            const c: Choix = parCode.get(c0.code_reference) ?? c0
            return (
              <li key={c.code_reference} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-[12.5px]">
                <span className="min-w-0 flex-1 basis-64">
                  <span className="font-mono text-[12px]">{c.code_reference}</span>
                  {c.designation && <span className="text-attenue-texte"> · {c.designation}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-attenue-texte">
                  {c.famille_libelle && <span>{c.famille_libelle}</span>}
                  {c.classe_retenue && (
                    <Badge ton={tonStatut('classe_abc', c.classe_retenue)} title={c.sans_classe ? 'Sans classe ABC : traitée comme C' : undefined}>
                      {c.sans_classe ? 'C (sans classe)' : `Classe ${c.classe_retenue}`}
                    </Badge>
                  )}
                  <span>
                    {c.dernier_comptage ? `compté le ${fmt.date(c.dernier_comptage)}` : 'jamais compté ici'}
                  </span>
                  <span className="tabular-nums">{fmt.nombre(c.stock_kg ?? 0, 1)} kg</span>
                  {type === 'TOURNANT' && c.du && <Badge ton="alerte">dû</Badge>}
                </span>
                <Bouton
                  taille="icone-xs"
                  variante="discret"
                  aria-label={`Retirer ${c.code_reference}`}
                  title="Retirer de la liste"
                  disabled={desactive}
                  onClick={() => retirer(c.code_reference)}
                >
                  <X />
                </Bouton>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

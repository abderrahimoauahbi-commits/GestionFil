/**
 * L'ASSISTANT QUI COMPLETE LE CATALOGUE — sans conversation.
 *
 * Une reference interne est une phrase :
 *
 *     catégorie - famille - couleur (ou origine) - réf fournisseur - fournisseur
 *     PES       - 3000 Deniers    - Khave        - Ssl2279         - Suj
 *
 * Les références portent cette phrase dans leur code, mais pas dans leurs
 * colonnes. Cet écran les remplit — et surtout, il ne fait pas semblant de
 * savoir : ce qu'il a déduit est marqué « proposé », ce qu'il ignore reste vide
 * avec ses candidats à côté. C'est la règle donnée : le plus proche, et
 * demander le reste.
 *
 * RIEN N'EST ÉCRIT SANS UN GESTE. On accepte ligne par ligne, ou toutes les
 * propositions sûres d'un coup — mais jamais en ouvrant l'écran.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Selecteur,
} from '../composants/ui/base'
import { cn } from '../lib/utils'

interface FamillePossible {
  code: string
  libelle: string
  titrage: string
}

interface LigneCompletion {
  code_reference: string
  designation: string | null
  code_categorie: string
  categorie_libelle: string | null
  code_fournisseur: string
  couleur: string
  titrage: string
  complete: boolean
  actuel: {
    code_famille: string | null
    code_couleur_interne: string | null
    reference_fournisseur: string
    origine: string
  }
  propose: {
    code_famille: string | null
    code_couleur_interne: string | null
    reference_fournisseur: string | null
  }
  familles_possibles: FamillePossible[]
}

interface Completion {
  lignes: LigneCompletion[]
  couleurs: { code: string; libelle: string }[]
  bilan: {
    references: number
    famille_sure: number
    couleur_sure: number
    reference_fournisseur_lue: number
  }
}

/** Ce qu'on s'apprête à écrire sur une référence. */
interface Saisie {
  code_famille: string
  code_couleur_interne: string
  reference_fournisseur: string
  origine: string
}

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1 align-top'
const champ = 'h-7 px-1.5 text-[12.5px]'

function valeurDepart(l: LigneCompletion): Saisie {
  return {
    code_famille: l.actuel.code_famille ?? l.propose.code_famille ?? '',
    code_couleur_interne: l.actuel.code_couleur_interne ?? l.propose.code_couleur_interne ?? '',
    reference_fournisseur: l.actuel.reference_fournisseur || l.propose.reference_fournisseur || '',
    origine: l.actuel.origine ?? '',
  }
}

export function CompleterCatalogue() {
  const droits = useDroits('CATALOGUE')
  const qc = useQueryClient()
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({})
  const [filtre, setFiltre] = useState<'a-completer' | 'tout'>('a-completer')

  const q = useQuery({
    queryKey: ['catalogue-completion'],
    queryFn: () => api.get<Completion>('/api/catalogue/completion'),
  })

  const lignes = useMemo(() => {
    const tout = q.data?.lignes ?? []
    return filtre === 'tout' ? tout : tout.filter((l) => !l.complete)
  }, [q.data, filtre])

  const valeur = (l: LigneCompletion): Saisie => saisies[l.code_reference] ?? valeurDepart(l)
  const poser = (code: string, champ: keyof Saisie, v: string) =>
    setSaisies((s) => ({
      ...s,
      [code]: { ...(s[code] ?? valeurDepart(lignes.find((l) => l.code_reference === code)!)), [champ]: v },
    }))

  const enregistrer = useMutation({
    mutationFn: async (cibles: LigneCompletion[]) => {
      let faites = 0
      for (const l of cibles) {
        const v = valeur(l)
        const charge: Record<string, string | null> = {}
        if (v.code_famille) charge.code_famille = v.code_famille
        if (v.code_couleur_interne) charge.code_couleur_interne = v.code_couleur_interne
        if (v.reference_fournisseur) charge.reference_fournisseur = v.reference_fournisseur
        if (v.origine) charge.origine = v.origine
        if (Object.keys(charge).length === 0) continue
        await api.patch(`/api/catalogue/${encodeURIComponent(l.code_reference)}`, charge)
        faites += 1
      }
      return faites
    },
    onSuccess: (faites) => {
      toast.success(`${faites} référence(s) complétée(s)`)
      setSaisies({})
      void qc.invalidateQueries({ queryKey: ['catalogue-completion'] })
      void qc.invalidateQueries({ queryKey: ['catalogue'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  if (q.isLoading) return <Chargement />
  if (q.error) {
    return <Alerte ton="danger">{q.error instanceof ErreurApi ? q.error.message : 'Lecture impossible.'}</Alerte>
  }

  const bilan = q.data?.bilan
  const couleurs = q.data?.couleurs ?? []
  // TOUTE LIGNE QUI PORTE AU MOINS UNE PROPOSITION peut partir dans le lot :
  // n'écrire que les lignes complètes laisserait dormir 52 familles sûres
  // parce que leur couleur, elle, reste à créer. Chaque champ vide est ignoré
  // à l'écriture, donc accepter le lot n'efface jamais rien.
  const sures = lignes.filter((l) => {
    const v = valeur(l)
    return (
      (v.code_famille && !l.actuel.code_famille) ||
      (v.code_couleur_interne && !l.actuel.code_couleur_interne) ||
      (v.reference_fournisseur && !l.actuel.reference_fournisseur)
    )
  })
  const aDemander = lignes.filter((l) => !valeur(l).code_couleur_interne && l.couleur)

  return (
    <>
      <EnTetePage
        titre="Compléter les références"
        description="L'assistant lit le code de chaque référence et propose ce qu'il y reconnaît."
      />

      <Carte>
        <CarteEntete>
          <CarteTitre>
            <Sparkles className="mr-1.5 inline size-4 text-primaire" />
            Ce que l'assistant a trouvé
          </CarteTitre>
          <div className="flex items-center gap-2">
            <Selecteur
              value={filtre}
              onChange={(e) => setFiltre(e.target.value as 'a-completer' | 'tout')}
              className="h-7 text-[12px]"
            >
              <option value="a-completer">À compléter</option>
              <option value="tout">Toutes les références</option>
            </Selecteur>
            {droits.peutEcrire && (
              <Bouton
                taille="sm"
                onClick={() => enregistrer.mutate(sures)}
                disabled={sures.length === 0 || enregistrer.isPending}
              >
                <Wand2 className="mr-1 size-3.5" />
                Accepter les {sures.length} propositions
              </Bouton>
            )}
          </div>
        </CarteEntete>
        <CarteCorps className="space-y-3">
          {bilan && (
            <div className="flex flex-wrap gap-2 text-[12px]">
              <Badge ton="neutre">{bilan.references} référence(s)</Badge>
              <Badge ton="succes">{bilan.famille_sure} famille(s) déduite(s)</Badge>
              <Badge ton="succes">{bilan.couleur_sure} couleur(s) reconnue(s)</Badge>
              <Badge ton="succes">{bilan.reference_fournisseur_lue} réf. fournisseur lue(s)</Badge>
            </div>
          )}

          {/*
            CE QUE L'ASSISTANT NE SAIT PAS, dit en tête et non caché au fond du
            tableau : ces couleurs sont écrites sur les références mais absentes
            du référentiel interne. Personne d'autre que vous ne peut trancher
            si « Cream » est une couleur à créer ou le C5S existant.
          */}
          {aDemander.length > 0 && (
            <Alerte ton="alerte">
              <span className="font-semibold">{aDemander.length} référence(s) portent une couleur que le
              référentiel ne connaît pas</span> — par exemple{' '}
              {[...new Set(aDemander.map((l) => l.couleur))].slice(0, 6).join(', ')}. Créez-les dans
              Référentiels → Couleurs, ou choisissez la couleur interne équivalente ci-dessous.
            </Alerte>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'text-left')}>Référence</th>
                  <th className={cn(th, 'text-left')}>Famille</th>
                  <th className={cn(th, 'text-left')}>Couleur interne</th>
                  <th className={cn(th, 'text-left')}>Réf. fournisseur</th>
                  <th className={cn(th, 'text-left')}>Origine</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const v = valeur(l)
                  const propose = (c: keyof Saisie) =>
                    !l.actuel[c as keyof typeof l.actuel] &&
                    Boolean((l.propose as Record<string, unknown>)[c]) &&
                    v[c] === ((l.propose as Record<string, string | null>)[c] ?? '')
                  return (
                    <tr key={l.code_reference} className="border-b border-bordure/60">
                      <td className={cn(td, 'max-w-[22rem]')}>
                        <div className="truncate font-medium">{l.code_reference}</div>
                        <div className="text-[11px] text-attenue-texte">
                          {l.categorie_libelle} · {l.couleur || 'sans couleur'}
                          {l.titrage && ` · ${l.titrage}`}
                        </div>
                      </td>
                      <td className={td}>
                        <Selecteur
                          value={v.code_famille}
                          onChange={(e) => poser(l.code_reference, 'code_famille', e.target.value)}
                          className={cn(champ, 'w-48', propose('code_famille') && 'border-primaire')}
                        >
                          <option value="">— à choisir —</option>
                          {l.familles_possibles.map((f) => (
                            <option key={f.code} value={f.code}>
                              {f.libelle}
                              {f.titrage && ` (${f.titrage})`}
                            </option>
                          ))}
                        </Selecteur>
                      </td>
                      <td className={td}>
                        <Selecteur
                          value={v.code_couleur_interne}
                          onChange={(e) => poser(l.code_reference, 'code_couleur_interne', e.target.value)}
                          className={cn(champ, 'w-40', propose('code_couleur_interne') && 'border-primaire')}
                        >
                          <option value="">— à choisir —</option>
                          {couleurs.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} — {c.libelle}
                            </option>
                          ))}
                        </Selecteur>
                      </td>
                      <td className={td}>
                        <Champ
                          value={v.reference_fournisseur}
                          onChange={(e) => poser(l.code_reference, 'reference_fournisseur', e.target.value)}
                          placeholder="—"
                          className={cn(champ, 'w-32', propose('reference_fournisseur') && 'border-primaire')}
                        />
                      </td>
                      <td className={td}>
                        <Champ
                          value={v.origine}
                          onChange={(e) => poser(l.code_reference, 'origine', e.target.value)}
                          placeholder={l.couleur ? '' : 'à la place de la couleur'}
                          className={cn(champ, 'w-32')}
                        />
                      </td>
                      <td className={cn(td, 'text-right')}>
                        {droits.peutEcrire && (
                          <Bouton
                            taille="sm"
                            variante="contour"
                            onClick={() => enregistrer.mutate([l])}
                            disabled={enregistrer.isPending}
                          >
                            <Check className="size-3.5" />
                          </Bouton>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-attenue-texte">
                      Toutes les références sont complètes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CarteCorps>
      </Carte>
    </>
  )
}

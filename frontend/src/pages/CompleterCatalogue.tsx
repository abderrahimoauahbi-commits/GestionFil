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
    titrage: string
    code_couleur: string
    prix_catalogue: number | null
    poids_bobine_kg: number | null
    bobines_par_palette: number | null
    unite_catalogue: string
  }
  propose: {
    code_famille: string | null
    code_couleur_interne: string | null
    reference_fournisseur: string | null
    titrage: string | null
    code_couleur: string | null
    poids_bobine_kg: number | null
    bobines_par_palette: number | null
  }
  /** Ce qu'aucune deduction ne fournit : il faut aller le chercher. */
  manque: string[]
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
    sans_prix: number
    sans_conditionnement: number
    sans_code_couleur: number
  }
}

/** Ce qu'on s'apprête à écrire sur une référence. */
interface Saisie {
  code_famille: string
  code_couleur_interne: string
  reference_fournisseur: string
  origine: string
  /* LES INFORMATIONS CRITIQUES. Sans elles la référence existe mais ne sert à
     rien : on ne peut ni la commander (prix), ni la peser en bobines
     (conditionnement), ni la reconnaître sur une facture (code fournisseur). */
  titrage: string
  code_couleur: string
  prix_catalogue: string
  poids_bobine_kg: string
  bobines_par_palette: string
}

/** Le nom lisible d'un champ manquant, pour le dire à l'écran. */
const NOM_CHAMP: Record<string, string> = {
  prix_catalogue: 'prix',
  poids_bobine_kg: 'poids de bobine',
  bobines_par_palette: 'bobines par palette',
  code_couleur: 'code couleur du fournisseur',
  titrage: 'titrage',
}

/** Un nombre venu du serveur, tel qu'on le pose dans un champ de saisie. */
const texte = (n: number | null | undefined) => (n == null ? '' : String(n))

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1 align-top'
const champ = 'h-7 px-1.5 text-[12.5px]'

function valeurDepart(l: LigneCompletion): Saisie {
  return {
    code_famille: l.actuel.code_famille ?? l.propose.code_famille ?? '',
    code_couleur_interne: l.actuel.code_couleur_interne ?? l.propose.code_couleur_interne ?? '',
    reference_fournisseur: l.actuel.reference_fournisseur || l.propose.reference_fournisseur || '',
    origine: l.actuel.origine ?? '',
    titrage: l.actuel.titrage || l.propose.titrage || '',
    code_couleur: l.actuel.code_couleur || l.propose.code_couleur || '',
    prix_catalogue: texte(l.actuel.prix_catalogue),
    poids_bobine_kg: texte(l.actuel.poids_bobine_kg ?? l.propose.poids_bobine_kg),
    bobines_par_palette: texte(l.actuel.bobines_par_palette ?? l.propose.bobines_par_palette),
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
        /* UN CHAMP VIDE N'EFFACE JAMAIS : on n'envoie que ce qui est renseigné.
           Accepter un lot ne peut donc pas vider ce qu'une autre main a saisi. */
        if (v.titrage) charge.titrage = v.titrage
        if (v.code_couleur) charge.code_couleur = v.code_couleur
        if (v.prix_catalogue) charge.prix_catalogue = v.prix_catalogue
        if (v.poids_bobine_kg) charge.poids_bobine_kg = v.poids_bobine_kg
        if (v.bobines_par_palette) charge.bobines_par_palette = v.bobines_par_palette
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
      (v.reference_fournisseur && !l.actuel.reference_fournisseur) ||
      (v.titrage && !l.actuel.titrage) ||
      (v.code_couleur && !l.actuel.code_couleur) ||
      (v.poids_bobine_kg && l.actuel.poids_bobine_kg == null) ||
      (v.bobines_par_palette && l.actuel.bobines_par_palette == null)
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
              {/* CE QUI RESTE A ALLER CHERCHER. Un prix ne se déduit pas d'une
                  référence voisine : le proposer donnerait un coût de revient
                  faux, et c'est exactement le repli silencieux que RG-08
                  interdit. On le compte, on ne l'invente pas. */}
              {bilan.sans_prix > 0 && (
                <Badge ton="alerte">{bilan.sans_prix} sans prix</Badge>
              )}
              {bilan.sans_conditionnement > 0 && (
                <Badge ton="alerte">
                  {bilan.sans_conditionnement} sans conditionnement
                </Badge>
              )}
              {bilan.sans_code_couleur > 0 && (
                <Badge ton="alerte">
                  {bilan.sans_code_couleur} sans code couleur fournisseur
                </Badge>
              )}
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
                  <th className={cn(th, 'text-left')}>Titrage</th>
                  <th className={cn(th, 'text-left')}>Code couleur frs</th>
                  <th className={cn(th, 'text-right')}>Prix</th>
                  <th className={cn(th, 'text-right')}>Poids bob.</th>
                  <th className={cn(th, 'text-right')}>Bob./pal.</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const v = valeur(l)
                  /* UNE VALEUR EST « PROPOSEE » quand la référence ne la
                     portait pas, que l'assistant en a trouvé une, et qu'on ne
                     l'a pas encore corrigée à la main. Le cadre bleu ne dit pas
                     « juste » : il dit « déduit, à vérifier ». */
                  const propose = (c: keyof Saisie) => {
                    const actuel = (l.actuel as Record<string, unknown>)[c]
                    const suggere = (l.propose as Record<string, unknown>)[c]
                    if (actuel != null && actuel !== '') return false
                    if (suggere == null || suggere === '') return false
                    return v[c] === String(suggere)
                  }
                  return (
                    <tr key={l.code_reference} className="border-b border-bordure/60">
                      <td className={cn(td, 'max-w-[22rem]')}>
                        <div className="truncate font-medium">{l.code_reference}</div>
                        <div className="text-[11px] text-attenue-texte">
                          {l.categorie_libelle} · {l.couleur || 'sans couleur'}
                          {l.titrage && ` · ${l.titrage}`}
                        </div>
                        {/* CE QUI MANQUE, DIT EN TOUTES LETTRES. Un cadre rouge
                            signale la case ; il ne dit pas de quoi il s'agit
                            quand la colonne est hors de l'écran. */}
                        {l.manque.length > 0 && (
                          <div className="text-[11px] text-danger">
                            manque : {l.manque.map((m) => NOM_CHAMP[m] ?? m).join(', ')}
                          </div>
                        )}
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
                      <td className={td}>
                        <Champ
                          value={v.titrage}
                          onChange={(e) => poser(l.code_reference, 'titrage', e.target.value)}
                          placeholder="1500 dtex"
                          className={cn(champ, 'w-28', propose('titrage') && 'border-primaire')}
                        />
                      </td>
                      <td className={td}>
                        <Champ
                          value={v.code_couleur}
                          onChange={(e) => poser(l.code_reference, 'code_couleur', e.target.value)}
                          placeholder="RED 7612"
                          className={cn(champ, 'w-28', propose('code_couleur') && 'border-primaire')}
                        />
                      </td>
                      {/* LE PRIX NE SE DEDUIT PAS : il se lit sur une offre ou
                          une facture. Le champ reste vide et se signale en
                          rouge, plutot que de porter une valeur inventee. */}
                      <td className={td}>
                        <Champ
                          type="number"
                          step="any"
                          min="0"
                          value={v.prix_catalogue}
                          onChange={(e) => poser(l.code_reference, 'prix_catalogue', e.target.value)}
                          className={cn(
                            champ,
                            'w-24 text-right tabular-nums',
                            l.manque.includes('prix_catalogue') && 'border-danger',
                          )}
                        />
                      </td>
                      <td className={td}>
                        <Champ
                          type="number"
                          step="any"
                          min="0"
                          value={v.poids_bobine_kg}
                          onChange={(e) => poser(l.code_reference, 'poids_bobine_kg', e.target.value)}
                          className={cn(
                            champ,
                            'w-20 text-right tabular-nums',
                            propose('poids_bobine_kg') && 'border-primaire',
                            l.manque.includes('poids_bobine_kg') && 'border-danger',
                          )}
                        />
                      </td>
                      <td className={td}>
                        <Champ
                          type="number"
                          min="0"
                          value={v.bobines_par_palette}
                          onChange={(e) =>
                            poser(l.code_reference, 'bobines_par_palette', e.target.value)
                          }
                          className={cn(
                            champ,
                            'w-20 text-right tabular-nums',
                            propose('bobines_par_palette') && 'border-primaire',
                            l.manque.includes('bobines_par_palette') && 'border-danger',
                          )}
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

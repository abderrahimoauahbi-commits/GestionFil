/**
 * La fiche d'une qualite sur papier : entete, densites par role, composition.
 *
 * C'EST LA RECETTE ELLE-MEME. Une qualite et sa recette ne font qu'un dans
 * cette usine : le document qui descend a l'atelier porte les densites par role
 * et les pourcentages de chaque matiere. Un etat separe « recette » aurait
 * imprime les memes lignes sans leur entete, donc sans le poids au metre carre
 * qui leur donne un sens.
 *
 * LE POIDS AU M2 EST RECALCULE, PAS RECOPIE. Il vient de la vue
 * `v_recette_calculee` — densite du role multipliee par le pourcentage, et par
 * la densite kg/ml quand le role se compte en metres lineaires. L'imprimer
 * depuis une colonne stockee ferait risquer un document qui ne correspond plus
 * a la composition d'a cote.
 */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Chargement } from '../composants/ui/base'
import { fmt } from '../components/ui'

interface Qualite {
  code_qualite: string
  nom: string
  statut: string
  largeur_m?: number | null
  hauteur_poil_mm?: number | null
  densite_points_m2?: number | null
  taux_perte_pct?: number | null
  date_modification?: string | null
  [k: string]: unknown
}

interface LigneRole {
  code_role: string
  role_libelle: string | null
  densite: number
  unite_densite: string
  [k: string]: unknown
}

interface LigneCompo {
  code_reference: string
  designation: string | null
  code_role: string
  role_libelle: string | null
  pourcentage_composition: number
  densite_role: number | null
  unite_densite: string | null
  kg_m2: number | null
  couleur?: string | null
  [k: string]: unknown
}

export function QualiteEtat() {
  const { code } = useParams<{ code: string }>()

  const qQualite = useQuery({
    queryKey: ['qualites'],
    queryFn: () => api.get<Qualite[]>('/api/qualites?limite=500'),
  })
  const qLignes = useQuery({
    queryKey: ['ligne-qualite', code],
    queryFn: () => api.get<LigneRole[]>(`/api/qualites/${encodeURIComponent(code!)}/densites`),
    enabled: !!code,
  })
  const qCompo = useQuery({
    queryKey: ['recette-calculee', code],
    queryFn: () =>
      api.get<LigneCompo[]>(`/api/recettes?code_qualite=${encodeURIComponent(code!)}&limite=500`),
    enabled: !!code,
  })

  if (qQualite.isLoading || qLignes.isLoading || qCompo.isLoading) {
    return <Chargement texte="Preparation de la fiche…" />
  }

  const brut = qQualite.data
  const liste = Array.isArray(brut) ? brut : ((brut as unknown as { lignes?: Qualite[] })?.lignes ?? [])
  const q = liste.find((x) => x.code_qualite === code)
  if (!q) return <Alerte ton="danger">Qualite introuvable.</Alerte>

  const roles = qLignes.data ?? []
  const compo = [...(qCompo.data ?? [])].sort(
    (a, b) =>
      (a.role_libelle ?? a.code_role).localeCompare(b.role_libelle ?? b.code_role) ||
      b.pourcentage_composition - a.pourcentage_composition,
  )

  /* Le poids commercial ne retient que les roles exprimes en kg/m2. Un role en
     ml/m2 contribue au kg/m2 de sa ligne mais pas au poids annonce au client —
     c'est la regle du classeur, conservee telle quelle. */
  const poidsCommercial = roles
    .filter((r) => r.unite_densite === 'kg_m2')
    .reduce((s, r) => s + r.densite, 0)

  const totalKgM2 = compo.reduce((s, l) => s + (l.kg_m2 ?? 0), 0)

  /* La somme par role : c'est ce qui doit valoir 100 %, et l'imprime doit le
     montrer sur le papier — celui qui lit la fiche a l'atelier n'a pas l'ecran
     de controle sous les yeux. */
  const sommes = new Map<string, number>()
  for (const l of compo) {
    sommes.set(l.code_role, (sommes.get(l.code_role) ?? 0) + l.pourcentage_composition)
  }

  return (
    <EtatImprimable
      titre="Fiche qualite"
      reference={q.code_qualite}
      sousTitre={q.statut !== 'ACTIF' ? `Statut : ${q.statut}` : undefined}
      enTete={
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          <div className="space-y-1">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
              Qualite
            </div>
            <div className="text-[13px] font-semibold">{q.nom}</div>
            {q.largeur_m != null && (
              <div className="text-[10px]">
                <span className="text-neutral-600">Largeur : </span>
                {fmt.nombre(q.largeur_m, 2)} m
              </div>
            )}
            {q.hauteur_poil_mm != null && (
              <div className="text-[10px]">
                <span className="text-neutral-600">Hauteur de poil : </span>
                {fmt.nombre(q.hauteur_poil_mm, 1)} mm
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
              Poids
            </div>
            <div className="text-[10px]">
              <span className="text-neutral-600">Poids commercial : </span>
              <span className="font-semibold">{fmt.nombre(poidsCommercial, 4)} kg/m²</span>
            </div>
            <div className="text-[10px]">
              <span className="text-neutral-600">Total composition : </span>
              <span className="font-semibold">{fmt.nombre(totalKgM2, 4)} kg/m²</span>
            </div>
            {q.taux_perte_pct != null && (
              <div className="text-[10px]">
                <span className="text-neutral-600">Taux de perte : </span>
                {fmt.nombre(q.taux_perte_pct, 2)} %
              </div>
            )}
          </div>
        </div>
      }
    >
      {/* --- Densites par role -------------------------------------------- */}
      <h3 className="mb-1 mt-1 border-b border-neutral-400 pb-0.5 text-[10px] font-bold uppercase tracking-wide">
        Densites par role
      </h3>
      <TableEtat<LigneRole>
        colonnes={[
          { entete: 'Role', valeur: (r) => r.role_libelle ?? r.code_role },
          { entete: 'Densite', numerique: true, valeur: (r) => fmt.nombre(r.densite, 4) },
          { entete: 'Unite', valeur: (r) => (r.unite_densite === 'kg_m2' ? 'kg/m²' : 'ml/m²') },
          {
            entete: 'Somme composition',
            numerique: true,
            valeur: (r) => {
              const s = sommes.get(r.code_role) ?? 0
              // Le verdict est porte sur la ligne du role : c'est la qu'on
              // regarde quand on cherche pourquoi une qualite ne passe pas.
              return `${fmt.nombre(s, 1)} %${Math.abs(s - 100) > 0.5 ? '  ANOMALIE' : ''}`
            },
          },
        ]}
        lignes={roles}
      />

      {/* --- Composition ---------------------------------------------------- */}
      <h3 className="mb-1 mt-5 border-b border-neutral-400 pb-0.5 text-[10px] font-bold uppercase tracking-wide">
        Composition — {compo.length} ligne(s)
      </h3>
      <TableEtat<LigneCompo>
        colonnes={[
          { entete: 'Role', valeur: (l) => l.role_libelle ?? l.code_role },
          {
            entete: 'Reference',
            valeur: (l) => (
              <>
                <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                {l.designation && (
                  <div className="text-[9px] text-neutral-600">{l.designation}</div>
                )}
              </>
            ),
          },
          { entete: 'Couleur', valeur: (l) => l.couleur ?? '' },
          {
            entete: '%',
            numerique: true,
            valeur: (l) => fmt.nombre(l.pourcentage_composition, 2),
          },
          {
            entete: 'kg/m²',
            numerique: true,
            valeur: (l) => (l.kg_m2 == null ? '—' : fmt.nombre(l.kg_m2, 6)),
          },
        ]}
        lignes={compo}
        total={['', `${compo.length} ligne(s)`, '', '', fmt.nombre(totalKgM2, 6)]}
      />

      <div className="mt-8 grid grid-cols-2 gap-8">
        {['Etabli par', 'Approuve par'].map((r) => (
          <div key={r}>
            <div className="mb-10 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
              {r}
            </div>
            <div className="border-t border-neutral-500 pt-1 text-[9px] text-neutral-600">
              Nom, date et signature
            </div>
          </div>
        ))}
      </div>
    </EtatImprimable>
  )
}

/**
 * Compositions — vue transversale.
 *
 * Depuis qu'une qualite = une composition, il n'y a plus de recette a gerer pour
 * elle-meme : la composition se saisit dans le document de la qualite. Reste une
 * question qu'aucun ecran de qualite ne peut traiter, parce qu'il ne montre
 * qu'un article a la fois :
 *
 *     ou cette matiere est-elle employee ?
 *
 * C'est ce que fait cet ecran. Toutes les lignes de composition, tous articles
 * confondus, filtrables par matiere, par role ou par qualite. On y va avant de
 * cloturer une reference, de changer de fournisseur, ou pour comprendre quelles
 * qualites un incident matiere va toucher.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers, Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Badge, Bouton, Carte, CarteCorps } from '../composants/ui/base'
import { fmt } from '../lib/utils'

const MODULE = 'RECETTES'

interface Ligne extends Record<string, unknown> {
  code_qualite: string
  qualite_nom: string
  statut_qualite: string
  ligne_numero: number
  code_reference: string
  designation: string
  code_role: string
  role_libelle: string
  pourcentage_composition: number
  couleur: string | null
  code_groupe_equiv: string | null
  densite_role: number
  unite_densite: string
  kg_m2: number | null
  code_fournisseur: string
  fournisseur: string
}

const TON_STATUT: Record<string, 'neutre' | 'succes' | 'contour'> = {
  BROUILLON: 'neutre',
  ACTIF: 'succes',
  CLOTURE: 'contour',
}

export function Recettes() {
  const q = useQuery({
    queryKey: ['compositions'],
    queryFn: () => api.get<Ligne[]>('/api/recettes'),
  })

  const lignes = q.data ?? []

  /** Quelques reperes de volume, calcules sur ce qui est charge. */
  const stats = useMemo(() => {
    const qualites = new Set(lignes.map((l) => l.code_qualite))
    const refs = new Set(lignes.map((l) => l.code_reference))
    const actives = new Set(
      lignes.filter((l) => l.statut_qualite === 'ACTIF').map((l) => l.code_qualite),
    )
    return { qualites: qualites.size, refs: refs.size, actives: actives.size }
  }, [lignes])

  const colonnes: ColonneDT<Ligne>[] = [
    {
      champ: 'code_qualite',
      entete: 'Qualite',
      largeur: '190px',
      filtre: 'liste',
      rendu: (l) => (
        <div className="min-w-0">
          <Link
            to="/qualites"
            className="font-medium hover:underline"
            title="Ouvrir les qualites"
          >
            {l.code_qualite}
          </Link>
          <span className="ml-1.5 text-[11px] text-attenue-texte">{l.qualite_nom}</span>
        </div>
      ),
    },
    {
      champ: 'statut_qualite',
      entete: 'Statut',
      largeur: '105px',
      filtre: 'liste',
      rendu: (l) => (
        <Badge ton={TON_STATUT[l.statut_qualite] ?? 'neutre'}>{l.statut_qualite}</Badge>
      ),
    },
    {
      champ: 'code_role',
      entete: 'Role BOM',
      largeur: '130px',
      filtre: 'liste',
      valeurTri: (l) => l.code_role,
      rendu: (l) => l.role_libelle,
    },
    {
      champ: 'code_reference',
      entete: 'Reference',
      filtre: 'texte',
      rendu: (l) => (
        <div className="min-w-0">
          <span className="font-medium">{l.code_reference}</span>
          <span className="ml-1.5 text-[11px] text-attenue-texte">{l.designation}</span>
        </div>
      ),
    },
    {
      champ: 'fournisseur',
      entete: 'Fournisseur',
      largeur: '160px',
      filtre: 'liste',
      secondaire: true,
    },
    {
      champ: 'pourcentage_composition',
      entete: '%',
      numerique: true,
      largeur: '90px',
      rendu: (l) => fmt.nombre(l.pourcentage_composition, 2),
    },
    {
      champ: 'densite_role',
      entete: 'Densite',
      numerique: true,
      largeur: '120px',
      secondaire: true,
      rendu: (l) => (
        <span>
          {fmt.nombre(l.densite_role, 3)}
          <span className="ml-1 text-[11px] text-attenue-texte">
            {l.unite_densite === 'ml_m2' ? 'ml/m²' : 'kg/m²'}
          </span>
        </span>
      ),
    },
    {
      champ: 'kg_m2',
      entete: 'kg/m²',
      numerique: true,
      largeur: '110px',
      rendu: (l) => (l.kg_m2 === null ? '—' : fmt.nombre(l.kg_m2, 5)),
    },
    {
      champ: 'couleur',
      entete: 'Couleur',
      largeur: '120px',
      secondaire: true,
      rendu: (l) => fmt.texte(l.couleur),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Compositions"
        description="Toutes les lignes de composition, tous articles confondus : ou telle matiere est-elle employee ?"
        actions={
          <Bouton variante="contour" asChild>
            <Link to="/qualites">
              <Layers />
              Modifier une qualite
            </Link>
          </Bouton>
        }
      />

      <Carte className="mb-3">
        <CarteCorps className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] text-attenue-texte">
          <span>
            <span className="font-semibold tabular-nums text-texte">{lignes.length}</span> ligne(s)
            de composition
          </span>
          <span>
            <span className="font-semibold tabular-nums text-texte">{stats.qualites}</span>{' '}
            qualite(s), dont{' '}
            <span className="font-semibold tabular-nums text-texte">{stats.actives}</span> active(s)
          </span>
          <span>
            <span className="font-semibold tabular-nums text-texte">{stats.refs}</span>{' '}
            reference(s) employee(s)
          </span>
          <span className="ml-auto">
            La composition se modifie dans le document de la qualite : une qualite = une
            composition.
          </span>
        </CarteCorps>
      </Carte>

      <DataTable
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        chargement={q.isLoading}
        cle={(l) => `${l.code_qualite}|${l.ligne_numero}`}
        placeholderRecherche="Qualite, reference, designation, role..."
        titreCarte={(l) => `${l.code_qualite} · ${l.code_reference}`}
        tailleParDefaut={50}
        hauteurMax="65vh"
        videTitre="Aucune composition"
        videDescription="Definissez la composition d'une qualite pour qu'elle apparaisse ici."
        videAction={
          <Bouton asChild>
            <Link to="/qualites">
              <Package />
              Aller aux qualites
            </Link>
          </Bouton>
        }
      />
    </div>
  )
}

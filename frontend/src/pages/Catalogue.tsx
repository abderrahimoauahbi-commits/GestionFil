/**
 * Catalogue des matieres premieres : consultation et saisie.
 *
 * Demonstration concrete de la grille de droits : les colonnes de prix
 * n'existent pas pour un magasinier — ni en-tete, ni cellule, ni donnee dans la
 * reponse du serveur — et le formulaire les masque de la meme facon.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers, PackageX } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EcranReferentiel } from '../components/EcranReferentiel'
import type { ChampDef } from '../components/Formulaire'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import type { Colonne } from '../components/TableDroits'
import { Etiquette, Message, fmt } from '../components/ui'

const MODULE = 'CATALOGUE'

interface Reference extends Record<string, unknown> {
  code_reference: string
  designation: string
  categorie_libelle: string
  fournisseur_nom: string
  couleur: string | null
  unite_catalogue: string
  facteur_kg: number | null
  prix_catalogue?: number
  code_devise_catalogue?: string
  cmup_mad?: number | null
  stock_min_kg: number | null
  stock_total_kg: number
  classe_abc: string | null
  classe_xyz: string | null
  actif: number
}

export function Catalogue() {
  const droits = useDroits(MODULE)
  const [categorie, setCategorie] = useState('')

  // Le catalogue entier, uniquement pour COMPTER par categorie. La liste
  // affichee reste servie par EcranReferentiel, qui gere tri, pagination et
  // droits ; la dupliquer ici ferait diverger les deux affichages.
  const qToutes = useQuery({
    queryKey: ['catalogue-comptes'],
    queryFn: () =>
      api.get<{ code_categorie: string | null; actif: number }[]>(
        '/api/catalogue?actif=1&limite=2000',
      ),
  })

  const qCat = useQuery({
    queryKey: ['categories', ''],
    queryFn: () => api.get<{ code_categorie: string; libelle: string }[]>('/api/categories?actif=1'),
  })
  const qFour = useQuery({
    queryKey: ['fournisseurs', ''],
    queryFn: () => api.get<{ code_fournisseur: string; nom: string }[]>('/api/fournisseurs?actif=1'),
  })
  const qDev = useQuery({
    queryKey: ['devises'],
    queryFn: () => api.get<{ code_devise: string; libelle: string }[]>('/api/devises'),
  })

  const colonnes: Colonne<Reference>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (r) => (
        <div>
          <div className="font-medium text-texte">{r.code_reference}</div>
          {r.actif === 0 && <Etiquette ton="rouge">desactivee</Etiquette>}
        </div>
      ),
    },
    { champ: 'code_categorie', entete: 'Categorie', rendu: (r) => r.categorie_libelle },
    { champ: 'fournisseur_nom', entete: 'Fournisseur', rendu: (r) => r.fournisseur_nom },
    { champ: 'couleur', entete: 'Couleur', rendu: (r) => fmt.texte(r.couleur), secondaire: true },
    {
      champ: 'unite_catalogue',
      entete: 'Unite',
      rendu: (r) => (
        <span title={r.facteur_kg ? `1 ${r.unite_catalogue} = ${r.facteur_kg} kg` : undefined}>
          {r.unite_catalogue}
        </span>
      ),
    },
    {
      champ: 'prix_catalogue',
      entete: 'Prix',
      numerique: true,
      rendu: (r) =>
        r.prix_catalogue === undefined
          ? '—'
          : `${fmt.nombre(r.prix_catalogue, 3)} ${r.code_devise_catalogue ?? ''}`,
    },
    {
      champ: 'cmup_mad',
      entete: 'CMUP',
      numerique: true,
      rendu: (r) => (r.cmup_mad == null ? '—' : fmt.mad(r.cmup_mad)),
    },
    {
      champ: 'quantite_kg',
      entete: 'Stock (kg)',
      numerique: true,
      rendu: (r) => fmt.nombre(r.stock_total_kg, 1),
    },
    {
      champ: 'stock_min_kg',
      entete: 'Stock min.',
      numerique: true,
      secondaire: true,
      rendu: (r) =>
        r.stock_min_kg == null ? (
          <span className="text-attenue-texte" title="Calcule dynamiquement (formule F3)">
            dynamique
          </span>
        ) : (
          fmt.nombre(r.stock_min_kg, 0)
        ),
    },
    {
      champ: 'classe_abc',
      entete: 'ABC',
      rendu: (r) =>
        r.classe_abc ? (
          <Etiquette ton={r.classe_abc === 'A' ? 'rouge' : r.classe_abc === 'B' ? 'ambre' : 'gris'}>
            {r.classe_abc}
            {r.classe_xyz ?? ''}
          </Etiquette>
        ) : (
          '—'
        ),
    },
  ]

  const champs: ChampDef[] = [
    {
      champ: 'code_reference',
      libelle: 'Reference',
      obligatoire: true,
      cleCreation: true,
      pleineLargeur: true,
      aide: 'Identifiant cite par les recettes et les mouvements : il ne pourra plus etre change.',
    },
    { champ: 'designation', libelle: 'Designation', obligatoire: true, pleineLargeur: true },
    {
      champ: 'code_categorie',
      libelle: 'Categorie matiere',
      type: 'liste',
      obligatoire: true,
      options: qCat.data?.map((c) => ({ valeur: c.code_categorie, libelle: c.libelle })),
    },
    {
      champ: 'code_fournisseur',
      libelle: 'Fournisseur',
      type: 'liste',
      obligatoire: true,
      options: qFour.data?.map((f) => ({ valeur: f.code_fournisseur, libelle: f.nom })),
    },
    { champ: 'type_fil', libelle: 'Nature' },
    { champ: 'couleur', libelle: 'Couleur' },
    { champ: 'titrage', libelle: 'Titrage' },
    {
      champ: 'unite_catalogue',
      libelle: 'Unite de stock',
      type: 'liste',
      obligatoire: true,
      options: [
        { valeur: 'kg', libelle: 'Kilogramme' },
        { valeur: 'Bobine', libelle: 'Bobine' },
        { valeur: 'Palette', libelle: 'Palette' },
        { valeur: 'ml', libelle: 'Metre lineaire' },
      ],
      aide: 'Le stock reste tenu en kg ; les autres unites sont des masques de saisie.',
    },
    {
      champ: 'poids_bobine_kg',
      libelle: 'Poids par bobine (kg)',
      type: 'nombre',
      aide: 'Obligatoire pour une unite Bobine ou Palette.',
    },
    { champ: 'bobines_par_palette', libelle: 'Bobines par palette', type: 'entier' },
    {
      champ: 'densite_kg_ml',
      libelle: 'Densite (kg/ml)',
      type: 'nombre',
      aide: 'Obligatoire pour une unite ml : sans elle, la conversion est refusee.',
    },
    { champ: 'prix_catalogue', libelle: 'Prix par unite', type: 'nombre', obligatoire: true },
    {
      champ: 'code_devise_catalogue',
      libelle: 'Devise',
      type: 'liste',
      obligatoire: true,
      options: qDev.data?.map((d) => ({ valeur: d.code_devise, libelle: d.code_devise })),
    },
    {
      champ: 'stock_min_kg',
      libelle: 'Stock minimum (kg)',
      type: 'nombre',
      aide: 'Laisser vide pour un minimum calcule dynamiquement (formule F3).',
    },
    { champ: 'couverture_min_mois', libelle: 'Couverture minimale (mois)', type: 'nombre' },
    {
      champ: 'marge_securite_pct',
      libelle: 'Marge de securite (%)',
      type: 'nombre',
      aide:
        'Majore le stock minimum de cette reference. Vide : la valeur generale des parametres ' +
        's applique.',
    },
    {
      champ: 'date_prix_catalogue',
      libelle: 'Date du prix catalogue',
      type: 'date',
      aide:
        'Depuis quand ce tarif est annonce. Un prix sans date ne dit pas s il date du mois ' +
        'dernier ou de trois ans.',
    },
    { champ: 'moq_kg', libelle: 'Quantite minimale de commande (kg)', type: 'nombre' },
    { champ: 'multiple_achat_kg', libelle: 'Multiple d achat (kg)', type: 'nombre' },
    {
      champ: 'suivi_lot',
      libelle: 'Suivi par lot',
      type: 'booleen',
      aide: 'Rend le lot obligatoire sur chaque mouvement. Determinant quand le bain de teinture conditionne la nuance.',
    },
    { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
  ]

  const comptes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of qToutes.data ?? []) {
      const c = r.code_categorie ?? '—'
      m[c] = (m[c] ?? 0) + 1
    }
    return m
  }, [qToutes.data])

  const total = (qToutes.data ?? []).length

  const groupes: GroupeRail[] = [
    {
      entrees: [
        {
          cle: '',
          libelle: 'Tout le catalogue',
          resume: 'Sans filtre',
          Icone: Layers,
          compte: total,
        },
      ],
    },
    {
      titre: 'Par categorie matiere',
      entrees: [
        ...(qCat.data ?? []).map((c) => ({
          cle: c.code_categorie,
          libelle: c.libelle,
          compte: comptes[c.code_categorie] ?? 0,
          // Une categorie vide n'est pas une erreur, mais elle merite d'etre
          // vue : c'est souvent une categorie creee et jamais servie.
          ton: (comptes[c.code_categorie] ?? 0) === 0 ? ('alerte' as const) : ('neutre' as const),
        })),
        ...(comptes['—']
          ? [
              {
                cle: '—',
                libelle: 'Sans categorie',
                resume: 'A rattacher',
                Icone: PackageX,
                compte: comptes['—'],
                ton: 'danger' as const,
              },
            ]
          : []),
      ],
    },
  ]

  return (
    <>
      {!droits.visible('prix_catalogue') && (
        <div className="mb-4">
          <Message ton="info">Les informations de prix sont masquees pour votre profil.</Message>
        </div>
      )}

      <PageAvecRail
        rail={<RailLateral groupes={groupes} actif={categorie} surChoix={setCategorie} />}
      >
        <EcranReferentiel<Reference>
          // Remonter la categorie dans la cle force le rechargement : sans cela,
          // l'ecran garderait la liste precedente en changeant de filtre.
          key={categorie}
          titre="Catalogue"
          module={MODULE}
          chemin="catalogue"
          cle="code_reference"
          colonnes={colonnes}
          champs={champs}
          filtres={categorie && categorie !== '—' ? { code_categorie: categorie } : undefined}
          libelleUnite="reference"
          titreCarte={(r) => r.code_reference}
        />
      </PageAvecRail>
    </>
  )
}

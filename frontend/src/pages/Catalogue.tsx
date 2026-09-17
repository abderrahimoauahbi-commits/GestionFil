/**
 * Catalogue des matieres premieres : consultation et saisie.
 *
 * Demonstration concrete de la grille de droits : les colonnes de prix
 * n'existent pas pour un magasinier — ni en-tete, ni cellule, ni donnee dans la
 * reponse du serveur — et le formulaire les masque de la meme facon.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Filter, FilterX, Trash2 } from 'lucide-react'
import { MenuElement, useConfirmation } from '../composants/ui/surcouches'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EcranReferentiel } from '../components/EcranReferentiel'
import { useParamVue } from '../lib/navigation'
import type { ChampDef } from '../components/Formulaire'
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
  const [fournisseur, setFournisseur] = useState('')
  const [unite, setUnite] = useState('')
  const [actif, setActif] = useState('1')
  // Arrivee ciblee : `/catalogue?reference=X` pose la recherche sur X.
  const refDemandee = useParamVue('reference')

  // Le catalogue entier, uniquement pour COMPTER par categorie. La liste
  // affichee reste servie par EcranReferentiel, qui gere tri, pagination et
  // droits ; la dupliquer ici ferait diverger les deux affichages.
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
  // La famille et la couleur interne : deux references qui les partagent sont
  // le meme fil chez deux fournisseurs.
  const qFam = useQuery({
    queryKey: ['familles', ''],
    queryFn: () => api.get<{ code_famille: string; libelle: string }[]>('/api/familles?actif=1'),
  })
  const qCoul = useQuery({
    queryKey: ['couleurs', ''],
    queryFn: () =>
      api.get<{ code_couleur_interne: string; libelle: string }[]>('/api/couleurs?actif=1'),
  })

  const colonnes: Colonne<Reference>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      filtre: 'texte',
      rendu: (r) => (
        <div>
          <div className="font-medium text-texte">{r.code_reference}</div>
          {r.actif === 0 && <Etiquette ton="rouge">desactivee</Etiquette>}
        </div>
      ),
    },
    { champ: 'code_categorie', entete: 'Catégorie', filtre: 'liste', rendu: (r) => r.categorie_libelle },
    {
      // LE ROLE VIENT DE LA CATEGORIE — Poil, Trame, Chaîne, Colle… : c'est la
      // place normale de la matiere dans la composition. Le serveur ne trie que
      // sur les colonnes de la fiche, d'ou l'absence de tri.
      champ: 'code_role_defaut',
      entete: 'Rôle',
      triable: false,
      rendu: (r) => fmt.texte(r.role_libelle ?? r.code_role_defaut),
    },
    { champ: 'fournisseur_nom', entete: 'Fournisseur', filtre: 'liste', rendu: (r) => r.fournisseur_nom },
    { champ: 'couleur', entete: 'Couleur', filtre: 'liste', rendu: (r) => fmt.texte(r.couleur), secondaire: true },
    {
      champ: 'code_couleur_interne',
      entete: 'Couleur interne',
      filtre: 'liste',
      rendu: (r) => fmt.texte(r.code_couleur_interne),
      secondaire: true,
    },
    {
      champ: 'code_famille',
      entete: 'Famille',
      filtre: 'liste',
      rendu: (r) => fmt.texte(r.famille_libelle ?? r.code_famille),
      secondaire: true,
    },
    {
      champ: 'reference_fournisseur',
      entete: 'Ref. fournisseur',
      rendu: (r) => fmt.texte(r.reference_fournisseur),
      secondaire: true,
    },
    {
      champ: 'unite_catalogue',
      entete: 'Unité',
      filtre: 'liste',
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
      // L'UNITE EST ECRITE. « 2,500 USD » a cote d'un CMUP au kg laissait croire
      // a une erreur de calcul sur les references vendues au metre.
      rendu: (r) =>
        r.prix_catalogue === undefined
          ? '—'
          : `${fmt.nombre(r.prix_catalogue, 3)} ${r.code_devise_catalogue ?? ''}/${r.unite_catalogue}`,
    },
    {
      champ: 'cmup_mad',
      entete: 'CMUP',
      numerique: true,
      // LE CMUP DANS L'UNITE D'ACHAT. La base le tient au kg — le stock se
      // compte en kg —, mais la Bande s'achete au metre : 4 635,20 MAD/kg ne se
      // compare a rien, 23,18 MAD/ml se compare au prix. Le kg reste en infobulle.
      rendu: (r) => {
        if (r.cmup_mad == null) return '—'
        if (r.unite_catalogue !== 'kg' && r.facteur_kg) {
          return (
            <span title={`soit ${fmt.nombre(r.cmup_mad, 2)} MAD/kg (1 ${r.unite_catalogue} = ${r.facteur_kg} kg)`}>
              {fmt.nombre(r.cmup_mad * r.facteur_kg, 4)} MAD/{r.unite_catalogue}
            </span>
          )
        }
        return `${fmt.nombre(r.cmup_mad, 2)} MAD/kg`
      },
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
      filtre: 'liste',
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
      libelle: 'Référence',
      obligatoire: true,
      cleCreation: true,
      pleineLargeur: true,
      aide: 'Identifiant cité par les recettes et les mouvements : il ne pourra plus être changé.',
    },
    { champ: 'designation', libelle: 'Designation', obligatoire: true, pleineLargeur: true },
    {
      champ: 'description_commerciale',
      libelle: 'Description commerciale (anglais)',
      pleineLargeur: true,
      aide:
        'Ce que le fournisseur lit sur le bon de commande : « 100% POLYPROPYLENE YARN 2900 ' +
        'DTEX ». Notre code interne ne lui dit rien. Laissée vide, la désignation part à sa ' +
        'place — au risque qu’il ne la reconnaisse pas.',
    },
    {
      champ: 'code_categorie',
      libelle: 'Catégorie matiere',
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
    {
      champ: 'origine',
      libelle: 'Origine',
      aide: "Quand la matiere n'a pas de couleur — jute, colle, plastique, cuir — c'est la "
        + "provenance qui prend sa place dans le nom de la reference.",
    },
    { champ: 'titrage', libelle: 'Titrage' },
    {
      champ: 'code_famille',
      libelle: 'Famille',
      type: 'liste',
      options: qFam.data?.map((f) => ({ valeur: f.code_famille, libelle: f.libelle })),
      aide: 'Le produit independamment du vendeur. Deux references de meme famille et de meme '
        + 'couleur interne sont le meme fil, chez deux fournisseurs differents.',
    },
    {
      champ: 'code_couleur_interne',
      libelle: 'Couleur interne',
      type: 'liste',
      options: qCoul.data?.map((c) => ({
        valeur: c.code_couleur_interne,
        libelle: `${c.code_couleur_interne} — ${c.libelle}`,
      })),
      aide: 'Votre code couleur, commun a tous les fournisseurs (C1, C3, CG…).',
    },
    {
      champ: 'reference_fournisseur',
      libelle: 'Reference fournisseur',
      aide: "La reference telle que le fournisseur l'ecrit sur sa facture : « GOLD 2117 », "
        + "« OZ 3034 », « SSL2081 ». C'est elle que la saisie assistée lit.",
    },
    {
      champ: 'supplement_teinture',
      libelle: 'Supplement de teinture',
      type: 'nombre',
      aide: 'En devise par tonne (100, 150, 530…). Le prix de la couleur est le prix de base de '
        + 'la famille plus ce supplement ramene au kilo.',
    },
    {
      champ: 'unite_catalogue',
      libelle: 'Unité de stock',
      type: 'liste',
      obligatoire: true,
      options: [
        { valeur: 'kg', libelle: 'Kilogramme' },
        { valeur: 'Bobine', libelle: 'Bobine' },
        { valeur: 'Palette', libelle: 'Palette' },
        { valeur: 'Lot', libelle: 'Lot (bain de production)' },
        { valeur: 'ml', libelle: 'Metre lineaire' },
      ],
      aide:
        'Le stock reste tenu en kg ; les autres unités sont des masques de saisie. ' +
        'Le lot est le bain que le fournisseur produit — une unité d’achat, pas de manutention.',
    },
    {
      champ: 'poids_bobine_kg',
      libelle: 'Poids par bobine (kg)',
      type: 'nombre',
      aide: 'Obligatoire pour une unité Bobine ou Palette.',
    },
    { champ: 'bobines_par_palette', libelle: 'Bobines par palette', type: 'entier' },
    {
      champ: 'bobines_par_lot',
      libelle: 'Bobines par lot',
      type: 'entier',
      aide:
        'Le bain de production du fournisseur. Il varie d’un article à l’autre, même chez ' +
        'le même fournisseur : 1344 bobines le plus souvent, parfois 1400, 1688 ou 1720. ' +
        'Sans lui, la commande au lot est refusée plutôt que convertie au jugé.',
    },
    {
      champ: 'densite_kg_ml',
      libelle: 'Densité (kg/ml)',
      type: 'nombre',
      aide: 'Obligatoire pour une unité ml : sans elle, la conversion est refusee.',
    },
    { champ: 'prix_catalogue', libelle: 'Prix par unité', type: 'nombre', obligatoire: true },
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
      libelle: 'Marge de sécurité (%)',
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
    { champ: 'moq_kg', libelle: 'Quantité minimale de commande (kg)', type: 'nombre' },
    { champ: 'multiple_achat_kg', libelle: 'Multiple d achat (kg)', type: 'nombre' },
    {
      champ: 'suivi_lot',
      libelle: 'Suivi par lot',
      type: 'booleen',
      aide: 'Rend le lot obligatoire sur chaque mouvement. Determinant quand le bain de teinture conditionne la nuance.',
    },
    { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
  ]

  /* Filtres serveur. Tous portent sur des colonnes de la liste blanche du
     registre : le serveur les traduit en egalites SQL, il ne recoit jamais de
     nom de colonne libre. */
  const filtres: Record<string, string> = {}
  if (categorie) filtres.code_categorie = categorie
  if (fournisseur) filtres.code_fournisseur = fournisseur
  if (unite) filtres.unite_catalogue = unite
  if (actif !== '') filtres.actif = actif

  return (
    <>
      {!droits.visible('prix_catalogue') && (
        <div className="mb-4">
          <Message ton="info">Les informations de prix sont masquees pour votre profil.</Message>
        </div>
      )}

      {/* LES FILTRES SONT AU-DESSUS DU TABLEAU, plus a sa gauche. Le rail
          prenait un quart de la largeur sur un portable, et c'est le catalogue
          qui le payait : dix-sept colonnes serrees dans les trois quarts
          restants. Il partait aussi a l'impression. */}
        <EcranReferentiel<Reference>
          filtresEnTete={
            <BarreFiltres
              valeurs={{ categorie, fournisseur, unite, actif }}
              definir={{ categorie: setCategorie, fournisseur: setFournisseur, unite: setUnite, actif: setActif }}
              categories={qCat.data ?? []}
              fournisseurs={qFour.data ?? []}
            />
          }
          exportable="catalogue-references"
          imprimable="Catalogue références"
          // Remonter la categorie dans la cle force le rechargement : sans cela,
          // l'ecran garderait la liste precedente en changeant de filtre.
          key={categorie}
          titre="Catalogue"
          module={MODULE}
          chemin="catalogue"
          serveur
          actionsExtra={(r) => <SupprimerDefinitivement reference={r.code_reference} />}
          cle="code_reference"
          colonnes={colonnes}
          champs={champs}
          filtres={filtres}
          libelleUnite="référence"
          rechercheInitiale={refDemandee}
          titreCarte={(r) => r.code_reference}
        />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Suppression definitive                                                      */
/* -------------------------------------------------------------------------- */

interface Usages {
  supprimable: boolean
  motifs: string[]
}

/**
 * Efface une reference jamais utilisee.
 *
 * La desactivation reste la voie normale : elle preserve l'histoire, que R03
 * declare immuable. Mais une reference creee par erreur — une faute de frappe
 * ayant produit un doublon — n'a pas d'histoire a preserver, et la desactiver
 * laisse une ligne morte au catalogue pour toujours.
 *
 * Les usages sont demandes au serveur AVANT d'ouvrir la confirmation : proposer
 * une action qui echouera est pire que ne pas la proposer. Le serveur les
 * recompte de son cote — l'ecran informe, il n'autorise pas.
 */
function SupprimerDefinitivement({ reference }: { reference: string }) {
  const client = useQueryClient()
  const confirmation = useConfirmation()

  const demander = async () => {
    let usages: Usages
    try {
      usages = await api.get<Usages>(
        `/api/catalogue/${encodeURIComponent(reference)}/usages`,
      )
    } catch (e) {
      toast.error("Impossible de verifier les usages", {
        description: e instanceof Error ? e.message : String(e),
      })
      return
    }

    if (!usages.supprimable) {
      toast.error(`${reference} ne peut pas etre supprimee`, {
        description: `Retenue par ${usages.motifs.join(', ')}. Desactivez-la plutot : son passage doit rester lisible.`,
      })
      return
    }

    confirmation.demander({
      titre: `Supprimer definitivement ${reference} ?`,
      description:
        "Cette reference n'a jamais servi : aucun mouvement, aucune recette, aucune commande, aucun stock. " +
        "Elle sera effacee du catalogue, sans trace. Cette action est irreversible.",
      destructif: true,
      libelleConfirmer: 'Supprimer definitivement',
      action: async () => {
        try {
          await api.delete(`/api/catalogue/${encodeURIComponent(reference)}/definitivement`)
          await client.invalidateQueries()
          toast.success(`${reference} supprimee.`)
        } catch (e) {
          toast.error('Suppression refusee', {
            description: e instanceof Error ? e.message : String(e),
          })
        }
      },
    })
  }

  return (
    <MenuElement destructif onSelect={() => void demander()}>
      <Trash2 />
      Supprimer definitivement
    </MenuElement>
  )
}

/* -------------------------------------------------------------------------- */
/* Panneau de filtres                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Filtres du catalogue, en colonne.
 *
 * Remplace la liste des categories qui occupait ce rail. Enumerer les
 * categories obligeait a charger le catalogue entier rien que pour les
 * compter — tenable sur cent references, absurde sur vingt mille — et ne
 * donnait qu'un seul axe de filtrage.
 *
 * Chaque champ vaut une egalite envoyee au serveur : c'est lui qui filtre et
 * qui compte, la table n'affiche qu'une page.
 */
function BarreFiltres({
  valeurs,
  definir,
  categories,
  fournisseurs,
}: {
  valeurs: { categorie: string; fournisseur: string; unite: string; actif: string }
  definir: {
    categorie: (v: string) => void
    fournisseur: (v: string) => void
    unite: (v: string) => void
    actif: (v: string) => void
  }
  categories: { code_categorie: string; libelle: string }[]
  fournisseurs: { code_fournisseur: string; nom: string }[]
}) {
  const actifs = Object.entries(valeurs).filter(
    ([c, v]) => v !== '' && !(c === 'actif' && v === '1'),
  ).length

  const reinitialiser = () => {
    definir.categorie('')
    definir.fournisseur('')
    definir.unite('')
    definir.actif('1')
  }

  return (
    <div
      /* SUR TELEPHONE, UNE GRILLE ; AU-DELA, UNE BARRE.
         En `flex-wrap`, le mot « Filtres » comptait comme un champ : il prenait
         la premiere place, poussait « Categorie » et « Fournisseur » a la ligne,
         et le second sortait de l'ecran. Les quatre selecteurs se retrouvaient
         sur trois lignes sans bord commun. En grille, ils s'alignent deux par
         deux et le titre occupe sa propre ligne, ou il ne gene personne. */
      className="sans-impression mb-3 grid grid-cols-2 items-end gap-2 rounded-[var(--radius)]
                 border border-bordure bg-surface px-2.5 py-2
                 sm:flex sm:flex-wrap"
    >
      <span className="col-span-2 flex items-center gap-1 text-[11px] font-semibold uppercase
                       tracking-wide text-attenue-texte sm:mb-1">
        <Filter className="size-3" />
        Filtres
      </span>

      <Champ libelle="Catégorie">
        <select
          value={valeurs.categorie}
          onChange={(e) => definir.categorie(e.target.value)}
          className={CLASSE_CHAMP}
        >
          <option value="">Toutes</option>
          {categories.map((c) => (
            <option key={c.code_categorie} value={c.code_categorie}>
              {c.libelle}
            </option>
          ))}
        </select>
      </Champ>

      <Champ libelle="Fournisseur">
        <select
          value={valeurs.fournisseur}
          onChange={(e) => definir.fournisseur(e.target.value)}
          className={CLASSE_CHAMP}
        >
          <option value="">Tous</option>
          {fournisseurs.map((f) => (
            <option key={f.code_fournisseur} value={f.code_fournisseur}>
              {f.nom}
            </option>
          ))}
        </select>
      </Champ>

      <Champ libelle="Unité">
        <select
          value={valeurs.unite}
          onChange={(e) => definir.unite(e.target.value)}
          className={CLASSE_CHAMP}
        >
          <option value="">Toutes</option>
          {/* Il n'existe pas de referentiel d'unites : la colonne est du texte
              libre dans le catalogue. Ces deux valeurs sont celles qu'il
              contient reellement, en minuscules. Le jour ou une unite s'ajoute,
              c'est un referentiel qu'il faudra, pas une option de plus ici. */}
          {['kg', 'ml'].map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </Champ>

      <Champ libelle="État">
        <select
          value={valeurs.actif}
          onChange={(e) => definir.actif(e.target.value)}
          className={CLASSE_CHAMP}
        >
          <option value="1">Actives</option>
          <option value="0">Desactivees</option>
          <option value="">Toutes</option>
        </select>
      </Champ>

      {actifs > 0 && (
        <button
          type="button"
          onClick={reinitialiser}
          className="mb-0.5 flex items-center gap-1 rounded-[3px] border border-bordure px-2
                     py-1 text-[11px] text-primaire hover:bg-attenue"
        >
          <FilterX className="size-3" />
          Effacer ({actifs})
        </button>
      )}
    </div>
  )
}

const CLASSE_CHAMP =
  'h-7 w-full rounded-[3px] border border-champ bg-surface px-1.5 text-[12px] ' +
  'text-texte outline-none focus:border-primaire'

/** Libelle serre au-dessus de son champ : deux lignes, pas de colonne perdue. */
function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    // `min-w` : sans elle chaque champ prend la largeur de son contenu et la
    // barre devient un escalier.
    // `min-w` ne vaut qu'a partir de la barre horizontale : en grille, elle
    // forcerait une colonne plus large que la moitie d'un telephone, et la
    // seconde sortirait de l'ecran — c'est ce qui coupait « Fournisseur ».
    <label className="flex w-full flex-col gap-0.5 sm:w-auto sm:min-w-[10rem]">
      <span className="text-[10.5px] text-attenue-texte">{libelle}</span>
      {children}
    </label>
  )
}

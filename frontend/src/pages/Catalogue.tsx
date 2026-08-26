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
import { Trash2 } from 'lucide-react'
import { MenuElement, useConfirmation } from '../composants/ui/surcouches'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EcranReferentiel } from '../components/EcranReferentiel'
import type { ChampDef } from '../components/Formulaire'
import { PageAvecRail } from '../composants/RailLateral'
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

  const colonnes: Colonne<Reference>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      filtre: 'texte',
      rendu: (r) => (
        <div>
          <div className="font-medium text-texte">{r.code_reference}</div>
          {r.actif === 0 && <Etiquette ton="rouge">desactivee</Etiquette>}
        </div>
      ),
    },
    { champ: 'code_categorie', entete: 'Categorie', filtre: 'liste', rendu: (r) => r.categorie_libelle },
    { champ: 'fournisseur_nom', entete: 'Fournisseur', filtre: 'liste', rendu: (r) => r.fournisseur_nom },
    { champ: 'couleur', entete: 'Couleur', filtre: 'liste', rendu: (r) => fmt.texte(r.couleur), secondaire: true },
    {
      champ: 'unite_catalogue',
      entete: 'Unite',
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

      <PageAvecRail
        rail={
          <PanneauFiltres
            valeurs={{ categorie, fournisseur, unite, actif }}
            definir={{ categorie: setCategorie, fournisseur: setFournisseur, unite: setUnite, actif: setActif }}
            categories={qCat.data ?? []}
            fournisseurs={qFour.data ?? []}
          />
        }
      >
        <EcranReferentiel<Reference>
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
          libelleUnite="reference"
          titreCarte={(r) => r.code_reference}
        />
      </PageAvecRail>
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
function PanneauFiltres({
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
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-attenue-texte">
          Filtres
        </span>
        {actifs > 0 && (
          <button
            type="button"
            onClick={reinitialiser}
            className="rounded-[3px] px-1.5 py-0.5 text-[11px] text-primaire hover:bg-attenue"
          >
            Effacer ({actifs})
          </button>
        )}
      </div>

      <Champ libelle="Categorie">
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

      <Champ libelle="Unite">
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

      <Champ libelle="Etat">
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
    </div>
  )
}

const CLASSE_CHAMP =
  'h-7 w-full rounded-[3px] border border-champ bg-surface px-1.5 text-[12px] ' +
  'text-texte outline-none focus:border-primaire'

/** Libelle serre au-dessus de son champ : deux lignes, pas de colonne perdue. */
function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10.5px] text-attenue-texte">{libelle}</span>
      {children}
    </label>
  )
}

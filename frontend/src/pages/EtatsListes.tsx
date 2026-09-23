/**
 * Les etats de situation, tous batis sur la meme mise en page.
 *
 * POURQUOI UN SEUL FICHIER. Chacun de ces etats tient en une trentaine de
 * lignes : une requete, des colonnes, un entete. Les separer en huit fichiers
 * de trente lignes rendrait plus difficile de verifier qu'ils se ressemblent —
 * or c'est precisement ce qu'on veut d'une famille de documents.
 *
 * CE QUI EST PARTAGE, ET CE QUI NE L'EST PAS. La mise en page vient de
 * `EtatImprimable` ; la selection des colonnes reste propre a chaque etat. On
 * pourrait deriver les colonnes du tableau d'ecran, mais un document papier ne
 * porte pas les memes : pas de colonne d'action, pas de badge colore, et un
 * ordre pense pour la lecture en ligne plutot que pour le tri.
 *
 * LES DROITS S'APPLIQUENT DEUX FOIS. Le serveur retire les champs masques de sa
 * reponse ; l'ecran retire en plus les colonnes qui en dependent, pour ne pas
 * imprimer une colonne de tirets. La premiere protection est la vraie ; la
 * seconde evite un document illisible.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Chargement, Selecteur } from '../composants/ui/base'
import { fmt } from '../components/ui'

/* -------------------------------------------------------------------------- */
/* Etat des stocks                                                             */
/* -------------------------------------------------------------------------- */

interface LigneStock {
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  stock_physique_net_kg: number | null
  stock_projete_kg: number | null
  stock_min_kg: number | null
  jours_couverture: number | null
  statut: string
  valeur_totale_mad?: number | null
  [k: string]: unknown
}

export function EtatStockImprime() {
  const droits = useDroits('STOCK')
  const [filtre, setFiltre] = useState('')

  const q = useQuery({
    queryKey: ['stock-projete'],
    queryFn: () => api.get<LigneStock[]>('/api/stock/projete'),
  })

  if (q.isLoading) return <Chargement texte="Preparation de l etat…" />
  const toutes = q.data ?? []
  const lignes = filtre ? toutes.filter((l) => l.statut === filtre) : toutes
  const valeurVisible = droits.visible('valeur_totale_mad')
  const valeur = lignes.reduce((s, l) => s + (l.valeur_totale_mad ?? 0), 0)

  return (
    <div>
      <div className="sans-impression mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-attenue-texte">Restreindre a un statut :</span>
        <Selecteur value={filtre} onChange={(e) => setFiltre(e.target.value)} className="w-52">
          <option value="">Toutes les références</option>
          <option value="RUPTURE">Ruptures</option>
          <option value="CRITIQUE">Critiques</option>
          <option value="ATTENTION">Attention</option>
          <option value="OK">Au vert</option>
        </Selecteur>
      </div>

      <EtatImprimable
        titre="État des stocks"
        sousTitre={filtre ? `Restreint aux references en statut ${filtre}` : undefined}
        enTete={
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="text-neutral-600">Références : </span>
              <span className="font-semibold">{lignes.length}</span>
            </span>
            {valeurVisible && (
              <span>
                <span className="text-neutral-600">Valeur totale : </span>
                <span className="font-semibold">{fmt.nombre(valeur, 2)} MAD</span>
              </span>
            )}
          </div>
        }
      >
        <TableEtat<LigneStock>
          colonnes={[
            {
              entete: 'Référence',
              valeur: (l) => (
                <>
                  <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                  {l.designation && (
                    <div className="text-[9px] text-neutral-600">{l.designation}</div>
                  )}
                </>
              ),
            },
            { entete: 'Fournisseur', valeur: (l) => l.fournisseur_nom ?? '—' },
            {
              entete: 'Physique kg',
              numerique: true,
              valeur: (l) => fmt.nombre(l.stock_physique_net_kg ?? 0, 1),
            },
            {
              entete: 'Projeté kg',
              numerique: true,
              valeur: (l) => fmt.nombre(l.stock_projete_kg ?? 0, 1),
            },
            {
              entete: 'Minimum kg',
              numerique: true,
              valeur: (l) => (l.stock_min_kg == null ? '—' : fmt.nombre(l.stock_min_kg, 1)),
            },
            {
              entete: 'Couv. j',
              numerique: true,
              valeur: (l) =>
                l.jours_couverture == null ? '—' : fmt.nombre(l.jours_couverture, 0),
            },
            { entete: 'Statut', valeur: (l) => l.statut },
            ...(valeurVisible
              ? [
                  {
                    entete: 'Valeur MAD',
                    numerique: true,
                    valeur: (l: LigneStock) =>
                      l.valeur_totale_mad == null ? '—' : fmt.nombre(l.valeur_totale_mad, 2),
                  },
                ]
              : []),
          ]}
          lignes={lignes}
        />
      </EtatImprimable>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Feuille de comptage                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Le document qu'on emporte dans les allees.
 *
 * SA COLONNE PRINCIPALE EST VIDE. C'est tout l'objet : on imprime pour ecrire
 * dessus a la main, puis on saisit. Une feuille pre-remplie du stock theorique
 * pousserait a recopier ce qui est deja la plutot qu'a compter — c'est la faute
 * classique de l'inventaire tournant, et elle rend le comptage inutile.
 *
 * LE THEORIQUE N'Y FIGURE DONC PAS, meme en petit. On le compare apres, a
 * l'ecran, quand le chiffre compte est deja pose.
 */
export function EtatComptage() {
  const [magasin, setMagasin] = useState('')

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: () => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1'),
  })
  const q = useQuery({
    queryKey: ['stock-projete'],
    queryFn: () => api.get<LigneStock[]>('/api/stock/projete'),
  })

  if (q.isLoading) return <Chargement texte="Preparation de la feuille…" />
  const lignes = [...(q.data ?? [])].sort((a, b) =>
    a.code_reference.localeCompare(b.code_reference),
  )
  const nomMagasin = qMag.data?.find((m) => m.code_magasin === magasin)?.nom

  return (
    <div>
      <div className="sans-impression mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-attenue-texte">Magasin a compter :</span>
        <Selecteur value={magasin} onChange={(e) => setMagasin(e.target.value)} className="w-56">
          <option value="">— a preciser a la main —</option>
          {(qMag.data ?? []).map((m) => (
            <option key={m.code_magasin} value={m.code_magasin}>
              {m.nom}
            </option>
          ))}
        </Selecteur>
      </div>

      <EtatImprimable
        titre="Feuille de comptage"
        sousTitre={nomMagasin ?? 'Magasin : ______________'}
        enTete={
          <div className="flex flex-wrap gap-x-10 gap-y-2">
            <span>
              <span className="text-neutral-600">Date du comptage : </span>
              <span className="inline-block w-32 border-b border-neutral-500" />
            </span>
            <span>
              <span className="text-neutral-600">Compte par : </span>
              <span className="inline-block w-40 border-b border-neutral-500" />
            </span>
            <span>
              <span className="text-neutral-600">Visa : </span>
              <span className="inline-block w-24 border-b border-neutral-500" />
            </span>
          </div>
        }
      >
        <TableEtat<LigneStock>
          colonnes={[
            {
              entete: 'Référence',
              valeur: (l) => <span className="font-mono text-[10px]">{l.code_reference}</span>,
            },
            { entete: 'Designation', valeur: (l) => l.designation ?? '—' },
            {
              entete: 'Lot / emplacement',
              valeur: () => <span className="inline-block h-3 w-full" />,
            },
            {
              entete: 'Quantité comptee',
              numerique: true,
              // La cellule est vide et large : c'est la ou l'on ecrit.
              valeur: () => <span className="inline-block h-4 w-24 border-b border-neutral-400" />,
            },
            {
              entete: 'Observation',
              valeur: () => <span className="inline-block h-3 w-full" />,
            },
          ]}
          lignes={lignes}
        />
        <p className="mt-3 text-[9px] text-neutral-600">
          {lignes.length} reference(s) a compter. Le stock theorique ne figure pas sur cette
          feuille : le comparer avant d avoir compte fausse le comptage.
        </p>
      </EtatImprimable>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Plan d'achat                                                                */
/* -------------------------------------------------------------------------- */

interface Proposition {
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  quantite_suggeree_kg: number | null
  quantite_suggeree_unite: number | null
  unite_saisie: string | null
  prix_estime_mad?: number | null
  jours_couverture: number | null
  urgence: string | null
  statut: string
  [k: string]: unknown
}

export function EtatPlanAchat() {
  const droits = useDroits('PLAN_ACHAT')
  const q = useQuery({
    queryKey: ['plan-achat-propositions'],
    queryFn: () => api.get<Proposition[]>('/api/plan-achat/propositions'),
  })

  const parFournisseur = useMemo(() => {
    const m = new Map<string, Proposition[]>()
    for (const p of q.data ?? []) {
      const f = p.fournisseur_nom ?? 'Sans fournisseur'
      if (!m.has(f)) m.set(f, [])
      m.get(f)!.push(p)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [q.data])

  if (q.isLoading) return <Chargement texte="Preparation de l etat…" />
  const prixVisible = droits.visible('prix_estime_mad')
  const total = (q.data ?? []).reduce(
    (s, p) => s + (p.quantite_suggeree_kg ?? 0) * (p.prix_estime_mad ?? 0),
    0,
  )

  if (!parFournisseur.length) {
    return (
      <Alerte ton="info">
        Aucune proposition d achat en cours. Relancez le calcul depuis l ecran Plan d achat.
      </Alerte>
    )
  }

  return (
    <EtatImprimable
      titre="Plan d achat a engager"
      enTete={
        <div className="flex flex-wrap gap-x-8 gap-y-1">
          <span>
            <span className="text-neutral-600">Fournisseurs : </span>
            <span className="font-semibold">{parFournisseur.length}</span>
          </span>
          <span>
            <span className="text-neutral-600">Propositions : </span>
            <span className="font-semibold">{(q.data ?? []).length}</span>
          </span>
          {prixVisible && (
            <span>
              <span className="text-neutral-600">Montant estime : </span>
              <span className="font-semibold">{fmt.nombre(total, 2)} MAD</span>
            </span>
          )}
        </div>
      }
    >
      {/* Un bloc par fournisseur : c'est ainsi qu'on passe commande, et c'est
          la coupure naturelle pour detacher une page et la donner a traiter. */}
      {parFournisseur.map(([f, props]) => (
        <section key={f} className="mb-5 break-inside-avoid">
          <h3 className="mb-1 border-b border-neutral-400 pb-0.5 text-[11px] font-bold uppercase tracking-wide">
            {f}
            <span className="ml-2 font-normal normal-case text-neutral-600">
              {props.length} reference(s)
            </span>
          </h3>
          <TableEtat<Proposition>
            colonnes={[
              {
                entete: 'Référence',
                valeur: (p) => (
                  <>
                    <div className="font-mono text-[10px] font-medium">{p.code_reference}</div>
                    {p.designation && (
                      <div className="text-[9px] text-neutral-600">{p.designation}</div>
                    )}
                  </>
                ),
              },
              {
                entete: 'Quantité',
                numerique: true,
                valeur: (p) =>
                  p.quantite_suggeree_unite != null && p.unite_saisie
                    ? `${fmt.nombre(p.quantite_suggeree_unite, 2)} ${p.unite_saisie}`
                    : `${fmt.nombre(p.quantite_suggeree_kg ?? 0, 2)} kg`,
              },
              {
                entete: 'Couv. j',
                numerique: true,
                valeur: (p) =>
                  p.jours_couverture == null ? '—' : fmt.nombre(p.jours_couverture, 0),
              },
              { entete: 'Urgence', valeur: (p) => p.urgence ?? '—' },
              ...(prixVisible
                ? [
                    {
                      entete: 'Prix MAD/kg',
                      numerique: true,
                      valeur: (p: Proposition) =>
                        p.prix_estime_mad == null ? '—' : fmt.nombre(p.prix_estime_mad, 2),
                    },
                    {
                      entete: 'Montant MAD',
                      numerique: true,
                      valeur: (p: Proposition) =>
                        fmt.nombre((p.quantite_suggeree_kg ?? 0) * (p.prix_estime_mad ?? 0), 2),
                    },
                  ]
                : []),
            ]}
            lignes={props}
          />
        </section>
      ))}
      <p className="mt-2 text-[9px] text-neutral-600">
        Montants estimes a partir du dernier prix connu. Ils servent a arbitrer, pas a engager :
        le prix ferme se fixe au bon de commande.
      </p>
    </EtatImprimable>
  )
}

/* -------------------------------------------------------------------------- */
/* Grand livre des mouvements                                                  */
/* -------------------------------------------------------------------------- */

interface LigneMvt {
  numero_mouvement: string
  date_mouvement: string
  code_type_mvt: string
  code_reference: string
  designation?: string | null
  quantite_kg: number | null
  code_magasin: string | null
  lot_fournisseur: string | null
  utilisateur_nom?: string | null
  [k: string]: unknown
}

export function EtatMouvements() {
  const q = useQuery({
    queryKey: ['mouvements', ''],
    queryFn: () => api.get<LigneMvt[]>('/api/mouvements?limite=1000'),
  })

  if (q.isLoading) return <Chargement texte="Preparation du registre…" />
  const lignes = q.data ?? []
  const periode = lignes.length
    ? `${(lignes[lignes.length - 1].date_mouvement ?? '').slice(0, 10)} au ${(lignes[0].date_mouvement ?? '').slice(0, 10)}`
    : undefined

  return (
    <EtatImprimable
      titre="Grand livre des mouvements"
      sousTitre={periode}
      enTete={
        <span>
          <span className="text-neutral-600">Lignes : </span>
          <span className="font-semibold">{lignes.length}</span>
          <span className="ml-6 text-neutral-600">
            Registre immuable — une correction se fait par un mouvement inverse.
          </span>
        </span>
      }
    >
      <TableEtat<LigneMvt>
        colonnes={[
          { entete: 'Date', valeur: (l) => (l.date_mouvement ?? '').slice(0, 10) },
          {
            entete: 'N°',
            valeur: (l) => <span className="font-mono text-[9px]">{l.numero_mouvement}</span>,
          },
          { entete: 'Type', valeur: (l) => l.code_type_mvt },
          {
            entete: 'Référence',
            valeur: (l) => <span className="font-mono text-[10px]">{l.code_reference}</span>,
          },
          {
            entete: 'Quantité kg',
            numerique: true,
            valeur: (l) => fmt.nombre(l.quantite_kg ?? 0, 3),
          },
          { entete: 'Magasin', valeur: (l) => l.code_magasin ?? '—' },
          { entete: 'Lot', valeur: (l) => l.lot_fournisseur ?? '—' },
        ]}
        lignes={lignes}
      />
    </EtatImprimable>
  )
}

/* -------------------------------------------------------------------------- */
/* Catalogue et fournisseurs                                                   */
/* -------------------------------------------------------------------------- */

interface Ref {
  code_reference: string
  designation: string | null
  code_categorie: string | null
  unite_catalogue: string | null
  code_fournisseur: string | null
  prix_catalogue?: number | null
  code_devise_catalogue?: string | null
  stock_min_kg: number | null
  couverture_min_mois: number | null
  actif: number
  [k: string]: unknown
}

export function EtatCatalogue() {
  const droits = useDroits('CATALOGUE')
  const q = useQuery({
    queryKey: ['catalogue', 'etat'],
    queryFn: () => api.get<Ref[]>('/api/catalogue?limite=2000&actif=1'),
  })

  if (q.isLoading) return <Chargement texte="Preparation du catalogue…" />
  const brut: unknown = q.data ?? []
  const lignes = (Array.isArray(brut) ? brut : ((brut as { lignes?: Ref[] }).lignes ?? [])).sort(
    (a: Ref, b: Ref) => a.code_reference.localeCompare(b.code_reference),
  ) as Ref[]
  const prixVisible = droits.visible('prix_catalogue')

  return (
    <EtatImprimable
      titre="Catalogue des références"
      sousTitre="Références actives"
      enTete={
        <span>
          <span className="text-neutral-600">Références : </span>
          <span className="font-semibold">{lignes.length}</span>
        </span>
      }
    >
      <TableEtat<Ref>
        colonnes={[
          {
            entete: 'Référence',
            valeur: (r) => <span className="font-mono text-[10px]">{r.code_reference}</span>,
          },
          { entete: 'Designation', valeur: (r) => r.designation ?? '—' },
          { entete: 'Catégorie', valeur: (r) => r.code_categorie ?? '—' },
          { entete: 'Unité', valeur: (r) => r.unite_catalogue ?? '—' },
          { entete: 'Fournisseur', valeur: (r) => r.code_fournisseur ?? '—' },
          ...(prixVisible
            ? [
                {
                  entete: 'Prix',
                  numerique: true,
                  valeur: (r: Ref) =>
                    r.prix_catalogue == null
                      ? '—'
                      : `${fmt.nombre(r.prix_catalogue, 2)} ${r.code_devise_catalogue ?? ''}`,
                },
              ]
            : []),
          {
            entete: 'Stock min',
            numerique: true,
            valeur: (r) => (r.stock_min_kg == null ? '—' : fmt.nombre(r.stock_min_kg, 0)),
          },
          {
            entete: 'Couv. min',
            numerique: true,
            valeur: (r) =>
              r.couverture_min_mois == null ? '—' : `${fmt.nombre(r.couverture_min_mois, 1)} m`,
          },
        ]}
        lignes={lignes}
      />
    </EtatImprimable>
  )
}

interface Fourn {
  code_fournisseur: string
  nom: string
  contact?: string | null
  telephone?: string | null
  email?: string | null
  pays?: string | null
  code_devise: string | null
  delai_livraison_jours: number | null
  conditions_paiement?: string | null
  [k: string]: unknown
}

export function EtatFournisseurs() {
  const q = useQuery({
    queryKey: ['fournisseurs', 'etat'],
    queryFn: () => api.get<Fourn[]>('/api/fournisseurs?actif=1&limite=500'),
  })

  if (q.isLoading) return <Chargement texte="Preparation du repertoire…" />
  const brut: unknown = q.data ?? []
  const lignes = (
    Array.isArray(brut) ? brut : ((brut as { lignes?: Fourn[] }).lignes ?? [])
  ).sort((a: Fourn, b: Fourn) => a.nom.localeCompare(b.nom)) as Fourn[]

  return (
    <EtatImprimable
      titre="Repertoire fournisseurs"
      enTete={
        <span>
          <span className="text-neutral-600">Fournisseurs actifs : </span>
          <span className="font-semibold">{lignes.length}</span>
        </span>
      }
    >
      <TableEtat<Fourn>
        colonnes={[
          { entete: 'Code', valeur: (f) => <span className="font-mono text-[10px]">{f.code_fournisseur}</span> },
          { entete: 'Nom', valeur: (f) => <span className="font-semibold">{f.nom}</span> },
          { entete: 'Contact', valeur: (f) => f.contact ?? '—' },
          { entete: 'Telephone', valeur: (f) => f.telephone ?? '—' },
          { entete: 'Pays', valeur: (f) => f.pays ?? '—' },
          { entete: 'Devise', valeur: (f) => f.code_devise ?? '—' },
          {
            entete: 'Délai j',
            numerique: true,
            valeur: (f) => (f.delai_livraison_jours == null ? '—' : f.delai_livraison_jours),
          },
          { entete: 'Paiement', valeur: (f) => f.conditions_paiement ?? '—' },
        ]}
        lignes={lignes}
      />
    </EtatImprimable>
  )
}

/* -------------------------------------------------------------------------- */
/* Categories et familles                                                      */
/* -------------------------------------------------------------------------- */

interface Categorie {
  code_categorie: string
  libelle: string
  description?: string | null
  code_role_defaut?: string | null
  nb_familles?: number | null
  nb_references?: number | null
  ordre_affichage?: number | null
  actif?: number
  [k: string]: unknown
}

interface Famille {
  code_categorie: string
  code_famille: string
  libelle: string
  titrage?: string | null
  type_fil?: string | null
  description?: string | null
  nb_references?: number | null
  ordre_affichage?: number | null
  actif?: number
  [k: string]: unknown
}

/**
 * LA NOMENCLATURE MATIERE, categorie par categorie.
 *
 * Ce n'est pas une liste plate : une famille n'a aucun sens hors de sa
 * categorie, et l'imprimer a plat obligerait a relire le code de categorie sur
 * chaque ligne pour reconstituer l'arbre de tete. On imprime donc l'arbre.
 *
 * C'est le document qu'on pose devant quelqu'un qui doit CLASSER une matiere
 * nouvelle : il y lit ce qui existe deja, et voit tout de suite si sa matiere a
 * une place ou s'il faut en ouvrir une.
 */
export function EtatCategories() {
  const qCat = useQuery({
    queryKey: ['categories', 'etat'],
    queryFn: () => api.get<Categorie[]>('/api/categories'),
  })
  const qFam = useQuery({
    queryKey: ['familles', 'etat'],
    queryFn: () => api.get<Famille[]>('/api/familles'),
  })

  const arbre = useMemo(() => {
    const familles = qFam.data ?? []
    return (qCat.data ?? [])
      .slice()
      .sort(
        (a, b) =>
          (a.ordre_affichage ?? 999) - (b.ordre_affichage ?? 999) ||
          a.code_categorie.localeCompare(b.code_categorie),
      )
      .map((c) => ({
        categorie: c,
        familles: familles
          .filter((f) => f.code_categorie === c.code_categorie)
          .sort(
            (a, b) =>
              (a.ordre_affichage ?? 999) - (b.ordre_affichage ?? 999) ||
              a.code_famille.localeCompare(b.code_famille),
          ),
      }))
  }, [qCat.data, qFam.data])

  if (qCat.isLoading || qFam.isLoading) return <Chargement texte="Preparation de la nomenclature…" />

  const nbFamilles = (qFam.data ?? []).length
  const nbRefs = (qCat.data ?? []).reduce((s, c) => s + (c.nb_references ?? 0), 0)
  const orphelines = (qFam.data ?? []).filter(
    (f) => !(qCat.data ?? []).some((c) => c.code_categorie === f.code_categorie),
  )

  return (
    <EtatImprimable
      titre="Catégories et familles"
      sousTitre="Nomenclature matière"
      enTete={
        <div className="flex flex-wrap gap-x-8 gap-y-1">
          <span>
            <span className="text-neutral-600">Catégories : </span>
            <span className="font-semibold">{arbre.length}</span>
          </span>
          <span>
            <span className="text-neutral-600">Familles : </span>
            <span className="font-semibold">{nbFamilles}</span>
          </span>
          <span>
            <span className="text-neutral-600">Références classées : </span>
            <span className="font-semibold">{nbRefs}</span>
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {arbre.map(({ categorie, familles }) => (
          // `break-inside-avoid` : une categorie et ses familles restent
          // ensemble. Coupee entre deux pages, la liste se lit comme deux
          // listes differentes.
          <section key={categorie.code_categorie} className="break-inside-avoid">
            <div className="flex items-baseline justify-between gap-4 border-b border-black pb-0.5">
              <h2 className="text-[12px] font-bold uppercase tracking-wide">
                <span className="font-mono">{categorie.code_categorie}</span> — {categorie.libelle}
              </h2>
              <span className="shrink-0 text-[9px] text-neutral-600">
                {familles.length} famille(s) · {categorie.nb_references ?? 0} référence(s)
                {categorie.code_role_defaut ? ` · rôle ${categorie.code_role_defaut}` : ''}
                {categorie.actif === 0 ? ' · INACTIVE' : ''}
              </span>
            </div>
            {categorie.description && (
              <p className="mt-0.5 text-[9px] italic text-neutral-600">{categorie.description}</p>
            )}

            {familles.length === 0 ? (
              <p className="py-1 pl-4 text-[10px] italic text-neutral-600">
                Aucune famille — les références de cette catégorie ne peuvent pas être classées plus
                finement.
              </p>
            ) : (
              <div className="pl-4">
                <TableEtat<Famille>
                  colonnes={[
                    {
                      entete: 'Code famille',
                      valeur: (f) => <span className="font-mono text-[10px]">{f.code_famille}</span>,
                    },
                    { entete: 'Libellé', valeur: (f) => f.libelle },
                    { entete: 'Titrage', valeur: (f) => f.titrage ?? '—' },
                    { entete: 'Type de fil', valeur: (f) => f.type_fil ?? '—' },
                    {
                      entete: 'Réfs',
                      numerique: true,
                      valeur: (f) => f.nb_references ?? 0,
                    },
                  ]}
                  lignes={familles}
                />
              </div>
            )}
          </section>
        ))}

        {/* UNE FAMILLE SANS CATEGORIE NE DOIT PAS DISPARAITRE DU PAPIER.
            L'arbre ne peut pas la ranger ; la taire ferait croire qu'elle
            n'existe pas, alors que c'est exactement l'anomalie a corriger. */}
        {orphelines.length > 0 && (
          <section className="break-inside-avoid">
            <h2 className="border-b border-black pb-0.5 text-[12px] font-bold uppercase tracking-wide">
              Familles sans catégorie rattachée
            </h2>
            <div className="pl-4">
              <TableEtat<Famille>
                colonnes={[
                  {
                    entete: 'Code famille',
                    valeur: (f) => <span className="font-mono text-[10px]">{f.code_famille}</span>,
                  },
                  { entete: 'Libellé', valeur: (f) => f.libelle },
                  { entete: 'Catégorie citée', valeur: (f) => f.code_categorie },
                ]}
                lignes={orphelines}
              />
            </div>
          </section>
        )}
      </div>
    </EtatImprimable>
  )
}

/* -------------------------------------------------------------------------- */
/* Couleurs                                                                    */
/* -------------------------------------------------------------------------- */

interface Couleur {
  code_couleur_interne: string
  libelle: string
  description?: string | null
  classe_teinture?: string | null
  nb_fournisseurs?: number | null
  nb_references?: number | null
  ordre_affichage?: number | null
  actif?: number
  [k: string]: unknown
}

interface CouleurFournisseur {
  id_couleur_fournisseur: string
  code_couleur_interne: string
  code_fournisseur: string
  fournisseur_nom?: string | null
  code_couleur: string
  libelle?: string | null
  supplement_teinture?: number | null
  actif?: number
  [k: string]: unknown
}

const CLASSE_TEINTURE: Record<string, string> = {
  LIGHT: 'Claire',
  MEDIUM: 'Moyenne',
  DARK: 'Sombre',
  RED: 'Rouge',
}

/**
 * LE NUANCIER DE LA MAISON, avec la traduction de chaque fournisseur.
 *
 * Le rouge de la maison est C3 ; chez Hasirci il s'ecrit « RED 7612 », chez
 * Ozkaralar « OZ 5109 ». Devant une facture turque, c'est CE tableau qui permet
 * de dire de quelle couleur on parle — et donc de rapprocher deux fournisseurs
 * du meme fil plutot que de croire a deux matieres differentes.
 *
 * Il s'imprime parce qu'il se consulte au quai et au telephone, la ou l'ecran
 * n'est pas.
 */
export function EtatCouleurs() {
  const droits = useDroits('CATALOGUE')
  const qCoul = useQuery({
    queryKey: ['couleurs', 'etat'],
    queryFn: () => api.get<Couleur[]>('/api/couleurs'),
  })
  const qFrs = useQuery({
    queryKey: ['couleurs-fournisseur', 'etat'],
    queryFn: () => api.get<CouleurFournisseur[]>('/api/couleurs-fournisseur'),
  })

  const groupes = useMemo(() => {
    const codes = qFrs.data ?? []
    return (qCoul.data ?? [])
      .slice()
      .sort(
        (a, b) =>
          (a.ordre_affichage ?? 999) - (b.ordre_affichage ?? 999) ||
          a.code_couleur_interne.localeCompare(b.code_couleur_interne),
      )
      .map((c) => ({
        couleur: c,
        codes: codes
          .filter((f) => f.code_couleur_interne === c.code_couleur_interne)
          .sort((a, b) => a.code_fournisseur.localeCompare(b.code_fournisseur)),
      }))
  }, [qCoul.data, qFrs.data])

  if (qCoul.isLoading || qFrs.isLoading) return <Chargement texte="Preparation du nuancier…" />

  // Le supplement de teinture est un PRIX : il suit les droits comme les autres.
  const supplementVisible = droits.visible('supplement_teinture')
  const sansCode = groupes.filter((g) => g.codes.length === 0)

  return (
    <EtatImprimable
      titre="Couleurs"
      sousTitre="Nuancier interne et correspondances fournisseur"
      enTete={
        <div className="flex flex-wrap gap-x-8 gap-y-1">
          <span>
            <span className="text-neutral-600">Couleurs : </span>
            <span className="font-semibold">{groupes.length}</span>
          </span>
          <span>
            <span className="text-neutral-600">Correspondances : </span>
            <span className="font-semibold">{(qFrs.data ?? []).length}</span>
          </span>
          {sansCode.length > 0 && (
            <span>
              <span className="text-neutral-600">Sans code fournisseur : </span>
              <span className="font-semibold">{sansCode.length}</span>
            </span>
          )}
        </div>
      }
    >
      <TableEtat<(typeof groupes)[number]>
        colonnes={[
          {
            entete: 'Code',
            valeur: (g) => (
              <span className="font-mono text-[10px] font-semibold">
                {g.couleur.code_couleur_interne}
              </span>
            ),
          },
          {
            entete: 'Couleur',
            valeur: (g) => (
              <>
                <span className="font-semibold">{g.couleur.libelle}</span>
                {g.couleur.actif === 0 && (
                  <span className="text-neutral-600"> · inactive</span>
                )}
              </>
            ),
          },
          {
            entete: 'Teinture',
            valeur: (g) =>
              g.couleur.classe_teinture
                ? (CLASSE_TEINTURE[g.couleur.classe_teinture] ?? g.couleur.classe_teinture)
                : '—',
          },
          {
            entete: 'Chez les fournisseurs',
            valeur: (g) =>
              g.codes.length === 0 ? (
                <span className="italic text-neutral-600">aucun code declaré</span>
              ) : (
                <div className="space-y-0.5">
                  {g.codes.map((f) => (
                    <div key={f.id_couleur_fournisseur}>
                      <span className="text-neutral-600">
                        {f.fournisseur_nom ?? f.code_fournisseur} :{' '}
                      </span>
                      <span className="font-mono text-[10px] font-semibold">{f.code_couleur}</span>
                      {f.libelle && <span className="text-neutral-600"> ({f.libelle})</span>}
                      {supplementVisible && (f.supplement_teinture ?? 0) > 0 && (
                        <span className="text-neutral-600">
                          {' '}
                          · +{fmt.nombre(f.supplement_teinture, 0)} /t
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ),
          },
          {
            entete: 'Réfs',
            numerique: true,
            valeur: (g) => g.couleur.nb_references ?? 0,
          },
        ]}
        lignes={groupes}
      />
    </EtatImprimable>
  )
}

interface RefCouleur {
  code_reference: string
  designation?: string | null
  code_couleur_interne?: string | null
  code_couleur?: string | null
  code_fournisseur?: string | null
  fournisseur_nom?: string | null
  code_categorie?: string | null
  famille_libelle?: string | null
  titrage?: string | null
  unite_catalogue?: string | null
  stock_total_kg?: number | null
  actif?: number
  [k: string]: unknown
}

/**
 * LA FICHE D'UNE COULEUR — tout ce qui la porte, sur une page.
 *
 * La liste generale dit ce qui existe ; cette page-ci repond a une question
 * precise : « le C3, c'est quoi au juste, qui nous le vend, et qu'est-ce qu'on
 * en a ? » C'est le document qu'on emporte chez le teinturier ou qu'on joint a
 * une reclamation, et il doit tenir seul, sans l'ecran a cote.
 *
 * La couleur se choisit a l'ecran ; l'adresse la porte ensuite, pour qu'on
 * puisse revenir sur la meme fiche ou l'envoyer a quelqu'un.
 */
export function EtatCouleur() {
  const droits = useDroits('CATALOGUE')
  const { code } = useParams()
  const naviguer = useNavigate()

  const qCoul = useQuery({
    queryKey: ['couleurs', 'etat'],
    queryFn: () => api.get<Couleur[]>('/api/couleurs'),
  })
  const qFrs = useQuery({
    queryKey: ['couleurs-fournisseur', 'etat'],
    queryFn: () => api.get<CouleurFournisseur[]>('/api/couleurs-fournisseur'),
  })
  const qRefs = useQuery({
    queryKey: ['catalogue', 'etat'],
    queryFn: () => api.get<RefCouleur[]>('/api/catalogue?limite=2000&actif=1'),
  })

  const couleurs = useMemo(
    () =>
      (qCoul.data ?? [])
        .slice()
        .sort(
          (a, b) =>
            (a.ordre_affichage ?? 999) - (b.ordre_affichage ?? 999) ||
            a.code_couleur_interne.localeCompare(b.code_couleur_interne),
        ),
    [qCoul.data],
  )

  if (qCoul.isLoading || qFrs.isLoading || qRefs.isLoading)
    return <Chargement texte="Preparation de la fiche…" />

  const couleur = couleurs.find((c) => c.code_couleur_interne === code)
  const codes = (qFrs.data ?? [])
    .filter((f) => f.code_couleur_interne === code)
    .sort((a, b) => a.code_fournisseur.localeCompare(b.code_fournisseur))
  const references = (qRefs.data ?? [])
    .filter((r) => r.code_couleur_interne === code)
    .sort((a, b) => a.code_reference.localeCompare(b.code_reference))

  const supplementVisible = droits.visible('supplement_teinture')
  const stock = references.reduce((s, r) => s + (r.stock_total_kg ?? 0), 0)

  // LE CHOIX RESTE A L'ECRAN, jamais sur le papier : `sans-impression`.
  const selecteur = (
    <div className="sans-impression mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-attenue-texte">Couleur :</span>
      <Selecteur
        value={code ?? ''}
        onChange={(e) => naviguer(`/etats/couleur/${encodeURIComponent(e.target.value)}`)}
        className="w-72"
      >
        <option value="">Choisissez une couleur…</option>
        {couleurs.map((c) => (
          <option key={c.code_couleur_interne} value={c.code_couleur_interne}>
            {c.code_couleur_interne} — {c.libelle}
          </option>
        ))}
      </Selecteur>
    </div>
  )

  if (!couleur)
    return (
      <div>
        {selecteur}
        <Alerte ton="info">
          {code
            ? `Aucune couleur ne porte le code ${code}.`
            : 'Choisissez une couleur pour editer sa fiche.'}
        </Alerte>
      </div>
    )

  return (
    <div>
      {selecteur}
      <EtatImprimable
        titre="Fiche couleur"
        reference={couleur.code_couleur_interne}
        sousTitre={couleur.libelle}
        enTete={
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="text-neutral-600">Classe de teinture : </span>
              <span className="font-semibold">
                {couleur.classe_teinture
                  ? (CLASSE_TEINTURE[couleur.classe_teinture] ?? couleur.classe_teinture)
                  : 'non renseignée'}
              </span>
            </span>
            <span>
              <span className="text-neutral-600">Références : </span>
              <span className="font-semibold">{references.length}</span>
            </span>
            <span>
              <span className="text-neutral-600">Stock cumulé : </span>
              <span className="font-semibold">{fmt.nombre(stock, 0)} kg</span>
            </span>
            {couleur.actif === 0 && <span className="font-semibold">COULEUR INACTIVE</span>}
          </div>
        }
      >
        {couleur.description && (
          <p className="mb-4 text-[11px] italic text-neutral-700">{couleur.description}</p>
        )}

        <section className="mb-5 break-inside-avoid">
          <h2 className="mb-1 border-b border-black pb-0.5 text-[12px] font-bold uppercase tracking-wide">
            Comment elle s’écrit chez chaque fournisseur
          </h2>
          {codes.length === 0 ? (
            <p className="py-1 text-[10px] italic text-neutral-600">
              Aucun code fournisseur déclaré — une facture portant cette couleur ne pourra pas être
              rapprochée automatiquement.
            </p>
          ) : (
            <TableEtat<CouleurFournisseur>
              colonnes={[
                {
                  entete: 'Fournisseur',
                  valeur: (f) => (
                    <>
                      <span className="font-semibold">
                        {f.fournisseur_nom ?? f.code_fournisseur}
                      </span>
                      <span className="text-neutral-600"> ({f.code_fournisseur})</span>
                    </>
                  ),
                },
                {
                  entete: 'Son code',
                  valeur: (f) => (
                    <span className="font-mono text-[10px] font-semibold">{f.code_couleur}</span>
                  ),
                },
                { entete: 'Son libellé', valeur: (f) => f.libelle ?? '—' },
                ...(supplementVisible
                  ? [
                      {
                        entete: 'Supplément /t',
                        numerique: true,
                        valeur: (f: CouleurFournisseur) =>
                          f.supplement_teinture == null
                            ? '—'
                            : fmt.nombre(f.supplement_teinture, 2),
                      },
                    ]
                  : []),
              ]}
              lignes={codes}
            />
          )}
        </section>

        <section>
          <h2 className="mb-1 border-b border-black pb-0.5 text-[12px] font-bold uppercase tracking-wide">
            Références de cette couleur
          </h2>
          {references.length === 0 ? (
            <p className="py-1 text-[10px] italic text-neutral-600">
              Aucune référence active ne porte cette couleur.
            </p>
          ) : (
            <TableEtat<RefCouleur>
              colonnes={[
                {
                  entete: 'Référence',
                  valeur: (r) => <span className="font-mono text-[10px]">{r.code_reference}</span>,
                },
                { entete: 'Designation', valeur: (r) => r.designation ?? '—' },
                { entete: 'Famille', valeur: (r) => r.famille_libelle ?? r.code_categorie ?? '—' },
                { entete: 'Titrage', valeur: (r) => r.titrage ?? '—' },
                {
                  entete: 'Fournisseur',
                  valeur: (r) => r.fournisseur_nom ?? r.code_fournisseur ?? '—',
                },
                {
                  entete: 'Stock kg',
                  numerique: true,
                  valeur: (r) => (r.stock_total_kg == null ? '—' : fmt.nombre(r.stock_total_kg, 0)),
                },
              ]}
              lignes={references}
              total={['Total', '', '', '', '', fmt.nombre(stock, 0)]}
            />
          )}
        </section>
      </EtatImprimable>
    </div>
  )
}

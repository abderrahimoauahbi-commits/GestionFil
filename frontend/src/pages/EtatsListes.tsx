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
          <option value="">Toutes les references</option>
          <option value="RUPTURE">Ruptures</option>
          <option value="CRITIQUE">Critiques</option>
          <option value="ATTENTION">Attention</option>
          <option value="OK">Au vert</option>
        </Selecteur>
      </div>

      <EtatImprimable
        titre="Etat des stocks"
        sousTitre={filtre ? `Restreint aux references en statut ${filtre}` : undefined}
        enTete={
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="text-neutral-600">References : </span>
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
            { entete: 'Fournisseur', valeur: (l) => l.fournisseur_nom ?? '—' },
            {
              entete: 'Physique kg',
              numerique: true,
              valeur: (l) => fmt.nombre(l.stock_physique_net_kg ?? 0, 1),
            },
            {
              entete: 'Projete kg',
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
              entete: 'Reference',
              valeur: (l) => <span className="font-mono text-[10px]">{l.code_reference}</span>,
            },
            { entete: 'Designation', valeur: (l) => l.designation ?? '—' },
            {
              entete: 'Lot / emplacement',
              valeur: () => <span className="inline-block h-3 w-full" />,
            },
            {
              entete: 'Quantite comptee',
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
                entete: 'Reference',
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
                entete: 'Quantite',
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
            entete: 'Reference',
            valeur: (l) => <span className="font-mono text-[10px]">{l.code_reference}</span>,
          },
          {
            entete: 'Quantite kg',
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
      titre="Catalogue des references"
      sousTitre="References actives"
      enTete={
        <span>
          <span className="text-neutral-600">References : </span>
          <span className="font-semibold">{lignes.length}</span>
        </span>
      }
    >
      <TableEtat<Ref>
        colonnes={[
          {
            entete: 'Reference',
            valeur: (r) => <span className="font-mono text-[10px]">{r.code_reference}</span>,
          },
          { entete: 'Designation', valeur: (r) => r.designation ?? '—' },
          { entete: 'Categorie', valeur: (r) => r.code_categorie ?? '—' },
          { entete: 'Unite', valeur: (r) => r.unite_catalogue ?? '—' },
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
            entete: 'Delai j',
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

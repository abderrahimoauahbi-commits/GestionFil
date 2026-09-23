/**
 * LE BON DE COMMANDE SUR PAPIER — celui qui part chez le fournisseur.
 *
 * IL N'Y EN A QU'UN, ET C'EST UNE CORRECTION. J'avais d'abord ecrit DEUX
 * documents : un interne avec nos codes et nos prix, un second en anglais pour
 * le fournisseur. L'utilisateur a appuye sur « Imprimer » et a recu le premier —
 * « 2,00 Lot / 8 601,60 kg », prix 4,10, total 8,20 — c'est-a-dire exactement
 * ce qu'il ne voulait pas. Un document correct derriere un bouton qu'on ne
 * trouve pas ne vaut pas mieux qu'un document absent.
 *
 * LE BON DE COMMANDE EST UN DOCUMENT DE QUANTITES. Les 109 bons Excel tenus de
 * decembre 2020 a septembre 2026 le disent sans ambiguite : un mot de prix
 * apparait sur cinq d'entre eux, et deux fois c'est « OLD PRICE ». Le prix se
 * negocie ailleurs ; il n'a pas a voyager jusqu'en Turquie sur un papier que
 * l'on faxe.
 *
 * CE QU'IL REPREND DE CES BONS, parce que c'est ce que le fournisseur attend :
 *
 *   - la langue est l'ANGLAIS, de bout en bout ;
 *   - les colonnes sont DESCRIPTION OF GOODS / COLOR / COLOR CODE / DTEX /
 *     QUANTITY / TOTAL PLTS, dans cet ordre — celui de leurs feuilles ;
 *   - LA DESCRIPTION EST COMMERCIALE : « 100% POLYPROPYLENE YARN 2900 DTEX »,
 *     et non `PP FRZ-2900 Dtex-Gold 3423-Hs` qui ne leur dit rien ;
 *   - LE CODE COULEUR EST LE LEUR — 7612, 3423, CB-1426 ;
 *   - la quantite s'exprime en LOTS, PALETTES ou BOBINES. JAMAIS EN KILOS :
 *     sur 109 bons, huit seulement portaient un poids, et le kilo est notre
 *     unite de stock, pas la leur ;
 *   - le pied de page porte INCOTERMS, TOLERENCE, SHIPMENT DATE, NBR OF
 *     CONTAINERS et TOTAL PALLETS — les cinq mentions que lit le transitaire.
 *
 * ET LE MONTANT ENGAGE ? Il est a l'ecran du bon, ou il sert : a la saisie, a
 * l'arbitrage, a la validation. Il n'est pas sur le papier qu'on envoie.
 */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Chargement } from '../composants/ui/base'
import { fmt } from '../components/ui'
import { useParamVue } from '../lib/navigation'

interface Bc {
  id_bc: string
  numero_bc: string
  date_bc: string
  fournisseur_nom: string
  code_fournisseur: string
  date_livraison_prevue: string | null
  statut: string
  /** Lus depuis la fiche du fournisseur, pas recopies sur le bon. */
  incoterm?: string | null
  tolerance_pesee_pct?: number | null
  palettes_par_conteneur?: number | null
  /** Force le calcul quand le transitaire en decide autrement. */
  nombre_conteneurs?: number | null
  /** « As soon as possible » — une phrase la ou l'ERP attend une date. */
  mention_expedition?: string | null
  [k: string]: unknown
}

interface LigneBc {
  id_ligne_bc: string
  ligne_numero: number
  type_ligne?: string
  code_reference: string | null
  libelle?: string | null
  reference_designation: string
  description_commerciale?: string | null
  couleur?: string | null
  code_couleur?: string | null
  /** Le titrage : chez nous c'est la famille — « 2900-DTEX ». */
  code_famille?: string | null
  categorie_libelle?: string | null
  unite_commande: string
  quantite_commandee_unite: number
  quantite_commandee_kg: number
  nb_palettes?: number | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  bobines_par_lot?: number | null
  [k: string]: unknown
}

/** Un couple libelle / valeur, aligne pour le papier. */
function Champ({ libelle, valeur }: { libelle: string; valeur: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-neutral-600">{libelle} :</span>
      <span className="font-medium">{valeur ?? '—'}</span>
    </div>
  )
}

/** Les bobines d'une ligne, quand la reference porte de quoi les compter. */
function bobinesDe(l: LigneBc): number | null {
  const p = l.poids_bobine_kg ?? 0
  if (!(p > 0)) return null
  return Math.round(l.quantite_commandee_kg / p)
}

export function BonCommandeEtat() {
  const { id } = useParams<{ id: string }>()
  const auto = useParamVue('imprimer') === '1'

  const qBc = useQuery({
    queryKey: ['bons-commande'],
    queryFn: () => api.get<Bc[]>('/api/bons-commande'),
  })
  const qLignes = useQuery({
    queryKey: ['lignes-bc', id],
    queryFn: () => api.get<LigneBc[]>(`/api/bons-commande/${id}/lignes`),
    enabled: !!id,
  })

  if (qBc.isLoading || qLignes.isLoading) return <Chargement texte="Preparing the document…" />
  const bc = qBc.data?.find((b) => b.id_bc === id) ?? null
  if (!bc) return <Alerte ton="danger">Bon de commande introuvable.</Alerte>

  // LES PRESTATIONS NE PARTENT PAS. Un forfait de transport ou une commission
  // regarde notre comptabilite, pas l'atelier qui doit filer la marchandise.
  const lignes = [...(qLignes.data ?? [])]
    .filter((l) => l.type_ligne !== 'SERVICE')
    .sort((a, b) => a.ligne_numero - b.ligne_numero)

  const valide = bc.statut !== 'BROUILLON'

  // Le total des palettes : c'est le chiffre du transitaire, et celui que
  // portaient tous les bons d'archive en bas de page.
  const palettes = lignes.reduce((s, l) => s + (l.nb_palettes ?? 0), 0)
  const totalPalettes = palettes > 0 ? Math.ceil(palettes) : null

  // LE NOMBRE DE CONTENEURS SE DEDUIT, ET SE FORCE. Sans `palettes_par_conteneur`
  // sur la fiche du fournisseur, on n'affiche rien plutot qu'un zero : mieux
  // vaut une mention absente qu'un chiffre faux sur un document d'expedition.
  const parConteneur = bc.palettes_par_conteneur ?? null
  const conteneursCalcules =
    totalPalettes !== null && parConteneur ? Math.ceil(totalPalettes / parConteneur) : null
  const conteneurs = bc.nombre_conteneurs ?? conteneursCalcules

  return (
    <div>
      {!valide && (
        <Alerte ton="alerte" className="sans-impression mb-3">
          Ce bon est encore en brouillon. Le document portera la mention « DRAFT » : il se relit,
          il ne s envoie pas.
        </Alerte>
      )}
      {lignes.some((l) => !l.description_commerciale) && (
        <Alerte ton="info" className="sans-impression mb-3">
          Certaines lignes n ont pas de description commerciale : leur designation interne partira
          a sa place. Renseignez-la au catalogue pour que le fournisseur reconnaisse l article.
        </Alerte>
      )}

      <EtatImprimable
        titre="PURCHASE ORDER"
        reference={bc.numero_bc}
        sousTitre={valide ? undefined : 'DRAFT — do not send'}
        auto={auto}
        enTete={
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <div className="space-y-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                Supplier
              </div>
              <div className="text-[13px] font-semibold">{bc.fournisseur_nom}</div>
            </div>
            <div className="space-y-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                Order
              </div>
              <Champ libelle="Date" valeur={fmt.date(bc.date_bc)} />
<<<<<<< HEAD
              <Champ libelle="Order N°" valeur={bc.numero_bc} />
=======
              <Champ
                libelle="Livraison prévue"
                valeur={bc.date_livraison_prevue ? fmt.date(bc.date_livraison_prevue) : '—'}
              />
              <Champ libelle="Devise" valeur={bc.code_devise} />
              {prixVisibles && bc.code_devise !== 'MAD' && (
                <Champ
                  libelle="Taux engage"
                  valeur={`${fmt.nombre(bc.taux_change_engage, 4)} MAD`}
                />
              )}
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
            </div>
          </div>
        }
      >
        {/* « New order » ouvrait chacun des 109 bons d'archive. C'est la phrase
            que le correspondant cherche en haut du message. */}
        <div className="mb-2 text-[11px] font-semibold">New order</div>

        <TableEtat<LigneBc>
          colonnes={[
            {
<<<<<<< HEAD
              entete: 'DESCRIPTION OF GOODS',
              // La description COMMERCIALE d'abord. A defaut, la designation
              // interne — imparfaite, mais preferable a une case vide.
=======
              entete: 'Référence',
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
              valeur: (l) => (
                <span className="text-[10px] font-medium uppercase">
                  {l.description_commerciale || l.reference_designation || l.libelle}
                </span>
              ),
            },
            {
<<<<<<< HEAD
              entete: 'COLOR',
              valeur: (l) => <span className="text-[10px] uppercase">{l.couleur || '—'}</span>,
            },
            {
              entete: 'COLOR CODE',
              // LE CODE DU FOURNISSEUR, pas le notre. C'est par lui qu'il
              // retrouve la teinte dans son propre systeme.
              valeur: (l) => (
                <span className="font-mono text-[10px]">{l.code_couleur || '—'}</span>
              ),
            },
            {
              entete: 'DTEX / DEN',
              // LE TITRAGE EST LA FAMILLE. « 2900-DTEX », « 1200-DENIERS-SHRINK » :
              // c'est le classement interne, et c'est aussi ce que le fournisseur
              // met en face du fil qu'il doit filer.
              valeur: (l) => <span className="text-[10px]">{l.code_famille || '—'}</span>,
            },
            {
              entete: 'QUANTITY',
=======
              entete: 'Quantité',
>>>>>>> b12ddbbaab00dcf9c7e5e767fc70a7998f5a28ca
              numerique: true,
              // LA QUANTITE DANS L'UNITE COMMANDEE, et le detail en dessous.
              // Un lot ne dit rien sans son nombre de bobines : c'est ce que
              // l'atelier doit mettre en production.
              valeur: (l) => {
                const bob = bobinesDe(l)
                return (
                  <>
                    <div className="font-medium">
                      {fmt.nombre(l.quantite_commandee_unite, 2)}{' '}
                      {l.unite_commande === 'Lot'
                        ? 'LOT'
                        : l.unite_commande === 'Palette'
                          ? 'PLTS'
                          : l.unite_commande === 'Bobine'
                            ? 'BOBINS'
                            : l.unite_commande}
                    </div>
                    {bob !== null && l.unite_commande !== 'Bobine' && (
                      <div className="text-[9px] text-neutral-600">
                        {fmt.nombre(bob, 0)} bobins
                      </div>
                    )}
                  </>
                )
              },
            },
            {
              entete: 'TOTAL PLTS',
              numerique: true,
              valeur: (l) =>
                l.nb_palettes == null ? '—' : fmt.nombre(Math.ceil(l.nb_palettes), 0),
            },
          ]}
          lignes={lignes}
          // La ligne de total ne porte QUE les palettes. Additionner des lots
          // et des palettes n'aurait aucun sens, et un total en kilos ne dirait
          // rien a qui charge un camion.
          total={
            totalPalettes === null
              ? undefined
              : ['TOTAL', '', '', '', '', fmt.nombre(totalPalettes, 0)]
          }
        />

        {/* LE PIED DE PAGE EST LE DOCUMENT D'EXPEDITION. Ces cinq mentions
            figuraient sur la quasi-totalite des bons d'archive, et ce sont
            elles que lisent le transitaire et la douane. */}
        <div className="mt-4 space-y-0.5 text-[10px]">
          <div>
            <span className="font-semibold">INCOTERMS : </span>
            {bc.incoterm || 'CFR TANGIER'}
          </div>
          <div>
            <span className="font-semibold">TOLERENCE QUANTITY : </span>
            {bc.tolerance_pesee_pct != null
              ? `+/- ${fmt.nombre(bc.tolerance_pesee_pct, 0)} %`
              : '—'}
          </div>
          <div>
            <span className="font-semibold">SHIPMENT DATE : </span>
            {bc.mention_expedition ||
              (bc.date_livraison_prevue ? fmt.date(bc.date_livraison_prevue) : 'As soon as possible')}
          </div>
          {conteneurs !== null && (
            <div>
              <span className="font-semibold">NBR OF CONTAINERS : </span>
              {fmt.nombre(conteneurs, 0)}
              {bc.nombre_conteneurs == null && parConteneur && (
                <span className="text-neutral-600">
                  {' '}
                  ({fmt.nombre(parConteneur, 0)} pallets per container)
                </span>
              )}
            </div>
          )}
          {totalPalettes !== null && (
            <div>
              <span className="font-semibold">TOTAL PALLETS : </span>
              {fmt.nombre(totalPalettes, 0)}
            </div>
          )}
        </div>
      </EtatImprimable>
    </div>
  )
}

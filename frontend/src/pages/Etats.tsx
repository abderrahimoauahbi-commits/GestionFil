/**
 * Les etats imprimables, tous au meme endroit.
 *
 * POURQUOI UN CENTRE PLUTOT QU'UN BOUTON PAR ECRAN. Un bouton sur la fiche vaut
 * pour les documents qui SUIVENT UN OBJET : ce bon de commande, cette
 * reception, ce transfert. Il ne vaut rien pour les etats qui portent sur une
 * SITUATION — le stock du jour, le plan d'achat de la semaine, la feuille de
 * comptage a preparer. Ceux-la ne partent d'aucune fiche : on les demande.
 *
 * Les deux coexistent donc : le bouton sur les documents, ce centre pour les
 * situations. Chacun d'eux ouvre une page qui se lit a l'ecran et s'imprime
 * telle quelle — aucun format intermediaire, aucun fichier a ouvrir ailleurs.
 *
 * TOUT PASSE PAR LES DROITS. Chaque etat declare son module ; un role qui ne
 * lit pas ce module ne voit pas l'entree, et l'ouvrir directement par l'adresse
 * renvoie un refus du serveur. L'ecran ne fait que masquer ce que le serveur
 * refuserait de toute facon.
 */
import { useQuery } from '@tanstack/react-query'
import {
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  Gauge,
  Library,
  Package,
  Printer,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { Carte, CarteCorps, CarteEntete, CarteTitre } from '../composants/ui/base'
import { useOuvrirVue } from '../lib/navigation'
import { cn } from '../lib/utils'

interface EtatDisponible {
  cle: string
  titre: string
  description: string
  chemin: string
  module: string
  Icone: LucideIcon
  famille: string
  /** Compte affiche a cote de l'entree, quand il eclaire la decision. */
  compte?: (d: Comptes) => string | null
}

interface Comptes {
  inventairesOuverts: number
  propositions: number
  refsEnAlerte: number
  receptionsEnCours: number
}

const ETATS: EtatDisponible[] = [
  /* --- Situations de stock ---------------------------------------------- */
  {
    cle: 'stock',
    titre: 'Etat des stocks',
    description:
      'Quantites par magasin, stock projete, couverture et statut. La photo du jour, celle qu on affiche au mur du magasin.',
    chemin: '/etats/stock',
    module: 'STOCK',
    Icone: Boxes,
    famille: 'Stock',
    compte: (d) => (d.refsEnAlerte ? `${d.refsEnAlerte} en alerte` : null),
  },
  {
    cle: 'comptage',
    titre: 'Feuille de comptage',
    description:
      'La liste des references d un magasin avec une colonne VIDE a remplir a la main. C est le document qu on emporte dans les allees, avant de saisir.',
    chemin: '/etats/comptage',
    module: 'INVENTAIRE',
    Icone: ClipboardList,
    famille: 'Stock',
  },
  {
    cle: 'inventaire',
    titre: 'Proces-verbal d inventaire',
    description:
      'Comptage, theorique, ecart et justification, pour un inventaire cloture. Le document qui fait foi.',
    chemin: '/etats/inventaire',
    module: 'INVENTAIRE',
    Icone: ClipboardList,
    famille: 'Stock',
    compte: (d) => (d.inventairesOuverts ? `${d.inventairesOuverts} en cours` : null),
  },

  /* --- Achats ------------------------------------------------------------ */
  {
    cle: 'plan-achat',
    titre: 'Plan d achat a engager',
    description:
      'Propositions groupees par fournisseur, avec quantites, delais et montants. Le document de la revue d achats.',
    chemin: '/etats/plan-achat',
    module: 'PLAN_ACHAT',
    Icone: ShoppingCart,
    famille: 'Achats',
    compte: (d) => (d.propositions ? `${d.propositions} propositions` : null),
  },
  {
    cle: 'receptions',
    titre: 'Journal des receptions',
    description:
      'Receptions de la periode, avec bon de commande, fournisseur, ecarts de pesee et statut qualite.',
    chemin: '/etats/receptions',
    module: 'RECEPTIONS',
    Icone: Package,
    famille: 'Achats',
    compte: (d) => (d.receptionsEnCours ? `${d.receptionsEnCours} en cours` : null),
  },

  /* --- Production -------------------------------------------------------- */
  {
    cle: 'plan-production',
    titre: 'Plan de production',
    description:
      'Metres carres par qualite et par mois, sur l horizon du plan en service, avec les totaux.',
    chemin: '/etats/plan-production',
    module: 'PLANS',
    Icone: Gauge,
    famille: 'Production',
  },
  {
    cle: 'besoins',
    titre: 'Besoins matiere',
    description:
      'Kilos par reference et par mois, issus de l explosion des recettes. Le document de l acheteur.',
    chemin: '/etats/besoins',
    module: 'MRP',
    Icone: FileSpreadsheet,
    famille: 'Production',
  },

  /* --- Mouvements -------------------------------------------------------- */
  {
    cle: 'mouvements',
    titre: 'Grand livre des mouvements',
    description:
      'Entrees et sorties de la periode, avec type, magasin, lot et auteur. Le registre a archiver.',
    chemin: '/etats/mouvements',
    module: 'MOUVEMENTS',
    Icone: Truck,
    famille: 'Mouvements',
  },

  /* --- Referentiels ------------------------------------------------------ */
  {
    cle: 'catalogue',
    titre: 'Catalogue des references',
    description:
      'La liste complete, avec categorie, unite, fournisseur et politique de reapprovisionnement.',
    chemin: '/etats/catalogue',
    module: 'CATALOGUE',
    Icone: Library,
    famille: 'Referentiels',
  },
  {
    cle: 'fournisseurs',
    titre: 'Repertoire fournisseurs',
    description: 'Coordonnees, devise, delai et conditions de paiement.',
    chemin: '/etats/fournisseurs',
    module: 'FOURNISSEURS',
    Icone: Library,
    famille: 'Referentiels',
  },
]

export function Etats() {
  const { peut } = useAuth()
  const ouvrir = useOuvrirVue()

  /* Les compteurs viennent du cockpit, deja charge ailleurs : la meme cle de
     requete evite un second appel quand on arrive depuis le poste de travail. */
  const q = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<Record<string, number>>('/api/cockpit'),
  })
  const k = q.data ?? {}
  const comptes: Comptes = {
    inventairesOuverts: 0,
    propositions: k.nb_propositions_a_traiter ?? 0,
    refsEnAlerte: (k.nb_ruptures ?? 0) + (k.nb_critiques ?? 0) + (k.nb_attention ?? 0),
    receptionsEnCours: (k.nb_receptions_en_saisie ?? 0) + (k.nb_receptions_a_controler ?? 0),
  }

  const visibles = ETATS.filter((e) => peut(e.module, 'LIRE'))
  const familles = [...new Set(visibles.map((e) => e.famille))]

  return (
    <div>
      <EnTetePage
        titre="Etats imprimables"
        sous_titre="Les documents qui portent sur une situation. Ceux qui suivent un objet s impriment depuis sa fiche."
      />

      <div className="flex flex-col gap-5">
        {familles.map((f) => (
          <section key={f}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte">
              {f}
            </h2>
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {visibles
                .filter((e) => e.famille === f)
                .map((e) => {
                  const compte = e.compte?.(comptes)
                  return (
                    <Carte
                      key={e.cle}
                      className="cursor-pointer transition-colors hover:border-primaire/40"
                    >
                      <button
                        type="button"
                        onClick={() => ouvrir(e.chemin)}
                        className="flex h-full w-full flex-col items-start gap-1.5 p-3.5 text-left"
                      >
                        <div className="flex w-full items-center gap-2">
                          <e.Icone className="size-4 shrink-0 text-primaire" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                            {e.titre}
                          </span>
                          {compte && (
                            <span className="shrink-0 rounded-[3px] bg-alerte/12 px-1.5 py-px text-[10px] font-medium text-alerte">
                              {compte}
                            </span>
                          )}
                          <Printer className="size-3.5 shrink-0 text-attenue-texte" />
                        </div>
                        <p className="text-[11.5px] leading-relaxed text-attenue-texte">
                          {e.description}
                        </p>
                      </button>
                    </Carte>
                  )
                })}
            </div>
          </section>
        ))}
      </div>

      {/* Les documents attaches a un objet, pour qu'on ne les cherche pas ici. */}
      <Carte className="mt-5">
        <CarteEntete>
          <CarteTitre className="text-[12px]">Documents attaches a un objet</CarteTitre>
        </CarteEntete>
        <CarteCorps className="text-[12px] leading-relaxed text-attenue-texte">
          <p>
            Le <span className="text-texte">bon de commande</span>, le{' '}
            <span className="text-texte">bon de sortie</span> et le{' '}
            <span className="text-texte">bon de reception</span> d un transfert s impriment depuis
            leur propre fiche, avec le bouton <span className="text-texte">Imprimer</span>. Ils
            portent un numero et engagent l entreprise : les editer depuis une liste ferait perdre
            le lien avec le document dont ils sont la copie.
          </p>
        </CarteCorps>
      </Carte>
    </div>
  )
}

/** Classe partagee par les cadres d'etat, pour ne pas la repeter. */
export const CADRE_ETAT = cn('rounded-[var(--radius)] border border-bordure bg-surface')

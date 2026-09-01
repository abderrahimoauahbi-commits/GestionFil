/**
 * Historique des prix d'achat.
 *
 * La table `historique_prix` est alimentee par la reception : un prix n'y entre
 * que lorsqu'une marchandise a ete PESEE et CONTROLEE. Ce n'est donc pas un
 * tarif fournisseur, c'est ce qui a reellement ete paye — la difference compte
 * au moment de negocier.
 *
 * L'ecran ne recalcule rien. Le prix precedent de la meme reference est fourni
 * par le serveur (fonction LAG), et l'ecart s'en deduit. Le recalculer ici
 * supposerait d'avoir toute l'histoire en memoire, ce qui cesse d'etre vrai des
 * que la table depasse la page demandee.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail } from '../composants/RailLateral'
import { PanneauFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { TableDroits, type Colonne } from '../components/TableDroits'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'
import { useEtatDepuisParam } from '../lib/navigation'

const MODULE = 'CATALOGUE'

interface LignePrix {
  id_histo_prix: string
  code_reference: string
  designation: string | null
  code_fournisseur: string | null
  fournisseur_nom: string | null
  date_achat: string
  prix_kg_devise: number | null
  code_devise: string | null
  taux_change: number | null
  prix_kg_mad: number | null
  prix_precedent_mad: number | null
  quantite_achetee_kg: number | null
  total_mad: number | null
  numero_bc: string | null
  numero_reception: string | null
  [k: string]: unknown
}

const CHAMPS: ChampFiltre<LignePrix>[] = [
  { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', valeur: (l) => l.fournisseur_nom },
  { cle: 'devise', libelle: 'Devise', type: 'liste', valeur: (l) => l.code_devise },
  { cle: 'reference', libelle: 'Reference', type: 'texte', valeur: (l) => l.code_reference },
  { cle: 'periode', libelle: "Periode d'achat", type: 'periode', valeur: (l) => l.date_achat },
]

/** Ecart avec l'achat precedent de la MEME reference, en pourcentage. */
function ecart(l: LignePrix): number | null {
  if (l.prix_kg_mad == null || l.prix_precedent_mad == null || l.prix_precedent_mad === 0) {
    return null
  }
  return ((l.prix_kg_mad - l.prix_precedent_mad) / l.prix_precedent_mad) * 100
}

export function HistoriquePrix() {
  const droits = useDroits(MODULE)
  const [ref, setRef] = useEtatDepuisParam('reference')
  const filtres = useFiltres(CHAMPS)

  const params = new URLSearchParams({ limite: '500' })
  if (ref) params.set('code_reference', ref)

  const q = useQuery({
    queryKey: ['historique-prix', ref],
    queryFn: () => api.get<LignePrix[]>(`/api/historique-prix?${params}`),
  })

  const toutes = q.data ?? []
  const vues = toutes.filter(filtres.retenir)

  /* Trois chiffres qui repondent a la seule question posee a cet ecran :
     est-ce que ca monte ? Ils portent sur ce qui est AFFICHE, pas sur toute la
     table — un resume qui ignorerait les filtres dirait autre chose que le
     tableau juste en dessous. */
  const resume = useMemo(() => {
    const compares = vues.filter((l) => l.prix_precedent_mad != null).length
    const avecEcart = vues.map(ecart).filter((e): e is number => e != null)
    const hausses = avecEcart.filter((e) => e > 0.01)
    const baisses = avecEcart.filter((e) => e < -0.01)
    return {
      compares,
      hausses: hausses.length,
      baisses: baisses.length,
      moyenne: avecEcart.length
        ? avecEcart.reduce((s, e) => s + e, 0) / avecEcart.length
        : null,
    }
  }, [vues])

  const colonnes: Colonne<LignePrix>[] = [
    {
      champ: 'date_achat',
      entete: 'Date',
      rendu: (l) => <span className="tabular-nums">{(l.date_achat ?? '').slice(0, 10)}</span>,
    },
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px]">{l.code_reference}</div>
          {l.designation && (
            <div className="truncate text-[11px] text-attenue-texte">{l.designation}</div>
          )}
        </div>
      ),
    },
    { champ: 'fournisseur_nom', entete: 'Fournisseur' },
    {
      champ: 'prix_kg_devise',
      entete: 'Prix devise',
      numerique: true,
      rendu: (l) =>
        l.prix_kg_devise == null ? '—' : (
          <span className="tabular-nums">
            {fmt.nombre(l.prix_kg_devise, 2)} {l.code_devise ?? ''}
          </span>
        ),
    },
    {
      champ: 'taux_change',
      entete: 'Taux',
      numerique: true,
      secondaire: true,
      rendu: (l) => (l.taux_change == null ? '—' : fmt.nombre(l.taux_change, 4)),
    },
    {
      champ: 'prix_kg_mad',
      entete: 'Prix MAD/kg',
      numerique: true,
      rendu: (l) =>
        l.prix_kg_mad == null ? '—' : (
          <span className="font-medium tabular-nums">{fmt.nombre(l.prix_kg_mad, 2)}</span>
        ),
    },
    {
      champ: 'prix_precedent_mad',
      entete: 'Achat precedent',
      numerique: true,
      secondaire: true,
      rendu: (l) =>
        l.prix_precedent_mad == null ? (
          <span className="text-attenue-texte">premier achat</span>
        ) : (
          <span className="tabular-nums">{fmt.nombre(l.prix_precedent_mad, 2)}</span>
        ),
    },
    {
      champ: 'ecart',
      entete: 'Evolution',
      numerique: true,
      rendu: (l) => {
        const e = ecart(l)
        if (e == null) return <span className="text-attenue-texte">—</span>
        // Le seuil a 0,01 % evite de peindre en rouge un ecart d'arrondi : deux
        // achats au meme prix produisent parfois 0,000001 % apres conversion.
        const monte = e > 0.01
        const baisse = e < -0.01
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px tabular-nums',
              monte ? 'bg-danger/12 font-medium text-danger'
                : baisse ? 'bg-succes/12 text-succes'
                : 'text-attenue-texte',
            )}
          >
            {monte && <TrendingUp className="size-3" />}
            {baisse && <TrendingDown className="size-3" />}
            {e > 0 ? '+' : ''}
            {fmt.nombre(e, 1)} %
          </span>
        )
      },
    },
    {
      champ: 'quantite_achetee_kg',
      entete: 'Quantite',
      numerique: true,
      secondaire: true,
      rendu: (l) =>
        l.quantite_achetee_kg == null ? '—' : `${fmt.nombre(l.quantite_achetee_kg, 0)} kg`,
    },
    {
      champ: 'total_mad',
      entete: 'Total MAD',
      numerique: true,
      rendu: (l) => (l.total_mad == null ? '—' : fmt.nombre(l.total_mad, 2)),
    },
    {
      champ: 'numero_bc',
      entete: 'Origine',
      secondaire: true,
      rendu: (l) => (
        <span className="font-mono text-[11px] text-attenue-texte">
          {l.numero_bc ?? l.numero_reception ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Historique des prix"
        sous_titre="Prix reellement payes, enregistres a la reception — pas les tarifs annonces"
      />

      <PageAvecRail
        large
        rail={
          <PanneauFiltres
            champs={CHAMPS}
            lignes={toutes}
            valeurs={filtres.valeurs}
            definir={filtres.definir}
            reinitialiser={filtres.reinitialiser}
            actifs={filtres.actifs}
            enTete={
              ref ? (
                <button
                  onClick={() => setRef('')}
                  className="w-full rounded-[var(--radius)] border border-bordure px-2 py-1.5 text-left text-[12px] hover:bg-attenue"
                >
                  <span className="text-attenue-texte">Reference : </span>
                  <span className="font-mono">{ref}</span>
                  <span className="text-attenue-texte"> — tout voir</span>
                </button>
              ) : undefined
            }
          />
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-attenue-texte">
          <span>
            {vues.length} achat(s)
            {vues.length !== toutes.length && ` sur ${toutes.length}`}
          </span>
          {resume.hausses > 0 && (
            <span className="text-danger">{resume.hausses} en hausse</span>
          )}
          {resume.baisses > 0 && (
            <span className="text-succes">{resume.baisses} en baisse</span>
          )}
          {resume.moyenne != null && (
            <span>
              evolution moyenne {resume.moyenne > 0 ? '+' : ''}
              {fmt.nombre(resume.moyenne, 1)} %
            </span>
          )}
        </div>

        {/* Sur la base actuelle, les 119 achats portent sur 119 references
            distinctes : aucune n'a encore ete rachetee, donc la colonne
            Evolution est vide partout. Le dire vaut mieux que d'aligner cent
            tirets, qu'on lit comme une panne. La colonne se remplira d'
            elle-meme au deuxieme achat d'une meme reference. */}
        {vues.length > 0 && resume.compares === 0 && (
          <p className="mb-2 rounded-[var(--radius)] border border-bordure bg-attenue/40 px-2.5 py-1.5 text-[12px] text-attenue-texte">
            Aucune comparaison possible : chacune de ces references n a ete achetee qu une seule
            fois. La colonne « Evolution » se remplira au rachat de l une d elles.
          </p>
        )}

        <TableDroits
          module={MODULE}
          colonnes={colonnes}
          lignes={vues}
          chargement={q.isLoading}
          cle={(l) => l.id_histo_prix}
          titreCarte={(l) => `${l.code_reference} · ${(l.date_achat ?? '').slice(0, 10)}`}
          texteVide={
            droits.peutLire
              ? "Aucun achat enregistre. L'historique se remplit a la validation des receptions."
              : 'Module non accessible.'
          }
        />
      </PageAvecRail>
    </div>
  )
}

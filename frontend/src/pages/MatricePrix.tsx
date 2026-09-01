/**
 * Matrice des prix : une reference par ligne, un mois par colonne.
 *
 * CE QU'ELLE APPORTE QUE LA LISTE N'APPORTE PAS. L'ecran Historique des prix
 * montre les memes achats en ordre chronologique. Pour savoir si une reference
 * derive, il y faut comparer deux lignes separees par vingt autres. Ici la
 * ligne se lit d'un trait : une reference qui monte se voit sans la chercher.
 *
 * LE PRIX D'UN MOIS EST PONDERE PAR LES QUANTITES. Deux achats le meme mois,
 * l'un de 30 tonnes a 25 MAD et l'autre de 200 kg a 40 MAD, donnent 25,1 et non
 * 32,5. Le calcul est fait par le serveur, comme dans le classeur.
 *
 * L'ECRAN NE MASQUE RIEN LUI-MEME. `prix_moyen_mad` est un champ sensible : le
 * serveur ne l'envoie qu'a la direction. Pour les autres roles la colonne
 * arrive absente, et la matrice le dit au lieu d'afficher une grille vide.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { PageAvecRail } from '../composants/RailLateral'
import { PanneauFiltres, useFiltres, type ChampFiltre } from '../composants/PanneauFiltres'
import { Alerte, Carte, CarteCorps, Chargement, EtatVide, Selecteur } from '../composants/ui/base'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'

const MODULE = 'CATALOGUE'

interface Case {
  code_reference: string
  designation: string | null
  code_fournisseur: string | null
  fournisseur_nom: string | null
  annee_mois: string
  prix_moyen_mad?: number | null
  quantite_kg?: number | null
  nb_achats?: number | null
  [k: string]: unknown
}

interface Ligne {
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  /** Prix par mois, indexe sur 'AAAA-MM'. Un mois sans achat est absent. */
  prix: Map<string, number>
  quantites: Map<string, number>
  premier: number | null
  dernier: number | null
}

const CHAMPS: ChampFiltre<Ligne>[] = [
  { cle: 'fournisseur', libelle: 'Fournisseur', type: 'liste', valeur: (l) => l.fournisseur_nom },
  { cle: 'reference', libelle: 'Reference', type: 'texte', valeur: (l) => l.code_reference },
]

/** Libelle court d'un mois : « août 26 ». */
function moisCourt(am: string): string {
  const [a, m] = am.split('-')
  const noms = ['janv', 'fevr', 'mars', 'avr', 'mai', 'juin', 'juil', 'aout', 'sept', 'oct', 'nov', 'dec']
  return `${noms[Number(m) - 1] ?? m} ${a.slice(2)}`
}

export function MatricePrix() {
  const droits = useDroits(MODULE)
  const [horizon, setHorizon] = useState('12')
  const filtres = useFiltres(CHAMPS)

  const q = useQuery({
    queryKey: ['matrice-prix'],
    queryFn: () => api.get<Case[]>('/api/matrice-prix?limite=2000'),
  })

  /* Le serveur rend une liste de cases ; le pivot se fait ici, sur les seules
     lignes recues. Demander au serveur une grille deja pivotee l'obligerait a
     connaitre l'horizon choisi, qui est une preference d'affichage. */
  const { lignes, mois, prixVisible } = useMemo(() => {
    const cases = q.data ?? []
    const visible = cases.length === 0 || 'prix_moyen_mad' in cases[0]

    const tousMois = [...new Set(cases.map((c) => c.annee_mois))].sort()
    const retenus = tousMois.slice(-Number(horizon))
    const gardes = new Set(retenus)

    const par = new Map<string, Ligne>()
    for (const c of cases) {
      if (!gardes.has(c.annee_mois)) continue
      let l = par.get(c.code_reference)
      if (!l) {
        l = {
          code_reference: c.code_reference,
          designation: c.designation,
          fournisseur_nom: c.fournisseur_nom,
          prix: new Map(),
          quantites: new Map(),
          premier: null,
          dernier: null,
        }
        par.set(c.code_reference, l)
      }
      if (c.prix_moyen_mad != null) l.prix.set(c.annee_mois, c.prix_moyen_mad)
      if (c.quantite_kg != null) l.quantites.set(c.annee_mois, c.quantite_kg)
    }
    for (const l of par.values()) {
      const suite = retenus.map((m) => l.prix.get(m)).filter((v): v is number => v != null)
      l.premier = suite.length ? suite[0] : null
      l.dernier = suite.length ? suite[suite.length - 1] : null
    }
    return {
      lignes: [...par.values()].sort((a, b) => a.code_reference.localeCompare(b.code_reference)),
      mois: retenus,
      prixVisible: visible,
    }
  }, [q.data, horizon])

  const vues = lignes.filter(filtres.retenir)

  /* Une ligne « derive » si son dernier prix connu depasse son premier de plus
     de 1 %. En dessous, c'est du bruit d'arrondi ou de taux de change. */
  const derive = vues.filter(
    (l) => l.premier != null && l.dernier != null && (l.dernier - l.premier) / l.premier > 0.01,
  ).length

  return (
    <div>
      <EnTetePage
        titre="Matrice des prix"
        sous_titre="Prix moyen pondere par mois — la ligne se lit d un trait, la derive se voit sans la chercher"
        actions={
          <Selecteur value={horizon} onChange={(e) => setHorizon(e.target.value)} className="w-36">
            <option value="6">6 derniers mois</option>
            <option value="12">12 derniers mois</option>
            <option value="24">24 derniers mois</option>
            <option value="36">36 derniers mois</option>
          </Selecteur>
        }
      />

      <PageAvecRail
        large
        rail={
          <PanneauFiltres
            champs={CHAMPS}
            lignes={lignes}
            valeurs={filtres.valeurs}
            definir={filtres.definir}
            reinitialiser={filtres.reinitialiser}
            actifs={filtres.actifs}
          />
        }
      >
        {q.isLoading ? (
          <Chargement texte="Agregation des achats par mois…" />
        ) : !prixVisible ? (
          <Alerte ton="info">
            Le prix moyen est un champ sensible : votre role ne le recoit pas. La matrice n a
            donc rien a croiser. Les quantites achetees restent consultables dans l historique
            des prix.
          </Alerte>
        ) : !vues.length ? (
          <EtatVide
            icone={Minus}
            titre="Aucun achat sur la periode"
            description="La matrice se remplit a la validation des receptions."
          />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-attenue-texte">
              <span>
                {vues.length} reference(s) · {mois.length} mois
              </span>
              {derive > 0 ? (
                <span className="text-danger">{derive} en hausse sur la periode</span>
              ) : (
                <span>aucune hausse superieure a 1 % sur la periode</span>
              )}
              {mois.length === 1 && (
                <span>
                  un seul mois d achats : la comparaison mensuelle demande un second
                  approvisionnement
                </span>
              )}
            </div>

            <Carte>
              <CarteCorps className="p-0">
                <div className="defilement-x">
                  <table className="grille w-full text-[12px]">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-attenue">
                        <th className="sticky left-0 z-20 bg-attenue px-2.5 py-1.5 text-left font-semibold">
                          Reference
                        </th>
                        {mois.map((m) => (
                          <th
                            key={m}
                            className="whitespace-nowrap px-2.5 py-1.5 text-right font-semibold tabular-nums"
                          >
                            {moisCourt(m)}
                          </th>
                        ))}
                        <th className="whitespace-nowrap px-2.5 py-1.5 text-right font-semibold">
                          Evolution
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {vues.map((l) => {
                        const ev =
                          l.premier != null && l.dernier != null && l.premier !== 0
                            ? ((l.dernier - l.premier) / l.premier) * 100
                            : null
                        let precedent: number | null = null
                        return (
                          <tr key={l.code_reference} className="hover:bg-attenue/60">
                            <td className="sticky left-0 z-10 max-w-[260px] bg-surface px-2.5 py-1">
                              <div className="truncate font-mono text-[11px]">
                                {l.code_reference}
                              </div>
                              {l.fournisseur_nom && (
                                <div className="truncate text-[10px] text-attenue-texte">
                                  {l.fournisseur_nom}
                                </div>
                              )}
                            </td>
                            {mois.map((m) => {
                              const p = l.prix.get(m)
                              // La comparaison porte sur le mois PRECEDENT OU L'ON A
                              // ACHETE, pas sur la case immediatement a gauche : entre
                              // deux achats il y a souvent des mois vides, et comparer
                              // a du vide ne dit rien.
                              const delta =
                                p != null && precedent != null && precedent !== 0
                                  ? (p - precedent) / precedent
                                  : null
                              if (p != null) precedent = p
                              return (
                                <td
                                  key={m}
                                  className={cn(
                                    'px-2.5 py-1 text-right tabular-nums',
                                    delta != null && delta > 0.01 && 'bg-danger/10 text-danger',
                                    delta != null && delta < -0.01 && 'bg-succes/10 text-succes',
                                  )}
                                  title={
                                    p != null
                                      ? `${fmt.nombre(l.quantites.get(m) ?? 0, 0)} kg achetes`
                                      : undefined
                                  }
                                >
                                  {p == null ? (
                                    <span className="text-attenue-texte">·</span>
                                  ) : (
                                    fmt.nombre(p, 2)
                                  )}
                                </td>
                              )
                            })}
                            <td className="whitespace-nowrap px-2.5 py-1 text-right tabular-nums">
                              {ev == null || Math.abs(ev) < 0.01 ? (
                                <span className="text-attenue-texte">—</span>
                              ) : (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px',
                                    ev > 0
                                      ? 'bg-danger/12 font-medium text-danger'
                                      : 'bg-succes/12 text-succes',
                                  )}
                                >
                                  {ev > 0 ? (
                                    <TrendingUp className="size-3" />
                                  ) : (
                                    <TrendingDown className="size-3" />
                                  )}
                                  {ev > 0 ? '+' : ''}
                                  {fmt.nombre(ev, 1)} %
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CarteCorps>
            </Carte>

            <p className="mt-2 text-[11px] text-attenue-texte">
              Une case colorée signale un écart de plus de 1 % avec le mois d achat précédent —
              pas avec la case voisine : entre deux achats il y a souvent des mois sans commande.
              Le point « · » marque un mois sans achat.
              {!droits.visible('prix_moyen_mad') && ' Certaines colonnes sont masquées par vos droits.'}
            </p>
          </>
        )}
      </PageAvecRail>
    </div>
  )
}

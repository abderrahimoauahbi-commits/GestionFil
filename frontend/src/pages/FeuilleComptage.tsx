/**
 * LA FEUILLE QU'ON EMPORTE DANS L'ALLEE.
 *
 * IL N'Y EN AVAIT PAS. L'ecran d'inventaire n'imprimait que le proces-verbal —
 * le document d'APRES le comptage, qui confronte le theorique au compte et
 * aligne les ecarts. Pour compter, il fallait partir sans papier, ou recopier
 * l'ecran a la main.
 *
 * ELLE NE PORTE PAS LE STOCK THEORIQUE, ET C'EST LA REGLE. Un compteur qui lit
 * « 1 344 kg » avant de compter trouve 1 344 kg : il confirme au lieu de compter,
 * et l'inventaire ne mesure plus rien. C'est le comptage a l'aveugle que
 * pratiquent tous les inventaires serieux.
 *
 * ON COMPTE CE QU'ON VOIT : des palettes, des bobines, et du vrac en kilos. La
 * conversion se fait au bureau, a la saisie — d'ou le conditionnement imprime
 * sur chaque ligne. Demander des kilos au magasin, c'est demander une
 * multiplication de tete a quelqu'un qui tient un crayon et une lampe.
 *
 * L'ORDRE EST CELUI DU MAGASIN : la matiere, puis la famille. On parcourt une
 * allee de polypropylene, pas une liste alphabetique de codes.
 */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Chargement } from '../composants/ui/base'
import { fmt } from '../components/ui'

interface Inventaire {
  id_inventaire: string
  numero_inventaire: string
  code_magasin: string
  type_inventaire: string
  statut: string
  [k: string]: unknown
}

interface LigneAComptage {
  code_reference: string
  designation: string | null
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  categorie_libelle?: string | null
  code_famille?: string | null
  reference_fournisseur?: string | null
  [k: string]: unknown
}

/** Une case a remplir au stylo : vide, bordee, assez large pour un chiffre. */
function Case({ largeur = 'w-14' }: { largeur?: string }) {
  return <span className={`inline-block h-5 ${largeur} border border-neutral-400 align-middle`} />
}

export function FeuilleComptage() {
  const { id } = useParams<{ id: string }>()

  const qListe = useQuery({
    queryKey: ['inventaires'],
    queryFn: () => api.get<Inventaire[]>('/api/inventaires'),
  })
  const qLignes = useQuery({
    queryKey: ['lignes-inventaire', id],
    queryFn: () => api.get<LigneAComptage[]>(`/api/inventaires/${id}/lignes`),
    enabled: !!id,
  })

  if (qListe.isLoading || qLignes.isLoading) {
    return <Chargement texte="Preparation de la feuille de comptage…" />
  }
  const d = qListe.data
  const liste = Array.isArray(d) ? d : ((d as unknown as { lignes?: Inventaire[] })?.lignes ?? [])
  const inv = liste.find((x) => x.id_inventaire === id)
  if (!inv) return <Alerte ton="danger">Inventaire introuvable.</Alerte>

  const lignes = qLignes.data ?? []
  if (inv.statut === 'BROUILLON' || lignes.length === 0) {
    return (
      <Alerte ton="info">
        Cet inventaire n’a pas encore de lignes. Ouvrez-le : c’est l’ouverture qui fige le
        périmètre à compter — tout le catalogue pour un inventaire global, le stock existant pour
        un inventaire tournant.
      </Alerte>
    )
  }

  // Regroupement par matiere, dans l'ordre ou le serveur les rend deja. Le
  // numero court d'une matiere a l'autre : c'est lui qu'on reporte en marge
  // quand on se reprend, pas le code de la reference.
  const groupes: { matiere: string; lignes: (LigneAComptage & { rang: number })[] }[] = []
  lignes.forEach((l, i) => {
    const m = l.categorie_libelle ?? 'Sans categorie'
    const dernier = groupes[groupes.length - 1]
    const ligne = { ...l, rang: i + 1 }
    if (dernier && dernier.matiere === m) dernier.lignes.push(ligne)
    else groupes.push({ matiere: m, lignes: [ligne] })
  })

  return (
    <EtatImprimable
      titre="Feuille de comptage"
      reference={inv.numero_inventaire}
      sousTitre={`Magasin ${inv.code_magasin} · inventaire ${inv.type_inventaire.toLowerCase()}`}
      enTete={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-10 gap-y-2">
            <span>
              <span className="text-neutral-600">Date du comptage : </span>
              <span className="inline-block w-28 border-b border-neutral-500" />
            </span>
            <span>
              <span className="text-neutral-600">Compté par : </span>
              <span className="inline-block w-40 border-b border-neutral-500" />
            </span>
            <span>
              <span className="text-neutral-600">Allée / zone : </span>
              <span className="inline-block w-28 border-b border-neutral-500" />
            </span>
          </div>
          {/* LA CONSIGNE EST SUR LE PAPIER, pas dans une formation qu'on a
              oubliee. Trois regles, et chacune evite une erreur courante. */}
          <div className="text-[9.5px] leading-snug text-neutral-700">
            Comptez ce qui est physiquement présent, sans regarder l’écran. Une référence absente du
            magasin : écrivez <strong>0</strong> — une case vide ne veut pas dire zéro, elle veut
            dire « pas compté ». Une palette entamée : comptez ses bobines, pas la palette.
          </div>
        </div>
      }
    >
      {groupes.map((g) => (
        <section key={g.matiere} className="mb-4">
          <h3 className="mb-1 border-b border-black pb-0.5 text-[11px] font-bold uppercase tracking-wide">
            {g.matiere}{' '}
            <span className="font-normal normal-case text-neutral-600">
              — {g.lignes.length} référence(s)
            </span>
          </h3>
          <TableEtat<LigneAComptage & { rang: number }>
            colonnes={[
              { entete: 'N°', numerique: true, valeur: (l) => l.rang },
              {
                entete: 'Référence',
                valeur: (l) => (
                  <>
                    <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                    {l.reference_fournisseur && (
                      <div className="text-[9px] text-neutral-600">
                        Réf. frs {l.reference_fournisseur}
                      </div>
                    )}
                  </>
                ),
              },
              {
                entete: 'Famille',
                valeur: (l) => <span className="text-[10px]">{l.code_famille ?? '—'}</span>,
              },
              {
                entete: 'Conditionnement',
                // Ce qui permet au bureau de convertir sans rappeler l'allee.
                valeur: (l) => (
                  <span className="text-[9px] text-neutral-600">
                    {l.bobines_par_palette ? `${l.bobines_par_palette} bob/pal` : '—'}
                    {l.poids_bobine_kg ? ` · ${fmt.nombre(l.poids_bobine_kg, 2)} kg/bob` : ''}
                  </span>
                ),
              },
              { entete: 'Palettes', valeur: () => <Case /> },
              { entete: 'Bobines', valeur: () => <Case /> },
              { entete: 'Vrac kg', valeur: () => <Case largeur="w-16" /> },
              {
                entete: 'Observation',
                valeur: () => <span className="inline-block h-5 w-32 border-b border-neutral-300" />,
              },
            ]}
            lignes={g.lignes}
          />
        </section>
      ))}

      {/* CE QU'ON TROUVE ET QUI N'EST PAS SUR LA LISTE. Une feuille qui ne
          laisse aucune place a l'imprevu oblige a l'ecrire dans la marge, et
          la marge ne se ressaisit jamais. */}
      <section className="mb-4 break-inside-avoid">
        <h3 className="mb-1 border-b border-black pb-0.5 text-[11px] font-bold uppercase tracking-wide">
          Trouvé hors liste
        </h3>
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-[9px] uppercase text-neutral-600">
              <th className="py-1">Référence ou description</th>
              <th className="py-1">Palettes</th>
              <th className="py-1">Bobines</th>
              <th className="py-1">Vrac kg</th>
              <th className="py-1">Observation</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((i) => (
              <tr key={i} className="h-7 border-b border-neutral-300">
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-[9px] text-neutral-600">
        {lignes.length} ligne(s) à compter. Le stock théorique ne figure pas sur cette feuille : le
        connaître avant de compter fausse le comptage.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-10">
        {['Compté par', 'Saisi par'].map((s) => (
          <div key={s}>
            <div className="mb-10 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
              {s}
            </div>
            <div className="border-t border-neutral-500 pt-1 text-[9px] text-neutral-600">
              Nom, date et signature
            </div>
          </div>
        ))}
      </div>
    </EtatImprimable>
  )
}

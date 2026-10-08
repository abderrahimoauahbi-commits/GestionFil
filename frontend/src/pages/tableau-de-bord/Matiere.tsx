/**
 * Tableau de bord — Matière (06/10/2026).
 *
 * Où part la matière : le stock par catégorie, les familles qui entrent et
 * sortent le plus, la consommation par qualité et par rôle (ancienne vue
 * « Matière »), et la santé du référentiel.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Layers, Shapes, Warehouse } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { CarteStat } from '../../composants/CarteStat'
import { Badge, Squelette } from '../../composants/ui/base'
import { BarresClassees, Colonnes, TON, compact } from '../../composants/graphiques/Visuels'
import { cn, fmt } from '../../lib/utils'
import { BlocFamilles, TableauDeBord } from '../Cockpit'
import { OngletsTableauDeBord } from './Onglets'
import { Bloc, EnPanne, Vide } from './commun'

interface Familles {
  categories: { code_categorie: string; categorie_libelle: string; nb_familles: number; nb_references: number; stock_kg: number; valeur_dhs?: number }[]
  familles: { code_famille: string; famille_libelle: string; annee: string; entrees_kg: number; sorties_kg: number; stock_kg: number; valeur_dhs: number }[]
}
interface Controle {
  code: string
  controle: string
  criticite: string
  anomalies: number
}

export function Matiere() {
  const { peut } = useAuth()
  const lisMvt = peut('MOUVEMENTS', 'LIRE')
  // La valeur par categorie suit la grille des mouvements (08/10/2026).
  const voit = useDroits('MOUVEMENTS').visible('valeur_dhs')
  const q = useQuery({ queryKey: ['stats', 'familles'], queryFn: () => api.get<Familles>('/api/stats/familles'), enabled: lisMvt })
  const qCtl = useQuery({ queryKey: ['controles'], queryFn: () => api.get<Controle[]>('/api/controles') })

  const cats = useMemo(
    () => [...(q.data?.categories ?? [])].sort((a, b) => (b.valeur_dhs ?? 0) - (a.valeur_dhs ?? 0) || b.stock_kg - a.stock_kg),
    [q.data],
  )
  /* Les familles, toutes années confondues : on cumule les lignes par famille. */
  const familles = useMemo(() => {
    const m = new Map<string, { libelle: string; e: number; s: number; stock: number }>()
    for (const f of q.data?.familles ?? []) {
      const x = m.get(f.code_famille) ?? { libelle: f.famille_libelle, e: 0, s: 0, stock: 0 }
      x.e += f.entrees_kg
      x.s += f.sorties_kg
      x.stock = Math.max(x.stock, f.stock_kg)
      m.set(f.code_famille, x)
    }
    return [...m.values()].sort((a, b) => b.e + b.s - (a.e + a.s)).slice(0, 10)
  }, [q.data])
  const totalKg = cats.reduce((s, c) => s + c.stock_kg, 0)
  const totalMad = cats.reduce((s, c) => s + (c.valeur_dhs ?? 0), 0)
  const anomalies = (qCtl.data ?? []).filter((c) => c.anomalies > 0)

  return (
    <div className="space-y-4">
      <EnTetePage titre="Tableau de bord" description="Matière — où est le stock, ce qui entre et sort, et ce que consomment les qualités." />
      <OngletsTableauDeBord />

      {lisMvt && (
        <>
          {q.isError ? (
            <EnPanne quoi="Matière" />
          ) : q.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Squelette key={i} className="h-28" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CarteStat Icone={Warehouse} libelle="Stock en kg" valeur={compact(totalKg)} unite="kg" precision={`${cats.length} catégories`} ton="primaire" />
              <CarteStat Icone={Boxes} libelle="Valeur du stock" valeur={voit ? compact(totalMad) : '—'} unite="MAD" precision="au CMUP" ton="neutre" />
              <CarteStat Icone={Layers} libelle="Familles" valeur={String(cats.reduce((s, c) => s + c.nb_familles, 0))} precision={`${cats.reduce((s, c) => s + c.nb_references, 0)} références`} ton="neutre" />
              <CarteStat Icone={Shapes} libelle="Catégorie la plus lourde" valeur={cats[0] && voit ? `${fmt.nombre(totalMad ? ((cats[0].valeur_dhs ?? 0) / totalMad) * 100 : 0, 0)} %` : cats[0] ? `${compact(cats[0].stock_kg)} kg` : '—'} precision={cats[0]?.categorie_libelle ?? '—'} ton="alerte" />
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <Bloc className="xl:col-span-2" titre="Entrées et sorties par famille" sousTitre="Les dix familles les plus actives, en kg" lien={{ vers: '/statistiques', libelle: 'Statistiques' }}>
              {familles.length === 0 ? (
                <Vide texte="Pas encore de mouvement par famille." />
              ) : (
                <Colonnes
                  libelles={familles.map((f) => f.libelle.slice(0, 12))}
                  unite="kg"
                  series={[
                    { cle: 'e', libelle: 'Entrées', valeurs: familles.map((f) => f.e), couleur: TON.primaire },
                    { cle: 's', libelle: 'Sorties', valeurs: familles.map((f) => f.s), couleur: TON.secondaire },
                  ]}
                />
              )}
            </Bloc>
            <Bloc titre={voit ? 'Valeur du stock par catégorie' : 'Stock par catégorie'} sousTitre={voit ? 'Au CMUP' : 'En kg'}>
              {cats.length === 0 ? (
                <Vide texte="Aucune catégorie en stock." />
              ) : (
                <BarresClassees
                  donnees={cats.slice(0, 8).map((c) => ({ cle: c.code_categorie, libelle: c.categorie_libelle, detail: `${compact(c.stock_kg)} kg`, valeur: voit ? (c.valeur_dhs ?? 0) : c.stock_kg }))}
                  format={(v) => (voit ? `${compact(v)} MAD` : `${compact(v)} kg`)}
                />
              )}
            </Bloc>
          </div>
        </>
      )}

      <Bloc titre="Où part la matière" sousTitre="Consommation par qualité et par rôle de matière" corpsSansMarge>
        <div className="p-4">
          <TableauDeBord />
        </div>
      </Bloc>

      {lisMvt && (
        <Bloc titre="Par famille" sousTitre="Les familles les plus lourdes et leurs couleurs" corpsSansMarge>
          <div className="p-4">
            <BlocFamilles />
          </div>
        </Bloc>
      )}

      <Bloc titre="Santé du référentiel" sousTitre="Contrôles métier en anomalie" lien={{ vers: '/controles', libelle: 'Contrôles' }} corpsSansMarge>
        {qCtl.isError ? (
          <EnPanne />
        ) : qCtl.isLoading ? (
          <div className="p-4">
            <Squelette className="h-24" />
          </div>
        ) : anomalies.length === 0 ? (
          <Vide texte="Aucune anomalie détectée." ok />
        ) : (
          <ul className="divide-y divide-ligne">
            {anomalies.map((c) => (
              <li key={c.code} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                <AlertTriangle className={cn('size-3.5 shrink-0', c.criticite === 'BLOQUANT' || c.criticite === 'CRITIQUE' ? 'text-danger' : 'text-alerte')} />
                <span className="w-12 shrink-0 text-[11px] text-attenue-texte">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-texte">{c.controle}</span>
                <Badge ton={c.criticite === 'BLOQUANT' || c.criticite === 'CRITIQUE' ? 'danger' : 'alerte'}>{c.anomalies}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Bloc>
    </div>
  )
}

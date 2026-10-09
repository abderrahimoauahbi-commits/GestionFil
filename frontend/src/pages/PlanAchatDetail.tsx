/**
 * LE CALCUL D'UNE PROPOSITION, PAS A PAS (audit v5, F16). Deplie sous la ligne
 * du plan d'achat : l'acheteur voit d'ou viennent les kilos avant de commander.
 *
 *   magasin net + machine comptee + en-cours − demande pendant le delai
 *     = stock projete (residuel : jamais sous zero)
 *   besoin = sorties de la couverture + securite − residuel
 *            (ou minimum − residuel, le plus grand)
 *   puis le MOQ du fournisseur, puis la palette complete.
 *
 * Le calcul est celui d'aujourd'hui : une proposition generee hier peut en
 * differer, l'ecran le dit.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Chargement } from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'

interface Calcul {
  delai_livraison_jours: number | null
  stock_magasin_net_kg: number
  stock_machine_compte_kg: number
  stock_machine_total_kg: number
  stock_reserve_kg: number
  stock_quarantaine_kg: number
  encours_kg: number
  encours_retarde_kg: number
  encours_port_kg: number
  nb_lignes_retardees: number
  demande_delai_kg: number
  demande_delai_prolongee_kg: number
  residuel_kg: number
  sorties_fenetre_kg: number
  sorties_prolongees_kg: number
  securite_kg: number
  stock_min_catalogue_kg: number
  moq_kg: number | null
  besoin_avant_arrondi_kg: number
  complement_palette_kg: number
  qte_a_commander_kg: number
  palettes_a_commander: number | null
  delai_j: number
  couverture_j: number
  retard_compte: boolean
  machine_comptee: boolean
}

interface Detail {
  calcul: Calcul
  bons: { numero_bc: string; date_livraison_prevue: string | null; reste_kg: number; en_retard: boolean }[]
  port: { numero_dossier: string; numero_facture: string; reste_kg: number }[]
  machine: { code_emplacement: string; lot_fournisseur: string | null; kg: number; date_constat: string | null; lot_bloque: boolean; constat_ancien: boolean }[]
}

const kg = (v: number | null | undefined) => fmt.nombre(v ?? 0, 0)

function Ligne({ signe, libelle, valeur, note, fort }: { signe?: string; libelle: string; valeur: number; note?: string; fort?: boolean }) {
  return (
    <tr className={cn(fort && 'border-t border-bordure font-semibold')}>
      <td className="w-5 py-0.5 pr-1 text-center text-attenue-texte">{signe}</td>
      <td className="py-0.5 pr-3">{libelle}</td>
      <td className="py-0.5 pr-3 text-right tabular-nums">{kg(valeur)}</td>
      <td className="py-0.5 text-[11.5px] text-attenue-texte">{note}</td>
    </tr>
  )
}

export function DetailCalcul({ reference }: { reference: string }) {
  const q = useQuery({
    queryKey: ['plan-achat-detail', reference],
    queryFn: () => api.get<Detail>(`/api/plan-achat/detail?reference=${encodeURIComponent(reference)}`),
    staleTime: 60_000,
  })
  if (q.isLoading) return <Chargement />
  if (q.error || !q.data?.calcul)
    return <p className="text-[12.5px] text-attenue-texte">Le calcul d’aujourd’hui ne propose plus rien pour cette référence.</p>
  const c = q.data.calcul
  const enCoursHeure = c.encours_kg - c.encours_port_kg - (c.retard_compte ? c.encours_retarde_kg : 0)
  const projete = c.stock_magasin_net_kg + c.stock_machine_compte_kg + c.encours_kg - c.demande_delai_kg
  const parMinimum = c.stock_min_catalogue_kg - c.residuel_kg > c.sorties_fenetre_kg + c.securite_kg - c.residuel_kg

  return (
    <div className="grid gap-4 text-[12.5px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
          Calcul d’aujourd’hui — délai {c.delai_j} j, couverture {c.couverture_j} j
        </p>
        <table>
          <tbody>
            <Ligne libelle="Stock du magasin, net" valeur={c.stock_magasin_net_kg}
              note={c.stock_reserve_kg > 0 ? `hors ${kg(c.stock_reserve_kg)} kg de restes et lots bloqués` : undefined} />
            <Ligne signe="+" libelle="Fil sur machine compté" valeur={c.stock_machine_compte_kg}
              note={!c.machine_comptee ? 'non compté (réglage)' : c.stock_machine_total_kg - c.stock_machine_compte_kg > 0.5
                ? `sur ${kg(c.stock_machine_total_kg)} kg chargés` : undefined} />
            <Ligne signe="+" libelle="Bons à l’heure" valeur={enCoursHeure} />
            {c.encours_retarde_kg > 0 && (
              <Ligne signe={c.retard_compte ? '+' : ''} libelle="Bons en retard" valeur={c.encours_retarde_kg}
                note={c.retard_compte ? `${c.nb_lignes_retardees} ligne(s), comptées (réglage)` : 'non comptés (réglage)'} />
            )}
            {c.encours_port_kg > 0 && <Ligne signe="+" libelle="Marchandise au port" valeur={c.encours_port_kg} />}
            <Ligne signe="−" libelle="Demande pendant le délai" valeur={c.demande_delai_kg}
              note={c.demande_delai_prolongee_kg > 0 ? `dont ${kg(c.demande_delai_prolongee_kg)} kg au-delà de la fin du plan` : undefined} />
            <Ligne signe="=" libelle="Stock projeté à l’arrivée" valeur={projete} fort
              note={projete < 0 ? 'rupture avant l’arrivée : compté zéro' : undefined} />
            <tr><td colSpan={4} className="h-2" /></tr>
            <Ligne libelle="Sorties de la couverture" valeur={c.sorties_fenetre_kg}
              note={c.sorties_prolongees_kg > 0 ? `dont ${kg(c.sorties_prolongees_kg)} kg prolongés` : undefined} />
            <Ligne signe="+" libelle="Sécurité" valeur={c.securite_kg} />
            <Ligne signe="−" libelle="Stock projeté retenu" valeur={c.residuel_kg} />
            {c.stock_min_catalogue_kg > 0 && (
              <Ligne libelle="ou : minimum − projeté" valeur={c.stock_min_catalogue_kg - c.residuel_kg}
                note={parMinimum ? 'retenu : le plus grand' : undefined} />
            )}
            {(c.moq_kg ?? 0) > 0 && <Ligne libelle="Minimum de commande (MOQ)" valeur={c.moq_kg ?? 0} />}
            <Ligne libelle="Besoin" valeur={c.besoin_avant_arrondi_kg} fort />
            {c.complement_palette_kg > 0 && (
              <Ligne signe="+" libelle="Complément à la palette" valeur={c.complement_palette_kg} />
            )}
            <Ligne signe="=" libelle="À commander" valeur={c.qte_a_commander_kg} fort
              note={c.palettes_a_commander ? `${c.palettes_a_commander} palette(s)` : undefined} />
          </tbody>
        </table>
      </div>

      <div className="min-w-0 space-y-3">
        {q.data.bons.length > 0 && (
          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Bons ouverts</p>
            <ul className="space-y-0.5">
              {q.data.bons.map((b, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-medium">{b.numero_bc}</span>
                  <span className={cn('tabular-nums', b.en_retard && 'text-danger')}>
                    {b.date_livraison_prevue ? fmt.date(b.date_livraison_prevue) : 'sans date'}
                    {b.en_retard && ' — en retard'}
                  </span>
                  <span className="ml-auto tabular-nums">{kg(b.reste_kg)} kg</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {q.data.port.length > 0 && (
          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Au port (import sans bon)</p>
            <ul className="space-y-0.5">
              {q.data.port.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-medium">{p.numero_dossier}</span>
                  <span>{p.numero_facture}</span>
                  <span className="ml-auto tabular-nums">{kg(p.reste_kg)} kg</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {q.data.machine.length > 0 && (
          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Sur machine</p>
            <ul className="space-y-0.5">
              {q.data.machine.map((m, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-medium">{m.code_emplacement}</span>
                  <span className="text-attenue-texte">{m.lot_fournisseur ?? ''}</span>
                  <span className={cn('tabular-nums', (m.constat_ancien || m.lot_bloque) && 'text-alerte')}>
                    {m.date_constat ? `constaté le ${fmt.date(m.date_constat)}` : 'jamais constaté'}
                    {m.lot_bloque ? ' — lot bloqué, non compté' : m.constat_ancien ? ' — trop ancien, non compté' : ''}
                  </span>
                  <span className="ml-auto tabular-nums">{kg(m.kg)} kg</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * LES DROITS DE DOUANE ATTENDUS D'UN DOSSIER (19/10/2026).
 *
 * Par ligne : la valeur en douane (valeur facture en dirhams, plus la part des
 * frais « valeur en douane » — le fret, l'assurance), multipliee par le taux de
 * la position tarifaire de sa reference. Par dossier : leur somme, face aux
 * droits payes (les frais de categorie Douane).
 *
 * L'ECART SE LIT, IL NE BLOQUE RIEN : la quittance fait foi. Ce qui change le
 * cout de revient, c'est la repartition choisie pour le frais de douane — « au
 * taux des droits », chaque ligne porte la douane au prorata de ses droits
 * attendus, au lieu de sa valeur.
 *
 * Une ligne sans position n'a pas de droit attendu (« — », pas zero : zero
 * dirait « exoneree »). Le controle C56 la signale.
 */
import { Alerte, Carte, CarteCorps, CarteEntete, CarteTitre } from '../../composants/ui/base'
import { cn, fmt } from '../../lib/utils'
import type { DossierComplet } from './types'

const td = 'px-2 py-1 text-right tabular-nums'

export function DroitsDouane({ d }: { d: DossierComplet }) {
  const lignes = d.droits ?? []
  const total = d.droits_dossier
  if (!total || lignes.length === 0) return null
  const libelles = new Map(d.lignes.map((l) => [l.id_ligne, l.designation]))
  // Les montants peuvent etre masques (grille des droits) : on n'affiche que ce qu'on recoit.
  const attendus = total.droits_attendus_dhs
  const payes = total.droits_payes_dhs
  const ecart = attendus !== undefined && payes !== undefined ? payes - attendus : undefined

  return (
    <Carte className="mt-3">
      <CarteEntete>
        <CarteTitre>Droits de douane attendus</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        {ecart !== undefined && (
          <div className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
            <div>
              <div className="text-[11px] text-attenue-texte">Attendus (positions tarifaires)</div>
              <div className="font-semibold tabular-nums">{fmt.nombre(attendus, 2)} DH</div>
            </div>
            <div>
              <div className="text-[11px] text-attenue-texte">Payés (frais de douane saisis)</div>
              <div className="font-semibold tabular-nums">{fmt.nombre(payes, 2)} DH</div>
            </div>
            <div>
              <div className="text-[11px] text-attenue-texte">Écart payé − attendu</div>
              <div className={cn('font-semibold tabular-nums', Math.abs(ecart) > 0.005 && 'text-alerte')}>
                {ecart > 0 ? '+' : ''}
                {fmt.nombre(ecart, 2)} DH
              </div>
            </div>
          </div>
        )}
        {total.nb_lignes_sans_position > 0 && (
          <Alerte ton="alerte">
            {total.nb_lignes_sans_position} ligne(s) sans position tarifaire : leurs droits ne se calculent
            pas. Renseignez la position sur la fiche de la référence (Catalogue). Une douane répartie « au
            taux des droits » reste non répartie tant qu’il en manque une.
          </Alerte>
        )}
        <table className="w-full text-[12px]">
          <thead className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
            <tr>
              <th className="px-2 py-1.5 text-left">Référence</th>
              <th className="px-2 py-1.5 text-left">Position</th>
              <th className="px-2 py-1.5 text-right">Taux</th>
              <th className="px-2 py-1.5 text-right">Valeur en douane</th>
              <th className="px-2 py-1.5 text-right">Droits attendus</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id_ligne} className="border-t border-bordure/60">
                <td className="px-2 py-1">{l.code_reference ?? libelles.get(l.id_ligne) ?? '—'}</td>
                <td className="px-2 py-1">
                  {l.code_sh ? (
                    <>
                      <span className="font-mono">{l.code_sh}</span>
                      {l.libelle_position && (
                        <div className="text-[10.5px] text-attenue-texte">{l.libelle_position}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-alerte">sans position</span>
                  )}
                </td>
                <td className={td}>
                  {l.taux_droit_pct == null ? '—' : `${fmt.nombre(l.taux_droit_pct, 2)} %`}
                </td>
                <td className={td}>
                  {l.valeur_douane_dhs === undefined ? '•••' : fmt.nombre(l.valeur_douane_dhs, 2)}
                  {(l.frais_valeur_douane_dhs ?? 0) > 0 && (
                    <div className="text-[10.5px] text-attenue-texte">
                      dont frais {fmt.nombre(l.frais_valeur_douane_dhs, 2)}
                    </div>
                  )}
                </td>
                <td className={td}>
                  {l.droits_attendus_dhs === undefined
                    ? '•••'
                    : l.droits_attendus_dhs === null
                      ? '—'
                      : fmt.nombre(l.droits_attendus_dhs, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CarteCorps>
    </Carte>
  )
}

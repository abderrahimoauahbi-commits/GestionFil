/**
 * Le controle de coherence des recettes, qualite par qualite.
 *
 * POURQUOI CE BLOC, ALORS QUE LE CONTROLE C01 EXISTE DEJA. C01 rend un compte :
 * « 6 anomalies ». Ce compte ne se corrige pas — il ne dit ni quelle qualite,
 * ni quel role, ni de combien. Le classeur, lui, affiche « SH : 7 roles sur 8,
 * Franges a 0 % », et c'est cette phrase-la qui declenche une correction.
 *
 * DEUX FACONS D'ECHOUER, ET IL FAUT LES DISTINGUER. Un role VIDE porte une
 * densite mais aucune matiere : c'est une composition oubliee. Un role HORS 100
 * a des matieres qui ne totalisent pas cent : c'est une erreur de saisie. Les
 * confondre fait chercher au mauvais endroit.
 */
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { api } from '../api/client'
import { Carte, CarteCorps, CarteEntete, CarteTitre, Squelette } from './ui/base'
import { cn } from '../lib/utils'

interface LigneCoherence {
  code_qualite: string
  qualite_nom: string | null
  statut_qualite: string
  roles_declares: number
  roles_conformes: number
  roles_vides: number
  roles_hors_100: number
  roles_fautifs: string | null
  verdict: 'OK' | 'ANOMALIE'
}

export function CoherenceRecettes() {
  const q = useQuery({
    queryKey: ['coherence-recettes'],
    queryFn: () => api.get<LigneCoherence[]>('/api/coherence-recettes'),
  })

  if (q.isLoading) return <Squelette className="h-40" />
  const lignes = q.data ?? []
  if (!lignes.length) return null

  const anomalies = lignes.filter((l) => l.verdict === 'ANOMALIE')

  return (
    <Carte repliable="qualites.coherence">
      <CarteEntete>
        <CarteTitre className="flex items-center gap-1.5">
          {anomalies.length ? (
            <TriangleAlert className="size-3.5 text-alerte" />
          ) : (
            <CheckCircle2 className="size-3.5 text-succes" />
          )}
          Coherence des recettes
          <span className="ml-1 font-normal text-attenue-texte">
            {anomalies.length
              ? `${anomalies.length} qualite(s) sur ${lignes.length} a corriger`
              : `${lignes.length} qualites conformes`}
          </span>
        </CarteTitre>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div className="defilement-x">
          <table className="grille w-full text-[12px]">
            <thead>
              <tr className="bg-attenue">
                <th className="px-2.5 py-1.5 text-left font-semibold">Qualite</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Roles a 100 %</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">Roles a corriger</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">Nature</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.code_qualite} className="hover:bg-attenue/60">
                  <td className="px-2.5 py-1">
                    <span className="font-mono text-[11px] font-medium">{l.code_qualite}</span>
                    {l.qualite_nom && (
                      <span className="ml-2 text-attenue-texte">{l.qualite_nom}</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1 text-right tabular-nums">
                    <span
                      className={cn(
                        'inline-block rounded-[3px] px-1.5 py-px font-medium',
                        l.verdict === 'OK'
                          ? 'bg-succes/12 text-succes'
                          : 'bg-alerte/15 text-alerte',
                      )}
                    >
                      {l.roles_conformes}/{l.roles_declares}
                    </span>
                  </td>
                  <td className="px-2.5 py-1">
                    {l.roles_fautifs ?? <span className="text-attenue-texte">—</span>}
                  </td>
                  <td className="px-2.5 py-1 text-attenue-texte">
                    {/* La nature du defaut, pas seulement son existence : elle
                        dit ou aller le corriger. */}
                    {l.verdict === 'OK'
                      ? ''
                      : l.roles_vides > 0 && l.roles_hors_100 > 0
                        ? 'composition manquante et somme fausse'
                        : l.roles_vides > 0
                          ? 'composition jamais saisie'
                          : 'somme differente de 100 %'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {anomalies.length > 0 && (
          <p className="border-t border-bordure px-3 py-2 text-[11px] leading-relaxed text-attenue-texte">
            Un role declare avec une densite mais sans matiere ne produit aucun besoin : la
            quantite correspondante est absente du plan d achat, sans que rien ne le signale au
            moment de commander.
          </p>
        )}
      </CarteCorps>
    </Carte>
  )
}

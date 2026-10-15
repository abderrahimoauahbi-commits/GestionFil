/**
 * LES FRAIS D'APPROCHE D'UN ARRIVAGE (ADR-003 phase C).
 *
 * Le fret, la douane, l'assurance, la manutention : ce qui s'ajoute au prix
 * d'achat pour faire le COUT DE REVIENT. La table existait depuis le portage et
 * personne ne la remplissait — aucun ecran, et surtout aucun de ces frais
 * n'atteignait le CMUP : la cloture ne connaissait qu'un total tape sur la
 * facture, reparti a la valeur.
 *
 * CHAQUE FRAIS DIT SA CLE, et c'est tout l'interet : un fret se repartit au
 * POIDS, une assurance a la VALEUR, une manutention en PARTS EGALES. Reparti a
 * la valeur, le fret se fait payer au prix du kilo — la matiere chere porte le
 * transport de la matiere lourde.
 *
 * SUR UN ARRIVAGE VALIDE SEULEMENT. Avant la validation, les pesees peuvent
 * encore changer : repartir un fret sur des poids provisoires donnerait un cout
 * de revient qu'il faudrait refaire sans que rien ne le signale.
 *
 * PORTE UNE FOIS. La cloture marque la date ; apres quoi le frais est fige — il
 * a bouge une valeur de stock, et cela ne se reecrit pas.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
import {
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Etiq,
  Selecteur,
} from '../../composants/ui/base'
import { Aide } from '../../composants/ui/surcouches'
import { fmt } from '../../lib/utils'
import { lireNombre } from '../../lib/nombres'

const MODULE = 'VALORISATION'

/** Les natures de la table : ce qu'un transitaire facture vraiment. */
const NATURES: { valeur: string; libelle: string; cle: string }[] = [
  { valeur: 'FRET', libelle: 'Fret / transport', cle: 'POIDS' },
  { valeur: 'DOUANE', libelle: 'Douane', cle: 'VALEUR' },
  { valeur: 'ASSURANCE', libelle: 'Assurance', cle: 'VALEUR' },
  { valeur: 'MANUTENTION', libelle: 'Manutention', cle: 'LIGNES' },
  { valeur: 'AUTRE', libelle: 'Autre', cle: 'VALEUR' },
]

const CLES: { valeur: string; libelle: string; aide: string }[] = [
  { valeur: 'POIDS', libelle: 'Au poids', aide: 'Chaque référence porte le frais au prorata de ses kilos — la clé du transport.' },
  { valeur: 'VALEUR', libelle: 'À la valeur', aide: 'Au prorata de la valeur reçue — la clé de l’assurance et des droits ad valorem.' },
  { valeur: 'LIGNES', libelle: 'En parts égales', aide: 'Autant par référence, quel que soit son poids ou son prix.' },
]

interface Frais extends Record<string, unknown> {
  id_frais: string
  type_frais: string
  libelle: string | null
  montant_devise?: number
  code_devise: string
  taux_change: number
  montant_mad?: number
  cle_repartition: string
  reference_externe: string | null
  date_frais: string
  date_portee: string | null
}

export function FraisApproche({ idReception, statut }: { idReception: string; statut: string }) {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const [ouvert, setOuvert] = useState(false)
  const [saisie, setSaisie] = useState({
    type_frais: 'FRET',
    libelle: '',
    reference_externe: '',
    montant: '',
    code_devise: 'MAD',
    taux: '1',
    cle_repartition: 'POIDS',
  })

  const q = useQuery({
    queryKey: ['frais-approche', idReception],
    queryFn: ({ signal }) =>
      api.get<Frais[]>(`/api/frais-approche?id_reception=${idReception}`, { signal }),
    enabled: !!droits.peutLire,
  })
  const qDevises = useQuery({
    queryKey: ['devises'],
    queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }),
    enabled: !!droits.peutEcrire,
  })

  const ajouter = useMutation({
    mutationFn: () =>
      api.post('/api/frais-approche', {
        id_reception: idReception,
        type_frais: saisie.type_frais,
        libelle: saisie.libelle.trim() || undefined,
        reference_externe: saisie.reference_externe.trim() || undefined,
        montant_devise: lireNombre(saisie.montant) ?? 0,
        code_devise: saisie.code_devise,
        taux_change: lireNombre(saisie.taux) ?? 1,
        cle_repartition: saisie.cle_repartition,
      }),
    onSuccess: () => {
      toast.success('Frais enregistré', {
        description: 'Il rejoindra le CMUP à la clôture, selon sa clé de répartition.',
      })
      setSaisie({ ...saisie, libelle: '', reference_externe: '', montant: '' })
      setOuvert(false)
      void qc.invalidateQueries({ queryKey: ['frais-approche', idReception] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.'),
  })

  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/frais-approche/${id}`),
    onSuccess: () => {
      toast.success('Frais retiré')
      void qc.invalidateQueries({ queryKey: ['frais-approche', idReception] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.'),
  })

  // Le module est ferme au magasin : rien a montrer plutot qu'un 403 a l'ecran.
  if (!droits.peutLire) return null
  const lignes = q.data ?? []
  // Avant la validation il n'y a rien a repartir, et apres la cloture plus rien
  // a ajouter : la carte ne s'affiche que si elle sert.
  if (lignes.length === 0 && statut !== 'VALIDE') return null

  const total = lignes.reduce((s, l) => s + (l.montant_mad ?? 0), 0)
  const modifiable = statut === 'VALIDE' && droits.peutEcrire

  return (
    <Carte repliable="reception.frais">
      <CarteEntete>
        <CarteTitre>
          Frais d’approche
          <Aide>
            Fret, douane, assurance, manutention. Ils rejoignent le CMUP à la clôture, chacun
            réparti selon sa clé — un fret au poids, une assurance à la valeur.
          </Aide>
        </CarteTitre>
        {total > 0 && (
          <span className="text-[13px] font-medium tabular-nums">{fmt.mad(total)}</span>
        )}
      </CarteEntete>
      <CarteCorps className="space-y-3">
        {lignes.length === 0 ? (
          <p className="text-[13px] text-attenue-texte">
            Aucun frais saisi. Sur un achat local il n’y en a souvent aucun ; sur un conteneur,
            c’est l’essentiel du coût de revient.
          </p>
        ) : (
          <ul className="divide-y divide-bordure text-[13px]">
            {lignes.map((l) => (
              <li key={l.id_frais} className="flex items-start gap-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {NATURES.find((n) => n.valeur === l.type_frais)?.libelle ?? l.type_frais}
                    </span>
                    {l.libelle && <span className="text-attenue-texte">{l.libelle}</span>}
                    {l.date_portee && (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-attenue-texte">
                        <Lock className="size-3" />
                        porté au CMUP le {fmt.date(l.date_portee)}
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-attenue-texte">
                    ↳ {CLES.find((c) => c.valeur === l.cle_repartition)?.libelle ?? l.cle_repartition}
                    {l.reference_externe ? ` · pièce ${l.reference_externe}` : ''}
                    {l.code_devise !== 'MAD' && l.montant_devise != null
                      ? ` · ${fmt.nombre(l.montant_devise, 2)} ${l.code_devise} au taux ${fmt.nombre(l.taux_change, 4)}`
                      : ''}
                  </div>
                </div>
                <span className="shrink-0 tabular-nums">
                  {l.montant_mad != null ? fmt.mad(l.montant_mad) : '—'}
                </span>
                {modifiable && !l.date_portee && (
                  <button
                    type="button"
                    onClick={() => supprimer.mutate(l.id_frais)}
                    aria-label={`Retirer le frais ${l.type_frais}`}
                    className="shrink-0 text-attenue-texte transition-colors hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {modifiable &&
          (ouvert ? (
            <div className="grid gap-3 rounded-[var(--radius)] border border-bordure p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Etiq htmlFor="frais-nature">Nature</Etiq>
                <Selecteur
                  id="frais-nature"
                  value={saisie.type_frais}
                  onChange={(e) => {
                    const n = NATURES.find((x) => x.valeur === e.target.value)
                    // La clé suit la nature par défaut : on la change si l'on veut,
                    // mais personne ne doit avoir à y penser pour un fret.
                    setSaisie({
                      ...saisie,
                      type_frais: e.target.value,
                      cle_repartition: n?.cle ?? saisie.cle_repartition,
                    })
                  }}
                >
                  {NATURES.map((n) => (
                    <option key={n.valeur} value={n.valeur}>
                      {n.libelle}
                    </option>
                  ))}
                </Selecteur>
              </div>
              <div>
                <Etiq htmlFor="frais-libelle">Libellé</Etiq>
                <Champ
                  id="frais-libelle"
                  value={saisie.libelle}
                  onChange={(e) => setSaisie({ ...saisie, libelle: e.target.value })}
                  placeholder="Transport Tanger-Casablanca"
                />
              </div>
              <div>
                <Etiq htmlFor="frais-piece">Pièce</Etiq>
                <Champ
                  id="frais-piece"
                  value={saisie.reference_externe}
                  onChange={(e) => setSaisie({ ...saisie, reference_externe: e.target.value })}
                  placeholder="Facture transitaire, DUM"
                />
              </div>
              <div>
                <Etiq htmlFor="frais-cle">
                  Répartition
                  <Aide>
                    {CLES.find((c) => c.valeur === saisie.cle_repartition)?.aide}
                  </Aide>
                </Etiq>
                <Selecteur
                  id="frais-cle"
                  value={saisie.cle_repartition}
                  onChange={(e) => setSaisie({ ...saisie, cle_repartition: e.target.value })}
                >
                  {CLES.map((c) => (
                    <option key={c.valeur} value={c.valeur}>
                      {c.libelle}
                    </option>
                  ))}
                </Selecteur>
              </div>
              <div>
                <Etiq htmlFor="frais-montant">Montant</Etiq>
                <Champ
                  id="frais-montant"
                  value={saisie.montant}
                  onChange={(e) => setSaisie({ ...saisie, montant: e.target.value })}
                  className="text-right tabular-nums"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Etiq htmlFor="frais-devise">Devise</Etiq>
                <Selecteur
                  id="frais-devise"
                  value={saisie.code_devise}
                  onChange={(e) =>
                    setSaisie({
                      ...saisie,
                      code_devise: e.target.value,
                      taux: e.target.value === 'MAD' ? '1' : saisie.taux,
                    })
                  }
                >
                  {(qDevises.data ?? [{ code_devise: 'MAD' }]).map((d) => (
                    <option key={d.code_devise} value={d.code_devise}>
                      {d.code_devise}
                    </option>
                  ))}
                </Selecteur>
              </div>
              <div>
                <Etiq htmlFor="frais-taux">Taux</Etiq>
                <Champ
                  id="frais-taux"
                  value={saisie.taux}
                  disabled={saisie.code_devise === 'MAD'}
                  onChange={(e) => setSaisie({ ...saisie, taux: e.target.value })}
                  className="text-right tabular-nums"
                  inputMode="decimal"
                />
              </div>
              <div className="flex items-end gap-2">
                <Bouton
                  chargement={ajouter.isPending}
                  disabled={!((lireNombre(saisie.montant) ?? 0) > 0)}
                  onClick={() => ajouter.mutate()}
                >
                  Enregistrer le frais
                </Bouton>
                <Bouton variante="discret" onClick={() => setOuvert(false)}>
                  Annuler
                </Bouton>
              </div>
            </div>
          ) : (
            <Bouton variante="contour" onClick={() => setOuvert(true)}>
              <Plus />
              Ajouter un frais
            </Bouton>
          ))}
      </CarteCorps>
    </Carte>
  )
}

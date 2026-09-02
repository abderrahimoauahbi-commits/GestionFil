/**
 * Le cout de revient rendu magasin.
 *
 * POURQUOI CE CHIFFRE EXISTE. Le prix d'achat ne dit pas ce que la matiere
 * coute : il faut y ajouter le fret, la douane, l'assurance et la manutention.
 * Un fournisseur turc a 24 MAD/kg depart usine peut revenir plus cher qu'un
 * marocain a 26 une fois le conteneur paye — et rien dans le prix d'achat ne le
 * montre. C'est le seul chiffre qui permette de comparer deux sources
 * eloignees.
 *
 * LA REPARTITION EST UN CHOIX, ET IL EST EXPLICITE. Le fret suit le poids, la
 * douane suit la valeur. Retenir une cle unique fausserait l'un ou l'autre :
 * une matiere legere et chere porterait trop de fret, une lourde et bon marche
 * trop de douane. Chaque frais porte donc sa propre cle, saisie avec lui.
 *
 * TANT QU'AUCUN FRAIS N'EST SAISI, le cout de revient EST le prix d'achat.
 * L'ecran le dit plutot que d'afficher une colonne de zeros qui se lirait comme
 * « il n'y a pas de frais » — alors qu'il n'y a pas de SAISIE.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Ship } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { TableDroits, type Colonne } from '../components/TableDroits'
import {
  Alerte,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { Dialogue, DialogueContenu } from '../composants/ui/surcouches'
import { fmt } from '../components/ui'
import { cn } from '../lib/utils'

const MODULE = 'VALORISATION'

interface LigneCout {
  id_ligne_reception: string
  numero_reception: string
  date_reception: string
  code_reference: string
  designation: string | null
  fournisseur_nom: string | null
  quantite_stock_kg: number
  prix_achat_mad_kg?: number | null
  frais_approche_mad?: number | null
  frais_mad_kg?: number | null
  cout_revient_mad_kg?: number | null
  part_frais_pct?: number | null
  [k: string]: unknown
}

interface Frais {
  id_frais: string
  id_reception: string
  numero_reception: string
  type_frais: string
  libelle: string | null
  montant_devise?: number | null
  code_devise: string
  montant_mad?: number | null
  cle_repartition: string
  reference_externe: string | null
  date_frais: string
  [k: string]: unknown
}

const TYPES = ['FRET', 'DOUANE', 'ASSURANCE', 'MANUTENTION', 'AUTRE'] as const

/** Ce que chaque cle repartit, et pourquoi elle convient a ce frais. */
const CLES: { valeur: string; libelle: string; aide: string }[] = [
  { valeur: 'POIDS', libelle: 'Au poids', aide: 'Le fret et la manutention se paient au kilo.' },
  { valeur: 'VALEUR', libelle: 'A la valeur', aide: 'La douane et l assurance suivent la valeur declaree.' },
  { valeur: 'LIGNES', libelle: 'Par ligne', aide: 'Un frais fixe par article : formalites, analyses.' },
]

export function CoutRevient() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const [saisie, setSaisie] = useState(false)

  const q = useQuery({
    queryKey: ['cout-revient'],
    queryFn: () => api.get<LigneCout[]>('/api/cout-revient'),
  })
  const qFrais = useQuery({
    queryKey: ['frais-approche'],
    queryFn: () => api.get<Frais[]>('/api/frais-approche?limite=200'),
  })

  const lignes = q.data ?? []
  const frais = qFrais.data ?? []

  const totaux = useMemo(() => {
    const achat = lignes.reduce(
      (s, l) => s + (l.prix_achat_mad_kg ?? 0) * l.quantite_stock_kg,
      0,
    )
    const fr = lignes.reduce((s, l) => s + (l.frais_approche_mad ?? 0), 0)
    return { achat, frais: fr, part: achat > 0 ? (fr / achat) * 100 : 0 }
  }, [lignes])

  const coutVisible = droits.visible('cout_revient_mad_kg')

  const colonnes: Colonne<LigneCout>[] = [
    {
      champ: 'numero_reception',
      entete: 'Reception',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="font-mono text-[11px]">{l.numero_reception}</div>
          <div className="text-[11px] text-attenue-texte">
            {(l.date_reception ?? '').slice(0, 10)}
          </div>
        </div>
      ),
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
    { champ: 'fournisseur_nom', entete: 'Fournisseur', secondaire: true },
    {
      champ: 'quantite_stock_kg',
      entete: 'Quantite',
      numerique: true,
      rendu: (l) => `${fmt.nombre(l.quantite_stock_kg, 1)} kg`,
    },
    {
      champ: 'prix_achat_mad_kg',
      entete: 'Achat MAD/kg',
      numerique: true,
      rendu: (l) => (l.prix_achat_mad_kg == null ? '—' : fmt.nombre(l.prix_achat_mad_kg, 2)),
    },
    {
      champ: 'frais_mad_kg',
      entete: 'Frais MAD/kg',
      numerique: true,
      rendu: (l) =>
        !l.frais_mad_kg ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          fmt.nombre(l.frais_mad_kg, 2)
        ),
    },
    {
      champ: 'cout_revient_mad_kg',
      entete: 'Rendu MAD/kg',
      numerique: true,
      rendu: (l) =>
        l.cout_revient_mad_kg == null ? (
          '—'
        ) : (
          <span className="font-medium tabular-nums">{fmt.nombre(l.cout_revient_mad_kg, 2)}</span>
        ),
    },
    {
      champ: 'part_frais_pct',
      entete: 'Part frais',
      numerique: true,
      rendu: (l) =>
        !l.part_frais_pct ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          // Au-dela de 10 %, les frais changent le classement des fournisseurs :
          // comparer sur le seul prix d'achat devient trompeur.
          <span
            className={cn(
              'inline-block rounded-[3px] px-1.5 py-px tabular-nums',
              l.part_frais_pct > 10 ? 'bg-alerte/15 font-medium text-alerte' : '',
            )}
          >
            {fmt.nombre(l.part_frais_pct, 1)} %
          </span>
        ),
    },
  ]

  if (q.isLoading) return <Chargement texte="Calcul du cout de revient…" />

  return (
    <div>
      <EnTetePage
        titre="Cout de revient complet"
        sous_titre="Prix d achat plus fret, douane, assurance et manutention, repartis par reception"
        actions={
          droits.peutEcrire && (
            <Bouton taille="icone" title="Saisir un frais" aria-label="Saisir un frais" onClick={() => setSaisie(true)}>              <Plus />            </Bouton>
          )
        }
      />

      {frais.length === 0 && (
        <Alerte ton="info" titre="Aucun frais d approche saisi" className="mb-3">
          Le cout de revient affiche est donc egal au prix d achat. Ce n est pas que les frais sont
          nuls — c est qu ils ne sont pas encore enregistres. Ils arrivent en general par la
          facture du transitaire, apres la reception : saisissez-les au fur et a mesure, la
          repartition se fait toute seule.
        </Alerte>
      )}

      {coutVisible && frais.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Carte>
            <CarteCorps className="p-3">
              <div className="text-[11px] text-attenue-texte">Achat</div>
              <div className="text-[17px] font-semibold tabular-nums">
                {fmt.nombre(totaux.achat / 1e6, 2)} <span className="text-[11px]">M MAD</span>
              </div>
            </CarteCorps>
          </Carte>
          <Carte>
            <CarteCorps className="p-3">
              <div className="text-[11px] text-attenue-texte">Frais d approche</div>
              <div className="text-[17px] font-semibold tabular-nums">
                {fmt.nombre(totaux.frais / 1e6, 2)} <span className="text-[11px]">M MAD</span>
              </div>
            </CarteCorps>
          </Carte>
          <Carte>
            <CarteCorps className="p-3">
              <div className="text-[11px] text-attenue-texte">Part des frais</div>
              <div
                className={cn(
                  'text-[17px] font-semibold tabular-nums',
                  totaux.part > 10 ? 'text-alerte' : '',
                )}
              >
                {fmt.nombre(totaux.part, 1)} %
              </div>
            </CarteCorps>
          </Carte>
          <Carte>
            <CarteCorps className="p-3">
              <div className="text-[11px] text-attenue-texte">Lignes valorisees</div>
              <div className="text-[17px] font-semibold tabular-nums">{lignes.length}</div>
            </CarteCorps>
          </Carte>
        </div>
      )}

      {frais.length > 0 && (
        <Carte repliable="cout.frais" className="mb-3">
          <CarteEntete>
            <CarteTitre className="flex items-center gap-1.5">
              <Ship className="size-3.5" />
              Frais saisis — {frais.length}
            </CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            <div className="defilement-x">
              <table className="grille w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue">
                    <th className="px-2.5 py-1.5 text-left font-semibold">Reception</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Nature</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Libelle</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Montant</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Repartition</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {frais.map((f) => (
                    <tr key={f.id_frais} className="hover:bg-attenue/60">
                      <td className="px-2.5 py-1 font-mono text-[11px]">{f.numero_reception}</td>
                      <td className="px-2.5 py-1">{f.type_frais}</td>
                      <td className="px-2.5 py-1 text-attenue-texte">{f.libelle ?? '—'}</td>
                      <td className="px-2.5 py-1 text-right tabular-nums">
                        {f.montant_mad == null ? '—' : `${fmt.nombre(f.montant_mad, 2)} MAD`}
                      </td>
                      <td className="px-2.5 py-1 text-attenue-texte">
                        {CLES.find((c) => c.valeur === f.cle_repartition)?.libelle ??
                          f.cle_repartition}
                      </td>
                      <td className="px-2.5 py-1 font-mono text-[11px] text-attenue-texte">
                        {f.reference_externe ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CarteCorps>
        </Carte>
      )}

      <TableDroits
        module={MODULE}
        colonnes={colonnes}
        lignes={lignes}
        cle={(l) => l.id_ligne_reception}
        titreCarte={(l) => `${l.numero_reception} · ${l.code_reference}`}
        exportable="cout-de-revient"
        imprimable="Cout de revient"
        texteVide="Aucune reception validee."
      />

      {saisie && (
        <FormulaireFrais
          surFermeture={() => setSaisie(false)}
          surSucces={() => {
            setSaisie(false)
            void qc.invalidateQueries({ queryKey: ['frais-approche'] })
            void qc.invalidateQueries({ queryKey: ['cout-revient'] })
          }}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Saisie d'un frais                                                           */
/* -------------------------------------------------------------------------- */

function FormulaireFrais({
  surFermeture,
  surSucces,
}: {
  surFermeture: () => void
  surSucces: () => void
}) {
  const [form, setForm] = useState({
    id_reception: '',
    type_frais: 'FRET',
    libelle: '',
    montant_devise: '',
    code_devise: 'MAD',
    taux_change: '1',
    cle_repartition: 'POIDS',
    reference_externe: '',
  })
  const [erreur, setErreur] = useState<string | null>(null)

  const qRecept = useQuery({
    queryKey: ['receptions'],
    queryFn: () => api.get<{ id_reception: string; numero_reception: string; date_reception: string; fournisseur_nom: string | null; statut: string }[]>(
      '/api/receptions?limite=200',
    ),
  })
  const qDevises = useQuery({
    queryKey: ['devises'],
    queryFn: () => api.get<{ code_devise: string }[]>('/api/devises'),
  })

  const receptions = useMemo(() => {
    const d = qRecept.data
    const l = Array.isArray(d) ? d : ((d as unknown as { lignes?: typeof d })?.lignes ?? [])
    return (l ?? []).filter((r) => r.statut === 'VALIDE')
  }, [qRecept.data])

  const creer = useMutation({
    mutationFn: () =>
      api.post('/api/frais-approche', {
        ...form,
        montant_devise: Number(form.montant_devise),
        taux_change: Number(form.taux_change),
      }),
    onSuccess: () => {
      toast.success('Frais enregistre', { description: 'Le cout de revient est recalcule.' })
      surSucces()
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  const pret = form.id_reception && Number(form.montant_devise) > 0 && Number(form.taux_change) > 0

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        titre="Saisir un frais d approche"
        description="Il sera reparti sur les lignes de la reception selon la cle choisie."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            creer.mutate()
          }}
        >
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}

          <div>
            <Etiq obligatoire>Reception</Etiq>
            <Selecteur
              value={form.id_reception}
              onChange={(e) => setForm({ ...form, id_reception: e.target.value })}
            >
              <option value="">— choisir —</option>
              {receptions.map((r) => (
                <option key={r.id_reception} value={r.id_reception}>
                  {r.numero_reception} — {(r.date_reception ?? '').slice(0, 10)} —{' '}
                  {r.fournisseur_nom ?? '?'}
                </option>
              ))}
            </Selecteur>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiq obligatoire>Nature</Etiq>
              <Selecteur
                value={form.type_frais}
                onChange={(e) => {
                  // La cle par defaut suit la nature : le fret au poids, la
                  // douane a la valeur. L'utilisateur peut la changer, mais le
                  // defaut evite l'erreur la plus frequente.
                  const t = e.target.value
                  setForm({
                    ...form,
                    type_frais: t,
                    cle_repartition:
                      t === 'DOUANE' || t === 'ASSURANCE' ? 'VALEUR' : 'POIDS',
                  })
                }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq obligatoire>Repartition</Etiq>
              <Selecteur
                value={form.cle_repartition}
                onChange={(e) => setForm({ ...form, cle_repartition: e.target.value })}
              >
                {CLES.map((c) => (
                  <option key={c.valeur} value={c.valeur}>
                    {c.libelle}
                  </option>
                ))}
              </Selecteur>
              <p className="mt-1 text-[11px] text-attenue-texte">
                {CLES.find((c) => c.valeur === form.cle_repartition)?.aide}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Etiq obligatoire>Montant</Etiq>
              <Champ
                type="number"
                step="0.01"
                min="0"
                value={form.montant_devise}
                onChange={(e) => setForm({ ...form, montant_devise: e.target.value })}
              />
            </div>
            <div>
              <Etiq obligatoire>Devise</Etiq>
              <Selecteur
                value={form.code_devise}
                onChange={(e) => setForm({ ...form, code_devise: e.target.value })}
              >
                {(qDevises.data ?? [{ code_devise: 'MAD' }]).map((d) => (
                  <option key={d.code_devise} value={d.code_devise}>
                    {d.code_devise}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq obligatoire>Taux</Etiq>
              <Champ
                type="number"
                step="0.0001"
                min="0"
                value={form.taux_change}
                onChange={(e) => setForm({ ...form, taux_change: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiq>Libelle</Etiq>
              <Champ
                value={form.libelle}
                onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                placeholder="Conteneur 40 pieds Izmir-Casablanca"
              />
            </div>
            <div>
              <Etiq>Reference externe</Etiq>
              <Champ
                value={form.reference_externe}
                onChange={(e) => setForm({ ...form, reference_externe: e.target.value })}
                placeholder="Facture transitaire, DUM"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Bouton type="button" variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton type="submit" disabled={!pret || creer.isPending}>
              {creer.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Bouton>
          </div>
        </form>
      </DialogueContenu>
    </Dialogue>
  )
}

/**
 * Les quatre etats qui portent sur un objet choisi.
 *
 * Ils different des etats de situation par un point : ils demandent d'abord
 * QUOI imprimer — quelle reception, quel inventaire, quel plan. Le selecteur
 * vit hors de la zone imprimable, il ne part donc pas au papier.
 *
 * POURQUOI ILS SONT ICI ET PAS DANS `EtatsListes`. Ce fichier-la contient des
 * etats sans parametre, qu'on ouvre et qu'on imprime. Melanger les deux
 * familles obligerait chaque lecteur a chercher lequel attend un choix.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Chargement, Selecteur } from '../composants/ui/base'
import { fmt } from '../components/ui'

/** Le bandeau de choix, identique sur les quatre etats. */
function Choix({
  libelle,
  valeur,
  surChangement,
  options,
}: {
  libelle: string
  valeur: string
  surChangement: (v: string) => void
  options: { valeur: string; libelle: string }[]
}) {
  return (
    <div className="sans-impression mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-attenue-texte">{libelle}</span>
      <Selecteur
        value={valeur}
        onChange={(e) => surChangement(e.target.value)}
        className="w-[26rem] max-w-full"
      >
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </Selecteur>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Bon de reception                                                            */
/* -------------------------------------------------------------------------- */

interface Reception {
  id_reception: string
  numero_reception: string
  date_reception: string
  fournisseur_nom: string | null
  numero_bc?: string | null
  statut: string
  receptionnaire?: string | null
  controleur?: string | null
  numero_bl_fournisseur?: string | null
  [k: string]: unknown
}

interface LigneRecept {
  code_reference: string
  designation: string | null
  lot_fournisseur: string | null
  quantite_bl_kg: number | null
  quantite_pesee_kg: number | null
  ecart_bl_kg: number | null
  ecart_pct: number | null
  statut_qualite: string | null
  code_magasin_dest: string | null
  nb_bobines?: number | null
  [k: string]: unknown
}

export function EtatReception() {
  const [id, setId] = useState('')

  const qListe = useQuery({
    queryKey: ['receptions'],
    queryFn: () => api.get<Reception[]>('/api/receptions?limite=200'),
  })
  const liste = useMemo(() => {
    const d = qListe.data
    const l = Array.isArray(d) ? d : ((d as unknown as { lignes?: Reception[] })?.lignes ?? [])
    return [...l].sort((a, b) => (b.date_reception ?? '').localeCompare(a.date_reception ?? ''))
  }, [qListe.data])

  const choisi = id || liste[0]?.id_reception || ''
  const r = liste.find((x) => x.id_reception === choisi)

  const qLignes = useQuery({
    queryKey: ['lignes-reception', choisi],
    queryFn: () => api.get<LigneRecept[]>(`/api/receptions/${choisi}/lignes`),
    enabled: !!choisi,
  })

  if (qListe.isLoading) return <Chargement texte="Chargement des receptions…" />
  if (!liste.length) return <Alerte ton="info">Aucune reception enregistree.</Alerte>

  const lignes = qLignes.data ?? []
  const totalBl = lignes.reduce((s, l) => s + (l.quantite_bl_kg ?? 0), 0)
  const totalPese = lignes.reduce((s, l) => s + (l.quantite_pesee_kg ?? 0), 0)

  return (
    <div>
      <Choix
        libelle="Reception a imprimer :"
        valeur={choisi}
        surChangement={setId}
        options={liste.map((x) => ({
          valeur: x.id_reception,
          libelle: `${x.numero_reception} — ${(x.date_reception ?? '').slice(0, 10)} — ${x.fournisseur_nom ?? '?'} (${x.statut})`,
        }))}
      />

      {!r ? null : (
        <EtatImprimable
          titre="Bon de reception"
          reference={r.numero_reception}
          sousTitre={r.statut !== 'VALIDEE' ? `Statut : ${r.statut}` : undefined}
          enTete={
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <div className="space-y-1">
                <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                  Fournisseur
                </div>
                <div className="text-[13px] font-semibold">{r.fournisseur_nom ?? '—'}</div>
                {r.numero_bl_fournisseur && (
                  <div className="text-[10px]">
                    <span className="text-neutral-600">BL fournisseur : </span>
                    {r.numero_bl_fournisseur}
                  </div>
                )}
                {r.numero_bc && (
                  <div className="text-[10px]">
                    <span className="text-neutral-600">Bon de commande : </span>
                    {r.numero_bc}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                  Reception
                </div>
                <div className="text-[10px]">
                  <span className="text-neutral-600">Date : </span>
                  {fmt.date(r.date_reception)}
                </div>
                <div className="text-[10px]">
                  <span className="text-neutral-600">Receptionnaire : </span>
                  {r.receptionnaire ?? '—'}
                </div>
                <div className="text-[10px]">
                  <span className="text-neutral-600">Controleur qualite : </span>
                  {r.controleur ?? '—'}
                </div>
              </div>
            </div>
          }
        >
          <TableEtat<LigneRecept>
            colonnes={[
              {
                entete: 'Reference',
                valeur: (l) => (
                  <>
                    <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                    {l.designation && (
                      <div className="text-[9px] text-neutral-600">{l.designation}</div>
                    )}
                  </>
                ),
              },
              { entete: 'Lot', valeur: (l) => l.lot_fournisseur ?? '—' },
              {
                entete: 'Annonce kg',
                numerique: true,
                valeur: (l) => (l.quantite_bl_kg == null ? '—' : fmt.nombre(l.quantite_bl_kg, 2)),
              },
              {
                entete: 'Pese kg',
                numerique: true,
                valeur: (l) =>
                  l.quantite_pesee_kg == null ? '—' : fmt.nombre(l.quantite_pesee_kg, 2),
              },
              {
                entete: 'Ecart',
                numerique: true,
                valeur: (l) =>
                  l.ecart_pct == null
                    ? '—'
                    : `${l.ecart_pct > 0 ? '+' : ''}${fmt.nombre(l.ecart_pct, 2)} %`,
              },
              { entete: 'Qualite', valeur: (l) => l.statut_qualite ?? '—' },
              { entete: 'Magasin', valeur: (l) => l.code_magasin_dest ?? '—' },
            ]}
            lignes={lignes}
            total={[
              `${lignes.length} ligne(s)`,
              '',
              fmt.nombre(totalBl, 2),
              fmt.nombre(totalPese, 2),
              '',
              '',
              '',
            ]}
          />

          <div className="mt-8 grid grid-cols-2 gap-8">
            {['Receptionnaire', 'Controle qualite'].map((s) => (
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
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Proces-verbal d'inventaire                                                  */
/* -------------------------------------------------------------------------- */

interface Inventaire {
  id_inventaire: string
  numero_inventaire: string
  date_inventaire: string
  code_magasin: string
  type_inventaire: string
  statut: string
  responsable?: string | null
  nb_lignes?: number | null
  [k: string]: unknown
}

interface LigneInv {
  code_reference: string
  designation: string | null
  lot_fournisseur: string | null
  quantite_theorique_kg: number | null
  quantite_comptee_kg: number | null
  ecart_kg: number | null
  ecart_pct: number | null
  ecart_mad?: number | null
  motif_ecart: string | null
  [k: string]: unknown
}

export function EtatInventaire() {
  const droits = useDroits('INVENTAIRE')
  const [id, setId] = useState('')
  const [seulsEcarts, setSeulsEcarts] = useState(false)

  const qListe = useQuery({
    queryKey: ['inventaires'],
    queryFn: () => api.get<Inventaire[]>('/api/inventaires'),
  })
  const liste = useMemo(() => {
    const d = qListe.data
    const l = Array.isArray(d) ? d : ((d as unknown as { lignes?: Inventaire[] })?.lignes ?? [])
    return [...l].sort((a, b) => (b.date_inventaire ?? '').localeCompare(a.date_inventaire ?? ''))
  }, [qListe.data])

  const choisi = id || liste[0]?.id_inventaire || ''
  const inv = liste.find((x) => x.id_inventaire === choisi)

  const qLignes = useQuery({
    queryKey: ['lignes-inventaire', choisi],
    queryFn: () => api.get<LigneInv[]>(`/api/inventaires/${choisi}/lignes`),
    enabled: !!choisi,
  })

  if (qListe.isLoading) return <Chargement texte="Chargement des inventaires…" />
  if (!liste.length) return <Alerte ton="info">Aucun inventaire enregistre.</Alerte>

  const toutes = qLignes.data ?? []
  /* Le proces-verbal se lit sur les ECARTS : les lignes conformes sont
     comptees, pas detaillees. Sur cent dix-neuf references dont trois
     s'ecartent, imprimer tout noierait ce qu'on cherche. */
  const lignes = seulsEcarts ? toutes.filter((l) => (l.ecart_kg ?? 0) !== 0) : toutes
  const nbEcarts = toutes.filter((l) => (l.ecart_kg ?? 0) !== 0).length
  const valeurVisible = droits.visible('ecart_mad')
  const totalEcart = toutes.reduce((s, l) => s + (l.ecart_mad ?? 0), 0)

  return (
    <div>
      <Choix
        libelle="Inventaire :"
        valeur={choisi}
        surChangement={setId}
        options={liste.map((x) => ({
          valeur: x.id_inventaire,
          libelle: `${x.numero_inventaire} — ${(x.date_inventaire ?? '').slice(0, 10)} — ${x.code_magasin} (${x.statut})`,
        }))}
      />
      <label className="sans-impression mb-3 flex items-center gap-2 text-[12px] text-attenue-texte">
        <input
          type="checkbox"
          checked={seulsEcarts}
          onChange={(e) => setSeulsEcarts(e.target.checked)}
        />
        N imprimer que les lignes en ecart ({nbEcarts} sur {toutes.length})
      </label>

      {!inv ? null : (
        <EtatImprimable
          titre="Proces-verbal d inventaire"
          reference={inv.numero_inventaire}
          sousTitre={inv.statut !== 'CLOTURE' ? `Statut : ${inv.statut}` : undefined}
          enTete={
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              <span>
                <span className="text-neutral-600">Magasin : </span>
                <span className="font-semibold">{inv.code_magasin}</span>
              </span>
              <span>
                <span className="text-neutral-600">Date : </span>
                {fmt.date(inv.date_inventaire)}
              </span>
              <span>
                <span className="text-neutral-600">Type : </span>
                {inv.type_inventaire}
              </span>
              <span>
                <span className="text-neutral-600">Responsable : </span>
                {inv.responsable ?? '—'}
              </span>
              <span>
                <span className="text-neutral-600">Lignes en ecart : </span>
                <span className="font-semibold">
                  {nbEcarts} sur {toutes.length}
                </span>
              </span>
              {valeurVisible && totalEcart !== 0 && (
                <span>
                  <span className="text-neutral-600">Impact : </span>
                  <span className="font-semibold">{fmt.nombre(totalEcart, 2)} MAD</span>
                </span>
              )}
            </div>
          }
        >
          <TableEtat<LigneInv>
            colonnes={[
              {
                entete: 'Reference',
                valeur: (l) => (
                  <>
                    <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                    {l.designation && (
                      <div className="text-[9px] text-neutral-600">{l.designation}</div>
                    )}
                  </>
                ),
              },
              { entete: 'Lot', valeur: (l) => l.lot_fournisseur ?? '—' },
              {
                entete: 'Theorique kg',
                numerique: true,
                valeur: (l) =>
                  l.quantite_theorique_kg == null ? '—' : fmt.nombre(l.quantite_theorique_kg, 3),
              },
              {
                entete: 'Compte kg',
                numerique: true,
                valeur: (l) =>
                  l.quantite_comptee_kg == null ? '—' : fmt.nombre(l.quantite_comptee_kg, 3),
              },
              {
                entete: 'Ecart kg',
                numerique: true,
                valeur: (l) =>
                  l.ecart_kg == null
                    ? '—'
                    : `${l.ecart_kg > 0 ? '+' : ''}${fmt.nombre(l.ecart_kg, 3)}`,
              },
              {
                entete: 'Ecart %',
                numerique: true,
                valeur: (l) => (l.ecart_pct == null ? '—' : `${fmt.nombre(l.ecart_pct, 2)} %`),
              },
              { entete: 'Justification', valeur: (l) => l.motif_ecart ?? '' },
            ]}
            lignes={lignes}
          />

          <div className="mt-8 grid grid-cols-3 gap-6">
            {['Compte par', 'Verifie par', 'Approuve par'].map((s) => (
              <div key={s}>
                <div className="mb-10 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                  {s}
                </div>
                <div className="border-t border-neutral-500 pt-1 text-[9px] text-neutral-600">
                  Nom et signature
                </div>
              </div>
            ))}
          </div>
        </EtatImprimable>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Plan de production                                                          */
/* -------------------------------------------------------------------------- */

interface Plan {
  id_plan: string
  libelle: string
  statut: string
  date_debut: string
  date_fin: string
  mois_horizon: number
  croissance_annuelle_pct: number
  taux_perte_pct: number
  [k: string]: unknown
}

interface Dossier {
  plan: Plan
  mois: { rang_mois: number; annee_mois: string }[]
  /** Une ligne par couple qualite-mois, non pivotee. */
  production: { code_qualite: string; qualite_nom?: string | null; annee_mois: string; m2_prevus: number }[]
}

export function EtatPlanProduction() {
  const [id, setId] = useState('')

  const qPlans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<Plan[]>('/api/plans'),
  })
  const liste = useMemo(() => {
    const d = qPlans.data
    return Array.isArray(d) ? d : ((d as unknown as { lignes?: Plan[] })?.lignes ?? [])
  }, [qPlans.data])

  const choisi = id || liste.find((p) => p.statut === 'EN_COURS')?.id_plan || liste[0]?.id_plan || ''

  /* Le serveur rend le dossier a plat : une ligne par qualite et par mois.
     Le papier veut une ligne par qualite et une colonne par mois — le pivot se
     fait donc ici. La meme cle de requete que l'ecran Besoins evite un second
     appel quand on arrive de la. */
  const q = useQuery({
    queryKey: ['plan-dossier', choisi],
    queryFn: () => api.get<Dossier>(`/api/plans/${choisi}/production-besoins`),
    enabled: !!choisi,
  })

  const { qualites, mois } = useMemo(() => {
    const d = q.data
    const m = (d?.mois ?? []).map((x) => x.annee_mois)
    const par = new Map<string, { code: string; nom: string; par: Map<string, number>; total: number }>()
    for (const p of d?.production ?? []) {
      let l = par.get(p.code_qualite)
      if (!l) {
        l = { code: p.code_qualite, nom: p.qualite_nom ?? p.code_qualite, par: new Map(), total: 0 }
        par.set(p.code_qualite, l)
      }
      l.par.set(p.annee_mois, (l.par.get(p.annee_mois) ?? 0) + (p.m2_prevus ?? 0))
      l.total += p.m2_prevus ?? 0
    }
    return { qualites: [...par.values()].sort((a, b) => b.total - a.total), mois: m }
  }, [q.data])

  if (qPlans.isLoading) return <Chargement texte="Chargement des plans…" />
  if (!liste.length) return <Alerte ton="info">Aucun plan de production.</Alerte>
  if (q.isLoading) return <Chargement texte="Preparation du plan…" />

  const plan = q.data?.plan
  if (!plan || !qualites.length) {
    return (
      <Alerte ton="info">
        Ce plan ne porte aucune ligne de production. Ouvrez-le depuis l ecran Plan de production
        pour completer sa grille.
      </Alerte>
    )
  }

  return (
    <div>
      <Choix
        libelle="Plan :"
        valeur={choisi}
        surChangement={setId}
        options={liste.map((p) => ({
          valeur: p.id_plan,
          libelle: `${p.libelle} — ${p.statut} — ${p.date_debut} au ${p.date_fin}`,
        }))}
      />

      <EtatImprimable
        titre="Plan de production"
        reference={plan.libelle}
        sousTitre={`${plan.date_debut} au ${plan.date_fin}`}
        enTete={
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="text-neutral-600">Statut : </span>
              <span className="font-semibold">{plan.statut}</span>
            </span>
            <span>
              <span className="text-neutral-600">Horizon : </span>
              {mois.length} mois
            </span>
            <span>
              <span className="text-neutral-600">Croissance : </span>
              {fmt.nombre(plan.croissance_annuelle_pct ?? 0, 2)} %
            </span>
            <span>
              <span className="text-neutral-600">Taux de perte fige : </span>
              {fmt.nombre(plan.taux_perte_pct ?? 0, 2)} %
            </span>
          </div>
        }
      >
        <div className="defilement-x">
          <TableEtat<(typeof qualites)[number]>
            colonnes={[
              { entete: 'Qualite', valeur: (p) => p.nom },
              ...mois.map((m) => ({
                entete: m.slice(2),
                numerique: true,
                valeur: (p: (typeof qualites)[number]) => {
                  const v = p.par.get(m)
                  return v ? fmt.entier(v) : ''
                },
              })),
              {
                entete: 'Total m2',
                numerique: true,
                valeur: (p: (typeof qualites)[number]) => fmt.entier(p.total),
              },
            ]}
            lignes={qualites}
            total={[
              `${qualites.length} qualite(s)`,
              ...mois.map((m) =>
                fmt.entier(qualites.reduce((s, p) => s + (p.par.get(m) ?? 0), 0)),
              ),
              fmt.entier(qualites.reduce((s, p) => s + p.total, 0)),
            ]}
          />
        </div>
        <p className="mt-2 text-[9px] text-neutral-600">
          Metres carres prevus par qualite et par mois. Le taux de perte figure a l entete : c est
          celui fige sur le plan, pas le parametre general du jour.
        </p>
      </EtatImprimable>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Besoins matiere                                                             */
/* -------------------------------------------------------------------------- */

interface Besoin {
  code_reference: string
  designation?: string | null
  fournisseur_nom?: string | null
  annee_mois: string
  quantite_kg: number
  [k: string]: unknown
}

export function EtatBesoins() {
  const qPlans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<Plan[]>('/api/plans'),
  })
  const liste = useMemo(() => {
    const d = qPlans.data
    return Array.isArray(d) ? d : ((d as unknown as { lignes?: Plan[] })?.lignes ?? [])
  }, [qPlans.data])
  const [id, setId] = useState('')
  const choisi = id || liste.find((p) => p.statut === 'EN_COURS')?.id_plan || liste[0]?.id_plan || ''

  const q = useQuery({
    queryKey: ['plan-besoins', choisi],
    queryFn: () => api.get<Besoin[]>(`/api/plans/${choisi}/besoins`),
    enabled: !!choisi,
  })

  /* Le serveur rend une ligne par couple reference-mois ; le papier veut une
     ligne par reference et une colonne par mois. Le pivot se fait ici. */
  const { refs, mois } = useMemo(() => {
    const brut = q.data ?? []
    const m = [...new Set(brut.map((b) => b.annee_mois))].sort()
    const par = new Map<string, { code: string; designation?: string | null; par: Map<string, number>; total: number }>()
    for (const b of brut) {
      let l = par.get(b.code_reference)
      if (!l) {
        l = { code: b.code_reference, designation: b.designation, par: new Map(), total: 0 }
        par.set(b.code_reference, l)
      }
      l.par.set(b.annee_mois, (l.par.get(b.annee_mois) ?? 0) + b.quantite_kg)
      l.total += b.quantite_kg
    }
    return { refs: [...par.values()].sort((a, b) => b.total - a.total), mois: m }
  }, [q.data])

  if (qPlans.isLoading) return <Chargement texte="Chargement des plans…" />
  if (!liste.length) return <Alerte ton="info">Aucun plan de production.</Alerte>
  if (q.isLoading) return <Chargement texte="Explosion des recettes…" />
  if (!refs.length) {
    return (
      <Alerte ton="info">
        Ce plan ne porte aucun besoin calcule. Relancez le calcul depuis l ecran Besoins.
      </Alerte>
    )
  }

  const plan = liste.find((p) => p.id_plan === choisi)

  return (
    <div>
      <Choix
        libelle="Plan :"
        valeur={choisi}
        surChangement={setId}
        options={liste.map((p) => ({
          valeur: p.id_plan,
          libelle: `${p.libelle} — ${p.statut}`,
        }))}
      />

      <EtatImprimable
        titre="Besoins matiere"
        reference={plan?.libelle}
        sousTitre={plan ? `${plan.date_debut} au ${plan.date_fin}` : undefined}
        enTete={
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="text-neutral-600">References : </span>
              <span className="font-semibold">{refs.length}</span>
            </span>
            <span>
              <span className="text-neutral-600">Mois : </span>
              {mois.length}
            </span>
            <span>
              <span className="text-neutral-600">Total : </span>
              <span className="font-semibold">
                {fmt.nombre(refs.reduce((s, r) => s + r.total, 0), 0)} kg
              </span>
            </span>
          </div>
        }
      >
        <div className="defilement-x">
          <TableEtat<(typeof refs)[number]>
            colonnes={[
              {
                entete: 'Reference',
                valeur: (r) => (
                  <>
                    <div className="font-mono text-[10px] font-medium">{r.code}</div>
                    {r.designation && (
                      <div className="text-[9px] text-neutral-600">{r.designation}</div>
                    )}
                  </>
                ),
              },
              ...mois.map((m) => ({
                entete: m.slice(2),
                numerique: true,
                valeur: (r: (typeof refs)[number]) => {
                  const v = r.par.get(m)
                  // Un mois sans besoin reste vide plutot que de porter un zero :
                  // sur douze colonnes, les zeros masquent les vrais chiffres.
                  return v ? fmt.nombre(v, 0) : ''
                },
              })),
              {
                entete: 'Total kg',
                numerique: true,
                valeur: (r: (typeof refs)[number]) => fmt.nombre(r.total, 0),
              },
            ]}
            lignes={refs}
            total={[
              `${refs.length} reference(s)`,
              ...mois.map((m) =>
                fmt.nombre(
                  refs.reduce((s, r) => s + (r.par.get(m) ?? 0), 0),
                  0,
                ),
              ),
              fmt.nombre(refs.reduce((s, r) => s + r.total, 0), 0),
            ]}
          />
        </div>
        <p className="mt-2 text-[9px] text-neutral-600">
          Kilos par reference et par mois, issus de l explosion des recettes figees sur le plan.
          Les references sont triees par besoin total decroissant.
        </p>
      </EtatImprimable>
    </div>
  )
}

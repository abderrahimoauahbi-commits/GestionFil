/**
 * Les engagements d'importation (EI) du dossier — PAR FOURNISSEUR, PAR FACTURE.
 *
 * LE GROUPAGE (regime 010, demande du 01/10/2026). Un dossier reunit les
 * factures de plusieurs fournisseurs, chacune dans sa devise. L'engagement,
 * lui, s'ouvre en banque sur la proforma d'UN fournisseur, dans SA devise ; la
 * douane l'impute au dedouanement, et la banque ne paie que dans cette limite.
 * D'ou la forme de l'onglet : un bloc par fournisseur, ses engagements, et ses
 * factures — chacune designe l'engagement sur lequel elle s'impute.
 *
 * CE BLOC NE GERE PAS LE CREDIT. Il RANGE et RAPPROCHE : le reste affiche est
 * celui des factures de CE dossier ; les reglements appartiennent a la
 * tresorerie.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Selecteur } from '../../composants/ui/base'
import { cn, fmt } from '../../lib/utils'
import { echec, nombre, useRafraichir, type Signaler } from './dialogues'
import type { DossierComplet, Engagement, Facture } from './types'

const VIDE = { code_fournisseur: '', code_devise: '', numero_ei: '', banque: '', date_ei: '', quantite_kg: '', montant_devise: '', notes: '' }
const SANS = '__sans__'

interface FournisseurActif {
  code_fournisseur: string
  nom: string
  code_devise?: string
}

export function EngagementsDossier({ d, ecrire, signaler }: { d: DossierComplet; ecrire: boolean; signaler?: Signaler }) {
  const rafraichir = useRafraichir(d.dossier.id_dossier)
  const [n, setN] = useState(VIDE)
  const engagements: Engagement[] = useMemo(() => d.engagements ?? [], [d.engagements])

  const qFrs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: ({ signal }) => api.get<FournisseurActif[]>('/api/fournisseurs?actif=1&limite=500', { signal }),
    enabled: ecrire,
  })
  const qDevises = useQuery({
    queryKey: ['devises'],
    queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }),
    enabled: ecrire,
  })

  /* UN BLOC PAR FOURNISSEUR : ceux des factures, ceux des engagements, et un
     dernier pour les engagements saisis avant qu'on demande le fournisseur. */
  const blocs = useMemo(() => {
    const m = new Map<string, { nom: string; factures: Facture[]; engagements: Engagement[] }>()
    const bloc = (code: string, nom: string) => {
      if (!m.has(code)) m.set(code, { nom, factures: [], engagements: [] })
      return m.get(code)!
    }
    for (const f of d.factures) bloc(f.code_fournisseur, f.fournisseur_nom).factures.push(f)
    for (const e of engagements)
      bloc(e.code_fournisseur ?? SANS, e.fournisseur_nom ?? 'Fournisseur non précisé').engagements.push(e)
    return [...m.entries()].sort(([a], [b]) => (a === SANS ? 1 : b === SANS ? -1 : 0))
  }, [d.factures, engagements])

  // Fournisseurs du dossier d'abord : c'est eux qu'on couvre.
  const choixFrs = useMemo(() => {
    const duDossier = new Set(d.factures.map((f) => f.code_fournisseur))
    const tous = qFrs.data ?? d.factures.map((f) => ({ code_fournisseur: f.code_fournisseur, nom: f.fournisseur_nom }))
    return [...tous].sort((a, b) => Number(duDossier.has(b.code_fournisseur)) - Number(duDossier.has(a.code_fournisseur)))
  }, [qFrs.data, d.factures])
  const deviseFrs = (code: string) =>
    qFrs.data?.find((f) => f.code_fournisseur === code)?.code_devise ??
    d.factures.find((f) => f.code_fournisseur === code)?.code_devise ??
    ''

  const ajouter = useMutation({
    mutationFn: () =>
      api.post(`/api/import/dossiers/${d.dossier.id_dossier}/engagements`, {
        code_fournisseur: n.code_fournisseur || null,
        code_devise: n.code_devise || null,
        numero_ei: n.numero_ei,
        banque: n.banque || null,
        date_ei: n.date_ei || null,
        quantite_kg: n.quantite_kg ? nombre(n.quantite_kg) : null,
        montant_devise: n.montant_devise ? nombre(n.montant_devise) : null,
        notes: n.notes || null,
      }),
    onSuccess: () => {
      toast.success(`Engagement ${n.numero_ei.replace(/\s/g, '')} rattaché au dossier`)
      setN((x) => ({ ...VIDE, code_fournisseur: x.code_fournisseur, code_devise: x.code_devise }))
      rafraichir()
    },
    onError: echec,
  })

  const retirer = useMutation({
    mutationFn: (id: string) => api.delete(`/api/import/engagements/${id}`),
    onSuccess: () => {
      toast.success('Engagement retiré — ses factures n’ont plus d’engagement')
      rafraichir()
    },
    onError: echec,
  })

  const imputer = useMutation({
    mutationFn: (v: { facture: string; engagement: string }) =>
      api.patch(`/api/import/factures/${v.facture}`, { id_engagement: v.engagement }),
    onSuccess: () => {
      toast.success('Imputation de la facture enregistrée')
      rafraichir()
    },
    onError: echec,
  })

  const maj = (k: keyof typeof VIDE) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setN((x) => ({ ...x, [k]: e.target.value }))
  // L'engagement en cours de saisie, complet, part avec « Enregistrer tout ».
  const pret = !!n.numero_ei.trim() && !!n.code_fournisseur
  useEffect(() => {
    signaler?.('engagement', pret && ecrire ? { libelle: `engagement ${n.numero_ei.trim()}`, enregistrer: () => ajouter.mutateAsync() } : null)
  })
  useEffect(() => () => signaler?.('engagement', null), [signaler])

  /** Ce que les factures du dossier imputent sur un engagement, en devise. */
  const impute = (id: string) =>
    d.factures.filter((f) => f.id_engagement === id).reduce((t, f) => t + f.montant_lignes_devise, 0)

  const th = 'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte'
  const td = 'px-2 py-1'
  const champ = 'h-8 text-[12.5px]'
  const sansEngagement = d.factures.filter((f) => !f.id_engagement).length

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Engagements d’importation</CarteTitre>
        <span className="min-w-0 truncate text-[11.5px] text-attenue-texte">
          Un engagement par proforma fournisseur, dans sa devise ; chaque facture désigne celui sur lequel elle s’impute.
          {sansEngagement > 0 && <span className="text-alerte"> · {sansEngagement} facture(s) sans engagement</span>}
        </span>
      </CarteEntete>
      <CarteCorps className="space-y-4">
        {blocs.length === 0 && !ecrire && <p className="text-[12.5px] text-attenue-texte">Aucun engagement ni facture.</p>}

        {blocs.map(([code, b]) => {
          const devises = [...new Set([...b.engagements.map((e) => e.code_devise ?? ''), ...b.factures.map((f) => f.code_devise)].filter(Boolean))]
          const possibles = engagements.filter((e) => e.code_fournisseur === code || e.code_fournisseur == null)
          return (
            <section key={code} className="rounded-[var(--radius)] border border-bordure">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-bordure bg-attenue/30 px-3 py-1.5">
                <span className="font-semibold">{b.nom}</span>
                {devises.map((x) => <Badge key={x} ton="neutre">{x}</Badge>)}
                <span className="text-[11.5px] text-attenue-texte">
                  {b.engagements.length} engagement(s) · {b.factures.length} facture(s)
                </span>
              </header>

              <div className="defilement-x">
                <table className="w-full min-w-[52rem] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-bordure">
                      <th className={cn(th, 'text-left')}>N° d’engagement</th>
                      <th className={cn(th, 'w-28 text-left')}>Banque</th>
                      <th className={cn(th, 'w-28 text-left')}>Date</th>
                      <th className={cn(th, 'w-24 text-right')}>Qté (kg)</th>
                      <th className={cn(th, 'w-32 text-right')}>Montant</th>
                      <th className={cn(th, 'w-32 text-right')}>Imputé</th>
                      <th className={cn(th, 'w-32 text-right')}>Reste</th>
                      <th className={cn(th, 'w-44 text-left')}>Remarque</th>
                      {ecrire && <th className={cn(th, 'w-10')} />}
                    </tr>
                  </thead>
                  <tbody>
                    {b.engagements.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-2 py-2 text-[12px] text-alerte">
                          Aucun engagement pour ce fournisseur.
                        </td>
                      </tr>
                    )}
                    {b.engagements.map((e) => {
                      const imp = impute(e.id_engagement)
                      const reste = e.montant_devise != null ? e.montant_devise - imp : null
                      return (
                        <tr key={e.id_engagement} className="border-b border-bordure/60">
                          <td className={cn(td, 'font-medium tabular-nums')}>{e.numero_ei}</td>
                          <td className={td}>{e.banque ?? '—'}</td>
                          <td className={td}>{e.date_ei ? fmt.date(e.date_ei) : '—'}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{e.quantite_kg != null ? fmt.nombre(e.quantite_kg, 2) : '—'}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>
                            {e.montant_devise != null ? `${fmt.nombre(e.montant_devise, 2)} ${e.code_devise ?? ''}` : '—'}
                          </td>
                          <td className={cn(td, 'text-right tabular-nums')}>{imp > 0 ? fmt.nombre(imp, 2) : '—'}</td>
                          <td className={cn(td, 'text-right font-medium tabular-nums', reste != null && reste < -0.005 && 'text-danger')}>
                            {reste == null ? '—' : fmt.nombre(reste, 2)}
                          </td>
                          <td className={cn(td, 'max-w-44 truncate text-attenue-texte')} title={e.notes ?? undefined}>{e.notes ?? '—'}</td>
                          {ecrire && (
                            <td className={td}>
                              <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10"
                                aria-label={`Retirer l’engagement ${e.numero_ei}`} onClick={() => retirer.mutate(e.id_engagement)}>
                                <Trash2 />
                              </Bouton>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* LES FACTURES DU FOURNISSEUR, chacune sur son engagement. */}
              {b.factures.length > 0 && (
                <div className="border-t border-bordure px-3 py-2">
                  <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Factures</div>
                  <div className="grid gap-1.5">
                    {b.factures.map((f) => (
                      <div key={f.id_facture} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                        <span className="w-40 font-medium tabular-nums">{f.numero_facture}</span>
                        <span className="w-24 text-attenue-texte">{fmt.date(f.date_facture)}</span>
                        <span className="w-36 text-right tabular-nums">{fmt.nombre(f.montant_lignes_devise, 2)} {f.code_devise}</span>
                        <Selecteur className={cn('h-8 w-64', !f.id_engagement && 'border-alerte')} value={f.id_engagement ?? ''}
                          disabled={!ecrire || imputer.isPending} aria-label={`Engagement de la facture ${f.numero_facture}`}
                          onChange={(ev) => imputer.mutate({ facture: f.id_facture, engagement: ev.target.value })}>
                          <option value="">Sans engagement</option>
                          {possibles.map((e) => (
                            <option key={e.id_engagement} value={e.id_engagement}>
                              {e.numero_ei}{e.code_devise ? ` · ${e.code_devise}` : ''}
                            </option>
                          ))}
                        </Selecteur>
                        {(() => {
                          const e = engagements.find((x) => x.id_engagement === f.id_engagement)
                          return e?.code_devise && e.code_devise !== f.code_devise ? (
                            <span className="text-[11.5px] text-alerte">
                              facture en {f.code_devise}, engagement en {e.code_devise}
                            </span>
                          ) : null
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )
        })}

        {/* LA SAISIE D'UN ENGAGEMENT : le fournisseur d'abord, sa devise suit. */}
        {ecrire && (
          <div className="rounded-[var(--radius)] border border-dashed border-bordure bg-attenue/20 p-2">
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">Nouvel engagement</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
              <Selecteur className={cn(champ, 'xl:col-span-2')} value={n.code_fournisseur} aria-label="Fournisseur de l’engagement"
                onChange={(e) => {
                  const code = e.target.value
                  setN((x) => ({ ...x, code_fournisseur: code, code_devise: deviseFrs(code) || x.code_devise }))
                }}>
                <option value="">Fournisseur…</option>
                {choixFrs.map((f) => (
                  <option key={f.code_fournisseur} value={f.code_fournisseur}>{f.nom}</option>
                ))}
              </Selecteur>
              <Champ className={champ} value={n.numero_ei} onChange={maj('numero_ei')} placeholder="N° 20261000000000905984"
                aria-label="Numéro de l’engagement d’importation" />
              <Selecteur className={champ} value={n.code_devise} onChange={maj('code_devise')} aria-label="Devise de l’engagement">
                <option value="">Devise…</option>
                {(qDevises.data ?? []).map((x) => (
                  <option key={x.code_devise}>{x.code_devise}</option>
                ))}
              </Selecteur>
              <Champ className={champ} value={n.banque} onChange={maj('banque')} placeholder="Banque" aria-label="Banque" />
              <Champ className={champ} type="date" value={n.date_ei} onChange={maj('date_ei')} aria-label="Date de l’engagement" />
              <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={n.quantite_kg} onChange={maj('quantite_kg')} placeholder="Qté kg"
                aria-label="Quantité couverte, en kilos" />
              <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={n.montant_devise} onChange={maj('montant_devise')}
                placeholder={`Montant ${n.code_devise}`.trim()} aria-label="Montant couvert, dans la devise de l’engagement" />
              <Champ className={cn(champ, 'md:col-span-3 xl:col-span-7')} value={n.notes} onChange={maj('notes')} placeholder="Remarque"
                aria-label="Remarque sur l’engagement" />
              <Bouton taille="sm" className="h-8" disabled={!n.numero_ei.trim() || !n.code_fournisseur} chargement={ajouter.isPending}
                title={!n.code_fournisseur ? 'Choisissez le fournisseur couvert' : 'Ajouter l’engagement au dossier'}
                onClick={() => ajouter.mutate()}>
                <Plus />
                Ajouter
              </Bouton>
            </div>
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
}

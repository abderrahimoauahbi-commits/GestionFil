/**
 * Un retour fournisseur LIBRE, sur son propre ecran (12/10/2026).
 *
 * Comme l'avoir d'une gestion commerciale : le fournisseur, puis les
 * references en stock (magasin, lot s'il y en a), la quantite et le prix — le
 * prix est propose au CMUP du magasin, les achats le corrigent. Aucun lien avec
 * une reception. Le montant de l'avoir = somme quantite x prix.
 * BROUILLON, puis VALIDE par un autre compte : la marchandise sort du stock au
 * prix du retour (le CMUP du stock restant en tient compte, jamais sous zero ;
 * le reste au journal des ecarts). Valide, le document se fige.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { Alerte, Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Chargement, Etiq, Selecteur } from '../../composants/ui/base'
import { useConfirmation } from '../../composants/ui/surcouches'
import { useGardeSaisie } from '../../hooks/useGardeSaisie'
import { cn, fmt } from '../../lib/utils'
import { LIBELLE_STATUT_RETOUR, MODULE_RETOURS } from './commun'

interface Disponible {
  code_reference: string
  designation: string | null
  code_magasin: string
  lot_fournisseur: string | null
  quantite_kg: number
  cmup_mad?: number | null
}

interface RetourDoc {
  retour: {
    id_retour: string
    numero_retour: string
    statut_retour: 'BROUILLON' | 'VALIDE'
    date_retour: string
    code_fournisseur: string
    fournisseur_nom: string
    motif: string
    observations: string | null
    saisi_par: string
    id_utilisateur_creation: string
    valide_par: string | null
    date_validation: string | null
    montant_avoir_mad?: number | null
  }
  lignes: {
    ligne_numero: number
    code_reference: string
    designation: string | null
    code_magasin: string
    lot_fournisseur: string | null
    quantite_kg: number
    prix_kg_mad?: number | null
    montant_ligne_mad?: number | null
    nb_bobines: number | null
    code_motif_ligne: string
    motif_libelle: string
    numero_mouvement: string | null
    cmup_avant?: number | null
    cmup_apres?: number | null
    ecart_mad?: number | null
  }[]
}

interface LigneSaisie {
  cle: number
  code_magasin: string
  code_reference: string
  lot: string
  kg: string
  prix: string
  bobines: string
  motif: string
}

const MOTIFS = [
  { code: 'R1', libelle: 'Défaut qualité matière' },
  { code: 'R2', libelle: 'Erreur de référence' },
]

const nombre = (s: string) => {
  const n = Number(s.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1.5'

export function Retour() {
  const { id } = useParams()
  const q = useQuery({
    queryKey: ['retour-fournisseur', id],
    queryFn: ({ signal }) => api.get<RetourDoc>(`/api/retours-fournisseur/${id}`, { signal }),
    enabled: !!id,
  })
  if (id && q.isLoading) return <Chargement texte="Lecture du retour…" />
  if (id && !q.data) return <Alerte ton="alerte">Retour introuvable.</Alerte>
  // Une saisie neuve a chaque version enregistree : ses valeurs initiales sont
  // celles du serveur.
  return <DocumentRetour key={q.data ? JSON.stringify(q.data) : 'nouveau'} id={id} doc={q.data} />
}

let compteur = 0
const ligneVide = (magasin = ''): LigneSaisie => ({
  cle: ++compteur, code_magasin: magasin, code_reference: '', lot: '', kg: '', prix: '', bobines: '', motif: '',
})

function DocumentRetour({ id, doc }: { id?: string; doc?: RetourDoc }) {
  const nouveau = !id
  const droits = useDroits(MODULE_RETOURS)
  const { moi } = useAuth()
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const brouillon = nouveau || doc?.retour.statut_retour === 'BROUILLON'
  const ecrire = droits.peutEcrire && brouillon

  const [fournisseur, setFournisseur] = useState(doc?.retour.code_fournisseur ?? '')
  const [date, setDate] = useState((doc?.retour.date_retour ?? new Date().toISOString()).slice(0, 10))
  const [motif, setMotif] = useState(doc?.retour.motif ?? '')
  const [observations, setObservations] = useState(doc?.retour.observations ?? '')
  const [lignes, setLignes] = useState<LigneSaisie[]>(() =>
    doc && doc.lignes.length > 0
      ? doc.lignes.map((l) => ({
          cle: ++compteur,
          code_magasin: l.code_magasin,
          code_reference: l.code_reference,
          lot: l.lot_fournisseur ?? '',
          kg: String(l.quantite_kg),
          prix: l.prix_kg_mad === null || l.prix_kg_mad === undefined ? '' : String(l.prix_kg_mad),
          bobines: l.nb_bobines === null ? '' : String(l.nb_bobines),
          motif: l.code_motif_ligne,
        }))
      : [ligneVide()],
  )
  const etat = JSON.stringify({ fournisseur, date, motif, observations, l: lignes.map((x) => ({ ...x, cle: 0 })) })
  const [initial] = useState(etat)

  const qFournisseurs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: ({ signal }) => api.get<{ code_fournisseur: string; nom: string }[]>('/api/fournisseurs?actif=1&limite=500', { signal }),
    enabled: ecrire,
  })
  const qDispo = useQuery({
    queryKey: ['retours-disponible'],
    queryFn: ({ signal }) => api.get<Disponible[]>('/api/retours-fournisseur/disponible', { signal }),
    enabled: ecrire,
  })
  const dispo = useMemo(() => qDispo.data ?? [], [qDispo.data])
  const magasins = useMemo(() => [...new Set(dispo.map((d) => d.code_magasin))].sort(), [dispo])
  const dispoDe = (l: LigneSaisie) => dispo.filter((d) => d.code_magasin === l.code_magasin && d.code_reference === l.code_reference)
  const ligneStock = (l: LigneSaisie) => dispoDe(l).find((d) => (d.lot_fournisseur ?? '') === l.lot)

  const maj = (cle: number, v: Partial<LigneSaisie>) => setLignes((x) => x.map((l) => (l.cle === cle ? { ...l, ...v } : l)))
  // Choisir la reference propose le premier lot que le magasin porte, et le
  // prix au CMUP du magasin.
  const choisirReference = (l: LigneSaisie, code: string) => {
    const premier = dispo.find((d) => d.code_magasin === l.code_magasin && d.code_reference === code)
    maj(l.cle, {
      code_reference: code,
      lot: premier?.lot_fournisseur ?? '',
      prix: premier?.cmup_mad === null || premier?.cmup_mad === undefined ? '' : String(premier.cmup_mad),
    })
  }

  const saisies = lignes.filter((l) => l.code_reference && nombre(l.kg) > 0)
  const depassements = saisies.filter((l) => nombre(l.kg) > (ligneStock(l)?.quantite_kg ?? Infinity) + 0.0005)
  const incompletes = saisies.filter((l) => !l.code_magasin || !l.motif)
  const montant = saisies.reduce((t, l) => t + Math.round(nombre(l.kg) * nombre(l.prix) * 100) / 100, 0)
  const modifie = etat !== initial
  const complet = !!fournisseur && motif.trim().length >= 3 && saisies.length > 0 && depassements.length === 0 && incompletes.length === 0
  const quitter = useGardeSaisie(ecrire && modifie)

  const corps = () => ({
    code_fournisseur: fournisseur,
    date_retour: date,
    motif: motif.trim(),
    observations: observations.trim() || null,
    lignes: saisies.map((l) => ({
      code_reference: l.code_reference,
      code_magasin: l.code_magasin,
      lot_fournisseur: l.lot || null,
      quantite_kg: nombre(l.kg),
      prix_kg_mad: l.prix.trim() === '' ? null : nombre(l.prix),
      nb_bobines: l.bobines.trim() === '' ? null : Math.round(nombre(l.bobines)),
      code_motif_ligne: l.motif,
    })),
  })
  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['retours-fournisseur'] })
    void qc.invalidateQueries({ queryKey: ['retour-fournisseur', id] })
    void qc.invalidateQueries({ queryKey: ['retours-disponible'] })
  }
  const enregistrer = useMutation({
    mutationFn: () =>
      nouveau
        ? api.post<{ id_retour: string; numero: string }>('/api/retours-fournisseur', corps())
        : api.put<{ id_retour: string; numero: string }>(`/api/retours-fournisseur/${id}`, corps()),
    onSuccess: (r) => {
      toast.success(`Retour ${r.numero} enregistré en brouillon — un autre compte le validera`)
      rafraichir()
      if (nouveau) naviguer(`/retours-fournisseur/${r.id_retour}`, { replace: true })
    },
    onError: echec,
  })
  const valider = useMutation({
    mutationFn: () => api.post<{ numero: string; mouvements: string[] }>(`/api/retours-fournisseur/${id}/valider`),
    onSuccess: (r) => {
      toast.success(`Retour ${r.numero} validé — la marchandise est sortie du stock (${r.mouvements.join(', ')})`)
      rafraichir()
    },
    onError: echec,
  })
  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/retours-fournisseur/${id}`),
    onSuccess: () => {
      toast.success('Brouillon supprimé')
      rafraichir()
      naviguer('/retours-fournisseur')
    },
    onError: echec,
  })

  const auteur = doc?.retour.id_utilisateur_creation === moi?.id
  // Les prix sont masques au magasinier : le serveur ne les envoie pas, et
  // sans prix saisi il prend le CMUP du magasin.
  const prixVisibles = droits.visible('prix_kg_mad')

  return (
    <div className="space-y-3">
      <EnTetePage
        titre={nouveau ? 'Nouveau retour fournisseur' : `Retour ${doc!.retour.numero_retour}`}
        description={
          nouveau ? (
            'Le fournisseur, puis ce qui repart du stock, à quel prix et pourquoi.'
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge ton={brouillon ? 'neutre' : 'succes'}>{LIBELLE_STATUT_RETOUR[doc!.retour.statut_retour]}</Badge>
              <span>{doc!.retour.fournisseur_nom}</span>
              <span>saisi par {doc!.retour.saisi_par}</span>
              {doc!.retour.valide_par && <span>validé par {doc!.retour.valide_par} le {fmt.date(doc!.retour.date_validation)}</span>}
            </span>
          )
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/retours-fournisseur'))}>
              <ArrowLeft />
              Retours
            </Bouton>
            {ecrire && !nouveau && (
              <Bouton
                variante="contour"
                className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: `Supprimer le brouillon ${doc!.retour.numero_retour} ?`,
                    destructif: true,
                    libelleConfirmer: 'Supprimer',
                    description: 'Un brouillon n’a rien sorti du stock.',
                    action: () => supprimer.mutate(),
                  })
                }
              >
                <Trash2 />
                Supprimer
              </Bouton>
            )}
            {ecrire && (
              <Bouton variante={nouveau ? 'primaire' : 'contour'} disabled={!complet || !modifie} chargement={enregistrer.isPending}
                onClick={() => enregistrer.mutate()}>
                <Save />
                Enregistrer
              </Bouton>
            )}
            {!nouveau && brouillon && droits.peutValider && (
              <Bouton
                disabled={modifie || auteur}
                title={auteur ? 'Celui qui a saisi le retour ne le valide pas : un autre compte le contrôle.' : modifie ? 'Enregistrez d’abord' : undefined}
                chargement={valider.isPending}
                onClick={() =>
                  confirmation.demander({
                    titre: `Valider le retour ${doc!.retour.numero_retour} ?`,
                    description: 'La marchandise sort du stock au prix du retour. Le retour ne se modifiera plus.',
                    libelleConfirmer: 'Valider le retour',
                    action: () => valider.mutate(),
                  })
                }
              >
                <ShieldCheck />
                Valider
              </Bouton>
            )}
          </>
        }
      />

      <Carte>
        <CarteEntete>
          <CarteTitre>Le retour</CarteTitre>
        </CarteEntete>
        <CarteCorps className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <Etiq obligatoire htmlFor="rfo-fournisseur">Fournisseur</Etiq>
            {ecrire ? (
              <Selecteur id="rfo-fournisseur" className="w-full" value={fournisseur} onChange={(e) => setFournisseur(e.target.value)}>
                <option value="">Choisir le fournisseur…</option>
                {(qFournisseurs.data ?? []).map((f) => (
                  <option key={f.code_fournisseur} value={f.code_fournisseur}>{f.nom}</option>
                ))}
              </Selecteur>
            ) : (
              <div className="py-1.5 text-[13px]">{doc?.retour.fournisseur_nom}</div>
            )}
          </div>
          <div>
            <Etiq obligatoire htmlFor="rfo-date">Date du retour</Etiq>
            <Champ id="rfo-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!ecrire} />
          </div>
          {prixVisibles && (
            <div>
              <Etiq>Montant de l’avoir</Etiq>
              <div className="py-1.5 text-[15px] font-semibold tabular-nums">
                {fmt.nombre(ecrire ? montant : (doc?.retour.montant_avoir_mad ?? 0), 2)} DH
              </div>
            </div>
          )}
          <div className="md:col-span-2">
            <Etiq obligatoire htmlFor="rfo-motif">Motif du retour</Etiq>
            <Champ id="rfo-motif" value={motif} onChange={(e) => setMotif(e.target.value)} disabled={!ecrire}
              placeholder="Ex. : bobines tachées, teinte non conforme" />
          </div>
          <div className="md:col-span-2">
            <Etiq htmlFor="rfo-obs">Observations</Etiq>
            <Champ id="rfo-obs" value={observations} onChange={(e) => setObservations(e.target.value)} disabled={!ecrire}
              placeholder="Transporteur, bon de sortie, accord du fournisseur…" />
          </div>
        </CarteCorps>
      </Carte>

      <Carte>
        <CarteEntete>
          <CarteTitre>Ce qui repart</CarteTitre>
          {ecrire && prixVisibles && (
            <span className="text-[11.5px] text-attenue-texte">Le prix est proposé au CMUP du magasin ; corrigez-le au prix convenu.</span>
          )}
        </CarteEntete>
        <CarteCorps className="p-0">
          {ecrire ? (
            qDispo.isLoading ? (
              <Chargement texte="Lecture du stock…" />
            ) : (
              <div className="divide-y divide-bordure/60">
                {lignes.map((l, i) => {
                  const lots = dispoDe(l)
                  const stock = ligneStock(l)
                  const refs = [...new Map(dispo.filter((d) => d.code_magasin === l.code_magasin)
                    .map((d) => [d.code_reference, d.designation])).entries()]
                  const trop = !!stock && nombre(l.kg) > stock.quantite_kg + 0.0005
                  return (
                    <div key={l.cle}
                      className="grid grid-cols-2 items-end gap-2 p-2 md:grid-cols-4 xl:grid-cols-[9rem_minmax(12rem,1fr)_10rem_7rem_7rem_6rem_13rem_2rem]">
                      <div>
                        {i === 0 && <Etiq htmlFor={`rfo-mag-${l.cle}`}>Magasin</Etiq>}
                        <Selecteur id={`rfo-mag-${l.cle}`} className="h-8 w-full" aria-label="Magasin" value={l.code_magasin}
                          onChange={(e) => maj(l.cle, { code_magasin: e.target.value, code_reference: '', lot: '', prix: '' })}>
                          <option value="">Magasin…</option>
                          {magasins.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Selecteur>
                      </div>
                      <div>
                        {i === 0 && <Etiq>Référence</Etiq>}
                        <Selecteur className="h-8 w-full" aria-label="Référence" value={l.code_reference} disabled={!l.code_magasin}
                          onChange={(e) => choisirReference(l, e.target.value)}>
                          <option value="">Référence en stock…</option>
                          {refs.map(([c, d]) => <option key={c} value={c}>{c}{d ? ` — ${d}` : ''}</option>)}
                        </Selecteur>
                      </div>
                      <div>
                        {i === 0 && <Etiq>Lot</Etiq>}
                        <Selecteur className="h-8 w-full" aria-label="Lot" value={l.lot} disabled={lots.length === 0}
                          onChange={(e) => maj(l.cle, { lot: e.target.value })}>
                          {lots.map((d) => (
                            <option key={d.lot_fournisseur ?? ''} value={d.lot_fournisseur ?? ''}>
                              {d.lot_fournisseur ?? 'Sans lot'} ({fmt.nombre(d.quantite_kg, 2)} kg)
                            </option>
                          ))}
                        </Selecteur>
                      </div>
                      <div>
                        {i === 0 && <Etiq>Quantité kg</Etiq>}
                        <Champ className={cn('h-8 text-right', trop && 'border-danger')} inputMode="decimal" aria-label="Quantité kg"
                          value={l.kg} onChange={(e) => maj(l.cle, { kg: e.target.value })} placeholder="0" />
                      </div>
                      {prixVisibles ? (
                        <div>
                          {i === 0 && <Etiq>Prix DH/kg</Etiq>}
                          <Champ className="h-8 text-right" inputMode="decimal" aria-label="Prix DH/kg"
                            value={l.prix} onChange={(e) => maj(l.cle, { prix: e.target.value })} placeholder="CMUP" />
                        </div>
                      ) : (
                        <div className="pb-1.5 text-[11.5px] text-attenue-texte">Prix : par les achats</div>
                      )}
                      <div>
                        {i === 0 && <Etiq>Bobines</Etiq>}
                        <Champ className="h-8 text-right" inputMode="numeric" aria-label="Bobines"
                          value={l.bobines} onChange={(e) => maj(l.cle, { bobines: e.target.value })} />
                      </div>
                      <div>
                        {i === 0 && <Etiq>Motif</Etiq>}
                        <Selecteur className="h-8 w-full" aria-label="Motif de la ligne" value={l.motif}
                          onChange={(e) => maj(l.cle, { motif: e.target.value })}>
                          <option value="">Motif…</option>
                          {MOTIFS.map((m) => <option key={m.code} value={m.code}>{m.libelle}</option>)}
                        </Selecteur>
                      </div>
                      <Bouton variante="discret" taille="icone" aria-label="Retirer la ligne" disabled={lignes.length === 1}
                        onClick={() => setLignes((x) => x.filter((y) => y.cle !== l.cle))}>
                        <X />
                      </Bouton>
                      {(trop || (prixVisibles && l.code_reference && nombre(l.kg) > 0 && l.prix.trim() !== '')) && (
                        <div className="col-span-full text-[11.5px]">
                          {trop ? (
                            <span className="text-danger">Le magasin n’en porte que {fmt.nombre(stock!.quantite_kg, 2)} kg.</span>
                          ) : (
                            <span className="text-attenue-texte">Montant : {fmt.nombre(nombre(l.kg) * nombre(l.prix), 2)} DH</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="flex items-center justify-between p-2">
                  <Bouton variante="contour" taille="sm"
                    onClick={() => setLignes((x) => [...x, ligneVide(x[x.length - 1]?.code_magasin ?? '')])}>
                    <Plus />
                    Ajouter une ligne
                  </Bouton>
                  {incompletes.length > 0 && <span className="text-[11.5px] text-alerte">{incompletes.length} ligne(s) sans magasin ou sans motif</span>}
                </div>
              </div>
            )
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'text-left')}>Référence</th>
                  <th className={cn(th, 'text-left')}>Magasin, lot</th>
                  <th className={cn(th, 'text-right')}>Rendu kg</th>
                  {prixVisibles && <th className={cn(th, 'text-right')}>Prix, montant</th>}
                  <th className={cn(th, 'text-left')}>Motif</th>
                  <th className={cn(th, 'text-left')}>Mouvement</th>
                  {prixVisibles && !brouillon && <th className={cn(th, 'text-right')}>CMUP avant → après</th>}
                </tr>
              </thead>
              <tbody>
                {doc!.lignes.map((l) => (
                  <tr key={l.ligne_numero} className="border-b border-bordure/60 align-top">
                    <td className={td}>
                      <div className="font-medium">{l.code_reference}</div>
                      {l.designation && <div className="text-[11px] text-attenue-texte">{l.designation}</div>}
                    </td>
                    <td className={td}>
                      {l.code_magasin}
                      <div className="font-mono text-[11px] text-attenue-texte">{l.lot_fournisseur ?? 'sans lot'}</div>
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {fmt.nombre(l.quantite_kg, 2)}
                      {l.nb_bobines !== null && <div className="text-[11px] text-attenue-texte">{l.nb_bobines} bobines</div>}
                    </td>
                    {prixVisibles && (
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {fmt.nombre(l.prix_kg_mad ?? 0, 4)}
                        <div className="text-[11px] text-attenue-texte">{fmt.nombre(l.montant_ligne_mad ?? 0, 2)} DH</div>
                      </td>
                    )}
                    <td className={td}>{l.motif_libelle}</td>
                    <td className={cn(td, 'font-mono text-[12px]')}>{l.numero_mouvement ?? '—'}</td>
                    {prixVisibles && !brouillon && (
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {fmt.nombre(l.cmup_avant ?? 0, 4)} → {fmt.nombre(l.cmup_apres ?? 0, 4)}
                        {!!l.ecart_mad && <div className="text-[11px] text-alerte">écart {fmt.nombre(l.ecart_mad, 2)} DH</div>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CarteCorps>
      </Carte>
      {confirmation.element}
    </div>
  )
}

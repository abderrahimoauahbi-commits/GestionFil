/**
 * L'ecran d'une reception d'import — creation et suivi. UN DOCUMENT A PART :
 * il ne s'ouvre pas depuis un dossier, et ses lignes peuvent venir de factures
 * de PLUSIEURS dossiers, en totalite ou en partie.
 *
 * De haut en bas : l'en-tete (date, litige), les lignes recues, puis les
 * lignes de facture qui restent a recevoir — tous dossiers non clos — ou l'on
 * choisit ce que le camion apporte.
 *
 * Enregistrer garde un brouillon ; Valider fait entrer la marchandise en stock
 * a la valeur facture. Validee, la reception est figee.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Plus, Save, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Champ,
  Chargement,
  Etiq,
  Selecteur,
} from '../../composants/ui/base'
import { useConfirmation } from '../../composants/ui/surcouches'
import { useOuvrirVue } from '../../lib/navigation'
import { cn, fmt } from '../../lib/utils'
import { echec, nombre, useRafraichir } from './dialogues'

const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1'
const champ = 'h-7 px-1.5 text-[12.5px]'

/** Meme tolerance que le serveur (domain::importation::TOLERANCE_PCT). */
const TOLERANCE_PCT = 2

interface ARecevoir {
  id_ligne: string
  id_dossier: string
  numero_dossier: string
  /** Absent quand le champ est masque (droits RECEPTIONS du magasin). */
  numero_facture?: string | null
  code_fournisseur: string
  fournisseur_nom: string
  code_reference: string
  designation: string | null
  lot_fournisseur: string | null
  code_couleur: string | null
  libelle_couleur: string | null
  poids_net_kg: number
  quantite_recue_kg: number
  reste_kg: number
  nb_bobines: number
  nb_palettes: number
  numero_bc: string | null
}

interface ReceptionLue {
  reception: {
    id_reception: string
    numero: string
    date_reception: string
    statut: 'BROUILLON' | 'VALIDEE' | 'ANNULEE'
    litige: number
    motif_litige: string | null
    notes: string | null
    cree_par: string | null
    valide_par: string | null
    date_validation: string | null
  }
  lignes: {
    id_ligne: string
    quantite_recue_kg: number
    ecart_kg: number | null
    nb_bobines: number
    nb_palettes: number
    lot_fournisseur: string | null
    code_couleur: string | null
    libelle_couleur: string | null
    code_magasin: string
    numero_dossier: string
    numero_facture?: string | null
    fournisseur_nom: string
    code_reference: string
    poids_net_kg: number
    deja_recu_kg: number
    reste_kg: number
    numero_bc: string | null
  }[]
}

/** Une ligne en cours de saisie. */
interface LigneRecue {
  id_ligne: string
  numero_dossier: string
  numero_facture: string | null
  fournisseur_nom: string
  code_reference: string
  numero_bc: string | null
  poids_net_kg: number
  deja_recu_kg: number
  reste_kg: number
  quantite: string
  bobines: string
  palettes: string
  lot: string
  couleur: string
  libelleCouleur: string
  magasin: string
}

/** « Dossier 46/26 · IHR2026… · HASIRCI · BC-0012 » : d'ou vient la ligne. */
const origine = (l: { numero_dossier: string; numero_facture?: string | null; fournisseur_nom: string; numero_bc: string | null }) =>
  [`Dossier ${l.numero_dossier}`, l.numero_facture, l.fournisseur_nom, l.numero_bc].filter(Boolean).join(' · ')

export function ReceptionImport() {
  const { idReception = 'nouvelle' } = useParams()
  const nouvelle = idReception === 'nouvelle'
  const { peut } = useAuth()
  const ouvrir = useOuvrirVue()
  const naviguer = useNavigate()
  const rafraichir = useRafraichir()
  const confirmation = useConfirmation()

  const qReste = useQuery({
    queryKey: ['import-a-recevoir'],
    queryFn: () => api.get<ARecevoir[]>('/api/import/a-recevoir'),
  })
  const qReception = useQuery({
    queryKey: ['import-reception', idReception],
    queryFn: () => api.get<ReceptionLue>(`/api/import/receptions/${idReception}`),
    enabled: !nouvelle,
  })
  const qMagasins = useQuery({
    queryKey: ['magasins-actifs'],
    queryFn: () =>
      api.get<{ code_magasin: string; nom: string; est_quarantaine?: number; type?: string | null }[]>('/api/magasins?actif=1'),
  })
  // Le magasin PRINCIPAL d'abord : c'est la que le camion se decharge.
  const magasinDefaut =
    (qMagasins.data?.find((m) => m.type === 'PRINCIPAL' && !m.est_quarantaine) ??
      qMagasins.data?.find((m) => !m.est_quarantaine))?.code_magasin ?? ''

  const [entete, setEntete] = useState({ date_reception: '', litige: false, motif_litige: '', notes: '' })
  const [lignes, setLignes] = useState<LigneRecue[]>([])
  const [choix, setChoix] = useState<string[]>([])
  const [modifie, setModifie] = useState(false)
  const [filtre, setFiltre] = useState({ dossier: '', fournisseur: '', texte: '' })

  // Charger la reception existante, ou partir d'une feuille vierge datee du jour.
  useEffect(() => {
    if (nouvelle) {
      setEntete({ date_reception: new Date().toISOString().slice(0, 10), litige: false, motif_litige: '', notes: '' })
      setLignes([])
      setModifie(false)
      return
    }
    const r = qReception.data
    if (!r) return
    setEntete({
      date_reception: r.reception.date_reception.slice(0, 10),
      litige: r.reception.litige === 1,
      motif_litige: r.reception.motif_litige ?? '',
      notes: r.reception.notes ?? '',
    })
    setLignes(
      r.lignes.map((l) => ({
        id_ligne: l.id_ligne,
        numero_dossier: l.numero_dossier,
        numero_facture: l.numero_facture ?? null,
        fournisseur_nom: l.fournisseur_nom,
        code_reference: l.code_reference,
        numero_bc: l.numero_bc,
        poids_net_kg: l.poids_net_kg,
        deja_recu_kg: l.deja_recu_kg,
        reste_kg: l.reste_kg,
        quantite: String(l.quantite_recue_kg),
        bobines: String(l.nb_bobines),
        palettes: String(l.nb_palettes),
        lot: l.lot_fournisseur ?? '',
        couleur: l.code_couleur ?? '',
        libelleCouleur: l.libelle_couleur ?? '',
        magasin: l.code_magasin,
      })),
    )
    setModifie(false)
  }, [nouvelle, qReception.data])

  const statut = nouvelle ? 'BROUILLON' : qReception.data?.reception.statut
  const editable = statut === 'BROUILLON' && peut('RECEPTIONS', 'ECRIRE')
  const peutValider = statut === 'BROUILLON' && peut('RECEPTIONS', 'VALIDER')

  // Ce qu'on peut encore ajouter : ce qui reste, moins ce qui est deja dans la reception.
  const restants = useMemo(
    () => (qReste.data ?? []).filter((r) => !lignes.some((l) => l.id_ligne === r.id_ligne)),
    [qReste.data, lignes],
  )
  const dossiersProposes = useMemo(
    () => [...new Map(restants.map((r) => [r.id_dossier, r.numero_dossier])).entries()],
    [restants],
  )
  const fournisseursProposes = useMemo(
    () => [...new Map(restants.map((r) => [r.code_fournisseur, r.fournisseur_nom])).entries()],
    [restants],
  )
  const disponibles = useMemo(() => {
    const t = filtre.texte.trim().toLowerCase()
    return restants.filter(
      (r) =>
        (!filtre.dossier || r.id_dossier === filtre.dossier) &&
        (!filtre.fournisseur || r.code_fournisseur === filtre.fournisseur) &&
        (!t ||
          [r.code_reference, r.designation, r.numero_facture, r.lot_fournisseur, r.code_couleur, r.libelle_couleur, r.numero_bc]
            .some((x) => (x ?? '').toLowerCase().includes(t))),
    )
  }, [restants, filtre])

  const ajouter = (ids: string[]) => {
    const nouvelles = (qReste.data ?? [])
      .filter((r) => ids.includes(r.id_ligne) && !lignes.some((l) => l.id_ligne === r.id_ligne))
      .map((r): LigneRecue => {
        // Tout le reste propose : le cas ordinaire est « tout est arrive ».
        // Les compteurs ne sont repris que si la ligne arrive entiere.
        const entiere = r.quantite_recue_kg === 0
        return {
          id_ligne: r.id_ligne,
          numero_dossier: r.numero_dossier,
          numero_facture: r.numero_facture ?? null,
          fournisseur_nom: r.fournisseur_nom,
          code_reference: r.code_reference,
          numero_bc: r.numero_bc,
          poids_net_kg: r.poids_net_kg,
          deja_recu_kg: r.quantite_recue_kg,
          reste_kg: r.reste_kg,
          quantite: String(r.reste_kg),
          bobines: entiere ? String(r.nb_bobines) : '',
          palettes: entiere ? String(r.nb_palettes) : '',
          lot: r.lot_fournisseur ?? '',
          couleur: r.code_couleur ?? '',
          libelleCouleur: r.libelle_couleur ?? '',
          magasin: magasinDefaut,
        }
      })
    setLignes((ls) => [...ls, ...nouvelles])
    setChoix([])
    setModifie(true)
  }
  const majLigne = (id: string, patch: Partial<LigneRecue>) => {
    setLignes((ls) => ls.map((l) => (l.id_ligne === id ? { ...l, ...patch } : l)))
    setModifie(true)
  }

  const complete =
    !!entete.date_reception &&
    lignes.length > 0 &&
    lignes.every((l) => nombre(l.quantite) > 0 && l.magasin) &&
    (!entete.litige || entete.motif_litige.trim())

  const corps = () => ({
    date_reception: entete.date_reception,
    litige: entete.litige ? 1 : 0,
    motif_litige: entete.litige ? entete.motif_litige.trim() : null,
    notes: entete.notes || null,
    lignes: lignes.map((l) => ({
      id_ligne: l.id_ligne,
      quantite_recue_kg: nombre(l.quantite),
      nb_bobines: l.bobines ? nombre(l.bobines) : 0,
      nb_palettes: l.palettes ? nombre(l.palettes) : 0,
      lot_fournisseur: l.lot,
      code_couleur: l.couleur,
      libelle_couleur: l.libelleCouleur,
      code_magasin: l.magasin,
    })),
  })

  /** Enregistre le brouillon ; renvoie son identifiant. */
  const sauver = async () => {
    if (nouvelle) {
      return (await api.post<{ id_reception: string }>('/api/import/receptions', corps())).id_reception
    }
    if (modifie) await api.put(`/api/import/receptions/${idReception}`, corps())
    return idReception
  }

  const enregistrer = useMutation({
    mutationFn: sauver,
    onSuccess: (id) => {
      toast.success('Réception enregistrée en brouillon')
      rafraichir()
      setModifie(false)
      if (nouvelle) naviguer(`/receptions-import/${id}`, { replace: true })
      else void qReception.refetch()
    },
    onError: echec,
  })
  const valider = useMutation({
    mutationFn: async () => {
      const id = await sauver()
      return { id, r: await api.post<{ numero: string; quantite_kg: number }>(`/api/import/receptions/${id}/valider`) }
    },
    onSuccess: ({ id, r }) => {
      toast.success(`${r.numero} validée — ${fmt.nombre(r.quantite_kg, 2)} kg entrés en stock`)
      rafraichir()
      setModifie(false)
      if (nouvelle) naviguer(`/receptions-import/${id}`, { replace: true })
      else void qReception.refetch()
    },
    onError: (e) => {
      echec(e)
      rafraichir()
    },
  })
  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/import/receptions/${idReception}`),
    onSuccess: () => {
      toast.success('Réception supprimée')
      rafraichir()
      ouvrir('/receptions-import')
    },
    onError: echec,
  })

  if (!nouvelle && qReception.isLoading) return <Chargement texte="Lecture de la réception…" />
  if (!nouvelle && !qReception.data) return <Alerte ton="alerte">Réception introuvable.</Alerte>

  const r = qReception.data?.reception
  const dossiersRecus = [...new Set(lignes.map((l) => l.numero_dossier))]
  const total = (f: (l: LigneRecue) => number) => lignes.reduce((t, l) => t + f(l), 0)
  const ecartDe = (l: LigneRecue) => nombre(l.quantite) - l.reste_kg
  const maj = (k: 'date_reception' | 'motif_litige' | 'notes') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setEntete((x) => ({ ...x, [k]: e.target.value }))
    setModifie(true)
  }
  const basculer = (id: string) => setChoix((c) => (c.includes(id) ? c.filter((y) => y !== id) : [...c, id]))

  return (
    <div className="space-y-3 pb-4">
      <EnTetePage
        titre={nouvelle ? 'Nouvelle réception import' : `Réception ${r!.numero}`}
        description={
          dossiersRecus.length === 0
            ? 'Marchandise importée : choisissez les lignes de facture que le camion apporte.'
            : `${dossiersRecus.length > 1 ? 'Dossiers' : 'Dossier'} ${dossiersRecus.join(', ')}`
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir('/receptions-import')}>
              <ArrowLeft />
              Toutes les réceptions
            </Bouton>
            {editable && (
              <Bouton variante="contour" disabled={!complete || (!nouvelle && !modifie)} chargement={enregistrer.isPending}
                onClick={() => enregistrer.mutate()}>
                <Save />
                Enregistrer
              </Bouton>
            )}
            {peutValider && (
              <Bouton disabled={!complete} chargement={valider.isPending} onClick={() => valider.mutate()}>
                <PackageCheck />
                Valider — entrée en stock
              </Bouton>
            )}
          </>
        }
      />

      {statut === 'VALIDEE' && (
        <Alerte ton="succes">
          Validée{r?.valide_par ? ` par ${r.valide_par}` : ''}{r?.date_validation ? ` le ${fmt.date(r.date_validation)}` : ''} :
          la marchandise est entrée en stock à la valeur facture. La réception ne se modifie plus.
        </Alerte>
      )}
      {statut === 'BROUILLON' && !nouvelle && editable && !peutValider && (
        <Alerte ton="info">
          Brouillon enregistré. La validation — l'entrée en stock — revient à la direction ou à l'administration.
        </Alerte>
      )}

      {/* ================= En-tete ============================================ */}
      <Carte>
        <CarteEntete>
          <CarteTitre>En-tête de la réception</CarteTitre>
          {statut && <Badge ton={statut === 'VALIDEE' ? 'succes' : 'alerte'}>{statut === 'VALIDEE' ? 'validée' : 'brouillon'}</Badge>}
        </CarteEntete>
        <CarteCorps>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Etiq obligatoire>Date de réception</Etiq>
              <Champ type="date" value={entete.date_reception} onChange={maj('date_reception')} disabled={!editable} />
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={entete.litige} disabled={!editable}
                  onChange={(e) => { setEntete((x) => ({ ...x, litige: e.target.checked })); setModifie(true) }} />
                Litige (écart, casse, manquant)
              </label>
            </div>
            <div className="col-span-2">
              <Etiq obligatoire={entete.litige}>Motif du litige</Etiq>
              <Champ value={entete.motif_litige} onChange={maj('motif_litige')} disabled={!editable || !entete.litige} />
            </div>
            {/* Les dossiers ne se choisissent pas : ils suivent les lignes. */}
            <div className="col-span-2 md:col-span-1">
              <Etiq>{dossiersRecus.length > 1 ? 'Dossiers' : 'Dossier'}</Etiq>
              <div className="flex min-h-9 flex-wrap items-center gap-1" data-dossiers>
                {dossiersRecus.length === 0 ? (
                  <span className="text-[12.5px] text-attenue-texte">selon les lignes choisies</span>
                ) : (
                  dossiersRecus.map((n) => <Badge key={n} ton="info">{n}</Badge>)
                )}
              </div>
            </div>
            <div className="col-span-2 md:col-span-3">
              <Etiq>Notes</Etiq>
              <Champ value={entete.notes} onChange={maj('notes')} disabled={!editable} />
            </div>
          </div>
        </CarteCorps>
      </Carte>

      {/* ================= Lignes recues ====================================== */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Lignes reçues</CarteTitre>
          <span className="text-[11.5px] text-attenue-texte">{lignes.length} ligne(s)</span>
        </CarteEntete>
        <CarteCorps className="p-0">
          {lignes.length === 0 ? (
            <p className="p-3 text-[12.5px] text-attenue-texte">
              Aucune ligne : choisissez ci-dessous les lignes de facture que le camion apporte.
            </p>
          ) : (
            <div className="defilement-x">
              <table className="w-full min-w-[82rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-bordure">
                    <th className={cn(th, 'text-left')}>Référence · origine</th>
                    <th className={cn(th, 'w-24 text-right')}>Facturé</th>
                    <th className={cn(th, 'w-24 text-right')}>Déjà reçu</th>
                    <th className={cn(th, 'w-24 text-right')}>Reste</th>
                    <th className={cn(th, 'w-28 text-right')}>Reçu (kg)</th>
                    <th className={cn(th, 'w-20 text-right')}>Écart</th>
                    <th className={cn(th, 'w-20 text-right')}>Bobines</th>
                    <th className={cn(th, 'w-20 text-right')}>Palettes</th>
                    <th className={cn(th, 'w-24 text-left')}>Lot</th>
                    <th className={cn(th, 'w-20 text-left')}>Code couleur</th>
                    <th className={cn(th, 'w-24 text-left')}>Libellé couleur</th>
                    <th className={cn(th, 'w-36 text-left')}>Magasin</th>
                    {editable && <th className={cn(th, 'w-8')} />}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const ecart = ecartDe(l)
                    const horsTolerance = nombre(l.quantite) > l.reste_kg * (1 + TOLERANCE_PCT / 100) + 0.001
                    return (
                      <tr key={l.id_ligne} className="border-b border-bordure/60 align-top">
                        <td className={cn(td, 'pt-1.5')}>
                          <div className="font-medium">{l.code_reference}</div>
                          <div className="text-[11px] text-attenue-texte">{origine(l)}</div>
                        </td>
                        <td className={cn(td, 'pt-1.5 text-right tabular-nums')}>{fmt.nombre(l.poids_net_kg, 2)}</td>
                        <td className={cn(td, 'pt-1.5 text-right tabular-nums text-attenue-texte')}>{fmt.nombre(l.deja_recu_kg, 2)}</td>
                        <td className={cn(td, 'pt-1.5 text-right tabular-nums')}>{fmt.nombre(l.reste_kg, 2)}</td>
                        <td className={td}>
                          <Champ className={cn(champ, 'text-right', horsTolerance && 'border-danger')} inputMode="decimal"
                            value={l.quantite} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { quantite: e.target.value })} />
                          {horsTolerance && <div className="text-[10.5px] text-danger">au-delà du reste + {TOLERANCE_PCT} %</div>}
                        </td>
                        <td className={cn(td, 'pt-1.5 text-right tabular-nums', Math.abs(ecart) > 0.5 && 'text-alerte')}>
                          {statut === 'VALIDEE' ? '—' : fmt.nombre(ecart, 2)}
                        </td>
                        <td className={td}><Champ className={cn(champ, 'text-right')} inputMode="numeric" value={l.bobines} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { bobines: e.target.value })} /></td>
                        <td className={td}><Champ className={cn(champ, 'text-right')} inputMode="numeric" value={l.palettes} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { palettes: e.target.value })} /></td>
                        <td className={td}><Champ className={champ} value={l.lot} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { lot: e.target.value })} /></td>
                        <td className={td}><Champ className={champ} value={l.couleur} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { couleur: e.target.value })} /></td>
                        <td className={td}><Champ className={champ} value={l.libelleCouleur} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { libelleCouleur: e.target.value })} /></td>
                        <td className={td}>
                          <Selecteur className={champ} value={l.magasin} disabled={!editable} onChange={(e) => majLigne(l.id_ligne, { magasin: e.target.value })}>
                            <option value="">Choisir…</option>
                            {(qMagasins.data ?? []).map((m) => (
                              <option key={m.code_magasin} value={m.code_magasin}>{m.nom}</option>
                            ))}
                          </Selecteur>
                        </td>
                        {editable && (
                          <td className={cn(td, 'pt-1.5')}>
                            <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10" aria-label="Retirer la ligne"
                              onClick={() => { setLignes((ls) => ls.filter((x) => x.id_ligne !== l.id_ligne)); setModifie(true) }}>
                              <Trash2 />
                            </Bouton>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-attenue/40 font-semibold">
                    <td className={td}>Total de la réception</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(total((l) => l.poids_net_kg), 2)}</td>
                    <td className={td} />
                    <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(total((l) => l.reste_kg), 2)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(total((l) => nombre(l.quantite)), 2)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{statut === 'VALIDEE' ? '—' : fmt.nombre(total(ecartDe), 2)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(total((l) => nombre(l.bobines || 0)))}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(total((l) => nombre(l.palettes || 0)))}</td>
                    <td className={td} colSpan={editable ? 5 : 4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CarteCorps>
      </Carte>

      {/* ================= Choix des lignes de facture ======================== */}
      {editable && (
        <Carte>
          <CarteEntete>
            <CarteTitre>Lignes de facture à recevoir</CarteTitre>
            <div className="flex gap-2">
              <Bouton taille="sm" variante="contour" disabled={disponibles.length === 0}
                onClick={() => ajouter(disponibles.map((x) => x.id_ligne))}>
                Tout ajouter
              </Bouton>
              <Bouton taille="sm" disabled={choix.length === 0} onClick={() => ajouter(choix)}>
                <Plus />
                Ajouter la sélection ({choix.length})
              </Bouton>
            </div>
          </CarteEntete>
          <CarteCorps className="p-0">
            {restants.length > 0 && (
              <div className="grid grid-cols-1 gap-2 border-b border-bordure p-2 sm:grid-cols-3">
                <Selecteur className={champ} aria-label="Dossier" value={filtre.dossier}
                  onChange={(e) => { setFiltre((f) => ({ ...f, dossier: e.target.value })); setChoix([]) }}>
                  <option value="">Tous les dossiers</option>
                  {dossiersProposes.map(([id, numero]) => <option key={id} value={id}>Dossier {numero}</option>)}
                </Selecteur>
                <Selecteur className={champ} aria-label="Fournisseur" value={filtre.fournisseur}
                  onChange={(e) => { setFiltre((f) => ({ ...f, fournisseur: e.target.value })); setChoix([]) }}>
                  <option value="">Tous les fournisseurs</option>
                  {fournisseursProposes.map(([code, nom]) => <option key={code} value={code}>{nom}</option>)}
                </Selecteur>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-attenue-texte" />
                  <Champ className={cn(champ, 'pl-7')} placeholder="Référence, facture, lot, couleur…" value={filtre.texte}
                    onChange={(e) => { setFiltre((f) => ({ ...f, texte: e.target.value })); setChoix([]) }} />
                </div>
              </div>
            )}
            {qReste.isLoading ? (
              <div className="p-3"><Chargement texte="Lecture de ce qui reste à recevoir…" /></div>
            ) : disponibles.length === 0 ? (
              <p className="p-3 text-[12.5px] text-attenue-texte">
                {restants.length > 0
                  ? 'Aucune ligne ne répond à ces filtres.'
                  : lignes.length > 0
                    ? 'Toutes les lignes restantes sont dans cette réception.'
                    : 'Rien à recevoir : toutes les factures des dossiers en cours sont reçues ou soldées.'}
              </p>
            ) : (
              <div className="defilement-x">
                <table className="w-full min-w-[56rem] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-bordure">
                      <th className={cn(th, 'w-8')}>
                        <input type="checkbox" aria-label="Tout sélectionner"
                          checked={choix.length > 0 && choix.length === disponibles.length}
                          onChange={(e) => setChoix(e.target.checked ? disponibles.map((x) => x.id_ligne) : [])} />
                      </th>
                      <th className={cn(th, 'text-left')}>Dossier</th>
                      <th className={cn(th, 'text-left')}>Facture</th>
                      <th className={cn(th, 'text-left')}>Référence</th>
                      <th className={cn(th, 'text-left')}>Lot · couleur</th>
                      <th className={cn(th, 'text-left')}>Bon de commande</th>
                      <th className={cn(th, 'text-right')}>Facturé (kg)</th>
                      <th className={cn(th, 'text-right')}>Reste (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disponibles.map((x) => {
                      const tolere = x.reste_kg <= (x.poids_net_kg * TOLERANCE_PCT) / 100 + 0.001
                      return (
                        <tr key={x.id_ligne} className="cursor-pointer border-b border-bordure/60 hover:bg-attenue/30"
                          onClick={() => basculer(x.id_ligne)}>
                          <td className={td}>
                            <input type="checkbox" checked={choix.includes(x.id_ligne)} readOnly />
                          </td>
                          <td className={cn(td, 'font-medium')}>{x.numero_dossier}</td>
                          <td className={td}>
                            {x.numero_facture ?? <span className="text-attenue-texte">—</span>}
                            <div className="text-[11px] text-attenue-texte">{x.fournisseur_nom}</div>
                          </td>
                          <td className={cn(td, 'font-medium')}>{x.code_reference}</td>
                          <td className={cn(td, 'text-attenue-texte')}>{[x.lot_fournisseur, x.code_couleur, x.libelle_couleur].filter(Boolean).join(' · ') || '—'}</td>
                          <td className={td}>{x.numero_bc ?? <span className="text-attenue-texte">libre</span>}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(x.poids_net_kg, 2)}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>
                            {fmt.nombre(x.reste_kg, 2)}
                            {tolere && <div className="text-[10.5px] text-attenue-texte">dans la tolérance</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CarteCorps>
        </Carte>
      )}

      {editable && !nouvelle && (
        <div className="flex justify-start">
          <Bouton variante="contour" className="text-danger"
            onClick={() =>
              confirmation.demander({
                titre: `Supprimer la réception ${r!.numero} ?`,
                destructif: true,
                libelleConfirmer: 'Supprimer',
                description: 'Rien n\'est entré en stock : le brouillon disparaît simplement.',
                action: () => supprimer.mutate(),
              })
            }>
            <Trash2 />
            Supprimer le brouillon
          </Bouton>
        </div>
      )}
    </div>
  )
}

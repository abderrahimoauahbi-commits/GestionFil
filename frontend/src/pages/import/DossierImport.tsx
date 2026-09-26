/**
 * L'ecran d'un dossier d'importation — une seule page, de haut en bas :
 *
 *   1. les informations du dossier ;
 *   2. ses frais (TVA, douane, fret, transitaire…), saisis dans le tableau ;
 *   3. les factures qui le composent — chacune s'ouvre sur son ecran.
 *
 * Les receptions n'y sont pas : c'est un document A PART, avec sa propre
 * liste (/receptions-import), qui peut prendre des lignes de plusieurs
 * dossiers. Le dossier n'en voit que l'effet — le recu de chaque facture.
 *
 * CLOTURE, TOUT EST EN LECTURE SEULE : un dossier clos a servi a corriger le
 * CUMP, le modifier ferait mentir le stock. Le serveur le refuserait de toute
 * facon ; l'ecran n'offre simplement plus les gestes.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { ChevronRight, Lock, Plus, Save, Target, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useDroits } from '../../auth/AuthContext'
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
import { Avancement, PastilleStatut } from './DossiersImport'
import { CiblesDialogue, ClotureDialogue, echec, nombre, Tuile, useRafraichir } from './dialogues'
import { PiecesDossier } from './PiecesDossier'
import { EngagementsDossier } from './EngagementsDossier'
import {
  LIBELLE_RECEPTION,
  METHODE_REPARTITION,
  TON_RECEPTION,
  type DossierComplet,
  type Frais,
  type ParametreFrais,
} from './types'

const MODULE = 'IMPORT'
const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-2 py-1.5'

export function DossierImport() {
  const { id = '' } = useParams()
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const [cloture, setCloture] = useState(false)

  const q = useQuery({
    queryKey: ['import-dossier', id],
    queryFn: () => api.get<DossierComplet>(`/api/import/dossiers/${id}`),
    enabled: !!id,
  })

  if (q.isLoading) return <Chargement texte="Lecture du dossier…" />
  if (!q.data) return <Alerte ton="alerte">Dossier introuvable.</Alerte>

  const d = q.data
  const { dossier } = d
  const clos = dossier.statut === 'CLOTURE'
  const ecrire = droits.peutEcrire && !clos

  return (
    <div className="space-y-3">
      <EnTetePage
        titre={`Dossier ${dossier.numero}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <PastilleStatut statut={dossier.statut} />
            {dossier.numero_bl && <span>BL {dossier.numero_bl}</span>}
            {dossier.conteneurs && <span>{dossier.conteneurs}</span>}
          </span>
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir('/import')}>
              Tous les dossiers
            </Bouton>
            {droits.peutValider && dossier.statut === 'EN_COURS' && (
              <Bouton onClick={() => setCloture(true)}>
                <Lock />
                Clôturer
              </Bouton>
            )}
          </>
        }
      />

      {clos && (
        <Alerte ton="succes">
          Clôturé le {fmt.date(dossier.date_cloture)}
          {dossier.cloture_par && ` par ${dossier.cloture_par}`} : les frais ont rejoint le CUMP, le
          dossier est en lecture seule.
        </Alerte>
      )}

      <Synthese d={d} />
      <Informations d={d} ecrire={ecrire} />
      <EngagementsDossier d={d} ecrire={ecrire} />
      <FraisDossier d={d} ecrire={ecrire} />
      <FacturesDossier d={d} ecrire={ecrire} />
      <PiecesDossier d={d} ecrire={ecrire} />
      {d.ajustements.length > 0 && <JournalCloture d={d} />}

      <ClotureDialogue idDossier={id} ouvert={cloture} surFermer={() => setCloture(false)} />
    </div>
  )
}

// ============================================================================
// Synthese
// ============================================================================

function Synthese({ d }: { d: DossierComplet }) {
  const valeur = d.lignes.reduce((t, l) => t + l.valeur_achat_dhs, 0)
  const inclus = d.frais.filter((x) => x.inclus_dans_cout === 1).reduce((t, x) => t + x.montant_dhs, 0)
  const horsCout = d.frais.filter((x) => x.inclus_dans_cout === 0).reduce((t, x) => t + x.montant_dhs, 0)
  const erp = d.lignes.filter((l) => l.type_ligne === 'ERP')
  const poids = erp.reduce((t, l) => t + (l.poids_net_kg ?? 0), 0)
  const recu = erp.reduce((t, l) => t + l.quantite_recue_kg, 0)
  const coefVisible = d.lignes.some((l) => l.coef_frais_pct !== undefined)
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tuile titre="Valeur d'achat" valeur={`${fmt.nombre(valeur, 2)} DH`} detail={`${d.factures.length} facture(s)`} />
      <Tuile
        titre="Frais HT inclus"
        valeur={`${fmt.nombre(inclus, 2)} DH`}
        detail={coefVisible && valeur > 0 ? `${fmt.nombre((inclus * 100) / valeur, 2)} % de la valeur` : undefined}
      />
      <Tuile titre="Hors coût (TVA)" valeur={`${fmt.nombre(horsCout, 2)} DH`} detail="récupérable, jamais réparti" />
      <div className="rounded-[var(--radius)] border border-bordure bg-surface px-3 py-2">
        <div className="text-[10.5px] uppercase tracking-wider text-attenue-texte">Réception</div>
        <div className="text-[15px] font-semibold tabular-nums">
          {fmt.nombre(recu, 0)} / {fmt.nombre(poids, 0)} kg
        </div>
        <Avancement recu={recu} total={poids} />
      </div>
    </div>
  )
}

// ============================================================================
// 1. Informations du dossier
// ============================================================================

function Informations({ d, ecrire }: { d: DossierComplet; ecrire: boolean }) {
  const rafraichir = useRafraichir(d.dossier.id_dossier)
  const { dossier } = d
  const initial = () => ({
    numero: dossier.numero,
    numero_bl: dossier.numero_bl ?? '',
    conteneurs: dossier.conteneurs ?? '',
    taux_change: String(dossier.taux_change),
    date_arrivee: dossier.date_arrivee?.slice(0, 10) ?? '',
    notes: dossier.notes ?? '',
  })
  const [f, setF] = useState(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(initial()), [dossier])
  const modifie = JSON.stringify(f) !== JSON.stringify(initial())

  const enregistrer = useMutation({
    mutationFn: () =>
      api.patch(`/api/import/dossiers/${dossier.id_dossier}`, {
        ...f,
        taux_change: nombre(f.taux_change),
        date_arrivee: f.date_arrivee || null,
      }),
    onSuccess: () => {
      toast.success('Dossier enregistré')
      rafraichir()
    },
    onError: echec,
  })
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }))

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Informations du dossier</CarteTitre>
        {ecrire && (
          <Bouton taille="sm" disabled={!modifie} chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            <Save />
            Enregistrer
          </Bouton>
        )}
      </CarteEntete>
      <CarteCorps>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div>
            <Etiq>Numéro</Etiq>
            <Champ value={f.numero} onChange={maj('numero')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq>N° BL</Etiq>
            <Champ value={f.numero_bl} onChange={maj('numero_bl')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq>Conteneur(s)</Etiq>
            <Champ value={f.conteneurs} onChange={maj('conteneurs')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq>Devise globale</Etiq>
            <Champ value={dossier.code_devise} disabled />
          </div>
          <div>
            <Etiq>Taux de change</Etiq>
            <Champ inputMode="decimal" value={f.taux_change} onChange={maj('taux_change')} disabled={!ecrire} />
          </div>
          <div>
            <Etiq>Date d'arrivée</Etiq>
            <Champ type="date" value={f.date_arrivee} onChange={maj('date_arrivee')} disabled={!ecrire} />
          </div>
          <div className="col-span-2 md:col-span-3 xl:col-span-6">
            <Etiq>Notes</Etiq>
            <Champ value={f.notes} onChange={maj('notes')} disabled={!ecrire} />
          </div>
        </div>
      </CarteCorps>
    </Carte>
  )
}

// ============================================================================
// 2. Frais du dossier — saisis dans le tableau
// ============================================================================

function FraisDossier({ d, ecrire }: { d: DossierComplet; ecrire: boolean }) {
  const idDossier = d.dossier.id_dossier
  const rafraichir = useRafraichir(idDossier)
  const confirmation = useConfirmation()
  const [cible, setCible] = useState<Frais | null>(null)
  const vide = { id_frais: '', libelle: '', numero_piece: '', code_devise: 'MAD', cours_change: '1', montant_devise: '' }
  const [n, setN] = useState(vide)

  const qParam = useQuery({
    queryKey: ['parametres-frais'],
    queryFn: () => api.get<ParametreFrais[]>('/api/parametres-frais'),
    enabled: ecrire,
  })
  const qDevises = useQuery({
    queryKey: ['devises'],
    queryFn: () => api.get<{ code_devise: string }[]>('/api/devises'),
    enabled: ecrire,
  })
  // La liste deroulante groupee par categorie, comme les colonnes du classeur.
  const groupes = useMemo(() => {
    const m = new Map<string, ParametreFrais[]>()
    for (const p of qParam.data ?? []) if (p.actif) m.set(p.categorie, [...(m.get(p.categorie) ?? []), p])
    return [...m.entries()]
  }, [qParam.data])
  const typeChoisi = qParam.data?.find((p) => p.id_frais === n.id_frais)
  const montantDh = nombre(n.montant_devise) * (n.code_devise === 'MAD' ? 1 : nombre(n.cours_change))

  const ajouter = useMutation({
    mutationFn: () =>
      api.post(`/api/import/dossiers/${idDossier}/frais`, {
        id_frais: n.id_frais,
        libelle: n.libelle || null,
        numero_piece: n.numero_piece || null,
        montant_devise: nombre(n.montant_devise),
        code_devise: n.code_devise,
        cours_change: n.code_devise === 'MAD' ? 1 : nombre(n.cours_change),
      }),
    onSuccess: () => {
      toast.success(
        !typeChoisi?.inclus_dans_cout
          ? 'Frais ajouté — hors coût de revient'
          : typeChoisi.commun
            ? `Frais ajouté — réparti ${METHODE_REPARTITION[typeChoisi.methode_repartition].toLowerCase()}`
            : 'Frais ajouté — désignez les lignes qu’il concerne (icône cible)',
      )
      setN(vide)
      rafraichir()
    },
    onError: echec,
  })
  const supprimer = useMutation({
    mutationFn: (idFrais: string) => api.delete(`/api/import/frais/${idFrais}`),
    onSuccess: () => {
      toast.success('Frais supprimé — répartition recalculée')
      rafraichir()
    },
    onError: echec,
  })

  const inclus = d.frais.filter((f) => f.inclus_dans_cout === 1).reduce((t, f) => t + f.montant_dhs, 0)
  const hors = d.frais.filter((f) => f.inclus_dans_cout === 0).reduce((t, f) => t + f.montant_dhs, 0)
  const complet = n.id_frais && nombre(n.montant_devise) > 0 && (n.code_devise === 'MAD' || nombre(n.cours_change) > 0)
  const maj = (k: keyof typeof n) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setN((x) => ({ ...x, [k]: e.target.value, ...(k === 'code_devise' && e.target.value === 'MAD' ? { cours_change: '1' } : {}) }))

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Frais du dossier</CarteTitre>
        <span className="text-[11.5px] text-attenue-texte">
          Chaque type de frais dit sa pièce justificative et sa méthode de répartition.
        </span>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div className="defilement-x">
          <table className="w-full min-w-[60rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-bordure">
                <th className={cn(th, 'w-56 text-left')}>Type de frais</th>
                <th className={cn(th, 'text-left')}>Précision</th>
                <th className={cn(th, 'w-28 text-left')}>N° pièce</th>
                <th className={cn(th, 'w-24 text-left')}>Devise</th>
                <th className={cn(th, 'w-24 text-right')}>Cours</th>
                <th className={cn(th, 'w-32 text-right')}>Montant</th>
                <th className={cn(th, 'w-32 text-right')}>Montant DH</th>
                <th className={cn(th, 'w-48 text-left')}>Coût / répartition</th>
                {ecrire && <th className={cn(th, 'w-24')} />}
              </tr>
            </thead>
            <tbody>
              {d.frais.map((f) => (
                <tr key={f.id_ligne_frais} className={cn('border-b border-bordure/60', !f.inclus_dans_cout && 'text-attenue-texte')}>
                  <td className={cn(td, 'font-medium')}>{f.frais_libelle}</td>
                  <td className={td}>{f.libelle ?? '—'}</td>
                  <td className={cn(td, 'tabular-nums')}>{f.numero_piece ?? '—'}</td>
                  <td className={td}>{f.code_devise}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{f.code_devise === 'MAD' ? '—' : fmt.nombre(f.cours_change, 4)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(f.montant_devise, 2)}</td>
                  <td className={cn(td, 'text-right font-medium tabular-nums')}>{fmt.nombre(f.montant_dhs, 2)}</td>
                  <td className={td}>
                    {f.inclus_dans_cout ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Badge ton="succes">inclus</Badge>
                        <span className="whitespace-nowrap text-[11.5px]">{f.cibles.length === 0 ? 'tout le dossier' : `${f.cibles.length} ligne(s)`}</span>
                      </span>
                    ) : (
                      <Badge ton="neutre">hors coût</Badge>
                    )}
                  </td>
                  {ecrire && (
                    <td className={td}>
                      <div className="flex justify-end gap-0.5">
                        {f.inclus_dans_cout === 1 && (
                          <Bouton taille="icone-xs" variante="discret" title="Choisir les lignes qui portent ce frais"
                            aria-label="Cibler des lignes" onClick={() => setCible(f)}>
                            <Target />
                          </Bouton>
                        )}
                        <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10"
                          aria-label="Supprimer le frais"
                          onClick={() =>
                            confirmation.demander({
                              titre: `Supprimer « ${f.frais_libelle} » ?`,
                              destructif: true,
                              libelleConfirmer: 'Supprimer',
                              description: 'La répartition du dossier sera recalculée.',
                              action: () => supprimer.mutate(f.id_ligne_frais),
                            })
                          }>
                          <Trash2 />
                        </Bouton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}

              {/* LA LIGNE DE SAISIE, a la suite des frais deja saisis : on
                  remplit comme une ligne du classeur, et « Ajouter ». */}
              {ecrire && (
                <tr className="border-b border-bordure/60 bg-attenue/25">
                  <td className={td}>
                    <Selecteur className="h-7" value={n.id_frais} onChange={maj('id_frais')}>
                      <option value="">Nouveau frais…</option>
                      {groupes.map(([cat, liste]) => (
                        <optgroup key={cat} label={cat}>
                          {liste.map((p) => (
                            <option key={p.id_frais} value={p.id_frais}>
                              {p.libelle}{p.inclus_dans_cout ? '' : ' — hors coût'}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Selecteur>
                    {/* La piece a avoir en main pour ce frais. */}
                    {typeChoisi?.piece_justificative && (
                      <div className="mt-0.5 text-[11px] text-attenue-texte">{typeChoisi.piece_justificative}</div>
                    )}
                  </td>
                  <td className={td}><Champ className="h-7" value={n.libelle} onChange={maj('libelle')} placeholder="ESMATRANS…" /></td>
                  <td className={td}><Champ className="h-7" value={n.numero_piece} onChange={maj('numero_piece')} placeholder="F2610861" /></td>
                  <td className={td}>
                    <Selecteur className="h-7 pl-2 pr-6" value={n.code_devise} onChange={maj('code_devise')}>
                      {(qDevises.data ?? [{ code_devise: 'MAD' }]).map((x) => (
                        <option key={x.code_devise}>{x.code_devise}</option>
                      ))}
                    </Selecteur>
                  </td>
                  <td className={td}>
                    <Champ className="h-7 text-right" inputMode="decimal" value={n.cours_change}
                      onChange={maj('cours_change')} disabled={n.code_devise === 'MAD'} />
                  </td>
                  <td className={td}>
                    <Champ className="h-7 text-right" inputMode="decimal" value={n.montant_devise}
                      onChange={maj('montant_devise')} placeholder="0,00"
                      onKeyDown={(e) => e.key === 'Enter' && complet && ajouter.mutate()} />
                  </td>
                  <td className={cn(td, 'text-right tabular-nums text-attenue-texte')}>
                    {montantDh > 0 ? fmt.nombre(montantDh, 2) : '—'}
                  </td>
                  <td className={cn(td, 'text-[11.5px]')}>
                    {typeChoisi &&
                      (typeChoisi.inclus_dans_cout ? (
                        <>
                          {METHODE_REPARTITION[typeChoisi.methode_repartition].toLowerCase()} ·{' '}
                          {typeChoisi.commun ? 'tout le dossier' : 'lignes à désigner'}
                        </>
                      ) : (
                        <span className="text-alerte">
                          hors coût{typeChoisi.recuperable ? ' — récupérable' : ''}
                        </span>
                      ))}
                  </td>
                  <td className={td}>
                    <Bouton taille="sm" disabled={!complet} chargement={ajouter.isPending} onClick={() => ajouter.mutate()}>
                      <Plus />
                      Ajouter
                    </Bouton>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-attenue/40 font-semibold">
                <td className={td} colSpan={6}>Frais inclus dans le coût</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(inclus, 2)}</td>
                <td className={cn(td, 'text-[11.5px] font-normal text-attenue-texte')} colSpan={ecrire ? 2 : 1}>
                  + {fmt.nombre(hors, 2)} DH hors coût (TVA)
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CarteCorps>
      <CiblesDialogue idDossier={idDossier} frais={cible} lignes={d.lignes} surFermer={() => setCible(null)} />
    </Carte>
  )
}

// ============================================================================
// 3. Factures du dossier
// ============================================================================

function FacturesDossier({ d, ecrire }: { d: DossierComplet; ecrire: boolean }) {
  const ouvrir = useOuvrirVue()
  const idDossier = d.dossier.id_dossier
  const parFacture = (id: string) => d.lignes.filter((l) => l.id_facture === id)
  const coutVisible = d.lignes.some((l) => l.frais_alloues_dhs !== undefined)
  const somme = (f: (l: DossierComplet['lignes'][number]) => number) => d.lignes.reduce((t, l) => t + f(l), 0)

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Factures du dossier</CarteTitre>
        {ecrire && (
          <Bouton taille="sm" onClick={() => ouvrir(`/import/${idDossier}/factures/nouvelle`)}>
            <Plus />
            Ajouter une facture
          </Bouton>
        )}
      </CarteEntete>
      <CarteCorps className="p-0">
        {d.factures.length === 0 ? (
          <p className="p-3 text-[12.5px] text-attenue-texte">
            Aucune facture. Un dossier peut regrouper les factures de plusieurs fournisseurs.
          </p>
        ) : (
          <div className="defilement-x">
            <table className="w-full min-w-[62rem] text-[12.5px]">
              <thead>
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'text-left')}>Fournisseur</th>
                  <th className={cn(th, 'text-left')}>N° facture</th>
                  <th className={cn(th, 'text-left')}>Date</th>
                  <th className={cn(th, 'text-right')}>Lignes</th>
                  <th className={cn(th, 'text-right')}>Montant devise</th>
                  <th className={cn(th, 'text-right')}>Valeur DH</th>
                  {coutVisible && <th className={cn(th, 'text-right')}>Frais alloués</th>}
                  <th className={cn(th, 'text-right')}>Poids net</th>
                  <th className={cn(th, 'text-right')}>Palettes</th>
                  <th className={cn(th, 'text-right')}>Bobines</th>
                  <th className={cn(th, 'text-left')}>Réception</th>
                  <th className={cn(th, 'w-24')} />
                </tr>
              </thead>
              <tbody>
                {d.factures.map((f) => {
                  const lignes = parFacture(f.id_facture)
                  const ecart = f.montant_devise != null && Math.abs(f.montant_devise - f.montant_lignes_devise) > 0.005
                  return (
                    <tr key={f.id_facture} className="cursor-pointer border-b border-bordure/60 hover:bg-attenue/30"
                      onClick={() => ouvrir(`/import/${idDossier}/factures/${f.id_facture}`)}>
                      <td className={cn(td, 'font-medium')}>{f.fournisseur_nom}</td>
                      <td className={cn(td, 'tabular-nums')}>{f.numero_facture}</td>
                      <td className={td}>{fmt.date(f.date_facture)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{f.nb_lignes}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {fmt.nombre(f.montant_lignes_devise, 2)} {f.code_devise}
                        {ecart && <div className="text-[10.5px] text-alerte">imprimé {fmt.nombre(f.montant_devise, 2)}</div>}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(lignes.reduce((t, l) => t + l.valeur_achat_dhs, 0), 2)}</td>
                      {coutVisible && (
                        <td className={cn(td, 'text-right tabular-nums')}>
                          {fmt.nombre(lignes.reduce((t, l) => t + (l.frais_alloues_dhs ?? 0), 0), 2)}
                        </td>
                      )}
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(lignes.reduce((t, l) => t + (l.poids_net_kg ?? 0), 0), 2)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(lignes.reduce((t, l) => t + l.nb_palettes, 0))}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(lignes.reduce((t, l) => t + l.nb_bobines, 0))}</td>
                      <td className={td}><Badge ton={TON_RECEPTION[f.statut_reception]}>{LIBELLE_RECEPTION[f.statut_reception]}</Badge></td>
                      <td className={cn(td, 'text-right')}>
                        <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primaire">
                          {ecrire ? 'Modifier' : 'Ouvrir'}
                          <ChevronRight className="size-3.5" />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-attenue/40 font-semibold">
                  <td className={td} colSpan={3}>Total du dossier</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{d.lignes.length}</td>
                  <td className={td} />
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(somme((l) => l.valeur_achat_dhs), 2)}</td>
                  {coutVisible && <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(somme((l) => l.frais_alloues_dhs ?? 0), 2)}</td>}
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(somme((l) => l.poids_net_kg ?? 0), 2)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(somme((l) => l.nb_palettes))}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.entier(somme((l) => l.nb_bobines))}</td>
                  <td className={td} colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
}

// ============================================================================
// Journal de cloture
// ============================================================================

function JournalCloture({ d }: { d: DossierComplet }) {
  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Ce que la clôture a fait au CUMP</CarteTitre>
      </CarteEntete>
      <CarteCorps className="p-0">
        <div className="defilement-x">
          <table className="w-full min-w-[36rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-bordure">
                <th className={cn(th, 'text-left')}>Référence</th>
                <th className={cn(th, 'text-left')}>Magasin</th>
                <th className={cn(th, 'text-right')}>Stock (kg)</th>
                <th className={cn(th, 'text-right')}>Montant (DH)</th>
                <th className={cn(th, 'text-right')}>CUMP avant → après</th>
              </tr>
            </thead>
            <tbody>
              {d.ajustements.map((a, i) => (
                <tr key={i} className="border-b border-bordure/60">
                  <td className={cn(td, 'font-medium')}>{a.code_reference}</td>
                  <td className={td}>{a.nature === 'STOCK' ? a.code_magasin : <em className="text-attenue-texte">déjà consommé</em>}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(a.stock_kg, 2)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{fmt.nombre(a.montant_dhs, 2)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>
                    {a.nature === 'STOCK'
                      ? `${a.cump_avant == null ? '—' : fmt.nombre(a.cump_avant, 4)} → ${a.cump_apres == null ? '—' : fmt.nombre(a.cump_apres, 4)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CarteCorps>
    </Carte>
  )
}

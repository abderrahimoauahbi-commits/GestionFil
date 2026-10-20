/**
 * LA LECTURE D'UNE PIECE — la saisie assistee.
 *
 * GestionAi lit le scan et rend ce qu'elle y a trouve : les documents de la
 * liasse (facture du fournisseur, DUM, engagements, liquidation, quittance,
 * factures de frais) et, pour chaque champ, la valeur, la page et un STATUT.
 * C'est le statut qui fait l'ecran : on relit d'abord ce qui est « a verifier »
 * ou « deduit », et l'on passe vite sur ce qu'un calcul a deja confirme.
 *
 * RIEN N'EST ENREGISTRE PAR LA LECTURE. Le scan reste a gauche, sous les yeux ;
 * un clic sur un champ ouvre la page d'ou il sort. Le seul report direct est
 * celui des engagements — un numero a recopier, que l'operateur declenche lui-
 * meme ; le reste se saisit dans les ecrans du dossier, lecture a cote.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Link2, RefreshCw, ScanText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { EnTetePage } from '../../composants/Coquille'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
} from '../../composants/ui/base'
import { useDroits } from '../../auth/AuthContext'
import { useOuvrirVue } from '../../lib/navigation'
import { cn, fmt } from '../../lib/utils'
import { echec, useRafraichir, useVersionSuivie } from './dialogues'
import type { DossierComplet } from './types'

// ---------------------------------------------------------------------------
// Ce que GestionAi rend
// ---------------------------------------------------------------------------
type Statut = 'lu' | 'verifie' | 'corrige' | 'deduit' | 'a_verifier'

interface ChampLu {
  valeur: string | number | string[] | null
  fragment: string
  page: number
  statut: Statut
  note?: string
}
type Bloc = Record<string, ChampLu>

interface DocumentLu {
  type: 'facture_fournisseur' | 'facture_frais' | 'dum' | 'engagement' | 'liquidation' | 'quittance'
  pages: number[]
  confiance_min?: number
  a_relire?: boolean
  entete: Bloc
  lignes?: (Bloc & { unite?: string })[]
  engagements?: Bloc[]
  rubriques?: Bloc[]
  frais_proposes?: Record<string, number>
  /** Ce que la lecture n'a pas pu faire, dit en clair (facture aux lignes illisibles). */
  avertissement?: string
}

interface Lecture {
  resultat: {
    documents: DocumentLu[]
    pages: { numero: number; type: string; confiance: number | null }[]
    references: Record<string, string[]>
  }
  duree_s: number | null
  date_lecture: string
  lu_par: string | null
}

const TITRES: Record<DocumentLu['type'], string> = {
  facture_fournisseur: 'Facture du fournisseur',
  facture_frais: 'Facture de frais',
  dum: 'DUM',
  engagement: 'Engagement d’importation',
  liquidation: 'Liquidation des droits et taxes',
  quittance: 'Quittance de la douane',
}

const STATUTS: Record<Statut, { libelle: string; ton: 'neutre' | 'succes' | 'info' | 'alerte' | 'danger'; aide: string }> = {
  verifie: { libelle: 'vérifié', ton: 'succes', aide: 'Lu, et confirmé par un calcul ou une autre pièce' },
  corrige: { libelle: 'corrigé', ton: 'info', aide: 'Plusieurs lectures possibles : le calcul a tranché' },
  lu: { libelle: 'lu', ton: 'neutre', aide: 'Lu tel quel, aucun contrôle possible' },
  deduit: { libelle: 'déduit', ton: 'alerte', aide: 'Illisible sur le scan : calculé à partir des autres nombres' },
  a_verifier: { libelle: 'à vérifier', ton: 'danger', aide: 'Le calcul ne tombe pas juste : relire sur le scan' },
}

/** Le nom des champs, tels qu'on les dit au bureau. */
const LIBELLES: Record<string, string> = {
  fournisseur: 'Fournisseur',
  emetteur: 'Émetteur',
  numero_facture: 'N° de facture',
  date_facture: 'Date',
  code_devise: 'Devise',
  incoterm: 'Incoterm',
  montant_devise: 'Montant (devise)',
  poids_net_kg: 'Poids net (kg)',
  poids_brut_kg: 'Poids brut (kg)',
  fret_devise: 'Fret (devise)',
  fob_devise: 'FOB (devise)',
  numero_dum: 'N° de DUM',
  numero_dum_cite: 'DUM citée',
  date_dum: 'Date de la DUM',
  taux_change: 'Taux de change',
  fret: 'Fret',
  assurance: 'Assurance',
  valeur_declaree_mad: 'Valeur déclarée (MAD)',
  conteneurs: 'Conteneurs',
  numero_bl: 'Connaissement',
  numero_ei: 'N° d’engagement',
  date_ei: 'Date',
  banque: 'Banque',
  quantite_kg: 'Quantité (kg)',
  numero_liquidation: 'N° de liquidation',
  date_liquidation: 'Date de liquidation',
  valeur_mad: 'Valeur (MAD)',
  total_mad: 'Total liquidé (MAD)',
  timbre_mad: 'Timbre (MAD)',
  montant_mad: 'Montant (MAD)',
  date_paiement: 'Payée le',
  reference: 'Référence',
  id_frais: 'Type de frais proposé',
  montant_ht: 'Montant HT',
  montant_tva: 'TVA',
  montant_ttc: 'Montant TTC',
}

const DECIMALES: Record<string, number> = { taux_change: 4 }

function afficher(cle: string, c: ChampLu | undefined): string {
  if (!c || c.valeur == null) return '—'
  const v = c.valeur
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'number') return fmt.nombre(v, DECIMALES[cle] ?? (Number.isInteger(v) ? 0 : 2))
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmt.date(v)
  return v
}

function PuceStatut({ statut }: { statut: Statut }) {
  const s = STATUTS[statut]
  return (
    <Badge ton={s.ton} title={s.aide}>
      {s.libelle}
    </Badge>
  )
}

/** Tous les champs d'un document, lignes comprises, pour les compter. */
function champsDe(d: DocumentLu): ChampLu[] {
  const listes = [d.entete, ...(d.lignes ?? []), ...(d.engagements ?? []), ...(d.rubriques ?? [])]
  return listes.flatMap((b) => Object.values(b).filter((c): c is ChampLu => typeof c === 'object' && c !== null && 'statut' in c))
}

// ---------------------------------------------------------------------------
// L'ecran
// ---------------------------------------------------------------------------
export function LecturePiece() {
  const { id: idDossier = '', idPiece = '' } = useParams()
  const droits = useDroits('IMPORT')
  const lecteur = droits.peutEcrire
  const ouvrir = useOuvrirVue()
  const qc = useQueryClient()
  const rafraichir = useRafraichir(idDossier)
  const [page, setPage] = useState(1)
  const [scan, setScan] = useState<{ url: string; type: string } | null>(null)

  const qDossier = useQuery({
    queryKey: ['import-dossier', idDossier],
    queryFn: ({ signal }) => api.get<DossierComplet>(`/api/import/dossiers/${idDossier}`, { signal }),
    enabled: !!idDossier,
  })
  // L'engagement rattache passe par la version du dossier (verrou optimiste).
  const version = useVersionSuivie(qDossier.data?.dossier.version, false, rafraichir)
  const qLecture = useQuery({
    queryKey: ['piece-lecture', idPiece],
    queryFn: ({ signal }) => api.get<Lecture | null>(`/api/import/pieces/${idPiece}/lecture`, { signal }),
    enabled: !!idPiece,
  })

  // Le scan : la route exige le jeton, on le telecharge et on l'affiche depuis
  // une adresse locale, revoquee en quittant l'ecran.
  useEffect(() => {
    let url: string | null = null
    let annule = false
    api
      .fichier(`/api/import/pieces/${idPiece}`)
      .then((f) => {
        url = f.url
        if (annule) URL.revokeObjectURL(f.url)
        else setScan(f)
      })
      .catch(echec)
    return () => {
      annule = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [idPiece])

  const lire = useMutation({
    mutationFn: () => api.post<Lecture>(`/api/import/pieces/${idPiece}/lecture`, {}),
    onSuccess: (l) => {
      qc.setQueryData(['piece-lecture', idPiece], l)
      const n = l.resultat.documents.length
      toast.success(`${n} document(s) reconnu(s) en ${fmt.nombre(l.duree_s ?? 0, 0)} s`)
    },
    onError: echec,
  })

  const d = qDossier.data
  const piece = d?.pieces.find((p) => p.id_piece === idPiece)
  const lecture = qLecture.data
  const documents = useMemo(() => lecture?.resultat.documents ?? [], [lecture])

  const compte = useMemo(() => {
    const c: Record<Statut, number> = { verifie: 0, corrige: 0, lu: 0, deduit: 0, a_verifier: 0 }
    for (const doc of documents) for (const champ of champsDe(doc)) c[champ.statut]++
    return c
  }, [documents])

  const engagementsDuDossier = new Set((d?.engagements ?? []).map((e) => e.numero_ei))

  const rattacher = useMutation({
    mutationFn: async (ei: Bloc) =>
      version.suivre(
        await api.post(`/api/import/dossiers/${idDossier}/engagements`, {
          numero_ei: String(ei.numero_ei?.valeur ?? ''),
          banque: ei.banque?.valeur ?? null,
          date_ei: ei.date_ei?.valeur ?? null,
          quantite_kg: typeof ei.quantite_kg?.valeur === 'number' ? ei.quantite_kg.valeur : null,
          montant_devise: typeof ei.montant_devise?.valeur === 'number' ? ei.montant_devise.valeur : null,
          code_devise: ei.code_devise?.valeur ?? null,
          version: version.lire(),
        }),
      ),
    onSuccess: (_r, ei) => {
      toast.success(`Engagement ${ei.numero_ei?.valeur} rattaché au dossier`)
      rafraichir()
    },
    onError: version.echec,
  })

  if (!d) return <div className="p-4 text-attenue-texte">Chargement…</div>
  // LIRE RESTE PERMIS SUR UN DOSSIER CLOS (retrouver un chiffre, repondre a un
  // controle) ; y rattacher un engagement, non.
  const ecrire = lecteur && d.dossier.statut !== 'CLOTURE'

  const allerA = (p: number) => setPage(p)
  const src = scan ? (scan.type.includes('pdf') ? `${scan.url}#page=${page}` : scan.url) : null

  /** Une table de champs : libelle, valeur, statut ; la note et le fragment dessous. */
  const tableChamps = (bloc: Bloc) => (
    <table className="w-full text-[12.5px]">
      <tbody>
        {Object.entries(bloc).map(([cle, c]) => (
          <tr
            key={cle}
            className="cursor-pointer border-b border-bordure/50 align-top hover:bg-attenue/40"
            title={`Page ${c.page} — « ${c.fragment} »`}
            onClick={() => allerA(c.page)}
          >
            <td className="w-44 px-2 py-1.5 text-attenue-texte">{LIBELLES[cle] ?? cle}</td>
            <td className="px-2 py-1.5">
              <span className="font-medium tabular-nums">{afficher(cle, c)}</span>
              {c.note && <div className="text-[11px] text-attenue-texte">{c.note}</div>}
            </td>
            <td className="w-24 px-2 py-1.5 text-right">
              <PuceStatut statut={c.statut} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const cellule = (cle: string, c: ChampLu | undefined, droite = false) => (
    <td
      className={cn('px-2 py-1 tabular-nums', droite && 'text-right', c && c.statut !== 'lu' && c.statut !== 'verifie' && 'font-semibold',
        c?.statut === 'a_verifier' && 'text-danger', c?.statut === 'deduit' && 'text-alerte')}
      title={c ? `${STATUTS[c.statut].libelle}${c.note ? ` — ${c.note}` : ''}` : undefined}
    >
      {afficher(cle, c)}
    </td>
  )

  const th = 'px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'

  return (
    <div className="space-y-3 pb-4">
      <EnTetePage
        titre="Lecture de la pièce"
        description={`Dossier ${d.dossier.numero}${piece ? ` · ${piece.nom_fichier}` : ''}`}
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir(`/import/${idDossier}`)}>
              <ArrowLeft />
              Dossier {d.dossier.numero}
            </Bouton>
            {lecteur && (
              <Bouton chargement={lire.isPending} onClick={() => lire.mutate()}>
                {lecture ? <RefreshCw /> : <ScanText />}
                {lecture ? 'Relire' : 'Lire la pièce'}
              </Bouton>
            )}
          </>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ============ Le scan, toujours sous les yeux ============ */}
        <div className="xl:sticky xl:top-16 xl:self-start">
          <Carte>
            <CarteEntete>
              <CarteTitre>Scan</CarteTitre>
              <span className="text-[11.5px] text-attenue-texte">page {page}</span>
            </CarteEntete>
            <CarteCorps className="p-0">
              {src ? (
                scan!.type.includes('pdf') ? (
                  // La cle force le rechargement : changer seulement le #page
                  // d'une iframe ne fait pas tourner la page dans tous les
                  // navigateurs.
                  <iframe key={page} src={src} title="Scan de la pièce" className="h-[78vh] w-full rounded-b-[var(--radius)]" />
                ) : (
                  <img src={src} alt="Scan de la pièce" className="w-full rounded-b-[var(--radius)]" />
                )
              ) : (
                <p className="p-4 text-[12.5px] text-attenue-texte">Chargement du scan…</p>
              )}
            </CarteCorps>
          </Carte>
        </div>

        {/* ============ Ce que la lecture propose ============ */}
        <div className="space-y-3">
          {lire.isPending && (
            <Alerte ton="info">
              Lecture en cours : quelques secondes par page. Une liasse de vingt pages demande deux minutes environ.
            </Alerte>
          )}
          {!lecture && !lire.isPending && (
            <Alerte ton="info">
              Cette pièce n’a pas encore été lue. La lecture reconnaît la facture du fournisseur, la DUM et ses
              engagements, la liquidation, la quittance et les factures de frais, et contrôle chaque montant par
              le calcul. Elle ne saisit rien : vous confirmez, scan à côté.
            </Alerte>
          )}

          {lecture && (
            <Carte>
              <CarteCorps className="flex flex-wrap items-center gap-2 py-2.5 text-[12px]">
                <span className="text-attenue-texte">
                  Lue le {fmt.date(lecture.date_lecture)}
                  {lecture.lu_par && ` par ${lecture.lu_par}`}
                  {lecture.duree_s != null && ` en ${fmt.nombre(lecture.duree_s, 0)} s`} ·{' '}
                  {documents.length} document(s)
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {(['a_verifier', 'deduit', 'corrige', 'verifie', 'lu'] as Statut[])
                    .filter((s) => compte[s] > 0)
                    .map((s) => (
                      <Badge key={s} ton={STATUTS[s].ton} title={STATUTS[s].aide}>
                        {compte[s]} {STATUTS[s].libelle}
                      </Badge>
                    ))}
                </span>
              </CarteCorps>
            </Carte>
          )}

          {documents.length === 0 && lecture && (
            <Alerte ton="alerte">
              Aucun document reconnu. Le scan est peut-être trop pâle ou incliné : rescannez-le, ou saisissez à la main.
            </Alerte>
          )}

          {documents.map((doc, i) => (
            <Carte key={`${doc.type}-${i}`}>
              <CarteEntete>
                <CarteTitre>{TITRES[doc.type]}</CarteTitre>
                <span className="flex items-center gap-1.5 text-[11.5px] text-attenue-texte">
                  {doc.a_relire && (
                    <Badge ton="alerte" title="Confiance de lecture faible : relire la page à l’œil">
                      lecture {fmt.nombre(doc.confiance_min ?? 0, 0)} %
                    </Badge>
                  )}
                  {doc.pages.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={cn('rounded px-1 hover:bg-attenue', p === page && 'bg-attenue font-semibold text-texte')}
                      onClick={() => allerA(p)}
                    >
                      p. {p}
                    </button>
                  ))}
                </span>
              </CarteEntete>
              <CarteCorps className="space-y-3 p-0 pb-2">
                {doc.avertissement && (
                  <div className="px-2 pt-2">
                    <Alerte ton="alerte">{doc.avertissement}</Alerte>
                  </div>
                )}
                {tableChamps(doc.entete)}

                {doc.type === 'engagement' && ecrire && doc.entete.numero_ei && (
                  <div className="px-2">
                    {engagementsDuDossier.has(String(doc.entete.numero_ei.valeur)) ? (
                      <Badge ton="succes">Déjà rattaché au dossier</Badge>
                    ) : (
                      <Bouton taille="sm" variante="contour" chargement={rattacher.isPending}
                        onClick={() => rattacher.mutate(doc.entete)}>
                        <Link2 />
                        Rattacher cet engagement au dossier
                      </Bouton>
                    )}
                  </div>
                )}

                {doc.lignes && doc.lignes.length > 0 && (
                  <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
                    <table className="w-full min-w-[40rem] text-[12px]">
                      <thead>
                        <tr className="border-y border-bordure">
                          <th className={cn(th, 'text-left')}>Désignation</th>
                          <th className={cn(th, 'text-left')}>Lot</th>
                          <th className={cn(th, 'text-left')}>Couleur</th>
                          <th className={cn(th, 'text-left')}>Conteneur</th>
                          <th className={cn(th, 'text-right')}>Quantité</th>
                          <th className={cn(th, 'text-right')}>Prix</th>
                          <th className={cn(th, 'text-right')}>Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.lignes.map((l, j) => (
                          <tr key={j} className="cursor-pointer border-b border-bordure/50 hover:bg-attenue/40"
                            onClick={() => l.quantite && allerA(l.quantite.page)}>
                            <td className="px-2 py-1">{afficher('libelle', l.libelle)}</td>
                            {cellule('lot_fournisseur', l.lot_fournisseur)}
                            <td className="px-2 py-1">
                              {[l.code_couleur?.valeur, l.libelle_couleur?.valeur].filter(Boolean).join(' ') || '—'}
                            </td>
                            {cellule('conteneur', l.conteneur)}
                            {cellule('quantite', l.quantite, true)}
                            {cellule('prix_unitaire_devise', l.prix_unitaire_devise, true)}
                            {cellule('montant_devise', l.montant_devise, true)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {doc.engagements && doc.engagements.length > 0 && (
                  <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
                    <table className="w-full min-w-[36rem] text-[12px]">
                      <thead>
                        <tr className="border-y border-bordure">
                          <th className={cn(th, 'text-left')}>Engagement cité (case 38)</th>
                          <th className={cn(th, 'text-left')}>Banque</th>
                          <th className={cn(th, 'text-right')}>Quantité (kg)</th>
                          <th className={cn(th, 'text-right')}>Valeur</th>
                          {ecrire && <th className={th} />}
                        </tr>
                      </thead>
                      <tbody>
                        {doc.engagements.map((ei, j) => (
                          <tr key={j} className="border-b border-bordure/50">
                            {cellule('numero_ei', ei.numero_ei)}
                            {cellule('banque', ei.banque)}
                            {cellule('quantite_kg', ei.quantite_kg, true)}
                            {cellule('montant_devise', ei.montant_devise, true)}
                            {ecrire && (
                              <td className="px-2 py-1 text-right">
                                {engagementsDuDossier.has(String(ei.numero_ei?.valeur)) ? (
                                  <Badge ton="succes">rattaché</Badge>
                                ) : (
                                  <Bouton taille="xs" variante="discret" chargement={rattacher.isPending}
                                    title="Rattacher cet engagement au dossier" onClick={() => rattacher.mutate(ei)}>
                                    <Link2 />
                                    Rattacher
                                  </Bouton>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {doc.rubriques && doc.rubriques.length > 0 && (
                  <div tabIndex={0} role="region" aria-label="Zone défilante" className="defilement-x focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anneau">
                    <table className="w-full min-w-[32rem] text-[12px]">
                      <thead>
                        <tr className="border-y border-bordure">
                          <th className={cn(th, 'text-left')}>Rubrique</th>
                          <th className={cn(th, 'text-left')}>Désignation</th>
                          <th className={cn(th, 'text-left')}>Frais proposé</th>
                          <th className={cn(th, 'text-right')}>Montant (MAD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.rubriques.map((r, j) => (
                          <tr key={j} className="border-b border-bordure/50">
                            {cellule('code', r.code)}
                            {cellule('designation', r.designation)}
                            {cellule('id_frais', r.id_frais)}
                            {cellule('montant_mad', r.montant_mad, true)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {doc.frais_proposes && Object.keys(doc.frais_proposes).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 px-2 text-[12px]">
                    <span className="text-attenue-texte">À saisir en frais :</span>
                    {Object.entries(doc.frais_proposes).map(([f, m]) => (
                      <Badge key={f} ton="or">
                        {f} {fmt.nombre(m, 2)} MAD
                      </Badge>
                    ))}
                  </div>
                )}
              </CarteCorps>
            </Carte>
          ))}
        </div>
      </div>
    </div>
  )
}

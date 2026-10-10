/**
 * CLOTURER UNE RECEPTION AVEC SA FACTURE (regle 6, 08/10/2026 ; audit v4).
 *
 * A la validation, la marchandise est entree au prix du bon : une valeur
 * PROVISOIRE. La facture du fournisseur, avec ses frais, donne la valeur
 * DEFINITIVE. La difference va au stock encore present DE CETTE RECEPTION —
 * ses lots, la ou ils sont ; la part des kilos deja sortis est tracee en ecart
 * de prix, hors CMUP. On voit l'apercu avant de signer.
 *
 * La facture se saisit DANS LA DEVISE DU BON, au cours Bank Al-Maghrib de sa
 * date (propose, modifiable, controle comme a l'import). Une meme facture peut
 * couvrir plusieurs receptions du fournisseur : son montant se repartit au
 * prorata de leur valeur provisoire. Une facture tres loin du bon leve un
 * AVIS, elle ne se bloque pas.
 *
 * Une reception cloturee se corrige par un AVOIR ou une facture
 * complementaire (`CorrectionFacture`), motivee et journalisee.
 *
 * Saisie sur la page, pas dans une fenetre : c'est un document qu'on relit.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, FileCheck2, FileMinus2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { Alerte, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Etiq, Selecteur } from '../composants/ui/base'
import { cn, fmt } from '../lib/utils'
import { PanneRequetes } from '../composants/PanneRequetes'
import { lireNombre } from '../lib/nombres'

interface LigneRef {
  code_reference: string
  numero_reception?: string
  valeur_provisoire_mad: number
  difference_mad: number
  recu_kg: number
  stock_kg: number
  au_stock_mad: number
  ecart_prix_mad: number
}

interface Resultat {
  code_devise?: string
  montant_devise?: number
  taux_change?: number
  valeur_provisoire_mad: number
  valeur_definitive_mad: number
  difference_mad: number
  au_stock_mad: number
  ecart_prix_mad: number
  references: LigneRef[]
  receptions?: { numero_reception: string }[]
  avis?: string[]
}

interface Contexte {
  /** Les kilos rendus au fournisseur, pas encore soldes (regle 3). */
  retours?: { numero_mouvement: string; code_reference: string; kg: number }[]
  code_devise: string
  taux_reference: number | null
  source_taux: string | null
  receptions: { id_reception: string; numero_reception: string; date_reception: string; valeur_provisoire_mad?: number }[]
}

const signe = (n: number) => `${n > 0 ? '+' : ''}${fmt.nombre(n, 2)}`
const nb = (s: string) => (lireNombre(s) ?? 0)
const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

/** Le detail par reference : ce que l'apercu montre avant de signer. */
function TableApercu({ r, plusieurs }: { r: Pick<Resultat, 'references'> & Partial<Resultat>; plusieurs: boolean }) {
  return (
    <div className="defilement-x">
      <table className="w-full min-w-[40rem] text-[12.5px] tabular-nums">
        <thead>
          <tr className="border-b border-bordure text-[10.5px] uppercase tracking-wider text-attenue-texte">
            {plusieurs && <th className="px-2 py-1.5 text-left">Réception</th>}
            <th className="px-2 py-1.5 text-left">Référence</th>
            <th className="px-2 py-1.5 text-right">Provisoire</th>
            <th className="px-2 py-1.5 text-right">Différence</th>
            <th className="px-2 py-1.5 text-right">Reçu / encore là</th>
            <th className="px-2 py-1.5 text-right">Au stock (CMUP)</th>
            <th className="px-2 py-1.5 text-right">Écart de prix</th>
          </tr>
        </thead>
        <tbody>
          {r.references.map((x) => (
            <tr key={`${x.numero_reception ?? ''}-${x.code_reference}`} className="border-b border-bordure/60">
              {plusieurs && <td className="px-2 py-1">{x.numero_reception}</td>}
              <td className="px-2 py-1">{x.code_reference}</td>
              <td className="px-2 py-1 text-right">{fmt.nombre(x.valeur_provisoire_mad, 2)}</td>
              <td className={cn('px-2 py-1 text-right', x.difference_mad < 0 ? 'text-succes' : x.difference_mad > 0 && 'text-alerte')}>
                {signe(x.difference_mad)}
              </td>
              <td className="px-2 py-1 text-right">{fmt.nombre(x.recu_kg, 0)} / {fmt.nombre(x.stock_kg, 0)} kg</td>
              <td className="px-2 py-1 text-right">{signe(x.au_stock_mad)}</td>
              <td className="px-2 py-1 text-right text-attenue-texte">{signe(x.ecart_prix_mad)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="px-2 py-1" colSpan={plusieurs ? 2 : 1}>Total</td>
            <td className="px-2 py-1 text-right">{r.valeur_provisoire_mad != null ? fmt.nombre(r.valeur_provisoire_mad, 2) : ''}</td>
            <td className="px-2 py-1 text-right">{r.difference_mad != null ? signe(r.difference_mad) : ''}</td>
            <td />
            <td className="px-2 py-1 text-right">{r.au_stock_mad != null ? signe(r.au_stock_mad) : ''}</td>
            <td className="px-2 py-1 text-right">{r.ecart_prix_mad != null ? signe(r.ecart_prix_mad) : ''}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function ClotureFacture({
  idReception,
  numeroFacture,
  surCloture,
}: {
  idReception: string
  numeroFacture: string | null
  surCloture: () => void
}) {
  const qc = useQueryClient()
  const [ouvert, setOuvert] = useState(false)
  const [f, setF] = useState({
    numero: numeroFacture ?? '',
    date: new Date().toISOString().slice(0, 10),
    montant: '',
    taux: '',
    frais: '',
  })
  const [autres, setAutres] = useState<string[]>([])
  /* DES KILOS ONT ETE RENDUS (regle 3, 09/10/2026) : la facture les porte-t-elle ? */
  const [nette, setNette] = useState<'' | 'oui' | 'non'>('')
  const [confirmerTaux, setConfirmerTaux] = useState(false)
  const [apercu, setApercu] = useState<Resultat | null>(null)

  const qCtx = useQuery({
    queryKey: ['reception-facture-contexte', idReception, f.date],
    queryFn: ({ signal }) => api.get<Contexte>(`/api/receptions/${idReception}/facture-contexte?date=${f.date}`, { signal }),
    enabled: ouvert,
  })
  // LA DEVISE N'EST JAMAIS SUPPOSEE (09/10/2026). Si le contexte n'a pas pu etre
  // lu, l'ecran retombait sur « MAD » sans rien dire : sur un bon en USD, on
  // saisissait des dirhams que le serveur multipliait ensuite par le cours.
  // Tant que la devise n'est pas connue, rien ne se calcule.
  const devise = qCtx.data?.code_devise ?? 'MAD'
  const contexteLu = qCtx.isSuccess
  const enDevise = devise !== 'MAD'
  // Le taux propose : le cours de reference, tant que l'operateur n'a rien tape.
  const tauxEffectif = f.taux.trim() ? nb(f.taux) : (qCtx.data?.taux_reference ?? null)

  const corps = (simuler: boolean) => ({
    numero_facture: f.numero.trim(),
    date_facture: f.date,
    montant_facture: nb(f.montant),
    taux_change: enDevise && tauxEffectif ? tauxEffectif : undefined,
    confirmer_taux: confirmerTaux,
    autres_receptions: autres,
    frais_mad: f.frais.trim() ? nb(f.frais) : 0,
    facture_nette: nette === '' ? undefined : nette === 'oui',
    simuler,
  })
  const retours = qCtx.data?.retours ?? []
  const complet =
    contexteLu &&
    f.numero.trim() !== '' &&
    nb(f.montant) > 0 &&
    (!enDevise || (tauxEffectif ?? 0) > 0) &&
    (retours.length === 0 || nette !== '')
  const surEchec = (e: unknown) => {
    // Un taux loin du cours : l'ecran propose la confirmation au lieu d'un refus sec.
    if (e instanceof ErreurApi && e.estRegle('TAUX-ECART')) {
      toast.warning(e.messageSansCode, { description: 'Cochez « Confirmer ce taux » s’il est celui de la banque.' })
      return
    }
    echec(e)
  }

  const simuler = useMutation({
    mutationFn: () => api.post<Resultat>(`/api/receptions/${idReception}/cloturer`, corps(true)),
    onSuccess: setApercu,
    onError: surEchec,
  })
  const cloturer = useMutation({
    mutationFn: () => api.post<Resultat>(`/api/receptions/${idReception}/cloturer`, corps(false)),
    onSuccess: (r) => {
      toast.success(autres.length ? `${autres.length + 1} réceptions clôturées` : 'Réception clôturée', {
        description: `Valeur définitive ${fmt.nombre(r.valeur_definitive_mad, 2)} MAD — ${signe(r.au_stock_mad)} au stock, ${signe(r.ecart_prix_mad)} en écart de prix.`,
      })
      void qc.invalidateQueries()
      surCloture()
    },
    onError: surEchec,
  })
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }))
    if (k === 'taux') setConfirmerTaux(false)
    setApercu(null)
  }
  const basculer = (id: string) => {
    setAutres((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))
    setApercu(null)
  }

  if (!ouvert) {
    return (
      <Bouton variante="contour" onClick={() => setOuvert(true)}>
        <FileCheck2 />
        Clôturer avec la facture
      </Bouton>
    )
  }

  return (
    <Carte className="mb-3">
      <CarteEntete>
        <CarteTitre>Clôturer avec la facture du fournisseur</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        <PanneRequetes requetes={[['La devise et le cours de la réception', qCtx]]} />
        {retours.length > 0 && (
          <Alerte ton="alerte" titre="Des kilos ont été rendus au fournisseur">
            <p className="m-0">
              {retours.map((r) => `${r.numero_mouvement} : ${r.code_reference} ${fmt.nombre(r.kg, 1)} kg`).join(' · ')}.
              Leur valeur est déjà sortie du stock. La facture porte-t-elle sur ces kilos ?
            </p>
            <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="nette" checked={nette === 'oui'} onChange={() => { setNette('oui'); setApercu(null) }} />
                Non : facture nette, sur les kilos gardés
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="nette" checked={nette === 'non'} onChange={() => { setNette('non'); setApercu(null) }} />
                Oui : facture brute, un avoir pour retour suivra
              </label>
            </div>
          </Alerte>
        )}
        <p className="text-[12.5px] text-attenue-texte">
          La marchandise est entrée au prix du bon. La facture et ses frais donnent la valeur définitive : la
          différence va aux lots de la réception encore en stock, là où ils sont ; la part des kilos déjà sortis
          reste en écart de prix.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Etiq obligatoire>N° de facture</Etiq>
            <Champ value={f.numero} onChange={maj('numero')} />
          </div>
          <div>
            <Etiq obligatoire>Date de la facture</Etiq>
            <Champ type="date" value={f.date} onChange={maj('date')} />
          </div>
          <div>
            <Etiq obligatoire>Montant HT de la marchandise ({devise})</Etiq>
            <Champ inputMode="decimal" className="text-right tabular-nums" value={f.montant} onChange={maj('montant')} />
          </div>
          {enDevise && (
            <div>
              <Etiq obligatoire>Taux {devise} → MAD</Etiq>
              <Champ inputMode="decimal" className="text-right tabular-nums" value={f.taux} onChange={maj('taux')}
                placeholder={qCtx.data?.taux_reference ? fmt.nombre(qCtx.data.taux_reference, 4) : 'à saisir'} />
              <p className="mt-0.5 text-[11px] text-attenue-texte">
                {qCtx.data?.source_taux ? `Proposé : ${qCtx.data.source_taux}` : 'Aucun cours de référence pour cette date'}
              </p>
              <label className="mt-1 flex items-center gap-1.5 text-[11.5px]">
                <input type="checkbox" checked={confirmerTaux} onChange={(e) => { setConfirmerTaux(e.target.checked); setApercu(null) }} />
                Confirmer ce taux (écart au cours accepté)
              </label>
            </div>
          )}
          <div>
            <Etiq>Frais (transport, manutention) en MAD</Etiq>
            <Champ inputMode="decimal" className="text-right tabular-nums" value={f.frais} onChange={maj('frais')} />
          </div>
          {enDevise && tauxEffectif != null && nb(f.montant) > 0 && (
            <div className="flex items-end pb-1.5 text-[12.5px] tabular-nums text-attenue-texte">
              soit {fmt.nombre(nb(f.montant) * tauxEffectif, 2)} MAD de marchandise
            </div>
          )}
        </div>

        {(qCtx.data?.receptions.length ?? 0) > 0 && (
          <div>
            <Etiq>La facture couvre aussi (même fournisseur, même devise)</Etiq>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {qCtx.data!.receptions.map((r) => (
                <label key={r.id_reception} className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" checked={autres.includes(r.id_reception)} onChange={() => basculer(r.id_reception)} />
                  <span className="font-medium">{r.numero_reception}</span>
                  <span className="text-attenue-texte">
                    du {fmt.date(r.date_reception)}
                    {r.valeur_provisoire_mad != null && ` · ${fmt.nombre(r.valeur_provisoire_mad, 2)} MAD`}
                  </span>
                </label>
              ))}
            </div>
            {autres.length > 0 && (
              <p className="mt-1 text-[11.5px] text-attenue-texte">
                Le montant et les frais se répartissent entre les {autres.length + 1} réceptions au prorata de leur valeur au prix du bon.
              </p>
            )}
          </div>
        )}

        {apercu && (apercu.avis?.length ?? 0) > 0 && (
          <Alerte ton="alerte" titre="Écart à vérifier avant de clôturer">
            <ul className="list-disc pl-4">
              {apercu.avis!.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </Alerte>
        )}
        {apercu && <TableApercu r={apercu} plusieurs={(apercu.receptions?.length ?? 1) > 1} />}

        <div className="flex flex-wrap items-center gap-2">
          <Bouton variante="contour" disabled={!complet} chargement={simuler.isPending} onClick={() => simuler.mutate()}>
            <Eye />
            Aperçu
          </Bouton>
          <Bouton disabled={!complet || !apercu} chargement={cloturer.isPending} onClick={() => cloturer.mutate()}
            title={!apercu ? 'Faites d’abord l’aperçu' : undefined}>
            <FileCheck2 />
            Clôturer
          </Bouton>
          <Bouton variante="discret" onClick={() => setOuvert(false)}>Fermer</Bouton>
          <span className="text-[11.5px] text-attenue-texte">
            Après clôture, l’entrée ne s’annule plus : une correction passe par un avoir.
          </span>
        </div>
      </CarteCorps>
    </Carte>
  )
}

/**
 * AVOIR OU FACTURE COMPLEMENTAIRE sur une reception cloturee (regle 8). Le
 * montant, en MAD, fait baisser ou monter la valeur par le meme calcul que la
 * cloture ; numero de piece et motif sont obligatoires, et journalises.
 */
export function CorrectionFacture({ idReception, surCorrection }: { idReception: string; surCorrection: () => void }) {
  const qc = useQueryClient()
  const [ouvert, setOuvert] = useState(false)
  const [c, setC] = useState({ nature: 'AVOIR', piece: '', montant: '', motif: '', reference: '' })
  const [apercu, setApercu] = useState<
    | (Pick<Resultat, 'references' | 'difference_mad' | 'au_stock_mad' | 'ecart_prix_mad'> & {
        valeur_retours_mad?: number
      })
    | null
  >(null)
  /* Les references de la reception : un avoir peut n'en viser qu'une (U6). */
  const qLignes = useQuery({
    queryKey: ['reception-lignes-refs', idReception],
    queryFn: ({ signal }) => api.get<{ code_reference: string }[]>(`/api/receptions/${idReception}/lignes`, { signal }),
    enabled: ouvert,
  })
  const references = [...new Set((qLignes.data ?? []).map((l) => l.code_reference))]
  const pourRetour = c.nature === 'AVOIR_RETOUR'

  const corps = (simuler: boolean) => ({
    nature: c.nature,
    numero_piece: c.piece.trim(),
    montant_mad: nb(c.montant),
    motif: c.motif.trim(),
    code_reference: !pourRetour && c.reference ? c.reference : undefined,
    simuler,
  })
  const complet = c.piece.trim() !== '' && nb(c.montant) > 0 && c.motif.trim().length >= 5
  const simuler = useMutation({
    mutationFn: () => api.post<Resultat>(`/api/receptions/${idReception}/avoir`, corps(true)),
    onSuccess: setApercu,
    onError: echec,
  })
  const enregistrer = useMutation({
    mutationFn: () => api.post<Resultat>(`/api/receptions/${idReception}/avoir`, corps(false)),
    onSuccess: (r) => {
      toast.success(c.nature === 'COMPLEMENT' ? 'Facture complémentaire enregistrée' : 'Avoir enregistré', {
        description: `${signe(r.difference_mad)} MAD — ${signe(r.au_stock_mad)} au stock, ${signe(r.ecart_prix_mad)} en écart de prix.`,
      })
      setOuvert(false)
      setApercu(null)
      setC({ nature: 'AVOIR', piece: '', montant: '', motif: '', reference: '' })
      void qc.invalidateQueries()
      surCorrection()
    },
    onError: echec,
  })
  const maj = (k: keyof typeof c) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setC((x) => ({ ...x, [k]: e.target.value }))
    setApercu(null)
  }

  if (!ouvert) {
    return (
      <Bouton variante="contour" onClick={() => setOuvert(true)}>
        <FileMinus2 />
        Avoir ou facture complémentaire
      </Bouton>
    )
  }
  return (
    <Carte className="mb-3">
      <CarteEntete>
        <CarteTitre>Corriger la valeur de la réception</CarteTitre>
      </CarteEntete>
      <CarteCorps className="space-y-3">
        <p className="text-[12.5px] text-attenue-texte">
          Un avoir de prix fait baisser la valeur du stock restant, une facture complémentaire la fait monter : le
          montant va aux lots de la réception encore en stock, le reste en écart de prix. Un avoir pour retour se
          rapproche de la marchandise rendue, déjà sortie du stock : il ne change pas le coût moyen.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <Etiq obligatoire>Nature</Etiq>
            <Selecteur value={c.nature} onChange={maj('nature')}>
              <option value="AVOIR">Avoir de prix (la marchandise reste en stock)</option>
              <option value="AVOIR_RETOUR">Avoir pour retour (marchandise rendue)</option>
              <option value="COMPLEMENT">Facture complémentaire (hausse)</option>
            </Selecteur>
          </div>
          {!pourRetour && references.length > 1 && (
            <div>
              <Etiq>Référence visée</Etiq>
              <Selecteur value={c.reference} onChange={maj('reference')}>
                <option value="">Toute la réception</option>
                {references.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Selecteur>
            </div>
          )}
          <div>
            <Etiq obligatoire>N° de la pièce</Etiq>
            <Champ value={c.piece} onChange={maj('piece')} />
          </div>
          <div>
            <Etiq obligatoire>Montant (MAD)</Etiq>
            <Champ inputMode="decimal" className="text-right tabular-nums" value={c.montant} onChange={maj('montant')} />
          </div>
          <div className="sm:col-span-4">
            <Etiq obligatoire>Motif</Etiq>
            <Champ value={c.motif} onChange={maj('motif')} placeholder="Remise accordée, erreur de prix sur la facture…" />
          </div>
        </div>
        {apercu && pourRetour && (
          <Alerte ton="info">
            Retours soldés : {fmt.mad(apercu.valeur_retours_mad ?? 0)} au prix du bon, déjà sortis du stock. Écart de
            prix : {signe(apercu.ecart_prix_mad)} MAD. Le coût moyen ne change pas.
          </Alerte>
        )}
        {apercu && !pourRetour && <TableApercu r={apercu} plusieurs={false} />}
        <div className="flex flex-wrap items-center gap-2">
          <Bouton variante="contour" disabled={!complet} chargement={simuler.isPending} onClick={() => simuler.mutate()}>
            <Eye />
            Aperçu
          </Bouton>
          <Bouton disabled={!complet || !apercu} chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}
            title={!apercu ? 'Faites d’abord l’aperçu' : undefined}>
            <FileMinus2 />
            Enregistrer
          </Bouton>
          <Bouton variante="discret" onClick={() => setOuvert(false)}>Fermer</Bouton>
        </div>
      </CarteCorps>
    </Carte>
  )
}

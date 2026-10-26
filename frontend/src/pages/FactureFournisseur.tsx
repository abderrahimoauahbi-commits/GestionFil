/**
 * LA FACTURE FOURNISSEUR — le document (ADR-003 phase B).
 *
 * On la saisit EN FACE DE CE QUI EST ENTRE : la liste propose les pesees
 * validees du fournisseur qu'aucune facture ne couvre encore, avec leur prix
 * ENGAGE (celui du bon) et leurs kilos PESES. On coche, on corrige ce que le
 * papier dit, et le RAPPROCHEMENT se lit ligne par ligne :
 *
 *   quantite facturee contre quantite pesee — met en cause la livraison ;
 *   prix facture contre prix engage        — met en cause la negociation.
 *
 * Aucun des deux ne bloque : un ecart peut etre reel. Seule la double
 * facturation se refuse, et c'est la base qui la refuse.
 *
 * VALIDER, C'EST CLOTURER. L'apercu montre d'abord ce que le CUMP va faire :
 * l'ecart de prix de chaque reference va au stock encore present de ses lots,
 * la part des kilos deja sortis est tracee hors CUMP. Une facture validee est
 * figee ; elle se corrige par un avoir ou une facture complementaire.
 *
 * Saisie sur la page, pas dans une fenetre : c'est un document qu'on relit.
 *
 * L'APERCU ET LA VALIDATION PORTENT SUR LA FACTURE ENREGISTREE (24/10/2026).
 * Le serveur simule ce qui est en base, pas ce qui est a l'ecran : tant qu'un
 * champ a change (en-tete, notes ou lignes), l'apercu affiche ne vaut plus et
 * « Aperçu » comme « Valider » attendent l'enregistrement — la raison est
 * ecrite dans la barre du bas.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, FileCheck2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
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
} from '../composants/ui/base'
import { Aide, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { lireNombre, versSaisie } from '../lib/nombres'
import { nouvelIdentifiant } from '../lib/identifiant'
import { useGardeSaisie } from '../hooks/useGardeSaisie'

const MODULE = 'RECEPTIONS'

/** Le statut se lit en mots, pas en code. */
const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  VALIDEE: 'Validée',
  ANNULEE: 'Annulée',
}
const TON_STATUT: Record<string, 'neutre' | 'succes' | 'danger'> = {
  BROUILLON: 'neutre',
  VALIDEE: 'succes',
  ANNULEE: 'danger',
}

interface Candidate {
  id_ligne_reception: string
  id_reception: string
  numero_reception: string
  date_reception: string
  num_bon_livraison: string | null
  code_fournisseur: string
  code_reference: string
  designation: string | null
  quantite_stock_kg: number
  prix_kg_devise?: number
  code_devise: string
  lot_fournisseur: string | null
  numero_bc: string | null
  dossier_numero: string | null
  provisoire_mad?: number
}

interface LigneLue {
  id_ligne: string
  ligne_numero: number
  id_ligne_reception: string
  numero_reception: string
  code_reference: string
  designation: string | null
  numero_bc: string | null
  quantite_facturee_kg: number
  quantite_pesee_kg: number
  ecart_quantite_kg: number
  prix_kg_devise?: number
  prix_engage_devise?: number
  ecart_prix_devise?: number
  ecart_prix_pct?: number
  remise_pct: number
  montant_devise?: number
  provisoire_mad?: number
}

interface Entete {
  id_facture: string
  /** La version lue (verrou optimiste, groupe 3, 20/10/2026). */
  version: number
  numero_facture: string
  code_fournisseur: string
  fournisseur_nom: string
  date_facture: string
  code_devise: string
  taux_change: number
  montant_devise?: number
  frais_devise?: number
  facture_nette: number | null
  statut: string
  notes: string | null
  saisie_par: string | null
  valide_par: string | null
  dossier_numero: string | null
}

interface Apercu {
  valeur_provisoire_mad: number
  valeur_definitive_mad: number
  difference_mad: number
  au_stock_mad: number
  ecart_prix_mad: number
  receptions_cloturees?: string[]
  receptions?: { numero_reception: string; difference_mad: number; cloturee: boolean }[]
  avis?: string[]
}

/** Ce qu'on tape pour une ligne : le reste se lit. */
interface Saisie {
  qte: string
  prix: string
  remise: string
}

const signe = (n: number) => `${n > 0 ? '+' : ''}${fmt.nombre(n, 2)}`

/** L'empreinte du document a l'ecran : elle dit s'il a change. */
const signature = (e: Record<string, string>, c: Record<string, Saisie>) =>
  JSON.stringify([e, Object.entries(c).sort(([a], [b]) => a.localeCompare(b))])

/* UNE PESEE, UNE RANGEE (24/10/2026). « Les champs de rapprochement sur la meme
   ligne que la ligne de reception ; quand il coche, il active la saisie, sinon
   desactive et vide les champs. » Au-dela de 58rem de carte, tout tient sur une
   rangee alignee sous les intitules ; en dessous, la saisie passe sur la
   rangee « ↳ », chaque case avec son intitule. */
const GRILLE =
  '@min-[58rem]:grid @min-[58rem]:grid-cols-[1rem_minmax(9rem,1fr)_5.5rem_5.5rem_6.5rem_6rem_4rem_6.5rem_7.5rem] @min-[58rem]:items-center @min-[58rem]:gap-x-2.5'

/** Une rangee du tableau : la pesee proposee et, cochee, sa ligne de facture. */
interface Rangee {
  id: string
  /** La pesee telle que la liste « a facturer » la rend (brouillon seulement). */
  candidate: Candidate | null
  /** La ligne de facture : calculee a l'ecran (cochee) ou relue (facture figee). */
  ligne: LigneLue | null
}

function RangeeFacture({
  rangee,
  saisie,
  modifiable,
  devise,
  basculer,
  poser,
}: {
  rangee: Rangee
  saisie: Saisie | undefined
  modifiable: boolean
  devise: string
  basculer: (c: Pick<Candidate, 'id_ligne_reception' | 'quantite_stock_kg' | 'prix_kg_devise'>) => void
  poser: (idLigne: string, champ: keyof Saisie, v: string) => void
}) {
  const { id, candidate: c, ligne: l } = rangee
  const coche = !!saisie
  const numero = c?.numero_reception ?? l?.numero_reception ?? ''
  const reference = c?.code_reference ?? l?.code_reference ?? ''
  const designation = c?.designation ?? l?.designation ?? null
  const bc = c?.numero_bc ?? l?.numero_bc ?? null
  const pesee = c?.quantite_stock_kg ?? l?.quantite_pesee_kg ?? 0
  const engage = c ? c.prix_kg_devise : l?.prix_engage_devise
  const precisions = [
    c?.lot_fournisseur ? `lot ${c.lot_fournisseur}` : null,
    bc,
    c?.dossier_numero ? `dossier ${c.dossier_numero}` : null,
  ].filter(Boolean)
  const horsQte = !!l && Math.abs(l.ecart_quantite_kg) > 0.001
  const horsPrix = !!l && l.ecart_prix_pct != null && l.ecart_prix_pct !== 0
  // La saisie : une case a la largeur de ce qu'elle attend, la valeur a droite.
  const champ = (cle: keyof Saisie, prefixe: string, intitule: string, largeur: string) => (
    <label className="flex items-center gap-1.5">
      <span className="text-[11px] text-attenue-texte @min-[58rem]:hidden">{intitule}</span>
      {modifiable ? (
        <Champ
          id={`${prefixe}-${id}`}
          inputMode="decimal"
          aria-label={`${intitule} — ${reference} de ${numero}`}
          className={cn('h-8 text-right tabular-nums @min-[58rem]:w-full', largeur)}
          value={saisie?.[cle] ?? ''}
          disabled={!coche}
          onChange={(e) => poser(id, cle, e.target.value)}
        />
      ) : (
        <span className="w-full text-right">
          {cle === 'qte'
            ? fmt.nombre(l?.quantite_facturee_kg ?? 0, 2)
            : cle === 'prix'
              ? fmt.nombre(l?.prix_kg_devise ?? 0, 4)
              : l?.remise_pct
                ? fmt.nombre(l.remise_pct, 2)
                : '—'}
        </span>
      )}
    </label>
  )
  return (
    <li
      className={cn(
        'flex flex-col gap-1 px-3 py-1.5 text-[13px] tabular-nums',
        GRILLE,
        modifiable && !coche && 'text-attenue-texte',
      )}
    >
      <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 @min-[58rem]:contents">
        {modifiable ? (
          <input
            type="checkbox"
            checked={coche}
            onChange={() =>
              basculer({
                id_ligne_reception: id,
                quantite_stock_kg: pesee,
                prix_kg_devise: engage,
              })
            }
            aria-label={`Facturer ${reference} de ${numero}`}
          />
        ) : (
          <span />
        )}
        <div className="min-w-0" title={designation ?? undefined}>
          <div className="truncate">
            <span className="font-medium">{reference}</span>
            <span className="text-attenue-texte"> · {numero}</span>
          </div>
          {precisions.length > 0 && (
            <div className="truncate text-[11px] text-attenue-texte">{precisions.join(' · ')}</div>
          )}
        </div>
        <span className="text-right">
          {fmt.nombre(pesee, 2)}
          <span className="text-[11px] text-attenue-texte @min-[58rem]:hidden"> kg pesés</span>
        </span>
        <span className="text-right">
          <span className="text-[11px] text-attenue-texte @min-[58rem]:hidden">engagé </span>
          {engage != null ? fmt.nombre(engage, 4) : '—'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[1.625rem] @min-[58rem]:contents">
        <span className="text-attenue-texte @min-[58rem]:hidden" aria-hidden>
          ↳
        </span>
        {champ('qte', 'q', 'Facturé kg', 'w-[6.5rem]')}
        {champ('prix', 'p', `Prix ${devise}/kg`, 'w-[6rem]')}
        {champ('remise', 'r', 'Remise %', 'w-[4rem]')}
        <span className="text-right font-medium">
          {l?.montant_devise != null ? `${fmt.nombre(l.montant_devise, 2)}` : ''}
          {l?.montant_devise != null && (
            <span className="text-[11px] font-normal text-attenue-texte @min-[58rem]:hidden"> {devise}</span>
          )}
        </span>
        {/* LES ECARTS : le chiffre, sa couleur et ce qu'il mesure. */}
        <span className="flex flex-col text-[11.5px] leading-tight">
          {horsQte && (
            <span className="font-medium text-alerte" title="Facturé moins pesé">
              {signe(l!.ecart_quantite_kg)} kg
            </span>
          )}
          {horsPrix && (
            <span
              className={cn('font-medium', l!.ecart_prix_pct! > 0 ? 'text-alerte' : 'text-succes')}
              title={`Prix ${fmt.nombre(l!.prix_kg_devise ?? 0, 4)} / engagé ${fmt.nombre(l!.prix_engage_devise ?? 0, 4)}`}
            >
              {l!.ecart_prix_pct! > 0 ? '+' : ''}
              {fmt.nombre(l!.ecart_prix_pct!, 2)} % prix
            </span>
          )}
          {l && !horsQte && !horsPrix && <span className="text-attenue-texte">conforme</span>}
        </span>
      </div>
    </li>
  )
}

export function FactureFournisseur() {
  const { id = '' } = useParams()
  const nouvelle = id === 'nouvelle'
  const droits = useDroits(MODULE)
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const confirmation = useConfirmation()

  const [entete, setEntete] = useState({
    numero_facture: '',
    code_fournisseur: '',
    date_facture: new Date().toISOString().slice(0, 10),
    code_devise: '',
    taux: '',
    montant: '',
    frais: '',
    nette: '' as '' | '1' | '0',
    notes: '',
  })
  const [choisies, setChoisies] = useState<Record<string, Saisie>>({})
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [confirmerTaux, setConfirmerTaux] = useState(false)
  /* CE QUE LE DOCUMENT VALAIT A SON OUVERTURE (regle d'ecran du 10/10) : le
     bouton Enregistrer ne s'offre que s'il y a quelque chose a enregistrer. */
  const [initiale, setInitiale] = useState<string | null>(null)

  const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  const qFrs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: ({ signal }) =>
      api.get<{ code_fournisseur: string; nom: string; code_devise?: string | null }[]>(
        '/api/fournisseurs?actif=1&limite=500',
        { signal },
      ),
  })

  const qFacture = useQuery({
    queryKey: ['facture-fournisseur', id],
    queryFn: ({ signal }) =>
      api.get<{ entete: Entete; lignes: LigneLue[] }>(`/api/factures-fournisseur/${id}`, { signal }),
    enabled: !nouvelle,
    // Un brouillon en cours de saisie ne se relit pas sous les doigts : la
    // version relue passerait pour celle de la saisie et le verrou ne verrait
    // plus l'ecriture concurrente.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const lue = qFacture.data
  const statut = lue?.entete.statut ?? 'BROUILLON'
  const modifiable = statut === 'BROUILLON' && droits.peutEcrire
  /* LA GARDE DE SAISIE : un brouillon commence ne se perd pas d'un clic. Une
     facture nouvelle n'arme la garde qu'une fois quelque chose saisi. */
  const sigCourante = signature(entete, choisies)
  const touche = nouvelle
    ? entete.numero_facture.trim() !== '' || entete.code_fournisseur !== '' || Object.keys(choisies).length > 0
    : initiale !== null && sigCourante !== initiale
  const quitter = useGardeSaisie(modifiable && touche)

  // L'en-tete relu entre dans la saisie, une fois.
  useEffect(() => {
    if (!lue) return
    const e = lue.entete
    setEntete({
      numero_facture: e.numero_facture,
      code_fournisseur: e.code_fournisseur,
      date_facture: e.date_facture?.slice(0, 10) ?? '',
      code_devise: e.code_devise,
      taux: versSaisie(e.taux_change),
      montant: versSaisie(e.montant_devise),
      frais: e.frais_devise ? versSaisie(e.frais_devise) : '',
      nette: e.facture_nette == null ? '' : e.facture_nette === 1 ? '1' : '0',
      notes: e.notes ?? '',
    })
    const lignes = Object.fromEntries(
      lue.lignes.map((l) => [
        l.id_ligne_reception,
        {
          qte: versSaisie(l.quantite_facturee_kg),
          prix: versSaisie(l.prix_kg_devise),
          remise: l.remise_pct ? versSaisie(l.remise_pct) : '',
        },
      ]),
    )
    setChoisies(lignes)
    setInitiale(
      signature(
        {
          numero_facture: e.numero_facture,
          code_fournisseur: e.code_fournisseur,
          date_facture: e.date_facture?.slice(0, 10) ?? '',
          code_devise: e.code_devise,
          taux: versSaisie(e.taux_change),
          montant: versSaisie(e.montant_devise),
          frais: e.frais_devise ? versSaisie(e.frais_devise) : '',
          nette: e.facture_nette == null ? '' : e.facture_nette === 1 ? '1' : '0',
          notes: e.notes ?? '',
        },
        lignes,
      ),
    )
  }, [lue?.entete.id_facture, lue])

  const fournisseur = entete.code_fournisseur
  const devise =
    entete.code_devise ||
    qFrs.data?.find((f) => f.code_fournisseur === fournisseur)?.code_devise ||
    'MAD'
  const enDevise = devise !== 'MAD'

  // CE QUI ATTEND SA FACTURE chez ce fournisseur, dans cette devise.
  const qCandidates = useQuery({
    queryKey: ['factures-a-facturer', fournisseur, devise, nouvelle ? '' : id],
    queryFn: ({ signal }) =>
      api.get<Candidate[]>(
        `/api/factures-fournisseur/a-facturer?fournisseur=${encodeURIComponent(fournisseur)}` +
          `&devise=${encodeURIComponent(devise)}` +
          // `sauf` : ce brouillon-ci, pour que ses propres lignes restent dans
          // la liste a cocher quand on le reouvre.
          (nouvelle ? '' : `&sauf=${encodeURIComponent(id)}`),
        { signal },
      ),
    enabled: !!fournisseur && modifiable,
  })

  // Le cours de reference du jour, propose pour le taux.
  const qTaux = useQuery({
    queryKey: ['taux-reference', devise, entete.date_facture],
    queryFn: ({ signal }) =>
      api.get<{ reference: number | null; source: string | null }>(
        `/api/import/taux-reference?devise=${encodeURIComponent(devise)}&date=${entete.date_facture}`,
        { signal },
      ),
    enabled: enDevise && !!entete.date_facture,
  })
  useEffect(() => {
    if (enDevise && !entete.taux && qTaux.data?.reference) {
      setEntete((e) => ({ ...e, taux: versSaisie(qTaux.data!.reference) }))
    }
  }, [qTaux.data?.reference, enDevise, entete.taux])

  /* Les lignes affichees : celles du document quand il existe, sinon les
     candidates cochees. Une facture validee ne montre que ses lignes. */
  const candidates = useMemo(() => qCandidates.data ?? [], [qCandidates.data])
  const rapprochees: LigneLue[] = useMemo(() => {
    if (!modifiable && lue) return lue.lignes
    // En brouillon, on calcule le rapprochement a l'ecran : il doit se lire
    // AVANT d'enregistrer, sinon on coche a l'aveugle.
    return Object.entries(choisies).flatMap(([idLigne, s]) => {
      const c = candidates.find((x) => x.id_ligne_reception === idLigne)
      const dejaLue = lue?.lignes.find((x) => x.id_ligne_reception === idLigne)
      const base = c ?? null
      const qte = lireNombre(s.qte) ?? 0
      const prix = lireNombre(s.prix) ?? 0
      const remise = lireNombre(s.remise) ?? 0
      const pesee = base?.quantite_stock_kg ?? dejaLue?.quantite_pesee_kg ?? 0
      const engage = base?.prix_kg_devise ?? dejaLue?.prix_engage_devise
      return [
        {
          id_ligne: idLigne,
          ligne_numero: 0,
          id_ligne_reception: idLigne,
          numero_reception: base?.numero_reception ?? dejaLue?.numero_reception ?? '',
          code_reference: base?.code_reference ?? dejaLue?.code_reference ?? '',
          designation: base?.designation ?? dejaLue?.designation ?? null,
          numero_bc: base?.numero_bc ?? dejaLue?.numero_bc ?? null,
          quantite_facturee_kg: qte,
          quantite_pesee_kg: pesee,
          ecart_quantite_kg: qte - pesee,
          prix_kg_devise: prix,
          prix_engage_devise: engage,
          ecart_prix_devise: engage != null ? prix - engage : undefined,
          ecart_prix_pct: engage ? ((prix - engage) * 100) / engage : undefined,
          remise_pct: remise,
          montant_devise: Number((qte * prix * (1 - remise / 100)).toFixed(2)),
          provisoire_mad: base?.provisoire_mad ?? dejaLue?.provisoire_mad,
        },
      ]
    })
  }, [choisies, candidates, lue, modifiable])

  /* LES RANGEES DU TABLEAU. En brouillon : chaque pesee a facturer (les lignes
     de ce brouillon comprises, par `sauf`), sa ligne de facture a cote quand
     elle est cochee ; une ligne deja sur la facture que la liste ne rend plus
     reste en fin de tableau, cochee. Facture figee : ses lignes seules. */
  const rangees: Rangee[] = useMemo(() => {
    const parId = new Map(rapprochees.map((l) => [l.id_ligne_reception, l]))
    if (!modifiable) return rapprochees.map((l) => ({ id: l.id_ligne_reception, candidate: null, ligne: l }))
    const proposees = new Set(candidates.map((c) => c.id_ligne_reception))
    return [
      ...candidates.map((c) => ({
        id: c.id_ligne_reception,
        candidate: c,
        ligne: parId.get(c.id_ligne_reception) ?? null,
      })),
      ...rapprochees
        .filter((l) => !proposees.has(l.id_ligne_reception))
        .map((l) => ({ id: l.id_ligne_reception, candidate: null, ligne: l })),
    ]
  }, [rapprochees, candidates, modifiable])

  const totalLignes = rapprochees.reduce((s, l) => s + (l.montant_devise ?? 0), 0)
  const fraisSaisis = lireNombre(entete.frais) ?? 0
  const imprime = lireNombre(entete.montant)
  const ecartImprime = imprime != null && imprime > 0 ? imprime - totalLignes - fraisSaisis : 0

  const corps = () => ({
    numero_facture: entete.numero_facture.trim(),
    code_fournisseur: fournisseur,
    date_facture: entete.date_facture || undefined,
    code_devise: devise,
    taux_change: enDevise ? (lireNombre(entete.taux) ?? undefined) : undefined,
    montant_devise: imprime ?? undefined,
    frais_devise: fraisSaisis || undefined,
    facture_nette: entete.nette === '' ? undefined : entete.nette === '1',
    notes: entete.notes.trim() || undefined,
    confirmer_taux: confirmerTaux,
    lignes: Object.entries(choisies).map(([idLigne, s]) => ({
      id_ligne_reception: idLigne,
      quantite_facturee_kg: lireNombre(s.qte) ?? 0,
      prix_kg_devise: lireNombre(s.prix) ?? 0,
      remise_pct: lireNombre(s.remise) ?? undefined,
    })),
  })

  // L'identifiant du document, tire a l'ouverture : un second envoi du meme
  // formulaire rend le meme document (audit P3, 19/10/2026).
  const [idDocument] = useState(nouvelIdentifiant)
  const enregistrer = useMutation({
    mutationFn: async () => {
      if (nouvelle) {
        const r = await api.post<{ id_facture: string }>('/api/factures-fournisseur', { ...corps(), id_document: idDocument })
        return r.id_facture
      }
      await api.patch(`/api/factures-fournisseur/${id}`, { ...corps(), version: lue?.entete.version })
      return id
    },
    onSuccess: (idFacture) => {
      toast.success('Facture enregistrée', { description: 'Brouillon : rien n’est encore au CMUP.' })
      setApercu(null)
      void qc.invalidateQueries({ queryKey: ['factures-fournisseur'] })
      void qc.invalidateQueries({ queryKey: ['facture-fournisseur'] })
      if (nouvelle) naviguer(`/factures-fournisseur/${idFacture}`, { replace: true })
    },
    onError: echec,
  })

  const voir = useMutation({
    mutationFn: () => api.post<Apercu>(`/api/factures-fournisseur/${id}/valider`, { simuler: true }),
    onSuccess: setApercu,
    onError: echec,
  })

  const valider = useMutation({
    mutationFn: () => api.post<Apercu>(`/api/factures-fournisseur/${id}/valider`, { simuler: false }),
    onSuccess: (r) => {
      toast.success('Facture validée', {
        description: `${signe(r.au_stock_mad)} MAD au stock, ${signe(r.ecart_prix_mad)} en écart de prix${
          r.receptions_cloturees?.length ? ` · ${r.receptions_cloturees.join(', ')} clôturé(s)` : ''
        }.`,
      })
      void qc.invalidateQueries()
    },
    onError: echec,
  })

  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/factures-fournisseur/${id}?version=${lue?.entete.version ?? ''}`),
    onSuccess: () => {
      toast.success('Brouillon supprimé')
      void qc.invalidateQueries({ queryKey: ['factures-fournisseur'] })
      naviguer('/factures-fournisseur')
    },
    onError: echec,
  })

  const basculer = (c: Pick<Candidate, 'id_ligne_reception' | 'quantite_stock_kg' | 'prix_kg_devise'>) =>
    setChoisies((x) => {
      const copie = { ...x }
      if (copie[c.id_ligne_reception]) delete copie[c.id_ligne_reception]
      else
        copie[c.id_ligne_reception] = {
          // CE QUI EST ATTENDU SERT DE DEPART : les kilos peses et le prix
          // engage. On ne corrige que ce que le papier dit autrement.
          qte: versSaisie(c.quantite_stock_kg),
          prix: versSaisie(c.prix_kg_devise),
          remise: '',
        }
      setApercu(null)
      return copie
    })

  const poser = (idLigne: string, champ: keyof Saisie, v: string) => {
    setChoisies((x) => ({ ...x, [idLigne]: { ...x[idLigne], [champ]: v } }))
    setApercu(null)
  }

  if (!nouvelle && qFacture.isLoading) return <Chargement />
  if (!nouvelle && !lue) return <Alerte ton="danger">Facture introuvable.</Alerte>

  // Rien a enregistrer tant que rien n'a bouge : le bouton ne s'offre pas.
  const modifie = initiale === null || signature(entete, choisies) !== initiale
  // L'apercu decrit la facture ENREGISTREE : un changement a l'ecran le perime.
  const apercuValable = modifie ? null : apercu
  const raisonValidation = modifie
    ? 'Enregistrez d’abord : l’aperçu et la validation portent sur la facture enregistrée.'
    : !apercuValable
      ? 'Faites d’abord l’aperçu.'
      : null

  const complet =
    entete.numero_facture.trim() !== '' &&
    fournisseur !== '' &&
    Object.keys(choisies).length > 0 &&
    rapprochees.every((l) => l.quantite_facturee_kg > 0 && (l.prix_kg_devise ?? 0) > 0)

  return (
    <div>
      <EnTetePage
        titre={nouvelle ? 'Nouvelle facture fournisseur' : `Facture ${lue!.entete.numero_facture}`}
        description={
          nouvelle
            ? 'Cochez les pesées que la facture couvre, corrigez ce que le papier dit, et le rapprochement se lit en face.'
            : `${lue!.entete.fournisseur_nom} · ${fmt.date(lue!.entete.date_facture)}${
                lue!.entete.dossier_numero ? ` · dossier ${lue!.entete.dossier_numero}` : ''
              }`
        }
        actions={
          <div className="flex items-center gap-2">
            {!nouvelle && <Badge ton={TON_STATUT[statut] ?? 'neutre'}>{LIBELLE_STATUT[statut] ?? statut}</Badge>}
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/factures-fournisseur'))}>
              <ArrowLeft />
              Retour
            </Bouton>
          </div>
        }
      />

      {statut === 'VALIDEE' && (
        <Alerte ton="succes" className="mb-3">
          Facture validée{lue!.entete.valide_par ? ` par ${lue!.entete.valide_par}` : ''} : la valeur
          définitive est au stock. Une correction passe par un avoir ou une facture complémentaire
          sur l’arrivage.
        </Alerte>
      )}

      <div className="space-y-3">
        <Carte repliable="facture.1">
          <CarteEntete>
            <CarteTitre>En-tête</CarteTitre>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Etiq obligatoire htmlFor="f-numero">N° de facture</Etiq>
              <Champ
                id="f-numero"
                value={entete.numero_facture}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, numero_facture: e.target.value })}
              />
            </div>
            <div>
              <Etiq obligatoire htmlFor="f-frs">Fournisseur</Etiq>
              <Selecteur
                id="f-frs"
                value={fournisseur}
                disabled={!modifiable || !nouvelle}
                onChange={(e) => {
                  setChoisies({})
                  setApercu(null)
                  setEntete({ ...entete, code_fournisseur: e.target.value, code_devise: '', taux: '' })
                }}
              >
                <option value="">— choisir —</option>
                {(qFrs.data ?? []).map((f) => (
                  <option key={f.code_fournisseur} value={f.code_fournisseur}>
                    {f.nom}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq htmlFor="f-date">Date de la facture</Etiq>
              <Champ
                id="f-date"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={entete.date_facture}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, date_facture: e.target.value })}
              />
            </div>
            <div>
              <Etiq>Devise</Etiq>
              <p className="pt-1.5 text-[13px] font-medium">{devise}</p>
            </div>
            {enDevise && (
              <div>
                <Etiq obligatoire htmlFor="f-taux">Taux {devise} → MAD</Etiq>
                <Champ
                  id="f-taux"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={entete.taux}
                  disabled={!modifiable}
                  onChange={(e) => setEntete({ ...entete, taux: e.target.value })}
                />
                <p className="mt-0.5 text-[11px] text-attenue-texte">
                  {qTaux.data?.source ? `Proposé : ${qTaux.data.source}` : 'Aucun cours de référence'}
                </p>
                {modifiable && (
                  <label className="mt-1 flex items-center gap-1.5 text-[11.5px]">
                    <input
                      type="checkbox"
                      checked={confirmerTaux}
                      onChange={(e) => setConfirmerTaux(e.target.checked)}
                    />
                    Confirmer ce taux (écart au cours accepté)
                  </label>
                )}
              </div>
            )}
            <div>
              <Etiq htmlFor="f-montant">
                Total imprimé ({devise})
                <Aide>
                  Ce que le papier annonce. Il contrôle la saisie des lignes, il ne la remplace
                  pas : l’écart se signale, il ne bloque pas.
                </Aide>
              </Etiq>
              <Champ
                id="f-montant"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={entete.montant}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, montant: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="f-frais">
                Frais portés par la facture ({devise})
                <Aide>
                  Ce que le fournisseur facture en plus de la marchandise. Les frais payés à
                  part — fret, douane, transitaire — se saisissent sur l’arrivage, avec leur clé.
                </Aide>
              </Etiq>
              <Champ
                id="f-frais"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={entete.frais}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, frais: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="f-nette">
                Kilos rendus
                <Aide>
                  Si des kilos ont été rendus au fournisseur : la facture porte-t-elle sur les
                  seuls kilos gardés (nette) ou sur toute la livraison (brute, un avoir suivra) ?
                </Aide>
              </Etiq>
              <Selecteur
                id="f-nette"
                value={entete.nette}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, nette: e.target.value as '' | '0' | '1' })}
              >
                <option value="">— aucun retour —</option>
                <option value="1">Facture nette (kilos gardés)</option>
                <option value="0">Facture brute (avoir à venir)</option>
              </Selecteur>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Etiq htmlFor="f-notes">Notes</Etiq>
              <Champ
                id="f-notes"
                value={entete.notes}
                disabled={!modifiable}
                placeholder="Ce qu’il faut savoir de cette facture"
                onChange={(e) => setEntete({ ...entete, notes: e.target.value })}
              />
            </div>
          </CarteCorps>
        </Carte>

        <Carte repliable="facture.2">
          <CarteEntete>
            <CarteTitre>
              {modifiable ? 'Ce que la facture couvre' : 'Lignes de la facture'}
              <Aide>
                Une rangée par pesée validée de ce fournisseur qu’aucune facture ne couvre. Cochée,
                elle part sur la facture : les kilos pesés et le prix engagé sont proposés, ne
                corrigez que ce que le papier dit autrement. Décochée, elle se vide et sort de la
                facture. Facturé contre pesé, facturé contre engagé : les deux écarts ne disent pas
                la même chose et aucun ne bloque — ils se lisent avant de signer.
              </Aide>
            </CarteTitre>
            {modifiable && (
              <span className="text-[12px] text-attenue-texte tabular-nums">
                {Object.keys(choisies).length} / {rangees.length} cochée(s)
              </span>
            )}
          </CarteEntete>
          <CarteCorps className="@container p-0">
            {modifiable && !fournisseur ? (
              <p className="px-4 py-6 text-center text-[13px] text-attenue-texte">
                Choisissez d’abord le fournisseur.
              </p>
            ) : modifiable && qCandidates.isLoading ? (
              <p className="px-4 py-6 text-center text-[13px] text-attenue-texte">Chargement…</p>
            ) : rangees.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-attenue-texte">
                {modifiable
                  ? `Rien n’attend de facture chez ce fournisseur en ${devise}.`
                  : 'Aucune ligne.'}
              </p>
            ) : (
              <>
                {/* Les intitules ne servent qu'a la rangee unique ; en ↳, chaque case porte le sien. */}
                <div
                  className={cn(
                    'hidden border-b border-bordure px-3 py-1.5 text-[11px] uppercase tracking-wider text-attenue-texte',
                    GRILLE,
                  )}
                  aria-hidden
                >
                  <span />
                  <span>Pesée</span>
                  <span className="text-right">Pesés kg</span>
                  <span className="text-right">Engagé /kg</span>
                  <span className="text-right">Facturé kg</span>
                  <span className="text-right">Prix /kg</span>
                  <span className="text-right">Remise %</span>
                  <span className="text-right">Montant</span>
                  <span>Écarts</span>
                </div>
                <ul className="divide-y divide-bordure">
                  {rangees.map((r) => (
                    <RangeeFacture
                      key={r.id}
                      rangee={r}
                      saisie={choisies[r.id]}
                      modifiable={modifiable}
                      devise={devise}
                      basculer={basculer}
                      poser={poser}
                    />
                  ))}
                </ul>
                {/* LE PIED : la somme des lignes contre le total imprime. */}
                <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 border-t border-bordure px-3 py-2 text-[12.5px] tabular-nums">
                  <span>
                    <span className="text-attenue-texte">Lignes </span>
                    <span className="font-medium">
                      {fmt.nombre(totalLignes, 2)} {devise}
                    </span>
                  </span>
                  {fraisSaisis > 0 && (
                    <span>
                      <span className="text-attenue-texte">+ frais </span>
                      {fmt.nombre(fraisSaisis, 2)}
                    </span>
                  )}
                  {imprime != null && imprime > 0 && (
                    <span>
                      <span className="text-attenue-texte">imprimé </span>
                      {fmt.nombre(imprime, 2)}
                      {Math.abs(ecartImprime) > 0.05 ? (
                        <span className="font-medium text-alerte"> · écart {signe(ecartImprime)}</span>
                      ) : (
                        <span className="text-succes"> · retombe juste</span>
                      )}
                    </span>
                  )}
                </div>
              </>
            )}
          </CarteCorps>
          {Math.abs(ecartImprime) > 0.05 && (
            <CarteCorps className="pt-0">
              <Alerte ton="alerte">
                Le total imprimé ({fmt.nombre(imprime ?? 0, 2)} {devise}) ne retombe pas sur la somme
                des lignes et des frais ({fmt.nombre(totalLignes + fraisSaisis, 2)}) :{' '}
                {signe(ecartImprime)}. Vérifiez la saisie — ce n’est pas bloquant.
              </Alerte>
            </CarteCorps>
          )}
        </Carte>

        {apercuValable && (
          <Carte>
            <CarteEntete>
              <CarteTitre>Ce que la validation va faire</CarteTitre>
            </CarteEntete>
            <CarteCorps className="space-y-2">
              {(apercuValable.avis?.length ?? 0) > 0 && (
                <Alerte ton="alerte" titre="À vérifier avant de signer">
                  <ul className="list-inside list-disc">
                    {apercuValable.avis!.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </Alerte>
              )}
              <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['Valeur provisoire', fmt.mad(apercuValable.valeur_provisoire_mad)],
                  ['Valeur facturée', fmt.mad(apercuValable.valeur_definitive_mad)],
                  ['Différence', signe(apercuValable.difference_mad)],
                  ['Au stock (CMUP)', signe(apercuValable.au_stock_mad)],
                  ['Écart de prix (tracé)', signe(apercuValable.ecart_prix_mad)],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-[11px] uppercase tracking-wider text-attenue-texte">{k}</dt>
                    <dd className="font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {(apercuValable.receptions?.length ?? 0) > 0 && (
                <p className="text-[12px] text-attenue-texte">
                  {apercuValable.receptions!.map((r) => `${r.numero_reception} (${signe(r.difference_mad)}${r.cloturee ? ', clôturé' : ', reste à facturer'})`).join(' · ')}
                </p>
              )}
            </CarteCorps>
          </Carte>
        )}
      </div>

      {/* LES ACTIONS EN BAS, dans l'ordre du geste : enregistrer, voir, signer. */}
      <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-2 border-t border-bordure bg-fond/95 py-2.5 backdrop-blur">
        {modifiable && (nouvelle || modifie) && (
          <Bouton
            chargement={enregistrer.isPending}
            disabled={!complet}
            onClick={() => enregistrer.mutate()}
          >
            <Save />
            Enregistrer
          </Bouton>
        )}
        {!nouvelle && statut === 'BROUILLON' && droits.peutValider && (
          <>
            <Bouton variante="contour" chargement={voir.isPending} disabled={modifie}
              title={modifie ? (raisonValidation ?? undefined) : undefined} onClick={() => voir.mutate()}>
              <Eye />
              Aperçu
            </Bouton>
            <Bouton
              variante={modifie ? 'contour' : 'principal'}
              disabled={!!raisonValidation}
              title={raisonValidation ?? undefined}
              chargement={valider.isPending}
              onClick={() =>
                confirmation.demander({
                  titre: 'Valider la facture',
                  description:
                    'La valeur définitive part au stock : le CMUP bouge et les arrivages entièrement facturés se clôturent. Une correction passera par un avoir.',
                  libelleConfirmer: 'Valider la facture',
                  action: () => valider.mutate(),
                })
              }
            >
              <FileCheck2 />
              Valider
            </Bouton>
          </>
        )}
        {!nouvelle && statut === 'BROUILLON' && droits.peutEcrire && (
          <Bouton
            variante="discret"
            onClick={() =>
              confirmation.demander({
                titre: 'Supprimer ce brouillon',
                description: 'Rien n’est encore au CMUP : le brouillon disparaît.',
                destructif: true,
                libelleConfirmer: 'Supprimer',
                action: () => supprimer.mutate(),
              })
            }
          >
            <Trash2 />
            Supprimer le brouillon
          </Bouton>
        )}
        <span className="ml-auto text-[12px] text-attenue-texte">
          {/* LA RAISON D'UN BOUTON GRISE, ECRITE : on ne la cherche pas au survol. */}
          {statut === 'BROUILLON' && !nouvelle && droits.peutValider && raisonValidation && (
            <span className="text-alerte">{raisonValidation} </span>
          )}
          {statut === 'BROUILLON'
            ? 'Brouillon : rien n’est au CMUP avant la validation.'
            : 'Document figé.'}
        </span>
      </div>
      {confirmation.element}
    </div>
  )
}

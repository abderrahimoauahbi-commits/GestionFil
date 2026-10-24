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
import { lireNombre } from '../lib/nombres'
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
      taux: String(e.taux_change ?? ''),
      montant: e.montant_devise != null ? String(e.montant_devise) : '',
      frais: e.frais_devise ? String(e.frais_devise) : '',
      nette: e.facture_nette == null ? '' : e.facture_nette === 1 ? '1' : '0',
      notes: e.notes ?? '',
    })
    const lignes = Object.fromEntries(
      lue.lignes.map((l) => [
        l.id_ligne_reception,
        {
          qte: String(l.quantite_facturee_kg),
          prix: l.prix_kg_devise != null ? String(l.prix_kg_devise) : '',
          remise: l.remise_pct ? String(l.remise_pct) : '',
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
          taux: String(e.taux_change ?? ''),
          montant: e.montant_devise != null ? String(e.montant_devise) : '',
          frais: e.frais_devise ? String(e.frais_devise) : '',
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
      setEntete((e) => ({ ...e, taux: String(qTaux.data!.reference) }))
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

  const basculer = (c: Candidate) =>
    setChoisies((x) => {
      const copie = { ...x }
      if (copie[c.id_ligne_reception]) delete copie[c.id_ligne_reception]
      else
        copie[c.id_ligne_reception] = {
          // CE QUI EST ATTENDU SERT DE DEPART : les kilos peses et le prix
          // engage. On ne corrige que ce que le papier dit autrement.
          qte: String(c.quantite_stock_kg),
          prix: c.prix_kg_devise != null ? String(c.prix_kg_devise) : '',
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

        {modifiable && (
          <Carte repliable="facture.2">
            <CarteEntete>
              <CarteTitre>
                Ce qui attend sa facture
                <Aide>
                  Les pesées validées de ce fournisseur qu’aucune facture ne couvre. Les kilos et
                  le prix proposés sont ceux du quai et du bon : ne corrigez que ce que le papier
                  dit autrement.
                </Aide>
              </CarteTitre>
              <span className="text-[12px] text-attenue-texte tabular-nums">
                {Object.keys(choisies).length} / {candidates.length} cochée(s)
              </span>
            </CarteEntete>
            <CarteCorps className="p-0">
              {!fournisseur ? (
                <p className="px-4 py-6 text-center text-[13px] text-attenue-texte">
                  Choisissez d’abord le fournisseur.
                </p>
              ) : candidates.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-attenue-texte">
                  Rien n’attend de facture chez ce fournisseur en {devise}.
                </p>
              ) : (
                <ul className="divide-y divide-bordure">
                  {candidates.map((c) => {
                    const coche = !!choisies[c.id_ligne_reception]
                    return (
                      <li key={c.id_ligne_reception} className="px-3 py-2">
                        <label className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={coche}
                            onChange={() => basculer(c)}
                            aria-label={`Facturer ${c.code_reference} de ${c.numero_reception}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                              <span className="font-medium">{c.code_reference}</span>
                              <span className="text-attenue-texte">{c.numero_reception}</span>
                              {c.numero_bc && (
                                <span className="rounded-[var(--radius-sm)] bg-attenue px-1.5 py-0.5 text-[11px] text-attenue-texte">
                                  {c.numero_bc}
                                </span>
                              )}
                            </div>
                            <div className="text-[11.5px] text-attenue-texte tabular-nums">
                              ↳ {fmt.nombre(c.quantite_stock_kg, 2)} kg pesés
                              {c.prix_kg_devise != null &&
                                ` · engagé ${fmt.nombre(c.prix_kg_devise, 4)} ${c.code_devise}/kg`}
                              {c.lot_fournisseur ? ` · lot ${c.lot_fournisseur}` : ''}
                              {c.dossier_numero ? ` · dossier ${c.dossier_numero}` : ''}
                            </div>
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CarteCorps>
          </Carte>
        )}

        <Carte repliable="facture.3">
          <CarteEntete>
            <CarteTitre>
              Rapprochement
              <Aide>
                Facturé contre pesé, facturé contre engagé. Les deux écarts ne disent pas la même
                chose et aucun ne bloque — ils se lisent avant de signer.
              </Aide>
            </CarteTitre>
            <span className="text-[13px] font-medium tabular-nums">
              {fmt.nombre(totalLignes, 2)} {devise}
              {fraisSaisis > 0 && (
                <span className="text-attenue-texte"> + {fmt.nombre(fraisSaisis, 2)} de frais</span>
              )}
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            {rapprochees.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-attenue-texte">
                Aucune ligne. Cochez ce que la facture couvre.
              </p>
            ) : (
              <ul className="divide-y divide-bordure">
                {rapprochees.map((l) => {
                  const s = choisies[l.id_ligne_reception]
                  const horsQte = Math.abs(l.ecart_quantite_kg) > 0.001
                  const horsPrix = (l.ecart_prix_pct ?? 0) !== 0
                  return (
                    <li key={l.id_ligne_reception} className="px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                        <span className="font-medium">{l.code_reference}</span>
                        <span className="text-attenue-texte">{l.numero_reception}</span>
                        {l.numero_bc && (
                          <span className="text-[11px] text-attenue-texte">{l.numero_bc}</span>
                        )}
                        {modifiable && (
                          <button
                            type="button"
                            onClick={() =>
                              setChoisies((x) => {
                                const c = { ...x }
                                delete c[l.id_ligne_reception]
                                return c
                              })
                            }
                            aria-label={`Retirer ${l.code_reference}`}
                            className="ml-auto text-attenue-texte transition-colors hover:text-danger"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>

                      {modifiable && s ? (
                        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                          <div>
                            <Etiq htmlFor={`q-${l.id_ligne_reception}`}>Quantité facturée (kg)</Etiq>
                            <Champ
                              id={`q-${l.id_ligne_reception}`}
                              inputMode="decimal"
                              className="h-9 text-right tabular-nums"
                              value={s.qte}
                              onChange={(e) => poser(l.id_ligne_reception, 'qte', e.target.value)}
                            />
                          </div>
                          <div>
                            <Etiq htmlFor={`p-${l.id_ligne_reception}`}>Prix facturé ({devise}/kg)</Etiq>
                            <Champ
                              id={`p-${l.id_ligne_reception}`}
                              inputMode="decimal"
                              className="h-9 text-right tabular-nums"
                              value={s.prix}
                              onChange={(e) => poser(l.id_ligne_reception, 'prix', e.target.value)}
                            />
                          </div>
                          <div>
                            <Etiq htmlFor={`r-${l.id_ligne_reception}`}>Remise (%)</Etiq>
                            <Champ
                              id={`r-${l.id_ligne_reception}`}
                              inputMode="decimal"
                              className="h-9 text-right tabular-nums"
                              value={s.remise}
                              onChange={(e) => poser(l.id_ligne_reception, 'remise', e.target.value)}
                            />
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[12px] tabular-nums">
                        <span className="text-attenue-texte">
                          ↳ {fmt.nombre(l.quantite_facturee_kg, 2)} kg facturés / {fmt.nombre(l.quantite_pesee_kg, 2)} pesés
                        </span>
                        {horsQte && (
                          <span className={cn('font-medium', 'text-alerte')}>
                            {signe(l.ecart_quantite_kg)} kg
                          </span>
                        )}
                        {l.prix_engage_devise != null && (
                          <span className="text-attenue-texte">
                            prix {fmt.nombre(l.prix_kg_devise ?? 0, 4)} / engagé{' '}
                            {fmt.nombre(l.prix_engage_devise, 4)}
                          </span>
                        )}
                        {horsPrix && l.ecart_prix_pct != null && (
                          <span
                            className={cn(
                              'font-medium',
                              l.ecart_prix_pct > 0 ? 'text-alerte' : 'text-succes',
                            )}
                          >
                            {l.ecart_prix_pct > 0 ? '+' : ''}
                            {fmt.nombre(l.ecart_prix_pct, 2)} %
                          </span>
                        )}
                        {l.montant_devise != null && (
                          <span className="ml-auto font-medium">
                            {fmt.nombre(l.montant_devise, 2)} {devise}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
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

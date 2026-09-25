/**
 * L'ecran d'une facture du dossier — ajout et modification.
 *
 * De haut en bas : l'en-tete de la facture, ses lignes (chacune dit de quel bon
 * de commande elle vient, s'il y en a un) avec la part de frais qu'elle porte,
 * puis les totaux, compares a ce qui est imprime sur la facture.
 *
 * ENREGISTREMENT GLOBAL. On saisit l'en-tete et les lignes, puis on enregistre
 * le tout : une faute de frappe dans une cellule n'est pas deja en base au
 * moment ou l'on s'en apercoit.
 *
 * UNE LIGNE DEJA RECUE EST FIGEE : elle est entree en stock a ce prix. La
 * changer apres coup ferait diverger la facture du stock sans que rien ne le
 * dise ; on solde, on ne corrige pas.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Lock,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
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
import { ChampReference } from '../../composants/ChampReference'
import { cn, fmt } from '../../lib/utils'
import {
  type Conditionnement,
  depuisBobines,
  depuisKg,
  depuisPalettes,
  pourChamp,
} from '../../lib/conditionnement'
import { echec, nombre, useRafraichir } from './dialogues'
import { UNITE, type DossierComplet, type Ligne } from './types'

const MODULE = 'IMPORT'
const th = 'px-1.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte'
const td = 'px-1.5 py-1'
const champ = 'h-7 px-1.5 text-[12.5px]'

interface RefCatalogue {
  code_reference: string
  designation: string
  code_fournisseur: string
  code_couleur?: string | null
  couleur?: string | null
  /** Le conditionnement : ce qui relie le poids net aux bobines et palettes. */
  poids_bobine_kg?: number | null
  bobines_par_palette?: number | null
  densite_kg_ml?: number | null
}

interface LigneBcOuverte {
  id_ligne_bc: string
  numero_bc: string
  ligne_numero: number
  code_reference: string
  quantite_restante_kg: number
  prix_kg_devise: number
}

/** Une ligne telle qu'on la saisit : des chaines, comme les champs. */
interface LigneEdit {
  cle: string
  id_ligne?: string
  type_ligne: 'ERP' | 'HORS_ERP'
  code_reference: string
  libelle: string
  id_ligne_bc: string
  numero_bc: string
  lot_fournisseur: string
  code_couleur: string
  libelle_couleur: string
  unite: 'kg' | 'ml' | 'piece'
  poids_net_kg: string
  quantite: string
  nb_bobines: string
  nb_palettes: string
  /**
   * LE CALCUL EST-IL LIE SUR CETTE LIGNE ?
   *
   * Lie, poids net, bobines et palettes se repondent par les parametres de la
   * reference. Detache, chacun se saisit seul — parce que c'est la FACTURE du
   * fournisseur qu'on recopie : si elle annonce 3 palettes pour un poids qui
   * n'en fait que 2,7, c'est elle qui fait foi, et l'ecart se discute.
   */
  prix_unitaire_devise: string
  supprimee: boolean
  recue: boolean
}

const texte = (v: unknown) => (v == null ? '' : String(v))

function versEdition(l: Ligne): LigneEdit {
  return {
    cle: l.id_ligne,
    id_ligne: l.id_ligne,
    type_ligne: l.type_ligne,
    code_reference: texte(l.code_reference),
    libelle: l.type_ligne === 'HORS_ERP' ? texte(l.designation) : '',
    id_ligne_bc: texte(l.id_ligne_bc),
    numero_bc: texte(l.numero_bc),
    lot_fournisseur: texte(l.lot_fournisseur),
    code_couleur: texte(l.code_couleur),
    libelle_couleur: texte(l.libelle_couleur),
    unite: l.unite,
    poids_net_kg: texte(l.poids_net_kg),
    quantite: texte(l.quantite),
    nb_bobines: texte(l.nb_bobines),
    nb_palettes: texte(l.nb_palettes),
    // Une ligne deja enregistree garde ses comptes tels quels : les relier les
    // recalculerait en silence, alors qu'ils viennent de la facture.
    prix_unitaire_devise: texte(l.prix_unitaire_devise),
    supprimee: false,
    recue: l.quantite_recue_kg > 0,
  }
}

let compteur = 0
function ligneVide(type: 'ERP' | 'HORS_ERP' = 'ERP'): LigneEdit {
  compteur += 1
  return {
    cle: `n-${compteur}`, type_ligne: type, code_reference: '', libelle: '', id_ligne_bc: '', numero_bc: '',
    lot_fournisseur: '', code_couleur: '', libelle_couleur: '', unite: type === 'ERP' ? 'kg' : 'piece', poids_net_kg: '', quantite: '',
    nb_bobines: '', nb_palettes: '', prix_unitaire_devise: '', supprimee: false, recue: false,
  }
}

/** La quantite qui multiplie le prix : le poids net quand on facture au kg. */
const quantiteFacturee = (l: LigneEdit) =>
  l.type_ligne === 'ERP' && l.unite === 'kg' ? nombre(l.poids_net_kg) : nombre(l.quantite)
const montantLigne = (l: LigneEdit) => Math.round(quantiteFacturee(l) * nombre(l.prix_unitaire_devise) * 100) / 100
const ligneComplete = (l: LigneEdit) =>
  l.type_ligne === 'ERP'
    ? !!l.code_reference && nombre(l.poids_net_kg) > 0 && nombre(l.prix_unitaire_devise) > 0 &&
      (l.unite === 'kg' || nombre(l.quantite) > 0)
    : !!l.libelle.trim() && nombre(l.quantite) > 0 && nombre(l.prix_unitaire_devise) > 0

function corpsLigne(l: LigneEdit) {
  const erp = l.type_ligne === 'ERP'
  return {
    type_ligne: l.type_ligne,
    code_reference: erp ? l.code_reference : null,
    libelle: erp ? null : l.libelle.trim(),
    id_ligne_bc: erp ? l.id_ligne_bc : null,
    lot_fournisseur: l.lot_fournisseur,
    code_couleur: l.code_couleur,
    libelle_couleur: l.libelle_couleur,
    unite: erp ? l.unite : 'piece',
    quantite: erp && l.unite === 'kg' ? null : nombre(l.quantite),
    poids_net_kg: erp ? nombre(l.poids_net_kg) : null,
    nb_bobines: l.nb_bobines ? nombre(l.nb_bobines) : 0,
    nb_palettes: l.nb_palettes ? nombre(l.nb_palettes) : 0,
    prix_unitaire_devise: nombre(l.prix_unitaire_devise),
  }
}

export function FactureImport() {
  const { id: idDossier = '', idFacture = 'nouvelle' } = useParams()
  const nouvelle = idFacture === 'nouvelle'
  const droits = useDroits(MODULE)
  const ouvrir = useOuvrirVue()
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const rafraichir = useRafraichir(idDossier)
  const confirmation = useConfirmation()

  const q = useQuery({
    queryKey: ['import-dossier', idDossier],
    queryFn: () => api.get<DossierComplet>(`/api/import/dossiers/${idDossier}`),
    enabled: !!idDossier,
  })
  const d = q.data
  const facture = nouvelle ? null : d?.factures.find((f) => f.id_facture === idFacture) ?? null
  const lignesServeur = useMemo(
    () => (d?.lignes ?? []).filter((l) => l.id_facture === idFacture).sort((a, b) => a.ligne_numero - b.ligne_numero),
    [d, idFacture],
  )

  // ---- L'etat de saisie, recharge a chaque version du serveur -------------
  const enteteInitial = () => ({
    code_fournisseur: facture?.code_fournisseur ?? '',
    numero_facture: facture?.numero_facture ?? '',
    date_facture: facture?.date_facture?.slice(0, 10) ?? '',
    code_devise: facture?.code_devise ?? d?.dossier.code_devise ?? 'USD',
    taux_change: texte(facture?.taux_change ?? d?.dossier.taux_change ?? ''),
    montant_devise: texte(facture?.montant_devise),
    nb_palettes: texte(facture?.nb_palettes),
    nb_bobines: texte(facture?.nb_bobines),
  })
  const [entete, setEntete] = useState(enteteInitial)
  const [lignes, setLignes] = useState<LigneEdit[]>([])
  const [toutes, setToutes] = useState(false)
  const [ouverte, setOuverte] = useState<string | null>(null)
  useEffect(() => {
    if (!d) return
    setEntete(enteteInitial())
    const l = lignesServeur.map(versEdition)
    setLignes(nouvelle ? [ligneVide()] : l.length ? l : [ligneVide()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, idFacture])

  const clos = d?.dossier.statut === 'CLOTURE'
  const ecrire = droits.peutEcrire && !clos

  const qFournisseurs = useQuery({
    queryKey: ['fournisseurs-actifs'],
    queryFn: () => api.get<{ code_fournisseur: string; nom: string }[]>('/api/fournisseurs?actif=1&limite=500'),
  })
  const qDevises = useQuery({ queryKey: ['devises'], queryFn: () => api.get<{ code_devise: string }[]>('/api/devises') })
  const qBc = useQuery({
    queryKey: ['import-lignes-bc', entete.code_fournisseur],
    queryFn: () => api.get<LigneBcOuverte[]>(`/api/import/lignes-bc?fournisseur=${encodeURIComponent(entete.code_fournisseur)}`),
    enabled: !!entete.code_fournisseur,
  })

  /**
   * LES REFERENCES RETENUES SUR CETTE FACTURE, et elles seules.
   *
   * L'ecran chargeait le catalogue entier pour peupler un menu deroulant par
   * ligne — tenable a 124 references, intenable a mille. On tape desormais, le
   * serveur cherche, et l'on garde ce qu'on retient : c'est tout ce dont la
   * ligne a besoin pour connaitre sa couleur et son conditionnement.
   */
  const [refsRetenues, setRefsRetenues] = useState<Map<string, RefCatalogue>>(new Map())

  // ---- Modifications -------------------------------------------------------
  const majLigne = (cle: string, patch: Partial<LigneEdit>) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))

  /** Le conditionnement de la reference d'une ligne — vide si elle n'en porte pas. */
  const condDe = (code: string): Conditionnement => refsRetenues.get(code) ?? {}

  /**
   * POIDS NET, BOBINES ET PALETTES SE REPONDENT.
   *
   * Une facture d'import annonce souvent les trois, et ils doivent concorder :
   * c'est sur ce poids que se repartissent les frais d'approche, donc le cout
   * de revient. Saisir celui qu'on lit sur le document, voir les deux autres se
   * poser, et comparer avec ce que le document annonce — c'est la que se
   * reperent les erreurs de recopie.
   */
  const majColis = (l: LigneEdit, source: 'poids' | 'palettes' | 'bobines', valeur: string) => {
    const c = condDe(l.code_reference)
    const r =
      source === 'palettes'
        ? depuisPalettes(valeur, c)
        : source === 'bobines'
          ? depuisBobines(valeur, c)
          : depuisKg(valeur, c)
    majLigne(l.cle, {
      poids_net_kg: source === 'poids' ? valeur : r.kg !== null ? pourChamp(r.kg, 3) : l.poids_net_kg,
      nb_palettes: source === 'palettes' ? valeur : pourChamp(r.palettes),
      nb_bobines: source === 'bobines' ? valeur : pourChamp(r.bobines),
    })
  }
  const choisirReference = (l: LigneEdit, r: RefCatalogue) => {
    setRefsRetenues((m) => new Map(m).set(r.code_reference, r))
    majLigne(l.cle, {
      code_reference: r.code_reference, id_ligne_bc: '', numero_bc: '',
      code_couleur: r.code_couleur ?? l.code_couleur,
      libelle_couleur: r.couleur ?? l.libelle_couleur,
    })
  }
  // Choisir la ligne de BC reprend sa reference et son prix : c'est ce qui a
  // ete commande, la facture ne fait que le confirmer.
  const choisirBc = (l: LigneEdit, idBc: string) => {
    const b = qBc.data?.find((x) => x.id_ligne_bc === idBc)
    majLigne(l.cle, {
      id_ligne_bc: idBc,
      numero_bc: b?.numero_bc ?? '',
      code_reference: b ? b.code_reference : l.code_reference,
      prix_unitaire_devise: b && !l.prix_unitaire_devise ? String(b.prix_kg_devise) : l.prix_unitaire_devise,
    })
  }

  const enteteModifie = JSON.stringify(entete) !== JSON.stringify(enteteInitial())
  const lignesModifiees = lignes.filter((l) => {
    if (l.supprimee) return !!l.id_ligne
    if (!l.id_ligne) return ligneComplete(l)
    const o = lignesServeur.find((x) => x.id_ligne === l.id_ligne)
    return !!o && JSON.stringify(corpsLigne(versEdition(o))) !== JSON.stringify(corpsLigne(l))
  })
  const incompletes = lignes.filter((l) => !l.supprimee && !ligneComplete(l) && (l.id_ligne || l.code_reference || l.libelle || l.prix_unitaire_devise))
  const modifie = nouvelle || enteteModifie || lignesModifiees.length > 0
  const enteteComplet = entete.code_fournisseur && entete.numero_facture.trim() && entete.date_facture && nombre(entete.taux_change) > 0

  /** L'identifiant d'une facture creee pendant l'enregistrement en cours. */
  const creeeRef = useRef<string | null>(null)
  const enregistrer = useMutation({
    mutationFn: async () => {
      creeeRef.current = null
      const corpsEntete = {
        code_fournisseur: entete.code_fournisseur,
        numero_facture: entete.numero_facture.trim(),
        date_facture: entete.date_facture,
        code_devise: entete.code_devise,
        taux_change: nombre(entete.taux_change),
        montant_devise: entete.montant_devise ? nombre(entete.montant_devise) : null,
        nb_palettes: entete.nb_palettes ? nombre(entete.nb_palettes) : null,
        nb_bobines: entete.nb_bobines ? nombre(entete.nb_bobines) : null,
      }
      let id = idFacture
      if (nouvelle) {
        id = (await api.post<{ id_facture: string }>(`/api/import/dossiers/${idDossier}/factures`, corpsEntete)).id_facture
        creeeRef.current = id
      } else if (enteteModifie) {
        await api.patch(`/api/import/factures/${id}`, corpsEntete)
      }
      // Les suppressions d'abord : une ligne retiree ne doit pas bloquer le
      // controle des totaux des suivantes.
      for (const l of lignesModifiees.filter((x) => x.supprimee)) await api.delete(`/api/import/lignes/${l.id_ligne}`)
      for (const l of lignesModifiees.filter((x) => !x.supprimee)) {
        if (l.id_ligne) await api.patch(`/api/import/lignes/${l.id_ligne}`, corpsLigne(l))
        else await api.post(`/api/import/factures/${id}/lignes`, corpsLigne(l))
      }
      return id
    },
    onSuccess: (id) => {
      toast.success('Facture enregistrée — frais répartis')
      rafraichir()
      void qc.invalidateQueries({ queryKey: ['import-lignes-bc'] })
      if (nouvelle) naviguer(`/import/${idDossier}/factures/${id}`, { replace: true })
    },
    onError: (e) => {
      echec(e)
      rafraichir()
      // L'EN-TETE EST DEJA CREE si c'est une ligne qui a echoue. Rester sur
      // « nouvelle » ferait recreer la facture au prochain clic — et buter sur
      // son propre numero. On passe sur la facture creee, ou l'on corrige.
      if (nouvelle && creeeRef.current) naviguer(`/import/${idDossier}/factures/${creeeRef.current}`, { replace: true })
    },
  })

  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/import/factures/${idFacture}`),
    onSuccess: () => {
      toast.success('Facture supprimée')
      rafraichir()
      ouvrir(`/import/${idDossier}`)
    },
    onError: echec,
  })

  if (q.isLoading) return <Chargement texte="Lecture de la facture…" />
  if (!d) return <Alerte ton="alerte">Dossier introuvable.</Alerte>
  if (!nouvelle && !facture) return <Alerte ton="alerte">Facture introuvable dans ce dossier.</Alerte>

  // ---- Totaux et repartition -----------------------------------------------
  const visibles = lignes.filter((l) => !l.supprimee)
  const totalDevise = visibles.reduce((t, l) => t + montantLigne(l), 0)
  const taux = nombre(entete.taux_change)
  const totalPoids = visibles.reduce((t, l) => t + (l.type_ligne === 'ERP' ? nombre(l.poids_net_kg) : 0), 0)
  const totalBobines = visibles.reduce((t, l) => t + nombre(l.nb_bobines || 0), 0)
  const totalPalettes = visibles.reduce((t, l) => t + nombre(l.nb_palettes || 0), 0)
  const serveur = (cle: string) => lignesServeur.find((x) => x.id_ligne === cle)
  const coutVisible = lignesServeur.some((l) => l.frais_alloues_dhs !== undefined)
  const totalFrais = lignesServeur.reduce((t, l) => t + (l.frais_alloues_dhs ?? 0), 0)
  const totalValeur = lignesServeur.reduce((t, l) => t + l.valeur_achat_dhs, 0)
  const fraisInclus = d.frais.filter((f) => f.inclus_dans_cout === 1)
  const partDe = (idLigne: string, idFrais: string) =>
    d.repartition.find((a) => a.id_article_dossier === idLigne && a.id_ligne_frais === idFrais)
  const ecartMontant = entete.montant_devise !== '' && Math.abs(nombre(entete.montant_devise) - totalDevise) > 0.005
  const maj = (k: keyof typeof entete) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEntete((x) => ({ ...x, [k]: e.target.value }))

  return (
    <div className="space-y-3 pb-4">
      <EnTetePage
        titre={nouvelle ? 'Nouvelle facture' : `Facture ${facture!.numero_facture}`}
        description={`Dossier ${d.dossier.numero}${facture ? ` · ${facture.fournisseur_nom}` : ''}`}
        actions={
          <>
            <Bouton variante="contour" onClick={() => ouvrir(`/import/${idDossier}`)}>
              <ArrowLeft />
              Dossier {d.dossier.numero}
            </Bouton>
            {ecrire && (
              <Bouton disabled={!modifie || !enteteComplet || incompletes.length > 0} chargement={enregistrer.isPending}
                onClick={() => enregistrer.mutate()}>
                <Save />
                Enregistrer
              </Bouton>
            )}
          </>
        }
      />
      {clos && <Alerte ton="succes">Dossier clôturé : la facture est en lecture seule.</Alerte>}

      {/* ================= En-tete ============================================ */}
      <Carte>
        <CarteEntete>
          <CarteTitre>En-tête de la facture</CarteTitre>
          {facture && <Badge ton={facture.statut_reception === 'RECUE' ? 'succes' : facture.statut_reception === 'PARTIELLE' ? 'alerte' : 'neutre'}>
            {facture.statut_reception === 'RECUE' ? 'Reçue' : facture.statut_reception === 'PARTIELLE' ? 'Réception partielle' : 'Non reçue'}
          </Badge>}
        </CarteEntete>
        <CarteCorps>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2">
              <Etiq obligatoire>Fournisseur</Etiq>
              <Selecteur value={entete.code_fournisseur} onChange={maj('code_fournisseur')}
                disabled={!ecrire || lignesServeur.some((l) => l.quantite_recue_kg > 0)}>
                <option value="">Choisir…</option>
                {(qFournisseurs.data ?? []).map((x) => (
                  <option key={x.code_fournisseur} value={x.code_fournisseur}>{x.nom}</option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq obligatoire>N° de facture</Etiq>
              <Champ value={entete.numero_facture} onChange={maj('numero_facture')} disabled={!ecrire} placeholder="IHR2026000000243" />
            </div>
            <div>
              <Etiq obligatoire>Date</Etiq>
              <Champ type="date" value={entete.date_facture} onChange={maj('date_facture')} disabled={!ecrire} />
            </div>
            <div>
              <Etiq>Devise</Etiq>
              <Selecteur value={entete.code_devise} onChange={maj('code_devise')} disabled={!ecrire}>
                {(qDevises.data ?? [{ code_devise: entete.code_devise }]).map((x) => (
                  <option key={x.code_devise}>{x.code_devise}</option>
                ))}
              </Selecteur>
            </div>
            <div>
              <Etiq obligatoire>Taux de change</Etiq>
              <Champ inputMode="decimal" value={entete.taux_change} onChange={maj('taux_change')} disabled={!ecrire} />
            </div>
            <div>
              <Etiq>Montant imprimé ({entete.code_devise})</Etiq>
              <Champ inputMode="decimal" value={entete.montant_devise} onChange={maj('montant_devise')} disabled={!ecrire} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Etiq>Palettes</Etiq>
                <Champ inputMode="numeric" value={entete.nb_palettes} onChange={maj('nb_palettes')} disabled={!ecrire} />
              </div>
              <div>
                <Etiq>Bobines</Etiq>
                <Champ inputMode="numeric" value={entete.nb_bobines} onChange={maj('nb_bobines')} disabled={!ecrire} />
              </div>
            </div>
          </div>
        </CarteCorps>
      </Carte>

      {/* ================= Lignes ============================================= */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Lignes de la facture</CarteTitre>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11.5px] text-attenue-texte">
              <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} />
              toutes les références
            </label>
            {ecrire && (
              <>
                <Bouton taille="sm" variante="contour" onClick={() => setLignes((ls) => [...ls, ligneVide('HORS_ERP')])}>
                  <Plus />
                  Ligne hors ERP
                </Bouton>
                <Bouton taille="sm" onClick={() => setLignes((ls) => [...ls, ligneVide()])}>
                  <Plus />
                  Ligne
                </Bouton>
              </>
            )}
          </div>
        </CarteEntete>
        <CarteCorps className="p-0">
          {!entete.code_fournisseur && (
            <p className="px-3 pt-2 text-[12px] text-alerte">Choisissez d'abord le fournisseur : il décide des références et des bons proposés.</p>
          )}
          <div className="defilement-x">
            <table className="w-full min-w-[92rem] text-[12.5px]">
              <thead>
                <tr className="border-b border-bordure">
                  <th className={cn(th, 'w-8 text-right')}>#</th>
                  <th className={cn(th, 'min-w-56 text-left')}>Référence / désignation</th>
                  <th className={cn(th, 'w-52 text-left')}>Bon de commande</th>
                  <th className={cn(th, 'w-24 text-left')}>Lot</th>
                  <th className={cn(th, 'w-20 text-left')}>Code couleur</th>
                  <th className={cn(th, 'w-24 text-left')}>Libellé couleur</th>
                  <th className={cn(th, 'w-20 text-left')}>Unité</th>
                  <th className={cn(th, 'w-28 text-right')}>Poids net kg</th>
                  <th className={cn(th, 'w-24 text-right')}>Qté</th>
                  <th className={cn(th, 'w-20 text-right')}>Bobines</th>
                  <th className={cn(th, 'w-20 text-right')}>Palettes</th>
                  <th className={cn(th, 'w-24 text-right')}>Prix unit.</th>
                  <th className={cn(th, 'w-28 text-right')}>Montant</th>
                  <th className={cn(th, 'w-20 text-right')}>% dossier</th>
                  {coutVisible && <th className={cn(th, 'w-28 text-right')}>Frais DH</th>}
                  {coutVisible && <th className={cn(th, 'w-28 text-right')}>Revient /u</th>}
                  {ecrire && <th className={cn(th, 'w-8')} />}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => {
                  if (l.supprimee) return null
                  const s = l.id_ligne ? serveur(l.id_ligne) : undefined
                  const fige = !ecrire || l.recue
                  const erp = l.type_ligne === 'ERP'
                  const bcOptions = (qBc.data ?? []).filter((b) => !l.code_reference || b.code_reference === l.code_reference)
                  const bcConnu = !l.id_ligne_bc || bcOptions.some((b) => b.id_ligne_bc === l.id_ligne_bc)
                  const detail = ouverte === l.cle && s && coutVisible
                  return (
                    <Fragment key={l.cle}>
                      <tr className={cn('border-b border-bordure/60 align-top', !ligneComplete(l) && (l.code_reference || l.libelle) && 'bg-alerte/5')}>
                        <td className={cn(td, 'pt-2 text-right tabular-nums text-attenue-texte')}>
                          {i + 1}
                          {l.recue && <Lock className="ml-auto mt-1 size-3" aria-label="Déjà reçue" />}
                        </td>
                        <td className={td}>
                          {erp ? (
                            /* LES REFERENCES DU FOURNISSEUR D'ABORD : proposer
                               tout le catalogue pour une facture Hasirci, c'est
                               inviter a choisir le Red d'Ozkaralar. La case
                               « toutes » ouvre le reste quand il le faut. */
                            <ChampReference
                              valeur={l.code_reference}
                              fournisseur={toutes ? undefined : entete.code_fournisseur}
                              surChoix={(r) => choisirReference(l, r as RefCatalogue)}
                              desactive={fige}
                              placeholder="Référence — tapez…"
                              ariaLabel="Référence de la ligne"
                            />
                          ) : (
                            <Champ className={champ} value={l.libelle} disabled={fige} placeholder="Hors ERP — pièce, autre…"
                              onChange={(e) => majLigne(l.cle, { libelle: e.target.value })} />
                          )}
                        </td>
                        <td className={td}>
                          {erp ? (
                            <Selecteur className={champ} value={l.id_ligne_bc} disabled={fige}
                              onChange={(e) => choisirBc(l, e.target.value)}>
                              <option value="">Libre — sans BC</option>
                              {!bcConnu && <option value={l.id_ligne_bc}>{l.numero_bc || 'bon lié'}</option>}
                              {bcOptions.map((b) => (
                                <option key={b.id_ligne_bc} value={b.id_ligne_bc}>
                                  {b.numero_bc} · l.{b.ligne_numero} · reste {fmt.nombre(b.quantite_restante_kg, 0)} kg
                                </option>
                              ))}
                            </Selecteur>
                          ) : (
                            <span className="text-[11px] italic text-attenue-texte">porte sa part de frais</span>
                          )}
                        </td>
                        <td className={td}><Champ className={champ} value={l.lot_fournisseur} disabled={!ecrire} onChange={(e) => majLigne(l.cle, { lot_fournisseur: e.target.value })} /></td>
                        <td className={td}><Champ className={champ} value={l.code_couleur} disabled={!ecrire || !erp} placeholder="7612" onChange={(e) => majLigne(l.cle, { code_couleur: e.target.value })} /></td>
                        <td className={td}><Champ className={champ} value={l.libelle_couleur} disabled={!ecrire || !erp} placeholder="RED" onChange={(e) => majLigne(l.cle, { libelle_couleur: e.target.value })} /></td>
                        <td className={td}>
                          {erp ? (
                            <Selecteur className={champ} value={l.unite} disabled={fige}
                              onChange={(e) => majLigne(l.cle, { unite: e.target.value as LigneEdit['unite'] })}>
                              <option value="kg">kg</option>
                              <option value="ml">mètre</option>
                              <option value="piece">pièce</option>
                            </Selecteur>
                          ) : (
                            <span className="text-[12px] text-attenue-texte">pièce</span>
                          )}
                        </td>
                        <td className={td}>
                          {erp ? (
                            <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={l.poids_net_kg} disabled={fige}
                              onChange={(e) => majColis(l, 'poids', e.target.value)} />
                          ) : <span className="block text-right text-attenue-texte">—</span>}
                        </td>
                        <td className={td}>
                          {erp && l.unite === 'kg' ? (
                            <span className="block pt-1 text-right tabular-nums text-attenue-texte">= poids</span>
                          ) : (
                            <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={l.quantite} disabled={fige}
                              onChange={(e) => majLigne(l.cle, { quantite: e.target.value })} />
                          )}
                        </td>
                        <td className={td}><Champ className={cn(champ, 'text-right')} inputMode="numeric" value={l.nb_bobines} disabled={!ecrire} onChange={(e) => majColis(l, 'bobines', e.target.value)} /></td>
                        <td className={td}>
                          <div className="flex items-center gap-1">
                            <Champ className={cn(champ, 'text-right')} inputMode="numeric" value={l.nb_palettes} disabled={!ecrire} onChange={(e) => majColis(l, 'palettes', e.target.value)} />
                            {/* PLUS D’INTERRUPTEUR : poids, bobines et
                                palettes se repondent toujours, et le champ
                                qu’on vient de saisir n’est jamais reecrit. */}
                          </div>
                        </td>
                        <td className={td}>
                          <Champ className={cn(champ, 'text-right')} inputMode="decimal" value={l.prix_unitaire_devise} disabled={fige}
                            onChange={(e) => majLigne(l.cle, { prix_unitaire_devise: e.target.value })} />
                        </td>
                        <td className={cn(td, 'pt-2 text-right font-medium tabular-nums')}>{fmt.nombre(montantLigne(l), 2)}</td>
                        <td className={cn(td, 'pt-2 text-right tabular-nums text-attenue-texte')}>
                          {s?.pct_dossier == null ? '—' : `${fmt.nombre(s.pct_dossier, 2)} %`}
                        </td>
                        {coutVisible && (
                          <td className={cn(td, 'pt-1.5 text-right tabular-nums')}>
                            {s ? (
                              <button type="button" className="inline-flex items-center gap-0.5 font-medium text-primaire hover:underline"
                                onClick={() => setOuverte(ouverte === l.cle ? null : l.cle)} title="Voir la répartition par frais">
                                {fmt.nombre(s.frais_alloues_dhs ?? 0, 2)}
                                {detail ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                              </button>
                            ) : '—'}
                          </td>
                        )}
                        {coutVisible && (
                          <td className={cn(td, 'pt-2 text-right tabular-nums')}>
                            {s?.cout_revient_unitaire_dhs == null ? '—' : (
                              <>
                                {fmt.nombre(s.cout_revient_unitaire_dhs, 4)}
                                <span className="text-[10.5px] text-attenue-texte"> /{s.type_ligne === 'HORS_ERP' ? 'pce' : UNITE[s.unite]}</span>
                              </>
                            )}
                          </td>
                        )}
                        {ecrire && (
                          <td className={cn(td, 'pt-1.5')}>
                            {!l.recue && (
                              <Bouton taille="icone-xs" variante="discret" className="text-danger hover:bg-danger/10" aria-label="Retirer la ligne"
                                onClick={() => (l.id_ligne ? majLigne(l.cle, { supprimee: true }) : setLignes((ls) => ls.filter((x) => x.cle !== l.cle)))}>
                                <Trash2 />
                              </Bouton>
                            )}
                          </td>
                        )}
                      </tr>
                      {/* LA REPARTITION DE LA LIGNE : la part de chaque frais. */}
                      {detail && (
                        <tr className="border-b border-bordure/60 bg-attenue/25">
                          <td />
                          <td colSpan={15 + (ecrire ? 1 : 0)} className="px-2 py-2">
                            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                              <span className="text-attenue-texte">
                                Valeur d'achat <strong className="text-texte tabular-nums">{fmt.nombre(s!.valeur_achat_dhs, 2)} DH</strong>
                              </span>
                              {fraisInclus.map((f) => {
                                const p = partDe(s!.id_ligne, f.id_ligne_frais)
                                return (
                                  <span key={f.id_ligne_frais} className="text-attenue-texte">
                                    {f.frais_libelle}{' '}
                                    <strong className="text-texte tabular-nums">{p ? fmt.nombre(p.montant_alloue_dhs ?? 0, 2) : '—'}</strong>
                                    {p && <span className="tabular-nums"> ({fmt.nombre(p.pourcentage, 2)} %)</span>}
                                  </span>
                                )
                              })}
                              <span className="text-attenue-texte">
                                Coût de revient <strong className="text-texte tabular-nums">{fmt.nombre(s!.cout_revient_dhs ?? 0, 2)} DH</strong>
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {lignes.some((l) => l.recue) && (
            <p className="border-t border-bordure px-3 py-2 text-[11.5px] text-attenue-texte">
              <Lock className="mr-1 inline size-3" />
              Les lignes déjà reçues sont entrées en stock à leur prix : leur référence, leur quantité et leur prix ne se modifient plus.
            </p>
          )}
        </CarteCorps>
      </Carte>

      {/* ================= Totaux ============================================= */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Totaux de la facture</CarteTitre>
        </CarteEntete>
        <CarteCorps>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] md:grid-cols-4">
            <Total libelle={`Montant (${entete.code_devise})`} valeur={fmt.nombre(totalDevise, 2)}
              controle={entete.montant_devise ? `imprimé ${fmt.nombre(nombre(entete.montant_devise), 2)}` : undefined} alerte={ecartMontant} />
            <Total libelle="Valeur (DH)" valeur={fmt.nombre(taux > 0 ? totalDevise * taux : 0, 2)} controle={`au taux ${fmt.nombre(taux, 4)}`} />
            <Total libelle="Poids net (kg)" valeur={fmt.nombre(totalPoids, 2)} />
            <Total libelle="Palettes / bobines" valeur={`${fmt.entier(totalPalettes)} / ${fmt.entier(totalBobines)}`}
              controle={entete.nb_palettes || entete.nb_bobines ? `imprimé ${entete.nb_palettes || '—'} / ${entete.nb_bobines || '—'}` : undefined}
              alerte={(entete.nb_palettes !== '' && nombre(entete.nb_palettes) !== totalPalettes) || (entete.nb_bobines !== '' && nombre(entete.nb_bobines) !== totalBobines)} />
            {coutVisible && !nouvelle && (
              <>
                <Total libelle="Frais alloués (DH)" valeur={fmt.nombre(totalFrais, 2)}
                  controle={totalValeur > 0 ? `${fmt.nombre((totalFrais * 100) / totalValeur, 2)} % de la valeur` : undefined} />
                <Total libelle="Coût de revient (DH)" valeur={fmt.nombre(totalValeur + totalFrais, 2)} fort />
              </>
            )}
          </div>
          {ecartMontant && (
            <Alerte ton="alerte" className="mt-3">
              La somme des lignes ne fait pas le montant imprimé : une ligne manque ou un prix est faux.
            </Alerte>
          )}
          {lignesModifiees.length > 0 && !nouvelle && (
            <p className="mt-3 text-[11.5px] text-attenue-texte">
              {lignesModifiees.length} ligne(s) modifiée(s) : la répartition des frais sera recalculée à l'enregistrement.
            </p>
          )}
        </CarteCorps>
      </Carte>

      <div className="flex flex-wrap justify-between gap-2">
        {ecrire && !nouvelle && !lignesServeur.some((l) => l.quantite_recue_kg > 0) ? (
          <Bouton variante="contour" className="text-danger"
            onClick={() =>
              confirmation.demander({
                titre: `Supprimer la facture ${facture!.numero_facture} ?`,
                destructif: true,
                libelleConfirmer: 'Supprimer',
                description: 'Ses lignes sont supprimées et les frais du dossier répartis à nouveau.',
                action: () => supprimer.mutate(),
              })
            }>
            <Trash2 />
            Supprimer la facture
          </Bouton>
        ) : <span />}
        <div className="flex gap-2">
          <Bouton variante="contour" onClick={() => ouvrir(`/import/${idDossier}`)}>Retour au dossier</Bouton>
          {ecrire && (
            <Bouton disabled={!modifie || !enteteComplet || incompletes.length > 0} chargement={enregistrer.isPending}
              onClick={() => enregistrer.mutate()}>
              <Save />
              Enregistrer la facture
            </Bouton>
          )}
        </div>
      </div>
    </div>
  )
}

function Total({
  libelle,
  valeur,
  controle,
  alerte,
  fort,
}: {
  libelle: string
  valeur: React.ReactNode
  controle?: string
  alerte?: boolean
  fort?: boolean
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-attenue-texte">{libelle}</div>
      <div className={cn('tabular-nums', fort ? 'text-[16px] font-semibold' : 'text-[15px] font-medium', alerte && 'text-alerte')}>{valeur}</div>
      {controle && <div className={cn('text-[11px] tabular-nums', alerte ? 'text-alerte' : 'text-attenue-texte')}>{controle}</div>}
    </div>
  )
}

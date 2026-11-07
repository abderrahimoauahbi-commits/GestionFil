/**
 * L'etat d'une fiche en cours de saisie — modele du 05/10/2026.
 *
 * PARTAGE PAR LES DEUX INTERFACES. Le bureau montre une grille, le telephone
 * une ligne a la fois — mais la machine a etats est la meme.
 *
 * DEUX TEMPS, TOUJOURS :
 *   1. APERCU : la fiche est enregistree en brouillon, et le serveur calcule
 *      ce que la decision enregistrera — % theorique, % declare, ecart et ce
 *      qu'il compte, ce qui bloquerait. Rien n'est encore decide.
 *   2. VALIDATION : seulement sur un apercu a jour et sans blocage. Changer une
 *      saisie apres l'apercu le perime : il faut le refaire.
 *
 * Une fiche DEVALIDEE se reprend : ses lignes reviennent, et son etage peut
 * changer (le cas de l'erreur d'emplacement).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { SANS_LOT } from '../../lib/lots'
import { plusieursDerives, type LigneDerivee } from '../../lib/derives'
import type { EtiquetteLue } from '../../composants/ChampScan'
import { phraseGel, useGelInventaire } from '../../lib/inventairesOuverts'
import { useOfOuverts } from '../../composants/ChoixOF'
import {
  corpsFiche, depuisEtat, destinationsDe, estimer, ligneNeuve, lignesAEnvoyer, machinesApi,
  type Apercu, type LigneSaisie, type Motif, type TypeFiche, type Zone,
} from './noyau'

const aujourdHui = () => new Date().toISOString().slice(0, 10)
const arrondi2 = (v: number) => Math.round(v * 100) / 100

export function useFiche(machine: string, zoneInitiale: Zone | null, type: TypeFiche, idFiche?: string) {
  const qc = useQueryClient()
  const [zone, setZone] = useState<Zone | null>(zoneInitiale)

  const qEtat = useQuery({
    queryKey: ['machine-etat', machine, zone?.code_emplacement],
    queryFn: () => machinesApi.etat(machine, zone!.code_emplacement),
    enabled: !!zone,
  })
  const qMotifs = useQuery({ queryKey: ['machine-motifs'], queryFn: machinesApi.motifs, staleTime: 300_000 })
  const qFiche = useQuery({
    queryKey: ['machine-fiche', idFiche],
    queryFn: () => machinesApi.fiche(idFiche!),
    enabled: !!idFiche,
  })
  const motifs = useMemo(
    () => (qMotifs.data ?? []).filter((m) => m.type_fiche === type),
    [qMotifs.data, type],
  )
  const motifDe = (code: string): Motif | undefined => motifs.find((m) => m.code_motif === code)

  /* LE BROUILLON DEJA CREE : remplace a chaque apercu, jamais duplique. */
  const brouillon = useRef<string | null>(idFiche ?? null)

  /* PLUS D'OF NI DE QUALITE D'EN-TETE (24/10/2026) : chaque ligne porte son OF
     (et sa qualite sans OF). `of` ne garde que le texte d'une fiche reprise
     d'avant les OF en lien, pour l'historique. */
  const [entete, setEntete] = useState({
    date: aujourdHui(), magasin: '', responsable: '', of: '', observations: '',
  })
  const ofs = useOfOuverts()
  const [lignes, setLignes] = useState<LigneSaisie[]>([])
  const [amorcee, setAmorcee] = useState<string | null>(null)

  /* L'ETAT COURANT AMORCE LA SAISIE ; une fiche reprise y ajoute ses lignes. */
  const cle = `${zone?.code_emplacement}|${type}|${idFiche ?? ''}`
  useEffect(() => {
    if (!zone || !qEtat.data || amorcee === cle) return
    if (idFiche && !qFiche.data) return
    const base = qEtat.data.map((e) => depuisEtat(e, type))
    /* LE CONSTAT DE CORRECTION, ouvert depuis l'etage (F22) : le motif est deja choisi. */
    const motifPose = new URLSearchParams(window.location.search).get('motif')
    if (!idFiche && type === 'MAJ' && motifPose) for (const b of base) b.code_motif = motifPose
    if (idFiche && qFiche.data) {
      const f = qFiche.data
      /* UNE FICHE REPRISE QUI PORTAIT UN OF OU UNE QUALITE D'EN-TETE : ils
         descendent, visibles, sur ses lignes qui n'en disaient pas — le serveur
         les leur donnait de meme. */
      const ofFiche = f.entete.id_of || ''
      const numeroFiche = ofFiche ? (f.entete.numero_of_lien ?? f.entete.numero_of ?? '') : ''
      const qualiteFiche = ofFiche ? '' : (f.entete.code_qualite ?? '')
      setEntete({
        date: f.entete.date_fiche?.slice(0, 10) || aujourdHui(),
        magasin: f.entete.code_magasin ?? '',
        responsable: f.entete.responsable,
        of: ofFiche ? '' : (f.entete.numero_of ?? ''),
        observations: f.entete.observations ?? '',
      })
      for (const l of f.lignes) {
        const i = base.findIndex((b) => b.code_reference === l.code_reference && b.lot_fournisseur === l.lot_fournisseur)
        // Une ligne neuve reprise : le poids d'une bobine DU LOT, sinon la fiche (23/10/2026).
        const nominal = l.poids_lot_kg ?? l.poids_catalogue_kg ?? 0
        const repris: LigneSaisie = {
          ...(i >= 0 ? base[i] : {
            cle: `${l.code_reference}${l.lot_fournisseur}`, code_reference: l.code_reference,
            designation: l.designation, lot_fournisseur: l.lot_fournisseur, presentes: 0,
            poids_unitaire: nominal, poids_catalogue: nominal, avant_bobines: 0, avant_pourcentage: null,
            avant_kg: 0, avant_date: null,
          } as LigneSaisie),
          mouvementees: Number(l.nb_bobines_mouvementees ?? 0),
          code_derive: l.code_derive ?? '',
          // Le constat ne change pas le nombre de bobines : celui de l'etat (24/10/2026).
          presentes: i >= 0 ? base[i].presentes : 0,
          poids_retenu: Number(l.poids_retenu_kg ?? nominal),
          pourcentage: Number(l.pourcentage ?? 0),
          pourcentage_saisi: true,
          pct_retirees: Number(l.pct_retirees ?? 0),
          destination: (l.destination as LigneSaisie['destination']) ?? '',
          code_motif: l.code_motif ?? '',
          motif_texte: l.motif_texte ?? '',
          effet_ecart: l.effet_ecart ?? '',
          id_of: l.id_of || ofFiche,
          numero_of: l.id_of ? (l.numero_of ?? '') : numeroFiche,
          largeur_voie: type === 'CHARGE' && l.largeur_voie_m != null
            ? Number(l.largeur_voie_m) : (i >= 0 ? base[i].largeur_voie ?? 0 : 0),
          code_qualite: l.id_of || ofFiche ? '' : (l.code_qualite || qualiteFiche),
        }
        if (i >= 0) base[i] = repris
        else base.push(repris)
      }
      brouillon.current = idFiche
    }
    setLignes(base)
    setAmorcee(cle)
  }, [zone, qEtat.data, qFiche.data, amorcee, cle, idFiche, type])

  /** CHANGER D'ETAGE (fiche reprise) : les saisies restent, l'etat d'avant suit l'etage. */
  function changerZone(z: Zone) {
    setZone(z)
    setAmorcee(null)
  }

  /* LES LOTS DU MAGASIN D'ORIGINE, pour le FIFO et pour LE POIDS D'UNE BOBINE DU
     LOT (23/10/2026) : une ligne neuve chargee prend le poids de son lot, sinon
     celui de la fiche article. */
  const qLots = useQuery({
    queryKey: ['stock-lots-magasin', entete.magasin],
    queryFn: () =>
      api.get<({ code_reference: string; lot_fournisseur: string; date_premiere_entree: string
                 poids_bobine_lot_kg?: number | null; quantite_kg?: number | null } & LigneDerivee)[]>(
        `/api/stock/lots?code_magasin=${encodeURIComponent(entete.magasin)}&limite=5000`,
      ),
    enabled: type === 'CHARGE' && !!entete.magasin,
  })
  /* UNE LIGNE PAR DERIVE quand le lot en a plusieurs (06/11/2026) : le poids est
     celui du derive choisi ; sans derive, celui de la ligne du lot. */
  const lignesDuLot = (reference: string, lot: string) =>
    (qLots.data ?? []).filter((x) => x.code_reference === reference && x.lot_fournisseur === lot)
  const poidsDuLot = (reference: string, lot: string, derive = ''): number | null => {
    const ls = lignesDuLot(reference, lot)
    const p = (derive ? ls.find((x) => x.code_derive === derive) : ls[0])?.poids_bobine_lot_kg
    return p != null && p > 0 ? Number(p) : null
  }
  /** Une ligne NEUVE au chargement prend le poids d'une bobine de son lot (le nominal propose). */
  const auPoidsDuLot = (n: LigneSaisie): LigneSaisie => {
    if (type !== 'CHARGE' || n.avant_bobines > 0) return n
    const p = poidsDuLot(n.code_reference, n.lot_fournisseur, n.code_derive ?? '')
    return p === null ? n : { ...n, poids_retenu: p, poids_unitaire: p }
  }
  /* LES LOTS LUS APRES LE CHOIX DU LOT : une ligne neuve dont le poids n'a pas ete
     touche (il vaut encore celui de la fiche) prend celui de son lot. */
  useEffect(() => {
    if (type !== 'CHARGE' || !qLots.data) return
    setLignes((ls) => {
      let change = false
      const n = ls.map((l) => {
        if (l.avant_bobines > 0 || !l.lot_fournisseur || l.poids_retenu !== (l.poids_catalogue ?? l.poids_retenu)) return l
        const r = auPoidsDuLot(l)
        if (r.poids_retenu === l.poids_retenu) return l
        change = true
        if (!r.pourcentage_saisi) {
          const t = estimer('CHARGE', r).theorique
          if (t != null) r.pourcentage = arrondi2(t)
        }
        return r
      })
      return change ? n : ls
    })
    // Seule l'arrivee des lots relance ce calage ; les saisies passent par majLigne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLots.data, type])

  /** L'OF DE LA LIGNE : son lien et son numero ; avec un OF, la qualite est la sienne. */
  function choisirOf(cleLigne: string, id: string, numero: string) {
    setLignes((ls) => ls.map((l) => (l.cle !== cleLigne ? l : {
      ...l, id_of: id, numero_of: id ? numero : '', code_qualite: id ? '' : l.code_qualite,
    })))
  }

  /**
   * L'OF PROPOSE A UNE LIGNE NEUVE DU CHARGEMENT (24/10/2026) : celui de la
   * ligne chargee juste avant, a defaut celui que l'etage sert (s'il n'en sert
   * qu'un). Une proposition visible sur la ligne, qui se change ; jamais un OF
   * ferme, que le serveur refuserait.
   */
  function ofPropose(ls: LigneSaisie[]): { id_of: string; numero_of: string } | null {
    const ouvert = (id: string) => (ofs.data ?? []).some((o) => o.id_of === id)
    const effectif = (l: LigneSaisie) =>
      l.id_of ? { id_of: l.id_of, numero_of: l.numero_of ?? '' }
        : l.avant_id_of ? { id_of: l.avant_id_of, numero_of: l.avant_numero_of ?? '' } : null
    const chargees = ls.filter((l) => l.mouvementees > 0 || l.avant_bobines === 0)
    if (chargees.length) {
      const p = effectif(chargees[chargees.length - 1])
      return p && ouvert(p.id_of) ? p : null
    }
    const etage = [...new Map(ls.filter((l) => l.avant_id_of)
      .map((l) => [l.avant_id_of!, { id_of: l.avant_id_of!, numero_of: l.avant_numero_of ?? '' }])).values()]
    return etage.length === 1 && ouvert(etage[0].id_of) ? etage[0] : null
  }

  function majLigne<K extends keyof LigneSaisie>(cleLigne: string, champ: K, v: LigneSaisie[K]) {
    setLignes((ls) =>
      ls.map((l) => {
        if (l.cle !== cleLigne) return l
        let n: LigneSaisie = { ...l, [champ]: v }
        // Changer de lot efface le derive : il etait celui de l'ancien lot (06/11/2026).
        if (champ === 'lot_fournisseur' && v !== l.lot_fournisseur) n.code_derive = ''
        if (champ === 'lot_fournisseur' || champ === 'code_derive') n = auPoidsDuLot(n)
        if (champ === 'pourcentage') n.pourcentage_saisi = true
        // UN MOTIF QUI N'ADMET QU'UNE DESTINATION LA POSE ; changer de motif
        // efface un effet devenu sans objet.
        if (champ === 'code_motif') {
          const d = destinationsDe(motifDe(String(v)))
          n.destination = d.length === 1 ? d[0] : d.includes(l.destination as never) ? l.destination : ''
          n.effet_ecart = ''
        }
        // AU CHARGEMENT, le % de la ligne apres est PROPOSE : le % theorique,
        // tant que l'operateur ne l'a pas saisi lui-meme.
        if (type === 'CHARGE' && !n.pourcentage_saisi && (champ === 'mouvementees' || champ === 'poids_retenu' || champ === 'lot_fournisseur' || champ === 'code_derive')) {
          const t = estimer('CHARGE', n).theorique
          if (t != null) n.pourcentage = arrondi2(t)
        }
        return n
      }),
    )
  }

  function retirer(cleLigne: string) {
    setLignes((ls) => ls.filter((l) => l.cle !== cleLigne))
  }

  function ajouter(l: LigneSaisie) {
    setLignes((ls) => {
      const p = type === 'CHARGE' && !l.id_of ? ofPropose(ls) : null
      return [...ls, { ...auPoidsDuLot(l), ...(p ?? {}), cle: `${l.code_reference}|${l.lot_fournisseur}|${ls.length}` }]
    })
  }

  /**
   * LE SCAN D'UNE ETIQUETTE DE LOT (19/10/2026), au chargement : la reference et
   * le lot viennent de l'etiquette, plus du clavier. Une bobine compte pour une ;
   * une palette pour son nombre de bobines au catalogue. La ligne de cette
   * reference et de ce lot recoit le compte, ou nait.
   */
  function scanner(e: EtiquetteLue): string | void {
    if (type !== 'CHARGE') return 'Le scan d’étiquette sert au chargement de la machine.'
    if (e.statut_reception === 'ANNULE') return `Étiquette ${e.code} : sa réception est annulée.`
    const n = e.nature === 'BOBINE' ? 1 : Number(e.bobines_par_palette ?? 0)
    if (!(n > 0)) {
      return `Palette ${e.code} : le catalogue ne dit pas combien de bobines elle porte. Scannez ses bobines.`
    }
    const lot = e.lot_fournisseur ?? SANS_LOT
    // Le derive de l'etiquette (06/11/2026), quand le lot en a plusieurs ; seul, le serveur le pose.
    const derive = (e.nb_derives ?? 0) > 1 ? (e.code_derive ?? '') : ''
    const l = lignes.find(
      (x) => x.code_reference === e.code_reference && x.lot_fournisseur === lot && (x.code_derive ?? '') === derive,
    )
    if (l) majLigne(l.cle, 'mouvementees', l.mouvementees + n)
    else {
      ajouter({
        ...ligneNeuve(e.code_reference, e.designation ?? e.code_reference, e.poids_bobine_kg ?? 0, e.poids_bobine_kg),
        lot_fournisseur: lot,
        code_derive: derive,
        mouvementees: n,
      })
    }
  }

  const envoyees = useMemo(() => lignesAEnvoyer(type, lignes), [type, lignes])

  const totaux = useMemo(() => {
    let avant = 0
    let apres = 0
    let kgApres = 0
    let kgMouv = 0
    let ecart = 0
    const touchees = new Set(envoyees.map((l) => l.cle))
    for (const l of lignes) {
      avant += l.avant_bobines
      if (!touchees.has(l.cle)) {
        apres += l.avant_bobines
        kgApres += l.avant_kg
        continue
      }
      const e = estimer(type, l)
      apres += e.nbApres
      kgApres += e.kgApres
      kgMouv += e.kgMouv
      ecart += e.ecart
    }
    return { avant, apres, kgApres, kgMouv, ecart, places: zone?.capacite_bobines ?? 0 }
  }, [lignes, envoyees, type, zone])

  const corps = useMemo(
    () => (zone ? corpsFiche(type, machine, zone.code_emplacement, entete, lignes) : null),
    [type, machine, zone, entete, lignes],
  )
  const empreinte = JSON.stringify(corps)

  const [apercu, setApercu] = useState<{ empreinte: string; resultat: Apercu } | null>(null)
  const apercuAJour = !!apercu && apercu.empreinte === empreinte

  async function enregistrer(c: unknown) {
    if (brouillon.current) await machinesApi.remplacerFiche(brouillon.current, c)
    else brouillon.current = (await machinesApi.creerFiche(c)).id_fiche
    return brouillon.current
  }

  const calculer = useMutation({
    mutationFn: async () => {
      const id = await enregistrer(corps)
      return machinesApi.apercu(id)
    },
    onSuccess: (r) => setApercu({ empreinte, resultat: r }),
  })

  /* PAS DE FORCAGE DE LOT (06/10/2026) : un lot que le magasin ne couvre pas
     bloque, comme un stock insuffisant. L'apercu le dit avant la validation ;
     le magasinier previent le directeur ou l'administrateur, qui corrigent. */
  const envoi = useMutation({
    mutationFn: async (confirme?: boolean) => {
      if (!apercuAJour || !brouillon.current) throw new Error('Faites d’abord l’aperçu : il montre ce qui sera enregistré.')
      return machinesApi.valider(brouillon.current, !!confirme)
    },
    onSuccess: async () => {
      for (const k of ['machines', 'machine-plan', 'machine-fiches', 'machine-contenu', 'machine-conso', 'machine-fiche'])
        void qc.invalidateQueries({ queryKey: [k] })
      setApercu(null)
      brouillon.current = null
      /* LA SAISIE SUIVANTE PART DE L'ETAT RESULTANT : on attend la relecture de
         l'etage, sinon elle se reamorcerait sur l'etat d'avant la decision. */
      await qc.invalidateQueries({ queryKey: ['machine-etat'] })
      setAmorcee(null)
    },
  })

  /** Le blocage de stock, dit par l'apercu : le chargement ne passera pas. */
  const stockCourt = apercuAJour
    ? (apercu!.resultat.blocages.find((b) => b.startsWith('STOCK-INSUFFISANT') || b.startsWith('LOT-INSUFFISANT')) ?? null)
    : null

  /* LE MAGASIN GELE PAR UN INVENTAIRE OUVERT (23/10/2026). Un chargement sort
     du magasin ; un dechargement n'y rentre que pour la destination MAGASIN.
     La base refuse le mouvement (INVENTAIRE-OUVERT) ; l'ecran le dit avant. */
  /* Un global gele tout le magasin ; un tournant ou un cible, ses seules
     references (2026-10-24a) : seules comptent les lignes qui touchent le
     magasin (tout chargement, un dechargement vers le magasin). */
  const versMagasin = (l: LigneSaisie) => {
    const d = destinationsDe(motifDe(l.code_motif))
    return (l.destination || (d.length === 1 ? d[0] : '')) === 'MAGASIN'
  }
  const touchentMagasin = type === 'CHARGE' ? envoyees : type === 'DECHARGE' ? envoyees.filter(versMagasin) : []
  // Un gel du magasin entier se dit des le choix du magasin, mais ne bloque un
  // dechargement que s'il renvoie au magasin ; un gel par reference, s'il touche.
  const gel = useGelInventaire(
    [type !== 'MAJ' ? entete.magasin : null],
    touchentMagasin.map((l) => ({ magasin: entete.magasin, reference: l.code_reference })),
  )
  const gelBloque =
    gel.length > 0 &&
    (type === 'CHARGE' || (type === 'DECHARGE' && touchentMagasin.length > 0))

  /** CE QUI MANQUE ENCORE, dit en clair : la premiere chose qui empeche l'apercu. */
  const manque = ((): string | null => {
    if (!zone) return 'Choisissez l’étage.'
    if (!entete.responsable.trim()) return 'Indiquez le responsable.'
    if (type !== 'MAJ' && !entete.magasin) return 'Choisissez le magasin.'
    if (gelBloque) return phraseGel(gel)
    if (envoyees.length === 0)
      return type === 'MAJ' ? 'Aucune ligne.' : `Indiquez le nombre de bobines ${type === 'CHARGE' ? 'à charger' : 'à retirer'}.`
    for (const l of envoyees) {
      const qui = l.designation || l.code_reference
      if (!l.lot_fournisseur.trim()) return `Indiquez le lot de ${qui}.`
      /* LE DERIVE, quand le lot en a plusieurs au magasin (06/11/2026) : la base
         refuse le chargement sans lui (DERIVE-REQUIS). */
      if (type === 'CHARGE' && !l.code_derive && lignesDuLot(l.code_reference, l.lot_fournisseur).some(plusieursDerives))
        return `Indiquez le dérivé du lot ${l.lot_fournisseur} de ${qui} : le lot a plusieurs conditionnements.`
      if (!l.code_motif) return `Choisissez le motif de ${qui}.`
      const m = motifDe(l.code_motif)
      if (m && !m.effet_defaut && !l.effet_ecart) return `Dites comment compte l’écart de ${qui} (${m.libelle}).`
      if (type === 'CHARGE' && !(l.poids_retenu > 0)) return `Indiquez le poids par bobine de ${qui}.`
      /* LA QUALITE EXPLICITE (23/10/2026) : un chargement sert la qualite de son OF
         (celui de la ligne, ou celui qu'elle sert deja) ; sans OF, elle se choisit. */
      if (type === 'CHARGE' && !l.id_of && !l.avant_numero_of && !l.code_qualite && !l.avant_code_qualite)
        return `Indiquez la qualité que sert ${qui} : sans OF, elle est obligatoire.`
      if (type === 'DECHARGE' && !l.destination && destinationsDe(m).length !== 1)
        return `Choisissez la destination de ${qui}.`
    }
    if (totaux.apres > totaux.places) return `L’étage déborde : ${totaux.apres} bobines pour ${totaux.places} places.`
    return null
  })()

  const pret = manque === null

  /* LE BOUTON SUIT LE DROIT (audit v4) : charger ou decharger fait bouger le
     magasin et demande VALIDER ; un constat reste au droit d'ecrire. Sans le
     droit, l'apercu restait propre et la validation repondait 403. */
  const { peut } = useAuth()
  const droitValider = type === 'MAJ' ? peut('MOUVEMENTS', 'ECRIRE') : peut('MOUVEMENTS', 'VALIDER')
  const peutValider = droitValider && pret && apercuAJour && apercu!.resultat.blocages.length === 0


  /**
   * CE QUI MERITE UNE CONFIRMATION AVANT DE VALIDER : le melange de lots d'une
   * meme reference sur l'etage, un lot plus ancien qui attend au magasin.
   */
  const avertissements = useMemo(() => {
    const a: string[] = []
    // L'ECART ORANGE SE CONFIRME (regle 1, 08/10/2026) : ni anodin, ni assez
    // grand pour exiger la Direction. Le rouge, lui, est un blocage du serveur.
    for (const l of apercuAJour ? apercu!.resultat.lignes : [])
      if (l.niveau_ecart === 'ORANGE')
        a.push(`Écart de ${l.ecart_kg.toLocaleString('fr-FR')} kg sur ${l.code_reference} (lot ${l.lot_fournisseur}) : au-delà du seuil vert, à confirmer.`)
    if (type !== 'CHARGE') return a
    const parRef = new Map<string, Set<string>>()
    for (const l of lignes)
      if ((l.avant_bobines > 0 || l.mouvementees > 0) && l.lot_fournisseur && l.lot_fournisseur !== SANS_LOT)
        parRef.set(l.code_reference, new Set([...(parRef.get(l.code_reference) ?? []), l.lot_fournisseur]))
    for (const [ref, lots] of parRef)
      if (lots.size > 1)
        a.push(`Mélange de lots sur l’étage : ${ref} — lots ${[...lots].join(', ')}. La nuance peut différer au tissage.`)
    for (const l of envoyees) {
      if (!l.lot_fournisseur || l.lot_fournisseur === SANS_LOT) continue
      const dispo = (qLots.data ?? []).filter((x) => x.code_reference === l.code_reference && x.lot_fournisseur !== SANS_LOT)
      const choisi = dispo.find((x) => x.lot_fournisseur === l.lot_fournisseur)
      const plusAncien = dispo
        .filter((x) => !choisi || x.date_premiere_entree < choisi.date_premiere_entree)
        .sort((x, y) => x.date_premiere_entree.localeCompare(y.date_premiere_entree))[0]
      if (choisi && plusAncien)
        a.push(`FIFO : ${l.code_reference} — le lot ${plusAncien.lot_fournisseur} est plus ancien que ${l.lot_fournisseur} au magasin.`)
    }
    return a
  }, [type, lignes, envoyees, qLots.data, apercuAJour, apercu])

  return {
    zone, changerZone, motifs, motifDe,
    stockCourt, avertissements,
    etat: qEtat, entete, setEntete, lignes, setLignes, envoyees,
    majLigne, choisirOf, retirer, ajouter, scanner, totaux, lignesDuLot,
    calculer, apercu: apercuAJour ? apercu!.resultat : null, apercuPerime: !!apercu && !apercuAJour,
    envoi, pret, peutValider, manque, gel,
    reamorcer: () => setAmorcee(null),
  }
}

/**
 * Bon de commande — DOCUMENT : en-tete, lignes, saisie et suivi.
 *
 * Le bon se prepare sur des semaines. Il doit donc rester modifiable tant qu'il
 * n'engage rien — en-tete compris, ce qui manquait entierement : on pouvait le
 * creer et changer son statut, jamais corriger une date de livraison.
 *
 * La saisie de ligne amene le PLAN D'ACHAT dans le formulaire, au lieu de le
 * laisser dans un ecran a cote. Chaque reference proposee est celle du
 * fournisseur du bon, avec son stock projete, sa couverture, ce que le MRP
 * suggere d'en commander et a quel prix. Choisir devient une decision, pas une
 * saisie de code a l'aveugle.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  ClipboardCheck,
  CornerUpLeft,
  FileText,
  Printer,
  Save,
  Send,
  ShieldCheck,
  SkipForward,
  Trash2,
  Undo2,
} from 'lucide-react'
import { SUPPRIMABLES } from '../lib/statuts'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { BoutonDevalider } from '../composants/BoutonDevalider'
import { useOuvrirVue } from '../lib/navigation'
import { CelluleEditable } from '../composants/CelluleEditable'
import { DataTable, type ColonneDT } from '../composants/DataTable'
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
import {
  GrilleLignes,
  corpsLigne,
  depuisLigneEnregistree,
  estPrete,
  fusionnerParReference,
  kgDe,
  totalDe,
  type LigneSaisie,
  type RefLigne,
} from '../composants/GrilleLignes'
import { TotauxCommande } from '../composants/TotauxCommande'
import { facteurVersKg } from '../lib/conditionnement'
import { auCentime, cn, fmt } from '../lib/utils'
import { lireNombre } from '../lib/nombres'
import { StatutBadge } from '../composants/StatutBadge'
import { libelleStatut } from '../lib/statuts'

const MODULE = 'BONS_COMMANDE'

interface Bc extends Record<string, unknown> {
  id_bc: string
  /** Compteur de concurrence, incremente par la base a chaque modification (A2). */
  version?: number
  numero_bc: string
  date_bc: string
  code_fournisseur: string
  fournisseur_nom: string
  date_livraison_prevue: string | null
  conditions_paiement: string | null
  mention_expedition?: string | null
  nombre_conteneurs?: number | null
  notes: string | null
  statut: string
  code_devise: string
  taux_change_engage: number
  montant_total_devise?: number
  montant_total_mad?: number
  nb_lignes: number
  createur: string | null
  valideur: string | null
  date_validation: string | null
  /* LE TAUX (regle 10, 09/10/2026) : indicatif en brouillon, engage et justifie a la validation. */
  taux_du_jour?: number | null
  date_cours_engage?: string | null
  source_taux_engage?: 'REFERENCE' | 'SAISI' | null
  motif_taux_engage?: string | null
  /* LE CONTROLE ET LA DEMANDE DE PRIX (21/10/2026). */
  controleur?: string | null
  date_controle?: string | null
  date_demande_prix?: string | null
  motif_saut_demande_prix?: string | null
  motif_renvoi?: string | null
}

interface LigneBc extends Record<string, unknown> {
  id_ligne_bc: string
  ligne_numero: number
  /** `MARCHANDISE` ou `SERVICE` — une prestation n'a pas de reference. */
  type_ligne?: string
  code_reference: string | null
  libelle?: string | null
  reference_designation: string
  unite_commande: string
  quantite_commandee_unite: number
  quantite_commandee_kg: number
  quantite_recue_kg: number
  quantite_restante_kg: number
  prix_unitaire_devise?: number
  /** Remise du fournisseur, en % du prix brut. */
  remise_pct?: number | null
  total_ligne_devise?: number
  total_ligne_mad?: number
  taux_change_engage?: number
  code_devise?: string
  couleur: string | null
  code_categorie: string | null
  categorie_libelle: string | null
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  nb_palettes: number | null
  statut: string
  besoin_kg_origine: number | null
  besoin_kg_actuel: number
  ecart_besoin_kg: number | null
  arbitree: number
  /** Le prix et la remise d'avant la demande de prix (plan ou saisie), poses a son envoi. */
  prix_unitaire_avant_demande?: number | null
  remise_pct_avant_demande?: number | null
  /** Quand la reponse du fournisseur a ete saisie sur la ligne. */
  date_reponse_prix?: string | null
}

/** Le prix NET d'une ligne (remise deduite) : celui que compare le controle C59. */
const net = (prix: number, remise: number | null | undefined) => prix * (1 - Number(remise ?? 0) / 100)

/** L'ecart, en %, du prix confirme sur le prix d'avant la demande ; null sans prix d'avant. */
function ecartPrix(l: LigneBc, prix = l.prix_unitaire_devise, remise = l.remise_pct): number | null {
  const avant = l.prix_unitaire_avant_demande
  if (avant == null || !(avant > 0) || prix == null) return null
  const base = net(Number(avant), l.remise_pct_avant_demande)
  if (!(base > 0)) return null
  return ((net(Number(prix), remise) - base) / base) * 100
}

/** Un nombre tel qu'il se tape : virgule decimale. */
const enSaisie = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

export function BonCommande() {
  const { id = '' } = useParams()
  const droits = useDroits(MODULE)
  const { moi } = useAuth()
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const ouvrir = useOuvrirVue()
  const confirmation = useConfirmation()
  const [entete, setEntete] = useState({
    date_bc: '',
    date_livraison_prevue: '',
    conditions_paiement: '',
    mention_expedition: '',
    nombre_conteneurs: '',
    notes: '',
    code_devise: '',
  })
  /** Lignes retouchees mais pas encore enregistrees, par identifiant. */
  const [brouillon, setBrouillon] = useState<
    Record<string, { quantite_commandee_unite?: number; prix_unitaire_devise?: number }>
  >({})
  /**
   * Lignes ajoutees pendant la saisie, pas encore creees cote serveur.
   *
   * Elles vivent ici jusqu'a l'enregistrement, comme les modifications : ajouter
   * une ligne est une intention, pas un engagement. Sinon une ligne ajoutee par
   * erreur existe deja quand on s'en apercoit, et il faut la supprimer — donc
   * laisser une trace de quelque chose qui n'aurait jamais du exister.
   */
  const [nouvelles, setNouvelles] = useState<LigneSaisie[]>([])
  /*
   * CES DEUX REFERENCES SONT DECLAREES TOUT EN HAUT, avant le moindre usage.
   *
   * Elles vivaient trois cents lignes plus bas, a cote de l'effet qui les
   * remplit — ce qui se defend a la lecture, mais pas a l'execution : `const`
   * n'est pas remonte comme une fonction, et `initiales.current` lu pendant le
   * rendu levait « Cannot access 'initiales' before initialization ». React
   * perdait tout le composant, donc la page entiere restait blanche.
   *
   * LE DEFAUT A DORMI longtemps parce que `nouvelles` etait toujours vide :
   * `filter` n'appelait jamais sa fonction, donc personne ne lisait la
   * reference. Le jour ou la grille s'est enfin remplie, il s'est reveille —
   * d'ou l'impression qu'une reparation avait casse quelque chose, alors
   * qu'elle n'avait fait que decouvrir.
   *
   * `amorcee` retient POUR QUEL bon la grille a ete remplie : sans ce garde,
   * chaque rafraichissement rechargerait les lignes du serveur et effacerait
   * ce que l'acheteur vient de corriger sans l'avoir enregistre.
   */
  const amorcee = useRef<string | null>(null)
  /** Ce que chaque ligne valait a son dernier enregistrement, par identifiant. */
  /*
   * UN ETAT, PAS UNE REFERENCE — et c'est une correction, pas un detail.
   *
   * Ces valeurs sont LUES PENDANT LE RENDU : c'est elles qui decident si le
   * bouton vert d'une ligne s'allume. Dans un `useRef`, les modifier ne
   * redessine rien ; le bouton serait reste allume apres l'enregistrement,
   * ou eteint alors qu'il y avait quelque chose a envoyer, jusqu'a ce qu'un
   * autre evenement provoque un rendu par hasard. `react-hooks/refs` le
   * signale, et il a raison : ce qui commande l'affichage doit etre un etat.
   */
  const [initiales, setInitiales] = useState<Map<string, string>>(new Map())
  /**
   * OU LA FRAPPE VA CHERCHER — le plan, ou tout le catalogue.
   *
   * L'ecran de modification n'offrait pas ce choix : il ne proposait que les
   * references du fournisseur, sans jamais montrer ce que le plan d'achat
   * reclamait ni permettre d'en sortir. La creation, elle, l'offrait depuis
   * toujours.
   */
  const [mode, setMode] = useState<'PLAN' | 'CATALOGUE'>('PLAN')
  /** Lignes existantes marquees pour suppression, appliquee a l'enregistrement. */
  const [supprimees, setSupprimees] = useState<string[]>([])

  const qBc = useQuery({
    queryKey: ['bons-commande'],
    queryFn: ({ signal }) => api.get<Bc[]>('/api/bons-commande', { signal }),
  })
  const bc = qBc.data?.find((b) => b.id_bc === id) ?? null

  const qLignes = useQuery({
    queryKey: ['lignes-bc', id],
    queryFn: ({ signal }) => api.get<LigneBc[]>(`/api/bons-commande/${id}/lignes`, { signal }),
    enabled: !!id,
  })

  /**
   * CE QUE LE PLAN RECLAME CHEZ LE FOURNISSEUR DE CE BON.
   *
   * L'ecran de modification l'ignorait : il ne chargeait que les references
   * « commandables » du bon. Or ajouter une ligne apres coup demande la meme
   * information qu'a la creation — ce qui manque, en quelle quantite, a quel
   * prix.
   */
  const qPlan = useQuery({
    queryKey: ['refs-plan', bc?.code_fournisseur],
    queryFn: () =>
      api.get<RefLigne[]>(
        `/api/references-commandables?code_fournisseur=${encodeURIComponent(bc!.code_fournisseur)}`,
      ),
    enabled: !!bc?.code_fournisseur,
  })
  const proposees = useMemo(
    () => (qPlan.data ?? []).filter((r) => (r.qte_a_commander_kg ?? 0) > 0),
    [qPlan.data],
  )
  const parPlan = useMemo(
    () => new Map((qPlan.data ?? []).map((r) => [r.code_reference, r])),
    [qPlan.data],
  )
  const chercherCatalogue = async (motif: string): Promise<RefLigne[]> => {
    const p = new URLSearchParams({
      code_fournisseur: bc?.code_fournisseur ?? '',
      toutes: '1',
      recherche: motif,
      limite: '25',
    })
    return api.get<RefLigne[]>(`/api/references-commandables?${p}`)
  }

  /** Corriger la fiche de la reference depuis la commande, comme a la creation. */
  const corrigerReference = useMutation({
    mutationFn: ({ code, champ, valeur, version }: { code: string; champ: string; valeur: string; version?: number | null }) =>
      api.patch<{ version: number }>(`/api/catalogue/${encodeURIComponent(code)}`, { [champ]: valeur, version }),
    onSuccess: (r, v) => {
      // La fiche a change de version : la correction suivante presentera la nouvelle.
      setNouvelles((ls) => ls.map((l) => (l.code_reference === v.code ? { ...l, version_reference: r.version } : l)))
      toast.success('Fiche de la référence corrigée')
      void qc.invalidateQueries({ queryKey: ['refs-plan'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Correction impossible.'),
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['bons-commande'] })
    void qc.invalidateQueries({ queryKey: ['lignes-bc'] })
    void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
    void qc.invalidateQueries({ queryKey: ['refs-commandables'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  // Le formulaire se recharge quand le bon arrive ou change de version : sans
  // cela, ouvrir un bon afficherait les valeurs du precedent.
  useEffect(() => {
    if (!bc) return
    setEntete({
      date_bc: bc.date_bc?.slice(0, 10) ?? '',
      date_livraison_prevue: bc.date_livraison_prevue?.slice(0, 10) ?? '',
      conditions_paiement: bc.conditions_paiement ?? '',
      mention_expedition: bc.mention_expedition ?? '',
      nombre_conteneurs: bc.nombre_conteneurs != null ? String(bc.nombre_conteneurs) : '',
      notes: bc.notes ?? '',
      code_devise: bc.code_devise,
    })
  }, [bc?.id_bc, bc?.date_bc, bc?.date_livraison_prevue, bc?.conditions_paiement, bc?.notes, bc?.code_devise])
  const qDevises = useQuery({ queryKey: ['devises'], queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }) })

  const enteteModifie =
    !!bc &&
    (entete.date_bc !== (bc.date_bc?.slice(0, 10) ?? '') ||
      entete.date_livraison_prevue !== (bc.date_livraison_prevue?.slice(0, 10) ?? '') ||
      entete.conditions_paiement !== (bc.conditions_paiement ?? '') ||
      entete.mention_expedition !== (bc.mention_expedition ?? '') ||
      entete.nombre_conteneurs !==
        (bc.nombre_conteneurs != null ? String(bc.nombre_conteneurs) : '') ||
      entete.notes !== (bc.notes ?? '') ||
      entete.code_devise !== bc.code_devise)

  const confirmationTaux = useConfirmation()
  /* LA VALIDATION D'UN BON EN DEVISE, saisie sur la page (regle 10) : le cours
     du jour est propose ; un autre taux se retient avec son motif. */
  const [validation, setValidation] = useState<{ taux: string; motif: string } | null>(null)
  /* LE MOTIF D'UN RENVOI EN BROUILLON OU D'UNE DEMANDE DE PRIX SAUTEE
     (21/10/2026), saisi sur la page. */
  const [motifAction, setMotifAction] = useState<{
    cible: 'BROUILLON' | 'EN_ATTENTE_VALIDATION'
    motif: string
  } | null>(null)
  const changerStatut = useMutation({
    mutationFn: (
      c: string | { statut: string; taux_saisi?: number; motif_taux?: string; confirme_taux?: boolean; motif?: string },
    ) => api.put(`/api/bons-commande/${id}/statut`, typeof c === 'string' ? { statut: c } : c),
    onSuccess: (_r, c) => {
      const statut = typeof c === 'string' ? c : c.statut
      toast.success(`Bon passé en « ${libelleStatut('bon_commande', statut).toLowerCase()} »`)
      setValidation(null)
      setMotifAction(null)
      rafraichir()
    },
    onError: (e, c) => {
      /* Un taux a plus de 3 % du cours BAM se confirme, il ne se refuse pas sec. */
      if (e instanceof ErreurApi && e.estRegle('TAUX-ECART') && typeof c !== 'string') {
        confirmationTaux.demander({
          titre: 'Taux éloigné du cours Bank Al-Maghrib',
          description: e.messageSansCode,
          libelleConfirmer: 'Je confirme ce taux',
          action: () => changerStatut.mutate({ ...c, confirme_taux: true }),
        })
        return
      }
      echec(e)
    },
  })

  /**
   * SUPPRIMER LE BROUILLON, depuis le bon lui-meme.
   *
   * L'action n'existait que dans la liste : on ouvrait un brouillon, on
   * decidait qu'il n'avait pas lieu d'etre, et il fallait ressortir pour s'en
   * defaire. C'est le moment ou l'on sait, donc le moment ou l'on doit pouvoir.
   *
   * SUPPRIMER ET NON ANNULER. Un bon annule reste en base, dans les listes et
   * dans les etats, avec un numero qui n'a jamais rien engage — il encombre
   * sans rien prouver. L'annulation garde son sens des que le bon est VALIDE :
   * la, le numero est parti chez un fournisseur, et l'effacer creerait un trou
   * qu'aucun controle ne saurait expliquer. Le serveur tient la meme frontiere
   * et refuse au-dela de EN_ATTENTE_VALIDATION.
   */
  const supprimerBon = useMutation({
    mutationFn: () => api.delete(`/api/bons-commande/${id}`),
    onSuccess: () => {
      toast.success('Brouillon supprime', {
        description: 'Il n’engageait rien : ses propositions d’achat sont revenues au plan.',
      })
      void qc.invalidateQueries({ queryKey: ['bons-commande'] })
      void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
      naviguer('/bons-commande')
    },
    onError: echec,
  })

  /**
   * L'EN-TETE ET LES LIGNES PARTENT ENSEMBLE, sur le bouton du bas.
   *
   * Le petit bouton de chaque ligne ne fait que la VALIDER a l'ecran ; rien
   * n'est ecrit en base avant ce clic-ci, et il refuse de partir tant qu'une
   * ligne n'est pas validee.
   *
   * UNE SEULE SOURCE : la grille. Les suppressions viennent du registre
   * `supprimees`, ecrit par la corbeille et par elle seule — jamais d'une
   * deduction. C'est la deduction « absente de la grille, donc a supprimer »
   * qui avait efface une ligne de 36 tonnes sans rien signaler.
   */
  // Declaree ici parce que `enregistrer` la lit ; l'effet qui la tient a jour
  // vient plus bas, apres `aEnregistrer` dont il depend.
  const [versionLue, setVersionLue] = useState<number | undefined>(undefined)
  const enregistrer = useMutation({
    mutationFn: async () => {
      // UNE LIGNE PAR REFERENCE (21/10/2026) : une ligne qui repete une reference
      // part fondue dans celle qui la porte (le serveur fait de meme).
      const fondues = fusionnerParReference(nouvelles).lignes
      const aCreer = fondues.filter((n) => !n.idExistant)
      const aCorriger = fondues.filter(
        (n) => n.idExistant && JSON.stringify(corpsLigne(n)) !== initiales.get(n.idExistant),
      )
      // LA VERSION S'ENCHAINE (19/10/2026) : en-tete puis lignes, chacun sous le
      // verrou du document ; chaque reponse rend la version que le suivant presente.
      let v = versionLue
      const suivre = (r: { version?: number }) => { v = r.version ?? v }
      if (enteteModifie) suivre(await api.patch<{ version?: number }>(`/api/bons-commande/${id}`, { ...entete, version: v }))
      for (const ligne of supprimees) {
        suivre(await api.delete<{ version?: number }>(`/api/bons-commande/${id}/lignes/${ligne}?version=${v ?? ''}`))
      }
      for (const n of aCorriger) {
        suivre(await api.patch<{ version?: number }>(`/api/bons-commande/${id}/lignes/${n.idExistant}`, { ...corpsLigne(n), version: v }))
      }
      for (const n of aCreer) {
        suivre(await api.post<{ version?: number }>(`/api/bons-commande/${id}/lignes`, { ...corpsLigne(n), version: v }))
      }
      return { crees: aCreer.length, corrigees: aCorriger.length, retirees: supprimees.length }
    },
    onSuccess: (r) => {
      const parts = [
        r.crees ? `${r.crees} ajoutée(s)` : null,
        r.corrigees ? `${r.corrigees} corrigée(s)` : null,
        r.retirees ? `${r.retirees} retirée(s)` : null,
      ].filter(Boolean)
      toast.success('Bon enregistré', {
        description: parts.length ? `Lignes : ${parts.join(' · ')}.` : undefined,
      })
      setSupprimees([])
      // La grille se recharge depuis le serveur : c'est lui qui detient
      // desormais les identifiants des lignes qu'on vient de creer.
      amorcee.current = null
      rafraichir()
    },
    onError: echec,
  })

  /** Retirer une ligne : de l'ecran tout de suite, de la base a l'enregistrement. */
  const retirerLigne = (ligne: LigneSaisie) => {
    if (ligne.idExistant) setSupprimees((s) => [...s, ligne.idExistant as string])
    setNouvelles((ls) => ls.filter((x) => x.cle !== ligne.cle))
  }

  /* `lignesChargees` a disparu ici. Il servait a deviner, au moment de
     l'enregistrement global, quelles lignes avaient ete retirees de la grille
     — une deduction qui se trompait. Une ligne retiree est maintenant
     supprimee au moment ou on la retire : il n'y a plus rien a deviner. */

  /** Marque ou demarque une ligne existante pour suppression. */
  const basculerSuppression = (ligne: string) =>
    setSupprimees((l) => (l.includes(ligne) ? l.filter((x) => x !== ligne) : [...l, ligne]))

  const lignes = useMemo(() => qLignes.data ?? [], [qLignes.data])


  // --- Brouillon local des lignes -------------------------------------------
  // Une valeur n'entre dans le brouillon que si elle DIFFERE de celle du
  // serveur : reouvrir une cellule et la refermer telle quelle ne marque rien.
  const stage = (ligne: LigneBc, champ: 'quantite_commandee_unite' | 'prix_unitaire_devise', v: number) =>
    setBrouillon((b) => {
      const reste = { ...b }
      const courant = { ...(reste[ligne.id_ligne_bc] ?? {}) }
      if (v === (ligne[champ] as number | undefined)) delete courant[champ]
      else courant[champ] = v
      if (Object.keys(courant).length === 0) delete reste[ligne.id_ligne_bc]
      else reste[ligne.id_ligne_bc] = courant
      return reste
    })

  /** Valeur a afficher : celle du brouillon si elle existe, sinon le serveur. */
  const valeurDe = (l: LigneBc, champ: 'quantite_commandee_unite' | 'prix_unitaire_devise') =>
    brouillon[l.id_ligne_bc]?.[champ] ?? (l[champ] as number | undefined) ?? null

  const ligneModifiee = (l: LigneBc) => !!brouillon[l.id_ligne_bc]
  /**
   * LE MONTANT D'UNE LIGNE, NET DE REMISE, ARRONDI AU CENTIME : la formule
   * meme de `ligne_bc.total_ligne_devise`. La colonne oubliait la remise, et
   * affichait donc un montant que ni le bon ni la base ne retenaient.
   */
  const montantLigne = (l: LigneBc) =>
    auCentime(
      (valeurDe(l, 'quantite_commandee_unite') ?? 0) *
        (valeurDe(l, 'prix_unitaire_devise') ?? 0) *
        (1 - Number(l.remise_pct ?? 0) / 100),
    )
  /*
   * MODIFIEE VEUT DIRE « QUI A CHANGE », pas « qui est dans la grille ».
   *
   * Compter toute ligne chargee affichait « 1 modifiee(s) » des l'ouverture,
   * sans que personne ait touche a rien. On compare donc chaque ligne a ce
   * qu'elle valait a son dernier enregistrement, par le corps meme qui partira
   * au serveur : ce qui ne changerait rien pour lui ne compte pas.
   *
   * Ce nombre ne commande plus aucun bouton — chaque ligne a le sien. Il ne
   * sert qu'a avertir, en bas de page, qu'il reste des lignes non enregistrees
   * avant de quitter l'ecran.
   */
  const nbModifiees = nouvelles.filter(
    (n) => n.idExistant && JSON.stringify(corpsLigne(n)) !== initiales.get(n.idExistant),
  ).length
  const nonValidees = nouvelles.filter((n) => !n.valide)
  const nbAjoutees = nouvelles.filter((n) => !n.idExistant).length
  const aEnregistrer =
    enteteModifie || supprimees.length > 0 || nbAjoutees > 0 || nbModifiees > 0

  /**
   * LA VERSION SUR LAQUELLE REPOSE LA SAISIE (verrou optimiste, 17/10/2026).
   *
   * Elle part avec l'en-tete : si quelqu'un a modifie le bon entre-temps, le
   * serveur refuse en le nommant, au lieu d'ecraser sa saisie en silence.
   *
   * POURQUOI PAS `bc.version` AU MOMENT D'ENREGISTRER. La liste des bons se
   * relit toute seule (retour sur la fenetre). Envoyer la version du moment
   * enverrait celle de l'AUTRE, et le serveur croirait la saisie a jour : le
   * verrou serait desarme sans que personne le voie.
   *
   * La regle : tant que rien n'attend d'etre enregistre, il n'y a rien a perdre,
   * on suit la derniere version — c'est aussi ce qui evite un faux conflit
   * contre soi-meme apres avoir enregistre ses propres lignes. Des qu'une
   * modification attend, la version se fige sur celle qu'on a modifiee.
   */
  /* LA REPONSE DU FOURNISSEUR (demande de prix, 21/10/2026) : prix et remise
     confirmes, saisis par ligne, enregistres ensemble. Une valeur ne compte
     que si elle differe de celle du serveur. */
  const [reponses, setReponses] = useState<Record<string, { prix?: string; remise?: string }>>({})
  const prixSaisi = (l: LigneBc) => {
    const t = reponses[l.id_ligne_bc]?.prix
    return t === undefined ? (l.prix_unitaire_devise ?? null) : lireNombre(t)
  }
  const remiseSaisie = (l: LigneBc) => {
    const t = reponses[l.id_ligne_bc]?.remise
    return t === undefined ? Number(l.remise_pct ?? 0) : t.trim() === '' ? 0 : lireNombre(t)
  }
  const reponsesModifiees = lignes.filter(
    (l) =>
      (reponses[l.id_ligne_bc]?.prix !== undefined && prixSaisi(l) !== (l.prix_unitaire_devise ?? null)) ||
      (reponses[l.id_ligne_bc]?.remise !== undefined && remiseSaisie(l) !== Number(l.remise_pct ?? 0)),
  )
  const reponsesIllisibles = lignes.filter((l) => {
    const p = prixSaisi(l)
    const r = remiseSaisie(l)
    return p == null || !(p > 0) || r == null || !(r >= 0 && r < 100)
  })

  useEffect(() => {
    if (bc?.version != null && !aEnregistrer && reponsesModifiees.length === 0) setVersionLue(bc.version)
  }, [bc?.version, aEnregistrer, reponsesModifiees.length])

  const enregistrerReponse = useMutation({
    mutationFn: async () => {
      let v = versionLue
      for (const l of reponsesModifiees) {
        const r = await api.patch<{ version?: number }>(`/api/bons-commande/${id}/lignes/${l.id_ligne_bc}`, {
          prix_unitaire_devise: prixSaisi(l),
          remise_pct: remiseSaisie(l),
          version: v,
        })
        v = r.version ?? v
      }
      return reponsesModifiees.length
    },
    onSuccess: (n) => {
      toast.success('Réponse du fournisseur enregistrée', { description: `${n} ligne(s) mise(s) à jour.` })
      setReponses({})
      rafraichir()
    },
    onError: echec,
  })

  // Les lignes ajoutees s'affichent avec les autres, marquees « nouvelle ».
  // Les voir dans le tableau evite de saisir deux fois la meme reference sans
  // s'en rendre compte.
  const lignesAffichees: LigneBc[] = [
    ...lignes,
    // SEULES LES LIGNES NEUVES s'ajoutent au tableau : celles chargees pour
    // correction y figurent deja, et les montrer deux fois ferait croire a un
    // doublon.
    ...nouvelles.filter((n) => estPrete(n) && !n.idExistant).map((n, i) => ({
      id_ligne_bc: n.cle,
      ligne_numero: lignes.length + i + 1,
      code_reference: n.code_reference,
      reference_designation: n.intitule,
      // L'UNITE, LE POIDS ET LE PRIX VIENNENT DE LA SAISIE, plus de suppositions.
      // La ligne en attente s'affiche donc exactement comme elle sera
      // enregistree — y compris son poids converti, qui faisait defaut.
      unite_commande: n.unite,
      quantite_commandee_unite: Number(n.qte),
      quantite_commandee_kg: kgDe(n) ?? Number(n.qte),
      quantite_recue_kg: 0,
      quantite_restante_kg: kgDe(n) ?? Number(n.qte),
      prix_unitaire_devise: Number(n.prix) * (facteurVersKg(n.unite, n.cond) ?? 1),
      total_ligne_devise: totalDe(n),
      total_ligne_mad: totalDe(n) * (bc?.taux_change_engage ?? 1),
      taux_change_engage: bc?.taux_change_engage,
      code_devise: bc?.code_devise,
      // Le conditionnement et la categorie viennent du catalogue, que la ligne
      // en attente n'a pas encore consulte : ils s'afficheront apres
      // enregistrement, quand le serveur les joindra.
      couleur: null,
      code_categorie: null,
      categorie_libelle: null,
      poids_bobine_kg: null,
      bobines_par_palette: null,
      nb_palettes: null,
      statut: 'EN_ATTENTE',
      besoin_kg_origine: null,
      besoin_kg_actuel: 0,
      ecart_besoin_kg: null,
      arbitree: 0,
    })),
  ]
  /**
   * NOUVELLE VEUT DIRE « QUI N'EXISTE PAS ENCORE ». Une ligne chargee dans la
   * grille pour y etre corrigee garde son identifiant : la compter comme
   * nouvelle la faisait passer pour un ajout dans le tableau et dans le
   * decompte du bas.
   */
  const estNouvelle = (l: LigneBc) =>
    nouvelles.some((n) => n.cle === l.id_ligne_bc && !n.idExistant)

  /* LE BROUILLON SEUL SE MODIFIE (21/10/2026) : au controle, en demande de prix
     et en attente de validation, le bon est fige — le serveur et la base le
     tiennent aussi. Pour corriger, on le renvoie en brouillon. */
  const modifiable = !!droits.peutEcrire && bc?.statut === 'BROUILLON'
  /*
   * ON N'AMORCE QUE SUR UN SUCCES, jamais sur « plus en chargement ».
   *
   * Le garde testait `!qLignes.isLoading`. Or une requete EN ERREUR n'est pas
   * en chargement : elle passait donc le garde avec `lignes` vide, posait
   * `amorcee.current = id`, et remplissait la grille de rien. Le second garde
   * faisait le reste — au reessai, la requete reussissait, mais `amorcee`
   * disait deja « ce bon est fait » et les lignes n'entraient JAMAIS.
   *
   * Une page ouverte pendant une panne de base restait donc vide pour de bon,
   * meme apres la reparation, sans un seul message pour le dire. C'est ce qui
   * s'est produit le 25/09 : quatre migrations manquaient, la lecture des
   * lignes echouait, et l'ecran est reste muet une fois la base reparee.
   */
  useEffect(() => {
    if (!modifiable || !id || !qLignes.isSuccess) return
    if (amorcee.current === id) return
    amorcee.current = id
    // RELUE DEPUIS LA BASE, LA LIGNE ARRIVE VALIDEE — donc figee : une frappe
    // egaree ne la modifie pas en passant. On la rouvre au crayon.
    const chargees = lignes.map((l) => ({
      ...depuisLigneEnregistree(l, parPlan.get(l.code_reference ?? '')),
      valide: true,
    }))
    setInitiales(
      new Map(chargees.map((l) => [l.idExistant as string, JSON.stringify(corpsLigne(l))])),
    )
    setNouvelles(chargees)
  }, [id, modifiable, qLignes.isSuccess, lignes, parPlan])

  /* LE SUPERVISEUR VALIDE CE QU'IL A CREE, sur decision de la direction. La
     separation des taches reste en vigueur pour tous les autres roles : dans
     une PME, l'interdire au seul compte habilite ne cree pas un second regard,
     cela cree un bon bloque. Le serveur applique la meme exception — l'ecran
     ne fait que ne pas griser un bouton qui fonctionnerait. */
  const estCreateur = bc?.createur === moi?.login && moi?.role !== 'ADMIN'
  /* LE CONTROLE SUIT LA MEME REGLE (21/10/2026) : un autre compte que le
     createur, l'ADMIN excepte. */
  const estCreateurControle = estCreateur
  const plafond = moi?.plafond_validation_bc_mad ?? null
  const depassePlafond = plafond != null && (bc?.montant_total_mad ?? 0) > plafond

  const alertes = useMemo(
    () =>
      lignes.filter(
        (l) =>
          l.besoin_kg_origine != null &&
          Math.abs(l.ecart_besoin_kg ?? 0) > Math.max(1, l.besoin_kg_origine * 0.01),
      ).length,
    [lignes],
  )

  const colonnes: ColonneDT<LigneBc>[] = [
    {
      champ: 'code_reference',
      entete: 'Référence',
      // UNE PRESTATION N'A PAS DE REFERENCE : c'est son libelle qui la nomme.
      // Sans ce repli, la ligne de transport s'affichait vide.
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {l.code_reference ?? l.libelle ?? '—'}
          </div>
          <div className="truncate text-[11px] text-attenue-texte">
            {l.code_reference ? l.reference_designation : 'prestation — n’entre pas en stock'}
          </div>
        </div>
      ),
    },
    {
      champ: 'quantite_commandee_unite',
      entete: 'Commande',
      numerique: true,
      largeur: '150px',
      rendu: (l) => {
        const v = valeurDe(l, 'quantite_commandee_unite') ?? 0
        const change = v !== l.quantite_commandee_unite
        return (
          <CelluleEditable
            valeur={v}
            affichage={
              <span className={change ? 'font-medium text-primaire' : undefined}>
                {fmt.nombre(v, 2)} {l.unite_commande}
                {change && (
                  <span className="block text-[11px] text-attenue-texte line-through">
                    {fmt.nombre(l.quantite_commandee_unite, 2)}
                  </span>
                )}
              </span>
            }
            type="nombre"
            min={0}
            aligneDroite
            modifiable={modifiable && droits.modifiable('quantite_commandee_unite')}
            surValider={(x) => x != null && stage(l, 'quantite_commandee_unite', Number(x))}
          />
        )
      },
    },
    {
      // LA DEVISE EST CELLE DU BON, dite une fois dans le titre de colonne —
      // jamais repetee sur chaque ligne (decision du 01/10/2026).
      champ: 'prix_unitaire_devise',
      entete: `Prix unitaire ${bc?.code_devise ?? ''}`.trim(),
      numerique: true,
      largeur: '150px',
      rendu: (l) => {
        const v = valeurDe(l, 'prix_unitaire_devise')
        const change = v !== (l.prix_unitaire_devise ?? null)
        return (
          <CelluleEditable
            valeur={v}
            affichage={
              v == null ? (
                '—'
              ) : (
                <span className={change ? 'font-medium text-primaire' : undefined}>
                  {fmt.nombre(v, 4)}
                  {change && l.prix_unitaire_devise != null && (
                    <span className="block text-[11px] text-attenue-texte line-through">
                      {fmt.nombre(l.prix_unitaire_devise, 4)}
                    </span>
                  )}
                </span>
              )
            }
            type="nombre"
            min={0}
            aligneDroite
            modifiable={modifiable && droits.modifiable('prix_unitaire_devise')}
            surValider={(x) => x != null && stage(l, 'prix_unitaire_devise', Number(x))}
          />
        )
      },
    },
    {
      champ: 'categorie_libelle',
      entete: 'Type',
      largeur: '120px',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate">
            {l.type_ligne === 'SERVICE'
              ? 'Prestation'
              : (l.categorie_libelle ?? l.code_categorie ?? '—')}
          </div>
          {l.couleur && (
            <div className="truncate text-[11px] text-attenue-texte">{l.couleur}</div>
          )}
        </div>
      ),
    },
    {
      // Encombrement, pour le transporteur et le quai. Sans conditionnement
      // declare, la question n'a pas de reponse — on l'affiche vide plutot que
      // de poser un zero qui passerait pour une palette de rien.
      champ: 'nb_palettes',
      entete: 'Palettes',
      numerique: true,
      largeur: '110px',
      secondaire: true,
      rendu: (l) =>
        l.nb_palettes == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right">
            <div className="tabular-nums">{fmt.nombre(l.nb_palettes, 2)}</div>
            {l.bobines_par_palette != null && (
              <div className="text-[11px] text-attenue-texte tabular-nums">
                {l.bobines_par_palette} bob./pal.
              </div>
            )}
          </div>
        ),
    },
    {
      champ: 'total_ligne_devise',
      entete: `Montant ${bc?.code_devise ?? 'devise'}`,
      numerique: true,
      largeur: '140px',
      rendu: (l) => {
        return fmt.nombre(montantLigne(l), 2)
      },
    },
    {
      // Le montant en dirhams n'est pas stocke : il se deduit du taux ENGAGE du
      // bon (RG-09). Le recopier sur la ligne creerait une seconde verite, qui
      // divergerait des que le taux serait reevalue a la validation.
      champ: 'total_ligne_mad',
      entete: 'Montant MAD',
      numerique: true,
      largeur: '140px',
      rendu: (l) => {
        const taux = l.taux_change_engage ?? 1
        return (
          <div className="text-right tabular-nums font-medium">{fmt.nombre(auCentime(montantLigne(l) * taux), 2)}</div>
        )
      },
    },
    {
      champ: 'quantite_recue_kg',
      entete: 'Reçu / reste',
      numerique: true,
      largeur: '140px',
      rendu: (l) => (
        <div className="text-right">
          <div className="tabular-nums">{fmt.nombre(l.quantite_recue_kg, 0)} kg</div>
          {l.quantite_restante_kg > 0.001 && (
            <div className="text-[11px] text-attenue-texte tabular-nums">
              reste {fmt.nombre(l.quantite_restante_kg, 0)}
            </div>
          )}
        </div>
      ),
    },
    {
      // Le besoin qui a justifie la ligne, confronte a celui d'aujourd'hui.
      // Calcule a la lecture : l'alerte ne peut donc pas etre perimee.
      champ: 'ecart_besoin_kg',
      entete: 'Besoin',
      numerique: true,
      largeur: '175px',
      rendu: (l) => {
        if (l.besoin_kg_origine == null) {
          return <span className="text-attenue-texte">saisie manuelle</span>
        }
        const ecart = l.ecart_besoin_kg ?? 0
        const notable = Math.abs(ecart) > Math.max(1, l.besoin_kg_origine * 0.01)
        return (
          <div className="text-right">
            <div className={cn('tabular-nums', notable && 'font-medium')}>
              {fmt.nombre(l.besoin_kg_actuel, 0)} kg
            </div>
            {notable && (
              <div className={ecart < 0 ? 'text-[11px] text-danger' : 'text-[11px] text-info'}>
                {ecart < 0 ? '▼' : '▲'} {fmt.nombre(Math.abs(ecart), 0)} kg depuis la conversion
              </div>
            )}
          </div>
        )
      },
    },
    {
      champ: 'arbitree',
      entete: 'Suivi',
      largeur: '160px',
      rendu: (l) =>
        estNouvelle(l) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="succes">nouvelle</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() => setNouvelles((n) => n.filter((x) => x.cle !== l.id_ligne_bc))}
            >
              retirer
            </button>
          </div>
        ) : supprimees.includes(l.id_ligne_bc) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="danger">a retirer</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() => basculerSuppression(l.id_ligne_bc)}
            >
              garder
            </button>
          </div>
        ) : ligneModifiee(l) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="alerte">modifiee</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() =>
                setBrouillon((b) => {
                  const { [l.id_ligne_bc]: _, ...reste } = b
                  return reste
                })
              }
            >
              annuler
            </button>
          </div>
        ) : l.besoin_kg_origine == null ? (
          <span className="text-attenue-texte">—</span>
        ) : l.arbitree ? (
          <Badge ton="neutre">arbitree</Badge>
        ) : (
          <Badge ton="info">suit le plan</Badge>
        ),
    },
  ]

  if (qBc.isLoading) return <Chargement />
  if (!bc) {
    return (
      <div>
        <EnTetePage titre="Bon de commande" description="Introuvable." />
        <Alerte ton="alerte">
          Ce bon n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/bons-commande')}>
            Revenir à la liste
          </button>
        </Alerte>
      </div>
    )
  }

  return (
    <div>
      <EnTetePage
        titre={`${bc.numero_bc} — ${bc.fournisseur_nom}`}
        description={
          `Établi le ${fmt.date(bc.date_bc)}${bc.createur ? ` par ${bc.createur}` : ''}` +
          (bc.code_devise === 'MAD'
            ? ''
            : bc.date_validation
              ? ` · taux engagé ${fmt.nombre(bc.taux_change_engage, 4)} ${bc.code_devise}/MAD` +
                (bc.date_cours_engage ? ` (cours du ${fmt.date(bc.date_cours_engage)}` : ' (') +
                (bc.source_taux_engage === 'SAISI' ? ', saisi à la validation)' : ')')
              : ` · taux indicatif du jour ${bc.taux_du_jour != null ? fmt.nombre(bc.taux_du_jour, 4) : '—'} ${bc.code_devise}/MAD, engagé à la validation`)
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => naviguer('/bons-commande')}>
              <ArrowLeft />
              Retour
            </Bouton>
            {/* L'impression reste ouverte sur un brouillon : on imprime pour
                relire avant d'engager, pas seulement pour envoyer. Le document
                porte alors la mention « brouillon ». */}
            <Bouton variante="contour" onClick={() => ouvrir(`/bons-commande/${id}/etat`)}>
              <Printer />
              Imprimer
            </Bouton>
            {/* LE CIRCUIT DU 21/10/2026 : brouillon → contrôle (un autre compte)
                → demande de prix (ou saut motivé) → validation de la direction. */}
            {droits.peutEcrire && bc.statut === 'BROUILLON' && (
              <Bouton
                variante="contour"
                onClick={() => changerStatut.mutate('EN_CONTROLE')}
                disabled={lignes.length === 0 || aEnregistrer}
                title={
                  lignes.length === 0
                    ? 'Un bon sans ligne ne part pas au contrôle'
                    : aEnregistrer
                      ? 'Enregistrez d’abord vos modifications'
                      : undefined
                }
              >
                <Send />
                Envoyer au contrôle
              </Bouton>
            )}
            {droits.peutEcrire && bc.statut === 'EN_CONTROLE' && (
              <>
                <Bouton
                  onClick={() => changerStatut.mutate('DEMANDE_PRIX')}
                  disabled={estCreateurControle}
                  title={estCreateurControle ? 'B4 : un autre compte que le créateur contrôle le bon' : undefined}
                >
                  <ClipboardCheck />
                  Contrôlé : demande de prix
                </Bouton>
                <Bouton
                  variante="contour"
                  onClick={() => setMotifAction({ cible: 'EN_ATTENTE_VALIDATION', motif: '' })}
                  disabled={estCreateurControle}
                  title={estCreateurControle ? 'B4 : un autre compte que le créateur contrôle le bon' : undefined}
                >
                  <SkipForward />
                  Sauter la demande de prix
                </Bouton>
              </>
            )}
            {droits.peutEcrire && bc.statut === 'DEMANDE_PRIX' && (
              <>
                <Bouton
                  variante="contour"
                  onClick={() => ouvrir(`/bons-commande/${id}/etat?document=demande-prix`)}
                >
                  <FileText />
                  Imprimer la demande de prix
                </Bouton>
                {/* UNE SEULE ACTION PRINCIPALE : tant qu'une reponse n'est pas
                    enregistree, c'est « Enregistrer la reponse » ; ensuite, ceci. */}
                <Bouton
                  variante={reponsesModifiees.length > 0 ? 'contour' : 'principal'}
                  onClick={() => changerStatut.mutate('EN_ATTENTE_VALIDATION')}
                  disabled={reponsesModifiees.length > 0}
                  title={reponsesModifiees.length > 0 ? 'Enregistrez d’abord la réponse du fournisseur' : undefined}
                >
                  <Send />
                  Soumettre à validation
                </Bouton>
              </>
            )}
            {droits.peutEcrire && ['EN_CONTROLE', 'DEMANDE_PRIX', 'EN_ATTENTE_VALIDATION'].includes(bc.statut) && (
              <>
                <Bouton variante="contour" onClick={() => setMotifAction({ cible: 'BROUILLON', motif: '' })}>
                  <CornerUpLeft />
                  Renvoyer en brouillon
                </Bouton>
                <Bouton
                  variante="contour"
                  className="text-danger hover:bg-danger/10"
                  onClick={() =>
                    confirmation.demander({
                      titre: `Annuler ${bc.numero_bc} ?`,
                      destructif: true,
                      libelleConfirmer: 'Annuler le bon',
                      description:
                        'Ses lignes seront annulées et les propositions d’achat qui les ont produites ' +
                        'reviendront au plan. Le bon restera visible, marqué annulé.',
                      action: () => changerStatut.mutate('ANNULE'),
                    })
                  }
                >
                  <Ban />
                  Annuler le bon
                </Bouton>
              </>
            )}
            {droits.peutValider && bc.statut === 'EN_ATTENTE_VALIDATION' && (
              <Bouton
                onClick={() =>
                  bc.code_devise === 'MAD'
                    ? changerStatut.mutate('VALIDE')
                    : setValidation({ taux: bc.taux_du_jour != null ? String(bc.taux_du_jour) : '', motif: '' })
                }
                disabled={estCreateur || depassePlafond}
                title={
                  estCreateur
                    ? 'B4 : vous ne pouvez pas valider un bon que vous avez créé'
                    : depassePlafond
                      ? `Montant superieur a votre plafond de ${fmt.mad(plafond ?? 0)}`
                      : undefined
                }
              >
                <ShieldCheck />
                Valider
              </Bouton>
            )}
            {droits.peutEcrire && bc.statut === 'VALIDE' && (
              <Bouton onClick={() => changerStatut.mutate('ENVOYE')}>
                <Send />
                Envoyer au fournisseur
              </Bouton>
            )}
            {/* UN BON VALIDE PAR ERREUR NE RESTE PAS VALIDE. Il redevient
                brouillon — sauf si le fournisseur a deja livre, auquel cas le
                serveur refuse et dit pourquoi. */}
            <BoutonDevalider
              document="bons-commande"
              id={id}
              statut={bc.statut}
              taille="md"
              consequence="Le fournisseur devra être prevenu si le bon lui est déjà parti."
            />
            {droits.peutEcrire && SUPPRIMABLES.includes(bc.statut) && (
              <Bouton
                variante="contour"
                className="text-danger hover:bg-danger/10"
                onClick={() =>
                  confirmation.demander({
                    titre: `Supprimer ${bc.numero_bc} ?`,
                    destructif: true,
                    libelleConfirmer: 'Supprimer definitivement',
                    description:
                      'Ce bon n’engage rien : il sera EFFACE, sans laisser de trace dans la ' +
                      'liste ni dans les états. Ses propositions d’achat reviendront au plan.',
                    action: () => supprimerBon.mutate(),
                  })
                }
              >
                <Trash2 />
                Supprimer le brouillon
              </Bouton>
            )}
          </>
        }
      />
      {confirmationTaux.element}

      {validation && (
        <Carte className="mb-3">
          <CarteEntete>
            <CarteTitre>Valider le bon : le taux engagé</CarteTitre>
          </CarteEntete>
          <CarteCorps className="space-y-2">
            <p className="m-0 text-[12.5px] text-attenue-texte">
              Proposé : le taux de référence du jour
              {bc.taux_du_jour != null ? ` (${fmt.nombre(bc.taux_du_jour, 4)} ${bc.code_devise}/MAD)` : ''}. Un autre
              taux — celui que la banque confirme — se retient avec son motif. Une fois validé, il est figé sur le bon.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <Etiq obligatoire htmlFor="ch-boncommande-1">Taux {bc.code_devise}/MAD</Etiq>
                <Champ id="ch-boncommande-1"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={validation.taux}
                  onChange={(e) => setValidation({ ...validation, taux: e.target.value })}
                />
              </div>
              {(lireNombre(validation.taux) ?? 0) !== Number(bc.taux_du_jour ?? NaN) && (
                <div className="sm:col-span-2">
                  <Etiq obligatoire htmlFor="ch-boncommande-2">Pourquoi ce taux</Etiq>
                  <Champ id="ch-boncommande-2"
                    value={validation.motif}
                    onChange={(e) => setValidation({ ...validation, motif: e.target.value })}
                    placeholder="Cours confirmé par la banque, couverture…"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Bouton
                chargement={changerStatut.isPending}
                disabled={
                  !((lireNombre(validation.taux) ?? 0) > 0) ||
                  ((lireNombre(validation.taux) ?? 0) !== Number(bc.taux_du_jour ?? NaN) &&
                    validation.motif.trim().length < 5)
                }
                onClick={() =>
                  changerStatut.mutate({
                    statut: 'VALIDE',
                    taux_saisi: (lireNombre(validation.taux) ?? 0),
                    motif_taux: validation.motif.trim() || undefined,
                  })
                }
              >
                <ShieldCheck />
                Valider à ce taux
              </Bouton>
              <Bouton variante="contour" onClick={() => setValidation(null)}>
                Annuler
              </Bouton>
            </div>
          </CarteCorps>
        </Carte>
      )}

      {motifAction && (
        <Carte className="mb-3">
          <CarteEntete>
            <CarteTitre>
              {motifAction.cible === 'BROUILLON' ? 'Renvoyer le bon en brouillon' : 'Sauter la demande de prix'}
            </CarteTitre>
          </CarteEntete>
          <CarteCorps className="space-y-2">
            <p className="m-0 text-[12.5px] text-attenue-texte">
              {motifAction.cible === 'BROUILLON'
                ? 'L’acheteur corrige le bon, puis le renvoie au contrôle. Dites-lui quoi corriger.'
                : 'Le bon passe directement à la validation de la direction, sans demande de prix au fournisseur. Le motif reste sur le bon.'}
            </p>
            <div>
              <Etiq obligatoire htmlFor="ch-boncommande-motif">Motif</Etiq>
              <Champ
                id="ch-boncommande-motif"
                value={motifAction.motif}
                onChange={(e) => setMotifAction({ ...motifAction, motif: e.target.value })}
                placeholder={
                  motifAction.cible === 'BROUILLON'
                    ? 'Quantité à revoir, mauvais fournisseur…'
                    : 'Prix sous contrat, achat local…'
                }
              />
            </div>
            <div className="flex gap-2">
              <Bouton
                chargement={changerStatut.isPending}
                disabled={motifAction.motif.trim().length < 5}
                title={motifAction.motif.trim().length < 5 ? 'Cinq caractères au moins' : undefined}
                onClick={() => changerStatut.mutate({ statut: motifAction.cible, motif: motifAction.motif.trim() })}
              >
                {motifAction.cible === 'BROUILLON' ? <CornerUpLeft /> : <SkipForward />}
                {motifAction.cible === 'BROUILLON' ? 'Renvoyer en brouillon' : 'Soumettre à validation sans demande de prix'}
              </Bouton>
              <Bouton variante="contour" onClick={() => setMotifAction(null)}>
                Annuler
              </Bouton>
            </div>
          </CarteCorps>
        </Carte>
      )}

      {bc.statut === 'BROUILLON' && bc.motif_renvoi && (
        <Alerte ton="alerte" titre="Renvoyé en brouillon" className="mb-3">
          {bc.motif_renvoi}
        </Alerte>
      )}
      {bc.statut === 'EN_CONTROLE' && (
        <Alerte ton="info" className="mb-3">
          Bon au contrôle : il est figé. Un autre compte que son créateur vérifie quantités et
          fournisseur, puis l’envoie en demande de prix — ou le renvoie en brouillon avec un motif.
        </Alerte>
      )}
      {bc.statut === 'DEMANDE_PRIX' && (
        <Alerte ton="info" className="mb-3">
          Demande de prix{bc.date_demande_prix ? ` du ${fmt.date(bc.date_demande_prix)}` : ''}
          {bc.controleur ? `, contrôlé par ${bc.controleur}` : ''} : imprimez le document pour le
          fournisseur, puis saisissez sa réponse ci-dessous. Seuls les prix et les remises se
          modifient ; pour les quantités ou les références, renvoyez le bon en brouillon.
        </Alerte>
      )}
      {bc.motif_saut_demande_prix && !['BROUILLON', 'ANNULE'].includes(bc.statut) && (
        <Alerte ton="info" className="mb-3">
          Demande de prix sautée{bc.controleur ? ` par ${bc.controleur}` : ''} : {bc.motif_saut_demande_prix}
        </Alerte>
      )}
      {bc.statut === 'EN_ATTENTE_VALIDATION' && (
        <Alerte ton="info" className="mb-3">
          Bon en attente de validation : il est figé, en-tête et lignes. La direction le valide ;
          pour corriger une quantité, une référence ou un prix, renvoyez-le en brouillon avec un
          motif — il repassera par le contrôle.
        </Alerte>
      )}
      {!modifiable &&
        !['CLOTURE', 'ANNULE', 'EN_CONTROLE', 'DEMANDE_PRIX', 'EN_ATTENTE_VALIDATION'].includes(bc.statut) && (
        <Alerte ton="info" className="mb-3">
          Bon {libelleStatut('bon_commande', bc.statut).toLowerCase()} : les lignes sont figees. Seules les
          receptions le font encore evoluer.
        </Alerte>
      )}

      {/* LA REPONSE DU FOURNISSEUR ET SON ECART (21/10/2026). En demande de prix,
          le prix et la remise confirmes se saisissent ici, ligne par ligne ; a la
          validation, la direction voit l'ecart avec le prix d'avant (signal C59,
          jamais un refus). */}
      {droits.visible('prix_unitaire_devise') &&
        (bc.statut === 'DEMANDE_PRIX' ||
          (bc.statut === 'EN_ATTENTE_VALIDATION' && lignes.some((l) => l.prix_unitaire_avant_demande != null))) && (
          <Carte className="mb-3">
            <CarteEntete>
              <CarteTitre>
                {bc.statut === 'DEMANDE_PRIX' ? 'Réponse du fournisseur' : 'Prix confirmés par le fournisseur'}
              </CarteTitre>
              {(() => {
                const n = lignes.filter((l) => Math.abs(ecartPrix(l) ?? 0) > 0.0005).length
                return n > 0 && bc.statut === 'EN_ATTENTE_VALIDATION' ? (
                  <Badge ton="alerte">{n} écart(s) de prix</Badge>
                ) : null
              })()}
            </CarteEntete>
            <CarteCorps className="overflow-x-auto p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-bordure text-left text-[11px] text-attenue-texte">
                    <th className="px-3 py-2 font-medium">Ligne</th>
                    <th className="px-3 py-2 text-right font-medium">Quantité</th>
                    <th className="px-3 py-2 text-right font-medium">Prix d’avant</th>
                    <th className="px-3 py-2 text-right font-medium">Prix confirmé {bc.code_devise}</th>
                    <th className="px-3 py-2 text-right font-medium">Remise %</th>
                    <th className="px-3 py-2 text-right font-medium">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const ecart = ecartPrix(l, prixSaisi(l) ?? undefined, remiseSaisie(l) ?? undefined)
                    const saisie = bc.statut === 'DEMANDE_PRIX' && droits.peutEcrire
                    return (
                      <tr key={l.id_ligne_bc} className="border-b border-bordure last:border-0">
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{l.code_reference ?? l.libelle ?? '—'}</div>
                          <div className="text-[11px] text-attenue-texte">
                            {l.date_reponse_prix ? `réponse saisie le ${fmt.date(l.date_reponse_prix)}` : 'sans réponse'}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmt.nombre(l.quantite_commandee_unite, 2)} {l.unite_commande}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-attenue-texte">
                          {l.prix_unitaire_avant_demande == null ? '—' : fmt.nombre(l.prix_unitaire_avant_demande, 4)}
                          {Number(l.remise_pct_avant_demande ?? 0) > 0 && (
                            <div className="text-[11px]">remise {fmt.nombre(Number(l.remise_pct_avant_demande), 2)} %</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {saisie ? (
                            <Champ
                              aria-label={`Prix confirmé ligne ${l.ligne_numero}`}
                              inputMode="decimal"
                              className="ml-auto w-28 text-right tabular-nums"
                              value={reponses[l.id_ligne_bc]?.prix ?? enSaisie(l.prix_unitaire_devise)}
                              aria-invalid={!(Number(prixSaisi(l)) > 0)}
                              onChange={(e) =>
                                setReponses((r) => ({ ...r, [l.id_ligne_bc]: { ...r[l.id_ligne_bc], prix: e.target.value } }))
                              }
                            />
                          ) : (
                            <span className="tabular-nums">{fmt.nombre(l.prix_unitaire_devise ?? 0, 4)}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {saisie ? (
                            <Champ
                              aria-label={`Remise ligne ${l.ligne_numero}`}
                              inputMode="decimal"
                              className="ml-auto w-20 text-right tabular-nums"
                              value={reponses[l.id_ligne_bc]?.remise ?? enSaisie(Number(l.remise_pct ?? 0))}
                              onChange={(e) =>
                                setReponses((r) => ({ ...r, [l.id_ligne_bc]: { ...r[l.id_ligne_bc], remise: e.target.value } }))
                              }
                            />
                          ) : (
                            <span className="tabular-nums">{fmt.nombre(Number(l.remise_pct ?? 0), 2)}</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-1.5 text-right tabular-nums',
                            ecart != null && Math.abs(ecart) > 0.0005 && (ecart > 0 ? 'font-medium text-danger' : 'text-succes'),
                          )}
                        >
                          {ecart == null ? '—' : `${ecart > 0 ? '+' : ''}${fmt.nombre(ecart, 2)} %`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CarteCorps>
            {bc.statut === 'DEMANDE_PRIX' && droits.peutEcrire && (
              <CarteCorps className="flex flex-wrap items-center justify-between gap-3 border-t border-bordure pt-3">
                <span className="text-[12.5px] text-attenue-texte">
                  {reponsesIllisibles.length > 0
                    ? `${reponsesIllisibles.length} ligne(s) au prix ou à la remise illisible.`
                    : reponsesModifiees.length > 0
                      ? `${reponsesModifiees.length} ligne(s) modifiée(s) — rien n’est encore enregistré.`
                      : 'Le prix confirmé remplace le prix de la ligne ; le prix d’avant reste pour mesurer l’écart.'}
                </span>
                <div className="flex gap-2">
                  <Bouton variante="contour" disabled={reponsesModifiees.length === 0} onClick={() => setReponses({})}>
                    <Undo2 />
                    Annuler les modifications
                  </Bouton>
                  <Bouton
                    variante={reponsesModifiees.length > 0 ? 'principal' : 'contour'}
                    chargement={enregistrerReponse.isPending}
                    disabled={reponsesModifiees.length === 0 || reponsesIllisibles.length > 0}
                    onClick={() => enregistrerReponse.mutate()}
                  >
                    <Save />
                    Enregistrer la réponse
                  </Bouton>
                </div>
              </CarteCorps>
            )}
          </Carte>
        )}

      {/* UNE LECTURE QUI ECHOUE DOIT SE VOIR. L'ecran se contentait d'afficher
          une grille vide, qu'on ne pouvait pas distinguer d'un bon sans ligne :
          on croyait avoir perdu sa saisie alors que rien n'avait bouge en base.
          Le message dit ce qui s'est passe, et surtout ce qui n'a PAS eu lieu. */}
      {qLignes.isError && (
        <Alerte ton="danger" titre="Les lignes n’ont pas pu être lues" className="mb-3">
          {qLignes.error instanceof ErreurApi
            ? qLignes.error.message
            : 'La base n’a pas répondu.'}{' '}
          Rien n’a été perdu : la grille reste vide tant que la lecture échoue. Rechargez la
          page une fois la cause levée.
        </Alerte>
      )}

      {alertes > 0 && modifiable && (
        <Alerte ton="alerte" titre="Le besoin a bouge depuis la conversion" className="mb-3">
          {alertes} ligne(s) ne correspondent plus au besoin qui les a justifiees. Alignez-les ou
          retirez-les avant de soumettre le bon.
        </Alerte>
      )}

      <div className="space-y-3">
        <Carte repliable="boncommande.1">
          <CarteEntete>
            <CarteTitre>En-tete</CarteTitre>
            <StatutBadge entite="bon_commande" code={bc.statut} />
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Etiq>
                Fournisseur
                <Aide>Non modifiable : la devise, le taux et les prix du bon en decoulent.</Aide>
              </Etiq>
              <div className="flex h-8 items-center rounded-[var(--radius)] border border-bordure bg-attenue px-2 text-[13px]">
                {bc.fournisseur_nom}
              </div>
            </div>
            <div>
              <Etiq htmlFor="devise">
                Devise
                <Aide>Modifiable tant que le bon n’est pas validé. Le taux engagé suit la devise ; les prix des lignes ne sont pas convertis.</Aide>
              </Etiq>
              <Selecteur
                id="devise"
                value={entete.code_devise}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, code_devise: e.target.value })}
              >
                {(qDevises.data ?? [{ code_devise: entete.code_devise }]).map((d) => (
                  <option key={d.code_devise}>{d.code_devise}</option>
                ))}
              </Selecteur>
              {entete.code_devise !== bc.code_devise && lignes.length > 0 && (
                <p className="mt-1 text-[11px] text-alerte">
                  Les prix des lignes restent tels quels : vérifiez-les en {entete.code_devise}.
                </p>
              )}
            </div>
            <div>
              <Etiq htmlFor="datebc">Date du bon</Etiq>
              <Champ
                id="datebc"
                type="date"
                value={entete.date_bc}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, date_bc: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="livr">Livraison prévue</Etiq>
              <Champ
                id="livr"
                type="date"
                value={entete.date_livraison_prevue}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, date_livraison_prevue: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="cond">Conditions de paiement</Etiq>
              <Champ
                id="cond"
                value={entete.conditions_paiement}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, conditions_paiement: e.target.value })}
              />
            </div>
            <div className="lg:col-span-2">
              <Etiq htmlFor="notes">Observations</Etiq>
              <Champ
                id="notes"
                value={entete.notes}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, notes: e.target.value })}
              />
            </div>
            {/* CE QUI PART SUR LE DOCUMENT FOURNISSEUR, et nulle part ailleurs.
                La date de livraison prevue pilote le suivi de l'en-cours ; le
                fournisseur, lui, lit souvent une phrase — « As soon as
                possible » figurait sur dix-neuf des bons d'archive. */}
            <div>
              <Etiq htmlFor="expe">
                Mention d’expédition
                <Aide>
                  Ce que le document fournisseur imprime en face de « SHIPMENT DATE ». Laissée
                  vide, c’est la livraison prévue qui part. Elle ne remplace pas cette date :
                  le suivi de l’en-cours continue de s’appuyer dessus.
                </Aide>
              </Etiq>
              <Champ
                id="expe"
                placeholder="As soon as possible"
                value={entete.mention_expedition}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, mention_expedition: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="cont">
                Nombre de conteneurs
                <Aide>
                  Laissé vide, il se calcule : total des palettes divisé par les palettes par
                  conteneur du fournisseur. On ne le saisit que lorsque le transitaire en
                  décide autrement — une expédition partagée, un conteneur de plus.
                </Aide>
              </Etiq>
              <Champ
                id="cont"
                type="number"
                min="1"
                className="text-right tabular-nums"
                value={entete.nombre_conteneurs}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, nombre_conteneurs: e.target.value })}
              />
            </div>
          </CarteCorps>

          {/* Un bouton explicite plutot qu'un enregistrement a la sortie du
              champ : personne ne devine qu'un champ quitte se sauvegarde, et
              cliquer directement sur « Soumettre » ferait courir la sauvegarde
              contre le changement de statut. */}

          <CarteCorps className="flex flex-wrap gap-6 border-t border-bordure pt-3 text-[13px]">
            <span className="text-attenue-texte">
              Lignes <span className="font-semibold tabular-nums text-texte">{lignes.length}</span>
            </span>
            <span className="text-attenue-texte">
              Total{' '}
              <span className="font-semibold tabular-nums text-texte">
                {fmt.nombre(bc.montant_total_devise ?? 0, 2)} {bc.code_devise}
              </span>
            </span>
            <span className="text-attenue-texte">
              Soit{' '}
              <span className="font-semibold tabular-nums text-texte">
                {fmt.mad(bc.montant_total_mad ?? 0)}
              </span>
            </span>
            {bc.valideur && (
              <span className="ml-auto text-attenue-texte">
                Valide par <span className="text-texte">{bc.valideur}</span>{' '}
                {fmt.dateHeure(bc.date_validation)}
              </span>
            )}
          </CarteCorps>
        </Carte>

        {/* LES LIGNES SE MODIFIENT SUR PLACE, chacune avec ses boutons.
            Il y avait auparavant deux endroits : un tableau pour regarder, et
            une grille en dessous pour corriger. On corrigeait donc une ligne
            sans la voir a cote des autres, et il fallait un bouton « Modifier
            les lignes » pour basculer de l'un a l'autre. Une ligne se corrige
            la ou elle est.

            LE TABLEAU RESTE POUR LA CONSULTATION : un bon envoye ou clos ne se
            modifie plus, et l'on veut alors l'export, l'impression et le choix
            des colonnes. */}
        <Carte repliable="boncommande.2">
          <CarteEntete>
            <CarteTitre>Lignes</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              {modifiable
                ? 'Chaque ligne se corrige sur place — rien n’est enregistré tant que vous n’avez pas enregistré le bon.'
                : `${lignes.length} ligne(s)`}
            </span>
          </CarteEntete>
          <CarteCorps className={modifiable ? 'space-y-3' : 'p-0'}>
            {modifiable && bc ? (
              <GrilleLignes
                controleColisage
                codeFournisseur={bc.code_fournisseur}
                devise={entete.code_devise || bc.code_devise}
                lignes={nouvelles}
                setLignes={setNouvelles}
                mode={mode}
                setMode={setMode}
                proposees={proposees}
                chercherCatalogue={chercherCatalogue}
                surCorrection={(code, champ, valeur, version) =>
                  corrigerReference.mutate({ code, champ, valeur, version })
                }
                valeurOrigine={(code, champ) => (parPlan.get(code)?.[champ] as string) ?? ''}
                validationLocale
                avecRemise
                fusionParReference
                surSupprimerLigne={retirerLigne}
              />
            ) : (
              <DataTable<LigneBc>
                exportable="lignes-du-bon"
                imprimable="Lignes du bon"
                module={MODULE}
                colonnes={colonnes}
                lignes={lignesAffichees}
                chargement={qLignes.isLoading}
                erreur={qLignes.error}
                cle={(l) => l.id_ligne_bc}
                recherche={false}
                pagination={false}
                tailleParDefaut={500}
                titreCarte={(l) => l.code_reference}
                videTitre="Aucune ligne"
                videDescription="Ajoutez des références : le plan d'achat vous dira quoi commander."
              />
            )}
            <TotauxCommande
              lignes={
                modifiable
                  ? nouvelles
                  : lignes.map((x) => depuisLigneEnregistree(x, parPlan.get(x.code_reference ?? '')))
              }
              devise={bc?.code_devise ?? ''}
              taux={bc?.taux_change_engage}
            />
          </CarteCorps>
        </Carte>
      </div>

      {/* L'EN-TETE ET LES LIGNES S'ENREGISTRENT ICI, ENSEMBLE. Le bouton de
          chaque ligne la valide a l'ecran ; celui-ci ecrit tout en base.

          Les deux boutons restent TOUJOURS presents tant que le bon se modifie,
          simplement desactives quand il n'y a rien a enregistrer : on ne trouve
          pas un bouton qu'on n'a jamais vu. */}
      {modifiable && (
        <div
          className={cn(
            'sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            aEnregistrer ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="text-[13px]">
            {nonValidees.length > 0 ? (
              <span className="text-alerte">
                {nonValidees.length} ligne(s) à valider avec le bouton ✓ de la ligne avant
                d’enregistrer.
              </span>
            ) : aEnregistrer ? (
              <>
                <span className="font-medium">
                  {[
                    enteteModifie ? 'en-tête modifié' : null,
                    nbAjoutees ? `${nbAjoutees} ligne(s) ajoutée(s)` : null,
                    nbModifiees ? `${nbModifiees} corrigée(s)` : null,
                    supprimees.length ? `${supprimees.length} retirée(s)` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-alerte"> — rien n’est encore enregistré.</span>
              </>
            ) : (
              <span className="text-attenue-texte">
                Validez chaque ligne avec son bouton ✓, puis enregistrez l’en-tête et les lignes
                ensemble.
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton
              variante="contour"
              disabled={!aEnregistrer && nonValidees.length === 0}
              onClick={() => {
                if (bc) {
                  setEntete({
                    date_bc: bc.date_bc?.slice(0, 10) ?? '',
                    date_livraison_prevue: bc.date_livraison_prevue?.slice(0, 10) ?? '',
                    conditions_paiement: bc.conditions_paiement ?? '',
                    mention_expedition: bc.mention_expedition ?? '',
                    nombre_conteneurs: bc.nombre_conteneurs != null ? String(bc.nombre_conteneurs) : '',
                    notes: bc.notes ?? '',
                    code_devise: bc.code_devise,
                  })
                }
                setSupprimees([])
                setNouvelles(
                  lignes.map((x) => ({
                    ...depuisLigneEnregistree(x, parPlan.get(x.code_reference ?? '')),
                    valide: true,
                  })),
                )
              }}
            >
              <Undo2 />
              Annuler les modifications
            </Bouton>
            <Bouton
              onClick={() => enregistrer.mutate()}
              chargement={enregistrer.isPending}
              disabled={!aEnregistrer || nonValidees.length > 0}
              title={
                nonValidees.length > 0
                  ? 'Validez d’abord chaque ligne avec son bouton ✓'
                  : undefined
              }
            >
              <Save />
              Enregistrer
            </Bouton>
          </div>
        </div>
      )}

      {confirmation.element}
    </div>
  )
}


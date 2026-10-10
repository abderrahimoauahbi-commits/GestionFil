/**
 * Inventaires physiques.
 *
 * LE COMPTAGE SE SAISIT COMME UN BON DE COMMANDE (02/10/2026) : une ligne par
 * reference et par lot, les kilos, les bobines et les palettes comptes sur la
 * ligne meme, les calculs affiches a la frappe — et UN SEUL bouton en bas qui
 * envoie d'un coup toutes les lignes modifiees. On compte une allee entiere
 * avant d'enregistrer, pas une cellule a la fois.
 *
 * Les references sous suivi de lot sont comptees AU LOT : on compte des
 * bobines portant un numero de bain de teinture, pas un total abstrait.
 */
import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  Plus,
  Printer,
  Save,
  Undo2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useOuvrirVue } from '../lib/navigation'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { ActionMotivee } from '../composants/ActionMotivee'
import { BoutonDevalider } from '../composants/BoutonDevalider'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  PanneauFiltres,
  useFiltres,
  type ChampFiltre,
} from '../composants/PanneauFiltres'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  CarteCorps,
  Champ,
  Chargement,
  EtatVide,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { Aide, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { SANS_LOT, couleurEcart, libelleLot, useTolerancesLot } from '../lib/lots'
import { PanneRequetes } from '../composants/PanneRequetes'
import { lireNombre } from '../lib/nombres'

const MODULE = 'INVENTAIRE'

interface Inventaire extends Record<string, unknown> {
  id_inventaire: string
  numero_inventaire: string
  date_inventaire: string
  type_inventaire: string
  code_magasin: string
  statut: string
  nb_lignes: number
  nb_a_compter: number
  responsable: string | null
  motif_annulation?: string | null
}

/* Des axes que l'on choisit, pas de comparateur a saisir : les valeurs
   des listes sortent des lignes affichees. */
const CHAMPS_INVENTAIRE: ChampFiltre<Inventaire>[] = [
  { cle: 'periode', libelle: 'Période', type: 'periode', valeur: (l) => l.date_inventaire },
  { cle: 'statut', libelle: 'Statut', type: 'liste', valeur: (l) => l.statut },
  { cle: 'magasin', libelle: 'Magasin', type: 'liste', valeur: (l) => l.code_magasin },
  { cle: 'type', libelle: "Type d'inventaire", type: 'liste', valeur: (l) => l.type_inventaire },
  { cle: 'responsable', libelle: 'Responsable', type: 'liste', valeur: (l) => l.responsable },
  { cle: 'numero', libelle: 'Numéro', type: 'texte', valeur: (l) => l.numero_inventaire },
]

/** Une ligne telle que `GET /api/inventaires/:id/lignes` la renvoie. */
interface LigneInv extends Record<string, unknown> {
  id_ligne_inv: string
  code_reference: string
  designation: string | null
  code_magasin: string
  lot_fournisseur: string | null
  quantite_theorique_kg: number
  quantite_comptee_kg: number | null
  ecart_kg: number | null
  ecart_pct: number | null
  motif_ecart: string | null
  statut_ligne: string
  nb_bobines_theorique: number | null
  nb_bobines_comptees: number | null
  nb_palettes_comptees: number | null
  poids_unitaire_theorique_kg: number | null
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  categorie_libelle: string | null
}

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'danger'> = {
  BROUILLON: 'neutre',
  EN_COURS: 'info',
  CLOTURE: 'succes',
  ANNULE: 'danger',
}

/**
 * LA TOLERANCE AU-DELA DE LAQUELLE UN MOTIF DEVIENT OBLIGATOIRE.
 *
 * Elle etait codee en dur a 2 % ici, alors que la cloture, cote serveur, lit
 * `P_TolerEcartPesee` : la direction pouvait la changer sans que l'ecran le
 * sache, et l'on voyait « requis » la ou le serveur n'exigeait rien — ou
 * l'inverse, qui ne se decouvrait qu'au refus de la cloture. On lit donc le
 * meme reglage, avec le meme defaut que la graine.
 */
function useToleranceMotif() {
  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: () =>
      api.get<{ code_parametre: string; valeur_courante: string }[]>('/api/parametres'),
    staleTime: 5 * 60_000,
  })
  const p = q.data?.find((x) => x.code_parametre === 'P_TolerEcartPesee')
  const n = p ? Number(p.valeur_courante) : NaN
  return Number.isFinite(n) ? n : 2
}

// --- La saisie d'une ligne -------------------------------------------------

/** Ce qu'on tape sur une ligne : des chaines, comme les champs. */
interface Saisie {
  kg: string
  bobines: string
  palettes: string
  motif: string
}

type ChampSaisie = keyof Saisie

/** Un nombre lu dans un champ : vide = null, illisible = NaN. */
function lire(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  return (lireNombre(t) ?? 0)
}

const nombre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const positif = (v: unknown): number | null => {
  const n = nombre(v)
  return n !== null && n > 0 ? n : null
}

const versChamp = (v: unknown) => {
  const n = nombre(v)
  return n === null ? '' : String(n)
}

/** La ligne telle que le serveur la connait, exprimee comme une saisie. */
const saisieServeur = (l: LigneInv): Saisie => ({
  kg: l.quantite_comptee_kg == null ? '' : versChamp(l.quantite_comptee_kg),
  bobines: versChamp(l.nb_bobines_comptees),
  palettes: versChamp(l.nb_palettes_comptees),
  motif: l.motif_ecart ?? '',
})

/**
 * L'EMPREINTE D'UNE SAISIE : ce qui partirait au serveur, normalise. « 12 »,
 * « 12,0 » et « 12.00 » ont la meme. Une ligne n'est MODIFIEE que si son
 * empreinte differe de celle de la ligne chargee — retaper la meme valeur ne
 * marque rien.
 */
const empreinte = (s: Saisie) =>
  JSON.stringify([lire(s.kg), lire(s.bobines), lire(s.palettes), s.motif.trim() || null])

const arrondi = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

/** Tout ce que l'ecran calcule d'une ligne a partir de sa saisie. */
interface Analyse {
  theoriqueKg: number
  /** Les kilos qui partiront : saisis, ou a defaut deduits des bobines. */
  kg: number | null
  kgDeduit: boolean
  bobines: number | null
  palettes: number | null
  ecartKg: number | null
  ecartPct: number | null
  poidsCatalogue: number | null
  poidsReel: number | null
  poidsPct: number | null
  motifRequis: boolean
  erreurs: string[]
}

function analyser(l: LigneInv, s: Saisie, tolMotif: number): Analyse {
  const erreurs: string[] = []
  const theoriqueKg = nombre(l.quantite_theorique_kg) ?? 0
  const poidsCatalogue = positif(l.poids_unitaire_theorique_kg) ?? positif(l.poids_bobine_kg)

  const kgLu = lire(s.kg)
  const bobLu = lire(s.bobines)
  const palLu = lire(s.palettes)

  let kgSaisi: number | null = null
  if (kgLu !== null) {
    if (!Number.isFinite(kgLu) || kgLu < 0) erreurs.push('kilos illisibles')
    else kgSaisi = kgLu
  }
  let bobines: number | null = null
  if (bobLu !== null) {
    if (!Number.isFinite(bobLu) || bobLu < 0 || !Number.isInteger(bobLu))
      erreurs.push('bobines : un nombre entier')
    else bobines = bobLu
  }
  let palettes: number | null = null
  if (palLu !== null) {
    if (!Number.isFinite(palLu) || palLu < 0) erreurs.push('palettes illisibles')
    else palettes = arrondi(palLu, 2)
  }

  /* ON COMPTE DES BOBINES, PAS DES KILOS. Quand l'allee ne rapporte que des
     bobines, le bureau convertit au poids catalogue — c'est ce que la feuille
     de comptage prevoit. Le poids est alors une deduction, et l'ecran le dit. */
  const kgDeduit = kgSaisi === null && bobines !== null && poidsCatalogue !== null
  const kg = kgSaisi ?? (kgDeduit ? arrondi(bobines! * poidsCatalogue!, 2) : null)

  const ecartKg = kg === null ? null : kg - theoriqueKg
  // Meme formule que la colonne generee `ligne_inventaire.ecart_pct`.
  const ecartPct = ecartKg === null || theoriqueKg === 0 ? null : (ecartKg / theoriqueKg) * 100
  // UN THEORIQUE NUL N'A PAS DE POURCENTAGE, mais trouver du stock la ou il n'y en
  // avait pas est un ecart qui s'explique (regle 10) : meme condition que le
  // serveur a la cloture, sinon l'ecran ne demande rien et la cloture refuse.
  const motifRequis =
    (ecartPct !== null && Math.abs(ecartPct) > tolMotif) || (theoriqueKg === 0 && kg !== null && kg > 0)

  const poidsReel = kgSaisi !== null && bobines !== null && bobines > 0 ? kgSaisi / bobines : null
  const poidsPct =
    poidsReel !== null && poidsCatalogue !== null
      ? ((poidsReel - poidsCatalogue) / poidsCatalogue) * 100
      : null

  if (kg === null && (bobines !== null || palettes !== null || s.motif.trim()))
    erreurs.push('kilos à saisir')
  if (motifRequis && !s.motif.trim()) erreurs.push('motif requis')

  return {
    theoriqueKg,
    kg,
    kgDeduit,
    bobines,
    palettes,
    ecartKg,
    ecartPct,
    poidsCatalogue,
    poidsReel,
    poidsPct,
    motifRequis,
    erreurs,
  }
}

/** Une ligne prete a l'affichage : la donnee serveur, la saisie, les calculs. */
interface LigneVue {
  ligne: LigneInv
  saisie: Saisie
  analyse: Analyse
  modifiee: boolean
}

export function Inventaires() {
  const droits = useDroits(MODULE)
  const ouvrirEtat = useOuvrirVue()
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const tolMotif = useToleranceMotif()
  const [selection, setSelection] = useState<string | null>(null)
  const [creation, setCreation] = useState(false)
  const [annulation, setAnnulation] = useState(false)
  const [statut, setStatut] = useState('')
  const filtres = useFiltres(CHAMPS_INVENTAIRE)
  /**
   * LE COMPTAGE EN COURS DE FRAPPE, par ligne. Rien n'est ecrit en base avant
   * « Enregistrer le comptage » : on peut corriger, revenir, tout annuler.
   */
  const [brouillon, setBrouillon] = useState<Record<string, Saisie>>({})

  const qInv = useQuery({
    queryKey: ['inventaires'],
    queryFn: ({ signal }) => api.get<Inventaire[]>('/api/inventaires', { signal }),
  })
  const inventaire = qInv.data?.find((i) => i.id_inventaire === selection) ?? null

  const qLignes = useQuery({
    queryKey: ['lignes-inventaire', selection],
    queryFn: ({ signal }) => api.get<LigneInv[]>(`/api/inventaires/${selection}/lignes`, { signal }),
    enabled: !!selection,
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['inventaires'] })
    void qc.invalidateQueries({ queryKey: ['lignes-inventaire'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  const ouvrir = useMutation({
    mutationFn: (id: string) =>
      api.post<{ lignes_a_compter: number }>(`/api/inventaires/${id}/ouvrir`),
    onSuccess: (r) => {
      toast.success(`${r.lignes_a_compter} ligne(s) a compter.`)
      rafraichir()
    },
    onError: echec,
  })

  /** Le lot trouve au comptage : une ligne a part, envoyee tout de suite. */
  const ajouterLot = useMutation({
    mutationFn: (c: {
      code_reference: string
      code_magasin: string
      lot_fournisseur: string
      quantite_comptee_kg: number
    }) => api.put(`/api/inventaires/${selection}/lignes`, { comptages: [c] }),
    onSuccess: rafraichir,
    onError: echec,
  })

  const cloturer = useMutation({
    mutationFn: () =>
      api.post<{
        lignes_ajustees: number
        ecart_positif_kg: number
        ecart_negatif_kg: number
        impact_valorisation_mad: number
      }>(`/api/inventaires/${selection}/cloturer`),
    onSuccess: (r) => {
      toast.success(
        `Inventaire cloture : ${r.lignes_ajustees} ajustement(s), impact ${fmt.mad(r.impact_valorisation_mad)}.`,
      )
      rafraichir()
      void qc.invalidateQueries({ queryKey: ['stock-projete'] })
      void qc.invalidateQueries({ queryKey: ['cockpit'] })
    },
    onError: echec,
  })

  const enCours = inventaire?.statut === 'EN_COURS'
  const saisissable = !!enCours && droits.peutEcrire

  /** Chaque ligne avec sa saisie courante et ce qu'on en calcule. */
  const vues = useMemo<LigneVue[]>(
    () =>
      (qLignes.data ?? []).map((ligne) => {
        const serveur = saisieServeur(ligne)
        const saisie = brouillon[ligne.id_ligne_inv] ?? serveur
        return {
          ligne,
          saisie,
          analyse: analyser(ligne, saisie, tolMotif),
          modifiee: empreinte(saisie) !== empreinte(serveur),
        }
      }),
    [qLignes.data, brouillon, tolMotif],
  )
  const modifiees = vues.filter((v) => v.modifiee)
  const enErreur = modifiees.filter((v) => v.analyse.erreurs.length > 0)

  /** Lignes enregistrees hors tolerance sans motif : elles bloqueront la cloture. */
  const injustifiees = (qLignes.data ?? []).filter(
    (l) =>
      ((l.ecart_pct != null && Math.abs(Number(l.ecart_pct)) > tolMotif) ||
        (Number(l.quantite_theorique_kg ?? 0) === 0 && Number(l.quantite_comptee_kg ?? 0) > 0)) &&
      !l.motif_ecart?.trim(),
  )
  const restantes = (qLignes.data ?? []).filter((l) => l.statut_ligne === 'A_TRAITER').length

  /**
   * TOUTES LES LIGNES MODIFIEES PARTENT ENSEMBLE, en un seul envoi : le
   * serveur les ecrit dans une seule transaction, tout ou rien.
   */
  const enregistrer = useMutation({
    mutationFn: async (lignes: LigneVue[]) => {
      await api.put(`/api/inventaires/${selection}/lignes`, {
        comptages: lignes.map(({ ligne, saisie, analyse }) => ({
          code_reference: ligne.code_reference,
          code_magasin: ligne.code_magasin,
          lot_fournisseur: ligne.lot_fournisseur,
          quantite_comptee_kg: analyse.kg,
          motif_ecart: saisie.motif.trim() || null,
          nb_bobines: analyse.bobines,
          nb_palettes: analyse.palettes,
        })),
      })
      return lignes.map((v) => v.ligne.id_ligne_inv)
    },
    onSuccess: (ids) => {
      toast.success(`Comptage enregistré : ${ids.length} ligne(s).`)
      setBrouillon((b) => {
        const reste = { ...b }
        for (const id of ids) delete reste[id]
        return reste
      })
      rafraichir()
    },
    onError: echec,
  })

  /**
   * CHANGER D'INVENTAIRE ABANDONNE LE COMPTAGE NON ENREGISTRE — on le demande
   * avant, pas apres.
   */
  const choisir = (id: string, puis?: () => void) => {
    const aller = () => {
      setBrouillon({})
      setSelection(id)
      puis?.()
    }
    if (id !== selection && modifiees.length > 0) {
      confirmation.demander({
        titre: 'Abandonner le comptage non enregistré ?',
        description: `${modifiees.length} ligne(s) modifiée(s) de ${inventaire?.numero_inventaire ?? 'cet inventaire'} ne sont pas enregistrées.`,
        libelleConfirmer: 'Abandonner',
        destructif: true,
        action: aller,
      })
    } else if (id !== selection) {
      aller()
    } else {
      puis?.()
    }
  }

  const colonnesInv: ColonneDT<Inventaire>[] = [
    {
      champ: 'numero_inventaire',
      entete: 'Numéro',
      rendu: (i) => <span className="font-mono text-xs">{i.numero_inventaire}</span>,
    },
    { champ: 'date_inventaire', entete: 'Date', rendu: (i) => fmt.date(i.date_inventaire) },
    { champ: 'type_inventaire', entete: 'Type' },
    { champ: 'code_magasin', entete: 'Magasin' },
    {
      champ: 'statut',
      entete: 'Statut',
      rendu: (i) => <Badge ton={TON[i.statut] ?? 'neutre'}>{i.statut}</Badge>,
    },
    {
      champ: 'quantite_theorique_kg',
      entete: 'A compter',
      numerique: true,
      rendu: (i) =>
        i.nb_lignes === 0 ? '—' : `${i.nb_lignes - i.nb_a_compter} / ${i.nb_lignes}`,
    },
  ]

  if (qInv.isLoading) return <Chargement />

  const tous = qInv.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, i) => {
    m[i.statut] = (m[i.statut] ?? 0) + 1
    return m
  }, {})
  const filtrables = tous.filter((i) => !statut || i.statut === statut)
  const vus = filtrables.filter(filtres.retenir)

  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les inventaires', compte: tous.length }] },
    {
      titre: 'Par statut',
      entrees: [
        {
          cle: 'BROUILLON',
          libelle: 'Brouillon',
          resume: 'Pas encore lance',
          compte: comptes.BROUILLON ?? 0,
          ton: 'neutre' as const,
        },
        {
          cle: 'EN_COURS',
          libelle: 'En cours',
          resume: 'Comptage commence',
          compte: comptes.EN_COURS ?? 0,
          ton: 'alerte' as const,
        },
        {
          cle: 'CLOTURE',
          libelle: 'Clôture',
          resume: 'Ajustements generes',
          compte: comptes.CLOTURE ?? 0,
          ton: 'succes' as const,
        },
        {
          cle: 'ANNULE',
          libelle: 'Annule',
          compte: comptes.ANNULE ?? 0,
          ton: 'neutre' as const,
        },
      ],
    },
  ]

  return (
    <div>
      <EnTetePage
        titre="Inventaires"
        description="La clôture généré automatiquement les mouvements d'ajustement, dans une seule transaction."
        actions={
          droits.peutEcrire && (
            <Bouton
              taille="icone"
              title="Nouvel inventaire"
              aria-label="Nouvel inventaire"
              onClick={() => setCreation(true)}
            >
              <Plus />
            </Bouton>
          )
        }
      />
      <PanneRequetes requetes={[['Les inventaires', qInv], ['Les lignes de l’inventaire', qLignes]]} />

      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral groupes={groupes} actif={statut} surChoix={setStatut} />
            <PanneauFiltres
              champs={CHAMPS_INVENTAIRE}
              lignes={filtrables}
              valeurs={filtres.valeurs}
              definir={filtres.definir}
              reinitialiser={filtres.reinitialiser}
              actifs={filtres.actifs}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {/* LA CREATION SE FAIT DANS LA PAGE, pas dans une fenetre : deux
              champs, et l'inventaire cree s'ouvre juste en dessous. */}
          {creation && (
            <FormulaireInventaire
              surFermeture={() => setCreation(false)}
              surSucces={(id) => {
                setCreation(false)
                choisir(id)
                rafraichir()
              }}
            />
          )}

          <DataTable<Inventaire>
            exportable="inventaires"
            imprimable="Inventaires"
            module={MODULE}
            colonnes={colonnesInv}
            lignes={vus}
            cle={(i) => i.id_inventaire}
            surClic={(i) => choisir(i.id_inventaire)}
            titreCarte={(i) => i.numero_inventaire}
            placeholderRecherche="Filtrer les inventaires..."
            tailleParDefaut={10}
            videTitre="Aucun inventaire"
            actions={(i) => (
              <div className="flex justify-end gap-0.5">
                {/* Le proces-verbal s'imprime des l'ouverture du comptage, pas
                    seulement apres cloture : c'est le document qu'on emporte
                    pour faire signer les ecarts au fur et a mesure. */}
                {/* DEUX PAPIERS, DANS L'ORDRE OU L'ON S'EN SERT. La feuille de
                    comptage part dans l'allee, a l'aveugle, sans le theorique ;
                    le proces-verbal revient ensuite confronter le compte au
                    theorique. Elle n'existe qu'une fois l'inventaire ouvert :
                    c'est l'ouverture qui fige ce qu'il y a a compter. */}
                {i.statut !== 'BROUILLON' && (
                  <Bouton
                    variante="discret"
                    taille="icone-xs"
                    onClick={() => ouvrirEtat(`/etats/inventaire/${i.id_inventaire}/comptage`)}
                    aria-label="Feuille de comptage"
                    title="Imprimer la feuille de comptage"
                  >
                    <ClipboardList />
                  </Bouton>
                )}
                <Bouton
                  variante="discret"
                  taille="icone-xs"
                  onClick={() => ouvrirEtat(`/etats/inventaire/${i.id_inventaire}`)}
                  aria-label="Imprimer"
                  title="Imprimer le proces-verbal"
                >
                  <Printer />
                </Bouton>
                {droits.peutEcrire && i.statut === 'BROUILLON' && (
                  <Bouton
                    variante="contour"
                    taille="sm"
                    onClick={() => choisir(i.id_inventaire, () => ouvrir.mutate(i.id_inventaire))}
                  >
                    <FolderOpen />
                    Ouvrir
                  </Bouton>
                )}
              </div>
            )}
          />

          {!inventaire ? (
            <EtatVide
              titre="Sélectionnez un inventaire"
              description="Le comptage s'affichera ici, saisissable ligne par ligne."
            />
          ) : (
            <div className="space-y-4">
              <Carte repliable="inventaires.1">
                <CarteCorps className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{inventaire.numero_inventaire}</span>
                      <Badge ton={TON[inventaire.statut] ?? 'neutre'}>{inventaire.statut}</Badge>
                    </div>
                    <div className="text-sm text-attenue-texte">
                      {inventaire.type_inventaire} · magasin {inventaire.code_magasin}
                      {restantes > 0 && ` · ${restantes} ligne(s) a compter`}
                    </div>
                  </div>

                  {enCours && droits.peutValider && (
                    <Bouton
                      // Le serveur verrouille la fiche ; l'ecran n'envoie pas deux fois.
                      chargement={cloturer.isPending}
                      disabled={cloturer.isPending || restantes > 0 || injustifiees.length > 0 || modifiees.length > 0}
                      title={
                        modifiees.length > 0
                          ? "Enregistrez d'abord le comptage en cours"
                          : undefined
                      }
                      onClick={() =>
                        confirmation.demander({
                          titre: `Cloturer ${inventaire.numero_inventaire} ?`,
                          description:
                            "Les écarts seront convertis en mouvements d'ajustement. Le grand livre etant immuable, "
                            + "ces mouvements ne s'effacent pas : pour revenir dessus il faudra les contre-passer un a un, "
                            + "puis rouvrir l'inventaire.",
                          libelleConfirmer: 'Clôturer',
                          action: () => cloturer.mutate(),
                        })
                      }
                    >
                      <ClipboardCheck />
                      Clôturer et ajuster
                    </Bouton>
                  )}

                  {/* ANNULER UN INVENTAIRE OUVERT (regle 10, 08/10/2026) : un
                      comptage abandonne ou perime n'avait aucune issue. Rien
                      n'est encore au stock ; le motif reste sur la fiche. */}
                  {(enCours || inventaire.statut === 'BROUILLON') && droits.peutValider && (
                    <>
                      <Bouton variante="contour" onClick={() => setAnnulation(true)}>
                        <XCircle />
                        Annuler l'inventaire
                      </Bouton>
                      <ActionMotivee
                        ouvert={annulation}
                        surFermeture={() => setAnnulation(false)}
                        titre={`Annuler ${inventaire.numero_inventaire}`}
                        description="L'inventaire passera à « annulé » ; il ne pourra plus être clos."
                        libelleBouton="Annuler l'inventaire"
                        chemin={`/api/inventaires/${inventaire.id_inventaire}/annuler`}
                        consequence={
                          <>
                            Aucun ajustement n'a encore été passé : le stock ne bouge pas. Les lignes déjà
                            comptées restent consultables. Un autre inventaire pourra ensuite être ouvert sur
                            ce magasin.
                          </>
                        }
                        surSucces={rafraichir}
                      />
                    </>
                  )}
                  {inventaire.statut === 'ANNULE' && inventaire.motif_annulation && (
                    <span className="text-[12px] text-attenue-texte">Annulé : {inventaire.motif_annulation}</span>
                  )}

                  {/* ROUVRIR UN INVENTAIRE CLOS. Le serveur refuse tant que ses
                      ajustements vivent : il faut d'abord les contre-passer. */}
                  <BoutonDevalider
                    document="inventaires"
                    id={inventaire.id_inventaire}
                    statut={inventaire.statut}
                    consequence="Le comptage redeviendra saisissable à partir des quantités déjà relevees."
                  />
                </CarteCorps>
              </Carte>

              {inventaire.statut === 'BROUILLON' && (
                <Alerte ton="info">
                  Ouvrez l'inventaire pour commencer le comptage. Rien n'est gelé : le stock théorique de chaque ligne est pris à l'heure où elle est comptée (règle 10).
                </Alerte>
              )}

              {injustifiees.length > 0 && (
                <Alerte ton="alerte" titre={`${injustifiees.length} ecart(s) a justifier`}>
                  Un ecart superieur a {fmt.nombre(tolMotif, 1)} % exige un motif. La cloture est
                  bloquee tant qu'il en reste un sans justification.
                </Alerte>
              )}

              {saisissable && (
                <LotTrouve
                  magasin={inventaire.code_magasin}
                  references={[...new Set((qLignes.data ?? []).map((l) => l.code_reference))]}
                  enCours={ajouterLot.isPending}
                  ajouter={(c) =>
                    ajouterLot.mutateAsync({ ...c, code_magasin: inventaire.code_magasin })
                  }
                />
              )}

              <TableComptage
                key={inventaire.id_inventaire}
                vues={vues}
                chargement={qLignes.isLoading}
                erreur={qLignes.error}
                saisissable={saisissable}
                tolMotif={tolMotif}
                setBrouillon={setBrouillon}
              />

              {/* LE SEUL BOUTON QUI ECRIT. Toujours present tant que le
                  comptage se saisit, desactive quand il n'y a rien a envoyer :
                  on ne trouve pas un bouton qu'on n'a jamais vu. */}
              {saisissable && (
                <div
                  className={cn(
                    'sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
                    modifiees.length > 0 ? 'border-primaire' : 'border-bordure',
                  )}
                >
                  <span className="text-[13px]">
                    {enErreur.length > 0 ? (
                      <span className="text-danger">
                        {enErreur.length} ligne(s) à compléter avant d’enregistrer —{' '}
                        {enErreur
                          .slice(0, 3)
                          .map(
                            (v) =>
                              `${v.ligne.code_reference}${v.ligne.lot_fournisseur ? ` (${libelleLot(v.ligne.lot_fournisseur)})` : ''} : ${v.analyse.erreurs.join(', ')}`,
                          )
                          .join(' · ')}
                        {enErreur.length > 3 && ' …'}
                      </span>
                    ) : modifiees.length > 0 ? (
                      <>
                        <span className="font-medium">
                          {modifiees.length} ligne(s) modifiée(s)
                        </span>
                        <span className="text-alerte"> — rien n’est encore enregistré.</span>
                      </>
                    ) : (
                      <span className="text-attenue-texte">
                        Saisissez les quantités comptées sur les lignes, puis enregistrez le
                        comptage d’un seul coup.
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <Bouton
                      variante="contour"
                      disabled={modifiees.length === 0 || enregistrer.isPending}
                      onClick={() => setBrouillon({})}
                    >
                      <Undo2 />
                      Annuler les modifications
                    </Bouton>
                    <Bouton
                      disabled={modifiees.length === 0 || enErreur.length > 0}
                      chargement={enregistrer.isPending}
                      onClick={() => enregistrer.mutate(modifiees)}
                    >
                      <Save />
                      Enregistrer le comptage
                    </Bouton>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </PageAvecRail>

      {confirmation.element}
    </div>
  )
}

// --- Le tableau de comptage --------------------------------------------------

type Filtre = 'TOUTES' | 'A_COMPTER' | 'ECARTS' | 'MODIFIEES'

/**
 * UNE LIGNE = UN LOT, les champs sur la ligne. Le tableau ne pagine pas : on
 * compte une allee, on ne feuillette pas. Il suit l'ordre du magasin que
 * renvoie le serveur (matiere, puis famille), avec un intertitre par matiere.
 *
 * Entree passe au meme champ de la ligne suivante : on descend la colonne
 * comme on descend l'allee.
 */
function TableComptage({
  vues,
  chargement,
  erreur,
  saisissable,
  tolMotif,
  setBrouillon,
}: {
  vues: LigneVue[]
  chargement: boolean
  erreur: unknown
  saisissable: boolean
  tolMotif: number
  setBrouillon: Dispatch<SetStateAction<Record<string, Saisie>>>
}) {
  const tolLot = useTolerancesLot()
  const conteneur = useRef<HTMLDivElement>(null)
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('TOUTES')

  /**
   * BOBINES ET PALETTES SE REPONDENT, par `bobines_par_palette` de la
   * reference. Le champ qu'on vient de taper commande et ne revient jamais
   * corrige ; l'autre suit. Les kilos, eux, ne suivent pas : c'est la pesee,
   * et c'est justement leur ecart au poids catalogue qu'on veut voir.
   */
  const maj = (l: LigneInv, champ: ChampSaisie, valeur: string) =>
    setBrouillon((b) => {
      const courant = b[l.id_ligne_inv] ?? saisieServeur(l)
      const suivant: Saisie = { ...courant, [champ]: valeur }
      const parPalette = positif(l.bobines_par_palette)
      const n = lire(valeur)
      if (parPalette !== null && (champ === 'bobines' || champ === 'palettes')) {
        const autre = champ === 'bobines' ? 'palettes' : 'bobines'
        // Vide vide l'autre ; illisible le laisse tel quel ; lisible le recalcule.
        if (n === null) suivant[autre] = ''
        else if (Number.isFinite(n) && n >= 0)
          suivant[autre] =
            champ === 'bobines'
              ? String(arrondi(n / parPalette, 2))
              : String(Math.round(n * parPalette))
      }
      return { ...b, [l.id_ligne_inv]: suivant }
    })

  const descendre = (e: KeyboardEvent<HTMLInputElement>, champ: ChampSaisie, rang: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    conteneur.current
      ?.querySelector<HTMLInputElement>(`[data-comptage="${champ}:${rang + 1}"]`)
      ?.focus()
  }

  const motif = recherche.trim().toLowerCase()
  const visibles = vues.filter((v) => {
    const l = v.ligne
    if (
      motif &&
      ![l.code_reference, l.designation, l.lot_fournisseur, libelleLot(l.lot_fournisseur)].some(
        (x) => x?.toLowerCase().includes(motif),
      )
    )
      return false
    // Les filtres lisent ce qui est ENREGISTRE (sauf « modifiées ») : une
    // ligne ne doit pas disparaitre sous les doigts pendant qu'on la saisit.
    switch (filtre) {
      case 'A_COMPTER':
        return l.statut_ligne === 'A_TRAITER'
      case 'ECARTS':
        return l.ecart_pct != null && Math.abs(Number(l.ecart_pct)) > tolMotif
      case 'MODIFIEES':
        return v.modifiee
      default:
        return true
    }
  })

  if (chargement) return <Chargement />
  if (erreur)
    return (
      <Alerte ton="danger">
        {erreur instanceof ErreurApi ? erreur.message : 'Lignes du comptage illisibles.'}
      </Alerte>
    )
  if (vues.length === 0)
    return (
      <EtatVide
        titre="Aucune ligne"
        description="Ouvrez l'inventaire pour commencer le comptage : le théorique se prend à l'heure de chaque comptage."
      />
    )

  const cellule = 'px-1.5 py-1 align-top'
  const champNombre = 'h-8 text-right tabular-nums'

  return (
    <Carte>
      <CarteCorps className="space-y-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Champ
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher une référence ou un lot..."
            aria-label="Chercher une référence ou un lot"
            className="w-72"
          />
          <Selecteur
            value={filtre}
            onChange={(e) => setFiltre(e.target.value as Filtre)}
            aria-label="Lignes affichées"
            className="w-56"
          >
            <option value="TOUTES">Toutes les lignes</option>
            <option value="A_COMPTER">Encore à compter</option>
            <option value="ECARTS">Écarts hors tolérance</option>
            <option value="MODIFIEES">Modifiées, non enregistrées</option>
          </Selecteur>
          {saisissable && (
            <span className="text-[11px] text-attenue-texte">
              Entrée descend à la ligne suivante. Bobines et palettes se répondent.
            </span>
          )}
        </div>

        {/* PAS DE DEFILEMENT HORIZONTAL (10/10/2026) : des colonnes resserrees au
            lieu d'une largeur plancher de 1 180 px qui debordait a 1366. */}
        <div ref={conteneur}>
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                <th className="px-1.5 py-2 text-left">Référence · lot</th>
                <th className="w-28 px-1.5 py-2 text-right">Théorique</th>
                <th className="w-28 px-1.5 py-2 text-right">Compté kg</th>
                <th className="w-20 px-1.5 py-2 text-right">Bobines</th>
                <th className="w-20 px-1.5 py-2 text-right">Palettes</th>
                <th className="w-28 px-1.5 py-2 text-right">Poids / bob.</th>
                <th className="w-24 px-1.5 py-2 text-right">Écart</th>
                <th className="w-44 px-1.5 py-2 text-left">
                  Motif
                  <Aide>
                    Obligatoire au-delà de {fmt.nombre(tolMotif, 1)} % d’écart (réglage
                    « Tolérance écart de pesée ») : la clôture le refuse sinon. Le poids par
                    bobine se colore selon les tolérances de lot ({fmt.nombre(tolLot.orange, 1)} %
                    / {fmt.nombre(tolLot.rouge, 1)} %).
                  </Aide>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-attenue-texte">
                    Aucune ligne ne correspond.
                  </td>
                </tr>
              )}
              {visibles.map((v, rang) => {
                const { ligne: l, saisie: s, analyse: a } = v
                const categorie = l.categorie_libelle ?? 'Sans catégorie'
                const precedente = rang > 0 ? (visibles[rang - 1].ligne.categorie_libelle ?? 'Sans catégorie') : null
                const bobTheo = nombre(l.nb_bobines_theorique)
                const parPalette = positif(l.bobines_par_palette)
                const couleurPoids = couleurEcart(a.poidsPct, tolLot)
                const motifManquant = a.motifRequis && !s.motif.trim()
                return [
                  categorie !== precedente && (
                    <tr key={`cat-${rang}`} className="bg-attenue/40">
                      <td
                        colSpan={8}
                        className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte"
                      >
                        {categorie}
                      </td>
                    </tr>
                  ),
                  <tr
                    key={l.id_ligne_inv}
                    className={cn(
                      'border-b border-bordure/60',
                      v.modifiee && 'bg-primaire/[0.05]',
                      v.modifiee && a.erreurs.length > 0 && 'bg-danger/[0.05]',
                    )}
                  >
                    <td className={cn(cellule, 'min-w-0', v.modifiee && 'border-l-2 border-l-primaire')}>
                      <div className="truncate font-medium">{l.code_reference}</div>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-attenue-texte">
                        {l.lot_fournisseur && (
                          <span
                            className={cn(
                              'shrink-0 rounded-sm px-1',
                              l.lot_fournisseur === SANS_LOT ? 'italic' : 'bg-attenue font-mono',
                            )}
                          >
                            {l.lot_fournisseur === SANS_LOT ? 'Sans lot' : `lot ${l.lot_fournisseur}`}
                          </span>
                        )}
                        {l.designation && <span className="truncate">{l.designation}</span>}
                      </div>
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right tabular-nums')}>
                      <div>{fmt.nombre(a.theoriqueKg, 2)} kg</div>
                      {bobTheo !== null && (
                        <div className="text-[11px] text-attenue-texte">
                          {fmt.entier(bobTheo)} bob.
                        </div>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          inputMode="decimal"
                          value={s.kg}
                          onChange={(e) => maj(l, 'kg', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'kg', rang)}
                          data-comptage={`kg:${rang}`}
                          placeholder={a.kgDeduit && a.kg !== null ? `≈ ${fmt.nombre(a.kg, 2)}` : 'à compter'}
                          aria-label={`Kilos comptés, ${l.code_reference}`}
                          aria-invalid={a.erreurs.some((x) => x.startsWith('kilos')) || undefined}
                          className={champNombre}
                        />
                      ) : (
                        <div className="pt-1 text-right tabular-nums">
                          {a.kg === null ? (
                            <span className="text-attenue-texte">à compter</span>
                          ) : (
                            fmt.nombre(a.kg, 2)
                          )}
                        </div>
                      )}
                      {a.kgDeduit && a.kg !== null && (
                        <div className="mt-0.5 text-right text-[11px] text-attenue-texte" title="Bobines × poids catalogue">
                          déduit des bobines
                        </div>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          inputMode="numeric"
                          value={s.bobines}
                          onChange={(e) => maj(l, 'bobines', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'bobines', rang)}
                          data-comptage={`bobines:${rang}`}
                          placeholder="bob."
                          aria-label={`Bobines comptées, ${l.code_reference}`}
                          aria-invalid={a.erreurs.some((x) => x.startsWith('bobines')) || undefined}
                          className={champNombre}
                        />
                      ) : (
                        <div className="pt-1 text-right tabular-nums">
                          {a.bobines === null ? '—' : fmt.entier(a.bobines)}
                        </div>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          inputMode="decimal"
                          value={s.palettes}
                          onChange={(e) => maj(l, 'palettes', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'palettes', rang)}
                          data-comptage={`palettes:${rang}`}
                          placeholder="pal."
                          aria-label={`Palettes comptées, ${l.code_reference}`}
                          aria-invalid={a.erreurs.some((x) => x.startsWith('palettes')) || undefined}
                          className={champNombre}
                        />
                      ) : (
                        <div className="pt-1 text-right tabular-nums">
                          {a.palettes === null ? '—' : fmt.nombre(a.palettes, 2)}
                        </div>
                      )}
                      {parPalette !== null && (
                        <div className="mt-0.5 text-right text-[11px] text-attenue-texte">
                          {fmt.entier(parPalette)} bob./pal.
                        </div>
                      )}
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right text-[12px] tabular-nums')}>
                      {a.poidsReel === null ? (
                        <span
                          className="text-attenue-texte"
                          title={
                            a.poidsCatalogue !== null
                              ? `Catalogue : ${fmt.nombre(a.poidsCatalogue, 3)} kg`
                              : 'Pas de poids de bobine au catalogue'
                          }
                        >
                          {a.poidsCatalogue !== null ? `cat. ${fmt.nombre(a.poidsCatalogue, 3)}` : '—'}
                        </span>
                      ) : (
                        <div
                          title={
                            a.poidsCatalogue !== null
                              ? `Catalogue : ${fmt.nombre(a.poidsCatalogue, 3)} kg`
                              : 'Pas de poids de bobine au catalogue'
                          }
                        >
                          <div className="font-medium">{fmt.nombre(a.poidsReel, 3)} kg</div>
                          {a.poidsPct !== null && (
                            <div
                              className={cn(
                                'text-[11px]',
                                couleurPoids === 'rouge'
                                  ? 'text-danger'
                                  : couleurPoids === 'orange'
                                    ? 'text-alerte'
                                    : 'text-succes',
                              )}
                            >
                              {a.poidsPct > 0 ? '+' : ''}
                              {fmt.nombre(a.poidsPct, 2)} % / cat. {fmt.nombre(a.poidsCatalogue, 3)}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className={cn(cellule, 'pt-2 text-right tabular-nums')}>
                      {a.ecartKg === null ? (
                        <span className="text-attenue-texte">—</span>
                      ) : (
                        <>
                          <div
                            className={cn(
                              a.ecartKg > 0 ? 'text-succes' : a.ecartKg < 0 ? 'text-danger' : '',
                            )}
                          >
                            {a.ecartKg > 0 ? '+' : ''}
                            {fmt.nombre(a.ecartKg, 2)} kg
                          </div>
                          {a.ecartPct !== null ? (
                            <Badge ton={a.motifRequis ? 'danger' : a.ecartPct === 0 ? 'neutre' : 'succes'}>
                              {a.ecartPct > 0 ? '+' : ''}
                              {fmt.nombre(a.ecartPct, 1)} %
                            </Badge>
                          ) : (
                            a.theoriqueKg === 0 &&
                            a.kg !== null &&
                            a.kg > 0 && <Badge ton="info">trouvé</Badge>
                          )}
                        </>
                      )}
                    </td>

                    <td className={cellule}>
                      {saisissable ? (
                        <Champ
                          value={s.motif}
                          onChange={(e) => maj(l, 'motif', e.target.value)}
                          onKeyDown={(e) => descendre(e, 'motif', rang)}
                          data-comptage={`motif:${rang}`}
                          placeholder={a.motifRequis ? 'motif requis' : '—'}
                          aria-label={`Motif de l'écart, ${l.code_reference}`}
                          aria-invalid={motifManquant || undefined}
                          className="h-8"
                        />
                      ) : (
                        <div className="truncate pt-1">
                          {s.motif ? (
                            s.motif
                          ) : motifManquant ? (
                            <span className="text-danger">requis</span>
                          ) : (
                            <span className="text-attenue-texte">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </CarteCorps>
    </Carte>
  )
}

// --- Creation ---------------------------------------------------------------

function FormulaireInventaire({
  surFermeture,
  surSucces,
}: {
  surFermeture: () => void
  surSucces: (id: string) => void
}) {
  const [form, setForm] = useState({ code_magasin: '', type_inventaire: 'GLOBAL' })
  const [erreur, setErreur] = useState<string | null>(null)

  const qMag = useQuery({
    queryKey: ['magasins'],
    queryFn: ({ signal }) => api.get<{ code_magasin: string; nom: string }[]>('/api/magasins?actif=1', { signal }),
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ id_inventaire: string; numero_inventaire: string }>('/api/inventaires', form),
    onSuccess: (r) => {
      toast.success(`Inventaire ${r.numero_inventaire} cree.`)
      surSucces(r.id_inventaire)
    },
    onError: (e) => setErreur(e instanceof ErreurApi ? e.message : 'Création impossible.'),
  })

  return (
    <Carte>
      <CarteCorps>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            creer.mutate()
          }}
          className="space-y-3"
        >
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
            Nouvel inventaire
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <Etiq htmlFor="mag" obligatoire>
                Magasin
              </Etiq>
              <Selecteur
                id="mag"
                required
                value={form.code_magasin}
                onChange={(e) => setForm({ ...form, code_magasin: e.target.value })}
              >
                <option value="">—</option>
                {qMag.data?.map((m) => (
                  <option key={m.code_magasin} value={m.code_magasin}>
                    {m.nom}
                  </option>
                ))}
              </Selecteur>
            </div>
            <div className="w-72">
              <Etiq htmlFor="type" obligatoire>
                Type
                <Aide>
                  Global : toutes les références actives du catalogue, avec un théorique à zéro là
                  où la base ne connaît pas de stock. C’est le seul qui découvre une marchandise
                  ignorée. Ce qu’il trouve entre au CMUP du magasin, ou à défaut au prix
                  catalogue — l’ajustement d’inventaire ne porte pas de prix. Un stock de départ se
                  charge par l’initialisation de stock, avec ou sans prix. Tournant et ciblé : seulement les
                  références déjà en stock dans ce magasin. Le ciblé ne permet pas encore de choisir
                  ses références.
                </Aide>
              </Etiq>
              <Selecteur
                id="type"
                value={form.type_inventaire}
                onChange={(e) => setForm({ ...form, type_inventaire: e.target.value })}
              >
                <option value="GLOBAL">Global — tout le catalogue</option>
                <option value="TOURNANT">Tournant — le stock existant</option>
                <option value="CIBLE">Ciblé — le stock existant</option>
              </Selecteur>
            </div>
            <div className="flex gap-2">
              <Bouton type="button" variante="contour" onClick={surFermeture}>
                Annuler
              </Bouton>
              <Bouton type="submit" chargement={creer.isPending}>
                Créer
              </Bouton>
            </div>
          </div>
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}
        </form>
      </CarteCorps>
    </Carte>
  )
}

/**
 * UN LOT TROUVE AU COMPTAGE (01/10/2026).
 *
 * Le rayon porte un lot que la base ne connait pas — le plus souvent du stock
 * « sans lot » qu'on identifie enfin. On le saisit ici : le serveur lui ouvre
 * sa ligne au theorique zero, et la cloture fait entrer ce lot tout en
 * soldant ce qui ne se retrouve plus (comptez alors « Sans lot » a ce qui
 * reste vraiment). Seulement pour une reference suivie par lot.
 */
function LotTrouve({
  magasin, references, enCours, ajouter,
}: {
  magasin: string
  references: string[]
  enCours: boolean
  ajouter: (c: { code_reference: string; lot_fournisseur: string; quantite_comptee_kg: number }) => Promise<unknown>
}) {
  const [ref, setRef] = useState('')
  const [lot, setLot] = useState('')
  const [kg, setKg] = useState('')
  const pret = !!ref.trim() && !!lot.trim() && (lireNombre(kg) ?? 0) >= 0 && kg.trim() !== ''
  const champ = 'h-8 rounded-[var(--radius-sm)] border border-bordure bg-fond px-2 text-[12.5px]'
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-dashed border-bordure bg-attenue/20 p-2">
      <div className="w-full text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
        Lot trouvé au comptage — magasin {magasin}
      </div>
      <input list="refs-inventaire" value={ref} onChange={(e) => setRef(e.target.value)}
        placeholder="Référence" aria-label="Référence du lot trouvé" className={cn(champ, 'w-64')} />
      <datalist id="refs-inventaire">
        {references.map((r) => <option key={r} value={r} />)}
      </datalist>
      <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="N° de lot"
        aria-label="Numéro du lot trouvé" className={cn(champ, 'w-44')} />
      <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" placeholder="Compté (kg)"
        aria-label="Quantité comptée en kilos" className={cn(champ, 'w-32 text-right')} />
      <Bouton taille="sm" className="h-8" disabled={!pret} chargement={enCours}
        onClick={async () => {
          await ajouter({ code_reference: ref.trim(), lot_fournisseur: lot.trim(), quantite_comptee_kg: (lireNombre(kg) ?? 0) })
          setLot('')
          setKg('')
        }}>
        Ajouter le lot
      </Bouton>
    </div>
  )
}

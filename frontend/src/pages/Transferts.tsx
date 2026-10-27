/**
 * Transferts inter-magasins.
 *
 * Un transfert valide produit DEUX mouvements distincts (R10) : une sortie du
 * magasin source et une entree au magasin destinataire, valorisee au CMUP
 * source pour que la valeur suive la marchandise.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarClock,
  CornerDownRight,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Truck,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral, type GroupeRail } from '../composants/RailLateral'
import {
  PanneauFiltres,
  useFiltres,
  type ChampFiltre,
} from '../composants/PanneauFiltres'

import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Alerte, Badge, Bouton, Champ, Chargement } from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { fmt } from '../lib/utils'
import { AvisInventaireOuvert } from '../composants/AvisInventaireOuvert'
import { gelsTouches, phraseGel, useInventairesOuverts } from '../lib/inventairesOuverts'
import { StatutBadge } from '../composants/StatutBadge'

const MODULE = 'MOUVEMENTS'

interface Transfert extends Record<string, unknown> {
  id_transfert: string
  numero_transfert: string
  date_transfert: string
  code_magasin_source: string
  code_magasin_dest: string
  statut: string
  nb_lignes: number
  auteur: string | null
  observations: string | null
  receptionnaire: string | null
  date_reception_dest: string | null
  quantite_totale_kg: number
  jours_en_transit: number | null
  /** Date prevue de disponibilite au destinataire ('AAAA-MM-JJ'), exigee a l'expedition (27/10/2026). */
  date_disponibilite_prevue?: string | null
  /** Renseigne seulement en route (VALIDE) et date depassee. */
  jours_de_retard_disponibilite?: number | null
  /** Verrou optimiste : la revision de la date l'exige. */
  version?: number
  /** Ses references : un inventaire tournant ou cible ne gele qu'elles (2026-10-24a). */
  references?: string[] | null
}

/** La saisie de la date prevue, ouverte SUR LA LIGNE (jamais en fenetre surgissante). */
interface SaisieDate {
  id: string
  mode: 'expedier' | 'reviser'
  valeur: string
}

/** Le jour de Casablanca (20/10/2026), au format du champ date. */
const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' })

/* Des axes que l'on choisit, pas de comparateur a saisir : les valeurs
   des listes sortent des lignes affichees. */
const CHAMPS_TRANSFERT: ChampFiltre<Transfert>[] = [
  { cle: 'periode', libelle: 'Période', type: 'periode', valeur: (l) => l.date_transfert },
  { cle: 'statut', libelle: 'Statut', type: 'liste', valeur: (l) => l.statut },
  { cle: 'source', libelle: 'Magasin source', type: 'liste', valeur: (l) => l.code_magasin_source },
  { cle: 'dest', libelle: 'Magasin destinataire', type: 'liste', valeur: (l) => l.code_magasin_dest },
  { cle: 'auteur', libelle: 'Auteur', type: 'liste', valeur: (l) => l.auteur },
  { cle: 'numero', libelle: 'Numéro', type: 'texte', valeur: (l) => l.numero_transfert },
]

export function Transferts() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const naviguer = useNavigate()
  const [statut, setStatut] = useState('')
  const [saisieDate, setSaisieDate] = useState<SaisieDate | null>(null)
  const filtres = useFiltres(CHAMPS_TRANSFERT)

  const q = useQuery({
    queryKey: ['transferts'],
    queryFn: ({ signal }) => api.get<Transfert[]>('/api/transferts', { signal }),
  })

  /* LE FIL EN ROUTE COUVRE LE PLAN A SA DATE PREVUE (27/10/2026) : expedier,
     recevoir ou reviser la date deplace la couverture du plan d'achat. */
  const rafraichirCouverture = () => {
    void qc.invalidateQueries({ queryKey: ['couverture'] })
    void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
    void qc.invalidateQueries({ queryKey: ['plan-achat-kpi'] })
    void qc.invalidateQueries({ queryKey: ['plan-achat-detail'] })
    // Le bon imprimable relit l'en-tete (date prevue, retard).
    void qc.invalidateQueries({ queryKey: ['dossier-transfert'] })
  }

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['transferts'] })
    void qc.invalidateQueries({ queryKey: ['stock-projete'] })
    void qc.invalidateQueries({ queryKey: ['mouvements'] })
    rafraichirCouverture()
  }

  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')

  /* LES MAGASINS GELES PAR UN INVENTAIRE OUVERT (23/10/2026) : ni depart du
     magasin source, ni arrivee au destinataire tant qu'il est ouvert (la base
     refuse, INVENTAIRE-OUVERT) — tout le magasin pour un global, ses seules
     references pour un tournant ou un cible (2026-10-24a) : le transfert n'est
     arrete que s'il en porte une. */
  const ouverts = useInventairesOuverts().data ?? []
  const gelDe = (mag: string, refs: string[] | null | undefined) =>
    phraseGel(gelsTouches(ouverts, [mag], (refs ?? []).map((reference) => ({ magasin: mag, reference }))), true)

  /** Etape 1, au magasin SOURCE : la marchandise part. */
  const expedier = useMutation({
    /* LA DATE PREVUE DE DISPONIBILITE part avec l'expedition (27/10/2026) :
       celle saisie sur la ligne, ou celle du brouillon. Sans date, la base
       refuse (TRF-DATE). */
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      api.post<{
        quantite_totale_kg: number
        valeur_totale_mad: number
        mouvement: string
        magasin_destinataire: string | null
      }>(`/api/transferts/${id}/expedier`, date ? { date_disponibilite_prevue: date } : undefined),
    onSuccess: (r) => {
      setSaisieDate(null)
      toast.success(`Expedie : ${fmt.nombre(r.quantite_totale_kg, 2)} kg partis.`, {
        description:
          `La marchandise est EN TRANSIT et n'est comptee dans aucun magasin. ` +
          `Elle entrera en stock a ${r.magasin_destinataire} quand quelqu'un y constatera ` +
          `son arrivee.`,
        duration: 10000,
      })
      rafraichir()
    },
    onError: (e, { id }) => {
      // Sans date, la base refuse : la saisie s'ouvre sur la ligne.
      if (e instanceof ErreurApi && e.estRegle('TRF-DATE'))
        setSaisieDate((s) => (s?.id === id ? s : { id, mode: 'expedier', valeur: '' }))
      echec(e)
    },
  })

  /** En route, la date prevue se revise ; plus apres la reception (TRF-DATE). */
  const reviserDate = useMutation({
    mutationFn: ({ id, date, version }: { id: string; date: string; version: number | undefined }) =>
      api.post<{ id_transfert: string; date_disponibilite_prevue: string; version: number }>(
        `/api/transferts/${id}/date-disponibilite`,
        { date_disponibilite_prevue: date, version },
      ),
    onSuccess: (r) => {
      setSaisieDate(null)
      toast.success(`Disponibilité prévue le ${fmt.date(r.date_disponibilite_prevue)}.`, {
        description: "La couverture du plan d'achat compte ce fil à cette date.",
      })
      void qc.invalidateQueries({ queryKey: ['transferts'] })
      rafraichirCouverture()
    },
    onError: (e) => {
      // Un autre poste l'a change (409) : on relit la liste avant de reessayer.
      if (e instanceof ErreurApi && e.statut === 409) void qc.invalidateQueries({ queryKey: ['transferts'] })
      echec(e)
    },
  })

  /** Expedier : avec la date du brouillon, ou en la demandant sur la ligne. */
  const demanderExpedition = (t: Transfert, date: string | null) =>
    confirmation.demander({
      titre: `Expedier ${t.numero_transfert} ?`,
      description:
        `${t.nb_lignes} ligne(s) vont QUITTER ${t.code_magasin_source}. ` +
        `Elles ne seront comptees dans aucun magasin tant que quelqu'un ne les ` +
        `aura pas constatees a ${t.code_magasin_dest}` +
        (date ? `, où elles sont attendues le ${fmt.date(date)}` : '') +
        `. Le mouvement de sortie est immuable.`,
      libelleConfirmer: 'Expédier',
      action: () => expedier.mutate({ id: t.id_transfert, date }),
    })

  /** Etape 2, au magasin DESTINATAIRE : quelqu'un constate l'arrivee. */
  const receptionner = useMutation({
    mutationFn: (id: string) =>
      api.post<{ quantite_totale_kg: number; valeur_totale_mad: number; mouvement: string }>(
        `/api/transferts/${id}/receptionner`,
      ),
    onSuccess: (r) => {
      toast.success(`Recu : ${fmt.nombre(r.quantite_totale_kg, 2)} kg entres en stock.`, {
        description:
          `Valorises ${fmt.nombre(r.valeur_totale_mad, 2)} MAD, au CMUP fige au depart — ` +
          `et non a celui du magasin source aujourd'hui.`,
        duration: 10000,
      })
      rafraichir()
    },
    onError: echec,
  })

  const colonnes: ColonneDT<Transfert>[] = [
    {
      champ: 'numero_mouvement',
      entete: 'Numéro',
      rendu: (t) => <span className="font-mono text-xs">{t.numero_transfert}</span>,
    },
    { champ: 'date_mouvement', entete: 'Date', rendu: (t) => fmt.date(t.date_transfert) },
    {
      champ: 'code_magasin',
      entete: 'Trajet',
      rendu: (t) => (
        <div className="flex items-center gap-1.5 text-sm">
          <Badge ton="neutre">{t.code_magasin_source}</Badge>
          <ArrowRight className="size-3 text-attenue-texte" />
          <Badge ton="info">{t.code_magasin_dest}</Badge>
        </div>
      ),
    },
    {
      champ: 'quantite_kg',
      entete: 'Contenu',
      numerique: true,
      rendu: (t) => (
        <div className="text-right">
          <div className="tabular-nums">{t.nb_lignes} ligne(s)</div>
          {t.quantite_totale_kg > 0 && (
            <div className="text-[11px] tabular-nums text-attenue-texte">
              {fmt.nombre(t.quantite_totale_kg, 0)} kg
            </div>
          )}
        </div>
      ),
    },
    {
      champ: 'statut',
      entete: 'Ou est la marchandise',
      largeur: '190px',
      rendu: (t) => (
        <div>
          <StatutBadge entite="transfert" code={t.statut} />
          {t.statut === 'VALIDE' && (t.jours_en_transit ?? 0) > 0 && (
            <div className="mt-0.5 text-[11px] text-alerte">
              en route depuis {t.jours_en_transit} j
            </div>
          )}
        </div>
      ),
    },
    {
      /* LA DATE PREVUE AU DESTINATAIRE (27/10/2026) : la couverture du plan
         d'achat compte le fil en route a cette date. Depassee sans nouvelle
         date, ou absente (expedie avant la regle, C66) : rien n'est compte. */
      champ: 'date_disponibilite_prevue',
      entete: 'Disponible le',
      largeur: '120px',
      valeurTri: (t) => t.date_disponibilite_prevue ?? null,
      rendu: (t) => {
        const retard = t.jours_de_retard_disponibilite ?? 0
        if (t.date_disponibilite_prevue)
          return (
            <div className="text-[12.5px]">
              <div className="tabular-nums">{fmt.date(t.date_disponibilite_prevue)}</div>
              {retard > 0 && (
                <div
                  className="text-[11px] text-alerte"
                  title="Date dépassée : ce fil ne couvre plus le plan tant qu'une nouvelle date n'est pas saisie."
                >
                  en retard de {retard} j
                </div>
              )}
            </div>
          )
        return t.statut === 'VALIDE' ? (
          <Badge
            ton="alerte"
            title="Expédié sans date prévue : ce fil ne couvre pas le plan d'achat (contrôle C66)."
          >
            sans date
          </Badge>
        ) : (
          <span className="text-attenue-texte">—</span>
        )
      },
    },
    {
      champ: 'utilisateur',
      entete: 'Expédié / reçu par',
      secondaire: true,
      rendu: (t) => (
        <div className="text-[12px]">
          <div>{fmt.texte(t.auteur)}</div>
          {t.receptionnaire ? (
            <div className="text-[11px] text-attenue-texte">
              recu par {t.receptionnaire}
              {t.date_reception_dest && ` le ${fmt.date(t.date_reception_dest)}`}
            </div>
          ) : (
            t.statut === 'VALIDE' && (
              <div className="text-[11px] text-alerte">arrivee non constatee</div>
            )
          )}
        </div>
      ),
    },
  ]

  const tous = q.data ?? []
  const comptes = tous.reduce<Record<string, number>>((m, t) => {
    m[t.statut] = (m[t.statut] ?? 0) + 1
    return m
  }, {})
  const horsCouverture = tous.filter(
    (t) =>
      t.statut === 'VALIDE' &&
      (!t.date_disponibilite_prevue || (t.jours_de_retard_disponibilite ?? 0) > 0),
  ).length
  const filtrables = tous.filter((t) => !statut || t.statut === statut)
  const vus = filtrables.filter(filtres.retenir)

  const groupes: GroupeRail[] = [
    { entrees: [{ cle: '', libelle: 'Tous les transferts', compte: tous.length }] },
    {
      titre: 'Par statut',
      entrees: [
        {
          cle: 'BROUILLON',
          libelle: 'En preparation',
          resume: 'Rien n’a bouge',
          compte: comptes.BROUILLON ?? 0,
          ton: 'neutre' as const,
        },
        {
          cle: 'VALIDE',
          libelle: 'En transit',
          resume: 'Parti, arrivée non constatée',
          compte: comptes.VALIDE ?? 0,
          ton: 'alerte' as const,
        },
        {
          cle: 'TERMINE',
          libelle: 'Reçu',
          resume: 'Entre en stock a destination',
          compte: comptes.TERMINE ?? 0,
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

  /*
   * LA SAISIE DE LA DATE, SOUS LA LIGNE (27/10/2026) — pas de fenetre
   * surgissante : a l'expedition d'un brouillon sans date, et pour la reviser
   * tant que le fil est en route.
   */
  const saisieDeLigne = (t: Transfert) => {
    const s = saisieDate
    if (!s || s.id !== t.id_transfert) return null
    // Le transfert a change d'etat sous la saisie (recu, annule) : elle n'a plus d'objet.
    if ((s.mode === 'expedier' && t.statut !== 'BROUILLON') || (s.mode === 'reviser' && t.statut !== 'VALIDE'))
      return null
    const expedition = s.mode === 'expedier'
    const idChamp = `dispo-${t.id_transfert}`
    const inchangee = !expedition && s.valeur === (t.date_disponibilite_prevue ?? '').slice(0, 10)
    const valider = () => {
      if (!s.valeur) return
      if (expedition) demanderExpedition(t, s.valeur)
      else reviserDate.mutate({ id: t.id_transfert, date: s.valeur, version: t.version })
    }
    return (
      <form
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
        onSubmit={(e) => {
          e.preventDefault()
          valider()
        }}
      >
        <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-attenue-texte" />
        <label htmlFor={idChamp} className="font-medium">
          Disponible au magasin destinataire ({t.code_magasin_dest}) le
        </label>
        <Champ
          id={idChamp}
          type="date"
          required
          autoFocus
          min={aujourdhui()}
          value={s.valeur}
          onChange={(e) => setSaisieDate({ ...s, valeur: e.target.value })}
          className="h-7 w-40"
        />
        <Bouton
          type="submit"
          taille="sm"
          disabled={!s.valeur || inchangee}
          chargement={expedition ? expedier.isPending : reviserDate.isPending}
        >
          {expedition ? <Truck /> : <CalendarClock />}
          {expedition ? 'Expédier avec cette date' : 'Enregistrer la date'}
        </Bouton>
        <Bouton type="button" variante="discret" taille="sm" onClick={() => setSaisieDate(null)}>
          Annuler
        </Bouton>
        <span className="text-[11px] text-attenue-texte">
          {expedition
            ? "Obligatoire à l'expédition : le plan d'achat compte ce fil à cette date."
            : 'Révisable tant que le transfert est en route.'}
        </span>
      </form>
    )
  }

  if (q.isLoading) return <Chargement />

  return (
    <div>
      <EnTetePage
        titre="Transferts"
        description="Un transfert valide généré deux mouvements : sortie du magasin source, entrée au destinataire."
        actions={
          droits.peutEcrire && (
            <Bouton taille="icone" title="Nouveau transfert" aria-label="Nouveau transfert" onClick={() => naviguer('/transferts/nouveau')}>              <Plus />            </Bouton>
          )
        }
      />

      <AvisInventaireOuvert inventaires={ouverts} nommer className="mb-3" />

      {(comptes.VALIDE ?? 0) > 0 && (
        <Alerte ton="alerte" titre="Marchandise en transit" className="mb-3">
          {comptes.VALIDE} transfert(s) ont quitté leur magasin source sans que l’arrivée ait été
          constatée. Cette marchandise n’est comptée <strong>dans aucun magasin</strong> ; le plan
          d’achat la compte à sa date prévue de disponibilité au destinataire.
          {horsCouverture > 0 && (
            <>
              {' '}
              <strong>{horsCouverture}</strong> d’entre eux, sans date ou en retard, ne couvrent
              aucun besoin tant qu’une nouvelle date n’est pas saisie (« Réviser la date »).
            </>
          )}
        </Alerte>
      )}

      <PageAvecRail
        large
        rail={
          <div className="space-y-3">
            <RailLateral groupes={groupes} actif={statut} surChoix={setStatut} />
            <PanneauFiltres
              champs={CHAMPS_TRANSFERT}
              lignes={filtrables}
              valeurs={filtres.valeurs}
              definir={filtres.definir}
              reinitialiser={filtres.reinitialiser}
              actifs={filtres.actifs}
            />
          </div>
        }
      >
      <DataTable<Transfert>
          exportable="transferts"
          imprimable="Transferts"
        module={MODULE}
        colonnes={colonnes}
        lignes={vus}
        cle={(t) => t.id_transfert}
        titreCarte={(t) => t.numero_transfert}
        placeholderRecherche="Filtrer les transferts..."
        videTitre="Aucun transfert"
        detail={saisieDeLigne}
        actions={(t) =>
          // Deux etapes, deux boutons, jamais les deux en meme temps : ce qui
          // est propose depend de l'endroit ou se trouve la marchandise.
          t.statut === 'BROUILLON' && droits.peutEcrire ? (
            <div className="flex gap-1">
              {/* Tant que rien n'est parti, le document se reprend en entier :
                  en-tete et lignes, sur l'ecran meme qui l'a cree. */}
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => naviguer(`/transferts/${t.id_transfert}/modifier`)}
                title="Reprendre l'en-tete et les lignes"
              >
                <Pencil />
                Modifier
              </Bouton>
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => naviguer(`/transferts/${t.id_transfert}/bon-sortie`)}
                title="Bon de sortie, a joindre au chargement"
              >
                <Printer />
                Bon
              </Bouton>
              {droits.peutValider && (
                <Bouton
                  variante="contour"
                  taille="sm"
                  disabled={t.nb_lignes === 0 || !!gelDe(t.code_magasin_source, t.references)}
                  title={gelDe(t.code_magasin_source, t.references) ?? undefined}
                  chargement={expedier.isPending && expedier.variables?.id === t.id_transfert}
                  aria-expanded={saisieDate?.id === t.id_transfert}
                  onClick={() =>
                    // LA DATE EST EXIGEE A L'EXPEDITION (27/10/2026) : deja
                    // saisie sur le brouillon, elle part telle quelle ; sinon
                    // elle se saisit sur la ligne, juste dessous.
                    t.date_disponibilite_prevue
                      ? demanderExpedition(t, t.date_disponibilite_prevue)
                      : setSaisieDate((s) =>
                          s?.id === t.id_transfert && s.mode === 'expedier'
                            ? null
                            : { id: t.id_transfert, mode: 'expedier', valeur: '' },
                        )
                  }
                >
                  <Truck />
                  Expédier
                </Bouton>
              )}
            </div>
          ) : t.statut === 'VALIDE' && (droits.peutValider || droits.peutEcrire) ? (
            <div className="flex gap-1">
              {droits.peutEcrire && (
                <Bouton
                  variante="contour"
                  taille="sm"
                  aria-expanded={saisieDate?.id === t.id_transfert}
                  title="Date prévue de disponibilité au magasin destinataire"
                  onClick={() =>
                    setSaisieDate((s) =>
                      s?.id === t.id_transfert
                        ? null
                        : {
                            id: t.id_transfert,
                            mode: 'reviser',
                            valeur: (t.date_disponibilite_prevue ?? '').slice(0, 10),
                          },
                    )
                  }
                >
                  <CalendarClock />
                  Réviser la date
                </Bouton>
              )}
              {droits.peutValider && (
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => naviguer(`/transferts/${t.id_transfert}/bon-reception`)}
                title="Bon de réception, a remplir au déchargement"
              >
                <Printer />
                Bon de réception
              </Bouton>
              )}
              {droits.peutValider && (
              <Bouton
              variante="contour"
              taille="sm"
              disabled={!!gelDe(t.code_magasin_dest, t.references)}
              title={gelDe(t.code_magasin_dest, t.references) ?? undefined}
              chargement={receptionner.isPending}
              onClick={() =>
                confirmation.demander({
                  titre: `Constater l'arrivee de ${t.numero_transfert} ?`,
                  description:
                    `${t.nb_lignes} ligne(s) entreront en stock a ${t.code_magasin_dest}, ` +
                    `valorisees au CMUP fige au depart. A ne faire qu'apres avoir vu la ` +
                    `marchandise sur place.`,
                  libelleConfirmer: 'Constater la réception',
                  action: () => receptionner.mutate(t.id_transfert),
                })
              }
            >
              <PackageCheck />
              Réceptionner
            </Bouton>
              )}
            </div>
          ) : t.statut === 'TERMINE' ? (
            <Bouton
              variante="contour"
              taille="sm"
              onClick={() => naviguer(`/transferts/${t.id_transfert}/bon-sortie`)}
              title="Reimprimer le bon de sortie"
            >
              <Printer />
              Bon de sortie
            </Bouton>
          ) : null
        }
      />
      </PageAvecRail>


      {confirmation.element}
    </div>
  )
}

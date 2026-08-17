/**
 * Cockpit — le poste de travail.
 *
 * Deux questions, dans cet ordre, parce que c'est l'ordre dans lequel on les
 * pose en arrivant le matin :
 *
 *   1. QU'EST-CE QUI M'ATTEND ? Une bande de tuiles-compteurs, chacune une file
 *      qui se vide quand quelqu'un fait son travail, chacune menant a la liste
 *      deja filtree. Un chiffre qui ne mene nulle part n'a rien a faire ici.
 *
 *   2. EST-CE QUE JE TIENS LE PLAN ? Le mur de risques : mois par mois, les
 *      references qui ne passent pas les douze prochains mois, triees par le
 *      temps qu'il reste REELLEMENT pour agir — echeance moins delai
 *      fournisseur. Une rupture lointaine chez un fournisseur rapide n'est pas
 *      une urgence ; une tension le mois prochain chez un mono-source a 90
 *      jours en est une.
 *
 * Deux regles de composition, tenues partout :
 *
 *   * une tuile n'apparait que si le role a le droit de VOIR le champ ET la
 *     permission d'AGIR dessus. Afficher « 3 bons a valider » a qui ne peut pas
 *     valider n'est pas une information, c'est du bruit ;
 *   * une file vide disparait. Un ecran couvert de zeros apprend a ne plus etre
 *     lu, et le jour ou un compteur monte, personne ne le voit.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileCheck2,
  FileClock,
  Moon,
  PackageX,
  Send,
  ShieldAlert,
  TrendingDown,
  Truck,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import {
  Alerte,
  Badge,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Squelette,
} from '../composants/ui/base'
import { Infobulle } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'COCKPIT'

interface Kpi {
  [k: string]: unknown
}

interface Controle {
  code: string
  controle: string
  criticite: string
  anomalies: number
}

interface MoisRisque {
  annee_mois: string
  rang_mois: number
  besoin_kg: number
  entrees_kg: number
  stock_fin_kg: number
  stock_min_kg: number
  statut: 'COUVERT' | 'TENDU' | 'RUPTURE'
}

interface Risque {
  code_reference: string
  designation: string
  classe_abc: string | null
  fournisseur_nom: string | null
  delai_livraison_jours: number | null
  risque_sourcing: string
  stock_initial_kg: number
  stock_min_kg: number
  nb_mois_rupture: number
  nb_mois_tendu: number
  premier_mois_risque: string | null
  marge_decision_jours: number | null
  equivalent_dispo_kg: number | null
  equivalent_reference: string | null
  mois: MoisRisque[]
}

type Ton = 'danger' | 'alerte' | 'succes' | 'neutre'

interface Tuile {
  champ: string
  libelle: string
  valeur: number
  affichage?: string
  detail?: string
  ton: Ton
  Icone: React.ComponentType<{ className?: string }>
  vers?: string
  /** Faux si le role ne peut rien faire de ce compteur : la tuile disparait. */
  actionnable?: boolean
  /** Une tuile d'ETAT reste visible a zero ; une FILE vide s'efface. */
  toujours?: boolean
}

const TEINTE: Record<Ton, string> = {
  danger: 'text-danger',
  alerte: 'text-alerte',
  succes: 'text-succes',
  neutre: 'text-texte',
}

export function Cockpit() {
  const droits = useDroits(MODULE)
  const { peut } = useAuth()

  const qKpi = useQuery({ queryKey: ['cockpit'], queryFn: () => api.get<Kpi>('/api/cockpit') })
  const qCtl = useQuery({
    queryKey: ['controles'],
    queryFn: () => api.get<Controle[]>('/api/controles'),
  })
  const qRisques = useQuery({
    queryKey: ['cockpit-risques'],
    queryFn: () => api.get<Risque[]>('/api/cockpit/risques'),
  })

  const k = qKpi.data ?? {}
  const n = (champ: string) => Number(k[champ] ?? 0)

  const files: Tuile[] = [
    {
      champ: 'nb_propositions_a_traiter',
      libelle: 'Propositions a arbitrer',
      valeur: n('nb_propositions_a_traiter'),
      detail: 'plan d achat',
      ton: 'alerte',
      Icone: FileClock,
      vers: '/plan-achat',
      actionnable: peut('PLAN_ACHAT', 'ECRIRE'),
    },
    {
      champ: 'nb_bc_a_valider',
      libelle: 'Bons a valider',
      valeur: n('nb_bc_a_valider'),
      detail: droits.visible('montant_bc_a_valider_mad')
        ? `${fmt.compact(n('montant_bc_a_valider_mad'))} MAD engages`
        : undefined,
      ton: 'alerte',
      Icone: FileCheck2,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'VALIDER'),
    },
    {
      champ: 'nb_bc_a_envoyer',
      libelle: 'Bons a envoyer',
      valeur: n('nb_bc_a_envoyer'),
      detail: 'valides, pas encore partis',
      ton: 'alerte',
      Icone: Send,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'ECRIRE'),
    },
    {
      champ: 'nb_livraisons_en_retard',
      libelle: 'Livraisons en retard',
      valeur: n('nb_livraisons_en_retard'),
      detail: n('retard_max_jours') > 0 ? `jusqu a ${n('retard_max_jours')} j` : undefined,
      ton: 'danger',
      Icone: Clock,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'LIRE'),
    },
    {
      champ: 'nb_receptions_a_controler',
      libelle: 'Receptions a controler',
      valeur: n('nb_receptions_a_controler'),
      detail: 'en attente du controle qualite',
      ton: 'alerte',
      Icone: ClipboardCheck,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'VALIDER'),
    },
    {
      champ: 'nb_receptions_en_saisie',
      libelle: 'Receptions en saisie',
      valeur: n('nb_receptions_en_saisie'),
      detail: 'pesees non soumises',
      ton: 'neutre',
      Icone: Truck,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'ECRIRE'),
    },
    {
      champ: 'nb_receptions_a_regulariser',
      libelle: 'A regulariser',
      valeur: n('nb_receptions_a_regulariser'),
      detail: 'bon non envoye : controle bloque',
      ton: 'danger',
      Icone: ShieldAlert,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'LIRE'),
    },
    {
      champ: 'nb_lignes_non_conformes',
      libelle: 'Lignes non conformes',
      valeur: n('nb_lignes_non_conformes'),
      detail: 'quarantaine ou refus',
      ton: 'danger',
      Icone: PackageX,
      vers: '/receptions',
      actionnable: peut('RECEPTIONS', 'LIRE'),
    },
    {
      champ: 'nb_refs_sous_minimum',
      libelle: 'Sous le stock minimum',
      valeur: n('nb_refs_sous_minimum'),
      detail: 'projete sous le seuil',
      ton: 'danger',
      Icone: TrendingDown,
      vers: '/plan-achat',
      actionnable: peut('PLAN_ACHAT', 'LIRE'),
    },
    {
      champ: 'nb_lots_peremption_proche',
      libelle: 'Lots a moins de 90 j',
      valeur: n('nb_lots_peremption_proche'),
      detail: 'peremption proche',
      ton: 'alerte',
      Icone: Clock,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
    },
    {
      champ: 'nb_refs_dormantes',
      libelle: 'References dormantes',
      valeur: n('nb_refs_dormantes'),
      detail: droits.visible('valeur_dormante_mad')
        ? `${fmt.compact(n('valeur_dormante_mad'))} MAD immobilises`
        : undefined,
      ton: 'alerte',
      Icone: Moon,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
    },
    {
      champ: 'nb_controles_bloquants',
      libelle: 'Controles bloquants',
      valeur: n('nb_controles_bloquants'),
      detail: 'coherence du referentiel',
      ton: 'danger',
      Icone: AlertTriangle,
      actionnable: true,
    },
  ]

  // Les tuiles d'ETAT : elles decrivent la situation, pas une file. Elles
  // restent affichees a zero — « 0 rupture » est une bonne nouvelle qu'on veut
  // lire, alors que « 0 bon a valider » est juste une file vide.
  const etats: Tuile[] = [
    {
      champ: 'nb_ruptures',
      libelle: 'Ruptures',
      valeur: n('nb_ruptures'),
      detail: 'stock projete a zero',
      ton: n('nb_ruptures') > 0 ? 'danger' : 'succes',
      Icone: PackageX,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
      toujours: true,
    },
    {
      champ: 'nb_attention',
      libelle: 'Sous surveillance',
      valeur: n('nb_attention'),
      affichage: `${n('nb_attention')}`,
      detail: `sur ${n('nb_references')} references`,
      ton: 'alerte',
      Icone: TrendingDown,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
      toujours: true,
    },
    {
      // Le VETO PHYSIQUE. Ces references ne raisonnent pas : elles sont sous
      // leur minimum dans les allees, aujourd'hui, quoi que dise la couverture.
      champ: 'nb_critiques',
      libelle: 'Sous le minimum',
      valeur: n('nb_critiques'),
      detail: 'constate au magasin, pas projete',
      ton: n('nb_critiques') > 0 ? 'danger' : 'succes',
      Icone: PackageX,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
      toujours: true,
    },
    {
      // SECOND AXE : ne dit pas qu'on va manquer, dit qu'on immobilise.
      champ: 'nb_sur_stock',
      libelle: 'En sur-stock',
      valeur: n('nb_sur_stock'),
      detail: 'au-dela du maximum',
      ton: 'neutre',
      Icone: TrendingDown,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
    },
    {
      champ: 'nb_ecart_majeur',
      libelle: 'Ecarts a verifier',
      valeur: n('nb_ecart_majeur'),
      detail: 'couverture confortable, magasin bas',
      ton: n('nb_ecart_majeur') > 0 ? 'alerte' : 'neutre',
      Icone: TrendingDown,
      vers: '/stock',
      actionnable: peut('STOCK', 'LIRE'),
    },
    {
      champ: 'valeur_stock_mad',
      libelle: 'Valeur du stock',
      valeur: n('valeur_stock_mad'),
      affichage: fmt.compact(n('valeur_stock_mad')),
      detail: 'MAD, au CMUP',
      ton: 'neutre',
      Icone: CircleDollarSign,
      actionnable: true,
      toujours: true,
    },
    {
      champ: 'montant_bc_ouverts_mad',
      libelle: 'Engage chez les fournisseurs',
      valeur: n('montant_bc_ouverts_mad'),
      affichage: fmt.compact(n('montant_bc_ouverts_mad')),
      detail: `MAD sur ${n('nb_bc_ouverts')} bons ouverts`,
      ton: 'neutre',
      Icone: CircleDollarSign,
      vers: '/bons-commande',
      actionnable: peut('BONS_COMMANDE', 'LIRE'),
      toujours: true,
    },
  ]

  const garder = (t: Tuile) =>
    droits.visible(t.champ) && t.actionnable !== false && (t.toujours || t.valeur > 0)

  const mesFiles = files.filter(garder)
  const mesEtats = etats.filter(garder)

  const bloquants = (qCtl.data ?? []).filter((c) => c.criticite === 'BLOQUANT' && c.anomalies > 0)
  const autres = (qCtl.data ?? []).filter((c) => c.criticite !== 'BLOQUANT' && c.anomalies > 0)

  const risques = qRisques.data ?? []
  /** Les mois de l'horizon, pris sur la premiere frise : toutes sont alignees. */
  const colonnes = useMemo(() => risques[0]?.mois?.map((m) => m.annee_mois) ?? [], [risques])

  return (
    <div>
      <EnTetePage
        titre="Poste de travail"
        description="Ce qui attend une decision, et ce qui menace le plan de production. Tout est recalcule a l'ouverture."
      />

      {qKpi.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Squelette key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {mesFiles.length > 0 && (
            <>
              <TitreBande texte="A traiter" />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
                {mesFiles.map((t) => (
                  <TuileCompteur key={t.champ} tuile={t} />
                ))}
              </div>
            </>
          )}

          {mesFiles.length === 0 && (
            <Alerte ton="succes" titre="Rien n'attend de decision">
              Aucune file en cours pour votre role. Les compteurs reapparaitront des qu'un bon, une
              reception ou une proposition demandera votre intervention.
            </Alerte>
          )}

          {mesEtats.length > 0 && (
            <>
              <TitreBande texte="Situation" />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {mesEtats.map((t) => (
                  <TuileCompteur key={t.champ} tuile={t} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {bloquants.length > 0 && (
        <div className="mt-6">
          <Alerte ton="danger" titre="Anomalies bloquantes">
            <ul className="mt-1 space-y-0.5">
              {bloquants.map((c) => (
                <li key={c.code}>
                  <span className="font-mono text-xs">{c.code}</span> — {c.controle} :{' '}
                  <strong>{c.anomalies}</strong>
                </li>
              ))}
            </ul>
          </Alerte>
        </div>
      )}

      {/* ---- Fraicheur du raisonnement -------------------------------------
          Le stock est VIVANT, les besoins sont FIGES au dernier calcul MRP.
          Sans cette ligne, un tableau tout vert peut n'etre que le reflet d'un
          calcul qu'on n'a pas relance depuis que le plan a change — et l'erreur
          va toujours dans le sens rassurant : un plan revu a la hausse laisse
          les besoins bas, donc la projection haute, donc l'alerte verte. */}
      {n('besoins_perimes') > 0 ? (
        <Alerte ton="danger" titre="Les alertes reposent sur des besoins perimes">
          Le plan de production a ete modifie apres le dernier calcul MRP
          {k.besoins_calcules_le
            ? ` du ${fmt.dateHeure(k.besoins_calcules_le as string)}`
            : ''}
          . Les couvertures affichees ci-dessous raisonnent sur un plan qui
          n existe plus. Relancez le calcul avant de decider quoi que ce soit.
        </Alerte>
      ) : k.besoins_calcules_le ? (
        <p className="text-[11px] text-attenue-texte">
          Besoins calcules le {fmt.dateHeure(k.besoins_calcules_le as string)} — le stock est lu en
          direct, les besoins datent de ce calcul.
        </p>
      ) : null}

      {/* ---- Mur de risques ------------------------------------------------ */}
      <TitreBande texte="Risque de rupture sur 12 mois" />
      <Carte>
        <CarteEntete>
          <CarteTitre>Tenue du plan de production</CarteTitre>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-attenue-texte">
            <Legende ton="bg-succes/70" texte="couvert" />
            <Legende ton="bg-alerte" texte="tendu : sous le stock de securite" />
            <Legende ton="bg-danger" texte="rupture" />
          </div>
        </CarteEntete>
        <CarteCorps className="p-0">
          {qRisques.isLoading ? (
            <div className="space-y-2 p-4">
              <Squelette className="h-6" />
              <Squelette className="h-6" />
              <Squelette className="h-6" />
            </div>
          ) : risques.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-succes">
              <CheckCircle2 className="size-4 shrink-0" />
              Aucune reference ne descend sous son stock de securite sur l'horizon du plan, commandes
              en cours comprises.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                    <th className="px-3 py-2 text-left">Reference</th>
                    <th className="w-28 px-2 py-2 text-left">Sourcing</th>
                    <th className="w-20 px-2 py-2 text-right">Delai</th>
                    {colonnes.map((m) => (
                      <th key={m} className="w-9 px-0.5 py-2 text-center font-normal">
                        {m.slice(5)}
                        <div className="text-[9px] opacity-60">{m.slice(2, 4)}</div>
                      </th>
                    ))}
                    <th className="w-32 px-2 py-2 text-left">Equivalent</th>
                    <th className="w-28 px-2 py-2 text-right">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {risques.map((r) => (
                    <tr key={r.code_reference} className="border-b border-bordure/60">
                      <td className="max-w-56 px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{r.code_reference}</span>
                          {r.classe_abc && (
                            <Badge ton={r.classe_abc === 'A' ? 'danger' : 'neutre'}>
                              {r.classe_abc}
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {r.fournisseur_nom ?? 'sans fournisseur'}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {r.risque_sourcing === 'MONO-SOURCE' ? (
                          <Badge ton="danger">mono</Badge>
                        ) : (
                          <span className="text-[11px] text-attenue-texte">multi</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-attenue-texte">
                        {r.delai_livraison_jours == null ? '—' : `${r.delai_livraison_jours} j`}
                      </td>
                      {r.mois.map((m) => (
                        <td key={m.annee_mois} className="px-0.5 py-1.5">
                          <Infobulle
                            contenu={`${m.annee_mois} · besoin ${fmt.nombre(m.besoin_kg, 0)} kg · entrees ${fmt.nombre(m.entrees_kg, 0)} kg · fin de mois ${fmt.nombre(m.stock_fin_kg, 0)} kg (mini ${fmt.nombre(m.stock_min_kg, 0)})`}
                          >
                            <div
                              className={cn(
                                'mx-auto h-6 w-full rounded-[3px]',
                                m.statut === 'RUPTURE'
                                  ? 'bg-danger'
                                  : m.statut === 'TENDU'
                                    ? 'bg-alerte'
                                    : 'bg-succes/70',
                              )}
                            />
                          </Infobulle>
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        {(r.equivalent_dispo_kg ?? 0) > 0 ? (
                          <div>
                            <Badge ton="info">{fmt.compact(r.equivalent_dispo_kg)} kg</Badge>
                            <div className="truncate text-[10px] text-attenue-texte">
                              {r.equivalent_reference}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-attenue-texte">aucun</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <MargeDecision jours={r.marge_decision_jours} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
                La marge est le nombre de jours restants avant le premier mois tendu,{' '}
                <strong>delai fournisseur deduit</strong>. Negative, il est deja trop tard pour
                commander a temps : il reste a arbitrer, substituer ou decaler la production.{' '}
                Une ligne avec un <strong>equivalent en stock</strong> se resout par un arbitrage
                depuis le plan d'achat, sans attendre de livraison.
              </p>
            </div>
          )}
        </CarteCorps>
      </Carte>

      {/* ---- Controles de coherence ---------------------------------------- */}
      <TitreBande texte="Sante du referentiel" />
      <Carte>
        <CarteEntete>
          <CarteTitre>Controles metier</CarteTitre>
          <Badge ton={autres.length ? 'alerte' : 'succes'}>
            {autres.length ? `${autres.length} a traiter` : 'tout est vert'}
          </Badge>
        </CarteEntete>
        <CarteCorps className="p-0">
          {qCtl.isLoading ? (
            <div className="space-y-2 p-4">
              <Squelette className="h-6" />
              <Squelette className="h-6" />
            </div>
          ) : autres.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-succes">
              <CheckCircle2 className="size-4" />
              Aucune anomalie detectee.
            </div>
          ) : (
            <ul className="divide-y divide-bordure">
              {autres.map((c) => (
                <li
                  key={c.code}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertTriangle
                      className={cn(
                        'size-3.5 shrink-0',
                        c.criticite === 'CRITIQUE' ? 'text-danger' : 'text-alerte',
                      )}
                    />
                    <Infobulle contenu={`Controle ${c.code}`}>
                      <span className="truncate">{c.controle}</span>
                    </Infobulle>
                  </div>
                  <Badge ton={c.criticite === 'CRITIQUE' ? 'danger' : 'alerte'}>{c.anomalies}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CarteCorps>
      </Carte>
    </div>
  )
}

function TitreBande({ texte }: { texte: string }) {
  return (
    <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-attenue-texte first:mt-0">
      {texte}
    </h2>
  )
}

function Legende({ ton, texte }: { ton: string; texte: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('size-2.5 rounded-[2px]', ton)} />
      {texte}
    </span>
  )
}

function TuileCompteur({ tuile: t }: { tuile: Tuile }) {
  const contenu = (
    <Carte
      className={cn('h-full transition-colors', t.vers && 'hover:border-primaire/50 hover:bg-attenue/30')}
    >
      <CarteCorps className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs text-attenue-texte">{t.libelle}</span>
          <t.Icone className={cn('size-4 shrink-0', TEINTE[t.ton])} />
        </div>
        <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', TEINTE[t.ton])}>
          {t.affichage ?? t.valeur}
        </div>
        {t.detail && (
          <div className="mt-0.5 truncate text-[11px] text-attenue-texte">{t.detail}</div>
        )}
        {t.vers && (
          <div className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-primaire">
            ouvrir
            <ArrowRight className="size-3" />
          </div>
        )}
      </CarteCorps>
    </Carte>
  )
  return t.vers ? (
    <Link to={t.vers} className="block">
      {contenu}
    </Link>
  ) : (
    <div>{contenu}</div>
  )
}

/**
 * Jours restants pour commander a temps.
 *
 * Negatif, ce n'est plus une alerte mais un constat : le delai fournisseur
 * depasse ce qui reste avant le manque. Le dire franchement vaut mieux que de
 * l'afficher en orange comme si commander suffisait encore.
 */
function MargeDecision({ jours }: { jours: number | null }) {
  if (jours == null) return <span className="text-attenue-texte">—</span>
  if (jours < 0) {
    return (
      <div>
        <div className="font-semibold tabular-nums text-danger">{jours} j</div>
        <div className="text-[10px] text-danger">trop tard</div>
      </div>
    )
  }
  return (
    <div>
      <div
        className={cn('font-semibold tabular-nums', jours <= 15 ? 'text-alerte' : 'text-texte')}
      >
        +{jours} j
      </div>
      <div className="text-[10px] text-attenue-texte">pour commander</div>
    </div>
  )
}

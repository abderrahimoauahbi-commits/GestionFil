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
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link, useNavigate } from 'react-router-dom'
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
import { CockpitAnalyse } from './CockpitAnalyse'
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
import { BarresEmpilees, BarresRangees } from '../composants/graphiques/Graphiques'
import { Layers, Package, ShoppingCart } from 'lucide-react'
import { BarreRepartition, CarteStat } from '../composants/CarteStat'
import { Pareto } from '../composants/graphiques/Pareto'
import { BullesFournisseurs, type Fournisseur } from '../composants/graphiques/BullesFournisseurs'

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

      <ChiffresCles />

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

      {/* ---- Les six zones du classeur -------------------------------------
          Dans l'ordre du cockpit Excel : les graphiques d'abord, parce qu'ils
          donnent la forme du probleme, puis les tableaux qui la detaillent. */}
      <TitreBande texte="Analyse" />
      <CockpitAnalyse />

      {/* ---- Tableau de bord ----------------------------------------------- */}
      <TitreBande texte="Concentration et dependances" />
      <Concentration />

      <TitreBande texte="Ou part la matiere" />
      <TableauDeBord />

      {/* ---- Mur de risques ------------------------------------------------ */}
      {/* L'horizon vient du plan, jamais d'une constante : un plan de six mois
          affiche six colonnes, et annoncer « 12 mois » au-dessus serait faux. */}
      <TitreBande
        texte={
          colonnes.length
            ? `Risque de rupture sur ${colonnes.length} mois`
            : 'Risque de rupture'
        }
      />
      <Carte repliable="cockpit.1">
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
      <Carte repliable="cockpit.2">
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

/* -------------------------------------------------------------------------- */
/* Tableau de bord                                                             */
/* -------------------------------------------------------------------------- */

interface StatQualite {
  code_qualite: string
  qualite_nom: string
  statut: string
  cout_matiere_m2_mad: number | null
  kg_m2_total: number | null
  taux_realisation_pct: number | null
}

interface StatRole {
  code_qualite: string
  code_role: string
  role_libelle: string
  cout_m2_mad: number | null
}

/**
 * Deux graphiques, et deux seulement.
 *
 * Le premier classe les qualites par cout matiere : c'est la question que pose
 * un directeur devant une gamme de dix-huit produits. Le second decompose ce
 * cout entre les trois roles qui pesent le plus — poil, trame, chaine — parce
 * que savoir *qu'une* qualite coute cher ne dit pas *ou* passe l'argent.
 *
 * Pas de troisieme graphique tant qu'aucune sortie de production n'est saisie :
 * un camembert de consommation sur zero mouvement ne montrerait que du vide.
 */
function TableauDeBord() {
  const { peut } = useAuth()
  const q = useQuery({
    queryKey: ['stats', 'qualites'],
    queryFn: () =>
      api.get<{ qualites: StatQualite[]; roles: StatRole[] }>('/api/stats/qualites'),
    enabled: peut('QUALITES', 'LIRE'),
    staleTime: 5 * 60_000,
  })

  const qualites = q.data?.qualites ?? []
  const roles = q.data?.roles ?? []

  const couts = useMemo(
    () =>
      qualites
        .filter((x) => (x.cout_matiere_m2_mad ?? 0) > 0)
        .map((x) => ({
          cle: x.code_qualite,
          libelle: x.qualite_nom || x.code_qualite,
          valeur: x.cout_matiere_m2_mad as number,
        })),
    [qualites],
  )

  /* Les trois roles les plus lourds, tous produits confondus : ce sont eux qui
     serviront de series. Les choisir globalement, et non qualite par qualite,
     garde la meme couleur pour le meme role d'une barre a l'autre. */
  const composition = useMemo(() => {
    const poids = new Map<string, { libelle: string; total: number }>()
    for (const r of roles) {
      const v = r.cout_m2_mad ?? 0
      const e = poids.get(r.code_role) ?? { libelle: r.role_libelle || r.code_role, total: 0 }
      e.total += v
      poids.set(r.code_role, e)
    }
    const majeurs = [...poids.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3)
      .map(([cle, v]) => ({ cle, libelle: v.libelle }))

    const parQualite = new Map<string, Record<string, number>>()
    for (const r of roles) {
      if (!majeurs.some((m) => m.cle === r.code_role)) continue
      const parts = parQualite.get(r.code_qualite) ?? {}
      parts[r.code_role] = (parts[r.code_role] ?? 0) + (r.cout_m2_mad ?? 0)
      parQualite.set(r.code_qualite, parts)
    }

    const donnees = [...parQualite.entries()]
      .map(([code, parts]) => ({
        cle: code,
        libelle: qualites.find((x) => x.code_qualite === code)?.qualite_nom || code,
        parts,
      }))
      .filter((d) => Object.values(d.parts).some((v) => v > 0))

    return { series: majeurs, donnees }
  }, [roles, qualites])

  if (q.isLoading) return <Squelette className="h-56 w-full" />
  if (!couts.length) {
    return (
      <Alerte ton="info" titre="Pas encore de cout matiere">
        Le cout par metre carre se calcule a partir du CMUP des composants. Il apparaitra des la
        premiere reception valorisee sur chaque reference de recette.
      </Alerte>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <BarresRangees
        titre="Cout matiere par qualite"
        sousTitre="CMUP des composants, rapporte au metre carre"
        unite="MAD/m2"
        donnees={couts}
      />
      {composition.donnees.length > 0 && (
        <BarresEmpilees
          titre="Ou passe le cout"
          sousTitre="Les trois roles les plus lourds de la gamme"
          unite="MAD/m2"
          series={composition.series}
          donnees={composition.donnees}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Concentration de la valeur et dependance fournisseur                        */
/* -------------------------------------------------------------------------- */

interface LigneProjetee {
  code_reference: string
  designation: string | null
  valeur_totale_mad: number | null
  classe_abc: string | null
  statut: string | null
  jours_couverture: number | null
  stock_projete_kg: number | null
  fournisseur_nom: string | null
}

/**
 * Deux questions de direction, cote a cote : sur quelles references l'argent
 * est-il immobilise, et de qui depend-on pour le racheter.
 */
function Concentration() {
  const { peut } = useAuth()
  const client = useQueryClient()
  const [calcul, setCalcul] = useState(false)

  const qStock = useQuery({
    queryKey: ['stock-projete-cockpit'],
    queryFn: () => api.get<LigneProjetee[]>('/api/stock/projete?limite=2000'),
    enabled: peut('STOCK', 'LIRE'),
    staleTime: 60_000,
  })
  const qFour = useQuery({
    queryKey: ['fournisseurs-scorecard'],
    queryFn: () => api.get<Fournisseur[]>('/api/fournisseurs/scorecard'),
    enabled: peut('FOURNISSEURS', 'LIRE'),
    staleTime: 5 * 60_000,
  })

  const lignes = qStock.data ?? []
  const classeCalculee = lignes.some((l) => l.classe_abc)

  const lancerClassification = async () => {
    setCalcul(true)
    try {
      await api.post('/api/classification', {})
      await client.invalidateQueries()
      toast.success('Classification ABC / XYZ calculee')
    } catch (e) {
      toast.error('Classification refusee', { description: String(e) })
    } finally {
      setCalcul(false)
    }
  }

  if (qStock.isLoading) return <Squelette className="h-64 w-full" />

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Pareto
        titre="Concentration de la valeur"
        sousTitre="Part cumulee du stock valorise, references triees par valeur"
        unite="MAD"
        donnees={lignes.map((l) => ({
          cle: l.code_reference,
          libelle: l.code_reference,
          valeur: l.valeur_totale_mad ?? 0,
        }))}
        action={
          classeCalculee ? undefined : (
            <div className="border-t border-ligne pt-2 text-[11px] text-attenue-texte">
              Les classes A, B et C ne sont pas encore attribuees : la courbe montre la
              concentration reelle, mais aucune reference ne porte sa classe.
              {peut('CATALOGUE', 'ECRIRE') && (
                <button
                  type="button"
                  onClick={() => void lancerClassification()}
                  disabled={calcul}
                  className="ml-2 rounded-[3px] border border-bordure px-2 py-0.5 text-[11px]
                             text-texte hover:bg-attenue disabled:opacity-50"
                >
                  {calcul ? 'Calcul en cours...' : 'Calculer la classification'}
                </button>
              )}
            </div>
          )
        }
      />
      {qFour.data && <BullesFournisseurs donnees={qFour.data} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Chiffres cles                                                               */
/* -------------------------------------------------------------------------- */

/**
 * La premiere rangee du poste de travail : cinq chiffres, lisibles de loin.
 *
 * Chacun porte une seconde ligne factuelle plutot qu'une variation. Le systeme
 * ne garde pas d'historique de ces indicateurs : afficher « +8 % » sous un
 * chiffre qu'on ne sait pas comparer a hier serait une invention, et un tableau
 * de bord qui invente une fois n'est plus cru sur le reste.
 */
function ChiffresCles() {
  const { peut } = useAuth()
  const naviguer = useNavigate()

  const q = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<Record<string, number | string | null>>('/api/cockpit'),
    enabled: peut('COCKPIT', 'LIRE'),
  })

  const k = q.data
  if (q.isLoading) {
    return (
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Squelette key={i} className="h-[68px]" />
        ))}
      </div>
    )
  }
  if (!k) return null

  const n = (c: string) => Number(k[c] ?? 0)
  const ok = n('nb_ok')
  const attention = n('nb_attention')
  const critiques = n('nb_critiques')
  const bloquants = n('nb_controles_bloquants') + n('nb_controles_critiques')

  return (
    <div className="mb-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <CarteStat
          Icone={Package}
          libelle="References suivies"
          valeur={fmt.nombre(n('nb_references'), 0)}
          precision={`${ok} au vert · ${attention} en attention`}
          ton="primaire"
          surClic={() => naviguer('/stock')}
        />
        <CarteStat
          Icone={TrendingDown}
          libelle="Sous le minimum"
          valeur={fmt.nombre(n('nb_refs_sous_minimum'), 0)}
          precision="Stock magasin sous le seuil calcule"
          ton={n('nb_refs_sous_minimum') > 0 ? 'danger' : 'succes'}
          surClic={() => naviguer('/stock')}
          aide="Veto physique : le magasin est court, quelle que soit la couverture."
        />
        <CarteStat
          Icone={Layers}
          libelle="Sur-stock"
          valeur={fmt.nombre(n('nb_sur_stock'), 0)}
          precision="Au-dela du stock maximum"
          ton={n('nb_sur_stock') > 0 ? 'alerte' : 'succes'}
          surClic={() => naviguer('/stock')}
          aide="Sujet de tresorerie, jamais de rupture : les deux axes sont distincts."
        />
        <CarteStat
          Icone={ShoppingCart}
          libelle="Budget a engager"
          valeur={fmt.nombre(Math.round(n('budget_a_engager_mad')), 0)}
          unite="MAD"
          precision={`${n('nb_propositions_a_traiter')} proposition(s) a traiter`}
          ton="primaire"
          surClic={() => naviguer('/plan-achat')}
        />
        <CarteStat
          Icone={AlertTriangle}
          libelle="Controles en anomalie"
          valeur={fmt.nombre(n('nb_alertes_ouvertes'), 0)}
          precision={bloquants > 0 ? `${bloquants} bloquant(s) ou critique(s)` : 'Aucun bloquant'}
          ton={bloquants > 0 ? 'danger' : n('nb_alertes_ouvertes') > 0 ? 'alerte' : 'succes'}
          aide="Coherence des donnees, verifiee en permanence."
        />
      </div>

      {ok + attention + critiques > 0 && (
        <div className="rounded-[var(--radius)] border border-bordure bg-surface p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-attenue-texte">
            Etat du catalogue suivi
          </p>
          <BarreRepartition
            parts={[
              { libelle: 'Au vert', valeur: ok, ton: 'succes' },
              { libelle: 'En attention', valeur: attention, ton: 'alerte' },
              { libelle: 'Critique ou rupture', valeur: critiques, ton: 'danger' },
            ]}
          />
        </div>
      )}
    </div>
  )
}

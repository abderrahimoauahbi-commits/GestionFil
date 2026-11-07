/**
 * Configuration — tous les reglages de l'ERP en un seul endroit.
 *
 * La disposition suit celle des ecrans de configuration d'Odoo, parce qu'elle
 * resout un probleme reel : une liste plate de trente parametres oblige a
 * connaitre le nom de celui qu'on cherche. Ici,
 *
 *   * un RAIL DE SECTIONS a gauche donne le sujet — alertes, production,
 *     entreprise, chaine logistique, receptions, referentiels, devises ;
 *   * chaque reglage est une LIGNE : son intitule, ce qu'il change en une
 *     phrase, et sa valeur a droite. La phrase compte autant que la valeur —
 *     « 90 jours » ne dit rien, « en dessous, le stock passe en ATTENTION » dit
 *     tout ;
 *   * une BARRE D'ENREGISTREMENT n'apparait qu'en cas de modification, et porte
 *     l'ensemble. On regle plusieurs seuils d'un coup, on relit, on enregistre.
 *
 * Un parametre qu'aucune section ne reclame n'est pas perdu : il tombe dans
 * « Autres reglages » de sa categorie. Le faire disparaitre serait reproduire,
 * a l'affichage, le defaut que la grille de droits nous a deja coute.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Building2,
  Coins,
  Factory,
  Layers,
  Lock,
  PackageCheck,
  RotateCcw,
  Save,
  ScrollText,
  ShieldCheck,
  TrendingUp,
  DatabaseBackup,
  Palette,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useParamVue } from '../lib/navigation'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral } from '../composants/RailLateral'
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
} from '../composants/ui/base'
import { Aide, Infobulle } from '../composants/ui/surcouches'
import { IndiceChamp } from '../composants/ui/Indice'
import { cn, fmt } from '../lib/utils'
import { Audit } from './Audit'
import { ReglageApparence } from '../composants/ReglageApparence'
import { Referentiels } from './Referentiels'
import { Utilisateurs } from './Utilisateurs'
import { ListeRoles } from './Roles'

const MODULE = 'PARAMETRES'

interface Parametre extends Record<string, unknown> {
  code_parametre: string
  libelle: string
  valeur_courante: string
  type_donnee: string
  unite: string | null
  description: string | null
  categorie: string | null
  modifiable_par: string | null
  verrouille: number
  date_derniere_modif: string
  /** La version lue (verrou optimiste, groupe 3, 20/10/2026). */
  version: number
}

interface Devise extends Record<string, unknown> {
  code_devise: string
  libelle: string
  symbole: string | null
  est_pivot: number
}

interface Taux extends Record<string, unknown> {
  code_devise: string
  taux: number
  date_debut: string
  date_fin: string | null
}

type CleSection =
  | 'alertes'
  | 'production'
  | 'entreprise'
  | 'supply'
  | 'reception'
  | 'referentiels'
  | 'devises'
  | 'utilisateurs'
  | 'comptes'
  | 'audit'
  | 'sauvegardes'
  | 'apparence'

/**
 * Les quatre familles du rail, dans l'ordre ou on les parcourt en installant
 * l'application : d'abord qui est l'entreprise, puis comment elle gere ses
 * stocks, puis ce que la machine doit savoir, puis qui a le droit d'y toucher.
 */
const FAMILLES = [
  'Entreprise',
  'Paramètres de gestion',
  'Paramètres système',
  'Paramètres utilisateurs',
] as const
type Famille = (typeof FAMILLES)[number]

interface Section {
  cle: CleSection
  famille: Famille
  libelle: string
  resume: string
  Icone: React.ComponentType<{ className?: string }>
  /** Blocs de reglages : un titre, une intention, et les codes concernes. */
  blocs?: { titre: string; intention: string; codes: string[] }[]
}

/**
 * Le plan de l'ecran.
 *
 * L'ordre des codes dans un bloc est celui de la lecture, pas celui de la base :
 * on pose le seuil d'alerte avant le seuil critique parce que c'est l'ordre dans
 * lequel une reference les franchit.
 */
const SECTIONS: Section[] = [
  {
    cle: 'alertes',
    famille: 'Paramètres de gestion',
    libelle: 'Alertes et seuils',
    resume: 'Quand une référence passe en attention, en critique, en rupture',
    Icone: AlertTriangle,
    blocs: [
      {
        titre: 'Seuils de couverture',
        intention:
          "Le statut d'une référence se lit en JOURS DE COUVERTURE, pas en kilos : " +
          '500 kg sont confortables sur une matière lente et déjà courts sur le fil de chaine.',
        codes: ['P_SeuilAlerte', 'P_SeuilCritique', 'P_SeuilImminent', 'P_CouvMinMois', 'P_MargeSecurite'],
      },
      {
        titre: 'Réapprovisionnement',
        intention:
          "Ce que le plan d'achat suppose quand le fournisseur ne dit rien, et la marge " +
          'gardee avant la date de besoin.',
        codes: ['P_DelaiDefaut', 'P_MargeJours'],
      },
      {
        titre: 'Stock projeté',
        intention:
          "Ce que le stock projeté compte, et que le plan d'achat suit : restes, rattrapage, " +
          'fil sur machine, quarantaine, bons en retard ou sans date, minimum et multiple, ' +
          "seuil d'alerte. Chaque réglage démarre sur le comportement d'avant (31/10/2026).",
        codes: [
          'P_ProjeteRestes',
          'P_ProjeteRattrapage',
          'P_ProjeteAgeConstatMax',
          'P_ProjeteQuarantaine',
          'P_ProjeteRetardJours',
          'P_ProjeteSansDate',
          'P_ProjeteMinMultiple',
          'P_ProjeteMinimumAlerte',
        ],
      },
    ],
  },
  {
    cle: 'production',
    famille: 'Paramètres de gestion',
    libelle: 'Production',
    resume: 'Perte matière, stocks de sécurité, tolérance des recettes',
    Icone: Factory,
    blocs: [
      {
        titre: 'Pertes et tolérances',
        intention:
          'Le taux de perte majore chaque besoin calcule par le MRP. La tolerance de recette ' +
          "dit de combien la somme des pourcentages d'un rôle peut s'ecarter de 100 %.",
        codes: ['P_TauxPerte', 'P_ToleranceRecette'],
      },
      {
        titre: 'Stock de sécurité par classe',
        intention:
          'Le matelas garde en plus du besoin calcule, exprime en jours de consommation. ' +
          'Une classe A merite en general davantage de couverture qu une classe C.',
        codes: ['P_SecuriteA', 'P_SecuriteB', 'P_SecuriteC'],
      },
      {
        titre: 'Photo de stock initiale',
        intention:
          "Date de la reprise : avant elle, les quantités viennent de l'inventaire d'ouverture " +
          'et non des mouvements.',
        codes: ['P_DateSaisie'],
      },
    ],
  },
  {
    cle: 'entreprise',
    famille: 'Entreprise',
    libelle: 'Entreprise',
    resume: 'Identité, pays, devise de reporting',
    Icone: Building2,
    blocs: [
      {
        titre: 'Identité',
        intention:
          "Ces valeurs n'entrent dans aucun calcul : elles figurent sur les états d'impression " +
          'et les bons adresses aux fournisseurs.',
        codes: ['P_NomEntreprise', 'P_Secteur', 'P_Pays', 'P_DateCreationERP'],
      },
      {
        titre: 'Monnaie de référence',
        intention:
          'Toute valorisation est ramenee a cette devise. Elle est verrouillee : la changer ' +
          'apres coup rendrait faux tout le stock déjà valorise.',
        codes: ['P_Devise'],
      },
    ],
  },
  {
    cle: 'supply',
    famille: 'Paramètres de gestion',
    libelle: 'Chaîne logistique',
    resume: 'Classement ABC/XYZ, tiering des commandes, notation fournisseurs',
    Icone: TrendingUp,
    blocs: [
      {
        titre: 'Classement des références',
        intention:
          'ABC repartit les références par poids financier, XYZ par regularite de consommation. ' +
          'Les deux servent a doser le stock de sécurité et la vigilance.',
        codes: ['P_SeuilABCA', 'P_SeuilABCB', 'P_SeuilXYZ_X', 'P_SeuilXYZ_Y'],
      },
      {
        titre: 'Montants et urgence des commandes',
        intention:
          "Le tiering classe l'urgence d'un achat par son montant. Le seuil de validation dit " +
          'à partir de quand la Direction doit signer.',
        codes: [
          'P_SeuilTier1',
          'P_SeuilTier2',
          'P_SeuilTier3',
          'P_SeuilValidationBC',
          'P_SeuilBCGroupe',
        ],
      },
      {
        titre: 'Notation des fournisseurs',
        intention:
          'Bornes de la note globale qui range un fournisseur en strategique, standard ou ' +
          'a surveiller.',
        codes: ['P_ScoreStrategique', 'P_ScoreStandard', 'P_ScoreSurveiller'],
      },
      {
        titre: 'Immobilisation et trésorerie',
        intention:
          'Au-dela du seuil de dormance, un stock qui ne bouge plus est signale. Le délai de ' +
          'paiement sert au previsionnel quand le fournisseur n en declare aucun.',
        codes: ['P_SeuilDormant', 'P_DSODefaut', 'P_DateRefKPI'],
      },
    ],
  },
  {
    cle: 'reception',
    famille: 'Paramètres de gestion',
    libelle: 'Réceptions et OTIF',
    resume: 'Tolérance de pesée, cible de performance fournisseur',
    Icone: PackageCheck,
    blocs: [
      {
        titre: 'Tolérances au quai',
        intention:
          'Au-dela de la tolerance de pesee, la ligne exige une derogation nominative. ' +
          'La tolerance In-Full dit à partir de quel manque une livraison cesse d etre complete.',
        codes: ['P_TolerEcartPesee', 'P_TolerInFull'],
      },
      {
        titre: 'Performance attendue',
        intention:
          "L'OTIF est le PRODUIT de trois conditions — a l'heure, complet, conforme — et non " +
          'leur moyenne. Une livraison ponctuelle mais incomplete ne vaut rien pour l atelier.',
        codes: ['P_CibleOTIF'],
      },
    ],
  },
  {
    cle: 'referentiels',
    famille: 'Paramètres système',
    libelle: 'Mouvement stock',
    resume: 'Magasins, types et motifs de mouvement, motifs de retour',
    Icone: Layers,
  },
  {
    cle: 'devises',
    famille: 'Paramètres système',
    libelle: 'Devises et taux',
    resume: 'Cours de change en vigueur et leur historique',
    Icone: Coins,
  },
  {
    cle: 'apparence',
    famille: 'Entreprise',
    libelle: 'Apparence',
    resume: 'Couleurs, densité des tableaux, barre de navigation',
    Icone: Palette,
  },
  {
    cle: 'sauvegardes',
    famille: 'Paramètres système',
    libelle: 'Sauvegardes',
    resume: 'Copies de la base, manuelles et automatiques',
    Icone: DatabaseBackup,
  },
  {
    cle: 'comptes',
    famille: 'Paramètres utilisateurs',
    libelle: 'Utilisateurs et droits',
    resume: 'Comptes, rôles, et la grille module x champ',
    Icone: Users,
  },
  {
    cle: 'utilisateurs',
    famille: 'Paramètres utilisateurs',
    libelle: 'Rôles et permissions',
    resume: "Rôles, leurs permissions et leurs champs ; transitions d'état",
    Icone: ShieldCheck,
  },
  {
    cle: 'audit',
    famille: 'Paramètres utilisateurs',
    libelle: "Journal d'audit",
    resume: 'Qui a fait quoi, quand, et depuis quelle adresse',
    Icone: ScrollText,
  },
]

/** Les codes explicitement places : tout le reste ira dans « Autres reglages ». */
const CODES_PLACES = new Set(SECTIONS.flatMap((s) => s.blocs?.flatMap((b) => b.codes) ?? []))

/** A quelle section rattacher un parametre qu'aucun bloc ne nomme. */
const SECTION_PAR_CATEGORIE: Record<string, CleSection> = {
  STOCK: 'alertes',
  PROD: 'production',
  ENTREPRISE: 'entreprise',
  ACHAT: 'supply',
  ANALYSE: 'supply',
  RECEPT: 'reception',
  SYSTEME: 'entreprise',
}

export function Configuration() {
  const droits = useDroits(MODULE)
  const qc = useQueryClient()

  // `?section=` amorce le rail : le menu nomme « Entreprise » et « Devises »
  // comme des entrees a part entiere, et cliquer dessus doit ouvrir LA section,
  // pas la page a sa premiere rubrique a charge de la retrouver.
  const demandee = useParamVue('section')
  const [section, setSection] = useState<CleSection>(
    SECTIONS.some((x) => x.cle === demandee) ? (demandee as CleSection) : 'alertes',
  )
  useEffect(() => {
    if (SECTIONS.some((x) => x.cle === demandee)) setSection(demandee as CleSection)
  }, [demandee])
  const [brouillon, setBrouillon] = useState<Record<string, string>>({})
  const [recherche, setRecherche] = useState('')

  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: ({ signal }) => api.get<Parametre[]>('/api/parametres', { signal }),
  })

  const parametres = q.data ?? []
  const parCode = useMemo(() => {
    const m = new Map<string, Parametre>()
    for (const p of parametres) m.set(p.code_parametre, p)
    return m
  }, [parametres])

  /** Ce qu'aucun bloc ne nomme, range par section d'apres sa categorie. */
  const orphelins = useMemo(() => {
    const m: Record<string, Parametre[]> = {}
    for (const p of parametres) {
      if (CODES_PLACES.has(p.code_parametre)) continue
      const s = SECTION_PAR_CATEGORIE[p.categorie ?? ''] ?? 'supply'
      ;(m[s] ??= []).push(p)
    }
    return m
  }, [parametres])

  // LA VERSION EST CELLE DU DEBUT DE LA SAISIE (groupe 3, 20/10/2026) : figee a
  // la premiere frappe, elle ne suit pas une relecture de la liste. Si quelqu'un
  // regle le meme parametre entre-temps, l'enregistrement est refuse en le nommant.
  const [versions, setVersions] = useState<Record<string, number>>({})
  const saisir = (code: string, v: string) => {
    setBrouillon((b) => ({ ...b, [code]: v }))
    setVersions((x) => (code in x ? x : { ...x, [code]: parCode.get(code)?.version ?? 1 }))
  }

  const modifies = Object.entries(brouillon).filter(
    ([code, v]) => parCode.get(code)?.valeur_courante !== v,
  )

  const enregistrer = useMutation({
    mutationFn: async () => {
      for (const [code, valeur] of modifies) {
        await api.patch(`/api/parametres/${code}`, {
          valeur_courante: valeur,
          motif: 'Modification depuis l ecran de configuration',
          version: versions[code] ?? parCode.get(code)?.version,
        })
      }
      return modifies.length
    },
    onSuccess: (n) => {
      toast.success(`${n} parametre(s) enregistre(s)`, {
        description:
          'Chaque changement est historise avec son auteur. Rappel : ces valeurs servent de ' +
          'defaut a la création et ne modifient rien de déjà enregistre.',
        duration: 8000,
      })
      setBrouillon({})
      setVersions({})
      void qc.invalidateQueries({ queryKey: ['parametres'] })
    },
    onError: (e) =>
      toast.error(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  /** Recherche transversale : elle bascule sur la section qui contient le resultat. */
  const resultats = useMemo(() => {
    const f = recherche.trim().toLowerCase()
    if (!f) return []
    return parametres.filter(
      (p) =>
        p.libelle.toLowerCase().includes(f) ||
        p.code_parametre.toLowerCase().includes(f) ||
        (p.description ?? '').toLowerCase().includes(f),
    )
  }, [parametres, recherche])

  const courante = SECTIONS.find((s) => s.cle === section)!

  return (
    <div>
      <EnTetePage
        titre="Configuration"
        description="Les réglages qui gouvernent les calculs, et les référentiels sur lesquels ils s’appuient."
      />

      <PageAvecRail droite
        large
        rail={
          <RailLateral vertical
            groupes={FAMILLES.map((famille) => ({
              titre: famille,
              entrees: SECTIONS.filter((s) => s.famille === famille).map((s) => ({
                  cle: s.cle,
                  libelle: s.libelle,
                  resume: s.resume,
                  Icone: s.Icone,
                  // Le nombre de reglages derriere chaque section. Les deux
                  // sections qui ouvrent un autre ecran n'en ont pas.
                  compte:
                    s.blocs == null
                      ? null
                      : s.blocs.reduce((n, b) => n + b.codes.length, 0) +
                        (orphelins[s.cle]?.length ?? 0),
              })),
            }))}
            actif={recherche ? '' : section}
            surChoix={(c) => {
              setSection(c as CleSection)
              setRecherche('')
            }}
            recherche={{
              valeur: recherche,
              surChangement: setRecherche,
              placeholder: 'Chercher un réglage…',
            }}
          />
        }
      >
        <div className="space-y-3">
          {q.isLoading && <Chargement texte="Lecture des paramètres…" />}

          {recherche ? (
            <Carte repliable="configuration.1">
              <CarteEntete>
                <CarteTitre>
                  {resultats.length} reglage(s) pour « {recherche} »
                </CarteTitre>
              </CarteEntete>
              <CarteCorps className="divide-y divide-bordure p-0">
                {resultats.map((p) => (
                  <LigneReglage
                    key={p.code_parametre}
                    p={p}
                    valeur={brouillon[p.code_parametre] ?? p.valeur_courante}
                    modifiable={droits.peutEcrire && p.verrouille === 0}
                    surChangement={(v) =>
                      saisir(p.code_parametre, v)
                    }
                  />
                ))}
                {resultats.length === 0 && (
                  <p className="p-4 text-[13px] text-attenue-texte">
                    Aucun réglage ne correspond.
                  </p>
                )}
              </CarteCorps>
            </Carte>
          ) : section === 'referentiels' ? (
            /* Categories matiere, roles BOM et groupes d'equivalence sont
               retires d'ici : ce sont des referentiels de PRODUIT, pas de
               mouvement. Ils restent entiers sur `/referentiels`, ou le
               rattachement d'une reference a ses equivalents se fait. */
            <Referentiels
              cles={['magasins', 'types-mouvement', 'motifs-mouvement', 'motifs-ligne', 'types-frais', 'positions-tarifaires']}
            />
          ) : section === 'comptes' ? (
            /* Les ecrans complets, montes tels quels. Ils gardent leur propre
               entete : le rail de gauche dit ou l'on est, l'entete dit ce que
               l'ecran fait. Les recopier en version reduite ici ferait deux
               grilles de droits a maintenir pour une seule regle. */
            <Utilisateurs />
          ) : section === 'audit' ? (
            <Audit />
          ) : section === 'utilisateurs' ? (
            /* Les roles se reglent sur leur propre ecran (13/10/2026) ; les
               transitions d'etat restent un referentiel. */
            <div className="space-y-4">
              <ListeRoles />
              <Referentiels cles={['transitions']} />
            </div>
          ) : section === 'apparence' ? (
            <ReglageApparence />
          ) : section === 'sauvegardes' ? (
            <SectionSauvegardes modifiable={droits.peutEcrire} />
          ) : section === 'devises' ? (
            <SectionDevises modifiable={droits.peutEcrire} />
          ) : (
            <>
              {courante.blocs?.map((b) => {
                const lignes = b.codes.map((c) => parCode.get(c)).filter(Boolean) as Parametre[]
                if (lignes.length === 0) return null
                return (
                  <Carte key={b.titre}>
                    <CarteEntete className="flex-col items-start gap-1">
                      <CarteTitre>{b.titre}</CarteTitre>
                      <p className="text-[11px] leading-relaxed text-attenue-texte">
                        {b.intention}
                      </p>
                    </CarteEntete>
                    <CarteCorps className="divide-y divide-bordure p-0">
                      {lignes.map((p) => (
                        <LigneReglage
                          key={p.code_parametre}
                          p={p}
                          valeur={brouillon[p.code_parametre] ?? p.valeur_courante}
                          modifiable={droits.peutEcrire && p.verrouille === 0}
                          surChangement={(v) =>
                            saisir(p.code_parametre, v)
                          }
                        />
                      ))}
                    </CarteCorps>
                  </Carte>
                )
              })}

              {(orphelins[section] ?? []).length > 0 && (
                <Carte repliable="configuration.2">
                  <CarteEntete className="flex-col items-start gap-1">
                    <CarteTitre>Autres réglages</CarteTitre>
                    <p className="text-[11px] text-attenue-texte">
                      Parametres de cette categorie qu aucun bloc ne nomme explicitement. Ils
                      apparaissent ici pour ne jamais disparaitre en silence.
                    </p>
                  </CarteEntete>
                  <CarteCorps className="divide-y divide-bordure p-0">
                    {(orphelins[section] ?? []).map((p) => (
                      <LigneReglage
                        key={p.code_parametre}
                        p={p}
                        valeur={brouillon[p.code_parametre] ?? p.valeur_courante}
                        modifiable={droits.peutEcrire && p.verrouille === 0}
                        surChangement={(v) =>
                          saisir(p.code_parametre, v)
                        }
                      />
                    ))}
                  </CarteCorps>
                </Carte>
              )}
            </>
          )}
        </div>
      </PageAvecRail>

      {/* ---- Barre d'enregistrement ------------------------------------- */}
      {modifies.length > 0 && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-primaire bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px]">
            <span className="font-medium">{modifies.length} modification(s)</span>
            <span className="text-alerte"> — rien n est encore enregistré.</span>
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={() => { setBrouillon({}); setVersions({}) }}>
              <RotateCcw />
              Annuler
            </Bouton>
            <Bouton onClick={() => enregistrer.mutate()} chargement={enregistrer.isPending}>
              <Save />
              Enregistrer
            </Bouton>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Un reglage : intitule, effet, valeur.
 *
 * L'effet compte autant que la valeur. « 90 jours » ne dit rien a qui prend
 * l'ecran en main ; « en dessous, la reference passe en ATTENTION » se comprend
 * sans documentation.
 */
function LigneReglage({
  p,
  valeur,
  modifiable,
  surChangement,
}: {
  p: Parametre
  valeur: string
  modifiable: boolean
  surChangement: (v: string) => void
}) {
  const change = valeur !== p.valeur_courante
  const typeChamp =
    p.type_donnee === 'DATE' ? 'date' : p.type_donnee === 'TEXTE' ? 'text' : 'number'

  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-4 py-3',
        change && 'bg-primaire/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium" data-indice-gere="">{p.libelle}</span>
          {/* L'indice du réglage, tiré du catalogue d'aide (27/10/2026). */}
          <IndiceChamp intitule={p.libelle} />
          <Infobulle contenu={`Code technique : ${p.code_parametre}`}>
            <span className="font-mono text-[10px] text-attenue-texte">{p.code_parametre}</span>
          </Infobulle>
          {p.verrouille === 1 && (
            <Badge ton="neutre">
              <Lock className="mr-0.5 inline size-2.5" />
              verrouille
            </Badge>
          )}
          {change && <Badge ton="info">modifie</Badge>}
        </div>
        {p.description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-attenue-texte">{p.description}</p>
        )}
        <p className="mt-0.5 text-[10px] text-attenue-texte">
          Modifie le {fmt.date(p.date_derniere_modif)}
          {p.modifiable_par && p.modifiable_par !== 'AUCUN' && ` · reserve a ${p.modifiable_par}`}
        </p>
      </div>

      <div className="flex w-44 shrink-0 items-center gap-1.5">
        <Champ
          type={typeChamp}
          aria-label={p.libelle}
          step={p.type_donnee === 'DECIMAL' ? 'any' : undefined}
          value={valeur}
          disabled={!modifiable}
          onChange={(e) => surChangement(e.target.value)}
          className={cn('h-8', typeChamp === 'number' && 'text-right tabular-nums')}
        />
        {p.unite && (
          <span className="w-10 shrink-0 text-[11px] text-attenue-texte">{p.unite}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Devises et taux de change.
 *
 * Le taux n'est pas un parametre comme un autre : il est DATE. Un achat en
 * dollars valorise au taux du jour de sa reception, et ce taux ne doit plus
 * bouger ensuite (RG-09). On n'ecrase donc jamais un taux : on en ouvre un
 * nouveau, et la base ferme le precedent.
 */
function SectionDevises({ modifiable }: { modifiable: boolean }) {
  const qc = useQueryClient()
  const [pointee, setPointee] = useState<string | null>(null)
  const [nouveau, setNouveau] = useState({ taux: '', date_debut: '' })

  const qDev = useQuery({
    queryKey: ['devises'],
    queryFn: ({ signal }) => api.get<Devise[]>('/api/devises', { signal }),
  })
  const qTaux = useQuery({
    queryKey: ['taux', pointee],
    queryFn: ({ signal }) => api.get<Taux[]>(`/api/devises/${encodeURIComponent(pointee!)}/taux`, { signal }),
    enabled: !!pointee,
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post(`/api/devises/${encodeURIComponent(pointee!)}/taux`, {
        taux: Number(nouveau.taux),
        date_debut: nouveau.date_debut || undefined,
      }),
    onSuccess: () => {
      toast.success('Nouveau taux enregistre', {
        description: 'Le taux précédent est fermé à cette date. Les achats déjà valorisés ne bougent pas.',
      })
      setNouveau({ taux: '', date_debut: '' })
      void qc.invalidateQueries({ queryKey: ['taux'] })
      void qc.invalidateQueries({ queryKey: ['devises'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Taux refusé.'),
  })

  const devises = qDev.data ?? []
  const devise = devises.find((d) => d.code_devise === pointee) ?? null

  const colonnes: ColonneDT<Taux>[] = [
    {
      champ: 'taux',
      entete: 'Taux',
      numerique: true,
      largeur: '140px',
      rendu: (t) => <span className="tabular-nums font-medium">{fmt.nombre(t.taux, 4)}</span>,
    },
    { champ: 'date_debut', entete: 'En vigueur depuis', rendu: (t) => fmt.date(t.date_debut) },
    {
      champ: 'date_fin',
      entete: "Jusqu'au",
      rendu: (t) =>
        t.date_fin ? (
          fmt.date(t.date_fin)
        ) : (
          <Badge ton="succes">en vigueur</Badge>
        ),
    },
  ]

  return (
    <div className="space-y-3">
      <Alerte ton="info">
        Un taux est <strong>date</strong>. Une reception valorisee hier garde le taux d hier, quoi
        qu il arrive ensuite : c est ce qui rend le CMUP reproductible. Ouvrir un nouveau taux
        ferme automatiquement le précédent, sans jamais le reecrire.
      </Alerte>

      <Carte repliable="configuration.3">
        <CarteEntete>
          <CarteTitre>Devises</CarteTitre>
        </CarteEntete>
        <CarteCorps className="p-0">
          {qDev.isLoading ? (
            <div className="p-4">
              <Chargement texte="Lecture des devises…" />
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Libelle</th>
                  <th className="w-24 px-2 py-2 text-center">Symbole</th>
                  <th className="w-28 px-2 py-2 text-center">Pivot</th>
                  <th className="w-32 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {devises.map((d) => (
                  <tr
                    key={d.code_devise}
                    className={cn(
                      'cursor-pointer border-b border-bordure/60',
                      pointee === d.code_devise && 'bg-primaire/5',
                    )}
                    onClick={() => setPointee(d.code_devise)}
                  >
                    <td className="px-3 py-1.5 font-mono">{d.code_devise}</td>
                    <td className="px-3 py-1.5">{d.libelle}</td>
                    <td className="px-2 py-1.5 text-center">{d.symbole ?? '—'}</td>
                    <td className="px-2 py-1.5 text-center">
                      {d.est_pivot === 1 ? (
                        <Infobulle contenu="Monnaie de référence : son taux vaut 1 par definition">
                          <Badge ton="info">pivot</Badge>
                        </Infobulle>
                      ) : (
                        <span className="text-attenue-texte">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="text-[11px] text-primaire">voir les taux</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CarteCorps>
      </Carte>

      {devise && (
        <Carte repliable="configuration.4">
          <CarteEntete>
            <CarteTitre>Historique — {devise.code_devise}</CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            <DataTable<Taux>
              module="PARAMETRES"
              colonnes={colonnes}
              lignes={qTaux.data ?? []}
              chargement={qTaux.isLoading}
              erreur={qTaux.error}
              cle={(t) => `${t.code_devise}-${t.date_debut}`}
              recherche={false}
              pagination={false}
              videTitre="Aucun taux"
              videDescription="Cette devise n’a jamais eu de cours enregistre."
            />
          </CarteCorps>

          {modifiable && devise.est_pivot === 0 && (
            <CarteCorps className="border-t border-bordure">
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div>
                  <Etiq htmlFor="t" obligatoire>
                    Nouveau taux ({devise.code_devise} → pivot)
                  </Etiq>
                  <Champ
                    id="t"
                    type="number"
                    step="any"
                    min="0"
                    value={nouveau.taux}
                    onChange={(e) => setNouveau({ ...nouveau, taux: e.target.value })}
                    className="text-right tabular-nums"
                  />
                </div>
                <div>
                  <Etiq htmlFor="d">
                    En vigueur à partir du
                    <Aide>Laisse vide, le taux s'applique immediatement.</Aide>
                  </Etiq>
                  <Champ
                    id="d"
                    type="date"
                    value={nouveau.date_debut}
                    onChange={(e) => setNouveau({ ...nouveau, date_debut: e.target.value })}
                  />
                </div>
                <Bouton
                  disabled={!(Number(nouveau.taux) > 0)}
                  chargement={creer.isPending}
                  onClick={() => creer.mutate()}
                >
                  <Save />
                  Ouvrir le taux
                </Bouton>
              </div>
            </CarteCorps>
          )}

          {devise.est_pivot === 1 && (
            <CarteCorps className="border-t border-bordure">
              <Alerte ton="info">
                {devise.code_devise} est la monnaie de reference : son taux vaut 1 par definition
                et la base refuse toute autre valeur.
              </Alerte>
            </CarteCorps>
          )}
        </Carte>
      )}

      {!devise && (
        <Alerte ton="info">Choisissez une devise pour voir et modifier ses taux.</Alerte>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sauvegardes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Declencher une copie de la base, et voir celles qui existent.
 *
 * LE FICHIER NE SE TELECHARGE PAS DEPUIS CET ECRAN, et c'est deliberé. Une
 * sauvegarde contient les prix, les empreintes de mots de passe et onze mille
 * lignes d'audit nominatif. La faire transiter par le navigateur la rendrait
 * accessible a quiconque obtiendrait un jeton d'administrateur. Elle reste sur
 * le serveur ; on la recupere par le systeme de fichiers, en ayant deja acces
 * a la machine. L'ecran affiche le chemin exact pour que ce soit immediat.
 */
function SectionSauvegardes({ modifiable }: { modifiable: boolean }) {
  const qc = useQueryClient()
  const [retour, setRetour] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['sauvegardes'],
    queryFn: ({ signal }) => api.get<{ fichier: string; octets: number; date: string }[]>(
      '/api/admin/sauvegardes', { signal }
    ),
  })

  const creer = useMutation({
    mutationFn: () => api.post<{ fichier: string; chemin: string; octets: number }>(
      '/api/admin/sauvegardes',
      {},
    ),
    onSuccess: (r) => {
      setRetour(`${r.fichier} — ${(r.octets / 1e6).toFixed(1)} Mo`)
      void qc.invalidateQueries({ queryKey: ['sauvegardes'] })
    },
    onError: (e) => setRetour(e instanceof ErreurApi ? e.message : 'Sauvegarde impossible.'),
  })

  const liste = q.data ?? []

  /* LE VERDICT DE LA VERIFICATION HEBDOMADAIRE (07/11/2026) : la plus recente
     restauree a cote, controlee, effacee. Il n'etait lisible que dans le journal
     systeme du serveur. */
  const qVerif = useQuery({
    queryKey: ['sauvegardes-verification'],
    queryFn: ({ signal }) =>
      api.get<{
        verification: { date: string; fichier: string; restaurable: boolean; message: string } | null
        garder: number
        copie_externe: boolean
      }>('/api/admin/sauvegardes/verification', { signal }),
  })
  const verif = qVerif.data?.verification ?? null
  const garder = qVerif.data?.garder ?? 10

  return (
    <div className="space-y-3">
      <Carte>
        <CarteEntete className="flex-col items-start gap-1">
          <CarteTitre>Dernière vérification</CarteTitre>
        </CarteEntete>
        <CarteCorps className="space-y-1 text-[12px] leading-relaxed">
          {qVerif.isLoading ? (
            <Chargement texte="Lecture du verdict…" />
          ) : !verif ? (
            <p className="text-attenue-texte">
              Aucune vérification n’a encore laissé de verdict sur ce serveur. Elle tourne chaque
              dimanche à 03 h 30 sur le serveur de production, ou à la main :{' '}
              <span className="font-mono">gestionfil-admin verifier-sauvegarde</span>.
            </p>
          ) : (
            <>
              <p className={verif.restaurable ? 'font-medium text-succes' : 'font-medium text-danger'}>
                {verif.restaurable ? 'Sauvegarde restaurable' : 'La sauvegarde NE SE RESTAURE PAS'} —{' '}
                <span className="font-mono text-[11px]">{verif.fichier}</span>
              </p>
              <p className="text-attenue-texte">
                Vérifiée le {fmt.dateHeure(verif.date)}
                {!verif.restaurable && <> : {verif.message}</>}
              </p>
            </>
          )}
          <p className="text-attenue-texte">
            Copie hors du serveur :{' '}
            {qVerif.data?.copie_externe ? (
              <span className="text-texte">réglée (GESTIONFIL_COPIE_EXTERNE)</span>
            ) : (
              <span className="text-danger">aucune — à régler sur le serveur (GESTIONFIL_COPIE_EXTERNE)</span>
            )}
          </p>
        </CarteCorps>
      </Carte>

      <Carte>
        <CarteEntete className="flex-col items-start gap-1">
          <CarteTitre>Sauvegarder maintenant</CarteTitre>
          <p className="text-[11px] leading-relaxed text-attenue-texte">
            Écrit une copie complète et cohérente de la base PostgreSQL (<span className="font-mono">pg_dump</span>,
            format personnalisé compressé), sans interrompre le travail en cours, et archive les pièces
            jointes à côté. À faire avant toute opération risquée : import, changement de paramètre
            structurant, reprise de données. Une sauvegarde manuelle n’efface jamais les précédentes.
          </p>
        </CarteEntete>
        <CarteCorps className="flex flex-wrap items-center gap-3">
          <Bouton onClick={() => creer.mutate()} disabled={!modifiable || creer.isPending}>
            <DatabaseBackup />
            {creer.isPending ? 'Ecriture en cours…' : 'Sauvegarder'}
          </Bouton>
          {!modifiable && (
            <span className="text-[12px] text-attenue-texte">
              Votre rôle peut consulter les sauvegardes, pas en declencher.
            </span>
          )}
          {retour && <span className="text-[12px] text-texte">{retour}</span>}
        </CarteCorps>
      </Carte>

      <Carte>
        <CarteEntete className="flex-col items-start gap-1">
          <CarteTitre>Sauvegarde automatique</CarteTitre>
        </CarteEntete>
        <CarteCorps className="space-y-2 text-[12px] leading-relaxed text-attenue-texte">
          <p>
            Une copie est écrite <span className="text-texte">à chaque arrêt du serveur</span>,
            puis seules les <span className="text-texte">{garder} plus récentes</span> sont gardées : les
            plus anciennes partent avec leur archive de pièces jointes. Un échec de sauvegarde
            n’empêche jamais le serveur de s’arrêter — il est journalisé.
          </p>
          <p>
            Sur le serveur de production, <span className="font-mono text-texte">gestionfil-sauvegarde.timer</span>
            {' '}lance aussi <span className="font-mono text-texte">gestionfil-admin sauvegarder --automatique</span> chaque
            jour à 02 h 30 (au démarrage suivant si la machine était éteinte), qui purge de même et
            recopie la sauvegarde hors du serveur si un dossier externe est réglé. Chaque dimanche à
            03 h 30, <span className="font-mono text-texte">gestionfil-verif-sauvegarde.timer</span> restaure
            la plus récente dans une base temporaire, la contrôle, puis l’efface : la base vivante
            n’est pas touchée.
          </p>
          <p className="text-danger">
            Ces copies vivent sur le même disque que la base. Elles protègent d’une fausse
            manœuvre, pas d’une panne de disque ni d’un vol : sans copie hors du serveur
            (GESTIONFIL_COPIE_EXTERNE, un NAS ou un partage monté), recopiez régulièrement le
            dossier vers un support externe.
          </p>
        </CarteCorps>
      </Carte>

      <Carte>
        <CarteEntete>
          <CarteTitre>
            Sauvegardes presentes {liste.length > 0 && `— ${liste.length}`}
          </CarteTitre>
        </CarteEntete>
        <CarteCorps className="p-0">
          {q.isLoading ? (
            <div className="p-3"><Chargement texte="Lecture du dossier…" /></div>
          ) : !liste.length ? (
            <p className="p-3 text-[12px] text-attenue-texte">
              Aucune sauvegarde. La première sera écrite au prochain arrêt du serveur, ou
              maintenant avec le bouton ci-dessus.
            </p>
          ) : (
            <table className="grille w-full text-[12px]">
              <thead>
                <tr className="bg-attenue">
                  <th className="px-2.5 py-1.5 text-left font-semibold">Fichier</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold">Date</th>
                  <th className="px-2.5 py-1.5 text-right font-semibold">Taille</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((s, i) => (
                  <tr key={s.fichier} className="hover:bg-attenue/60">
                    <td className="px-2.5 py-1 font-mono text-[11px]">
                      {s.fichier}
                      {i === 0 && (
                        <span className="ml-2 rounded-[3px] bg-succes/12 px-1.5 py-px text-[10px] font-medium text-succes">
                          la plus récente
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1 tabular-nums">{s.date}</td>
                    <td className="px-2.5 py-1 text-right tabular-nums">
                      {(s.octets / 1e6).toFixed(1)} Mo
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t border-bordure px-3 py-2 text-[11px] leading-relaxed text-attenue-texte">
            Fichiers <span className="font-mono">gestionfil-AAAAMMJJhhmmss.dump</span> (et{' '}
            <span className="font-mono">&lt;dump&gt;.pieces.tar</span> pour les pièces jointes), dans le
            dossier <span className="font-mono">GESTIONFIL_SAUVEGARDES</span>, à défaut{' '}
            <span className="font-mono">sauvegardes/</span> dans le dossier de travail du serveur — en
            production <span className="font-mono">/opt/gestionfil/sauvegardes</span> (droits 0700).
          </p>
        </CarteCorps>
      </Carte>

      {/* --- Restauration -------------------------------------------------
          Elle ne se fait PAS depuis cet ecran, et ce n'est pas un oubli : la
          base est renommee puis recreee (ALTER DATABASE ... RENAME), ce que
          PostgreSQL refuse tant que le serveur y tient des connexions. La
          commande s'execute sur la machine, serveur arrete, par quelqu'un qui
          a deja acces aux fichiers (backend/src/bin/admin.rs, restaurer). */}
      <Carte>
        <CarteEntete className="flex-col items-start gap-1">
          <CarteTitre>Restaurer une sauvegarde</CarteTitre>
        </CarteEntete>
        <CarteCorps className="space-y-2 text-[12px] leading-relaxed text-attenue-texte">
          <p>
            La restauration ne se déclenche pas depuis l’application : la base actuelle est
            renommée puis recréée, ce que PostgreSQL refuse tant que le serveur y est connecté.
            Elle se fait sur la machine, serveur arrêté. Pour prouver qu’une sauvegarde se
            restaure sans rien toucher, <span className="font-mono text-texte">verifier-sauvegarde</span>
            {' '}la restaure à côté, la contrôle et l’efface.
          </p>
          <pre className="overflow-x-auto rounded-[3px] bg-attenue p-2 font-mono text-[11px] text-texte">
{`gestionfil-admin lister-sauvegardes
gestionfil-admin verifier-sauvegarde [fichier]
sudo systemctl stop gestionfil
gestionfil-admin restaurer gestionfil-AAAAMMJJhhmmss.dump
sudo systemctl start gestionfil`}
          </pre>
          <p>
            La commande <span className="text-texte">vérifie que la sauvegarde est lisible</span>
            {' '}(<span className="font-mono">pg_restore --list</span>) avant de la poser et refuse une
            copie suspecte. La base remplacée n’est pas effacée : elle est renommée{' '}
            <span className="font-mono text-texte">&lt;base&gt;_remplacee_&lt;horodatage&gt;</span>, ce qui
            rend l’opération réversible. Si l’archive <span className="font-mono">.pieces.tar</span> est
            à côté du dump, les pièces jointes suivent ; le dossier actuel est mis de côté.
          </p>
        </CarteCorps>
      </Carte>

      {/* --- Maintenance --------------------------------------------------- */}
      <Carte>
        <CarteEntete className="flex-col items-start gap-1">
          <CarteTitre>Diagnostic et maintenance</CarteTitre>
        </CarteEntete>
        <CarteCorps className="space-y-2 text-[12px] leading-relaxed text-attenue-texte">
          <p>
            <span className="font-mono text-texte">diagnostic</span> vérifie qu’aucune contrainte
            n’a été posée sans contrôle de l’existant, donne la taille et la structure de la base,
            et passe tous les contrôles métier de cohérence — <span className="text-texte">sans
            rien modifier</span>.
          </p>
          <p>
            <span className="font-mono text-texte">reparer</span> réindexe la base, récupère l’espace
            mort et recalcule les statistiques (<span className="font-mono">REINDEX</span>,{' '}
            <span className="font-mono">VACUUM (ANALYZE)</span>). Il ne corrige{' '}
            <span className="text-texte">aucune donnée métier</span> : une anomalie de cohérence se
            corrige dans l’application, par quelqu’un qui sait ce que la ligne devrait porter.
          </p>
          <pre className="overflow-x-auto rounded-[3px] bg-attenue p-2 font-mono text-[11px] text-texte">
{`gestionfil-admin diagnostic
gestionfil-admin reparer`}
          </pre>
          <p>
            Les anomalies de cohérence se lisent aussi à l’écran, dans{' '}
            <span className="text-texte">Analyses › Contrôles de cohérence</span>, avec le détail
            des lignes concernées.
          </p>
        </CarteCorps>
      </Carte>
    </div>
  )
}

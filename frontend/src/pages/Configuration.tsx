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
import { useMemo, useState } from 'react'
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
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Infobulle } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'
import { Referentiels } from './Referentiels'

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

interface Section {
  cle: CleSection
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
    libelle: 'Alertes et seuils',
    resume: 'Quand une reference passe en attention, en critique, en rupture',
    Icone: AlertTriangle,
    blocs: [
      {
        titre: 'Seuils de couverture',
        intention:
          "Le statut d'une reference se lit en JOURS DE COUVERTURE, pas en kilos : " +
          '500 kg sont confortables sur une matiere lente et deja courts sur le fil de chaine.',
        codes: ['P_SeuilAlerte', 'P_SeuilCritique', 'P_CouvMinMois', 'P_MargeSecurite'],
      },
      {
        titre: 'Reapprovisionnement',
        intention:
          "Ce que le plan d'achat suppose quand le fournisseur ne dit rien, et la marge " +
          'gardee avant la date de besoin.',
        codes: ['P_DelaiDefaut', 'P_MargeJours'],
      },
    ],
  },
  {
    cle: 'production',
    libelle: 'Production',
    resume: 'Perte matiere, stocks de securite, tolerance des recettes',
    Icone: Factory,
    blocs: [
      {
        titre: 'Pertes et tolerances',
        intention:
          'Le taux de perte majore chaque besoin calcule par le MRP. La tolerance de recette ' +
          "dit de combien la somme des pourcentages d'un role peut s'ecarter de 100 %.",
        codes: ['P_TauxPerte', 'P_ToleranceRecette'],
      },
      {
        titre: 'Stock de securite par classe',
        intention:
          'Le matelas garde en plus du besoin calcule, exprime en jours de consommation. ' +
          'Une classe A merite en general davantage de couverture qu une classe C.',
        codes: ['P_SecuriteA', 'P_SecuriteB', 'P_SecuriteC'],
      },
      {
        titre: 'Photo de stock initiale',
        intention:
          "Date de la reprise : avant elle, les quantites viennent de l'inventaire d'ouverture " +
          'et non des mouvements.',
        codes: ['P_DateSaisie'],
      },
    ],
  },
  {
    cle: 'entreprise',
    libelle: 'Entreprise',
    resume: 'Identite, pays, devise de reporting',
    Icone: Building2,
    blocs: [
      {
        titre: 'Identite',
        intention:
          "Ces valeurs n'entrent dans aucun calcul : elles figurent sur les etats d'impression " +
          'et les bons adresses aux fournisseurs.',
        codes: ['P_NomEntreprise', 'P_Secteur', 'P_Pays', 'P_DateCreationERP'],
      },
      {
        titre: 'Monnaie de reference',
        intention:
          'Toute valorisation est ramenee a cette devise. Elle est verrouillee : la changer ' +
          'apres coup rendrait faux tout le stock deja valorise.',
        codes: ['P_Devise'],
      },
    ],
  },
  {
    cle: 'supply',
    libelle: 'Chaine logistique',
    resume: 'Classement ABC/XYZ, tiering des commandes, notation fournisseurs',
    Icone: TrendingUp,
    blocs: [
      {
        titre: 'Classement des references',
        intention:
          'ABC repartit les references par poids financier, XYZ par regularite de consommation. ' +
          'Les deux servent a doser le stock de securite et la vigilance.',
        codes: ['P_SeuilABCA', 'P_SeuilABCB', 'P_SeuilXYZ_X', 'P_SeuilXYZ_Y'],
      },
      {
        titre: 'Montants et urgence des commandes',
        intention:
          "Le tiering classe l'urgence d'un achat par son montant. Le seuil de validation dit " +
          'a partir de quand la Direction doit signer.',
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
        titre: 'Immobilisation et tresorerie',
        intention:
          'Au-dela du seuil de dormance, un stock qui ne bouge plus est signale. Le delai de ' +
          'paiement sert au previsionnel quand le fournisseur n en declare aucun.',
        codes: ['P_SeuilDormant', 'P_DSODefaut', 'P_DateRefKPI'],
      },
    ],
  },
  {
    cle: 'reception',
    libelle: 'Receptions et OTIF',
    resume: 'Tolerance de pesee, cible de performance fournisseur',
    Icone: PackageCheck,
    blocs: [
      {
        titre: 'Tolerances au quai',
        intention:
          'Au-dela de la tolerance de pesee, la ligne exige une derogation nominative. ' +
          'La tolerance In-Full dit a partir de quel manque une livraison cesse d etre complete.',
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
    libelle: 'Referentiels',
    resume: 'Categories, roles, magasins, mouvements, motifs, equivalences',
    Icone: Layers,
  },
  {
    cle: 'devises',
    libelle: 'Devises et taux',
    resume: 'Cours de change en vigueur et leur historique',
    Icone: Coins,
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

  const [section, setSection] = useState<CleSection>('alertes')
  const [brouillon, setBrouillon] = useState<Record<string, string>>({})
  const [recherche, setRecherche] = useState('')

  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: () => api.get<Parametre[]>('/api/parametres'),
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

  const modifies = Object.entries(brouillon).filter(
    ([code, v]) => parCode.get(code)?.valeur_courante !== v,
  )

  const enregistrer = useMutation({
    mutationFn: async () => {
      for (const [code, valeur] of modifies) {
        await api.patch(`/api/parametres/${code}`, {
          valeur_courante: valeur,
          motif: 'Modification depuis l ecran de configuration',
        })
      }
      return modifies.length
    },
    onSuccess: (n) => {
      toast.success(`${n} parametre(s) enregistre(s)`, {
        description:
          'Chaque changement est historise avec son auteur. Rappel : ces valeurs servent de ' +
          'defaut a la creation et ne modifient rien de deja enregistre.',
        duration: 8000,
      })
      setBrouillon({})
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
        description="Les reglages qui gouvernent les calculs, et les referentiels sur lesquels ils s appuient."
      />

      <PageAvecRail
        large
        rail={
          <RailLateral
            groupes={[
              {
                entrees: SECTIONS.map((s) => ({
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
              },
            ]}
            actif={recherche ? '' : section}
            surChoix={(c) => {
              setSection(c as CleSection)
              setRecherche('')
            }}
            recherche={{
              valeur: recherche,
              surChangement: setRecherche,
              placeholder: 'Chercher un reglage…',
            }}
          />
        }
      >
        <div className="space-y-3">
          {q.isLoading && <Chargement texte="Lecture des parametres…" />}

          {recherche ? (
            <Carte>
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
                      setBrouillon((b) => ({ ...b, [p.code_parametre]: v }))
                    }
                  />
                ))}
                {resultats.length === 0 && (
                  <p className="p-4 text-[13px] text-attenue-texte">
                    Aucun reglage ne correspond.
                  </p>
                )}
              </CarteCorps>
            </Carte>
          ) : section === 'referentiels' ? (
            <Referentiels />
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
                            setBrouillon((br) => ({ ...br, [p.code_parametre]: v }))
                          }
                        />
                      ))}
                    </CarteCorps>
                  </Carte>
                )
              })}

              {(orphelins[section] ?? []).length > 0 && (
                <Carte>
                  <CarteEntete className="flex-col items-start gap-1">
                    <CarteTitre>Autres reglages</CarteTitre>
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
                          setBrouillon((br) => ({ ...br, [p.code_parametre]: v }))
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
            <span className="text-alerte"> — rien n est encore enregistre.</span>
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={() => setBrouillon({})}>
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
          <span className="text-[13px] font-medium">{p.libelle}</span>
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
    queryFn: () => api.get<Devise[]>('/api/devises'),
  })
  const qTaux = useQuery({
    queryKey: ['taux', pointee],
    queryFn: () => api.get<Taux[]>(`/api/devises/${encodeURIComponent(pointee!)}/taux`),
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
        description: 'Le taux precedent est ferme a cette date. Les achats deja valorises ne bougent pas.',
      })
      setNouveau({ taux: '', date_debut: '' })
      void qc.invalidateQueries({ queryKey: ['taux'] })
      void qc.invalidateQueries({ queryKey: ['devises'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Taux refuse.'),
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
        ferme automatiquement le precedent, sans jamais le reecrire.
      </Alerte>

      <Carte>
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
                        <Infobulle contenu="Monnaie de reference : son taux vaut 1 par definition">
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
        <Carte>
          <CarteEntete>
            <CarteTitre>Historique — {devise.code_devise}</CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            <DataTable<Taux>
              module="PARAMETRES"
              colonnes={colonnes}
              lignes={qTaux.data ?? []}
              chargement={qTaux.isLoading}
              cle={(t) => `${t.code_devise}-${t.date_debut}`}
              recherche={false}
              pagination={false}
              videTitre="Aucun taux"
              videDescription="Cette devise n a jamais eu de cours enregistre."
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
                  <Etiq htmlFor="d">En vigueur a partir du</Etiq>
                  <Champ
                    id="d"
                    type="date"
                    value={nouveau.date_debut}
                    onChange={(e) => setNouveau({ ...nouveau, date_debut: e.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-attenue-texte">
                    Vide : applicable immediatement.
                  </p>
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

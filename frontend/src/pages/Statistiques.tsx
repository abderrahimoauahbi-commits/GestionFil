/**
 * Statistiques — quatre familles, quatre questions.
 *
 *   Mouvements   : qu'est-ce qui bouge, et qu'est-ce qui dort ?
 *   Prix d'achat : d'ou vient la hausse — du fournisseur ou du change ?
 *   Fournisseurs : qui tient ses promesses, et dans quel sens ca evolue ?
 *   Qualites     : combien coute le metre carre, et ou part cet argent ?
 *
 * Chaque famille est lue sous le module dont elle releve — MOUVEMENTS,
 * VALORISATION, FOURNISSEURS, QUALITES — et non sous un module « statistiques »
 * qui aurait ouvert une porte derobee sur des donnees autrement protegees. Un
 * onglet dont le module est ferme n'apparait pas.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Factory,
  Minus,
  TrendingUp,
  Truck,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { PageAvecRail, RailLateral } from '../composants/RailLateral'
import {
  Alerte,
  Badge,
  Carte,
  CarteCorps,
  CarteEntete,
  CarteTitre,
  Chargement,
} from '../composants/ui/base'
import { Infobulle } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

type Onglet = 'mouvements' | 'prix' | 'fournisseurs' | 'qualites'

interface Ligne {
  [k: string]: unknown
}

const ONGLETS: {
  cle: Onglet
  nom: string
  resume: string
  module: string
  Icone: React.ComponentType<{ className?: string }>
}[] = [
  {
    cle: 'mouvements',
    nom: 'Mouvements',
    resume: 'Ce qui bouge, et ce qui dort',
    module: 'MOUVEMENTS',
    Icone: Boxes,
  },
  {
    cle: 'prix',
    nom: 'Prix d achat',
    resume: 'La hausse vient-elle du fournisseur ou du change',
    module: 'VALORISATION',
    Icone: TrendingUp,
  },
  {
    cle: 'fournisseurs',
    nom: 'Fournisseurs',
    resume: 'Qui tient ses promesses, et dans quel sens',
    module: 'FOURNISSEURS',
    Icone: Truck,
  },
  {
    cle: 'qualites',
    nom: 'Qualites',
    resume: 'Ce que coute le metre carre',
    module: 'QUALITES',
    Icone: Factory,
  },
]

export function Statistiques() {
  const { peut } = useAuth()
  const accessibles = ONGLETS.filter((o) => peut(o.module, 'LIRE'))
  const [onglet, setOnglet] = useState<Onglet>(accessibles[0]?.cle ?? 'mouvements')

  const q = useQuery({
    queryKey: ['stats', onglet],
    queryFn: () => api.get<Record<string, Ligne[]>>(`/api/stats/${onglet}`),
    enabled: accessibles.some((o) => o.cle === onglet),
  })

  if (accessibles.length === 0) {
    return (
      <div>
        <EnTetePage titre="Statistiques" />
        <Alerte ton="alerte">
          Aucune famille de statistiques n'est ouverte a votre role.
        </Alerte>
      </div>
    )
  }

  return (
    <div>
      <EnTetePage
        titre="Statistiques"
        description="Calculees a la lecture, sur les donnees du jour. Aucun chiffre n'est fige ni recopie."
      />

      <PageAvecRail
        large
        rail={
          <RailLateral
            groupes={[
              {
                titre: 'Familles',
                entrees: accessibles.map((o) => ({
                  cle: o.cle,
                  libelle: o.nom,
                  resume: o.resume,
                  Icone: o.Icone,
                })),
              },
            ]}
            actif={onglet}
            surChoix={(c) => setOnglet(c as Onglet)}
          />
        }
      >
        {q.isLoading && <Chargement texte="Calcul en cours…" />}

        {!q.isLoading && q.data && (
          <>
            {onglet === 'mouvements' && <VoletMouvements d={q.data} />}
            {onglet === 'prix' && <VoletPrix d={q.data} />}
            {onglet === 'fournisseurs' && <VoletFournisseurs d={q.data} />}
            {onglet === 'qualites' && <VoletQualites d={q.data} />}
          </>
        )}
      </PageAvecRail>
    </div>
  )
}

/* ========================================================================== */
/* Briques communes                                                            */
/* ========================================================================== */

function Chiffre({
  libelle,
  valeur,
  detail,
  ton = 'neutre',
}: {
  libelle: string
  valeur: string
  detail?: string
  ton?: 'neutre' | 'succes' | 'alerte' | 'danger'
}) {
  const teinte = {
    neutre: 'text-texte',
    succes: 'text-succes',
    alerte: 'text-alerte',
    danger: 'text-danger',
  }[ton]
  return (
    <div className="rounded-[var(--radius)] border border-bordure bg-surface px-4 py-2.5">
      <div className="text-[11px] text-attenue-texte">{libelle}</div>
      <div className={cn('text-lg font-semibold tabular-nums', teinte)}>{valeur}</div>
      {detail && <div className="text-[11px] text-attenue-texte">{detail}</div>}
    </div>
  )
}

/** Barre horizontale proportionnelle, avec sa valeur a droite. */
function Barre({
  part,
  couleur = 'bg-primaire',
  titre,
}: {
  part: number
  couleur?: string
  titre?: string
}) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-bordure/60" title={titre}>
      <div
        className={cn('h-full rounded-full', couleur)}
        style={{ width: `${Math.max(1, Math.min(100, part * 100))}%` }}
      />
    </div>
  )
}

/** Un pourcentage signe, lisible d'un coup d'oeil. */
function Variation({ pct, inverse = false }: { pct: number | null; inverse?: boolean }) {
  if (pct == null) return <span className="text-attenue-texte">—</span>
  if (Math.abs(pct) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 tabular-nums text-attenue-texte">
        <Minus className="size-3" />
        stable
      </span>
    )
  }
  const mauvais = inverse ? pct < 0 : pct > 0
  const Fleche = pct > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-medium tabular-nums',
        mauvais ? 'text-danger' : 'text-succes',
      )}
    >
      <Fleche className="size-3" />
      {pct > 0 ? '+' : ''}
      {fmt.nombre(pct, 1)} %
    </span>
  )
}

const nb = (l: Ligne, c: string) => (l[c] == null ? null : Number(l[c]))
const txt = (l: Ligne, c: string) => (l[c] == null ? null : String(l[c]))
/** Le champ est-il visible ? Absent = masque par le serveur, pas « a zero ». */
const a = (lignes: Ligne[], c: string) => lignes.length > 0 && c in lignes[0]

/* ========================================================================== */
/* Mouvements                                                                  */
/* ========================================================================== */

function VoletMouvements({ d }: { d: Record<string, Ligne[]> }) {
  const mois = d.mois ?? []
  const refs = d.references ?? []

  const totaux = useMemo(() => {
    const e = refs.reduce((s, r) => s + (nb(r, 'entrees_kg') ?? 0), 0)
    const so = refs.reduce((s, r) => s + (nb(r, 'sorties_kg') ?? 0), 0)
    const dormantes = refs.filter((r) => (nb(r, 'jours_sans_mouvement') ?? 9999) > 180).length
    const jamais = refs.filter((r) => nb(r, 'dernier_mouvement' as string) === null && !r.dernier_mouvement).length
    return { e, so, dormantes, jamais }
  }, [refs])

  const maxFlux = Math.max(...refs.map((r) => (nb(r, 'entrees_kg') ?? 0) + (nb(r, 'sorties_kg') ?? 0)), 1)
  const maxMois = Math.max(...mois.map((m) => nb(m, 'quantite_kg') ?? 0), 1)
  const voitValeur = a(mois, 'valeur_mad')

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Chiffre libelle="Entrees cumulees" valeur={`${fmt.compact(totaux.e)} kg`} ton="succes" />
        <Chiffre libelle="Sorties cumulees" valeur={`${fmt.compact(totaux.so)} kg`} ton="alerte" />
        <Chiffre
          libelle="Sans mouvement depuis 6 mois"
          valeur={String(totaux.dormantes)}
          detail="references"
          ton={totaux.dormantes > 0 ? 'alerte' : 'succes'}
        />
        <Chiffre
          libelle="Jamais mouvementees"
          valeur={String(totaux.jamais)}
          detail="references du catalogue"
          ton={totaux.jamais > 0 ? 'alerte' : 'succes'}
        />
      </div>

      <Carte>
        <CarteEntete>
          <CarteTitre>Flux par mois et par type</CarteTitre>
        </CarteEntete>
        <CarteCorps className="p-0">
          {mois.length === 0 ? (
            <p className="p-4 text-[13px] text-attenue-texte">Aucun mouvement enregistre.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                    <th className="px-3 py-2 text-left">Mois</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="w-20 px-2 py-2 text-right">Sens</th>
                    <th className="w-24 px-2 py-2 text-right">Mvts</th>
                    <th className="w-28 px-2 py-2 text-right">Quantite</th>
                    <th className="w-40 px-3 py-2 text-left">Part</th>
                    {voitValeur && <th className="w-32 px-3 py-2 text-right">Valeur</th>}
                  </tr>
                </thead>
                <tbody>
                  {mois.map((m, i) => (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="px-3 py-1.5 tabular-nums">{txt(m, 'annee_mois')}</td>
                      <td className="px-3 py-1.5">{txt(m, 'type_libelle')}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Badge ton={nb(m, 'signe') === 1 ? 'succes' : 'alerte'}>
                          {nb(m, 'signe') === 1 ? 'entree' : 'sortie'}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(m, 'nb_mouvements') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(m, 'quantite_kg') ?? 0, 0)} kg
                      </td>
                      <td className="px-3 py-1.5">
                        <Barre
                          part={(nb(m, 'quantite_kg') ?? 0) / maxMois}
                          couleur={nb(m, 'signe') === 1 ? 'bg-succes' : 'bg-alerte'}
                        />
                      </td>
                      {voitValeur && (
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {(nb(m, 'valeur_mad') ?? 0) > 0
                            ? `${fmt.compact(nb(m, 'valeur_mad'))} MAD`
                            : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CarteCorps>
      </Carte>

      <Carte>
        <CarteEntete>
          <CarteTitre>Par reference</CarteTitre>
          <span className="text-[11px] text-attenue-texte">
            la rotation rapporte les sorties au stock actuel — une approximation, faute
            d'historique de stock
          </span>
        </CarteEntete>
        <CarteCorps className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="w-16 px-2 py-2 text-center">ABC</th>
                  <th className="w-28 px-2 py-2 text-right">Entrees</th>
                  <th className="w-28 px-2 py-2 text-right">Sorties</th>
                  <th className="w-36 px-3 py-2 text-left">Flux</th>
                  <th className="w-28 px-2 py-2 text-right">Stock</th>
                  <th className="w-24 px-2 py-2 text-right">Rotation</th>
                  <th className="w-28 px-2 py-2 text-right">Immobile</th>
                </tr>
              </thead>
              <tbody>
                {refs.slice(0, 60).map((r, i) => {
                  const jours = nb(r, 'jours_sans_mouvement')
                  return (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="max-w-64 px-3 py-1.5">
                        <div className="truncate font-medium">{txt(r, 'code_reference')}</div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {txt(r, 'designation')}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {txt(r, 'classe_abc') && (
                          <Badge ton={txt(r, 'classe_abc') === 'A' ? 'danger' : 'neutre'}>
                            {txt(r, 'classe_abc')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-succes">
                        {fmt.nombre(nb(r, 'entrees_kg') ?? 0, 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-alerte">
                        {fmt.nombre(nb(r, 'sorties_kg') ?? 0, 0)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Barre
                          part={((nb(r, 'entrees_kg') ?? 0) + (nb(r, 'sorties_kg') ?? 0)) / maxFlux}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(r, 'stock_actuel_kg') ?? 0, 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(r, 'rotation') == null ? '—' : fmt.nombre(nb(r, 'rotation')!, 2)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {jours == null ? (
                          <Badge ton="alerte">jamais</Badge>
                        ) : (
                          <span className={cn('tabular-nums', jours > 180 && 'text-alerte')}>
                            {jours} j
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CarteCorps>
      </Carte>
    </div>
  )
}

/* ========================================================================== */
/* Prix d'achat                                                                */
/* ========================================================================== */

function VoletPrix({ d }: { d: Record<string, Ligne[]> }) {
  const refs = d.references ?? []
  const mois = d.mois ?? []

  const voitPrix = a(refs, 'dernier_prix_mad')
  const [choisie, setChoisie] = useState<string | null>(null)
  const serie = useMemo(
    () => mois.filter((m) => txt(m, 'code_reference') === choisie),
    [mois, choisie],
  )

  if (!voitPrix) {
    return (
      <Alerte ton="alerte">
        Les prix d'achat ne sont pas ouverts a votre role. Les statistiques de prix restent donc
        vides — ce n'est pas une absence de donnees.
      </Alerte>
    )
  }

  const impactTotal = refs.reduce((s, r) => s + (nb(r, 'impact_fournisseur_mad') ?? 0), 0)
  const enHausse = refs.filter((r) => (nb(r, 'derive_fournisseur_pct') ?? 0) > 0.05).length
  const monoAchat = refs.filter((r) => (nb(r, 'nb_achats') ?? 0) < 2).length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Chiffre libelle="References suivies" valeur={String(refs.length)} />
        <Chiffre
          libelle="En hausse fournisseur"
          valeur={String(enHausse)}
          detail="hors effet de change"
          ton={enHausse > 0 ? 'alerte' : 'succes'}
        />
        <Chiffre
          libelle="Impact des hausses"
          valeur={`${fmt.compact(impactTotal)} MAD`}
          detail="sur les volumes achetes"
          ton={impactTotal > 0 ? 'danger' : 'succes'}
        />
        <Chiffre
          libelle="Un seul achat"
          valeur={String(monoAchat)}
          detail="pas encore de tendance"
        />
      </div>

      <Alerte ton="info" titre="Ce que separent ces colonnes">
        Un prix en dirhams qui monte melange deux causes sans rapport : le fournisseur a augmente
        son tarif, ou le dirham s'est deprecie. La premiere se negocie, la seconde se couvre. Les
        confondre revient a reprocher a un fournisseur une variation du marche des devises.
      </Alerte>

      <Carte>
        <CarteEntete>
          <CarteTitre>Derive du prix d'achat</CarteTitre>
          <span className="text-[11px] text-attenue-texte">
            triee par impact en dirhams, pas par pourcentage
          </span>
        </CarteEntete>
        <CarteCorps className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="w-16 px-2 py-2 text-center">Dev.</th>
                  <th className="w-16 px-2 py-2 text-right">Achats</th>
                  <th className="w-28 px-2 py-2 text-right">Prix moyen</th>
                  <th className="w-28 px-2 py-2 text-right">Dernier</th>
                  <th className="w-28 px-2 py-2 text-right">Total</th>
                  <th className="w-28 px-2 py-2 text-right">Fournisseur</th>
                  <th className="w-28 px-2 py-2 text-right">Change</th>
                  <th className="w-32 px-2 py-2 text-right">Impact MAD</th>
                </tr>
              </thead>
              <tbody>
                {refs.slice(0, 60).map((r, i) => {
                  const code = txt(r, 'code_reference')!
                  return (
                    <tr
                      key={i}
                      onClick={() => setChoisie(choisie === code ? null : code)}
                      className={cn(
                        'cursor-pointer border-b border-bordure/60',
                        choisie === code && 'bg-primaire/5',
                      )}
                    >
                      <td className="max-w-64 px-3 py-1.5">
                        <div className="truncate font-medium">{code}</div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {txt(r, 'designation')}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[11px]">
                        {txt(r, 'code_devise')}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(r, 'nb_achats') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(r, 'prix_moyen_mad') ?? 0, 2)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(r, 'dernier_prix_mad') ?? 0, 2)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Variation pct={nb(r, 'derive_totale_pct')} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Variation pct={nb(r, 'derive_fournisseur_pct')} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Infobulle contenu="Variation du taux de change : rien a negocier avec le fournisseur">
                          <span>
                            <Variation pct={nb(r, 'derive_change_pct')} />
                          </span>
                        </Infobulle>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(r, 'impact_fournisseur_mad') == null
                          ? '—'
                          : fmt.compact(nb(r, 'impact_fournisseur_mad'))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CarteCorps>
      </Carte>

      {choisie && (
        <Carte>
          <CarteEntete>
            <CarteTitre>Historique mensuel — {choisie}</CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            {serie.length === 0 ? (
              <p className="p-4 text-[13px] text-attenue-texte">Aucun achat enregistre.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                    <th className="px-3 py-2 text-left">Mois</th>
                    <th className="w-20 px-2 py-2 text-right">Achats</th>
                    <th className="w-28 px-2 py-2 text-right">Quantite</th>
                    <th className="w-28 px-2 py-2 text-right">Prix devise</th>
                    <th className="w-24 px-2 py-2 text-right">Taux</th>
                    <th className="w-28 px-2 py-2 text-right">Prix MAD</th>
                    <th className="w-32 px-2 py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((m, i) => (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="px-3 py-1.5 tabular-nums">{txt(m, 'annee_mois')}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(m, 'nb_achats') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(m, 'quantite_kg') ?? 0, 0)} kg
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(m, 'prix_moyen_devise') ?? 0, 4)} {txt(m, 'code_devise')}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(m, 'taux_moyen') ?? 0, 3)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {fmt.nombre(nb(m, 'prix_moyen_mad') ?? 0, 4)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.compact(nb(m, 'montant_mad'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
              Moyennes <strong>ponderees par les quantites</strong> : une palette d'essai ne pese
              pas autant qu'un conteneur dans le prix affiche.
            </p>
          </CarteCorps>
        </Carte>
      )}
    </div>
  )
}

/* ========================================================================== */
/* Fournisseurs                                                                */
/* ========================================================================== */

function VoletFournisseurs({ d }: { d: Record<string, Ligne[]> }) {
  const score = d.scorecard ?? []
  const mois = d.mois ?? []
  const voitMontant = a(score, 'montant_total_mad')

  const [choisi, setChoisi] = useState<string | null>(null)
  const serie = useMemo(
    () => mois.filter((m) => txt(m, 'code_fournisseur') === choisi),
    [mois, choisi],
  )

  const otifMoyen = useMemo(() => {
    const v = score.map((s) => nb(s, 'otif_pct')).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }, [score])
  const strategiques = score.filter((s) => txt(s, 'classement') === 'STRATEGIQUE').length
  const aSurveiller = score.filter((s) => txt(s, 'classement') === 'A_SURVEILLER').length

  const maxMontant = Math.max(...score.map((s) => nb(s, 'montant_total_mad') ?? 0), 1)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Chiffre libelle="Fournisseurs" valeur={String(score.length)} />
        <Chiffre
          libelle="OTIF moyen"
          valeur={otifMoyen == null ? '—' : `${fmt.nombre(otifMoyen, 1)} %`}
          detail="cible 95 %"
          ton={otifMoyen == null ? 'neutre' : otifMoyen >= 95 ? 'succes' : 'alerte'}
        />
        <Chiffre libelle="Strategiques" valeur={String(strategiques)} ton="succes" />
        <Chiffre
          libelle="A surveiller"
          valeur={String(aSurveiller)}
          ton={aSurveiller > 0 ? 'alerte' : 'succes'}
        />
      </div>

      <Carte>
        <CarteEntete>
          <CarteTitre>Fiche de performance</CarteTitre>
          <span className="text-[11px] text-attenue-texte">
            cliquez une ligne pour voir sa tendance mensuelle
          </span>
        </CarteEntete>
        <CarteCorps className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Fournisseur</th>
                  <th className="w-20 px-2 py-2 text-center">Pays</th>
                  <th className="w-20 px-2 py-2 text-right">Refs</th>
                  {voitMontant && <th className="w-40 px-3 py-2 text-left">Volume d'achat</th>}
                  <th className="w-24 px-2 py-2 text-right">Delai</th>
                  <th className="w-24 px-2 py-2 text-right">Ponctuel</th>
                  <th className="w-24 px-2 py-2 text-right">Conforme</th>
                  <th className="w-24 px-2 py-2 text-right">OTIF</th>
                  <th className="w-28 px-2 py-2 text-right">Note</th>
                  <th className="w-32 px-2 py-2 text-left">Classement</th>
                </tr>
              </thead>
              <tbody>
                {score.map((s, i) => {
                  const code = txt(s, 'code_fournisseur')!
                  const otif = nb(s, 'otif_pct')
                  const cls = txt(s, 'classement')
                  return (
                    <tr
                      key={i}
                      onClick={() => setChoisi(choisi === code ? null : code)}
                      className={cn(
                        'cursor-pointer border-b border-bordure/60',
                        choisi === code && 'bg-primaire/5',
                      )}
                    >
                      <td className="max-w-56 px-3 py-1.5">
                        <div className="truncate font-medium">{txt(s, 'nom')}</div>
                        <div className="truncate text-[11px] text-attenue-texte">{code}</div>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[11px]">{txt(s, 'pays')}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(s, 'nb_references') ?? 0)}
                      </td>
                      {voitMontant && (
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <Barre part={(nb(s, 'montant_total_mad') ?? 0) / maxMontant} />
                            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums">
                              {fmt.compact(nb(s, 'montant_total_mad'))}
                            </span>
                          </div>
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(s, 'delai_reel_moyen_jours') == null
                          ? '—'
                          : `${fmt.nombre(nb(s, 'delai_reel_moyen_jours')!, 0)} j`}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(s, 'taux_ponctualite_pct') == null
                          ? '—'
                          : `${fmt.nombre(nb(s, 'taux_ponctualite_pct')!, 0)} %`}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(s, 'taux_conformite_pct') == null
                          ? '—'
                          : `${fmt.nombre(nb(s, 'taux_conformite_pct')!, 0)} %`}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {otif == null ? (
                          <span className="text-attenue-texte">—</span>
                        ) : (
                          <span
                            className={cn(
                              'font-medium tabular-nums',
                              otif >= 95 ? 'text-succes' : otif >= 80 ? 'text-alerte' : 'text-danger',
                            )}
                          >
                            {fmt.nombre(otif, 0)} %
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(s, 'note_globale') == null ? '—' : fmt.nombre(nb(s, 'note_globale')!, 0)}
                      </td>
                      <td className="px-2 py-1.5">
                        {cls && (
                          <Badge
                            ton={
                              cls === 'STRATEGIQUE'
                                ? 'succes'
                                : cls === 'A_SURVEILLER'
                                  ? 'danger'
                                  : 'neutre'
                            }
                          >
                            {cls.replace(/_/g, ' ').toLowerCase()}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CarteCorps>
      </Carte>

      {choisi && (
        <Carte>
          <CarteEntete>
            <CarteTitre>Tendance mensuelle — {choisi}</CarteTitre>
          </CarteEntete>
          <CarteCorps className="p-0">
            {serie.length === 0 ? (
              <p className="p-4 text-[13px] text-attenue-texte">
                Aucune reception validee pour ce fournisseur.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                    <th className="px-3 py-2 text-left">Mois</th>
                    <th className="w-24 px-2 py-2 text-right">Receptions</th>
                    <th className="w-28 px-2 py-2 text-right">Quantite</th>
                    {a(serie, 'montant_mad') && (
                      <th className="w-32 px-2 py-2 text-right">Montant</th>
                    )}
                    <th className="w-28 px-2 py-2 text-right">Conforme</th>
                    <th className="w-32 px-2 py-2 text-right">A l'heure</th>
                    <th className="w-28 px-2 py-2 text-right">Retard moyen</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((m, i) => (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="px-3 py-1.5 tabular-nums">{txt(m, 'annee_mois')}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(m, 'nb_receptions') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(m, 'quantite_kg') ?? 0, 0)} kg
                      </td>
                      {a(serie, 'montant_mad') && (
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt.compact(nb(m, 'montant_mad'))}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(m, 'taux_conformite_pct') ?? 0, 0)} %
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(m, 'nb_mesurables') === 0 ? (
                          <span className="text-attenue-texte">non mesurable</span>
                        ) : (
                          `${nb(m, 'nb_a_lheure')} / ${nb(m, 'nb_mesurables')}`
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(m, 'retard_moyen_jours') == null
                          ? '—'
                          : `${fmt.nombre(nb(m, 'retard_moyen_jours')!, 1)} j`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CarteCorps>
        </Carte>
      )}
    </div>
  )
}

/* ========================================================================== */
/* Qualites                                                                    */
/* ========================================================================== */

function VoletQualites({ d }: { d: Record<string, Ligne[]> }) {
  const qualites = d.qualites ?? []
  const roles = d.roles ?? []
  const voitCout = a(qualites, 'cout_matiere_m2_mad')

  const [choisie, setChoisie] = useState<string | null>(null)
  const ventilation = useMemo(
    () => roles.filter((r) => txt(r, 'code_qualite') === choisie),
    [roles, choisie],
  )

  const actives = qualites.filter((q) => txt(q, 'statut') === 'ACTIF')
  const sansCmup = qualites.filter((q) => (nb(q, 'nb_sans_cmup') ?? 0) > 0)
  const ecartees = qualites.filter((q) => Math.abs(nb(q, 'ecart_poids_pct') ?? 0) > 1)
  const maxCout = Math.max(...qualites.map((q) => nb(q, 'cout_matiere_m2_mad') ?? 0), 1)
  const maxRole = Math.max(...ventilation.map((r) => nb(r, 'cout_m2_mad') ?? 0), 1)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Chiffre libelle="Qualites" valeur={String(qualites.length)} detail={`${actives.length} actives`} />
        <Chiffre
          libelle="Cout matiere moyen"
          valeur={
            voitCout && actives.length
              ? `${fmt.nombre(
                  actives.reduce((s, q) => s + (nb(q, 'cout_matiere_m2_mad') ?? 0), 0) /
                    actives.length,
                  2,
                )} MAD/m2`
              : '—'
          }
        />
        <Chiffre
          libelle="Cout incomplet"
          valeur={String(sansCmup.length)}
          detail="composants sans CMUP"
          ton={sansCmup.length > 0 ? 'alerte' : 'succes'}
        />
        <Chiffre
          libelle="Recette hors fiche"
          valeur={String(ecartees.length)}
          detail="ecart de poids > 1 %"
          ton={ecartees.length > 0 ? 'alerte' : 'succes'}
        />
      </div>

      {sansCmup.length > 0 && (
        <Alerte ton="alerte" titre="Cout matiere incomplet">
          {sansCmup.length} qualite(s) contiennent des composants sans CMUP — une matiere jamais
          entree en stock n'a pas de prix moyen. Leur part manque au cout affiche, qui est donc
          <strong> sous-estime</strong>. Le nombre de composants concernes est indique par ligne.
        </Alerte>
      )}

      <Carte>
        <CarteEntete>
          <CarteTitre>Cout et production par qualite</CarteTitre>
        </CarteEntete>
        <CarteCorps className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Qualite</th>
                  <th className="w-24 px-2 py-2 text-left">Statut</th>
                  <th className="w-20 px-2 py-2 text-right">Roles</th>
                  <th className="w-24 px-2 py-2 text-right">Matieres</th>
                  <th className="w-28 px-2 py-2 text-right">kg/m2</th>
                  <th className="w-24 px-2 py-2 text-right">Ecart fiche</th>
                  {voitCout && <th className="w-28 px-2 py-2 text-right">Cout/m2</th>}
                  {voitCout && <th className="w-36 px-3 py-2 text-left">Poids relatif</th>}
                  <th className="w-28 px-2 py-2 text-right">m2 prevus</th>
                  <th className="w-24 px-2 py-2 text-right">Realise</th>
                </tr>
              </thead>
              <tbody>
                {qualites.map((q, i) => {
                  const code = txt(q, 'code_qualite')!
                  const ecart = nb(q, 'ecart_poids_pct')
                  const manque = nb(q, 'nb_sans_cmup') ?? 0
                  return (
                    <tr
                      key={i}
                      onClick={() => setChoisie(choisie === code ? null : code)}
                      className={cn(
                        'cursor-pointer border-b border-bordure/60',
                        choisie === code && 'bg-primaire/5',
                      )}
                    >
                      <td className="max-w-56 px-3 py-1.5">
                        <div className="truncate font-medium">{code}</div>
                        <div className="truncate text-[11px] text-attenue-texte">
                          {txt(q, 'qualite_nom')}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge ton={txt(q, 'statut') === 'ACTIF' ? 'succes' : 'neutre'}>
                          {txt(q, 'statut')}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(q, 'nb_roles') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="tabular-nums">{fmt.entier(nb(q, 'nb_composants') ?? 0)}</span>
                        {manque > 0 && (
                          <Infobulle contenu={`${manque} composant(s) sans CMUP : le cout est sous-estime`}>
                            <span className="ml-1 text-[11px] text-alerte">({manque})</span>
                          </Infobulle>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(q, 'kg_m2_total') ?? 0, 3)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {ecart == null ? (
                          <span className="text-attenue-texte">—</span>
                        ) : (
                          <span
                            className={cn(
                              'tabular-nums',
                              Math.abs(ecart) > 1 && 'font-medium text-alerte',
                            )}
                          >
                            {ecart > 0 ? '+' : ''}
                            {fmt.nombre(ecart, 1)} %
                          </span>
                        )}
                      </td>
                      {voitCout && (
                        <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                          {nb(q, 'cout_matiere_m2_mad') == null
                            ? '—'
                            : fmt.nombre(nb(q, 'cout_matiere_m2_mad')!, 2)}
                        </td>
                      )}
                      {voitCout && (
                        <td className="px-3 py-1.5">
                          <Barre part={(nb(q, 'cout_matiere_m2_mad') ?? 0) / maxCout} />
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.compact(nb(q, 'm2_prevus'))}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {nb(q, 'taux_realisation_pct') == null
                          ? '—'
                          : `${fmt.nombre(nb(q, 'taux_realisation_pct')!, 0)} %`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CarteCorps>
      </Carte>

      {choisie && (
        <Carte>
          <CarteEntete>
            <CarteTitre>Ventilation par role — {choisie}</CarteTitre>
            <span className="text-[11px] text-attenue-texte">
              c'est ici qu'une decision se prend : on ne change pas « la recette », on change le
              melange d'un role
            </span>
          </CarteEntete>
          <CarteCorps className="p-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-bordure text-[11px] uppercase tracking-wider text-attenue-texte">
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="w-24 px-2 py-2 text-right">Matieres</th>
                  <th className="w-24 px-2 py-2 text-right">Somme %</th>
                  <th className="w-28 px-2 py-2 text-right">kg/m2</th>
                  {voitCout && <th className="w-28 px-2 py-2 text-right">Cout/m2</th>}
                  {voitCout && <th className="w-40 px-3 py-2 text-left">Part du cout</th>}
                </tr>
              </thead>
              <tbody>
                {ventilation.map((r, i) => {
                  const somme = nb(r, 'somme_pct') ?? 0
                  return (
                    <tr key={i} className="border-b border-bordure/60">
                      <td className="px-3 py-1.5">{txt(r, 'role_libelle')}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.entier(nb(r, 'nb_composants') ?? 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span
                          className={cn(
                            'tabular-nums',
                            Math.abs(somme - 100) > 0.01 && 'font-medium text-danger',
                          )}
                        >
                          {fmt.nombre(somme, 1)} %
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.nombre(nb(r, 'kg_m2') ?? 0, 4)}
                      </td>
                      {voitCout && (
                        <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                          {fmt.nombre(nb(r, 'cout_m2_mad') ?? 0, 2)}
                        </td>
                      )}
                      {voitCout && (
                        <td className="px-3 py-1.5">
                          <Barre part={(nb(r, 'cout_m2_mad') ?? 0) / maxRole} />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t border-bordure px-3 py-2 text-[11px] text-attenue-texte">
              La somme des pourcentages d'un role doit valoir 100 % (regle R07). Toute autre valeur
              signale une composition incomplete.
            </p>
          </CarteCorps>
        </Carte>
      )}
    </div>
  )
}

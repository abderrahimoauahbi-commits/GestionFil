/**
 * LES LOTS — trois vues de stock et quatre listes d'alerte.
 *
 * Le cahier « Gestion des lots » (02/10/2026) en fixe la lecture :
 *
 *   Comptable  tout lot qui porte du stock, quel que soit son etat ;
 *   Projet     les lots libres et actifs qui comptent pour le plan d'achat ;
 *   Restes     les lots libres et actifs passes sous le seuil de l'article.
 *
 * Les bloques et les dormants ne se lisent qu'en Comptable — et dans leurs
 * onglets d'alerte, ou l'on vient les traiter. Projet + Restes + bloques +
 * dormants refait donc la vue comptable : rien ne se perd entre deux vues.
 *
 * POURQUOI UN TABLEAU A LA MAIN ET NON `DataTable`. `DataTable` n'affiche une
 * colonne que si son champ est declare dans `champ_configurable` ; un champ non
 * declare vaut MASQUE pour tout le monde. Origine, categorie, solde, seuil,
 * derive… sont neufs et ne le sont pas encore : ils auraient disparu. Le seul
 * champ sensible de l'ecran — la valeur — suit la grille de droits ici aussi,
 * et le serveur la retire de toute facon a qui ne doit pas la voir. Meme choix
 * que l'etat des stocks.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowDownToLine, ArrowUp, BadgeCheck, Printer, Search, TriangleAlert, X } from 'lucide-react'

import { api } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { TableauImprimable } from '../../composants/Etat'
import { Bouton, Champ, EtatVide, Selecteur, Squelette } from '../../composants/ui/base'
import { Onglet, Onglets, OngletsListe, useConfirmation } from '../../composants/ui/surcouches'
import { libelleLot } from '../../lib/lots'
import { cn } from '../../lib/utils'
import { ActionsLot, BadgeCategorie, BadgeStatut } from './commun'
import { MODULE, ORIGINES, classeDerive, designationUtile, gereAuKilo, libelleSeuil, lienFiche, messageErreur, nb, signe, useApresDecision, type Compteurs, type Lot } from './modele'

type Vue = 'comptable' | 'projet' | 'restes' | 'a_basculer' | 'dormants' | 'bloques' | 'derive'

const VUES: { id: Vue; libelle: string; alerte?: boolean; explication: string }[] = [
  { id: 'comptable', libelle: 'Comptable', explication: 'Tout le stock, lot par lot — bloqués et dormants compris.' },
  { id: 'projet', libelle: 'Projet', explication: 'Les lots libres et actifs qui comptent pour le plan d’achat.' },
  { id: 'restes', libelle: 'Restes', explication: 'Les lots libres passés sous le seuil de leur article : utilisables, mais hors plan d’achat.' },
  {
    id: 'a_basculer',
    libelle: 'À basculer',
    alerte: true,
    explication:
      'Ces lots Projet sont passés sous le seuil de leur article. Le basculement en Restes est manuel mais obligatoire : tant qu’il n’est pas fait, le plan d’achat les compte encore.',
  },
  {
    id: 'dormants',
    libelle: 'Dormants',
    alerte: true,
    explication: 'Aucune entrée, sortie ni constat depuis plus d’un an. Décidez : garder, solder ou détruire.',
  },
  {
    id: 'bloques',
    libelle: 'Bloqués',
    alerte: true,
    explication: 'Bloqués par la qualité : ils ne peuvent plus bouger tant qu’un responsable ne les a pas débloqués.',
  },
  {
    id: 'derive',
    libelle: 'Dérive de poids',
    alerte: true,
    explication: 'Le poids réel s’écarte du poids catalogue au-delà de la tolérance orange, sur toute la vie du lot.',
  },
]

const estVue = (v: string | null): v is Vue => VUES.some((x) => x.id === v)

type CleTri = 'article' | 'lot' | 'fournisseur' | 'solde' | 'bobines' | 'seuil' | 'jours' | 'derive' | 'valeur'

const valeurTri: Record<CleTri, (l: Lot) => string | number | null> = {
  article: (l) => l.code_reference,
  lot: (l) => l.lot_fournisseur,
  fournisseur: (l) => l.fournisseur_nom ?? l.code_fournisseur,
  solde: (l) => l.solde_kg,
  bobines: (l) => l.solde_bobines,
  seuil: (l) => l.seuil_restes_kg,
  jours: (l) => l.jours_sans_activite,
  derive: (l) => (l.ecart_cumule_pct == null ? null : Math.abs(l.ecart_cumule_pct)),
  valeur: (l) => l.valeur_mad ?? null,
}

const PAS = 200

export function Lots() {
  const navigate = useNavigate()
  const { peut } = useAuth()
  const droits = useDroits(MODULE)
  const voitValeur = droits.visible('valeur_mad')
  const apres = useApresDecision()
  const confirmation = useConfirmation()

  const [recherche, setRecherche] = useState('')
  const [fournisseur, setFournisseur] = useState('')
  const [soldes, setSoldes] = useState(false)
  const [tri, setTri] = useState<{ cle: CleTri; sens: 1 | -1 } | null>(null)
  const [visibles, setVisibles] = useState(PAS)
  const [toutEnCours, setToutEnCours] = useState(false)

  /* LA VUE EST DANS L'ADRESSE : le tableau de bord peut ouvrir directement
     « Dormants » ou « À basculer », et le retour depuis une fiche y revient. */
  const [params, setParams] = useSearchParams()
  const vue: Vue = estVue(params.get('vue')) ? (params.get('vue') as Vue) : 'comptable'
  const choisirVue = (v: string) => {
    setParams(v === 'comptable' ? {} : { vue: v }, { replace: true })
    setVisibles(PAS)
  }

  const qCompteurs = useQuery({
    queryKey: ['lots', 'compteurs'],
    queryFn: ({ signal }) => api.get<Compteurs>('/api/lots/compteurs', { signal }),
  })
  const avecSoldes = vue === 'comptable' && soldes
  const q = useQuery({
    queryKey: ['lots', 'liste', vue, avecSoldes],
    queryFn: ({ signal }) => api.get<Lot[]>(`/api/lots?vue=${vue}${avecSoldes ? '&tous=1' : ''}`, { signal }),
  })

  const lignes = useMemo(() => q.data ?? [], [q.data])

  /* LES FOURNISSEURS PROPOSES SORTENT DES LIGNES RECUES : offrir un
     fournisseur que personne ne porte dans cette vue ne peut que vider le
     tableau. */
  const fournisseurs = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of lignes) if (l.code_fournisseur) m.set(l.code_fournisseur, l.fournisseur_nom ?? l.code_fournisseur)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [lignes])

  const filtrees = useMemo(() => {
    const motif = recherche.trim().toLowerCase()
    let r = lignes.filter(
      (l) =>
        (!fournisseur || l.code_fournisseur === fournisseur) &&
        (!motif ||
          l.code_reference.toLowerCase().includes(motif) ||
          (l.designation ?? '').toLowerCase().includes(motif) ||
          l.lot_fournisseur.toLowerCase().includes(motif) ||
          libelleLot(l.lot_fournisseur).toLowerCase().includes(motif)),
    )
    if (tri) {
      const f = valeurTri[tri.cle]
      r = [...r].sort((a, b) => {
        const x = f(a)
        const y = f(b)
        if (x == null && y == null) return 0
        if (x == null) return 1
        if (y == null) return -1
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * tri.sens
      })
    }
    return r
  }, [lignes, recherche, fournisseur, tri])

  const compteurs = qCompteurs.data
  const definition = VUES.find((v) => v.id === vue)!

  /* « TOUT BASCULER » : un lot apres l'autre, pour qu'un refus sur l'un
     n'emporte pas les autres et se dise avec son numero. */
  const toutBasculer = async (cibles: Lot[]) => {
    setToutEnCours(true)
    let faits = 0
    const refus: string[] = []
    for (const l of cibles) {
      try {
        await api.post('/api/lots/basculer', {
          code_reference: l.code_reference,
          lot_fournisseur: l.lot_fournisseur,
          categorie: 'RESTES',
        })
        faits++
      } catch (e) {
        refus.push(`${libelleLot(l.lot_fournisseur)} : ${messageErreur(e)}`)
      }
    }
    await apres()
    setToutEnCours(false)
    if (faits) toast.success(`${faits} lot(s) passé(s) en Restes`)
    if (refus.length) toast.error(`${refus.length} lot(s) non basculé(s)`, { description: refus.slice(0, 5).join(' · ') })
  }

  const entete = (cle: CleTri | null, libelle: string, numerique = false) => (
    <th className={cn('whitespace-nowrap px-2 py-1.5 font-medium', numerique ? 'text-right' : 'text-left')}>
      {cle ? (
        <button
          type="button"
          className={cn('inline-flex items-center gap-0.5 uppercase hover:text-texte', numerique && 'flex-row-reverse')}
          onClick={() =>
            setTri((t) => (t?.cle !== cle ? { cle, sens: numerique ? -1 : 1 } : t.sens === (numerique ? -1 : 1) ? { cle, sens: numerique ? 1 : -1 } : null))
          }
        >
          {libelle}
          {tri?.cle === cle && (tri.sens === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : (
        libelle
      )}
    </th>
  )

  const peutBasculer = peut(MODULE, 'ECRIRE')

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre="Lots"
        description="Le stock lot par lot : ce qui compte pour le plan d’achat, ce qui n’est plus qu’un reste, et ce qui attend une décision."
        actions={
          <>
            <Bouton variante="contour" onClick={() => navigate('/autorisations')}>
              <BadgeCheck />
              Autorisations
              {(compteurs?.autorisations ?? 0) > 0 && (
                <span className="rounded-full bg-alerte/15 px-1.5 text-[11px] font-semibold tabular-nums text-alerte">
                  {compteurs?.autorisations}
                </span>
              )}
            </Bouton>
            <Bouton variante="contour" onClick={() => window.print()} disabled={!filtrees.length}>
              <Printer />
              Imprimer
            </Bouton>
          </>
        }
      />

      <div className="sans-impression flex flex-col gap-3">
        <Onglets value={vue} onValueChange={choisirVue}>
          <OngletsListe className="h-auto max-w-full flex-wrap">
            {VUES.map((v, i) => {
              const n = compteurs?.[v.id]
              return (
                <span key={v.id} className="contents">
                  {i === 3 && <span className="mx-1 h-5 w-px bg-bordure" aria-hidden />}
                  <Onglet value={v.id}>
                    {v.libelle}
                    <span
                      className={cn(
                        'text-[11px] tabular-nums',
                        v.alerte && (n ?? 0) > 0
                          ? v.id === 'bloques'
                            ? 'font-semibold text-danger'
                            : 'font-semibold text-alerte'
                          : 'text-attenue-texte',
                      )}
                    >
                      {n ?? '…'}
                    </span>
                  </Onglet>
                </span>
              )
            })}
          </OngletsListe>
        </Onglets>

        <p className={cn('text-[12.5px]', definition.alerte ? 'text-texte' : 'text-attenue-texte')}>
          {definition.alerte && <TriangleAlert className="mr-1 inline size-3.5 align-[-2px] text-alerte" />}
          {definition.explication}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-attenue-texte" />
            <Champ
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Article, désignation ou numéro de lot"
              className="pl-7"
            />
            {recherche && (
              <button
                type="button"
                aria-label="Effacer"
                onClick={() => setRecherche('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-attenue-texte hover:text-texte"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Selecteur
            value={fournisseur}
            onChange={(e) => setFournisseur(e.target.value)}
            className="w-full sm:w-60"
            aria-label="Fournisseur"
          >
            <option value="">Tous les fournisseurs</option>
            {fournisseurs.map(([code, nom]) => (
              <option key={code} value={code}>
                {nom}
              </option>
            ))}
          </Selecteur>
          {vue === 'comptable' && (
            <label className="inline-flex items-center gap-1.5 text-[12.5px] text-attenue-texte">
              <input type="checkbox" checked={soldes} onChange={(e) => setSoldes(e.target.checked)} />
              Montrer aussi les lots soldés
            </label>
          )}
          {vue === 'a_basculer' && peutBasculer && filtrees.length > 0 && (
            <Bouton
              className="sm:ml-auto"
              chargement={toutEnCours}
              onClick={() =>
                confirmation.demander({
                  titre: `Basculer ${filtrees.length} lot(s) en Restes ?`,
                  description:
                    'Tous les lots affichés passent en Restes : ils restent en stock et utilisables, mais ne comptent plus pour le plan d’achat. Chaque basculement est inscrit sur la fiche du lot.',
                  libelleConfirmer: 'Tout basculer',
                  action: () => void toutBasculer(filtrees),
                })
              }
            >
              <ArrowDownToLine />
              Tout basculer ({filtrees.length})
            </Bouton>
          )}
        </div>

        {q.isLoading ? (
          <Squelette className="h-64 w-full" />
        ) : q.error ? (
          <EtatVide
            icone={TriangleAlert}
            titre="La liste des lots n’a pas pu être chargée"
            description={`${messageErreur(q.error)} Rechargez la page ; si l’erreur revient, signalez-la.`}
          />
        ) : !filtrees.length ? (
          <EtatVide
            titre={lignes.length ? 'Aucun lot ne correspond au filtre' : definition.alerte ? 'Rien à traiter' : 'Aucun lot'}
            description={
              lignes.length
                ? 'Changez l’article ou le fournisseur recherché.'
                : definition.alerte
                  ? 'Aucun lot n’est dans cette situation aujourd’hui.'
                  : 'Aucun lot ne porte de stock dans cette vue.'
            }
          />
        ) : (
          <div
            className="overflow-auto rounded-[var(--radius)] border border-bordure bg-surface"
            style={{ maxHeight: 'calc(100dvh - 20rem)' }}
          >
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-attenue text-[10px] uppercase tracking-wide text-attenue-texte">
                  {entete('article', 'Article')}
                  {entete('lot', 'Lot')}
                  {entete(null, 'Origine')}
                  {entete('fournisseur', 'Fournisseur')}
                  {entete(null, 'Catégorie')}
                  {entete(null, 'Statut')}
                  {entete('solde', 'Solde kg', true)}
                  {entete('bobines', 'Bobines', true)}
                  {entete('seuil', 'Min. pour produire', true)}
                  {entete('jours', 'Sans activité', true)}
                  {entete('derive', 'Dérive', true)}
                  {voitValeur && entete('valeur', 'Valeur MAD', true)}
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {filtrees.slice(0, visibles).map((l) => (
                  <tr
                    key={`${l.code_reference}|${l.lot_fournisseur}`}
                    className="cursor-pointer border-t border-bordure hover:bg-attenue/50"
                    onClick={() => navigate(lienFiche(l.code_reference, l.lot_fournisseur))}
                  >
                    <td className="max-w-[18rem] px-2 py-1.5">
                      <div className="font-mono text-[11.5px] font-medium text-texte">{l.code_reference}</div>
                      {designationUtile(l) && (
                        <div className="truncate text-[10.5px] text-attenue-texte">{designationUtile(l)}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="font-mono text-primaire">{libelleLot(l.lot_fournisseur)}</span>
                      {l.fusionne_dans && (
                        <div className="text-[10px] text-attenue-texte">fusionné dans {libelleLot(l.fusionne_dans)}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-attenue-texte">{ORIGINES[l.origine] ?? l.origine}</td>
                    <td className="max-w-[12rem] truncate px-2 py-1.5">{l.fournisseur_nom ?? l.code_fournisseur ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <BadgeCategorie categorie={l.categorie} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="inline-flex flex-wrap gap-1">
                        <BadgeStatut statut={l.statut} />
                        {l.dormant && <span className="text-[10.5px] font-medium text-alerte">dormant</span>}
                        {l.a_basculer && <span className="text-[10.5px] font-medium text-alerte">sous le seuil</span>}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-texte">{nb(l.solde_kg, 1)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {gereAuKilo(l) ? <span className="text-attenue-texte" title="Article géré au kilo">—</span> : nb(l.solde_bobines)}
                    </td>
                    <td className={cn('px-2 py-1.5 text-right', l.a_basculer ? 'text-alerte' : 'text-attenue-texte')}>
                      {libelleSeuil(l)}
                    </td>
                    <td className={cn('px-2 py-1.5 text-right', l.dormant ? 'font-semibold text-alerte' : 'text-attenue-texte')}>
                      {l.jours_sans_activite == null ? '—' : `${nb(l.jours_sans_activite)} j`}
                    </td>
                    <td
                      className={cn('px-2 py-1.5 text-right', classeDerive(l.alerte_derive))}
                      title={l.ecart_cumule_kg != null ? `${signe(l.ecart_cumule_kg, 1, ' kg')} sur la vie du lot` : 'Aucune pesée comparable'}
                    >
                      {signe(l.ecart_cumule_pct, 2, ' %')}
                    </td>
                    {voitValeur && <td className="px-2 py-1.5 text-right">{nb(l.valeur_mad)}</td>}
                    <td className="px-2 py-1.5">
                      <ActionsLot lot={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtrees.length > visibles && (
              <div className="flex items-center justify-center gap-2 border-t border-bordure p-2 text-[12px] text-attenue-texte">
                {visibles} lots affichés sur {filtrees.length}
                <Bouton variante="contour" taille="sm" onClick={() => setVisibles((v) => v + PAS)}>
                  Afficher {Math.min(PAS, filtrees.length - visibles)} de plus
                </Bouton>
              </div>
            )}
          </div>
        )}
      </div>

      {/* L'ETAT PAPIER : la vue regardee, filtres et tri compris. */}
      <TableauImprimable<Lot>
        titre={`Lots — vue ${definition.libelle}`}
        resume={`${filtrees.length} lot(s) · ${nb(
          filtrees.reduce((s, l) => s + (l.solde_kg ?? 0), 0),
          1,
        )} kg${fournisseur ? ` · fournisseur ${fournisseurs.find(([c]) => c === fournisseur)?.[1] ?? fournisseur}` : ''}${
          recherche.trim() ? ` · recherche « ${recherche.trim()} »` : ''
        }`}
        lignes={filtrees}
        colonnes={[
          { entete: 'Article', valeur: (l) => l.code_reference },
          { entete: 'Désignation', valeur: (l) => l.designation ?? '—' },
          { entete: 'Lot', valeur: (l) => libelleLot(l.lot_fournisseur) },
          { entete: 'Fournisseur', valeur: (l) => l.fournisseur_nom ?? '—' },
          { entete: 'Catég.', valeur: (l) => (l.categorie === 'RESTES' ? 'Restes' : 'Projet') },
          {
            entete: 'Statut',
            valeur: (l) => `${l.statut === 'BLOQUE' ? 'Bloqué' : l.statut === 'SOLDE' ? 'Soldé' : 'Libre'}${l.dormant ? ' · dormant' : ''}`,
          },
          { entete: 'Solde kg', numerique: true, valeur: (l) => nb(l.solde_kg, 1) },
          { entete: 'Bobines', numerique: true, valeur: (l) => (gereAuKilo(l) ? '—' : nb(l.solde_bobines)) },
          { entete: 'Min. pour produire', numerique: true, valeur: (l) => libelleSeuil(l) },
          { entete: 'Jours', numerique: true, valeur: (l) => nb(l.jours_sans_activite) },
          { entete: 'Dérive', numerique: true, valeur: (l) => signe(l.ecart_cumule_pct, 2, ' %') },
          ...(voitValeur ? [{ entete: 'Valeur MAD', numerique: true, valeur: (l: Lot) => nb(l.valeur_mad) }] : []),
        ]}
      />
      {confirmation.element}
    </div>
  )
}

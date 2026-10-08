/**
 * LA FICHE DE VIE D'UN LOT — `/lots/fiche?reference=…&lot=…`.
 *
 * Tout ce qu'on doit savoir d'un lot, sur un ecran : qui il est, ce qu'il
 * reste et ou, ce qui cloche (bloque, dormant, sous le seuil, derive de
 * poids), et TOUT ce qui lui est arrive, dans l'ordre — mouvements, decisions
 * motivees, autorisations. Rien ne s'efface : une decision se lit ici avec son
 * motif et son auteur, des annees plus tard.
 *
 * LA FUSION se prepare DANS la page, pas dans une fenetre : on choisit le
 * magasin, on coche les lots du meme article a verser dans celui-ci, on dit
 * pourquoi. Seule la confirmation finale est courte.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDownToLine, ArrowLeft, Combine, Printer, TriangleAlert } from 'lucide-react'

import { api } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { EnTetePage } from '../../composants/Coquille'
import { TableauImprimable } from '../../composants/Etat'
import { Alerte, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Chargement, EtatVide, Etiq, Selecteur } from '../../composants/ui/base'
import { useConfirmation } from '../../composants/ui/surcouches'
import { couleurEcart, libelleLot, useTolerancesLot } from '../../lib/lots'
import { cn, fmt } from '../../lib/utils'
import { ActionsLot, BadgeCategorie, BadgeStatut, LienLot } from './commun'
import {
  EVENEMENTS,
  MODULE,
  ORIGINES,
  TYPES_DEMANDE,
  classeDerive,
  classeEcart,
  designationUtile,
  gereAuKilo,
  libelleSeuil,
  messageErreur,
  nb,
  signe,
  useApresDecision,
  useBasculerRestes,
  type Lot,
} from './modele'

interface LieuMagasin {
  code_magasin: string
  magasin_nom: string | null
  quantite_kg: number | null
  nb_bobines: number | null
  code_couleur: string | null
}

interface LieuMachine {
  code_emplacement: string
  zone: string | null
  code_machine: string | null
  nb_bobines: number | null
  kg: number | null
}

interface Evenement {
  date_evenement: string
  nature: 'MOUVEMENT' | 'DECISION' | 'AUTORISATION'
  evenement: string | null
  document: string | null
  document_origine: string | null
  lieu: string | null
  kg: number | null
  nb_bobines: number | null
  theorique_kg: number | null
  ecart_kg: number | null
  ecart_pct: number | null
  utilisateur: string | null
  motif: string | null
}

interface Vie {
  lot: Lot
  magasins: LieuMagasin[]
  machines: LieuMachine[]
  evenements: Evenement[]
}

/** Une ligne de `/api/stock/lots` : le stock d'un lot dans un magasin. */
interface StockLot {
  lot_fournisseur: string
  code_couleur: string | null
  quantite_kg: number | null
  nb_bobines: number | null
}

const NATURES: Record<string, string> = { MOUVEMENT: 'Mouvement', DECISION: 'Décision', AUTORISATION: 'Autorisation' }

/** Le libelle d'un evenement : les codes du serveur deviennent des mots. */
function libelleEvenement(e: Evenement) {
  const brut = e.evenement ?? '—'
  if (e.nature === 'DECISION') return EVENEMENTS[brut] ?? brut
  if (e.nature === 'AUTORISATION') {
    const [type, ...reste] = brut.split(' ')
    return `Demande : ${TYPES_DEMANDE[type] ?? type} ${reste.join(' ')}`
      .replace('EN_ATTENTE', 'en attente')
      .replace('ACCORDEE', 'accordée')
      .replace('REFUSEE', 'refusée')
      .replace('ANNULEE', 'annulée')
  }
  return brut
}

function Info({ libelle, children, className }: { libelle: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-attenue-texte">{libelle}</div>
      <div className="mt-0.5 text-[13px] text-texte">{children}</div>
    </div>
  )
}

export function FicheLot() {
  const [params] = useSearchParams()
  const reference = params.get('reference') ?? ''
  const numero = params.get('lot') ?? ''
  const tolerances = useTolerancesLot()
  const droits = useDroits(MODULE)
  const voitValeur = droits.visible('valeur_mad')
  const basculer = useBasculerRestes()
  const { peut } = useAuth()

  const q = useQuery({
    queryKey: ['lots', 'vie', reference, numero],
    queryFn: () =>
      api.get<Vie>(`/api/lots/vie?reference=${encodeURIComponent(reference)}&lot=${encodeURIComponent(numero)}`),
    enabled: !!reference && !!numero,
  })

  if (!reference || !numero) {
    return (
      <EtatVide
        titre="Aucun lot désigné"
        description="Ouvrez une fiche depuis la liste des lots."
        action={
          <Bouton asChild variante="contour">
            <Link to="/lots">Voir les lots</Link>
          </Bouton>
        }
      />
    )
  }
  if (q.isLoading) return <Chargement texte="Lecture de la fiche du lot…" />
  if (q.error || !q.data?.lot) {
    return (
      <EtatVide
        icone={TriangleAlert}
        titre="La fiche du lot n’a pas pu être lue"
        description={q.error ? messageErreur(q.error) : 'Lot introuvable.'}
        action={
          <Bouton asChild variante="contour">
            <Link to="/lots">Retour aux lots</Link>
          </Bouton>
        }
      />
    )
  }

  const { lot, magasins, machines, evenements } = q.data
  const peutBasculer = peut(MODULE, 'ECRIRE')
  const auKilo = gereAuKilo(lot)
  const ecartPoids =
    lot.poids_reel_moyen_bobine_kg != null && lot.poids_catalogue_bobine_kg
      ? ((lot.poids_reel_moyen_bobine_kg - lot.poids_catalogue_bobine_kg) / lot.poids_catalogue_bobine_kg) * 100
      : null
  const dernierBlocage = [...evenements].reverse().find((e) => e.nature === 'DECISION' && e.evenement === 'BLOCAGE')
  const kgMachines = machines.reduce((s, m) => s + (m.kg ?? 0), 0)

  return (
    <div className="flex flex-col gap-3">
      <EnTetePage
        titre={`Lot ${libelleLot(lot.lot_fournisseur)}`}
        description="La fiche de vie du lot : identité, soldes par lieu et tout ce qui lui est arrivé, avec les motifs."
        actions={
          <>
            <Bouton asChild variante="contour">
              <Link to="/lots">
                <ArrowLeft />
                Lots
              </Link>
            </Bouton>
            <Bouton variante="contour" onClick={() => window.print()}>
              <Printer />
              Imprimer
            </Bouton>
          </>
        }
      />

      <div className="sans-impression flex flex-col gap-3">
        {/* ---- Ce qui demande attention ------------------------------------ */}
        {lot.statut === 'BLOQUE' && (
          <Alerte ton="danger" titre="Lot bloqué par la qualité">
            Il ne part plus en production (sortie, chargement machine, fusion) tant qu’il n’est pas
            débloqué. Il peut revenir d’une machine, aller en quarantaine ou retourner au fournisseur.
            {dernierBlocage?.motif && (
              <>
                {' '}
                Motif : « {dernierBlocage.motif} »
                {dernierBlocage.utilisateur && <> — {dernierBlocage.utilisateur}</>}, le{' '}
                {fmt.date(dernierBlocage.date_evenement)}.
              </>
            )}
          </Alerte>
        )}
        {lot.statut === 'SOLDE' && (
          <Alerte ton="info" titre="Lot soldé">
            Il ne porte plus de stock.
            {lot.fusionne_dans && (
              <>
                {' '}
                Il a été fusionné dans le lot <LienLot reference={lot.code_reference} lot={lot.fusionne_dans} />.
              </>
            )}
          </Alerte>
        )}
        {lot.statut !== 'SOLDE' && lot.fusionne_dans && (
          <Alerte ton="info">
            Une partie de ce lot a été fusionnée dans le lot{' '}
            <LienLot reference={lot.code_reference} lot={lot.fusionne_dans} />.
          </Alerte>
        )}
        {lot.dormant && (
          <Alerte ton="alerte" titre="Lot dormant">
            Aucune entrée, sortie ni constat depuis {nb(lot.jours_sans_activite)} jours. Une décision est attendue :
            garder, solder ou détruire.
          </Alerte>
        )}
        {lot.a_basculer && (
          <Alerte ton="alerte" titre="À basculer en Restes">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Le solde ({nb(lot.solde_kg, 1)} kg · {nb(lot.solde_bobines)} bob.) est passé sous le seuil de l’article ({libelleSeuil(lot, true)}).
                Tant qu’il n’est pas basculé, le plan d’achat le compte encore.
              </span>
              {peutBasculer && (
                <Bouton
                  taille="sm"
                  chargement={basculer.isPending}
                  onClick={() => basculer.mutate({ code_reference: lot.code_reference, lot_fournisseur: lot.lot_fournisseur })}
                >
                  <ArrowDownToLine />
                  Basculer en Restes
                </Bouton>
              )}
            </div>
          </Alerte>
        )}
        {(lot.alerte_derive === 'ORANGE' || lot.alerte_derive === 'ROUGE') && (
          <Alerte ton={lot.alerte_derive === 'ROUGE' ? 'danger' : 'alerte'} titre="Dérive de poids">
            Sur toute la vie du lot, le poids réel s’écarte de {signe(lot.ecart_cumule_pct, 2, ' %')} du poids catalogue (
            {signe(lot.ecart_cumule_kg, 1, ' kg')}). Vérifiez la pesée ou le poids catalogue de l’article.
          </Alerte>
        )}

        {/* ---- Identite ------------------------------------------------------ */}
        <Carte>
          <CarteEntete>
            <CarteTitre>Identité du lot</CarteTitre>
            <ActionsLot lot={lot} complet />
          </CarteEntete>
          <CarteCorps className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 md:grid-cols-4 xl:grid-cols-6">
            <Info libelle="Article" className="col-span-2">
              <span className="font-mono font-medium">{lot.code_reference}</span>
              {designationUtile(lot) && <span className="ml-1.5 text-attenue-texte">{designationUtile(lot)}</span>}
            </Info>
            <Info libelle="Numéro de lot">
              <span className="font-mono font-semibold">{libelleLot(lot.lot_fournisseur)}</span>
            </Info>
            <Info libelle="Origine">{ORIGINES[lot.origine] ?? lot.origine}</Info>
            <Info libelle="Fournisseur" className="col-span-2">
              {lot.fournisseur_nom ?? lot.code_fournisseur ?? '—'}
            </Info>
            <Info libelle="Statut">
              <BadgeStatut statut={lot.statut} />
            </Info>
            <Info libelle="Catégorie">
              <BadgeCategorie categorie={lot.categorie} />
            </Info>
            <Info libelle="Solde">
              <span className="font-semibold tabular-nums">{nb(lot.solde_kg, 1)} kg</span>
              {!auKilo && <span className="ml-1 text-attenue-texte tabular-nums">· {nb(lot.solde_bobines)} bob.</span>}
            </Info>
            <Info libelle="Minimum d’un lot pour produire">
              <span className={cn('tabular-nums', lot.a_basculer && 'font-semibold text-alerte')}>
                {libelleSeuil(lot, true)}
              </span>
            </Info>
            {auKilo ? (
              <Info libelle="Poids par bobine">
                <span className="text-attenue-texte">
                  sans objet — article géré au kilo (pas de poids de bobine au catalogue)
                </span>
              </Info>
            ) : (
            <>
            <Info libelle="Variation cumulée">
              {lot.ecart_cumule_pct == null ? (
                <span className="text-attenue-texte">pas encore pesé en bobines</span>
              ) : (
                <>
                  <span className={cn('tabular-nums', classeDerive(lot.alerte_derive))}>
                    {signe(lot.ecart_cumule_pct, 2, ' %')}
                  </span>
                  <span className="ml-1 text-attenue-texte tabular-nums">({signe(lot.ecart_cumule_kg, 1, ' kg')})</span>
                </>
              )}
            </Info>
            <Info libelle="Poids moyen d’une bobine">
              {lot.poids_reel_moyen_bobine_kg == null ? (
                <span className="text-attenue-texte">pas encore pesé</span>
              ) : (
                <span className="tabular-nums">{nb(lot.poids_reel_moyen_bobine_kg, 2)} kg réel</span>
              )}
              <span className="text-attenue-texte tabular-nums"> / {nb(lot.poids_catalogue_bobine_kg, 2)} catalogue</span>
              {ecartPoids != null && (
                <span className={cn('ml-1 tabular-nums', classeEcart(couleurEcart(ecartPoids, tolerances)))}>
                  ({signe(ecartPoids, 1, ' %')})
                </span>
              )}
            </Info>
            </>
            )}
            <Info libelle="Créé le">{fmt.date(lot.date_creation)}</Info>
            <Info libelle="Dernière activité">
              {fmt.date(lot.date_derniere_activite)}
              {lot.jours_sans_activite != null && (
                <span className={cn('ml-1', lot.dormant ? 'font-semibold text-alerte' : 'text-attenue-texte')}>
                  ({nb(lot.jours_sans_activite)} j)
                </span>
              )}
            </Info>
            {voitValeur && <Info libelle="Valeur">{fmt.mad(lot.valeur_mad)}</Info>}
          </CarteCorps>
        </Carte>

        {/* ---- Ou est le lot ------------------------------------------------- */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Carte>
            <CarteEntete>
              <CarteTitre>En magasin</CarteTitre>
            </CarteEntete>
            <CarteCorps className="p-0">
              {magasins.length ? (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue/60 text-[10px] uppercase tracking-wide text-attenue-texte">
                      <th className="px-3 py-1.5 text-left font-medium">Magasin</th>
                      <th className="px-3 py-1.5 text-left font-medium">Couleur</th>
                      <th className="px-3 py-1.5 text-right font-medium">Kg</th>
                      <th className="px-3 py-1.5 text-right font-medium">Bobines</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {magasins.map((m) => (
                      <tr key={m.code_magasin} className="border-t border-bordure">
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{m.magasin_nom ?? m.code_magasin}</span>
                          <span className="ml-1 text-[10.5px] text-attenue-texte">{m.code_magasin}</span>
                        </td>
                        <td className="px-3 py-1.5">{m.code_couleur ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{nb(m.quantite_kg, 1)}</td>
                        <td className="px-3 py-1.5 text-right">{nb(m.nb_bobines)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-3 text-[12.5px] text-attenue-texte">Aucun stock en magasin.</p>
              )}
            </CarteCorps>
          </Carte>
          <Carte>
            <CarteEntete>
              <CarteTitre>Sur machine</CarteTitre>
              {machines.length > 0 && (
                <span className="text-[11px] tabular-nums text-attenue-texte">{nb(kgMachines, 1)} kg</span>
              )}
            </CarteEntete>
            <CarteCorps className="p-0">
              {machines.length ? (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue/60 text-[10px] uppercase tracking-wide text-attenue-texte">
                      <th className="px-3 py-1.5 text-left font-medium">Machine</th>
                      <th className="px-3 py-1.5 text-left font-medium">Zone</th>
                      <th className="px-3 py-1.5 text-right font-medium">Bobines</th>
                      <th className="px-3 py-1.5 text-right font-medium">Kg</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {machines.map((m) => (
                      <tr key={m.code_emplacement} className="border-t border-bordure">
                        <td className="px-3 py-1.5 font-medium">{m.code_machine ?? '—'}</td>
                        <td className="px-3 py-1.5">{m.zone ?? m.code_emplacement}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{nb(m.nb_bobines)}</td>
                        <td className="px-3 py-1.5 text-right">{nb(m.kg, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-3 text-[12.5px] text-attenue-texte">Aucune bobine de ce lot sur une machine.</p>
              )}
            </CarteCorps>
          </Carte>
        </div>

        {/* ---- Identification : « Sans lot » ou numero genere --------------- */}
        {lot.statut === 'LIBRE' && magasins.length > 0 && peut('MOUVEMENTS', 'ECRIRE') &&
          (lot.origine === 'SANS_LOT' || lot.origine === 'GENERE') && <Identifier lot={lot} />}

        {/* ---- Fusion : seulement si la fiche article la permet ---------------- */}
        {lot.statut === 'LIBRE' && magasins.length > 0 && peut('MOUVEMENTS', 'ECRIRE') &&
          lot.fusion_autorisee !== false && <Fusion lot={lot} magasins={magasins} />}

        {/* ---- Chronologie ------------------------------------------------------ */}
        <Carte>
          <CarteEntete>
            <CarteTitre>Vie du lot</CarteTitre>
            <span className="text-[11px] text-attenue-texte">{evenements.length} événement(s), du plus ancien au plus récent</span>
          </CarteEntete>
          <CarteCorps className="p-0">
            {evenements.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-attenue/60 text-[10px] uppercase tracking-wide text-attenue-texte">
                      <th className="px-2 py-1.5 text-left font-medium">Date</th>
                      <th className="px-2 py-1.5 text-left font-medium">Événement</th>
                      <th className="px-2 py-1.5 text-left font-medium">Document</th>
                      <th className="px-2 py-1.5 text-left font-medium">Lieu</th>
                      <th className="px-2 py-1.5 text-right font-medium">Kg</th>
                      <th className="px-2 py-1.5 text-right font-medium">Bobines</th>
                      <th className="px-2 py-1.5 text-right font-medium">Théorique</th>
                      <th className="px-2 py-1.5 text-right font-medium">Écart</th>
                      <th className="px-2 py-1.5 text-left font-medium">Par</th>
                      <th className="px-2 py-1.5 text-left font-medium">Motif</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {evenements.map((e, i) => (
                      <tr
                        key={i}
                        className={cn('border-t border-bordure align-top', e.nature !== 'MOUVEMENT' && 'bg-attenue/30')}
                      >
                        <td className="whitespace-nowrap px-2 py-1.5">{fmt.date(e.date_evenement)}</td>
                        <td className="px-2 py-1.5">
                          <div className={cn(e.nature !== 'MOUVEMENT' && 'font-medium')}>{libelleEvenement(e)}</div>
                          <div className="text-[10px] uppercase tracking-wide text-attenue-texte">{NATURES[e.nature] ?? e.nature}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px]">
                          {e.document ?? '—'}
                          {e.document_origine && <div className="text-attenue-texte">{e.document_origine}</div>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{e.lieu ?? '—'}</td>
                        <td
                          className={cn(
                            'whitespace-nowrap px-2 py-1.5 text-right font-semibold',
                            (e.kg ?? 0) < 0 ? 'text-danger' : (e.kg ?? 0) > 0 ? 'text-succes' : '',
                          )}
                        >
                          {e.kg == null ? '' : signe(e.kg, 1)}
                        </td>
                        <td className="px-2 py-1.5 text-right">{e.nb_bobines ?? ''}</td>
                        <td className="px-2 py-1.5 text-right text-attenue-texte">{e.theorique_kg == null ? '' : nb(e.theorique_kg, 1)}</td>
                        <td
                          className={cn('whitespace-nowrap px-2 py-1.5 text-right', classeEcart(couleurEcart(e.ecart_pct, tolerances)))}
                          title={e.ecart_kg != null ? `${signe(e.ecart_kg, 2, ' kg')}` : undefined}
                        >
                          {e.ecart_pct == null ? '' : signe(e.ecart_pct, 2, ' %')}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{e.utilisateur ?? '—'}</td>
                        <td className="min-w-[14rem] px-2 py-1.5 text-attenue-texte">{e.motif ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-3 text-[12.5px] text-attenue-texte">Aucun événement enregistré pour ce lot.</p>
            )}
          </CarteCorps>
        </Carte>
      </div>

      {/* L'ETAT PAPIER : identite en tete, puis la vie complete du lot. */}
      <TableauImprimable<Evenement>
        titre={`Fiche du lot ${libelleLot(lot.lot_fournisseur)}`}
        resume={[
          `Article ${lot.code_reference}${designationUtile(lot) ? ` — ${designationUtile(lot)}` : ''}`,
          `Fournisseur ${lot.fournisseur_nom ?? lot.code_fournisseur ?? '—'}`,
          `Origine ${ORIGINES[lot.origine] ?? lot.origine}`,
          `Statut ${lot.statut === 'BLOQUE' ? 'bloqué' : lot.statut === 'SOLDE' ? 'soldé' : 'libre'}${lot.dormant ? ', dormant' : ''}`,
          `Catégorie ${lot.categorie === 'RESTES' ? 'Restes' : 'Projet'}`,
          `Solde ${nb(lot.solde_kg, 1)} kg / ${nb(lot.solde_bobines)} bobines (seuil ${libelleSeuil(lot, true)})`,
          `Variation cumulée ${signe(lot.ecart_cumule_pct, 2, ' %')} (${signe(lot.ecart_cumule_kg, 1, ' kg')})`,
          magasins.length
            ? `En magasin : ${magasins.map((m) => `${m.code_magasin} ${nb(m.quantite_kg, 1)} kg`).join(', ')}`
            : 'Aucun stock en magasin',
          machines.length ? `Sur machine : ${nb(kgMachines, 1)} kg` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        lignes={evenements}
        colonnes={[
          { entete: 'Date', valeur: (e) => fmt.date(e.date_evenement) },
          { entete: 'Événement', valeur: (e) => libelleEvenement(e) },
          { entete: 'Document', valeur: (e) => e.document ?? '' },
          { entete: 'Lieu', valeur: (e) => e.lieu ?? '' },
          { entete: 'Kg', numerique: true, valeur: (e) => (e.kg == null ? '' : signe(e.kg, 1)) },
          { entete: 'Bob.', numerique: true, valeur: (e) => e.nb_bobines ?? '' },
          { entete: 'Écart', numerique: true, valeur: (e) => (e.ecart_pct == null ? '' : signe(e.ecart_pct, 2, ' %')) },
          { entete: 'Par', valeur: (e) => e.utilisateur ?? '' },
          { entete: 'Motif', valeur: (e) => e.motif ?? '' },
        ]}
      />
    </div>
  )
}

// ============================================================================
// La fusion, preparee dans la page
// ============================================================================

/**
 * VERSER D'AUTRES LOTS DANS CELUI-CI (regle 7 du cahier). Au choix de
 * l'utilisateur, seulement entre lots du meme article, du meme fournisseur et
 * de la meme couleur, DANS LE MEME MAGASIN. Les lots qui ne remplissent pas
 * ces conditions restent visibles, grises, avec la raison : on comprend
 * pourquoi on ne peut pas, au lieu de chercher ou ils sont passes.
 */
/**
 * IDENTIFIER LE LOT : du stock range « Sans lot » (ou sous un numero genere)
 * recoit le numero lu plus tard sur l'etiquette du fournisseur. Le serveur le
 * fait par mouvements internes, magasin par magasin : rien n'est renomme en
 * silence, et la vie des deux lots le garde.
 */
function Identifier({ lot }: { lot: Lot }) {
  const [numero, setNumero] = useState('')
  const [, setParams] = useSearchParams()
  const apres = useApresDecision()
  const confirmation = useConfirmation()
  const cible = numero.trim()

  const identifier = useMutation({
    mutationFn: () =>
      api.post<{ lot: string; kg: number; mouvements: string[] }>('/api/lots/identifier', {
        code_reference: lot.code_reference,
        lot_source: lot.lot_fournisseur,
        lot_cible: cible,
      }),
    onSuccess: async (r) => {
      await apres()
      toast.success(`Lot identifié : ${r.lot}`, {
        description: `${nb(r.kg, 1)} kg · mouvements ${r.mouvements.join(', ')}`,
      })
      setParams({ reference: lot.code_reference, lot: r.lot })
    },
    onError: (e) => toast.error(messageErreur(e)),
  })

  return (
    <Carte>
      <CarteEntete>
        <CarteTitre>Identifier le lot</CarteTitre>
      </CarteEntete>
      <CarteCorps className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <Etiq htmlFor="lot-identifie">Numéro de lot lu sur l’étiquette du fournisseur</Etiq>
          <Champ
            id="lot-identifie"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="ex. 261548"
          />
        </div>
        <Bouton
          disabled={!cible || identifier.isPending}
          chargement={identifier.isPending}
          onClick={() =>
            confirmation.demander({
              titre: `Ranger ce stock sous le lot ${cible} ?`,
              description: `Tout le stock de ${libelleLot(lot.lot_fournisseur)} (${nb(lot.solde_kg, 1)} kg) passe sous le lot ${cible}, magasin par magasin, par mouvements internes.`,
              libelleConfirmer: 'Identifier',
              action: () => identifier.mutate(),
            })
          }
        >
          Identifier
        </Bouton>
        <p className="w-full text-[11.5px] text-attenue-texte">
          Le stock change seulement de numéro de lot : ni le magasin ni le coût moyen ne bougent.
        </p>
      </CarteCorps>
      {confirmation.element}
    </Carte>
  )
}

function Fusion({ lot, magasins }: { lot: Lot; magasins: LieuMagasin[] }) {
  const [magasin, setMagasin] = useState(magasins.length === 1 ? magasins[0].code_magasin : '')
  const [coches, setCoches] = useState<string[]>([])
  const [motif, setMotif] = useState('')
  const apres = useApresDecision()
  const confirmation = useConfirmation()

  const qStock = useQuery({
    queryKey: ['lots', 'fusion', 'stock', lot.code_reference, magasin],
    queryFn: () =>
      api.get<StockLot[]>(
        `/api/stock/lots?code_reference=${encodeURIComponent(lot.code_reference)}&code_magasin=${encodeURIComponent(magasin)}`,
      ),
    enabled: !!magasin,
  })
  const qLots = useQuery({
    queryKey: ['lots', 'fusion', 'registre', lot.code_reference],
    queryFn: () => api.get<Lot[]>(`/api/lots?vue=comptable&code_reference=${encodeURIComponent(lot.code_reference)}`),
  })

  const couleurCible = magasins.find((m) => m.code_magasin === magasin)?.code_couleur ?? null

  const candidats = useMemo(() => {
    const registre = new Map((qLots.data ?? []).map((l) => [l.lot_fournisseur, l]))
    return (qStock.data ?? [])
      .filter((s) => s.lot_fournisseur !== lot.lot_fournisseur && (s.quantite_kg ?? 0) > 0)
      .map((s) => {
        const fiche = registre.get(s.lot_fournisseur)
        let raison: string | null = null
        if (fiche && fiche.statut !== 'LIBRE') raison = fiche.statut === 'BLOQUE' ? 'Bloqué par la qualité' : 'Soldé'
        else if (fiche?.code_fournisseur && lot.code_fournisseur && fiche.code_fournisseur !== lot.code_fournisseur)
          raison = 'Autre fournisseur'
        else if (s.code_couleur && couleurCible && s.code_couleur !== couleurCible) raison = 'Autre couleur'
        return { ...s, fiche, raison }
      })
  }, [qStock.data, qLots.data, lot.lot_fournisseur, lot.code_fournisseur, couleurCible])

  const choisis = candidats.filter((c) => coches.includes(c.lot_fournisseur) && !c.raison)
  const kgChoisis = choisis.reduce((s, c) => s + (c.quantite_kg ?? 0), 0)
  const pret = !!magasin && choisis.length > 0 && motif.trim().length >= 5

  const fusionner = useMutation({
    mutationFn: () =>
      api.post<{ mouvements: string[] }>('/api/lots/fusion', {
        code_reference: lot.code_reference,
        lot_cible: lot.lot_fournisseur,
        lots_sources: choisis.map((c) => c.lot_fournisseur),
        code_magasin: magasin,
        motif: motif.trim(),
      }),
    onSuccess: async (r) => {
      await apres()
      toast.success(`${choisis.length} lot(s) fusionné(s) dans ${libelleLot(lot.lot_fournisseur)}`, {
        description: r?.mouvements?.length ? `Mouvements ${r.mouvements.join(', ')}` : undefined,
      })
      setCoches([])
      setMotif('')
    },
    onError: (e) => toast.error(messageErreur(e)),
  })

  return (
    <Carte repliable="lots.fusion" replieParDefaut>
      <CarteEntete>
        <CarteTitre>Fusionner d’autres lots dans celui-ci</CarteTitre>
      </CarteEntete>
      <CarteCorps className="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] text-attenue-texte">
          Les kilos des lots choisis passent dans le lot {libelleLot(lot.lot_fournisseur)}, dans le même magasin, par
          deux mouvements internes — sans effet sur le coût moyen. Seuls les lots libres du même article, du même
          fournisseur et de la même couleur peuvent être fusionnés.
        </p>
        <div className="max-w-xs">
          <Etiq obligatoire>Magasin</Etiq>
          <Selecteur
            value={magasin}
            onChange={(e) => {
              setMagasin(e.target.value)
              setCoches([])
            }}
          >
            <option value="">Choisir le magasin…</option>
            {magasins.map((m) => (
              <option key={m.code_magasin} value={m.code_magasin}>
                {m.magasin_nom ?? m.code_magasin} — {nb(m.quantite_kg, 1)} kg
              </option>
            ))}
          </Selecteur>
        </div>

        {magasin &&
          (qStock.isLoading || qLots.isLoading ? (
            <p className="text-[12.5px] text-attenue-texte">Recherche des lots du même article…</p>
          ) : !candidats.length ? (
            <p className="text-[12.5px] text-attenue-texte">Aucun autre lot de cet article dans ce magasin.</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-bordure">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-attenue/60 text-[10px] uppercase tracking-wide text-attenue-texte">
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-medium">Lot</th>
                    <th className="px-2 py-1.5 text-left font-medium">Fournisseur</th>
                    <th className="px-2 py-1.5 text-left font-medium">Couleur</th>
                    <th className="px-2 py-1.5 text-right font-medium">Kg</th>
                    <th className="px-2 py-1.5 text-right font-medium">Bobines</th>
                    <th className="px-2 py-1.5 text-left font-medium">Fusion</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {candidats.map((c) => (
                    <tr key={c.lot_fournisseur} className={cn('border-t border-bordure', c.raison && 'opacity-60')}>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Fusionner le lot ${libelleLot(c.lot_fournisseur)}`}
                          disabled={!!c.raison}
                          checked={coches.includes(c.lot_fournisseur)}
                          onChange={(e) =>
                            setCoches((x) =>
                              e.target.checked ? [...x, c.lot_fournisseur] : x.filter((y) => y !== c.lot_fournisseur),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <LienLot reference={lot.code_reference} lot={c.lot_fournisseur} />
                      </td>
                      <td className="px-2 py-1.5">{c.fiche?.fournisseur_nom ?? c.fiche?.code_fournisseur ?? '—'}</td>
                      <td className="px-2 py-1.5">{c.code_couleur ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{nb(c.quantite_kg, 1)}</td>
                      <td className="px-2 py-1.5 text-right">{nb(c.nb_bobines)}</td>
                      <td className={cn('px-2 py-1.5', c.raison ? 'text-danger' : 'text-succes')}>{c.raison ?? 'Possible'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {magasin && candidats.some((c) => !c.raison) && (
          <>
            <label className="flex flex-col gap-1">
              <Etiq obligatoire>Pourquoi fusionner ?</Etiq>
              <textarea
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                rows={2}
                placeholder="Ex. : restes de la même production, à regrouper pour le prochain chargement"
                className="w-full rounded-[var(--radius-sm)] border border-bordure bg-surface px-2.5 py-2 text-[13px]
                           outline-none focus:border-primaire/60"
              />
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {choisis.length > 0 && (
                <span className="text-[12.5px] text-attenue-texte">
                  {choisis.length} lot(s) · {nb(kgChoisis, 1)} kg à verser
                </span>
              )}
              <Bouton
                disabled={!pret}
                chargement={fusionner.isPending}
                onClick={() =>
                  confirmation.demander({
                    titre: `Fusionner ${choisis.length} lot(s) dans ${libelleLot(lot.lot_fournisseur)} ?`,
                    description: `${nb(kgChoisis, 1)} kg passent dans le lot ${libelleLot(lot.lot_fournisseur)} (${magasin}). Les lots vidés deviennent soldés et gardent la trace de la fusion.`,
                    libelleConfirmer: 'Fusionner',
                    action: () => fusionner.mutate(),
                  })
                }
              >
                <Combine />
                Fusionner dans ce lot
              </Bouton>
            </div>
          </>
        )}
      </CarteCorps>
      {confirmation.element}
    </Carte>
  )
}

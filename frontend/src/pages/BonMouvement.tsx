/**
 * Le bon de mouvement sur papier — entree ou sortie de magasin.
 *
 * POURQUOI IL MANQUAIT ET POURQUOI IL COMPTE. L'ERP savait enregistrer un
 * mouvement ; il ne savait pas en sortir un document. Or ce qui entre ou sort
 * d'un magasin se contresigne : le magasinier remet la marchandise, un chef
 * d'equipe ou un chauffeur la prend, et sans papier personne ne peut dire trois
 * jours plus tard qui detenait quoi. C'etait la derniere piece qui obligeait a
 * tenir un cahier a cote de l'application.
 *
 * TROIS REGLES DE FOND.
 *
 * LE DOCUMENT PORTE DEUX RESPONSABLES. Celui qui a SAISI — le compte
 * applicatif, garanti par le serveur — et celui qui a REMIS OU RECU la
 * marchandise, saisi librement. Les confondre est l'erreur classique : le
 * magasinier tape pour l'atelier, et c'est l'atelier qu'on cherche.
 *
 * IL PORTE AUSSI DEUX DATES. Celle du fait et celle de la saisie. Quand elles
 * different, l'ecart est imprime : un bon saisi trois jours apres coup n'a pas
 * la meme valeur probante, et le cacher serait un mensonge par omission.
 *
 * LES MONTANTS SUIVENT LES DROITS. Si le role ne recoit pas les prix, le bon
 * sort en quantites seules — ce qui est le cas normal pour un magasinier, et
 * suffit parfaitement a un bon de sortie.
 */
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Bouton, Chargement } from '../composants/ui/base'
import { fmt } from '../lib/utils'
import { useParamVue } from '../lib/navigation'

const MODULE = 'MOUVEMENTS'

interface EnteteMvt {
  id_mouvement: string
  numero_mouvement: string
  date_mouvement: string
  date_creation?: string
  jours_de_retard_saisie?: number
  code_type_mvt: string
  type_libelle?: string
  signe: number
  code_magasin: string
  magasin_nom?: string
  code_motif: string
  motif_libelle?: string
  reference_document?: string | null
  numero_of?: string | null
  observations_globales?: string | null
  responsable?: string | null
  saisi_par?: string
  est_initial?: number
  nb_lignes: number
  nb_references: number
  quantite_totale_kg: number
  bobines_totales?: number
  palettes_totales?: number
  valeur_totale_mad?: number
  rebut_kg?: number
  [k: string]: unknown
}

interface LigneMvt {
  id_ligne_mouvement: string
  ligne_numero: number
  code_reference: string
  designation?: string
  couleur?: string | null
  quantite_kg: number
  quantite_saisie?: number | null
  unite_saisie?: string | null
  nb_bobines?: number | null
  nb_palettes?: number | null
  prix_kg_mad?: number | null
  total_mad?: number | null
  lot_fournisseur?: string | null
  code_motif_ligne?: string | null
  motif_ligne_libelle?: string | null
  numero_of?: string | null
  [k: string]: unknown
}

/** Un couple libelle / valeur de l'entete, aligne pour le papier. */
function Champ({ libelle, valeur }: { libelle: string; valeur: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-neutral-600">{libelle} :</span>
      <span className="font-medium">{valeur ?? '—'}</span>
    </div>
  )
}

export function BonMouvement() {
  const { id } = useParams<{ id: string }>()
  const droits = useDroits(MODULE)
  const auto = useParamVue('imprimer') === '1'

  const q = useQuery({
    queryKey: ['mouvement', id],
    queryFn: () => api.get<{ entete: EnteteMvt; lignes: LigneMvt[] }>(`/api/mouvements/${id}`),
    enabled: !!id,
  })

  if (q.isLoading) return <Chargement texte="Preparation du document…" />
  const entete = q.data?.entete
  if (!entete) return <Alerte ton="danger">Mouvement introuvable.</Alerte>

  const lignes = q.data?.lignes ?? []
  const prixVisibles = droits.visible('prix_kg_mad')
  const entree = entete.signe > 0
  const colis = (entete.palettes_totales ?? 0) > 0 || (entete.bobines_totales ?? 0) > 0
  const retard = entete.jours_de_retard_saisie ?? 0

  return (
    <div>
      <div className="sans-impression mb-3 flex flex-wrap items-center gap-2">
        <Bouton variante="contour" asChild>
          <Link to="/mouvements">
            <ArrowLeft />
            Retour aux mouvements
          </Link>
        </Bouton>
      </div>

      {/* L'ECART DE SAISIE EST DIT, PAS CACHE. Un bon etabli apres coup reste
          valable ; le lecteur doit seulement savoir qu'il l'est. */}
      {retard > 0 && (
        <Alerte ton="alerte" className="sans-impression mb-3">
          Ce mouvement a ete saisi {retard} jour{retard > 1 ? 's' : ''} apres la date du fait. Le
          document le mentionne.
        </Alerte>
      )}

      <EtatImprimable
        titre={entree ? 'Bon d entree' : 'Bon de sortie'}
        reference={entete.numero_mouvement}
        sousTitre={entete.type_libelle}
        auto={auto}
        enTete={
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <div className="space-y-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                Magasin
              </div>
              <div className="text-[13px] font-semibold">
                {entete.magasin_nom ?? entete.code_magasin}
              </div>
              <Champ libelle="Motif" valeur={entete.motif_libelle ?? entete.code_motif} />
              {entete.reference_document && (
                <Champ libelle="Document" valeur={entete.reference_document} />
              )}
              {entete.numero_of && <Champ libelle="Ordre de fabrication" valeur={entete.numero_of} />}
            </div>
            <div className="space-y-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                Mouvement
              </div>
              <Champ libelle="Date du mouvement" valeur={fmt.date(entete.date_mouvement)} />
              {/* La date de saisie n'apparait que si elle differe : l'imprimer
                  systematiquement ajouterait une ligne qui ne dit rien. */}
              {retard > 0 && entete.date_creation && (
                <Champ
                  libelle="Saisi le"
                  valeur={`${fmt.date(entete.date_creation)} (+${retard} j)`}
                />
              )}
              <Champ libelle="Sens" valeur={entree ? 'Entree en stock' : 'Sortie de stock'} />
              <Champ libelle="Responsable" valeur={entete.responsable ?? '—'} />
              <Champ libelle="Saisi par" valeur={entete.saisi_par ?? '—'} />
            </div>
          </div>
        }
      >
        <TableEtat<LigneMvt>
          colonnes={[
            { entete: 'N°', valeur: (l) => l.ligne_numero, numerique: true },
            {
              entete: 'Référence',
              valeur: (l) => (
                <>
                  <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                  {l.designation && (
                    <div className="text-[9px] text-neutral-600">
                      {l.designation}
                      {l.couleur ? ` · ${l.couleur}` : ''}
                    </div>
                  )}
                </>
              ),
            },
            {
              entete: 'Quantité',
              numerique: true,
              valeur: (l) => (
                <>
                  <div className="font-medium">{fmt.nombre(l.quantite_kg, 3)} kg</div>
                  {/* LE KILO EST L'UNITE CANONIQUE, la manutention en emploie une
                      autre. Porter les deux evite la conversion de tete au quai,
                      qui est la source d'erreur classique. */}
                  {l.unite_saisie && l.unite_saisie !== 'kg' && l.quantite_saisie != null && (
                    <div className="text-[9px] text-neutral-600">
                      soit {fmt.nombre(l.quantite_saisie, 2)} {l.unite_saisie}
                    </div>
                  )}
                </>
              ),
            },
            ...(colis
              ? [
                  {
                    entete: 'Colis comptes',
                    numerique: true,
                    valeur: (l: LigneMvt) =>
                      l.nb_palettes || l.nb_bobines ? (
                        <>
                          {l.nb_palettes ? <div>{l.nb_palettes} palette(s)</div> : null}
                          {l.nb_bobines ? (
                            <div className="text-[9px] text-neutral-600">
                              {l.nb_bobines} bobine(s)
                            </div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      ),
                  },
                ]
              : []),
            {
              entete: 'Lot / motif',
              valeur: (l) => (
                <>
                  {l.lot_fournisseur && (
                    <div className="font-mono text-[9px]">{l.lot_fournisseur}</div>
                  )}
                  {l.motif_ligne_libelle && (
                    <div className="text-[9px] text-neutral-600">{l.motif_ligne_libelle}</div>
                  )}
                  {!l.lot_fournisseur && !l.motif_ligne_libelle && '—'}
                </>
              ),
            },
            ...(prixVisibles
              ? [
                  {
                    entete: 'Prix MAD/kg',
                    numerique: true,
                    valeur: (l: LigneMvt) =>
                      l.prix_kg_mad == null ? '—' : fmt.nombre(l.prix_kg_mad, 4),
                  },
                  {
                    entete: 'Total MAD',
                    numerique: true,
                    valeur: (l: LigneMvt) =>
                      l.total_mad ? fmt.nombre(l.total_mad, 2) : '—',
                  },
                ]
              : []),
          ]}
          lignes={lignes}
          total={[
            '',
            `${entete.nb_lignes} ligne(s) · ${entete.nb_references} reference(s)`,
            `${fmt.nombre(entete.quantite_totale_kg, 3)} kg`,
            ...(colis
              ? [`${entete.palettes_totales ?? 0} pal. · ${entete.bobines_totales ?? 0} bob.`]
              : []),
            '',
            ...(prixVisibles ? ['', fmt.nombre(entete.valeur_totale_mad ?? 0, 2)] : []),
          ]}
        />

        {/* LE REBUT EST DIT A PART. Un retour d'atelier melange de l'excedent
            reutilisable et de la chute perdue : les additionner ferait croire
            que tout revient en stock utile. */}
        {(entete.rebut_kg ?? 0) > 0 && (
          <p className="mt-2 text-right text-[10px] font-medium">
            Dont rebut / perte : {fmt.nombre(entete.rebut_kg ?? 0, 3)} kg
          </p>
        )}

        {entete.observations_globales && (
          <div className="mt-4 border-t border-neutral-300 pt-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
              Observations
            </div>
            <p className="whitespace-pre-wrap text-[10px]">{entete.observations_globales}</p>
          </div>
        )}

        {/* Les deux visas. Un bon qui part sans place pour une signature revient
            signe en travers, ou pas signe du tout. Le libelle change avec le
            sens : on ne « recoit » pas une sortie. */}
        <div className="mt-8 grid grid-cols-2 gap-8">
          {[
            entree ? 'Le livreur' : 'Le magasinier',
            entree ? 'Le magasinier' : 'Le preneur',
          ].map((r) => (
            <div key={r}>
              <div className="mb-10 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                {r}
              </div>
              <div className="border-t border-neutral-500 pt-1 text-[9px] text-neutral-600">
                Nom, date et signature
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[8px] text-neutral-500">
          Registre immuable : ce mouvement ne peut plus etre modifie ni supprime. Une correction se
          fait par un mouvement inverse, qui laisse les deux traces.
        </p>
      </EtatImprimable>
    </div>
  )
}

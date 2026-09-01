/**
 * Le bon de commande sur papier — le document qui part chez le fournisseur.
 *
 * POURQUOI IL MANQUAIT ET POURQUOI IL COMPTE. L'ERP savait creer, valider et
 * suivre un bon ; il ne savait pas en sortir un document. C'etait le seul
 * manque qui obligeait a rouvrir le classeur Excel tous les jours, pour la
 * seule chose qui quitte l'entreprise.
 *
 * DEUX REGLES DE FOND.
 *
 * Un bon NON VALIDE s'imprime, mais porte la mention. On imprime pour relire
 * avant d'engager, pas seulement pour envoyer : masquer le bouton tant que le
 * bon n'est pas valide priverait du seul moment ou une erreur se voit encore.
 * La mention evite qu'un brouillon parte par megarde.
 *
 * Les MONTANTS suivent les droits. Si le role ne recoit pas les prix, le
 * document sort en quantites seules et le dit. Un bon sans prix n'est pas un
 * bon de commande : le magasinier ne doit pas croire qu'il tient un document
 * envoyable.
 */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EtatImprimable, TableEtat } from '../composants/Etat'
import { Alerte, Chargement } from '../composants/ui/base'
import { fmt } from '../components/ui'
import { useParamVue } from '../lib/navigation'

const MODULE = 'BONS_COMMANDE'

interface Bc {
  id_bc: string
  numero_bc: string
  date_bc: string
  fournisseur_nom: string
  code_fournisseur: string
  date_livraison_prevue: string | null
  conditions_paiement: string | null
  notes: string | null
  statut: string
  code_devise: string
  taux_change_engage: number
  montant_total_devise?: number
  montant_total_mad?: number
  [k: string]: unknown
}

interface LigneBc {
  id_ligne_bc: string
  ligne_numero: number
  code_reference: string
  reference_designation: string
  unite_commande: string
  quantite_commandee_unite: number
  quantite_commandee_kg: number
  prix_unitaire_devise?: number
  total_ligne_devise?: number
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

export function BonCommandeEtat() {
  const { id } = useParams<{ id: string }>()
  const droits = useDroits(MODULE)
  const auto = useParamVue('imprimer') === '1'

  /* L'entete se prend dans la LISTE et non par un appel unitaire : il n'existe
     pas de route `GET /api/bons-commande/{id}` — seul PATCH est monte sur ce
     chemin. C'est ce que fait deja la fiche du bon, et partager la meme cle de
     cache evite un second aller-retour quand on vient de la fiche. */
  const qBc = useQuery({
    queryKey: ['bons-commande'],
    queryFn: () => api.get<Bc[]>('/api/bons-commande'),
  })
  const qLignes = useQuery({
    queryKey: ['lignes-bc', id],
    queryFn: () => api.get<LigneBc[]>(`/api/bons-commande/${id}/lignes`),
    enabled: !!id,
  })

  if (qBc.isLoading || qLignes.isLoading) return <Chargement texte="Preparation du document…" />
  const bc = qBc.data?.find((b) => b.id_bc === id) ?? null
  if (!bc) return <Alerte ton="danger">Bon de commande introuvable.</Alerte>

  const lignes = [...(qLignes.data ?? [])].sort((a, b) => a.ligne_numero - b.ligne_numero)
  const prixVisibles = droits.visible('prix_unitaire_devise')
  const valide = bc.statut !== 'BROUILLON'

  const total = lignes.reduce((s, l) => s + (l.total_ligne_devise ?? 0), 0)

  return (
    <div>
      {!valide && (
        <Alerte ton="alerte" className="sans-impression mb-3">
          Ce bon est encore en brouillon. Le document portera la mention « brouillon » : il se
          relit, il ne s envoie pas.
        </Alerte>
      )}
      {!prixVisibles && (
        <Alerte ton="info" className="sans-impression mb-3">
          Votre role ne recoit pas les prix : le document sortira en quantites seules. Ce n est
          pas un bon envoyable a un fournisseur.
        </Alerte>
      )}

      <EtatImprimable
        titre="Bon de commande"
        reference={bc.numero_bc}
        sousTitre={valide ? undefined : 'BROUILLON — ne pas envoyer'}
        auto={auto}
        enTete={
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <div className="space-y-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                Fournisseur
              </div>
              <div className="text-[13px] font-semibold">{bc.fournisseur_nom}</div>
              <div className="font-mono text-[10px] text-neutral-600">{bc.code_fournisseur}</div>
              {bc.conditions_paiement && (
                <Champ libelle="Conditions" valeur={bc.conditions_paiement} />
              )}
            </div>
            <div className="space-y-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
                Commande
              </div>
              <Champ libelle="Date" valeur={fmt.date(bc.date_bc)} />
              <Champ
                libelle="Livraison prevue"
                valeur={bc.date_livraison_prevue ? fmt.date(bc.date_livraison_prevue) : '—'}
              />
              <Champ libelle="Devise" valeur={bc.code_devise} />
              {prixVisibles && bc.code_devise !== 'MAD' && (
                <Champ
                  libelle="Taux engage"
                  valeur={`${fmt.nombre(bc.taux_change_engage, 4)} MAD`}
                />
              )}
            </div>
          </div>
        }
      >
        <TableEtat<LigneBc>
          colonnes={[
            { entete: 'N°', valeur: (l) => l.ligne_numero, numerique: true },
            {
              entete: 'Reference',
              valeur: (l) => (
                <>
                  <div className="font-mono text-[10px] font-medium">{l.code_reference}</div>
                  {l.reference_designation && (
                    <div className="text-[9px] text-neutral-600">{l.reference_designation}</div>
                  )}
                </>
              ),
            },
            {
              entete: 'Quantite',
              numerique: true,
              valeur: (l) => (
                <>
                  {fmt.nombre(l.quantite_commandee_unite, 2)} {l.unite_commande}
                  {/* Le kilo est l'unite canonique de l'ERP ; le fournisseur
                      livre dans la sienne. Porter les deux evite la conversion
                      de tete au quai, qui est la source d'erreur classique. */}
                  {l.unite_commande !== 'kg' && (
                    <div className="text-[9px] text-neutral-600">
                      {fmt.nombre(l.quantite_commandee_kg, 2)} kg
                    </div>
                  )}
                </>
              ),
            },
            ...(prixVisibles
              ? [
                  {
                    entete: `Prix ${bc.code_devise}`,
                    numerique: true,
                    valeur: (l: LigneBc) =>
                      l.prix_unitaire_devise == null
                        ? '—'
                        : fmt.nombre(l.prix_unitaire_devise, 2),
                  },
                  {
                    entete: `Total ${bc.code_devise}`,
                    numerique: true,
                    valeur: (l: LigneBc) =>
                      l.total_ligne_devise == null ? '—' : fmt.nombre(l.total_ligne_devise, 2),
                  },
                ]
              : []),
          ]}
          lignes={lignes}
          total={
            prixVisibles
              ? ['', `${lignes.length} ligne(s)`, '', 'Total', fmt.nombre(total, 2)]
              : ['', `${lignes.length} ligne(s)`, '']
          }
        />

        {prixVisibles && bc.code_devise !== 'MAD' && bc.montant_total_mad != null && (
          <p className="mt-2 text-right text-[10px] text-neutral-600">
            Contre-valeur au taux engage : {fmt.nombre(bc.montant_total_mad, 2)} MAD
          </p>
        )}

        {bc.notes && (
          <div className="mt-4 border-t border-neutral-300 pt-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-neutral-600">
              Observations
            </div>
            <p className="whitespace-pre-wrap text-[10px]">{bc.notes}</p>
          </div>
        )}

        {/* Les deux cadres de signature. Un bon qui part sans place pour un
            visa revient signe en travers, ou pas signe du tout. */}
        <div className="mt-8 grid grid-cols-2 gap-8">
          {['Pour Polyfashions', 'Pour le fournisseur'].map((r) => (
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
      </EtatImprimable>
    </div>
  )
}

/**
 * Bon de commande — DOCUMENT : en-tete, lignes, saisie et suivi.
 *
 * Le bon se prepare sur des semaines. Il doit donc rester modifiable tant qu'il
 * n'engage rien — en-tete compris, ce qui manquait entierement : on pouvait le
 * creer et changer son statut, jamais corriger une date de livraison.
 *
 * La saisie de ligne amene le PLAN D'ACHAT dans le formulaire, au lieu de le
 * laisser dans un ecran a cote. Chaque reference proposee est celle du
 * fournisseur du bon, avec son stock projete, sa couverture, ce que le MRP
 * suggere d'en commander et a quel prix. Choisir devient une decision, pas une
 * saisie de code a l'aveugle.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Send, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth, useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { CelluleEditable } from '../composants/CelluleEditable'
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
import { Dialogue, DialogueContenu, useConfirmation } from '../composants/ui/surcouches'
import { cn, fmt } from '../lib/utils'

const MODULE = 'BONS_COMMANDE'

interface Bc extends Record<string, unknown> {
  id_bc: string
  numero_bc: string
  date_bc: string
  code_fournisseur: string
  fournisseur_nom: string
  date_livraison_prevue: string | null
  conditions_paiement: string | null
  notes: string | null
  statut: string
  code_devise: string
  taux_change_engage: number
  montant_total_devise?: number
  montant_total_mad?: number
  nb_lignes: number
  createur: string | null
  valideur: string | null
  date_validation: string | null
}

interface LigneBc extends Record<string, unknown> {
  id_ligne_bc: string
  ligne_numero: number
  code_reference: string
  reference_designation: string
  unite_commande: string
  quantite_commandee_unite: number
  quantite_commandee_kg: number
  quantite_recue_kg: number
  quantite_restante_kg: number
  prix_unitaire_devise?: number
  total_ligne_devise?: number
  total_ligne_mad?: number
  taux_change_engage?: number
  code_devise?: string
  couleur: string | null
  code_categorie: string | null
  categorie_libelle: string | null
  poids_bobine_kg: number | null
  bobines_par_palette: number | null
  nb_palettes: number | null
  statut: string
  besoin_kg_origine: number | null
  besoin_kg_actuel: number
  ecart_besoin_kg: number | null
  arbitree: number
}

interface RefCommandable extends Record<string, unknown> {
  code_reference: string
  designation: string
  unite_catalogue: string
  prix_catalogue?: number
  classe_abc: string | null
  moq_kg: number | null
  multiple_achat_kg: number | null
  stock_projete_kg: number | null
  stock_min_kg: number | null
  jours_couverture: number | null
  statut_stock: string | null
  qte_a_commander_kg: number | null
  /** Prix propose dans la devise du bon : plan d'achat, sinon CMUP, sinon catalogue. */
  prix_suggere_devise?: number
  prix_mad_suggere?: number
  source_prix?: string
  tier: string | null
  deja_sur_le_bon: number
}

const TON: Record<string, 'neutre' | 'info' | 'succes' | 'alerte' | 'danger'> = {
  BROUILLON: 'neutre',
  EN_ATTENTE_VALIDATION: 'alerte',
  VALIDE: 'info',
  ENVOYE: 'info',
  LIVRE_PARTIEL: 'alerte',
  CLOTURE: 'succes',
  ANNULE: 'danger',
}

const TON_STOCK: Record<string, 'danger' | 'alerte' | 'succes' | 'neutre'> = {
  RUPTURE: 'danger',
  CRITIQUE: 'danger',
  ATTENTION: 'alerte',
  OK: 'succes',
}

export function BonCommande() {
  const { id = '' } = useParams()
  const droits = useDroits(MODULE)
  const { moi } = useAuth()
  const qc = useQueryClient()
  const naviguer = useNavigate()
  const confirmation = useConfirmation()
  const [saisie, setSaisie] = useState(false)
  const [entete, setEntete] = useState({
    date_bc: '',
    date_livraison_prevue: '',
    conditions_paiement: '',
    notes: '',
  })
  /** Lignes retouchees mais pas encore enregistrees, par identifiant. */
  const [brouillon, setBrouillon] = useState<
    Record<string, { quantite_commandee_unite?: number; prix_unitaire_devise?: number }>
  >({})
  /**
   * Lignes ajoutees pendant la saisie, pas encore creees cote serveur.
   *
   * Elles vivent ici jusqu'a l'enregistrement, comme les modifications : ajouter
   * une ligne est une intention, pas un engagement. Sinon une ligne ajoutee par
   * erreur existe deja quand on s'en apercoit, et il faut la supprimer — donc
   * laisser une trace de quelque chose qui n'aurait jamais du exister.
   */
  const [nouvelles, setNouvelles] = useState<
    { cle: string; code_reference: string; designation: string; quantite: number; prix: number }[]
  >([])
  /** Lignes existantes marquees pour suppression, appliquee a l'enregistrement. */
  const [supprimees, setSupprimees] = useState<string[]>([])

  const qBc = useQuery({
    queryKey: ['bons-commande'],
    queryFn: () => api.get<Bc[]>('/api/bons-commande'),
  })
  const bc = qBc.data?.find((b) => b.id_bc === id) ?? null

  const qLignes = useQuery({
    queryKey: ['lignes-bc', id],
    queryFn: () => api.get<LigneBc[]>(`/api/bons-commande/${id}/lignes`),
    enabled: !!id,
  })

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ['bons-commande'] })
    void qc.invalidateQueries({ queryKey: ['lignes-bc'] })
    void qc.invalidateQueries({ queryKey: ['plan-achat-propositions'] })
    void qc.invalidateQueries({ queryKey: ['refs-commandables'] })
  }
  const echec = (e: unknown) =>
    toast.error(e instanceof ErreurApi ? e.message : 'Operation impossible.')

  // Le formulaire se recharge quand le bon arrive ou change de version : sans
  // cela, ouvrir un bon afficherait les valeurs du precedent.
  useEffect(() => {
    if (!bc) return
    setEntete({
      date_bc: bc.date_bc?.slice(0, 10) ?? '',
      date_livraison_prevue: bc.date_livraison_prevue?.slice(0, 10) ?? '',
      conditions_paiement: bc.conditions_paiement ?? '',
      notes: bc.notes ?? '',
    })
  }, [bc?.id_bc, bc?.date_bc, bc?.date_livraison_prevue, bc?.conditions_paiement, bc?.notes])

  const enteteModifie =
    !!bc &&
    (entete.date_bc !== (bc.date_bc?.slice(0, 10) ?? '') ||
      entete.date_livraison_prevue !== (bc.date_livraison_prevue?.slice(0, 10) ?? '') ||
      entete.conditions_paiement !== (bc.conditions_paiement ?? '') ||
      entete.notes !== (bc.notes ?? ''))

  const changerStatut = useMutation({
    mutationFn: (statut: string) => api.put(`/api/bons-commande/${id}/statut`, { statut }),
    onSuccess: (_r, statut) => {
      toast.success(`Bon passe en ${statut.toLowerCase().replace(/_/g, ' ')}`)
      rafraichir()
    },
    onError: echec,
  })

  /**
   * Enregistrement GLOBAL : l'en-tete et toutes les lignes retouchees partent
   * ensemble, et seulement quand on le demande.
   *
   * La saisie precedente envoyait chaque cellule des qu'on la quittait. Deux
   * consequences vecues : une faute de frappe etait deja enregistree avant
   * qu'on s'en apercoive, et une ligne passait « arbitree » — donc cessait de
   * suivre le plan — sans qu'aucune valeur ait vraiment change.
   *
   * Ici rien ne part avant le clic. Tant qu'on n'a pas enregistre, on annule
   * une ligne ou tout le brouillon sans laisser de trace.
   */
  const enregistrer = useMutation({
    mutationFn: async () => {
      if (enteteModifie) await api.patch(`/api/bons-commande/${id}`, entete)

      // Suppressions d'abord : une ligne retiree ne doit pas etre modifiee au
      // passage, et sa proposition d'achat revient au plan.
      for (const ligne of supprimees) {
        await api.delete(`/api/bons-commande/${id}/lignes/${ligne}`)
      }
      for (const [ligne, corps] of Object.entries(brouillon)) {
        if (supprimees.includes(ligne)) continue
        await api.patch(`/api/bons-commande/${id}/lignes/${ligne}`, corps)
      }
      for (const n of nouvelles) {
        await api.post(`/api/bons-commande/${id}/lignes`, {
          code_reference: n.code_reference,
          unite_commande: 'kg',
          quantite_commandee_unite: n.quantite,
          prix_unitaire_devise: n.prix,
        })
      }
      return {
        modifiees: Object.keys(brouillon).filter((l) => !supprimees.includes(l)).length,
        ajoutees: nouvelles.length,
        retirees: supprimees.length,
      }
    },
    onSuccess: (r) => {
      const parts = [
        r.ajoutees > 0 ? `${r.ajoutees} ajoutee(s)` : null,
        r.modifiees > 0 ? `${r.modifiees} modifiee(s)` : null,
        r.retirees > 0 ? `${r.retirees} retiree(s)` : null,
      ].filter(Boolean)
      toast.success('Bon enregistre', {
        description: parts.length ? `Lignes : ${parts.join(' · ')}.` : undefined,
      })
      setBrouillon({})
      setNouvelles([])
      setSupprimees([])
      rafraichir()
    },
    onError: echec,
  })

  /** Marque ou demarque une ligne existante pour suppression. */
  const basculerSuppression = (ligne: string) =>
    setSupprimees((l) => (l.includes(ligne) ? l.filter((x) => x !== ligne) : [...l, ligne]))

  const lignes = qLignes.data ?? []

  // --- Brouillon local des lignes -------------------------------------------
  // Une valeur n'entre dans le brouillon que si elle DIFFERE de celle du
  // serveur : reouvrir une cellule et la refermer telle quelle ne marque rien.
  const stage = (ligne: LigneBc, champ: 'quantite_commandee_unite' | 'prix_unitaire_devise', v: number) =>
    setBrouillon((b) => {
      const reste = { ...b }
      const courant = { ...(reste[ligne.id_ligne_bc] ?? {}) }
      if (v === (ligne[champ] as number | undefined)) delete courant[champ]
      else courant[champ] = v
      if (Object.keys(courant).length === 0) delete reste[ligne.id_ligne_bc]
      else reste[ligne.id_ligne_bc] = courant
      return reste
    })

  /** Valeur a afficher : celle du brouillon si elle existe, sinon le serveur. */
  const valeurDe = (l: LigneBc, champ: 'quantite_commandee_unite' | 'prix_unitaire_devise') =>
    brouillon[l.id_ligne_bc]?.[champ] ?? (l[champ] as number | undefined) ?? null

  const ligneModifiee = (l: LigneBc) => !!brouillon[l.id_ligne_bc]
  const nbModifiees = Object.keys(brouillon).filter((c) => !supprimees.includes(c)).length
  const aEnregistrer =
    nbModifiees > 0 || nouvelles.length > 0 || supprimees.length > 0 || enteteModifie

  // Les lignes ajoutees s'affichent avec les autres, marquees « nouvelle ».
  // Les voir dans le tableau evite de saisir deux fois la meme reference sans
  // s'en rendre compte.
  const lignesAffichees: LigneBc[] = [
    ...lignes,
    ...nouvelles.map((n, i) => ({
      id_ligne_bc: n.cle,
      ligne_numero: lignes.length + i + 1,
      code_reference: n.code_reference,
      reference_designation: n.designation,
      unite_commande: 'kg',
      quantite_commandee_unite: n.quantite,
      quantite_commandee_kg: n.quantite,
      quantite_recue_kg: 0,
      quantite_restante_kg: n.quantite,
      prix_unitaire_devise: n.prix,
      total_ligne_devise: n.quantite * n.prix,
      total_ligne_mad: n.quantite * n.prix * (bc?.taux_change_engage ?? 1),
      taux_change_engage: bc?.taux_change_engage,
      code_devise: bc?.code_devise,
      // Le conditionnement et la categorie viennent du catalogue, que la ligne
      // en attente n'a pas encore consulte : ils s'afficheront apres
      // enregistrement, quand le serveur les joindra.
      couleur: null,
      code_categorie: null,
      categorie_libelle: null,
      poids_bobine_kg: null,
      bobines_par_palette: null,
      nb_palettes: null,
      statut: 'EN_ATTENTE',
      besoin_kg_origine: null,
      besoin_kg_actuel: 0,
      ecart_besoin_kg: null,
      arbitree: 0,
    })),
  ]
  const estNouvelle = (l: LigneBc) => l.id_ligne_bc.startsWith('nouvelle:')

  const modifiable =
    !!droits.peutEcrire &&
    (bc?.statut === 'BROUILLON' || bc?.statut === 'EN_ATTENTE_VALIDATION')
  const estCreateur = bc?.createur === moi?.login
  const plafond = moi?.plafond_validation_bc_mad ?? null
  const depassePlafond = plafond != null && (bc?.montant_total_mad ?? 0) > plafond

  const alertes = useMemo(
    () =>
      lignes.filter(
        (l) =>
          l.besoin_kg_origine != null &&
          Math.abs(l.ecart_besoin_kg ?? 0) > Math.max(1, l.besoin_kg_origine * 0.01),
      ).length,
    [lignes],
  )

  const colonnes: ColonneDT<LigneBc>[] = [
    {
      champ: 'code_reference',
      entete: 'Reference',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{l.code_reference}</div>
          <div className="truncate text-[11px] text-attenue-texte">{l.reference_designation}</div>
        </div>
      ),
    },
    {
      champ: 'quantite_commandee_unite',
      entete: 'Commande',
      numerique: true,
      largeur: '150px',
      rendu: (l) => {
        const v = valeurDe(l, 'quantite_commandee_unite') ?? 0
        const change = v !== l.quantite_commandee_unite
        return (
          <CelluleEditable
            valeur={v}
            affichage={
              <span className={change ? 'font-medium text-primaire' : undefined}>
                {fmt.nombre(v, 2)} {l.unite_commande}
                {change && (
                  <span className="block text-[11px] text-attenue-texte line-through">
                    {fmt.nombre(l.quantite_commandee_unite, 2)}
                  </span>
                )}
              </span>
            }
            type="nombre"
            min={0}
            aligneDroite
            modifiable={modifiable && droits.modifiable('quantite_commandee_unite')}
            surValider={(x) => x != null && stage(l, 'quantite_commandee_unite', Number(x))}
          />
        )
      },
    },
    {
      champ: 'prix_unitaire_devise',
      entete: 'Prix unitaire',
      numerique: true,
      largeur: '150px',
      rendu: (l) => {
        const v = valeurDe(l, 'prix_unitaire_devise')
        const change = v !== (l.prix_unitaire_devise ?? null)
        return (
          <CelluleEditable
            valeur={v}
            affichage={
              v == null ? (
                '—'
              ) : (
                <span className={change ? 'font-medium text-primaire' : undefined}>
                  {fmt.nombre(v, 4)} {l.code_devise ?? ''}
                  {change && l.prix_unitaire_devise != null && (
                    <span className="block text-[11px] text-attenue-texte line-through">
                      {fmt.nombre(l.prix_unitaire_devise, 4)}
                    </span>
                  )}
                </span>
              )
            }
            type="nombre"
            min={0}
            aligneDroite
            modifiable={modifiable && droits.modifiable('prix_unitaire_devise')}
            surValider={(x) => x != null && stage(l, 'prix_unitaire_devise', Number(x))}
          />
        )
      },
    },
    {
      champ: 'categorie_libelle',
      entete: 'Type',
      largeur: '120px',
      rendu: (l) => (
        <div className="min-w-0">
          <div className="truncate">{l.categorie_libelle ?? l.code_categorie ?? '—'}</div>
          {l.couleur && (
            <div className="truncate text-[11px] text-attenue-texte">{l.couleur}</div>
          )}
        </div>
      ),
    },
    {
      // Encombrement, pour le transporteur et le quai. Sans conditionnement
      // declare, la question n'a pas de reponse — on l'affiche vide plutot que
      // de poser un zero qui passerait pour une palette de rien.
      champ: 'nb_palettes',
      entete: 'Palettes',
      numerique: true,
      largeur: '110px',
      secondaire: true,
      rendu: (l) =>
        l.nb_palettes == null ? (
          <span className="text-attenue-texte">—</span>
        ) : (
          <div className="text-right">
            <div className="tabular-nums">{fmt.nombre(l.nb_palettes, 2)}</div>
            {l.bobines_par_palette != null && (
              <div className="text-[11px] text-attenue-texte tabular-nums">
                {l.bobines_par_palette} bob./pal.
              </div>
            )}
          </div>
        ),
    },
    {
      champ: 'total_ligne_devise',
      entete: 'Montant devise',
      numerique: true,
      largeur: '140px',
      rendu: (l) => {
        const q = valeurDe(l, 'quantite_commandee_unite') ?? 0
        const px = valeurDe(l, 'prix_unitaire_devise') ?? 0
        return `${fmt.nombre(q * px, 2)} ${l.code_devise ?? ''}`
      },
    },
    {
      // Le montant en dirhams n'est pas stocke : il se deduit du taux ENGAGE du
      // bon (RG-09). Le recopier sur la ligne creerait une seconde verite, qui
      // divergerait des que le taux serait reevalue a la validation.
      champ: 'total_ligne_mad',
      entete: 'Montant MAD',
      numerique: true,
      largeur: '140px',
      rendu: (l) => {
        const q = valeurDe(l, 'quantite_commandee_unite') ?? 0
        const px = valeurDe(l, 'prix_unitaire_devise') ?? 0
        const taux = l.taux_change_engage ?? 1
        return (
          <div className="text-right">
            <div className="tabular-nums font-medium">{fmt.nombre(q * px * taux, 2)}</div>
            {l.code_devise && l.code_devise !== 'MAD' && (
              <div className="text-[11px] text-attenue-texte tabular-nums">
                taux {fmt.nombre(taux, 3)}
              </div>
            )}
          </div>
        )
      },
    },
    {
      champ: 'quantite_recue_kg',
      entete: 'Recu / reste',
      numerique: true,
      largeur: '140px',
      rendu: (l) => (
        <div className="text-right">
          <div className="tabular-nums">{fmt.nombre(l.quantite_recue_kg, 0)} kg</div>
          {l.quantite_restante_kg > 0.001 && (
            <div className="text-[11px] text-attenue-texte tabular-nums">
              reste {fmt.nombre(l.quantite_restante_kg, 0)}
            </div>
          )}
        </div>
      ),
    },
    {
      // Le besoin qui a justifie la ligne, confronte a celui d'aujourd'hui.
      // Calcule a la lecture : l'alerte ne peut donc pas etre perimee.
      champ: 'ecart_besoin_kg',
      entete: 'Besoin',
      numerique: true,
      largeur: '175px',
      rendu: (l) => {
        if (l.besoin_kg_origine == null) {
          return <span className="text-attenue-texte">saisie manuelle</span>
        }
        const ecart = l.ecart_besoin_kg ?? 0
        const notable = Math.abs(ecart) > Math.max(1, l.besoin_kg_origine * 0.01)
        return (
          <div className="text-right">
            <div className={cn('tabular-nums', notable && 'font-medium')}>
              {fmt.nombre(l.besoin_kg_actuel, 0)} kg
            </div>
            {notable && (
              <div className={ecart < 0 ? 'text-[11px] text-danger' : 'text-[11px] text-info'}>
                {ecart < 0 ? '▼' : '▲'} {fmt.nombre(Math.abs(ecart), 0)} kg depuis la conversion
              </div>
            )}
          </div>
        )
      },
    },
    {
      champ: 'arbitree',
      entete: 'Suivi',
      largeur: '160px',
      rendu: (l) =>
        estNouvelle(l) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="succes">nouvelle</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() => setNouvelles((n) => n.filter((x) => x.cle !== l.id_ligne_bc))}
            >
              retirer
            </button>
          </div>
        ) : supprimees.includes(l.id_ligne_bc) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="danger">a retirer</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() => basculerSuppression(l.id_ligne_bc)}
            >
              garder
            </button>
          </div>
        ) : ligneModifiee(l) ? (
          <div className="flex items-center gap-1.5">
            <Badge ton="alerte">modifiee</Badge>
            <button
              type="button"
              className="text-[11px] underline text-attenue-texte hover:text-texte"
              onClick={() =>
                setBrouillon((b) => {
                  const { [l.id_ligne_bc]: _, ...reste } = b
                  return reste
                })
              }
            >
              annuler
            </button>
          </div>
        ) : l.besoin_kg_origine == null ? (
          <span className="text-attenue-texte">—</span>
        ) : l.arbitree ? (
          <Badge ton="neutre">arbitree</Badge>
        ) : (
          <Badge ton="info">suit le plan</Badge>
        ),
    },
  ]

  if (qBc.isLoading) return <Chargement />
  if (!bc) {
    return (
      <div>
        <EnTetePage titre="Bon de commande" description="Introuvable." />
        <Alerte ton="alerte">
          Ce bon n'existe pas, ou vous n'y avez pas acces.{' '}
          <button className="underline" onClick={() => naviguer('/bons-commande')}>
            Revenir a la liste
          </button>
        </Alerte>
      </div>
    )
  }

  return (
    <div>
      <EnTetePage
        titre={`${bc.numero_bc} — ${bc.fournisseur_nom}`}
        description={`Cree le ${fmt.date(bc.date_bc)}${bc.createur ? ` par ${bc.createur}` : ''} · taux engage ${fmt.nombre(bc.taux_change_engage, 4)} ${bc.code_devise}/MAD`}
        actions={
          <>
            <Bouton variante="contour" onClick={() => naviguer('/bons-commande')}>
              <ArrowLeft />
              Retour
            </Bouton>
            {modifiable && (
              <Bouton variante="contour" onClick={() => setSaisie(true)}>
                <Plus />
                Ajouter des lignes
              </Bouton>
            )}
            {droits.peutEcrire && bc.statut === 'BROUILLON' && (
              <Bouton
                variante="contour"
                onClick={() => changerStatut.mutate('EN_ATTENTE_VALIDATION')}
                disabled={lignes.length === 0}
                title={lignes.length ? undefined : 'Un bon sans ligne ne peut pas etre soumis'}
              >
                <Send />
                Soumettre a validation
              </Bouton>
            )}
            {droits.peutValider && bc.statut === 'EN_ATTENTE_VALIDATION' && (
              <Bouton
                onClick={() => changerStatut.mutate('VALIDE')}
                disabled={estCreateur || depassePlafond}
                title={
                  estCreateur
                    ? 'B4 : vous ne pouvez pas valider un bon que vous avez cree'
                    : depassePlafond
                      ? `Montant superieur a votre plafond de ${fmt.mad(plafond ?? 0)}`
                      : undefined
                }
              >
                <ShieldCheck />
                Valider
              </Bouton>
            )}
            {droits.peutEcrire && bc.statut === 'VALIDE' && (
              <Bouton onClick={() => changerStatut.mutate('ENVOYE')}>
                <Send />
                Envoyer au fournisseur
              </Bouton>
            )}
          </>
        }
      />

      {!modifiable && !['CLOTURE', 'ANNULE'].includes(bc.statut) && (
        <Alerte ton="info" className="mb-3">
          Bon {bc.statut.toLowerCase().replace(/_/g, ' ')} : les lignes sont figees. Seules les
          receptions le font encore evoluer.
        </Alerte>
      )}

      {alertes > 0 && modifiable && (
        <Alerte ton="alerte" titre="Le besoin a bouge depuis la conversion" className="mb-3">
          {alertes} ligne(s) ne correspondent plus au besoin qui les a justifiees. Alignez-les ou
          retirez-les avant de soumettre le bon.
        </Alerte>
      )}

      <div className="space-y-3">
        <Carte repliable="boncommande.1">
          <CarteEntete>
            <CarteTitre>En-tete</CarteTitre>
            <Badge ton={TON[bc.statut] ?? 'neutre'}>{bc.statut}</Badge>
          </CarteEntete>
          <CarteCorps className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Etiq>Fournisseur</Etiq>
              <div className="flex h-8 items-center rounded-[var(--radius)] border border-bordure bg-attenue px-2 text-[13px]">
                {bc.fournisseur_nom}
              </div>
              <p className="mt-1 text-[11px] text-attenue-texte">
                Non modifiable : devise, taux et prix en decoulent.
              </p>
            </div>
            <div>
              <Etiq htmlFor="datebc">Date du bon</Etiq>
              <Champ
                id="datebc"
                type="date"
                value={entete.date_bc}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, date_bc: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="livr">Livraison prevue</Etiq>
              <Champ
                id="livr"
                type="date"
                value={entete.date_livraison_prevue}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, date_livraison_prevue: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="cond">Conditions de paiement</Etiq>
              <Champ
                id="cond"
                value={entete.conditions_paiement}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, conditions_paiement: e.target.value })}
              />
            </div>
            <div>
              <Etiq htmlFor="notes">Observations</Etiq>
              <Champ
                id="notes"
                value={entete.notes}
                disabled={!modifiable}
                onChange={(e) => setEntete({ ...entete, notes: e.target.value })}
              />
            </div>
          </CarteCorps>

          {/* Un bouton explicite plutot qu'un enregistrement a la sortie du
              champ : personne ne devine qu'un champ quitte se sauvegarde, et
              cliquer directement sur « Soumettre » ferait courir la sauvegarde
              contre le changement de statut. */}

          <CarteCorps className="flex flex-wrap gap-6 border-t border-bordure pt-3 text-[13px]">
            <span className="text-attenue-texte">
              Lignes <span className="font-semibold tabular-nums text-texte">{lignes.length}</span>
            </span>
            <span className="text-attenue-texte">
              Total{' '}
              <span className="font-semibold tabular-nums text-texte">
                {fmt.nombre(bc.montant_total_devise ?? 0, 2)} {bc.code_devise}
              </span>
            </span>
            <span className="text-attenue-texte">
              Soit{' '}
              <span className="font-semibold tabular-nums text-texte">
                {fmt.mad(bc.montant_total_mad ?? 0)}
              </span>
            </span>
            {bc.valideur && (
              <span className="ml-auto text-attenue-texte">
                Valide par <span className="text-texte">{bc.valideur}</span>{' '}
                {fmt.dateHeure(bc.date_validation)}
              </span>
            )}
          </CarteCorps>
        </Carte>

        <Carte repliable="boncommande.2">
          <CarteEntete>
            <CarteTitre>Lignes</CarteTitre>
            {modifiable && (
              <Bouton variante="contour" taille="sm" onClick={() => setSaisie(true)}>
                <Plus />
                Ajouter
              </Bouton>
            )}
          </CarteEntete>
          <CarteCorps className="p-0">
            <DataTable<LigneBc>
              module={MODULE}
              colonnes={colonnes}
              lignes={lignesAffichees}
              chargement={qLignes.isLoading}
              cle={(l) => l.id_ligne_bc}
              recherche={false}
              pagination={false}
              tailleParDefaut={500}
              titreCarte={(l) => l.code_reference}
              videTitre="Aucune ligne"
              videDescription="Ajoutez des references : le plan d'achat vous dira quoi commander."
              actions={
                modifiable
                  ? (l) => (
                      <Bouton
                        variante="discret"
                        taille="icone-xs"
                        className="text-danger hover:bg-danger/10"
                        onClick={() =>
                          estNouvelle(l)
                            ? setNouvelles((n) => n.filter((x) => x.cle !== l.id_ligne_bc))
                            : basculerSuppression(l.id_ligne_bc)
                        }
                        aria-label="Retirer"
                        title="Marquer la ligne a retirer — effectif a l'enregistrement"
                      >
                        <Trash2 />
                      </Bouton>
                    )
                  : undefined
              }
            />
          </CarteCorps>
        </Carte>
      </div>

      {/* Les deux boutons sont TOUJOURS presents tant que le bon se modifie, et
          simplement desactives quand il n'y a rien a enregistrer. Une barre qui
          n'apparait qu'une fois la saisie commencee laisse chercher ou l'on
          enregistre — on ne trouve pas un bouton qu'on n'a jamais vu.

          L'enregistrement est global : l'entete et toutes les lignes retouchees
          partent ensemble, et rien n'est envoye avant le clic. */}
      {modifiable && (
        <div
          className={cn(
            'sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface px-3 py-2 shadow-sm',
            aEnregistrer ? 'border-primaire' : 'border-bordure',
          )}
        >
          <span className="text-[13px]">
            {aEnregistrer ? (
              <>
                <span className="font-medium">
                  {[
                    nouvelles.length > 0 ? `${nouvelles.length} ajoutee(s)` : null,
                    nbModifiees > 0 ? `${nbModifiees} modifiee(s)` : null,
                    supprimees.length > 0 ? `${supprimees.length} a retirer` : null,
                    enteteModifie ? 'en-tete modifie' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-alerte"> — rien n'est encore enregistre.</span>
              </>
            ) : (
              <span className="text-attenue-texte">
                Modifiez l'en-tete ou une ligne, puis enregistrez.
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Bouton
              variante="contour"
              disabled={!aEnregistrer}
              onClick={() => {
                setBrouillon({})
                setNouvelles([])
                setSupprimees([])
                if (bc) {
                  setEntete({
                    date_bc: bc.date_bc?.slice(0, 10) ?? '',
                    date_livraison_prevue: bc.date_livraison_prevue?.slice(0, 10) ?? '',
                    conditions_paiement: bc.conditions_paiement ?? '',
                    notes: bc.notes ?? '',
                  })
                }
              }}
            >
              <Undo2 />
              Annuler les modifications
            </Bouton>
            <Bouton
              onClick={() => enregistrer.mutate()}
              chargement={enregistrer.isPending}
              disabled={!aEnregistrer}
            >
              <Save />
              Enregistrer les modifications
            </Bouton>
          </div>
        </div>
      )}

      {saisie && (
        <PanneauSaisie
          idBc={id}
          devise={bc.code_devise}
          dejaChoisies={[...lignes.map((l) => l.code_reference), ...nouvelles.map((n) => n.code_reference)]}
          surFermeture={() => setSaisie(false)}
          surAjout={(ajouts) =>
            setNouvelles((n) => [
              ...n,
              ...ajouts.map((a, i) => ({ ...a, cle: `nouvelle:${Date.now()}:${i}` })),
            ])
          }
        />
      )}
      {confirmation.element}
    </div>
  )
}

/**
 * Saisie des lignes, avec le plan d'achat sous les yeux.
 *
 * Une seule liste, celle des references DU FOURNISSEUR du bon — la precedente
 * offrait deux mille references tous fournisseurs confondus. Chacune arrive avec
 * son stock, sa couverture et la quantite suggeree, et cocher preremplit la
 * quantite et le prix. On corrige ensuite ce qu'on veut.
 */
function PanneauSaisie({
  idBc,
  devise,
  dejaChoisies,
  surFermeture,
  surAjout,
}: {
  idBc: string
  devise: string
  /** References deja sur le bon OU deja ajoutees au brouillon. */
  dejaChoisies: string[]
  surFermeture: () => void
  surAjout: (
    ajouts: { code_reference: string; designation: string; quantite: number; prix: number }[],
  ) => void
}) {
  const [choix, setChoix] = useState<Record<string, { qte: string; prix: string }>>({})
  const [filtre, setFiltre] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['refs-commandables', idBc],
    queryFn: () => api.get<RefCommandable[]>(`/api/references-commandables?id_bc=${idBc}`),
  })

  /**
   * Le panneau ne cree rien : il remonte les lignes au document, qui les garde
   * en brouillon jusqu'a l'enregistrement. Ajouter une ligne est une intention,
   * pas un engagement — et une ligne ajoutee par erreur se retire sans avoir
   * jamais existe en base.
   */
  const valider = () => {
    const ajouts = Object.entries(choix).map(([code, v]) => ({
      code_reference: code,
      designation: (q.data ?? []).find((r) => r.code_reference === code)?.designation ?? code,
      quantite: Number(v.qte),
      prix: Number(v.prix),
    }))
    if (ajouts.some((a) => !(a.quantite > 0) || !(a.prix > 0))) {
      setErreur('Renseignez une quantite et un prix pour chaque ligne.')
      return
    }
    surAjout(ajouts)
    setChoix({})
    surFermeture()
  }

  const refs = (q.data ?? []).filter(
    (r) =>
      !filtre ||
      r.code_reference.toLowerCase().includes(filtre.toLowerCase()) ||
      (r.designation ?? '').toLowerCase().includes(filtre.toLowerCase()),
  )

  const basculer = (r: RefCommandable) =>
    setChoix((c) => {
      if (c[r.code_reference]) {
        const { [r.code_reference]: _, ...reste } = c
        return reste
      }
      // Preremplissage : la quantite suggeree par le plan, et le prix estime
      // ramene dans la devise du bon. L'acheteur corrige ce qu'il veut.
      return {
        ...c,
        [r.code_reference]: {
          // La quantite suggeree n'existe que si le plan propose la reference ;
          // le prix, lui, est toujours connu — c'est le repli CMUP puis catalogue.
          qte: String(r.qte_a_commander_kg ?? ''),
          prix: r.prix_suggere_devise != null ? String(r.prix_suggere_devise) : '',
        },
      }
    })

  const nb = Object.keys(choix).length
  const complet = Object.values(choix).every((v) => Number(v.qte) > 0 && Number(v.prix) > 0)

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        cote="droite"
        titre="Ajouter des lignes"
        description={`References de ce fournisseur, classees par urgence. Prix en ${devise} par kg.`}
      >
        <Champ
          placeholder="Filtrer par reference ou designation…"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          className="mb-3"
        />

        {q.isLoading && <Chargement texte="Chargement des references…" />}

        <div className="space-y-1.5">
          {refs.map((r) => {
            const coche = !!choix[r.code_reference]
            const deja = r.deja_sur_le_bon > 0 || dejaChoisies.includes(r.code_reference)
            return (
              <div
                key={r.code_reference}
                className={cn(
                  'rounded-[var(--radius)] border p-2',
                  coche ? 'border-primaire bg-primaire/5' : 'border-bordure',
                  deja && 'opacity-60',
                )}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={coche}
                    disabled={deja}
                    onChange={() => basculer(r)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{r.code_reference}</span>
                      {r.statut_stock && (
                        <Badge ton={TON_STOCK[r.statut_stock] ?? 'neutre'}>{r.statut_stock}</Badge>
                      )}
                      {r.tier && <Badge ton="contour">{r.tier}</Badge>}
                      {r.classe_abc && <Badge ton="neutre">ABC {r.classe_abc}</Badge>}
                      {deja && <span className="text-[11px] text-attenue-texte">deja sur ce bon</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-attenue-texte">
                      {r.designation}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-attenue-texte">
                      <span>
                        Projete{' '}
                        <span className="tabular-nums text-texte">
                          {fmt.nombre(r.stock_projete_kg ?? 0, 0)} kg
                        </span>
                      </span>
                      {r.jours_couverture != null && (
                        <span>
                          Couverture{' '}
                          <span className="tabular-nums text-texte">
                            {fmt.nombre(r.jours_couverture, 0)} j
                          </span>
                        </span>
                      )}
                      {r.qte_a_commander_kg != null && (
                        <span>
                          Suggere{' '}
                          <span className="tabular-nums font-medium text-texte">
                            {fmt.nombre(r.qte_a_commander_kg, 0)} kg
                          </span>
                        </span>
                      )}
                      {r.moq_kg != null && <span>MOQ {fmt.nombre(r.moq_kg, 0)} kg</span>}
                      {r.multiple_achat_kg != null && (
                        <span>multiple {fmt.nombre(r.multiple_achat_kg, 0)} kg</span>
                      )}
                      {r.prix_suggere_devise != null && (
                        <span>
                          Prix{' '}
                          <span className="tabular-nums text-texte">
                            {fmt.nombre(r.prix_suggere_devise, 4)} {devise}
                          </span>
                        </span>
                      )}
                      {r.source_prix === 'CATALOGUE' && (
                        <span className="text-alerte">prix catalogue, jamais paye</span>
                      )}
                      {r.source_prix === 'CMUP' && <span>cout moyen constate</span>}
                    </span>
                  </span>
                </label>

                {coche && (
                  <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
                    <div>
                      <Etiq>Quantite (kg)</Etiq>
                      <Champ
                        type="number"
                        step="any"
                        min="0.0001"
                        value={choix[r.code_reference].qte}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [r.code_reference]: { ...c[r.code_reference], qte: e.target.value },
                          }))
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <Etiq>Prix {devise}/kg</Etiq>
                      <Champ
                        type="number"
                        step="any"
                        min="0.0001"
                        value={choix[r.code_reference].prix}
                        onChange={(e) =>
                          setChoix((c) => ({
                            ...c,
                            [r.code_reference]: { ...c[r.code_reference], prix: e.target.value },
                          }))
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!q.isLoading && refs.length === 0 && (
            <p className="py-6 text-center text-[13px] text-attenue-texte">
              Aucune reference active pour ce fournisseur.
            </p>
          )}
        </div>

        {erreur && (
          <Alerte ton="danger" className="mt-3">
            {erreur}
          </Alerte>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-bordure bg-surface px-4 pt-3">
          <span className="text-[11px] text-attenue-texte">
            {nb} reference(s) — ajoutees au brouillon, enregistrees avec le bon
          </span>
          <div className="flex items-center gap-2">
            <Bouton variante="contour" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton
              onClick={valider}
              disabled={!nb || !complet}
              title={!complet ? 'Renseignez une quantite et un prix pour chaque ligne' : undefined}
            >
              <Plus />
              Ajouter {nb || ''}
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

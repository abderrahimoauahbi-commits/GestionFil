/**
 * LES LOTS — ce que partagent la liste, la fiche et les autorisations.
 *
 * Le cahier « Gestion des lots » (02/10/2026) fixe le vocabulaire : un lot est
 * LIBRE, BLOQUE ou SOLDE ; il compte pour le plan d'achat (PROJET) ou n'est
 * plus qu'un reste (RESTES) ; il est DORMANT apres un an sans activite. Les
 * libelles d'ecran vivent ici, une fois : la liste et la fiche ne doivent pas
 * appeler la meme chose de deux noms.
 *
 * LES DECISIONS se prennent dans une confirmation courte qui demande le motif.
 * La regle « jamais en popup » vise la saisie de DOCUMENTS ; bloquer un lot ou
 * trancher sur un dormant est une decision d'une phrase, et c'est cette phrase
 * que le journal gardera.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowDownToLine, ArrowUpFromLine, Hourglass, Lock, LockOpen } from 'lucide-react'

import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Badge, Bouton } from '../../composants/ui/base'
import { Dialogue, DialogueContenu } from '../../composants/ui/surcouches'
import { libelleLot } from '../../lib/lots'
import { cn } from '../../lib/utils'
import { MODULE, libelleSeuil, lienFiche, messageErreur, nb, useApresDecision, useBasculerRestes, type Lot } from './modele'

export function LienLot({ reference, lot, className }: { reference: string; lot: string; className?: string }) {
  return (
    <Link to={lienFiche(reference, lot)} className={cn('font-mono text-primaire hover:underline', className)}>
      {libelleLot(lot)}
    </Link>
  )
}

export function BadgeStatut({ statut }: { statut: string }) {
  if (statut === 'BLOQUE') return <Badge ton="danger">Bloqué</Badge>
  if (statut === 'SOLDE') return <Badge ton="neutre">Soldé</Badge>
  return <Badge ton="succes">Libre</Badge>
}

export function BadgeCategorie({ categorie }: { categorie: string }) {
  return categorie === 'RESTES' ? <Badge ton="or">Restes</Badge> : <Badge ton="info">Projet</Badge>
}

// ============================================================================
// La decision motivee
// ============================================================================

export interface Choix {
  valeur: string
  libelle: string
  description: string
  destructif?: boolean
  indisponible?: string
}

/**
 * UNE DECISION, SON MOTIF, ET RIEN D'AUTRE. Ce qui va se passer est dit
 * d'abord, en toutes lettres ; le motif ensuite. Le bouton reste inerte tant
 * qu'un motif obligatoire n'a pas cinq caracteres — « ok » n'apprend rien a
 * celui qui relira la fiche du lot dans six mois.
 */
export function DecisionMotivee({
  ouvert,
  surFermeture,
  titre,
  consequence,
  choix,
  motifObligatoire,
  libelleBouton,
  destructif,
  envoyer,
}: {
  ouvert: boolean
  surFermeture: () => void
  titre: string
  consequence: React.ReactNode
  /** Plusieurs issues possibles (lot dormant : garder, solder, detruire). */
  choix?: Choix[]
  motifObligatoire: boolean
  libelleBouton: string
  destructif?: boolean
  envoyer: (motif: string, choix: string | null) => Promise<unknown>
}) {
  const [motif, setMotif] = useState('')
  const [retenu, setRetenu] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const fermer = () => {
    setMotif('')
    setRetenu(null)
    surFermeture()
  }

  const choixRetenu = choix?.find((c) => c.valeur === retenu) ?? null
  const motifOk = !motifObligatoire || motif.trim().length >= 5
  const pret = motifOk && (!choix || (choixRetenu && !choixRetenu.indisponible))

  const valider = async () => {
    setEnCours(true)
    try {
      await envoyer(motif.trim(), retenu)
      fermer()
    } catch (e) {
      toast.error(messageErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Dialogue open={ouvert} onOpenChange={(o) => !o && fermer()}>
      <DialogueContenu titre={titre} className="max-w-lg">
        <div className="flex flex-col gap-3">
          <div className="rounded-[var(--radius-sm)] border border-bordure bg-attenue/40 p-3 text-[13px] leading-relaxed">
            {consequence}
          </div>

          {choix && (
            <div className="flex flex-col gap-1.5" role="radiogroup">
              {choix.map((c) => (
                <label
                  key={c.valeur}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border p-2.5 text-[13px]',
                    retenu === c.valeur ? 'border-primaire bg-primaire/5' : 'border-bordure hover:bg-attenue/50',
                    c.indisponible && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="choix-decision"
                    className="mt-0.5"
                    disabled={!!c.indisponible}
                    checked={retenu === c.valeur}
                    onChange={() => setRetenu(c.valeur)}
                  />
                  <span className="min-w-0">
                    <span className={cn('font-medium', c.destructif && 'text-danger')}>{c.libelle}</span>
                    <span className="block text-[12px] text-attenue-texte">{c.indisponible ?? c.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-texte">
              Pourquoi ?{' '}
              <span className="font-normal text-attenue-texte">{motifObligatoire ? '(obligatoire)' : '(facultatif)'}</span>
            </span>
            <textarea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={3}
              autoFocus={!choix}
              placeholder="Ex. : contrôle qualité en cours, nuance différente constatée au tissage…"
              className="w-full rounded-[var(--radius-sm)] border border-bordure bg-surface px-2.5 py-2 text-[13px]
                         outline-none focus:border-primaire/60"
            />
            <span className="text-[11px] text-attenue-texte">
              Cette phrase reste sur la fiche du lot, à côté de votre nom et de l’heure.
            </span>
          </label>

          <div className="flex justify-end gap-2 border-t border-bordure pt-3">
            <Bouton variante="contour" taille="sm" onClick={fermer}>
              Annuler
            </Bouton>
            <Bouton
              taille="sm"
              variante={destructif || choixRetenu?.destructif ? 'danger' : 'principal'}
              disabled={!pret}
              chargement={enCours}
              onClick={() => void valider()}
            >
              {libelleBouton}
            </Bouton>
          </div>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}

// ============================================================================
// Les gestes sur un lot
// ============================================================================

type Geste = 'bloquer' | 'debloquer' | 'projet' | 'restes' | 'dormant'

/**
 * Les boutons d'action d'un lot, la ou on le regarde — ligne de liste ou
 * fiche. Chaque bouton n'apparait que si le geste est possible ET permis :
 * un bouton qui ne peut que refuser apprend seulement a ne plus cliquer.
 *
 * Droits (en attendant les profils « responsable qualite » et « chef
 * d'atelier ») : bloquer, debloquer et trancher un dormant demandent VALIDER
 * sur le stock ; basculer demande ECRIRE.
 */
export function ActionsLot({ lot, complet = false }: { lot: Lot; complet?: boolean }) {
  const { peut } = useAuth()
  const peutValider = peut(MODULE, 'VALIDER')
  const peutEcrire = peut(MODULE, 'ECRIRE')
  const [geste, setGeste] = useState<Geste | null>(null)
  const apres = useApresDecision()
  const basculer = useBasculerRestes()

  const cle = { code_reference: lot.code_reference, lot_fournisseur: lot.lot_fournisseur }
  const nom = `${libelleLot(lot.lot_fournisseur)} (${lot.code_reference})`
  const actif = lot.statut !== 'SOLDE' && (lot.solde_kg ?? 0) > 0

  const poster = async (route: string, corps: object, message: string) => {
    await api.post(route, { ...cle, ...corps })
    await apres()
    toast.success(message)
  }

  const taille = complet ? 'sm' : 'xs'
  const boutons: React.ReactNode[] = []

  if (actif && lot.a_basculer && peutEcrire) {
    boutons.push(
      <Bouton
        key="restes"
        taille={taille}
        variante="principal"
        chargement={basculer.isPending}
        onClick={(e) => {
          e.stopPropagation()
          basculer.mutate(cle)
        }}
        title="Le lot est sous le seuil de son article : il ne compte plus pour le plan d'achat"
      >
        <ArrowDownToLine />
        Basculer en Restes
      </Bouton>,
    )
  } else if (complet && actif && lot.categorie === 'PROJET' && lot.statut === 'LIBRE' && peutEcrire) {
    boutons.push(
      <Bouton key="restes" taille={taille} variante="contour" onClick={() => setGeste('restes')}>
        <ArrowDownToLine />
        Passer en Restes
      </Bouton>,
    )
  }
  if (complet && actif && lot.categorie === 'RESTES' && peutEcrire) {
    boutons.push(
      <Bouton key="projet" taille={taille} variante="contour" onClick={() => setGeste('projet')}>
        <ArrowUpFromLine />
        Revenir en Projet
      </Bouton>,
    )
  }
  if (actif && lot.dormant && peutValider) {
    boutons.push(
      <Bouton
        key="dormant"
        taille={taille}
        variante="contour"
        onClick={(e) => {
          e.stopPropagation()
          setGeste('dormant')
        }}
      >
        <Hourglass />
        Décider
      </Bouton>,
    )
  }
  if (actif && lot.statut === 'LIBRE' && peutValider) {
    boutons.push(
      <Bouton
        key="bloquer"
        taille={taille}
        variante="contour"
        className="text-danger"
        onClick={(e) => {
          e.stopPropagation()
          setGeste('bloquer')
        }}
      >
        <Lock />
        Bloquer
      </Bouton>,
    )
  }
  if (lot.statut === 'BLOQUE' && peutValider) {
    boutons.push(
      <Bouton
        key="debloquer"
        taille={taille}
        variante="contour"
        onClick={(e) => {
          e.stopPropagation()
          setGeste('debloquer')
        }}
      >
        <LockOpen />
        Débloquer
      </Bouton>,
    )
  }

  if (!boutons.length) return null

  return (
    // La ligne de liste s'ouvre au clic : les boutons ne doivent pas l'ouvrir.
    <div className="flex flex-wrap items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {boutons}

      <DecisionMotivee
        ouvert={geste === 'bloquer'}
        surFermeture={() => setGeste(null)}
        titre={`Bloquer le lot ${nom}`}
        consequence={
          <>
            Le lot ne pourra plus bouger du tout — ni sortie, ni transfert, ni chargement machine — tant
            qu’un responsable ne l’aura pas débloqué. Il sort des vues Projet et Restes et ne se lit plus
            qu’en vue comptable.
          </>
        }
        motifObligatoire
        destructif
        libelleBouton="Bloquer le lot"
        envoyer={(motif) => poster('/api/lots/statut', { action: 'BLOQUER', motif }, `Lot ${nom} bloqué`)}
      />
      <DecisionMotivee
        ouvert={geste === 'debloquer'}
        surFermeture={() => setGeste(null)}
        titre={`Débloquer le lot ${nom}`}
        consequence={<>Le lot redevient libre : il peut de nouveau sortir, être transféré ou chargé sur machine.</>}
        motifObligatoire
        libelleBouton="Débloquer le lot"
        envoyer={(motif) => poster('/api/lots/statut', { action: 'DEBLOQUER', motif }, `Lot ${nom} débloqué`)}
      />
      <DecisionMotivee
        ouvert={geste === 'restes'}
        surFermeture={() => setGeste(null)}
        titre={`Passer le lot ${nom} en Restes`}
        consequence={
          <>
            Le lot ne comptera plus pour le plan d’achat. Il reste en stock et utilisable. Le lot n’est pas
            sous le seuil de son article ({libelleSeuil(lot, true)}) : dites pourquoi vous le basculez
            quand même.
          </>
        }
        // OBLIGATOIRE ICI, alors que le serveur ne l'exige pas : sans motif,
        // il ecrit « passe sous le seuil » — faux pour un lot qui ne l'est pas.
        motifObligatoire
        libelleBouton="Passer en Restes"
        envoyer={(motif) => poster('/api/lots/basculer', { categorie: 'RESTES', motif }, `Lot ${nom} passé en Restes`)}
      />
      <DecisionMotivee
        ouvert={geste === 'projet'}
        surFermeture={() => setGeste(null)}
        titre={`Remettre le lot ${nom} en Projet`}
        consequence={
          <>
            Le lot comptera de nouveau pour le plan d’achat. C’est un choix contre la règle du seuil : le
            motif est obligatoire.
          </>
        }
        motifObligatoire
        libelleBouton="Revenir en Projet"
        envoyer={(motif) => poster('/api/lots/basculer', { categorie: 'PROJET', motif }, `Lot ${nom} remis en Projet`)}
      />
      <DecisionMotivee
        ouvert={geste === 'dormant'}
        surFermeture={() => setGeste(null)}
        titre={`Lot dormant ${nom}`}
        consequence={
          <>
            Aucune activité depuis {nb(lot.jours_sans_activite)} jours, pour {nb(lot.solde_kg, 1)} kg en
            stock. Choisissez ce que devient le lot.
          </>
        }
        choix={[
          {
            valeur: 'GARDER',
            libelle: 'Garder',
            description: 'Le lot reste en stock ; le compteur de dormance repart de zéro.',
          },
          {
            valeur: 'SOLDER',
            libelle: 'Solder',
            description: 'Tout le stock du lot sort, magasin par magasin, par un ajustement d’inventaire motivé.',
            destructif: true,
            indisponible: lot.statut === 'BLOQUE' ? 'Le lot est bloqué : la qualité doit d’abord le débloquer.' : undefined,
          },
          {
            valeur: 'DETRUIRE',
            libelle: 'Détruire',
            description: 'Même sortie de stock, enregistrée comme une destruction.',
            destructif: true,
            indisponible: lot.statut === 'BLOQUE' ? 'Le lot est bloqué : la qualité doit d’abord le débloquer.' : undefined,
          },
        ]}
        motifObligatoire
        libelleBouton="Enregistrer la décision"
        envoyer={(motif, decision) =>
          poster(
            '/api/lots/dormant',
            { decision, motif },
            decision === 'GARDER' ? `Lot ${nom} gardé` : decision === 'SOLDER' ? `Lot ${nom} soldé` : `Lot ${nom} détruit`,
          )
        }
      />
    </div>
  )
}

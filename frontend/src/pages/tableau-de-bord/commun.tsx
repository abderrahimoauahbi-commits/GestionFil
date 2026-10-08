/**
 * Ce que partagent les pages du tableau de bord (06/10/2026) : le panneau
 * (`Bloc`), les files « à traiter » et leurs règles de droits, la marge de
 * décision, les libellés de mois.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownUp,
  CloudOff,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileCheck2,
  FileClock,
  Lock,
  Moon,
  PackageX,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import { api } from '../../api/client'
import { useAuth, useDroits } from '../../auth/AuthContext'
import { Carte, CarteCorps, CarteEntete, CarteTitre } from '../../composants/ui/base'
import { compact } from '../../composants/graphiques/Visuels'
import { cn } from '../../lib/utils'

export type Ton = 'danger' | 'alerte' | 'neutre'
export type Domaine = 'ACHATS' | 'STOCK' | 'QUALITE'
export interface File {
  champ: string
  libelle: string
  valeur: number
  detail?: string
  ton: Ton
  Icone: React.ComponentType<{ className?: string }>
  vers?: string
  actionnable: boolean
  horsGrille?: boolean
  domaine?: Domaine
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
/** « 2026-03 » -> « mars 26 ». */
export const libelleMois = (am: string) => `${MOIS[Number(am.slice(5, 7)) - 1] ?? am.slice(5)} ${am.slice(2, 4)}`

/**
 * Les files « à traiter », avec les règles du poste de travail : une file
 * n'apparaît que si le rôle peut VOIR le champ et AGIR dessus, et si elle
 * n'est pas vide. Les plus graves d'abord.
 */
export function useFiles(): { files: File[]; chargement: boolean; erreur: boolean } {
  const droits = useDroits('COCKPIT')
  const { peut } = useAuth()
  const lisStock = peut('STOCK', 'LIRE')
  const { moi } = useAuth()
  const decideLots = peut('LOTS', 'VALIDER') || moi?.role === 'DIRECTION'
  const qKpi = useQuery({ queryKey: ['cockpit'], queryFn: () => api.get<Record<string, unknown>>('/api/cockpit') })
  const qLots = useQuery({
    queryKey: ['cockpit-lots'],
    queryFn: () => api.get<Record<string, number | null>>('/api/cockpit/lots'),
    enabled: lisStock,
  })
  const k = qKpi.data ?? {}
  const nn = (c: string) => (typeof k[c] === 'number' ? (k[c] as number) : 0)
  const nl = (c: string) => Number(qLots.data?.[c] ?? 0)

  const files: File[] = [
    { champ: 'nb_propositions_a_traiter', domaine: 'ACHATS', libelle: 'Propositions à arbitrer', valeur: nn('nb_propositions_a_traiter'), detail: "plan d'achat", ton: 'alerte', Icone: FileClock, vers: '/plan-achat', actionnable: peut('PLAN_ACHAT', 'ECRIRE') },
    { champ: 'nb_bc_a_valider', domaine: 'ACHATS', libelle: 'Bons à valider', valeur: nn('nb_bc_a_valider'), detail: droits.visible('montant_bc_a_valider_mad') ? `${compact(nn('montant_bc_a_valider_mad'))} MAD` : undefined, ton: 'alerte', Icone: FileCheck2, vers: '/bons-commande', actionnable: peut('BONS_COMMANDE', 'VALIDER') },
    { champ: 'nb_bc_a_envoyer', domaine: 'ACHATS', libelle: 'Bons à envoyer', valeur: nn('nb_bc_a_envoyer'), detail: 'validés, pas encore partis', ton: 'alerte', Icone: Send, vers: '/bons-commande', actionnable: peut('BONS_COMMANDE', 'ECRIRE') },
    { champ: 'nb_livraisons_en_retard', domaine: 'ACHATS', libelle: 'Livraisons en retard', valeur: nn('nb_livraisons_en_retard'), detail: nn('retard_max_jours') > 0 ? `jusqu'à ${nn('retard_max_jours')} j` : undefined, ton: 'danger', Icone: Clock, vers: '/bons-commande', actionnable: peut('BONS_COMMANDE', 'LIRE') },
    { champ: 'nb_receptions_a_controler', domaine: 'QUALITE', libelle: 'Réceptions à contrôler', valeur: nn('nb_receptions_a_controler'), ton: 'alerte', Icone: ClipboardCheck, vers: '/receptions', actionnable: peut('RECEPTIONS', 'VALIDER') },
    { champ: 'nb_receptions_en_saisie', domaine: 'STOCK', libelle: 'Réceptions en saisie', valeur: nn('nb_receptions_en_saisie'), ton: 'neutre', Icone: Truck, vers: '/receptions', actionnable: peut('RECEPTIONS', 'ECRIRE') },
    { champ: 'nb_receptions_a_regulariser', domaine: 'STOCK', libelle: 'Réceptions à régulariser', valeur: nn('nb_receptions_a_regulariser'), ton: 'danger', Icone: ShieldAlert, vers: '/receptions', actionnable: peut('RECEPTIONS', 'LIRE') },
    { champ: 'nb_lignes_non_conformes', domaine: 'QUALITE', libelle: 'Lignes non conformes', valeur: nn('nb_lignes_non_conformes'), ton: 'danger', Icone: PackageX, vers: '/receptions', actionnable: peut('RECEPTIONS', 'LIRE') },
    { champ: 'nb_refs_dormantes', domaine: 'STOCK', libelle: 'Références dormantes', valeur: nn('nb_refs_dormantes'), ton: 'alerte', Icone: Moon, vers: '/stock', actionnable: peut('STOCK', 'LIRE') },
    { champ: 'lots_a_basculer', domaine: 'STOCK', libelle: 'Lots à basculer', valeur: nl('lots_a_basculer'), ton: 'alerte', Icone: ArrowDownUp, vers: '/lots?vue=a_basculer', actionnable: peut('STOCK', 'ECRIRE'), horsGrille: true },
    { champ: 'lots_dormants', domaine: 'STOCK', libelle: 'Lots dormants', valeur: nl('lots_dormants'), ton: 'alerte', Icone: Moon, vers: '/lots?vue=dormants', actionnable: decideLots, horsGrille: true },
    { champ: 'lots_bloques', domaine: 'QUALITE', libelle: 'Lots bloqués', valeur: nl('lots_bloques'), ton: 'danger', Icone: Lock, vers: '/lots?vue=bloques', actionnable: decideLots, horsGrille: true },
    { champ: 'lots_en_derive', domaine: 'QUALITE', libelle: 'Lots en dérive de poids', valeur: nl('lots_en_derive'), ton: 'alerte', Icone: Scale, vers: '/lots?vue=derive', actionnable: lisStock, horsGrille: true },
    { champ: 'autorisations_en_attente', domaine: 'STOCK', libelle: 'Autorisations à donner', valeur: nl('autorisations_en_attente'), ton: 'danger', Icone: ShieldCheck, vers: '/autorisations', actionnable: decideLots, horsGrille: true },
    { champ: 'nb_controles_bloquants', domaine: 'QUALITE', libelle: 'Contrôles bloquants', valeur: nn('nb_controles_bloquants'), ton: 'danger', Icone: AlertTriangle, vers: '/controles', actionnable: true },
  ]
  const mesFiles = files
    .filter((f) => (f.horsGrille || droits.visible(f.champ)) && f.actionnable && f.valeur > 0)
    .sort((x, y) => (x.ton === 'danger' ? 0 : 1) - (y.ton === 'danger' ? 0 : 1))
  return {
    files: mesFiles,
    chargement: qKpi.isLoading,
    erreur: qKpi.isError,
  }
}

/** Un panneau du tableau de bord : titre, sous-titre, lien vers l'écran d'action. */
export function Bloc({
  titre,
  sousTitre,
  lien,
  className,
  corpsSansMarge,
  children,
}: {
  titre: string
  sousTitre?: string
  lien?: { vers: string; libelle: string }
  className?: string
  corpsSansMarge?: boolean
  children: React.ReactNode
}) {
  return (
    <Carte className={cn('flex min-w-0 flex-col', className)}>
      <CarteEntete className="items-start">
        <div className="min-w-0">
          <CarteTitre>{titre}</CarteTitre>
          {sousTitre && <p className="mt-0.5 text-[11.5px] text-attenue-texte">{sousTitre}</p>}
        </div>
        {lien && (
          <Link to={lien.vers} className="inline-flex shrink-0 items-center gap-1 text-[12px] text-primaire hover:underline">
            {lien.libelle} <ArrowRight className="size-3" />
          </Link>
        )}
      </CarteEntete>
      <CarteCorps className={cn('flex-1', corpsSansMarge ? 'p-0' : 'p-4')}>{children}</CarteCorps>
    </Carte>
  )
}

/**
 * UNE PANNE N'EST PAS UNE BONNE NOUVELLE (08/10/2026). Aucune page du tableau
 * de bord ne testait l'echec d'une requete : serveur coupe ou route en erreur,
 * l'ecran tombait sur sa branche « liste vide » et affichait en vert « aucune
 * anomalie », « rien ne descend sous le stock de securite ». Desormais il dit
 * qu'il ne sait pas.
 */
export function EnPanne({ quoi }: { quoi?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-[13px] text-danger" role="alert">
      <CloudOff className="size-4 shrink-0" />
      {quoi ? `${quoi} : ` : ''}données indisponibles — le serveur n'a pas répondu. Rien n'est affirmé ici ; réessayez dans un instant.
    </div>
  )
}

export function Vide({ texte, ok }: { texte: string; ok?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 p-4 text-[13px]', ok ? 'text-succes' : 'text-attenue-texte')}>
      {ok && <CheckCircle2 className="size-4 shrink-0" />}
      {texte}
    </div>
  )
}

/** La marge de décision : négative, il est déjà trop tard pour commander à temps. */
export function Marge({ jours }: { jours: number | null }) {
  if (jours == null) return <span className="text-attenue-texte">—</span>
  const ton = jours < 0 ? 'danger' : jours < 15 ? 'alerte' : 'succes'
  return (
    <span
      className={cn(
        'inline-flex min-w-16 justify-end rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-semibold tabular-nums',
        ton === 'danger' ? 'bg-danger/10 text-danger' : ton === 'alerte' ? 'bg-alerte/12 text-alerte' : 'bg-succes/10 text-succes',
      )}
    >
      {jours < 0 ? `${jours} j` : `+${jours} j`}
    </span>
  )
}

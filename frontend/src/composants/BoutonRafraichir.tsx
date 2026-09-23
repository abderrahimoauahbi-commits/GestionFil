/**
 * LE BOUTON « RAFRAICHIR » DES ECRANS CALCULES.
 *
 * DEUX FRAICHEURS SE CONFONDENT A L'ECRAN, et c'est ce qui trompe :
 *
 *  1. CE QUE LE NAVIGATEUR A EN MEMOIRE. Les ecrans gardent leur reponse
 *     quelques minutes pour ne pas redemander cent fois la meme chose. Changez
 *     un prix dans un onglet, l'autre onglet continue d'afficher l'ancien.
 *     Rien n'est faux dans la base — c'est la page qui est en retard.
 *
 *  2. CE QUE LA BASE A FIGE. Les besoins du MRP sont une PHOTO : ils ne se
 *     recalculent pas quand une recette, une densite ou le plan changent. Le
 *     stock, lui, est lu en direct. Un tableau tout vert peut donc n'etre que
 *     le reflet d'un calcul qu'on n'a pas relance — et l'erreur va toujours
 *     dans le sens rassurant.
 *
 * Un seul bouton repond aux deux, dans cet ordre : on recalcule d'abord ce qui
 * est fige, on recharge ensuite ce qui est affiche. L'inverse rechargerait
 * l'ancien calcul.
 *
 * CE QU'IL NE FAIT PAS : recalculer les PRIX. Depuis 2026-09-18e, le CMUP suit
 * le prix catalogue et le taux de change tout seul, par declencheur — il n'y a
 * rien a relancer. Le prix change, la valorisation, le cout des qualites et le
 * plan d'achat suivent a la lecture suivante. Ce bouton ne fait que provoquer
 * cette lecture.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Bouton } from './ui/base'

/**
 * LES ECRANS QUI CALCULENT, et eux seuls.
 *
 * Le bouton se place tout seul, comme l'aide d'ecran : aucun ecran n'a a le
 * declarer, donc aucun ne peut l'oublier — et un ecran de SAISIE ne l'affiche
 * pas, ou il n'aurait aucun sens (on n'y rafraichit pas, on y enregistre).
 */
const ECRANS_CALCULES = new Set([
  '/tableau-de-bord',
  '/besoins',
  '/plan-achat',
  '/valorisation',
  '/statistiques',
  '/classification',
  '/controles',
  '/stock',
  '/etat-stock',
  '/rapports',
  '/landed-cost',
  '/matrice-prix',
  '/historique-prix',
  '/qualites',
  '/recettes',
  '/equivalences',
])

/**
 * L'en-tete a besoin de la reponse AVANT de dessiner : sans elle, il reserverait
 * une ligne d'actions vide sur les ecrans qui n'en ont pas — visible sur
 * telephone, ou cette ligne occupe toute la largeur.
 */
export function useEcranCalcule() {
  const { pathname } = useLocation()
  return ECRANS_CALCULES.has(pathname)
}

export function BoutonRafraichir() {
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const { peut } = useAuth()

  // Le calcul MRP s'ECRIT dans la base : il demande MRP/ECRIRE, exactement ce
  // que le serveur exige. Qui ne l'a pas garde le bouton — il rechargera
  // simplement l'affichage, ce a quoi tout compte connecte a droit.
  const peutCalculer = peut('MRP', 'ECRIRE')

  // La fraicheur des besoins vient du cockpit, qui la porte deja. On ne la
  // demande que sur les ecrans concernes, et on tolere l'echec : un role sans
  // COCKPIT doit garder son bouton.
  const qEtat = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<Record<string, unknown>>('/api/cockpit'),
    enabled: ECRANS_CALCULES.has(pathname) && peutCalculer,
    retry: false,
    staleTime: 30_000,
  })
  const perimes = Number(qEtat.data?.besoins_perimes ?? 0) > 0

  const rafraichir = useMutation({
    mutationFn: async () => {
      let recalcul: string | null = null
      if (perimes && peutCalculer) {
        // Le plan en cours est le seul dont les besoins servent aux ecrans.
        const plans = await api.get<{ id_plan: string; statut: string }[]>('/api/plans')
        const courant = plans.find((p) => p.statut === 'EN_COURS')
        if (courant) {
          const r = await api.post<{ lignes_generees: number; total_kg: number }>(
            `/api/plans/${courant.id_plan}/mrp`,
          )
          recalcul = `${r.lignes_generees} besoin(s) recalcule(s)`
        }
      }
      return recalcul
    },
    // LE RECHARGEMENT VIENT APRES LE CALCUL, ET IL EST TOTAL. Viser quelques
    // cles laisserait derriere celles qu'on aurait oubliees — et ce bouton
    // existe precisement pour n'avoir plus rien a oublier.
    onSuccess: async (recalcul) => {
      await qc.invalidateQueries()
      toast.success(recalcul ? `A jour — ${recalcul}` : 'Ecran a jour')
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : String(e)),
  })

  if (!ECRANS_CALCULES.has(pathname)) return null

  return (
    <Bouton
      variante={perimes ? 'principal' : 'contour'}
      taille="sm"
      onClick={() => rafraichir.mutate()}
      chargement={rafraichir.isPending}
      title={
        perimes
          ? 'Une recette, une densite ou le plan a change : recalculer les besoins, puis recharger'
          : 'Recharger les chiffres de cet ecran depuis la base'
      }
    >
      <RefreshCw />
      {perimes ? 'Recalculer' : 'Rafraichir'}
    </Bouton>
  )
}

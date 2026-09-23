/**
 * REVENIR EN ARRIERE SUR UN DOCUMENT.
 *
 * POURQUOI UN SEUL COMPOSANT POUR SIX ECRANS. Devalider un bon de commande,
 * rouvrir un inventaire clos, ramener un plan en brouillon : ce sont les memes
 * trois questions — ai-je le droit, l'etat actuel le permet-il, pourquoi. Les
 * ecrire six fois, c'est garantir qu'un jour cinq ecrans diront une chose et le
 * sixieme une autre.
 *
 * LE BOUTON NE PARAIT QUE LA OU IL ABOUTIRA. Le serveur publie en `/api/devalider`
 * la liste de ce qu'il sait faire reculer et depuis quel etat ; l'ecran s'y
 * conforme au lieu de deviner. Proposer un geste qui sera refuse est pire que ne
 * rien proposer : l'utilisateur essaie, echoue, et cesse de croire l'interface.
 *
 * LE RETOUR EN ARRIERE EST UN ACTE DE DIRECTION. Valider se delegue ; defaire la
 * validation d'un autre, non — c'est la regle du serveur, et l'ecran la reflete
 * pour ne pas tendre un bouton qui se fermera au nez du magasinier.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'

import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { ActionMotivee } from './ActionMotivee'
import { Bouton } from './ui/base'

interface Reversible {
  document: string
  module: string
  depuis: string[]
  vers: string
  touche_le_stock: boolean
}

/** Ce que le serveur sait faire reculer. Une fois pour toute la session. */
export function useReversibles() {
  return useQuery({
    queryKey: ['devalider'],
    queryFn: () => api.get<Reversible[]>('/api/devalider'),
    staleTime: Infinity,
  })
}

const VERS_LISIBLE: Record<string, string> = {
  BROUILLON: 'brouillon',
  A_CONTROLER: 'a controler',
  EN_COURS: 'en cours',
  ACTIF: 'actif',
}

export function BoutonDevalider({
  document,
  id,
  statut,
  /** Ce que le retour en arriere defait, dit dans les mots du document. */
  consequence,
  taille = 'sm',
}: {
  document: string
  id: string | undefined
  statut: string | undefined
  consequence?: React.ReactNode
  taille?: 'sm' | 'md'
}) {
  const { moi } = useAuth()
  const { data } = useReversibles()
  const [ouvert, setOuvert] = useState(false)

  const r = data?.find((x) => x.document === document)
  const direction = moi?.role === 'ADMIN' || moi?.role === 'DIRECTION'
  if (!r || !id || !statut || !direction || !r.depuis.includes(statut)) return null

  const vers = VERS_LISIBLE[r.vers] ?? r.vers.toLowerCase()

  return (
    <>
      <Bouton variante="contour" taille={taille} onClick={() => setOuvert(true)}>
        <RotateCcw />
        Devalider
      </Bouton>

      <ActionMotivee
        ouvert={ouvert}
        surFermeture={() => setOuvert(false)}
        titre="Revenir en arriere sur ce document"
        description={`Il repassera de « ${statut} » a « ${r.vers} ».`}
        libelleBouton="Devalider"
        chemin={`/api/devalider/${document}/${id}`}
        consequence={
          <>
            Le document redevient <strong>{vers}</strong> et pourra etre corrige, puis validé a
            nouveau. Sa date et son auteur de validation sont effaces ; le journal, lui, garde
            trace du passage — avec votre nom, l'heure et la raison ci-dessous.
            {consequence ? <> {consequence}</> : null}
            {r.touche_le_stock && (
              <>
                {' '}
                <strong>Si ce document a deja bouge du stock</strong>, le retour sera refuse :
                contre-passez d'abord ses mouvements, sinon le magasin ne correspondrait plus a
                aucun papier.
              </>
            )}
          </>
        }
      />
    </>
  )
}

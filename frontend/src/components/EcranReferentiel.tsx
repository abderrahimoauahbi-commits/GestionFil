/**
 * Ecran CRUD complet pour une entite du registre generique.
 *
 * Liste triable et paginee, recherche, creation, modification, desactivation —
 * le tout pilote par les droits : le bouton de creation n'apparait pas sans
 * permission d'ecriture, les colonnes suivent la grille de champs, et le
 * formulaire desactive ce que l'utilisateur ne peut pas modifier.
 */
import { useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDroits } from '../auth/AuthContext'
import { useCrud } from '../hooks/useCrud'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Bouton } from '../composants/ui/base'
import {
  Menu,
  MenuContenu,
  MenuDeclencheur,
  MenuElement,
  useConfirmation,
} from '../composants/ui/surcouches'
import { Formulaire, Panneau, type ChampDef } from './Formulaire'

interface Props<L extends Record<string, unknown>> {
  titre: string
  sous_titre?: string
  module: string
  chemin: string
  cle: string
  colonnes: ColonneDT<L>[]
  champs: ChampDef[]
  filtres?: Record<string, string>
  libelleUnite?: string
  titreCarte?: (ligne: L) => React.ReactNode
}

export function EcranReferentiel<L extends Record<string, unknown>>({
  titre,
  sous_titre,
  module,
  chemin,
  cle,
  colonnes,
  champs,
  filtres = {},
  libelleUnite = 'enregistrement',
  titreCarte,
}: Props<L>) {
  const droits = useDroits(module)
  const [edition, setEdition] = useState<L | null>(null)
  const [creation, setCreation] = useState(false)
  const confirmation = useConfirmation()

  const crud = useCrud<L>(chemin, filtres)

  const fermer = () => {
    setEdition(null)
    setCreation(false)
    crud.reinitialiser()
  }

  function enregistrer(donnees: Record<string, unknown>) {
    const suite = {
      onSuccess: () => {
        toast.success(creation ? `${libelleUnite} cree.` : 'Modifications enregistrees.')
        fermer()
      },
    }
    if (creation) crud.creer.mutate(donnees, suite)
    else if (edition) crud.modifier.mutate({ id: String(edition[cle]), donnees }, suite)
  }

  function demanderSuppression(ligne: L) {
    const nom = String(ligne[cle])
    confirmation.demander({
      titre: `Desactiver ${nom} ?`,
      description:
        "L'enregistrement reste consultable dans l'historique : les mouvements et commandes " +
        'qui le citent continuent de fonctionner.',
      destructif: true,
      libelleConfirmer: 'Desactiver',
      action: () =>
        crud.supprimer.mutate(nom, {
          onSuccess: () => toast.success(`${nom} desactive.`),
          onError: (e) => toast.error(e instanceof Error ? e.message : 'Suppression impossible.'),
        }),
    })
  }

  const actions = droits.peutEcrire
    ? (ligne: L) => (
        <Menu>
          <MenuDeclencheur asChild>
            <Bouton variante="discret" taille="icone" aria-label="Actions">
              <MoreHorizontal />
            </Bouton>
          </MenuDeclencheur>
          <MenuContenu>
            <MenuElement
              onSelect={() => {
                crud.reinitialiser()
                setEdition(ligne)
              }}
            >
              <Pencil />
              Modifier
            </MenuElement>
            {ligne.actif !== 0 && (
              <MenuElement destructif onSelect={() => demanderSuppression(ligne)}>
                <Trash2 />
                Desactiver
              </MenuElement>
            )}
          </MenuContenu>
        </Menu>
      )
    : undefined

  return (
    <div>
      <EnTetePage
        titre={titre}
        description={sous_titre ?? `${crud.liste.data?.length ?? 0} ${libelleUnite}(s)`}
        actions={
          droits.peutEcrire && (
            <Bouton
              onClick={() => {
                crud.reinitialiser()
                setCreation(true)
              }}
            >
              <Plus />
              Nouveau
            </Bouton>
          )
        }
      />

      <DataTable<L>
        module={module}
        colonnes={colonnes}
        lignes={crud.liste.data}
        chargement={crud.liste.isLoading}
        cle={(l) => String(l[cle])}
        actions={actions}
        titreCarte={titreCarte}
        placeholderRecherche={`Filtrer les ${libelleUnite}s...`}
        videTitre={`Aucun ${libelleUnite}`}
        videDescription={
          droits.peutEcrire ? 'Commencez par en creer un.' : undefined
        }
        videAction={
          droits.peutEcrire && (
            <Bouton variante="contour" onClick={() => setCreation(true)}>
              <Plus />
              Nouveau {libelleUnite}
            </Bouton>
          )
        }
      />

      {(creation || edition) && (
        <Panneau
          titre={creation ? `Nouveau ${libelleUnite}` : `Modifier ${String(edition?.[cle])}`}
          sous_titre={
            creation
              ? undefined
              : 'Les champs grises sont des identifiants ou des valeurs calculees.'
          }
          surFermeture={fermer}
        >
          <Formulaire
            module={module}
            champs={champs}
            valeurs={creation ? {} : (edition as Record<string, unknown>)}
            creation={creation}
            enCours={crud.enCours}
            erreur={crud.erreur}
            surAnnuler={fermer}
            surValider={enregistrer}
            libelleValider={creation ? 'Creer' : 'Enregistrer'}
          />
        </Panneau>
      )}

      {confirmation.element}
    </div>
  )
}

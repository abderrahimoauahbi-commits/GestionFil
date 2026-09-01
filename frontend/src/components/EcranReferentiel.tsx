/**
 * Ecran CRUD complet pour une entite du registre generique.
 *
 * Liste triable et paginee, recherche, creation, modification, desactivation —
 * le tout pilote par les droits : le bouton de creation n'apparait pas sans
 * permission d'ecriture, les colonnes suivent la grille de champs, et le
 * formulaire desactive ce que l'utilisateur ne peut pas modifier.
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDroits } from '../auth/AuthContext'
import { useCrud } from '../hooks/useCrud'
import { EnTetePage } from '../composants/Coquille'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { Bouton, Carte, CarteCorps } from '../composants/ui/base'
import {
  Menu,
  MenuContenu,
  MenuDeclencheur,
  MenuElement,
  useConfirmation,
} from '../composants/ui/surcouches'
import { Formulaire, type ChampDef } from './Formulaire'

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
  /**
   * Actions propres a l'ecran, ajoutees au menu de ligne apres les actions
   * communes. Rendues seulement si l'utilisateur peut ecrire.
   */
  actionsExtra?: (ligne: L) => React.ReactNode
  /**
   * Delegue recherche, tri et pagination au serveur.
   *
   * A activer des qu'un referentiel peut depasser quelques milliers de lignes.
   * Sans lui, tout est charge puis filtre dans le navigateur : parfait sur 120
   * references, intenable sur 20 000.
   */
  serveur?: boolean
  /**
   * Valeur initiale de la recherche.
   *
   * Sert aux arrivees ciblees : « voir la fiche » depuis un autre ecran doit
   * poser l'utilisateur sur SA reference, pas sur la premiere page du
   * catalogue a lui de la retrouver. La valeur reste modifiable — c'est une
   * amorce, pas un verrou.
   */
  rechercheInitiale?: string
  /** Sujet du fichier CSV. Sa presence affiche le bouton d'export. */
  exportable?: string
  /** Titre de l'etat imprime. */
  imprimable?: string
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
  actionsExtra,
  serveur = false,
  rechercheInitiale = '',
  exportable,
  imprimable,
}: Props<L>) {
  const droits = useDroits(module)
  const [edition, setEdition] = useState<L | null>(null)
  const [creation, setCreation] = useState(false)
  const confirmation = useConfirmation()

  const [page, setPage] = useState(0)
  const [taille, setTaille] = useState(25)
  const [recherche, setRecherche] = useState(rechercheInitiale)
  // Resynchronise si l'amorce change sans que l'ecran soit remonte : hors
  // atelier, aller de `?reference=A` a `?reference=B` ne remonte rien.
  useEffect(() => setRecherche(rechercheInitiale), [rechercheInitiale])
  const [tri, setTri] = useState<{ champ: string | null; sens: 'asc' | 'desc' }>({
    champ: null,
    sens: 'asc',
  })

  /* Changer de filtre, de recherche ou de tri ramene a la premiere page :
     rester en page 7 d'un resultat qui n'en compte plus que 2 afficherait un
     tableau vide sans rien expliquer. */
  const filtresServeur = serveur
    ? {
        ...filtres,
        limite: String(taille),
        offset: String(page * taille),
        ...(recherche ? { recherche } : {}),
        ...(tri.champ ? { tri: tri.champ, sens: tri.sens } : {}),
      }
    : filtres

  const crud = useCrud<L>(chemin, filtresServeur)

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
            {actionsExtra?.(ligne)}
          </MenuContenu>
        </Menu>
      )
    : undefined

  /* Saisie en PAGE, pas en panneau lateral.
     Une fiche de catalogue porte une vingtaine de champs ; dans un tiroir de
     420 px, ils s'empilent sur trois ecrans de haut et l'on perd de vue la
     liste comme le formulaire. La fiche prend donc toute la place, et la liste
     s'efface le temps de la saisie. Rien ne change cote droits : le formulaire
     est le meme, et c'est le serveur qui tranche a l'enregistrement. */
  if (creation || edition) {
    return (
      <div>
        <EnTetePage
          titre={creation ? `Nouveau ${libelleUnite}` : `${String(edition?.[cle])}`}
          description={
            creation
              ? `Creation d'un ${libelleUnite}`
              : 'Les champs grises sont des identifiants ou des valeurs calculees.'
          }
          actions={
            <Bouton variante="contour" onClick={fermer}>
              <ArrowLeft />
              Retour a la liste
            </Bouton>
          }
        />

        <Carte>
          <CarteCorps>
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
          </CarteCorps>
        </Carte>

        {confirmation.element}
      </div>
    )
  }

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
        exportable={exportable}
        imprimable={imprimable}
        module={module}
        colonnes={colonnes}
        lignes={crud.liste.data}
        chargement={crud.liste.isLoading}
        cle={(l) => String(l[cle])}
        actions={actions}
        titreCarte={titreCarte}
        placeholderRecherche={`Filtrer les ${libelleUnite}s...`}
        serveur={
          serveur
            ? {
                total: crud.total ?? 0,
                page,
                taille,
                surPage: setPage,
                surTaille: (t) => {
                  setTaille(t)
                  setPage(0)
                },
                surRecherche: (m) => {
                  setRecherche(m)
                  setPage(0)
                },
                surTri: (champ, sens) => {
                  setTri({ champ, sens })
                  setPage(0)
                },
              }
            : undefined
        }
        videTitre={`Aucun ${libelleUnite}`}
        videDescription={droits.peutEcrire ? 'Commencez par en creer un.' : undefined}
        videAction={
          droits.peutEcrire && (
            <Bouton variante="contour" onClick={() => setCreation(true)}>
              <Plus />
              Nouveau {libelleUnite}
            </Bouton>
          )
        }
      />

      {confirmation.element}
    </div>
  )
}

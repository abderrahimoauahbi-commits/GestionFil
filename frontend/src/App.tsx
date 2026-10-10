import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Verrou } from './auth/Verrou'
import { FournisseurTheme, useTheme } from './composants/Theme'
import { FournisseurApparence } from './composants/Apparence'
import { Coquille } from './composants/Coquille'
import { Alerte, Chargement } from './composants/ui/base'
import { FournisseurInfobulle } from './composants/ui/surcouches'
import { Connexion } from './pages/Connexion'
const HistoriquePrix = lazy(() => import('./pages/HistoriquePrix').then((m) => ({ default: m.HistoriquePrix })))
const BonCommandeEtat = lazy(() => import('./pages/BonCommandeEtat').then((m) => ({ default: m.BonCommandeEtat })))
const BonMouvement = lazy(() => import('./pages/BonMouvement').then((m) => ({ default: m.BonMouvement })))
const Telecharger = lazy(() => import('./pages/Telecharger').then((m) => ({ default: m.Telecharger })))
const GuideUtilisateur = lazy(() => import('./pages/GuideUtilisateur').then((m) => ({ default: m.GuideUtilisateur })))
const Chat = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })))
const Controles = lazy(() => import('./pages/Controles').then((m) => ({ default: m.Controles })))
const Etats = lazy(() => import('./pages/Etats').then((m) => ({ default: m.Etats })))
const EtatManuel = lazy(() => import('./pages/EtatManuel').then((m) => ({ default: m.EtatManuel })))
const FeuilleComptage = lazy(() => import('./pages/FeuilleComptage').then((m) => ({ default: m.FeuilleComptage })))
const EtatCatalogue = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatCatalogue })))
const EtatCategories = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatCategories })))
const EtatComptage = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatComptage })))
const EtatCouleur = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatCouleur })))
const EtatCouleurs = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatCouleurs })))
const EtatFournisseurs = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatFournisseurs })))
const EtatMouvements = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatMouvements })))
const EtatPlanAchat = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatPlanAchat })))
const EtatStockImprime = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatStockImprime })))
const EtatLots = lazy(() => import('./pages/EtatsListes').then((m) => ({ default: m.EtatLots })))
const EtatBesoins = lazy(() => import('./pages/EtatsDocuments').then((m) => ({ default: m.EtatBesoins })))
const EtatInventaire = lazy(() => import('./pages/EtatsDocuments').then((m) => ({ default: m.EtatInventaire })))
const EtatPlanProduction = lazy(() => import('./pages/EtatsDocuments').then((m) => ({ default: m.EtatPlanProduction })))
const EtatReception = lazy(() => import('./pages/EtatsDocuments').then((m) => ({ default: m.EtatReception })))
const AnalyseAbcXyz = lazy(() => import('./pages/AnalyseAbcXyz').then((m) => ({ default: m.AnalyseAbcXyz })))
const VueEnsemble = lazy(() => import('./pages/tableau-de-bord/VueEnsemble').then((m) => ({ default: m.VueEnsemble })))
const PageTableauDeBord = lazy(() => import('./pages/tableau-de-bord/Page').then((m) => ({ default: m.PageTableauDeBord })))
const CoutRevient = lazy(() => import('./pages/CoutRevient').then((m) => ({ default: m.CoutRevient })))
const RapportsFinanciers = lazy(() => import('./pages/RapportsFinanciers').then((m) => ({ default: m.RapportsFinanciers })))
const QualiteEtat = lazy(() => import('./pages/QualiteEtat').then((m) => ({ default: m.QualiteEtat })))
const MatricePrix = lazy(() => import('./pages/MatricePrix').then((m) => ({ default: m.MatricePrix })))
const Statistiques = lazy(() => import('./pages/Statistiques').then((m) => ({ default: m.Statistiques })))
const Equivalences = lazy(() => import('./pages/Equivalences').then((m) => ({ default: m.Equivalences })))
const Configuration = lazy(() => import('./pages/Configuration').then((m) => ({ default: m.Configuration })))
const TransfertNouveau = lazy(() => import('./pages/TransfertNouveau').then((m) => ({ default: m.TransfertNouveau })))
const BonTransfert = lazy(() => import('./pages/BonTransfert').then((m) => ({ default: m.BonTransfert })))
const Catalogue = lazy(() => import('./pages/Catalogue').then((m) => ({ default: m.Catalogue })))
const MouvementNouveau = lazy(() => import('./pages/MouvementNouveau').then((m) => ({ default: m.MouvementNouveau })))
const CompleterCatalogue = lazy(() => import('./pages/CompleterCatalogue').then((m) => ({ default: m.CompleterCatalogue })))
const Fournisseurs = lazy(() => import('./pages/Fournisseurs').then((m) => ({ default: m.Fournisseurs })))
const Referentiels = lazy(() => import('./pages/Referentiels').then((m) => ({ default: m.Referentiels })))
const Stock = lazy(() => import('./pages/Stock').then((m) => ({ default: m.Stock })))
const Machines = lazy(() => import('./pages/Machines').then((m) => ({ default: m.Machines })))
const MachineEcran = lazy(() => import('./pages/machines/Bureau').then((m) => ({ default: m.MachineEcran })))
const FicheMachine = lazy(() => import('./pages/machines/Fiche').then((m) => ({ default: m.FicheMachine })))
const NouvelleFicheMachine = lazy(() => import('./pages/machines/Fiche').then((m) => ({ default: m.NouvelleFicheMachine })))
const ParcMachines = lazy(() => import('./pages/ParcMachines').then((m) => ({ default: m.ParcMachines })))
const Accueil = lazy(() => import('./pages/Accueil').then((m) => ({ default: m.Accueil })))
const Mouvements = lazy(() => import('./pages/Mouvements').then((m) => ({ default: m.Mouvements })))
const Transferts = lazy(() => import('./pages/Transferts').then((m) => ({ default: m.Transferts })))
const Inventaires = lazy(() => import('./pages/Inventaires').then((m) => ({ default: m.Inventaires })))
const Qualites = lazy(() => import('./pages/Qualites').then((m) => ({ default: m.Qualites })))
const Recettes = lazy(() => import('./pages/Recettes').then((m) => ({ default: m.Recettes })))
const Plans = lazy(() => import('./pages/Plans').then((m) => ({ default: m.Plans })))
const Besoins = lazy(() => import('./pages/Besoins').then((m) => ({ default: m.Besoins })))
const BonsCommande = lazy(() => import('./pages/BonsCommande').then((m) => ({ default: m.BonsCommande })))
const BonCommande = lazy(() => import('./pages/BonCommande').then((m) => ({ default: m.BonCommande })))
const AssistantImport = lazy(() => import('./pages/import/AssistantImport').then((m) => ({ default: m.AssistantImport })))
const LecturePiece = lazy(() => import('./pages/import/LecturePiece').then((m) => ({ default: m.LecturePiece })))
const DossiersImport = lazy(() => import('./pages/import/DossiersImport').then((m) => ({ default: m.DossiersImport })))
const DossierImport = lazy(() => import('./pages/import/DossierImport').then((m) => ({ default: m.DossierImport })))
const FactureImport = lazy(() => import('./pages/import/FactureImport').then((m) => ({ default: m.FactureImport })))
const ReceptionImport = lazy(() => import('./pages/import/ReceptionImport').then((m) => ({ default: m.ReceptionImport })))
const ReceptionsImport = lazy(() => import('./pages/import/ReceptionsImport').then((m) => ({ default: m.ReceptionsImport })))
const BonCommandeNouveau = lazy(() => import('./pages/BonCommandeNouveau').then((m) => ({ default: m.BonCommandeNouveau })))
const Receptions = lazy(() => import('./pages/Receptions').then((m) => ({ default: m.Receptions })))
const Reception = lazy(() => import('./pages/Reception').then((m) => ({ default: m.Reception })))
const ReceptionNouvelle = lazy(() => import('./pages/ReceptionNouvelle').then((m) => ({ default: m.ReceptionNouvelle })))
const PlanAchat = lazy(() => import('./pages/PlanAchat').then((m) => ({ default: m.PlanAchat })))
const Utilisateurs = lazy(() => import('./pages/Utilisateurs').then((m) => ({ default: m.Utilisateurs })))
const Droits = lazy(() => import('./pages/Droits').then((m) => ({ default: m.Droits })))
const Valorisation = lazy(() => import('./pages/Valorisation').then((m) => ({ default: m.Valorisation })))
const EtatStock = lazy(() => import('./pages/EtatStock').then((m) => ({ default: m.EtatStock })))
const Lots = lazy(() => import('./pages/lots/Lots').then((m) => ({ default: m.Lots })))
const FicheLot = lazy(() => import('./pages/lots/FicheLot').then((m) => ({ default: m.FicheLot })))
const Autorisations = lazy(() => import('./pages/lots/Autorisations').then((m) => ({ default: m.Autorisations })))
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })))
const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.Audit })))

/* LES ECRANS SE CHARGENT A LA DEMANDE (audit v4, P3) : le paquet initial
   portait les soixante-dix ecrans, 1,6 Mo a lire avant le premier affichage,
   lourd sur une tablette de magasin. La coquille les attend dans un Suspense
   et une barriere d'erreur (composants/Coquille.tsx). */
const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Les vues de pilotage sont recalculees a chaque appel ; 30 s de cache
      // evitent de marteler le serveur pendant la navigation.
      staleTime: 30_000,
      retry: (echecs, erreur) => {
        // Inutile de reessayer un refus de droits ou une regle metier.
        const statut = (erreur as { statut?: number })?.statut
        if (statut && statut >= 400 && statut < 500) return false
        return echecs < 2
      },
    },
  },
})

function Protege({ children }: { children: React.ReactNode }) {
  const { moi, chargement } = useAuth()
  if (chargement) return <Chargement />
  if (!moi) return <Navigate to="/connexion" replace />
  return <>{children}</>
}

/** Refuse l'ecran si le module n'est pas accessible en lecture. */
function ExigeModule({ module, children }: { module: string; children: React.ReactNode }) {
  const { peut } = useAuth()
  if (!peut(module, 'LIRE')) {
    return (
      <Alerte ton="danger" titre="Accès refusé">
        Vous n'avez pas les droits de lecture sur le module {module}.
      </Alerte>
    )
  }
  return <>{children}</>
}

/** Les notifications suivent le theme : un toast blanc sur fond sombre eblouit.
 *
 * EN HAUT A DROITE, SOUS L'EN-TETE (10/10/2026) : en bas a droite, elles
 * recouvraient les barres d'actions collantes (« Enregistrer », « Creer le
 * bon »…) au moment meme ou l'on voulait cliquer. Le message rouge sur la page
 * reste ; la notification ne cache plus rien. */
function Notifications() {
  const { resolu } = useTheme()
  return (
    <Toaster
      theme={resolu === 'sombre' ? 'dark' : 'light'}
      position="top-right"
      offset={{ top: 56, right: 16 }}
      mobileOffset={{ top: 56 }}
      richColors
      closeButton
      toastOptions={{ style: { fontSize: '0.875rem' } }}
    />
  )
}

/**
 * Ecrans de l’application, extraits du bloc <Routes> pour etre montes deux fois :
 * par la coquille tactile via <Outlet/> sur le web, et une fois par onglet dans
 * l’atelier de bureau. Le fourre-tout differe entre les deux et reste donc en
 * dehors de cette liste.
 */
const ECRANS = (
  <>
      {/* L ACCUEIL N A PAS DE GARDE, et c est necessaire : protege par COCKPIT,
          il renvoyait « Acces refuse » a l assistante des qu on lui a retire le
          tableau de bord. Un ERP ne peut pas ouvrir sur un refus. La page ne
          montre de toute facon que les ecrans deja ouverts a celui qui regarde. */}
      <Route index element={<Accueil />} />
      {/* QUATRE PAGES SOUS UNE MEME ENTREE, chacune avec son adresse.
          Synthese, analytique, opportunites et matiere ne se melangent plus
          derriere une seule porte : chacune se met en signet, se retrouve au
          menu, et s'ouvre dans son propre onglet. C'est l'organisation des
          espaces Fiori et des menus d'application Odoo. */}
      {/* LA VUE D'ENSEMBLE (06/10/2026) ouvre le tableau de bord ; les autres
          pages (risques et files, analyse, opportunites, matiere) gardent leur
          adresse sous /tableau-de-bord/:vue. */}
      <Route path="tableau-de-bord"
             element={<ExigeModule module="COCKPIT"><VueEnsemble /></ExigeModule>} />
      <Route path="tableau-de-bord/:vue"
             element={<ExigeModule module="COCKPIT"><PageTableauDeBord /></ExigeModule>} />
      <Route path="catalogue" element={<ExigeModule module="CATALOGUE"><Catalogue /></ExigeModule>} />
      <Route path="catalogue/completer" element={<ExigeModule module="CATALOGUE"><CompleterCatalogue /></ExigeModule>} />
      <Route path="stock" element={<ExigeModule module="STOCK"><Stock /></ExigeModule>} />
      <Route path="chat" element={<ExigeModule module="COCKPIT"><Chat /></ExigeModule>} />
      <Route path="telecharger" element={<ExigeModule module="COCKPIT"><Telecharger /></ExigeModule>} />
      {/* PAS D'`ExigeModule` ICI : la documentation n'est pas un module de
          l'ERP, et son entree de menu porte `module: ''`. L'exiger aurait
          rendu le guide invisible a qui en a le plus besoin — un magasinier
          qui n'a que STOCK. Le `Verrou` d'authentification suffit. */}
      <Route path="guide-utilisateur" element={<GuideUtilisateur />} />
      <Route path="machines" element={<ExigeModule module="STOCK"><Machines /></ExigeModule>} />
      {/* UNE MACHINE, UNE FICHE : chacune son ecran et son adresse, jamais une fenetre surgissante. */}
      <Route path="machines/fiches/:id" element={<ExigeModule module="STOCK"><FicheMachine /></ExigeModule>} />
      <Route path="machines/:code" element={<ExigeModule module="STOCK"><MachineEcran /></ExigeModule>} />
      <Route path="machines/:code/fiche/:type/:zone" element={<ExigeModule module="STOCK"><NouvelleFicheMachine /></ExigeModule>} />
      {/* LE PARC EST DU PARAMETRAGE, pas de l exploitation : module PARAMETRES,
          donc la direction et les super-utilisateurs. */}
      <Route path="parc-machines" element={<ExigeModule module="PARAMETRES"><ParcMachines /></ExigeModule>} />
      <Route path="mouvements" element={<ExigeModule module="MOUVEMENTS"><Mouvements /></ExigeModule>} />
      <Route path="mouvements/nouveau" element={<ExigeModule module="MOUVEMENTS"><MouvementNouveau /></ExigeModule>} />
      <Route path="mouvements/:id" element={<ExigeModule module="MOUVEMENTS"><BonMouvement /></ExigeModule>} />
      <Route path="transferts" element={<ExigeModule module="MOUVEMENTS"><Transferts /></ExigeModule>} />
      <Route path="inventaires" element={<ExigeModule module="INVENTAIRE"><Inventaires /></ExigeModule>} />
      <Route path="receptions" element={<ExigeModule module="RECEPTIONS"><Receptions /></ExigeModule>} />
      <Route path="import" element={<ExigeModule module="IMPORT"><DossiersImport /></ExigeModule>} />
      <Route path="import/assistant" element={<ExigeModule module="IMPORT"><AssistantImport /></ExigeModule>} />
      <Route path="import/:id" element={<ExigeModule module="IMPORT"><DossierImport /></ExigeModule>} />
      <Route path="import/:id/pieces/:idPiece" element={<ExigeModule module="IMPORT"><LecturePiece /></ExigeModule>} />
      <Route path="import/:id/factures/:idFacture" element={<ExigeModule module="IMPORT"><FactureImport /></ExigeModule>} />
      {/* La reception d'import est A PART du dossier : sa liste, son ecran, et
          le module RECEPTIONS — le magasinier y a ses droits, sans voir les prix. */}
      <Route path="receptions-import" element={<ExigeModule module="RECEPTIONS"><ReceptionsImport /></ExigeModule>} />
      <Route path="receptions-import/:idReception" element={<ExigeModule module="RECEPTIONS"><ReceptionImport /></ExigeModule>} />
      <Route path="transferts/nouveau" element={<ExigeModule module="MOUVEMENTS"><TransfertNouveau /></ExigeModule>} />
      <Route path="transferts/:id/modifier" element={<ExigeModule module="MOUVEMENTS"><TransfertNouveau /></ExigeModule>} />
      <Route path="transferts/:id/bon-sortie" element={<ExigeModule module="MOUVEMENTS"><BonTransfert type="sortie" /></ExigeModule>} />
      <Route path="transferts/:id/bon-reception" element={<ExigeModule module="MOUVEMENTS"><BonTransfert type="reception" /></ExigeModule>} />
      <Route path="configuration" element={<ExigeModule module="PARAMETRES"><Configuration /></ExigeModule>} />
      <Route path="equivalences" element={<ExigeModule module="CATALOGUE"><Equivalences /></ExigeModule>} />
      <Route path="etats" element={<ExigeModule module="COCKPIT"><Etats /></ExigeModule>} />
      <Route path="etats/stock" element={<ExigeModule module="STOCK"><EtatStockImprime /></ExigeModule>} />
      <Route path="etats/lots" element={<ExigeModule module="LOTS"><EtatLots /></ExigeModule>} />
      <Route path="etats/comptage" element={<ExigeModule module="INVENTAIRE"><EtatComptage /></ExigeModule>} />
      <Route path="etats/plan-achat" element={<ExigeModule module="PLAN_ACHAT"><EtatPlanAchat /></ExigeModule>} />
      {/* Les etats de DOCUMENT portent l'identifiant de leur objet : ils
          s'ouvrent depuis la ligne, pas depuis un selecteur. Le segment reste
          optionnel pour que l'adresse nue propose encore le choix. */}
      <Route path="etats/receptions/:id" element={<ExigeModule module="RECEPTIONS"><EtatReception /></ExigeModule>} />
      {/* La feuille qu'on emporte POUR compter, distincte du proces-verbal qui
          confronte APRES coup le compte au theorique. */}
      <Route path="etats/inventaire/:id/comptage" element={<ExigeModule module="INVENTAIRE"><FeuilleComptage /></ExigeModule>} />
      <Route path="etats/inventaire/:id" element={<ExigeModule module="INVENTAIRE"><EtatInventaire /></ExigeModule>} />
      <Route path="etats/plan-production/:id" element={<ExigeModule module="PLANS"><EtatPlanProduction /></ExigeModule>} />
      <Route path="etats/besoins/:id" element={<ExigeModule module="MRP"><EtatBesoins /></ExigeModule>} />
      <Route path="etats/qualite/:code" element={<ExigeModule module="QUALITES"><QualiteEtat /></ExigeModule>} />
      <Route path="etats/receptions" element={<ExigeModule module="RECEPTIONS"><EtatReception /></ExigeModule>} />
      <Route path="etats/inventaire" element={<ExigeModule module="INVENTAIRE"><EtatInventaire /></ExigeModule>} />
      <Route path="etats/plan-production" element={<ExigeModule module="PLANS"><EtatPlanProduction /></ExigeModule>} />
      <Route path="etats/besoins" element={<ExigeModule module="MRP"><EtatBesoins /></ExigeModule>} />
      <Route path="etats/mouvements" element={<ExigeModule module="MOUVEMENTS"><EtatMouvements /></ExigeModule>} />
      <Route path="etats/catalogue" element={<ExigeModule module="CATALOGUE"><EtatCatalogue /></ExigeModule>} />
      <Route path="etats/fournisseurs" element={<ExigeModule module="FOURNISSEURS"><EtatFournisseurs /></ExigeModule>} />
      {/* LE MANUEL EST SOUS COCKPIT, et non sous un module metier : tout le
          monde a le droit de lire le mode d'emploi de l'outil qu'il emploie.
          Chaque fiche, elle, ne decrit que des ecrans que le lecteur peut
          ouvrir — les droits par champ font le reste. */}
      <Route path="etats/manuel" element={<ExigeModule module="COCKPIT"><EtatManuel /></ExigeModule>} />
      <Route path="etats/categories" element={<ExigeModule module="CATALOGUE"><EtatCategories /></ExigeModule>} />
      <Route path="etats/couleurs" element={<ExigeModule module="CATALOGUE"><EtatCouleurs /></ExigeModule>} />
      {/* La fiche d'UNE couleur porte son code dans l'adresse : on peut y
          revenir, l'envoyer, la mettre en favori. L'adresse nue propose
          encore le choix, comme les autres etats de document. */}
      <Route path="etats/couleur/:code" element={<ExigeModule module="CATALOGUE"><EtatCouleur /></ExigeModule>} />
      <Route path="etats/couleur" element={<ExigeModule module="CATALOGUE"><EtatCouleur /></ExigeModule>} />
      <Route path="controles" element={<ExigeModule module="COCKPIT"><Controles /></ExigeModule>} />
      <Route path="matrice-prix" element={<ExigeModule module="CATALOGUE"><MatricePrix /></ExigeModule>} />
      <Route path="historique-prix" element={<ExigeModule module="CATALOGUE"><HistoriquePrix /></ExigeModule>} />
      <Route path="statistiques" element={<ExigeModule module="MOUVEMENTS"><Statistiques /></ExigeModule>} />
      <Route path="receptions/nouvelle" element={<ExigeModule module="RECEPTIONS"><ReceptionNouvelle /></ExigeModule>} />
      <Route path="receptions/:id" element={<ExigeModule module="RECEPTIONS"><Reception /></ExigeModule>} />
      <Route path="fournisseurs" element={<ExigeModule module="FOURNISSEURS"><Fournisseurs /></ExigeModule>} />
      {/* Trois portes sur le meme ecran, chacune reduite a son onglet.
          Categories et roles BOM sont ranges au Catalogue : ils decrivent le
          produit. `/referentiels` reste monte sans figurer au menu — c'est le
          seul endroit ou l'on CREE un groupe d'equivalence, et le supprimer
          rendrait les 93 groupes inadministrables. */}
      <Route path="categories" element={<ExigeModule module="CATALOGUE"><Referentiels cles={['categories']} /></ExigeModule>} />
      {/* LES COULEURS AVAIENT LEUR ECRAN SANS AVOIR DE PORTE. Le CRUD existait
          dans l'ecran des referentiels, mais aucun menu n'y menait : de
          l'exterieur, il n'existait pas. Meme code, meme CRUD, une adresse. */}
      <Route path="couleurs" element={<ExigeModule module="CATALOGUE"><Referentiels cles={['couleurs']} /></ExigeModule>} />
      <Route path="roles-bom" element={<ExigeModule module="CATALOGUE"><Referentiels cles={['roles-bom']} /></ExigeModule>} />
      <Route path="referentiels" element={<ExigeModule module="CATALOGUE"><Referentiels /></ExigeModule>} />
      <Route path="qualites" element={<ExigeModule module="QUALITES"><Qualites /></ExigeModule>} />
      <Route path="recettes" element={<ExigeModule module="RECETTES"><Recettes /></ExigeModule>} />
      <Route path="plans" element={<ExigeModule module="PLANS"><Plans /></ExigeModule>} />
      <Route path="besoins" element={<ExigeModule module="MRP"><Besoins /></ExigeModule>} />
      <Route path="plan-achat" element={<ExigeModule module="PLAN_ACHAT"><PlanAchat /></ExigeModule>} />
      <Route path="bons-commande" element={<ExigeModule module="BONS_COMMANDE"><BonsCommande /></ExigeModule>} />
      <Route path="bons-commande/nouveau" element={<ExigeModule module="BONS_COMMANDE"><BonCommandeNouveau /></ExigeModule>} />
      <Route path="bons-commande/:id/etat" element={<ExigeModule module="BONS_COMMANDE"><BonCommandeEtat /></ExigeModule>} />
      <Route path="bons-commande/:id" element={<ExigeModule module="BONS_COMMANDE"><BonCommande /></ExigeModule>} />
      <Route path="assistant" element={<ExigeModule module="COCKPIT"><Assistant /></ExigeModule>} />
      <Route path="etat-stock" element={<ExigeModule module="STOCK"><EtatStock /></ExigeModule>} />
      {/* Les lots (cahier du 02/10/2026) : trois vues de stock, les alertes,
          la fiche de vie et la file des autorisations. */}
      <Route path="lots" element={<ExigeModule module="LOTS"><Lots /></ExigeModule>} />
      <Route path="lots/fiche" element={<ExigeModule module="LOTS"><FicheLot /></ExigeModule>} />
      <Route path="autorisations" element={<ExigeModule module="LOTS"><Autorisations /></ExigeModule>} />
      <Route path="rapports" element={<ExigeModule module="VALORISATION"><RapportsFinanciers /></ExigeModule>} />
      <Route path="landed-cost" element={<ExigeModule module="VALORISATION"><CoutRevient /></ExigeModule>} />
      <Route path="classification" element={<ExigeModule module="STOCK"><AnalyseAbcXyz /></ExigeModule>} />
      <Route path="valorisation" element={<ExigeModule module="CATALOGUE"><Valorisation /></ExigeModule>} />
      <Route path="audit" element={<ExigeModule module="AUDIT"><Audit /></ExigeModule>} />
      <Route path="parametres" element={<Navigate to="/configuration" replace />} />
      <Route path="utilisateurs" element={<ExigeModule module="UTILISATEURS"><Utilisateurs /></ExigeModule>} />
      <Route path="utilisateurs/:id/droits" element={<ExigeModule module="UTILISATEURS"><Droits /></ExigeModule>} />
  </>
)


/**
 * UNE SEULE COQUILLE, POUR LE BUREAU COMME POUR LE NAVIGATEUR.
 *
 * L'APPLICATION INSTALLEE PORTAIT UN « ATELIER » calque sur un editeur de
 * code : barre de titre dessinee a la main, onglets, groupes fractionnables,
 * panneau bas, barre d'etat. C'etait une enveloppe de developpeur posee sur un
 * ERP, et cela se voyait — la fenetre ne se comportait plus comme les autres
 * fenetres du poste, et la barre laterale vivait sa propre vie.
 *
 * CE N'EST PAS CE QU'ON ATTEND D'UN ERP. Un magasinier, une assistante, un
 * directeur veulent une fenetre ordinaire, un menu a gauche, un ecran a la
 * fois. C'est ce que fait la coquille — la meme qu'au navigateur, avec les
 * memes rubriques, les memes sous-menus et les memes habitudes.
 *
 * L'ATELIER N'EST PLUS MONTE. Son code reste au depot le temps qu'on soit sur
 * que rien n'en manque, mais plus aucune adresse n'y mene.
 */
function Aiguillage() {
  return (
    <Routes>
      <Route path="/connexion" element={<Connexion />} />
      <Route
        element={
          <Protege>
            <Coquille />
          </Protege>
        }
      >
        {ECRANS}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <FournisseurTheme>
      <FournisseurApparence>
      <QueryClientProvider client={client}>
        <FournisseurInfobulle delayDuration={300}>
          <BrowserRouter>
            <AuthProvider>
              <Aiguillage />
              {/* AU-DESSUS DE TOUT, ecrans compris : un poste laisse sans
                  surveillance se couvre, quelle que soit la page ouverte. */}
              <Verrou />
              <Notifications />
            </AuthProvider>
          </BrowserRouter>
        </FournisseurInfobulle>
      </QueryClientProvider>
      </FournisseurApparence>
    </FournisseurTheme>
  )
}

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { FournisseurTheme, useTheme } from './composants/Theme'
import { Coquille } from './composants/Coquille'
import { Atelier } from './composants/atelier/Atelier'
import { estBureau } from './lib/utils'
import { Alerte, Chargement } from './composants/ui/base'
import { FournisseurInfobulle } from './composants/ui/surcouches'
import { Connexion } from './pages/Connexion'
import { Cockpit } from './pages/Cockpit'
import { Statistiques } from './pages/Statistiques'
import { Equivalences } from './pages/Equivalences'
import { Configuration } from './pages/Configuration'
import { TransfertNouveau } from './pages/TransfertNouveau'
import { BonTransfert } from './pages/BonTransfert'
import { Catalogue } from './pages/Catalogue'
import { Fournisseurs } from './pages/Fournisseurs'
import { Referentiels } from './pages/Referentiels'
import { Stock } from './pages/Stock'
import { Mouvements } from './pages/Mouvements'
import { Transferts } from './pages/Transferts'
import { Inventaires } from './pages/Inventaires'
import { Qualites } from './pages/Qualites'
import { Recettes } from './pages/Recettes'
import { Plans } from './pages/Plans'
import { Besoins } from './pages/Besoins'
import { BonsCommande } from './pages/BonsCommande'
import { BonCommande } from './pages/BonCommande'
import { BonCommandeNouveau } from './pages/BonCommandeNouveau'
import { Receptions } from './pages/Receptions'
import { Reception } from './pages/Reception'
import { ReceptionNouvelle } from './pages/ReceptionNouvelle'
import { PlanAchat } from './pages/PlanAchat'
import { Parametres } from './pages/Parametres'
import { Utilisateurs } from './pages/Utilisateurs'
import { Droits } from './pages/Droits'
import { Valorisation } from './pages/Valorisation'
import { EtatStock } from './pages/EtatStock'
import { Assistant } from './pages/Assistant'
import { Audit } from './pages/Audit'

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
      <Alerte ton="danger" titre="Acces refuse">
        Vous n'avez pas les droits de lecture sur le module {module}.
      </Alerte>
    )
  }
  return <>{children}</>
}

/** Les notifications suivent le theme : un toast blanc sur fond sombre eblouit. */
function Notifications() {
  const { resolu } = useTheme()
  return (
    <Toaster
      theme={resolu === 'sombre' ? 'dark' : 'light'}
      position="bottom-right"
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
      <Route index element={<ExigeModule module="COCKPIT"><Cockpit /></ExigeModule>} />
      <Route path="catalogue" element={<ExigeModule module="CATALOGUE"><Catalogue /></ExigeModule>} />
      <Route path="stock" element={<ExigeModule module="STOCK"><Stock /></ExigeModule>} />
      <Route path="mouvements" element={<ExigeModule module="MOUVEMENTS"><Mouvements /></ExigeModule>} />
      <Route path="transferts" element={<ExigeModule module="MOUVEMENTS"><Transferts /></ExigeModule>} />
      <Route path="inventaires" element={<ExigeModule module="INVENTAIRE"><Inventaires /></ExigeModule>} />
      <Route path="receptions" element={<ExigeModule module="RECEPTIONS"><Receptions /></ExigeModule>} />
      <Route path="transferts/nouveau" element={<ExigeModule module="MOUVEMENTS"><TransfertNouveau /></ExigeModule>} />
      <Route path="transferts/:id/modifier" element={<ExigeModule module="MOUVEMENTS"><TransfertNouveau /></ExigeModule>} />
      <Route path="transferts/:id/bon-sortie" element={<ExigeModule module="MOUVEMENTS"><BonTransfert type="sortie" /></ExigeModule>} />
      <Route path="transferts/:id/bon-reception" element={<ExigeModule module="MOUVEMENTS"><BonTransfert type="reception" /></ExigeModule>} />
      <Route path="configuration" element={<ExigeModule module="PARAMETRES"><Configuration /></ExigeModule>} />
      <Route path="equivalences" element={<ExigeModule module="CATALOGUE"><Equivalences /></ExigeModule>} />
      <Route path="statistiques" element={<ExigeModule module="MOUVEMENTS"><Statistiques /></ExigeModule>} />
      <Route path="receptions/nouvelle" element={<ExigeModule module="RECEPTIONS"><ReceptionNouvelle /></ExigeModule>} />
      <Route path="receptions/:id" element={<ExigeModule module="RECEPTIONS"><Reception /></ExigeModule>} />
      <Route path="fournisseurs" element={<ExigeModule module="FOURNISSEURS"><Fournisseurs /></ExigeModule>} />
      <Route path="referentiels" element={<ExigeModule module="CATALOGUE"><Referentiels /></ExigeModule>} />
      <Route path="qualites" element={<ExigeModule module="QUALITES"><Qualites /></ExigeModule>} />
      <Route path="recettes" element={<ExigeModule module="RECETTES"><Recettes /></ExigeModule>} />
      <Route path="plans" element={<ExigeModule module="PLANS"><Plans /></ExigeModule>} />
      <Route path="besoins" element={<ExigeModule module="MRP"><Besoins /></ExigeModule>} />
      <Route path="plan-achat" element={<ExigeModule module="PLAN_ACHAT"><PlanAchat /></ExigeModule>} />
      <Route path="bons-commande" element={<ExigeModule module="BONS_COMMANDE"><BonsCommande /></ExigeModule>} />
      <Route path="bons-commande/nouveau" element={<ExigeModule module="BONS_COMMANDE"><BonCommandeNouveau /></ExigeModule>} />
      <Route path="bons-commande/:id" element={<ExigeModule module="BONS_COMMANDE"><BonCommande /></ExigeModule>} />
      <Route path="assistant" element={<ExigeModule module="COCKPIT"><Assistant /></ExigeModule>} />
      <Route path="etat-stock" element={<ExigeModule module="STOCK"><EtatStock /></ExigeModule>} />
      <Route path="valorisation" element={<ExigeModule module="CATALOGUE"><Valorisation /></ExigeModule>} />
      <Route path="audit" element={<ExigeModule module="AUDIT"><Audit /></ExigeModule>} />
      <Route path="parametres" element={<ExigeModule module="PARAMETRES"><Parametres /></ExigeModule>} />
      <Route path="utilisateurs" element={<ExigeModule module="UTILISATEURS"><Utilisateurs /></ExigeModule>} />
      <Route path="utilisateurs/:id/droits" element={<ExigeModule module="UTILISATEURS"><Droits /></ExigeModule>} />
  </>
)

/** Onglet dont le chemin n’existe plus : ne jamais rediriger depuis un onglet
    masque, cela deplacerait la navigation de l’onglet actif. */
function OngletInconnu() {
  return (
    <Alerte ton="alerte" titre="Ecran introuvable">
      Cet onglet pointe vers un ecran qui n’existe plus. Fermez-le (Ctrl+W).
    </Alerte>
  )
}

/**
 * Aiguillage de coquille. Le bureau recoit l’atelier complet (onglets, panneau
 * lateral, barre d’etat) ; le web et la PWA gardent la coquille tactile, mieux
 * adaptee a un ecran de telephone.
 */
/**
 * Apercu de l'atelier hors Tauri.
 *
 * Compiler l'enveloppe de bureau prend plusieurs minutes ; `?atelier=1` permet
 * de voir la coquille d'atelier dans un navigateur, et `?atelier=0` de revenir
 * a la coquille tactile. Le choix est retenu, sinon la premiere navigation
 * effacerait le parametre et ferait basculer la coquille en pleine session.
 *
 * Ce n'est qu'un confort de developpement : aucune donnee ni aucun droit ne
 * depend de la coquille, les deux appellent les memes routes et le serveur
 * applique les memes controles.
 */
const CLE_APERCU = 'gestionfil.atelier.apercu'

function apercuAtelier(): boolean {
  const demande = new URLSearchParams(window.location.search).get('atelier')
  if (demande === '1') localStorage.setItem(CLE_APERCU, '1')
  else if (demande === '0') localStorage.removeItem(CLE_APERCU)
  return localStorage.getItem(CLE_APERCU) === '1'
}

function Aiguillage() {
  if (estBureau() || apercuAtelier()) {
    return (
      <Routes>
        <Route path="/connexion" element={<Connexion />} />
        <Route
          path="*"
          element={
            <Protege>
              <Atelier
                routes={
                  <>
                    {ECRANS}
                    <Route path="*" element={<OngletInconnu />} />
                  </>
                }
              />
            </Protege>
          }
        />
      </Routes>
    )
  }

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
      <QueryClientProvider client={client}>
        <FournisseurInfobulle delayDuration={300}>
          <BrowserRouter>
            <AuthProvider>
              <Aiguillage />
              <Notifications />
            </AuthProvider>
          </BrowserRouter>
        </FournisseurInfobulle>
      </QueryClientProvider>
    </FournisseurTheme>
  )
}

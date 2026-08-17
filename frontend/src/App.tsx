import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { FournisseurTheme, useTheme } from './composants/Theme'
import { Coquille } from './composants/Coquille'
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

export function App() {
  return (
    <FournisseurTheme>
      <QueryClientProvider client={client}>
        <FournisseurInfobulle delayDuration={300}>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/connexion" element={<Connexion />} />
                <Route
                  element={
                    <Protege>
                      <Coquille />
                    </Protege>
                  }
                >
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
                  <Route path="parametres" element={<ExigeModule module="PARAMETRES"><Parametres /></ExigeModule>} />
                  <Route path="utilisateurs" element={<ExigeModule module="UTILISATEURS"><Utilisateurs /></ExigeModule>} />
                  <Route path="utilisateurs/:id/droits" element={<ExigeModule module="UTILISATEURS"><Droits /></ExigeModule>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
              <Notifications />
            </AuthProvider>
          </BrowserRouter>
        </FournisseurInfobulle>
      </QueryClientProvider>
    </FournisseurTheme>
  )
}

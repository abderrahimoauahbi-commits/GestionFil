import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { poserVerrouInspection } from './lib/verrouillage'
import './index.css'

// Retire les gestes qui ouvrent les outils du navigateur. Dans un navigateur
// c'est une barriere de politesse, pas une securite — ce qui protege les
// donnees, ce sont les droits appliques par le serveur. Voir `verrouillage.ts`.
poserVerrouInspection()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

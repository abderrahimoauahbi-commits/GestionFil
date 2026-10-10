/**
 * Tests de bout en bout (frontend/e2e) : Edge, deja installe sur les postes,
 * pilote sur les vrais ecrans servis par le serveur d'essai. Se lancent par
 * `python e2e/lancer.py`, qui bâtit la base jetable et fournit E2E_URL.
 *
 * Deux tailles d'ecran : le portable de bureau (1366 x 768), ou les tableaux
 * debordent et les boutons sortent de l'ecran, et le grand ecran (1920 x 1080).
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: './rapport-e2e/resultats',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Un seul serveur, une seule base : les saisies ne doivent pas se croiser.
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: './rapport-e2e/html', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://127.0.0.1:8097',
    channel: 'msedge',
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'portable-1366', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'ecran-1920', use: { viewport: { width: 1920, height: 1080 } } },
  ],
})

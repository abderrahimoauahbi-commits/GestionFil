/**
 * L'agent de saisie (simulation/agent.spec.ts) : Edge, un portable de bureau,
 * un seul passage sans limite de temps. Se lance par `python simulation/lancer.py`,
 * qui demarre le serveur d'essai et fournit SIM_URL.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'agent.spec.ts',
  // Un essai sur une base jetable (SIM_DOSSIER) garde ses traces a part : Playwright
  // vide ce dossier a chaque passage.
  outputDir: process.env.SIM_DOSSIER ? `${process.env.SIM_DOSSIER}/resultats` : '../rapport-simulation/resultats',
  timeout: 0,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.SIM_URL ?? 'http://127.0.0.1:8099',
    channel: 'msedge',
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
    viewport: { width: 1366, height: 768 },
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
})

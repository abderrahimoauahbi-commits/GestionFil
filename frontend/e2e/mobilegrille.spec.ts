/**
 * CAPTURE MOBILE DE LA SAISIE GENERIQUE (GrilleLignes), 14/10/2026.
 *
 * Verifie que les ecrans de saisie qui partagent `GrilleLignes` — mouvement,
 * transfert, retour — tiennent au telephone : plus de tableau large, « Ajouter
 * une ligne » atteignable, edition en feuille plein ecran.
 *
 * Passer E2E_LARGEURS=390 au lanceur (projet telephone).
 */
import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { connexion } from './outils'

const ECRANS = [
  { nom: 'mouvement', url: '/mouvements/nouveau' },
  { nom: 'transfert', url: '/transferts/nouveau' },
  { nom: 'retour', url: '/retours-fournisseur/nouveau' },
]

test('saisie mobile : cartes + feuille sur mouvement / transfert / retour', async ({ page }, info) => {
  const taille = info.project.name
  const dossier = 'rapport-e2e/mobile'
  mkdirSync(dossier, { recursive: true })

  await connexion(page, 'Magasinie')

  for (const e of ECRANS) {
    await page.goto(e.url)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dossier}/${taille}-grille-${e.nom}-page.png`, fullPage: true })

    const ajouter = page.getByRole('button', { name: /Ajouter une ligne/i })
    if (await ajouter.count()) {
      await ajouter.first().click().catch(() => undefined)
      // La feuille s'ouvre : on attend le champ de recherche de reference.
      await page.getByText(/Référence/).first().waitFor({ timeout: 6_000 }).catch(() => undefined)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${dossier}/${taille}-grille-${e.nom}-feuille.png` })

      // Choisir la premiere reference proposee pour montrer la feuille remplie.
      const champ = page.getByRole('textbox', { name: 'Référence de la ligne' })
      if (await champ.count()) {
        await champ.first().click().catch(() => undefined)
        await page.waitForTimeout(600)
        const option = page.locator('[role="option"]')
        if (await option.count()) {
          await option.first().click().catch(() => undefined)
          await page.waitForTimeout(400)
          await page.screenshot({ path: `${dossier}/${taille}-grille-${e.nom}-feuille-remplie.png` })
        }
      }
    }
  }
})

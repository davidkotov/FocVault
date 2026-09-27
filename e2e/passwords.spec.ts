import { expect, test } from '@playwright/test'
import { registerAccount, setPlanViaAdmin } from './helpers'

const PASS = 'Korrekt Pferd Batterie Heftklammer'

test('Passwort-Check: schwach, mehrfach, Datenleck (anonym über den Server)', async ({ page }) => {
  test.setTimeout(200_000)
  const email = `pwcheck-${Date.now()}@example.com`
  await registerAccount(page, email, PASS)
  await setPlanViaAdmin(page, email, 'pro', PASS)
  await page.getByRole('button', { name: 'Passwörter' }).click()
  for (const [title, pw] of [
    ['Forum', 'passwort123'],
    ['Shop', 'passwort123'],
    ['Bank', 'k7#Qz!v9Lp$2wXr&Tm4e-Zb8']
  ]) {
    await page.getByRole('button', { name: '+ Neues Passwort' }).click()
    await page.getByLabel(/Titel/).fill(title)
    await page.locator('.secform').getByPlaceholder('••••••••').fill(pw)
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.locator('.secrow', { hasText: title })).toBeVisible()
  }
  const bar = page.locator('.healthbar')
  await expect(bar).toContainText('2 schwach')
  await expect(bar).toContainText('2 mehrfach verwendet')
  await expect(page.locator('.secrow', { hasText: 'Bank' }).locator('.pwbadge')).toHaveCount(0)
  await bar.getByRole('button', { name: 'Auf Datenlecks prüfen' }).click()
  await expect(bar).toContainText('2 in Datenlecks', { timeout: 30_000 })
  await expect(page.locator('.secrow', { hasText: 'Forum' })).toContainText('geleakt')
  await bar.getByRole('button', { name: '2 in Datenlecks' }).click()
  await expect(page.locator('.secrow')).toHaveCount(2)
})

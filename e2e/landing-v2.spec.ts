import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('Neue Landing, Sicherheitsseite mit Live-Verschlüsselung, Rechtsseiten, Team', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Verschlüsselt, bevor sie dein Gerät verlassen')
  await expect(page.getByRole('heading', { name: /Matterhorn/ })).toBeVisible()
  await expect(page.locator('.v2module')).toHaveCount(17)
  await page.locator('.v2filter').getByRole('button', { name: 'Business' }).click()
  await expect(page.locator('.v2module')).toHaveCount(6)
  await expect(page.locator('.v2store')).toHaveCount(6)
  await expect(page.locator('.v2livebox')).toContainText('Verfügbarkeit')

  await page.goto('/sicherheit')
  const ct = page.locator('.secct')
  await expect(ct).not.toHaveText('…')
  const before = await ct.textContent()
  await page.locator('.sectry textarea').fill('Geheimer Text')
  await expect(ct).not.toHaveText(before ?? '')
  await expect(ct).not.toContainText('Geheimer')
  await expect(page.getByText('13 Byte verschlüsselt')).toBeVisible()

  for (const [path, h] of [['/impressum', 'Impressum'], ['/datenschutz', 'Datenschutzerklärung'], ['/agb', 'Allgemeine Geschäftsbedingungen'], ['/avv', 'Vertrag zur Auftragsverarbeitung (AVV)']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: h, level: 1 })).toBeVisible()
  }
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Als PDF herunterladen' }).click()])
  expect((await readFile(await dl.path())).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Die Menschen hinter FocVault' })).toBeVisible()
  const txt = await page.request.get('/.well-known/security.txt')
  expect(await txt.text()).toContain('Contact: mailto:security@focvault.app')
  await page.goto('/en/security')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Encryption you can try')
})

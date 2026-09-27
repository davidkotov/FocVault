import { expect, type Page } from '@playwright/test'

/** Tresor entsperren – Eingabe erst nach der Hydrierung zuverlässig (sonst setzt React das Feld zurück). */
export async function unlockVault(page: Page, passphrase: string) {
  await expect(async () => {
    await page.getByLabel('Passphrase').fill(passphrase)
    await expect(page.getByRole('button', { name: 'Entsperren' })).toBeEnabled({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Entsperren' }).click()
}

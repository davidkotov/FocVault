import { expect, type Page } from '@playwright/test'

/** Tresor entsperren – Eingabe erst nach der Hydrierung zuverlässig (sonst setzt React das Feld zurück). */
export async function unlockVault(page: Page, passphrase: string) {
  await expect(async () => {
    await page.getByLabel('Passphrase').fill(passphrase)
    await expect(page.getByRole('button', { name: 'Entsperren' })).toBeEnabled({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Entsperren' }).click()
}

/** Neues E-Mail-Konto registrieren (inkl. Recovery-Kit-Bestätigung); liefert die 24 Wörter. */
export async function registerAccount(page: Page, email: string, passphrase: string): Promise<string[]> {
  await page.goto('/registrieren')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase)
  await page.getByLabel('Passphrase wiederholen').fill(passphrase)
  await page.getByText('Ich verstehe').click()
  await page.getByRole('button', { name: 'Weiter zum Recovery-Kit' }).click()
  const cells = page.locator('[data-testid="recovery-words"] .word')
  await expect(cells).toHaveCount(24)
  const words = (await cells.allTextContents()).map(t => t.replace(/^\d+/, '').trim())
  await page.getByText('Ich habe die 24 Wörter').click()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  for (const label of await page.locator('.confirmwords label').allTextContents()) {
    const n = Number(label.replace(/\D+/g, ''))
    await page.getByLabel(label, { exact: true }).fill(words[n - 1])
  }
  await page.getByRole('button', { name: 'Konto erstellen' }).click()
  await expect(page).toHaveURL(/\/app/, { timeout: 60_000 })
  return words
}

/** Paket lokal über den Admin setzen, danach Tresor wieder entsperren. */
export async function setPlanViaAdmin(page: Page, email: string, plan: string, passphrase: string) {
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(email)
  await page.getByLabel(`Paket für ${email}`).selectOption(plan)
  await expect(page.locator('tr', { hasText: email })).toContainText(plan === 'free' ? 'Free' : 'monatlich')
  await page.goto('/app')
  await unlockVault(page, passphrase)
}

import { expect, test, type Page } from '@playwright/test'

const PASS = 'Korrekt Pferd Batterie Heftklammer'

async function register(page: Page, email: string) {
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await page.getByLabel('Passphrase wiederholen').fill(PASS)
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
  await expect(page).toHaveURL(/\/app/)
}

test('Family: Inhaber lädt ein, neues Konto registriert sich über den Link und tritt bei', async ({ page, browser }) => {
  // zwei Registrierungen mit Argon2id (64 MiB) – parallel zu anderen Tests braucht das Zeit
  test.setTimeout(300_000)
  const owner = `family-owner-${Date.now()}@example.com`
  const kid = `family-kid-${Date.now()}@example.com`

  await page.goto('/registrieren')
  await register(page, owner)
  // Family freischalten (lokal über den Admin – in Production per Stripe)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(owner)
  await page.getByLabel(`Paket für ${owner}`).selectOption('family')
  await expect(page.locator('tr', { hasText: owner })).toContainText('monatlich')

  await page.goto('/app?view=account')
  await page.getByLabel('Passphrase').fill(PASS)
  await page.getByRole('button', { name: 'Entsperren' }).click()
  await page.getByRole('button', { name: /Person einladen/ }).click()
  const link = await page.locator('.sharelink input').inputValue()
  expect(link).toMatch(/\/app\?join=[A-Za-z0-9_-]{32}$/)

  const guest = await browser.newContext({ locale: 'de-CH' })
  const g = await guest.newPage()
  await g.goto(link)
  await expect(g).toHaveURL(/registrieren/)
  await register(g, kid)
  await expect(g.getByText(`${owner} lädt dich in die Family ein.`, { exact: false })).toBeVisible()
  await g.getByRole('button', { name: 'Beitreten' }).click()
  await expect(g.getByText(`Willkommen in der Family von ${owner}!`)).toBeVisible()
  // Pro-Module frei (kein Schloss mehr)
  await expect(g.locator('.navlock')).toHaveCount(0)
  await g.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await expect(g.getByText(`Du nutzt den Family-Speicher von ${owner}.`, { exact: false })).toBeVisible()

  // Einladungslink ist verbraucht
  const g2 = await guest.newPage()
  await g2.goto(link)
  // Eingabe erst nach der Hydrierung zuverlässig (sonst setzt React das Feld zurück)
  await expect(async () => {
    await g2.getByLabel('Passphrase').fill(PASS)
    await expect(g2.getByRole('button', { name: 'Entsperren' })).toBeEnabled({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })
  await g2.getByRole('button', { name: 'Entsperren' }).click()
  await expect(g2.getByText(/abgelaufen/)).toBeVisible()
  await guest.close()

  // Inhaber sieht das Mitglied und kann es entfernen
  await page.reload()
  await page.getByLabel('Passphrase').fill(PASS)
  await page.getByRole('button', { name: 'Entsperren' }).click()
  await page.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  const row = page.locator('.trashrow', { hasText: kid })
  await row.getByRole('button', { name: 'Entfernen' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Entfernen' }).click()
  await expect(page.locator('.trashrow', { hasText: kid })).toHaveCount(0)
})

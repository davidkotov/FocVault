import { expect, test } from '@playwright/test'
import { registerAccount } from './helpers'

test('Support: Formular → Admin sieht die Anfrage; Status und Dokumentation erreichbar', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const guest = await browser.newContext({ locale: 'de-CH' })
  const g = await guest.newPage()
  await g.goto('/support?topic=storage&plan=business')
  await expect(g.getByRole('heading', { name: 'Hilfe erhalten' })).toBeVisible()
  await g.getByRole('button', { name: 'Wo liegen meine Daten?' }).click()
  await expect(g.getByText(/Fil One in der EU \(eu-west-1\)/)).toBeVisible()
  await expect(g.getByLabel('Speicher-Anfrage (individuelle Menge)')).toBeChecked()
  await expect(g.getByLabel(/Beschreibung/)).toHaveValue(/Paket: business/)
  const email = `support-${Date.now()}@firma.ch`
  await g.getByLabel(/Vorname/).fill('Max')
  await g.getByLabel(/Nachname/).fill('Muster')
  await g.getByLabel(/E-Mail/).fill(email)
  await g.getByLabel('Firma').fill('Muster AG')
  await g.getByRole('button', { name: 'Senden' }).click()
  await expect(g.getByText('Danke! Deine Anfrage ist bei uns eingegangen.', { exact: false })).toBeVisible()

  await g.goto('/status')
  await expect(g.getByRole('link', { name: /Updates abonnieren/ })).toBeVisible()
  await g.goto('/docs/secure-send')
  await expect(g.getByRole('heading', { name: 'Secure Send', level: 1 })).toBeVisible()
  await g.getByPlaceholder('Dokumentation durchsuchen …').fill('Matterhorn-gibt-es-nicht')
  await expect(g.getByText('Kein Artikel gefunden.')).toBeVisible()
  await guest.close()

  // Admin (lokal: jedes Konto) sieht die Anfrage
  await registerAccount(page, `support-admin-${Date.now()}@example.com`, 'Korrekt Pferd Batterie Heftklammer')
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Support' }).click()
  const t = page.locator('.ticket', { hasText: email })
  await expect(t).toContainText('Speicher-Anfrage')
  await t.getByRole('button', { name: 'Erledigt' }).click()
  await expect(page.locator('.ticket', { hasText: email })).toHaveCount(0)
})

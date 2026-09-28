import { expect, test } from '@playwright/test'
import { registerAccount, unlockVault } from './helpers'

const PASS = 'Korrekt Pferd Batterie Heftklammer'

test('Geteilte Tresore (Business): anlegen, Person mit Rechten, Bearbeiten, Entfernen, Protokoll', async ({ page, browser }) => {
  test.setTimeout(360_000)
  const ceo = `vault-ceo-${Date.now()}@example.com`
  const dev = `vault-dev-${Date.now()}@example.com`

  await registerAccount(page, ceo, PASS)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(ceo)
  await page.getByLabel(`Paket für ${ceo}`).selectOption('business')
  await expect(page.locator('tr', { hasText: ceo })).toContainText('monatlich')
  await page.goto('/app?view=account&tab=team')
  await unlockVault(page, PASS)
  await page.getByRole('button', { name: /Person einladen/ }).click()
  const link = await page.locator('.sharelink input').inputValue()

  const guest = await browser.newContext({ locale: 'de-CH' })
  const g = await guest.newPage()
  await g.goto(link)
  await expect(g).toHaveURL(/registrieren/)
  await registerAccount(g, dev, PASS, { navigate: false })
  await g.getByRole('button', { name: 'Beitreten' }).click()
  await expect(g.getByText(`Willkommen im Team von ${ceo}!`)).toBeVisible()
  // Mitglied öffnet einmal (veröffentlicht seinen Schlüssel)
  await g.getByRole('button', { name: 'Geteilte Tresore' }).click()
  await expect(g.getByText('Noch keine geteilten Tresore')).toBeVisible()

  // Inhaber: Tresor anlegen, Passwort speichern, Mitglied mit „Ansehen“ hinzufügen
  await page.getByRole('button', { name: 'Geteilte Tresore' }).click()
  await page.getByLabel('Name des neuen Tresors').fill('Server-Zugänge')
  await page.getByRole('button', { name: 'Tresor erstellen' }).click()
  await expect(page.getByRole('heading', { name: /Server-Zugänge/ })).toBeVisible()
  await page.getByRole('button', { name: '+ Neues Passwort' }).click()
  await page.getByLabel(/Titel/).fill('Hetzner Root')
  await page.getByLabel('Benutzername').fill('root')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator('.secrow', { hasText: 'Hetzner Root' })).toBeVisible()
  await page.getByRole('tab', { name: /Personen/ }).click()
  await page.getByLabel('Person hinzufügen').selectOption({ label: dev })
  await page.getByRole('button', { name: 'Hinzufügen' }).click()
  const devRow = page.locator('.vaultpeople .sharerow', { hasText: dev })
  await expect(devRow).toBeVisible()
  await expect(devRow).not.toContainText('Schlüssel folgt')

  // Mitglied sieht den Tresor – nur lesen
  await g.reload()
  await unlockVault(g, PASS)
  await g.getByRole('button', { name: 'Geteilte Tresore' }).click()
  await g.locator('.vaultrow', { hasText: 'Server-Zugänge' }).click()
  await expect(g.getByText('Du kannst diesen Tresor nur ansehen.')).toBeVisible()
  await expect(g.locator('.secrow', { hasText: 'Hetzner Root' })).toBeVisible()
  await expect(g.getByRole('button', { name: '+ Neues Passwort' })).toHaveCount(0)

  // Recht „Bearbeiten“ → Mitglied legt eine Notiz an, Inhaber sieht sie
  await devRow.getByRole('combobox').selectOption('edit')
  await g.reload()
  await unlockVault(g, PASS)
  await g.getByRole('button', { name: 'Geteilte Tresore' }).click()
  await g.locator('.vaultrow', { hasText: 'Server-Zugänge' }).click()
  await g.getByRole('tab', { name: /Notizen/ }).click()
  await g.getByRole('button', { name: '+ Neue Notiz' }).click()
  await g.getByLabel('Titel').fill('Wartungsfenster')
  await g.getByLabel('Inhalt').fill('Sonntag 02:00–04:00')
  await g.getByRole('button', { name: 'Speichern' }).click()
  await expect(g.locator('.notecard', { hasText: 'Wartungsfenster' })).toBeVisible()

  await page.reload()
  await unlockVault(page, PASS)
  await page.getByRole('button', { name: 'Geteilte Tresore' }).click()
  await page.locator('.vaultrow', { hasText: 'Server-Zugänge' }).click()
  await page.getByRole('tab', { name: /Notizen/ }).click()
  await expect(page.locator('.notecard', { hasText: 'Wartungsfenster' })).toBeVisible()

  // Entfernen → Mitglied verliert den Zugriff sofort; neuer Schlüssel; Protokoll
  await page.getByRole('tab', { name: /Personen/ }).click()
  await page.locator('.vaultpeople .sharerow', { hasText: dev }).getByRole('button', { name: 'Entfernen' }).click()
  await expect(page.locator('.vaultpeople .sharerow', { hasText: dev })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Protokoll' }).click()
  await expect(page.locator('.vaultaudit')).toContainText(`hat ${dev} entfernt`)
  await expect(page.locator('.vaultaudit')).toContainText('neuen Tresor-Schlüssel erzeugt')
  await page.getByRole('tab', { name: /Passwörter/ }).click()
  await expect(page.locator('.secrow', { hasText: 'Hetzner Root' })).toBeVisible()

  await g.reload()
  await unlockVault(g, PASS)
  await g.getByRole('button', { name: 'Geteilte Tresore' }).click()
  await expect(g.getByText('Noch keine geteilten Tresore')).toBeVisible()
  await guest.close()
})

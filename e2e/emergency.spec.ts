import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { registerAccount, setPlanViaAdmin, unlockVault } from './helpers'

const PASS = 'Korrekt Pferd Batterie Heftklammer'

test('Notfallzugang: einladen, annehmen, bestätigen, anfordern, freigeben, Tresor lesen', async ({ page, browser }) => {
  test.setTimeout(360_000)
  const anna = `em-anna-${Date.now()}@example.com`
  const ben = `em-ben-${Date.now()}@example.com`
  await registerAccount(page, anna, PASS)
  await setPlanViaAdmin(page, anna, 'pro', PASS)
  await page.getByTestId('upload-input').setInputFiles({ name: 'testament.txt', mimeType: 'text/plain', buffer: Buffer.from('Mein letzter Wille') })
  await expect(page.locator('.filecard', { hasText: 'testament.txt' })).toBeVisible()
  await page.getByRole('button', { name: 'Passwörter' }).click()
  await page.getByRole('button', { name: '+ Neues Passwort' }).click()
  await page.getByLabel(/Titel/).fill('Bank')
  await page.getByLabel('Benutzername').fill('anna-bank')
  await page.getByRole('button', { name: 'Speichern' }).click()

  // Einladung mit 1 Tag Wartezeit
  await page.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await page.locator('.accnav').getByRole('button', { name: 'Notfallzugang' }).click()
  await page.getByLabel('Wartezeit').selectOption({ label: '1 Tag' })
  await page.getByRole('button', { name: '+ Vertrauensperson einladen' }).click()
  const link = await page.locator('.emergency .sharelink input').inputValue()
  expect(link).toMatch(/\?emergency=[A-Za-z0-9_-]{32}$/)

  const guest = await browser.newContext({ locale: 'de-CH', acceptDownloads: true })
  const g = await guest.newPage()
  await g.goto(link)
  await expect(g).toHaveURL(/registrieren/)
  await registerAccount(g, ben, PASS, { navigate: false })
  await expect(g.getByText('Notfallkontakt werden?')).toBeVisible()
  await g.getByRole('button', { name: 'Annehmen' }).click()
  await expect(g.getByText(`Du bist jetzt Notfallkontakt für ${anna}`)).toBeVisible()

  // Inhaberin bestätigt mit Passphrase
  await page.reload()
  await unlockVault(page, PASS)
  await page.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await page.locator('.accnav').getByRole('button', { name: 'Notfallzugang' }).click()
  const row = page.locator('.emrow', { hasText: ben })
  await expect(row).toContainText('bitte mit deiner Passphrase bestätigen')
  await row.getByPlaceholder('Deine Passphrase').fill(PASS)
  await row.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(row).toContainText('Bereit')

  // Vertrauensperson fordert an → wartet
  await g.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await g.locator('.accnav').getByRole('button', { name: 'Notfallzugang' }).click()
  const gRow = g.locator('.emrow', { hasText: anna })
  await gRow.getByRole('button', { name: 'Zugriff anfordern' }).click()
  await g.getByRole('alertdialog').getByRole('button', { name: 'Zugriff anfordern' }).click()
  await expect(gRow).toContainText('Angefordert')
  await expect(gRow.getByRole('button', { name: 'Tresor öffnen' })).toHaveCount(0)

  // Inhaberin sieht den Hinweis und gibt frei
  await page.reload()
  await unlockVault(page, PASS)
  await expect(page.getByText(/hat Notfallzugang zu deinem Tresor angefordert/)).toBeVisible()
  await page.getByRole('button', { name: 'Ansehen' }).click()
  await page.locator('.emrow', { hasText: ben }).getByRole('button', { name: 'Jetzt freigeben' }).click()
  await expect(page.locator('.emrow', { hasText: ben })).toContainText('Hat Lesezugriff')

  // Vertrauensperson liest den Tresor
  await g.reload()
  await unlockVault(g, PASS)
  await g.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await g.locator('.accnav').getByRole('button', { name: 'Notfallzugang' }).click()
  await g.locator('.emrow', { hasText: anna }).getByRole('button', { name: 'Tresor öffnen' }).click()
  await expect(g.getByRole('heading', { name: `Notfallzugang: Tresor von ${anna}` })).toBeVisible()
  const fileRow = g.locator('.sharerow', { hasText: 'testament.txt' })
  const [dl] = await Promise.all([g.waitForEvent('download'), fileRow.getByRole('button', { name: 'Herunterladen' }).click()])
  expect((await readFile(await dl.path())).toString()).toBe('Mein letzter Wille')
  await g.getByRole('tab', { name: /Passwörter/ }).click()
  await expect(g.locator('.secrow', { hasText: 'Bank' })).toContainText('anna-bank')
  await expect(g.getByRole('button', { name: '+ Neues Passwort' })).toHaveCount(0)

  // Entziehen
  await page.locator('.emrow', { hasText: ben }).getByRole('button', { name: 'Zugriff entziehen' }).click()
  await expect(page.locator('.emrow', { hasText: ben })).toHaveCount(0)
  await guest.close()
})

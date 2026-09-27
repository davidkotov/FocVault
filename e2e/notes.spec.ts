import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { registerAccount, setPlanViaAdmin } from './helpers'

const PASS = 'Korrekt Pferd Batterie Heftklammer'

test('Notizen: Vorlage, Checkliste, Tags, Anhang, Suche, per Secure Send teilen (einmalig)', async ({ page }) => {
  test.setTimeout(240_000)
  const email = `notes-${Date.now()}@example.com`
  await registerAccount(page, email, PASS)
  await setPlanViaAdmin(page, email, 'pro', PASS)
  await page.getByRole('button', { name: 'Notizen' }).click()

  // WLAN-Vorlage mit geheimem Passwort, Checkliste, Tag und Anhang
  await page.getByRole('button', { name: /WLAN/ }).click()
  await page.getByLabel('Titel').fill('WLAN Büro')
  await page.getByLabel('Netzwerkname (SSID)').fill('FocNet')
  await page.getByLabel('Passwort').fill('geheim-12345')
  await page.getByLabel('Inhalt').fill('## Gäste\n- [ ] Router neu starten\n- [ ] Gastnetz prüfen')
  await page.getByLabel('Tags').fill('Büro, IT')
  await page.getByTestId('note-attach').setInputFiles({ name: 'router.txt', mimeType: 'text/plain', buffer: Buffer.from('Router-Handbuch') })
  await expect(page.locator('.secform .noteatt')).toContainText('router.txt')
  await page.getByRole('button', { name: 'Speichern' }).click()

  const card = page.locator('.notecard', { hasText: 'WLAN Büro' })
  await expect(card).toContainText('FocNet')
  await expect(card).not.toContainText('geheim-12345')
  await card.getByRole('button', { name: 'Anzeigen' }).click()
  await expect(card).toContainText('geheim-12345')
  await expect(card).toContainText('0/2 erledigt')
  await card.getByRole('checkbox', { name: 'Router neu starten' }).check()
  await expect(card).toContainText('1/2 erledigt')
  await expect(card.getByRole('heading', { name: 'Gäste' })).toBeVisible()

  // zweite Notiz, Suche und Tag-Filter
  await page.getByRole('button', { name: '+ Neue Notiz' }).click()
  await page.getByLabel('Titel').fill('Einkauf')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await page.getByPlaceholder('Notizen durchsuchen …').fill('focnet')
  await expect(page.locator('.notecard')).toHaveCount(1)
  await page.getByPlaceholder('Notizen durchsuchen …').fill('')
  await page.locator('.notetools').getByRole('button', { name: '#IT' }).click()
  await expect(page.locator('.notecard')).toHaveCount(1)
  await page.locator('.notetools').getByRole('button', { name: 'Alle' }).click()
  await expect(page.locator('.notecard')).toHaveCount(2)

  // Anhang entschlüsselt herunterladen
  const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'router.txt' }).click()])
  expect((await readFile(await dl.path())).toString()).toBe('Router-Handbuch')

  // Teilen: Einmal-Link
  await card.getByRole('button', { name: 'Per Secure Send teilen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('WLAN Büro')
  await dialog.getByRole('button', { name: 'Einmal (danach ungültig)' }).click()
  await dialog.getByRole('button', { name: 'Link erstellen' }).click()
  const link = await dialog.locator('.sharelink input').inputValue()
  await dialog.getByRole('button', { name: 'Schließen' }).click()

  const guest = await page.context().browser()!.newContext({ locale: 'de-CH', acceptDownloads: true })
  const g = await guest.newPage()
  await g.goto(link)
  await expect(g.getByText('Verschlüsselte Notiz')).toBeVisible()
  await expect(g.getByText('FocNet')).toHaveCount(0)
  await g.getByRole('button', { name: 'Notiz anzeigen' }).click()
  await expect(g.getByRole('heading', { name: 'WLAN Büro' })).toBeVisible()
  await expect(g.getByText('FocNet')).toBeVisible()
  const [gdl] = await Promise.all([g.waitForEvent('download'), g.locator('.sharefile', { hasText: 'router.txt' }).getByRole('button', { name: 'Herunterladen' }).click()])
  expect((await readFile(await gdl.path())).toString()).toBe('Router-Handbuch')
  await g.reload()
  await expect(g.getByText(/abgelaufen, wurde widerrufen/)).toBeVisible()
  await guest.close()

  // Link-Übersicht zeigt die Notiz
  await page.getByRole('button', { name: 'Meine Cloud', exact: true }).click()
  await page.locator('.h3right').getByRole('button', { name: /Secure Send/ }).click()
  await expect(page.locator('.sharerow').first()).toContainText('WLAN Büro')
})

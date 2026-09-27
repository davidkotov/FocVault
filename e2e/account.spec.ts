import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const PASS = 'Korrekt Pferd Batterie Heftklammer'
const NEW_PASS = 'Ganz neue lange Passphrase 2026'

async function readRecoveryWords(page: Page): Promise<string[]> {
  const cells = page.locator('[data-testid="recovery-words"] .word')
  await expect(cells).toHaveCount(24)
  const texts = await cells.allTextContents()
  return texts.map(t => t.replace(/^\d+/, '').trim())
}

async function expectFileListed(page: Page, name: string) {
  await expect(page.locator('.filename', { hasText: name })).toBeVisible()
}

async function downloadAndCompare(page: Page, name: string, expected: Buffer) {
  const card = page.locator('.filecard, .fileitem, [class*="file"]').filter({ hasText: name }).first()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.locator('button[title="Herunterladen"]').click()
  ])
  expect(download.suggestedFilename()).toBe(name)
  const path = await download.path()
  const got = await readFile(path)
  expect(got.length).toBe(expected.length)
  expect(Buffer.compare(got, expected)).toBe(0)
}

test('Konto: Registrieren → Upload → Sperren → Anmelden → Recovery → Download → Admin', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`
  const fileName = 'geheim-bericht.bin'
  const content = randomBytes(300_000)

  // 1) Registrierung mit Recovery-Kit
  await page.goto('/registrieren')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await page.getByLabel('Passphrase wiederholen').fill(PASS)
  await page.getByText('Ich verstehe').click()
  await page.getByRole('button', { name: 'Weiter zum Recovery-Kit' }).click()
  const words = await readRecoveryWords(page)
  await page.getByText('Ich habe die 24 Wörter').click()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  for (const label of await page.locator('.confirmwords label').allTextContents()) {
    const n = Number(label.replace(/\D+/g, ''))
    // exact: sonst trifft „Wort Nr. 1" auch „Wort Nr. 19"
    await page.getByLabel(label, { exact: true }).fill(words[n - 1])
  }
  await page.getByRole('button', { name: 'Konto erstellen' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Dateien speichern')).toBeVisible()

  // 2) Upload (im Browser verschlüsselt, frame2)
  await page.getByTestId('upload-input').setInputFiles({ name: fileName, mimeType: 'application/octet-stream', buffer: content })
  await expectFileListed(page, fileName)
  await expect(page.locator('.syncdot.busy')).toHaveCount(0)

  // 3) Download: byte-identisch
  await downloadAndCompare(page, fileName, content)

  // 3b) Secure Send: Einmal-Link mit Passwort, Empfänger ohne Konto
  const card = page.locator('.filecard, .fileitem, [class*="file"]').filter({ hasText: fileName }).first()
  await card.locator('button[title="Teilen"]').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Einmal (danach ungültig)' }).click()
  await dialog.getByLabel('Passwort (optional)').fill('teilen-geheim')
  await dialog.getByRole('button', { name: 'Link erstellen' }).click()
  const link = await dialog.locator('.sharelink input').inputValue()
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{22}#p\./)
  await dialog.getByRole('button', { name: 'Schließen' }).click()

  const guest = await page.context().browser()!.newContext({ locale: 'de-CH', acceptDownloads: true })
  const recipient = await guest.newPage()
  await recipient.goto(link)
  await recipient.getByLabel('Passwort').fill('falsch')
  await recipient.getByRole('button', { name: 'Öffnen' }).click()
  await expect(recipient.getByText('Falsches Passwort.')).toBeVisible()
  await recipient.getByLabel('Passwort').fill('teilen-geheim')
  await recipient.getByRole('button', { name: 'Öffnen' }).click()
  await expect(recipient.getByText(fileName)).toBeVisible()
  const [shared] = await Promise.all([recipient.waitForEvent('download'), recipient.getByRole('button', { name: 'Herunterladen' }).click()])
  expect(shared.suggestedFilename()).toBe(fileName)
  expect(Buffer.compare(await readFile(await shared.path()), content)).toBe(0)
  // Einmal-Link: zweiter Aufruf ist ungültig (serverseitig, nicht nur im Browser)
  const again = await guest.newPage()
  await again.goto(link)
  await again.getByLabel('Passwort').fill('teilen-geheim')
  await again.getByRole('button', { name: 'Öffnen' }).click()
  await expect(again.getByText(/abgelaufen, wurde widerrufen/)).toBeVisible()
  await guest.close()

  // 4) Sperren → mit Passphrase entsperren
  await page.getByRole('button', { name: 'Sperren' }).click()
  await expect(page.getByRole('heading', { name: 'Tresor entsperren' })).toBeVisible()
  await page.getByLabel('Passphrase').fill('falsche passphrase 123')
  await page.getByRole('button', { name: 'Entsperren' }).click()
  await expect(page.getByText('Die Passphrase ist falsch.')).toBeVisible()
  await page.getByLabel('Passphrase').fill(PASS)
  await page.getByRole('button', { name: 'Entsperren' }).click()
  await expectFileListed(page, fileName)

  // 5) Abmelden → neu anmelden (wie ein zweites Gerät)
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page).toHaveURL(/\/anmelden$/)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passphrase').fill(PASS)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expectFileListed(page, fileName)

  // 6) Passphrase „vergessen": Recovery mit 24 Wörtern, neue Passphrase
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await page.goto('/wiederherstellen')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Recovery-Kit (24 Wörter)').fill(words.join(' '))
  await expect(page.getByText('✓ Recovery-Kit gültig')).toBeVisible()
  await page.getByLabel('Neue Passphrase', { exact: true }).fill(NEW_PASS)
  await page.getByLabel('Neue Passphrase wiederholen').fill(NEW_PASS)
  await page.getByRole('button', { name: 'Wiederherstellen' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expectFileListed(page, fileName)
  await downloadAndCompare(page, fileName, content)

  // 7) Alte Passphrase gilt nicht mehr, neue schon
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passphrase').fill(PASS)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByText('E-Mail oder Passphrase ist falsch.')).toBeVisible()
  await page.getByLabel('Passphrase').fill(NEW_PASS)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // 8) Admin: Konto sichtbar, Speicher gebucht – ohne Dateinamen
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(email)
  await expect(page.getByRole('cell', { name: email })).toBeVisible()
  await expect(page.getByText(fileName)).toHaveCount(0)
  await page.getByRole('tab', { name: 'Filecoin (FOC)' }).click()
  await expect(page.getByText('1 · Netz und zahlende Wallet')).toBeVisible()
})

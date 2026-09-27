import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { registerAccount, unlockVault } from './helpers'

const PASS = 'Korrekt Pferd Batterie Heftklammer'

async function joinTeam(browser: Browser, owner: Page, email: string): Promise<Page> {
  await owner.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  const input = owner.locator('.sharelink input').first()
  const before = (await input.count()) ? await input.inputValue() : ''
  await owner.getByRole('button', { name: /Person einladen/ }).click()
  await expect(input).not.toHaveValue(before)
  await expect(input).toHaveValue(/join=/)
  const link = await input.inputValue()
  const ctx = await browser.newContext({ locale: 'de-CH', acceptDownloads: true })
  const p = await ctx.newPage()
  await p.goto(link)
  await registerAccount(p, email, PASS, { navigate: false })
  await p.getByRole('button', { name: 'Beitreten' }).click()
  await expect(p.getByText(/Willkommen im Team/)).toBeVisible()
  return p
}

async function openConsole(p: Page) {
  await p.reload()
  await unlockVault(p, PASS)
  await p.getByRole('button', { name: 'Admin-Konsole' }).click()
}

test('Admin-Konsole: Rollen, Richtlinien, Firmen-Notfallzugriff (Vier-Augen), Protokoll, PDF-Bericht', async ({ page, browser }) => {
  test.setTimeout(480_000)
  const ts = Date.now()
  const ceo = `ta-ceo-${ts}@example.com`
  const cto = `ta-cto-${ts}@example.com`
  const dev = `ta-dev-${ts}@example.com`
  await registerAccount(page, ceo, PASS)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(ceo)
  await page.getByLabel(`Paket für ${ceo}`).selectOption('business')
  await expect(page.locator('tr', { hasText: ceo })).toContainText('monatlich')
  await page.goto('/app')
  await unlockVault(page, PASS)
  const c = await joinTeam(browser, page, cto)
  const d = await joinTeam(browser, page, dev)

  // Mitglieder & Rollen
  await openConsole(page)
  await expect(page.locator('.datatable tbody tr')).toHaveCount(3)
  await page.getByLabel(`Rolle: ${cto}`).selectOption('admin')
  await expect(page.getByLabel(`Rolle: ${cto}`)).toHaveValue('admin')
  // Mitglied sieht keine Konsole
  await d.getByRole('button', { name: 'Admin-Konsole' }).click()
  await expect(d.getByText('Die Admin-Konsole sehen Inhaber und Admins')).toBeVisible()

  // Richtlinien
  await page.getByRole('tab', { name: 'Richtlinien' }).click()
  await page.getByLabel(/Passkey-Pflicht/).check()
  await page.getByLabel(/Firmen-Notfallzugriff verlangen/).check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Gespeichert.')).toBeVisible()

  // Team-Schlüssel (Inhaber), CTO holt sich den Schlüssel ab
  await page.getByRole('tab', { name: 'Notfallzugriff' }).click()
  await page.getByRole('button', { name: 'Team-Schlüssel erzeugen' }).click()
  await expect(page.getByText(/Team-Schlüssel aktiv \(Generation 1\)/)).toBeVisible()
  await openConsole(c) // veröffentlicht den öffentlichen Schlüssel des CTO
  await openConsole(page) // Inhaber gibt den Team-Schlüssel an den CTO weiter

  // Mitglied: Hinweise, Datei, Schlüssel hinterlegen
  await d.reload()
  await unlockVault(d, PASS)
  await expect(d.locator('.teamnotice')).toContainText('Passkey')
  await expect(d.locator('.teamnotice')).toContainText('Firmen-Notfallzugriff')
  await d.getByTestId('upload-input').setInputFiles({ name: 'kunden.csv', mimeType: 'text/csv', buffer: Buffer.from('id;name\n1;Muster AG') })
  await expect(d.locator('.filecard', { hasText: 'kunden.csv' })).toBeVisible()
  await d.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await d.getByLabel('Mit Passphrase hinterlegen').fill(PASS)
  await d.getByRole('button', { name: 'Mit Passphrase hinterlegen' }).click()
  await expect(d.getByText('✓ Schlüssel hinterlegt.')).toBeVisible()

  // Antrag (Inhaber) → Freigabe nur durch zweiten Admin (CTO)
  await openConsole(page)
  await page.getByRole('tab', { name: 'Notfallzugriff' }).click()
  await page.getByLabel('Person', { exact: true }).selectOption({ label: dev })
  await page.getByPlaceholder(/Begründung/).fill('Mitarbeiter krank, Kundendaten für Offerte nötig')
  await page.getByRole('button', { name: 'Antrag stellen' }).click()
  await expect(page.locator('.emrow', { hasText: dev })).toContainText('wartet auf Freigabe durch einen anderen Admin')
  await openConsole(c)
  await c.getByRole('tab', { name: 'Notfallzugriff' }).click()
  await c.locator('.emrow', { hasText: dev }).getByRole('button', { name: 'Freigeben' }).click()
  await expect(c.locator('.emrow', { hasText: dev })).toContainText('freigegeben')

  // Inhaber öffnet den Tresor (nur lesen) und lädt die Datei
  await openConsole(page)
  await page.getByRole('tab', { name: 'Notfallzugriff' }).click()
  await page.locator('.emrow', { hasText: dev }).getByRole('button', { name: 'Tresor öffnen' }).click()
  await expect(page.getByRole('heading', { name: `Firmen-Notfallzugriff: Tresor von ${dev}` })).toBeVisible()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.sharerow', { hasText: 'kunden.csv' }).getByRole('button', { name: 'Herunterladen' }).click()])
  expect((await readFile(await dl.path())).toString()).toBe('id;name\n1;Muster AG')

  // Mitglied sieht den Zugriff
  await d.reload()
  await unlockVault(d, PASS)
  await expect(d.getByText(/Firmen-Notfallzugriff auf deinen Tresor am .*Grund: Mitarbeiter krank/)).toBeVisible()

  // Protokoll & PDF-Bericht
  await openConsole(page)
  await page.getByRole('tab', { name: 'Protokoll & Bericht' }).click()
  await expect(page.locator('.datatable')).toContainText('Notfallzugriff freigegeben (2. Admin)')
  await expect(page.locator('.datatable')).toContainText('Richtlinien geändert')
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Compliance-Bericht (PDF)' }).click()])
  const bytes = await readFile(await pdf.path())
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  expect(bytes.toString('latin1')).toContain('Compliance-Bericht')

  // SSO: nicht eingerichtete Domain → verständliche Meldung
  const anon = await browser.newContext({ locale: 'de-CH' })
  const a = await anon.newPage()
  await a.goto('/anmelden')
  await a.getByRole('button', { name: /Mit Firmen-SSO anmelden/ }).click()
  await a.getByLabel('Geschäftliche E-Mail').fill('max@unbekannt-firma.ch')
  await a.getByRole('button', { name: 'Weiter zum Firmen-Login' }).click()
  await expect(a.getByText('Für diese E-Mail-Domain ist kein Firmen-SSO eingerichtet.')).toBeVisible()
  await anon.close()
})

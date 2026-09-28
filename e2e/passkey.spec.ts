import { expect, test, type Page } from '@playwright/test'
import { unlockVault } from './helpers'

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
  await expect(page).toHaveURL(/\/app/, { timeout: 60_000 })
}

test('Passkey (Pro): einrichten, Tresor sperren, mit Passkey entsperren', async ({ page }) => {
  test.setTimeout(180_000)
  // Virtueller Authenticator mit PRF (hmac-secret) – wie Touch ID / Windows Hello
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true }
  })

  const email = `passkey-${Date.now()}@example.com`
  await page.goto('/registrieren')
  await register(page, email)

  // Free: Schloss, Upgrade-Hinweis
  await page.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await page.locator('.accnav').getByRole('button', { name: 'Passkeys' }).click()
  await expect(page.locator('.lockedcard')).toContainText('Passkeys')
  await expect(page.getByRole('button', { name: '+ Passkey hinzufügen' })).toHaveCount(0)

  // Pro schalten (lokal über den Admin)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(email)
  await page.getByLabel(`Paket für ${email}`).selectOption('pro')
  await expect(page.locator('tr', { hasText: email })).toContainText('monatlich')

  await page.goto('/app')
  await unlockVault(page, PASS)
  await page.getByRole('button', { name: /Konto & Sicherheit/ }).click()
  await page.locator('.accnav').getByRole('button', { name: 'Passkeys' }).click()
  await page.getByRole('button', { name: '+ Passkey hinzufügen' }).click()
  await page.getByLabel('Zur Bestätigung deine Passphrase').fill(PASS)
  await page.getByRole('button', { name: 'Einrichten' }).click()
  await expect(page.locator('.notice', { hasText: /Passkey eingerichtet/ })).toBeVisible()
  await expect(page.locator('.trashrow').filter({ has: page.locator('.sicon') })).toHaveCount(1)

  // Sperren → mit Passkey entsperren (ohne Passphrase)
  await page.getByRole('button', { name: 'Sperren' }).click()
  await expect(page.getByRole('heading', { name: 'Tresor entsperren' })).toBeVisible()
  await page.getByRole('button', { name: /Mit Passkey entsperren/ }).click()
  await expect(page.getByRole('heading', { name: 'Tresor entsperren' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Meine Cloud', exact: true }).click()
  await expect(page.getByText('Dateien hierher ziehen')).toBeVisible()
})

import { expect, test } from '@playwright/test'

test.describe('Sprachen & Währungen', () => {
  test('englischer Browser landet auf /en mit englischen Texten und Pfaden', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await page.goto('/anmelden')
    await expect(page).toHaveURL(/\/en\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await ctx.close()
  })

  test('Sprachmenü wechselt die Sprache und behält die Seite', async ({ page }) => {
    await page.goto('/de/registrieren')
    await expect(page.getByRole('heading', { name: 'Konto erstellen' })).toBeVisible()
    await page.getByRole('button', { name: /Sprache und Region/ }).click()
    await page.getByRole('menuitemradio', { name: 'English' }).click()
    await expect(page).toHaveURL(/\/en\/register$/)
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()
  })

  test('Landing: Jahresabo und Währungswahl ändern die Preise', async ({ page }) => {
    await page.goto('/de#preise')
    const pro = page.locator('.plan.highlight .price')
    await page.getByRole('button', { name: /^Monatlich/ }).click()
    await expect(pro).toContainText('13.90 CHF')
    await page.getByRole('button', { name: /^Jährlich/ }).click()
    await expect(pro).toContainText('11.58 CHF')
    await page.locator('#preise').getByRole('button', { name: /Sprache und Region/ }).click()
    await page.getByRole('menuitemradio', { name: /^USD/ }).click()
    await expect(pro).toContainText('$12.42')
  })

  test('alte Share-Links ohne Sprachpräfix bleiben gültig', async ({ page }) => {
    const res = await page.goto('/s/testcid#AAAA')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveURL(/\/s\/testcid/)
  })
})

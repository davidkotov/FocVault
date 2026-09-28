#!/usr/bin/env node
/**
 * Demo-Konto mit Beispieldaten anlegen – über die echte Oberfläche (Verschlüsselung im Browser).
 *
 *   BASE_URL=<App-URL> node scripts/seed-demo.mjs
 *
 * Optional: DEMO_EMAIL, DEMO_PASS, DEMO_PLAN (free|pro|family|business). Nur für Entwicklung/Staging –
 * setzt den Plan über die Admin-Ansicht (dort sind im Dev-Modus alle Konten Admin).
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL
if (!BASE) {
  console.error('BASE_URL fehlt, z. B. BASE_URL=http://… node scripts/seed-demo.mjs')
  process.exit(1)
}
const EMAIL = process.env.DEMO_EMAIL ?? 'anna.demo@example.com'
const PASS = process.env.DEMO_PASS ?? 'Korrekt Pferd Batterie Heftklammer'
const PLAN = process.env.DEMO_PLAN ?? 'pro'
const url = p => new URL(p, BASE).toString()
const T = 60_000

const browser = await chromium.launch()
const page = await browser.newPage({ locale: 'de-CH', viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(T)
const step = m => console.log(`• ${m}`)

async function unlock() {
  const btn = page.getByRole('button', { name: 'Entsperren' })
  await btn.waitFor()
  await page.getByLabel('Passphrase').fill(PASS)
  await btn.click()
  await page.locator('.topbar').waitFor()
}

async function login() {
  await page.goto(url('/de/anmelden'))
  await page.getByLabel('E-Mail').fill(EMAIL)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
  const ok = await Promise.race([
    page.locator('.topbar').waitFor().then(() => true),
    page.locator('.errorbox').waitFor().then(() => false)
  ])
  return ok
}

async function register() {
  await page.goto(url('/de/registrieren'))
  await page.getByLabel('E-Mail').fill(EMAIL)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await page.getByLabel('Passphrase wiederholen').fill(PASS)
  await page.getByText('Ich verstehe').click()
  await page.getByRole('button', { name: 'Weiter zum Recovery-Kit' }).click()
  const cells = page.locator('[data-testid="recovery-words"] .word')
  await cells.first().waitFor()
  const words = (await cells.allTextContents()).map(t => t.replace(/^\d+/, '').trim())
  await page.getByText('Ich habe die 24 Wörter').click()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  for (const label of await page.locator('.confirmwords label').allTextContents()) {
    await page.getByLabel(label, { exact: true }).fill(words[Number(label.replace(/\D+/g, '')) - 1])
  }
  await page.getByRole('button', { name: 'Konto erstellen' }).click()
  await page.waitForURL(/\/app/)
  await page.locator('.topbar').waitFor()
  return words
}

async function setPlan() {
  await page.goto(url('/de/admin'))
  await page.getByRole('tab', { name: 'Konten' }).click()
  await page.getByPlaceholder(/Suchen/).fill(EMAIL)
  await page.getByLabel(`Paket für ${EMAIL}`).selectOption(PLAN)
  await page.locator('tr', { hasText: EMAIL }).filter({ hasText: PLAN === 'free' ? 'Free' : 'monatlich' }).waitFor()
  await page.goto(url('/de/app'))
  await unlock()
}

const nav = async name => {
  await page.locator('.sidebar').getByRole('button', { name }).first().click()
  await page.waitForTimeout(600)
}

async function upload(files) {
  for (const f of files) {
    await page.getByTestId('upload-input').setInputFiles(f)
    await page.locator('.filecard', { hasText: f.name.split('/').pop() }).first().waitFor()
  }
}

const buf = (s, n = 1) => Buffer.from(s.repeat(n))

// ------------------------------------------------------------------
if (await login()) step(`angemeldet als ${EMAIL} (Konto existiert bereits)`)
else {
  const words = await register()
  step(`Konto ${EMAIL} erstellt – Recovery-Wörter: ${words.join(' ')}`)
}
if (PLAN !== 'free') {
  await setPlan()
  step(`Plan ${PLAN} gesetzt`)
}

// Dateien (nur wenn noch keine vorhanden)
await nav(/^Meine Cloud/)
if ((await page.locator('.filecard').count()) === 0) {
  await upload([
    { name: 'Vertrag-2026.pdf', mimeType: 'application/pdf', buffer: buf('%PDF-1.4 Mietvertrag Zürich ', 6000) },
    { name: 'Urlaub-Tessin.jpg', mimeType: 'image/jpeg', buffer: buf('JPEGDATA', 50000) },
    { name: 'Farbverlauf.png', mimeType: 'image/png', buffer: buf('PNGDATA', 14000) },
    { name: 'Steuer-Backup.zip', mimeType: 'application/zip', buffer: buf('PK ZIP', 15000) },
    { name: 'ROADMAP.md', mimeType: 'text/markdown', buffer: buf('# Roadmap\n- Q4: Mobile Apps\n', 400) }
  ])
  // Ordner mit Inhalt
  await page.getByRole('button', { name: /Neuer Ordner/ }).click()
  await page.getByLabel('Name des Ordners').fill('Laptop-Backup')
  await page.getByRole('button', { name: 'Anlegen' }).click()
  await upload([
    { name: 'notiz.txt', mimeType: 'text/plain', buffer: buf('Einkaufsliste\n') },
    { name: 'fotos-2026.tar', mimeType: 'application/x-tar', buffer: buf('TAR', 400000) }
  ])
  await page.locator('.crumbs').getByRole('button', { name: /Meine Cloud/ }).click()
  step('Dateien und Ordner hochgeladen')
}

// Passwörter
await nav(/^Passwörter/)
if ((await page.locator('.secrow').count()) === 0) {
  for (const [t, u, site, folder, pw] of [
    ['PostFinance', 'anna.demo', 'https://postfinance.ch', 'Finanzen', 'k7#Qz!v9Lp$2wXr&Tm4e'],
    ['Google', 'anna.demo@gmail.com', 'https://accounts.google.com', 'Privat', 'Sonne-Wolke-42!Berg'],
    ['GitHub', 'annademo', 'https://github.com', 'Arbeit', 'passwort123'],
    ['Swisscom', 'anna@example.ch', 'https://swisscom.ch', 'Privat', 'passwort123'],
    ['Digitec', 'anna.demo@example.com', 'https://digitec.ch', 'Einkaufen', 'Zr8!mQ2#vL9pXe4$']
  ]) {
    await page.getByRole('button', { name: '+ Neues Passwort' }).click()
    await page.getByLabel(/Titel/).fill(t)
    await page.locator('.secform').getByPlaceholder('name@example.com').fill(u)
    await page.locator('.secform').getByPlaceholder('••••••••').fill(pw)
    await page.locator('.secform').getByPlaceholder('https://…').fill(site)
    await page.locator('.secform input[list="pw-folders"]').fill(folder)
    await page.getByRole('button', { name: 'Speichern' }).click()
    await page.locator('.secrow', { hasText: t }).waitFor()
  }
  step('Passwörter angelegt')
}

// 2FA (ab Pro)
if (PLAN !== 'free') {
  await nav(/2FA/)
  if ((await page.locator('.totpcard').count()) === 0) {
    for (const [issuer, uri] of [
      ['Google', 'otpauth://totp/Google:anna.demo@gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google'],
      ['GitHub', 'otpauth://totp/GitHub:annademo?secret=KRSXG5CTMVRXEZLU&issuer=GitHub'],
      ['PostFinance', 'otpauth://totp/PostFinance:anna?secret=GEZDGNBVGY3TQOJQ&issuer=PostFinance']
    ]) {
      await page.getByRole('button', { name: '+ Konto hinzufügen' }).click()
      await page.getByPlaceholder(/otpauth:\/\/totp/).fill(uri)
      await page.locator('form .secfields input').first().fill(issuer)
      await page.locator('form button.primary[type="submit"]').click()
      await page.locator('.totpcard', { hasText: issuer }).waitFor()
    }
    step('2FA-Konten angelegt')
  }
}

// Notizen
await nav(/^Notizen/)
if ((await page.locator('.noterow').count()) === 0) {
  const iso = d => d.toISOString().slice(0, 10)
  const in40 = new Date(Date.now() + 40 * 86_400_000)
  const nextMonth = new Date()
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  const ym = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`

  await page.getByRole('button', { name: '+ Neue Notiz' }).click()
  await page.getByLabel('Titel').fill('Umzug Checkliste')
  await page.getByLabel('Inhalt').fill('## Vor dem Umzug\n- [x] Kartons bestellen\n- [ ] Adresse bei der Bank ändern\n- [ ] **Post** umleiten\n\nWichtig: Schlüsselübergabe am 30.')
  await page.getByLabel('Tags').fill('Privat')
  await page.locator('.secform').getByText('Angeheftet').click()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await page.locator('.noterow', { hasText: 'Umzug Checkliste' }).waitFor()

  const tpl = async (name, title, fields, tags) => {
    await page.getByRole('button', { name: 'Aus Vorlage' }).click()
    await page.getByRole('menuitem', { name }).click()
    await page.getByLabel('Titel').fill(title)
    for (const [label, value] of fields) await page.getByLabel(label, { exact: true }).fill(value)
    if (tags) await page.getByLabel('Tags').fill(tags)
    await page.getByRole('button', { name: 'Speichern' }).click()
    await page.locator('.noterow', { hasText: title }).waitFor()
  }
  await tpl(/WLAN/, 'WLAN Zuhause', [['Netzwerkname (SSID)', 'Tessin-5G'], ['Passwort', 'geheim-12345']], 'Zuhause')
  await tpl(/Ausweis/, 'Reisepass', [['Name', 'Anna Demo'], ['Nummer', 'X1234567'], ['Gültig bis', iso(in40)]], 'Reisen')
  await tpl(/Kreditkarte/, 'Kreditkarte Visa', [['Karteninhaber', 'Anna Demo'], ['Gültig bis', ym]], 'Finanzen').catch(e => console.warn('  Kreditkarte übersprungen:', String(e).slice(0, 120)))
  step('Notizen angelegt')
}

await page.waitForTimeout(3000)
console.log(`\nFertig: ${EMAIL} / ${PASS} (Plan ${PLAN})`)
await browser.close()

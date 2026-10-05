/**
 * Big-Mac-Index (Kaufkraftparität) für Preisvorschläge – reine Funktionen, Client und Server.
 * Quelle: The Economist, big-mac-data (github.com/TheEconomist/big-mac-data,
 * output-data/big-mac-raw-index.csv), Ausgabe 2026-07-01. Lizenz: siehe Repository.
 * Je Währung: [Big-Mac-Preis in Landeswährung, Kurs je 1 USD am Stichtag].
 *
 * Verwendung heute: CHF- und EUR-Preise im Admin aus den USD-Preisen ableiten (Vorschlag,
 * gespeichert wird erst mit „Preisbuch speichern“). bigMacPrice() für alle anderen Währungen
 * ist für spätere Abrechnung in Landeswährung vorbereitet – wird heute nicht verrechnet.
 */
import type { Currency, Money, PricingConfig } from './pricing'
import { displayCurrency, STATIC_USD_RATES } from './region'

export const BIG_MAC_EDITION = '2026-07-01'
export const BIG_MAC_SOURCE = 'https://github.com/TheEconomist/big-mac-data'

export const BIG_MAC: Record<string, readonly [local: number, perUsd: number]> = {
  AED: [19, 3.67285], // Vereinigte Arabische Emirate
  ARS: [8700, 1472.99], // Argentinien
  AUD: [8.5, 1.42867], // Australien
  AZN: [7.25, 1.7], // Aserbaidschan
  BHD: [1.8, 0.37705], // Bahrain
  BRL: [23.9, 5.07935], // Brasilien
  CAD: [8.17, 1.40515], // Kanada
  CHF: [7.3, 0.80735], // Schweiz
  CLP: [4990, 922.715], // Chile
  CNY: [26.5, 6.7708], // China
  COP: [25900, 3236.28], // Kolumbien
  CRC: [3150, 450.28], // Costa Rica
  CZK: [115, 21.1625], // Tschechien
  DKK: [46, 6.5366], // Dänemark
  EGP: [145, 50.53], // Ägypten
  EUR: [6.19, 0.87439], // Euroraum (Durchschnitt)
  GBP: [5.49, 0.74187], // Grossbritannien
  GTQ: [34, 7.6199], // Guatemala
  HKD: [25.5, 7.83895], // Hongkong
  HNL: [139, 26.77], // Honduras
  HUF: [1660, 313.352], // Ungarn
  IDR: [43000, 18065], // Indonesien
  ILS: [23, 2.9993], // Israel
  INR: [236.25, 96.2638], // Indien
  JOD: [2.5, 0.709], // Jordanien
  JPY: [500, 162.135], // Japan
  KRW: [5700, 1485.9], // Südkorea
  KWD: [1.4, 0.3095], // Kuwait
  LBP: [480000, 89550], // Libanon
  MDL: [80, 17.55], // Moldau
  MXN: [109, 17.386], // Mexiko
  MYR: [14.55, 4.078], // Malaysia
  NIO: [187, 36.6243], // Nicaragua
  NOK: [78, 9.68565], // Norwegen
  NZD: [8.8, 1.71336], // Neuseeland
  OMR: [1.53, 0.38505], // Oman
  PEN: [16.9, 3.3857], // Peru
  PHP: [169, 61.685], // Philippinen
  PKR: [1080, 277.925], // Pakistan
  PLN: [23.5, 3.77915], // Polen
  QAR: [18, 3.641], // Katar
  RON: [18.35, 4.58165], // Rumänien
  SAR: [19, 3.755], // Saudi-Arabien
  SEK: [69, 9.63495], // Schweden
  SGD: [7.45, 1.29005], // Singapur
  THB: [135, 33.62], // Thailand
  TRY: [325, 47.0275], // Türkei
  TWD: [78, 32.1875], // Taiwan
  UAH: [149, 44.6702], // Ukraine
  USD: [6.22, 1], // USA
  UYU: [359, 40.165], // Uruguay
  VES: [3267, 724.84], // Venezuela
  VND: [76000, 26255.5], // Vietnam
  ZAR: [56.9, 16.325] // Südafrika
}

/** Kaufkraft-Faktor: Landeswährung je 1 USD laut Big Mac (z. B. CHF 7.30 / $6.22 = 1.17). */
export function bigMacRatio(code: string): number | null {
  const c = code.toUpperCase()
  const local = BIG_MAC[c]?.[0]
  return local ? local / BIG_MAC.USD[0] : null
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** nächster Wert der Form k·step − minus (k ≥ 1) */
function nearest(n: number, step: number, minus: number): number {
  const k = Math.max(1, Math.round((n + minus) / step))
  return r2(k * step - minus)
}

/**
 * Ganzzahlige Preise statt Rappen/Cents: Währungen ohne Nachkommastellen (JPY, KRW …)
 * und „kleine“ Währungen ab 3 Einheiten je USD (INR, SEK, BRL …).
 */
function wholeStyle(code: string): boolean {
  const c = code.toUpperCase()
  const info = displayCurrency(c)
  if (info?.decimals === 0) return true
  const perUsd = STATIC_USD_RATES[c] ?? BIG_MAC[c]?.[1] ?? 1
  return perUsd >= 3
}

/**
 * Schwellenpreis passend zur Grössenordnung der Währung.
 * Cents-Währungen (CHF, EUR, USD, GBP …): unter 1000 auf .49/.99 (13.99, 14.49, 174.99),
 * ab 1000 ganze Zahlen auf …49/…99 (1 399, 1 449), ab 10 000 auf …499/…999.
 * Ganzzahl-Währungen: 15 · 49 · 449 · 2 190 · 19 900 · 249 000.
 */
export function charmRound(n: number, code: string): number {
  if (!(n > 0) || !Number.isFinite(n)) return 0
  if (wholeStyle(code)) {
    if (n < 20) return Math.max(1, Math.round(n))
    if (n < 100) return nearest(n, 5, 1)
    if (n < 1000) return nearest(n, 10, 1)
    if (n < 10_000) return nearest(n, 100, 10)
    const step = 10 ** (Math.floor(Math.log10(n)) - 1)
    return nearest(n, step, step / 10)
  }
  if (n < 1) return nearest(n, 0.1, 0.01)
  if (n < 1000) return nearest(n, 0.5, 0.01)
  if (n < 10_000) return nearest(n, 50, 1)
  return nearest(n, 500, 1)
}

/**
 * Kaufkraftbereinigter Preis in Landeswährung aus einem USD-Preis, als Schwellenpreis.
 * Ohne Big-Mac-Daten für die Währung: Marktkurs aus `fx` (Einheiten je USD) bzw. Richtkurs.
 * Unbekannte Währung: null.
 */
export function bigMacPrice(usd: number, code: string, fx?: Record<string, number>): number | null {
  const c = code.toUpperCase()
  if (c === 'USD') return usd
  const factor = bigMacRatio(c) ?? fx?.[c] ?? STATIC_USD_RATES[c]
  return factor && factor > 0 ? charmRound(usd * factor, c) : null
}

/**
 * Preisbuch-Vorschlag: CHF und EUR aus den USD-Preisen per Big-Mac-Index (EUR = Euroraum).
 * Betrifft Pakete, Zusatzspeicher (privat und Business), Business-Stufen und Nutzerplätze.
 * PAYG- und API-Preise bleiben unverändert (Kleinstbeträge je GB).
 */
export function suggestBillingPrices(pricing: PricingConfig): PricingConfig {
  const p = structuredClone(pricing)
  const derive = (m: Money) => {
    for (const c of ['CHF', 'EUR'] as Currency[]) m[c] = bigMacPrice(m.USD, c) ?? m[c]
  }
  const item = (x: { monthly: Money; yearly: Money }) => {
    derive(x.monthly)
    derive(x.yearly)
  }
  item(p.plans.pro)
  item(p.plans.family)
  p.addons.forEach(item)
  p.businessAddons.forEach(item)
  item(p.business.starter)
  item(p.business.business)
  item(p.business.seat)
  derive(p.business.enterprise.fromMonthly)
  return p
}

import { describe, expect, it } from 'vitest'
import { DEFAULT_PRICING as P, DEFAULT_SCENARIO, GB, TB, computeEconomics, costChfPerGb, paygInvoiceChf, scenario } from './pricing'

const empty = { accounts: 0, storedBytes: 0 }

describe('Preisbuch & Wirtschaftlichkeit', () => {
  it('Kosten pro GB = Fil-One-Preis × Kurs', () => {
    expect(costChfPerGb(P)).toBeCloseTo((4.99 / 1000) * 0.85, 10)
  })

  it('Pay-as-you-go: nur über der Free-Quota, erst ab Mindestbetrag', () => {
    expect(paygInvoiceChf(P, 5 * GB)).toBe(0)
    expect(paygInvoiceChf(P, 50 * GB)).toBe(0) // 45 GB × 0.02 = 0.90 < 2 CHF
    expect(paygInvoiceChf(P, 105 * GB)).toBe(2) // 100 GB × 0.02
    expect(paygInvoiceChf(P, 205 * GB)).toBe(4)
  })

  it('Fil-One-Minimum greift bei wenig Daten', () => {
    const e = computeEconomics(P, {
      free: { accounts: 1, storedBytes: 1 * GB },
      pro: empty,
      family: empty,
      business: empty,
      addons: { active: 0, chfPerMonth: 0 },
      payg: { invoices: 0, chfPerMonth: 0, billableBytes: 0 }
    })
    expect(e.cost.storageUsd).toBe(4.99)
  })

  it('Pro bleibt selbst bei voller Auslastung profitabel', () => {
    const e = computeEconomics(P, {
      free: empty,
      pro: { accounts: 1000, storedBytes: 1000 * TB },
      family: empty,
      business: empty,
      addons: { active: 0, chfPerMonth: 0 },
      payg: { invoices: 0, chfPerMonth: 0, billableBytes: 0 }
    })
    expect(e.revenue.totalChf).toBe(13_900)
    expect(e.grossMarginPct).toBeGreaterThan(55)
  })

  it('Free-Subvention, Worst Case und benötigte Pro-Kunden', () => {
    const e = computeEconomics(P, {
      free: { accounts: 100_000, storedBytes: 100_000 * 1.5 * GB },
      pro: empty,
      family: empty,
      business: empty,
      addons: { active: 0, chfPerMonth: 0 },
      payg: { invoices: 0, chfPerMonth: 0, billableBytes: 0 }
    })
    expect(e.freeTier.subsidyChf).toBeCloseTo(150_000 * costChfPerGb(P), 1)
    expect(e.freeTier.worstCaseChf).toBeCloseTo(500_000 * costChfPerGb(P), 1)
    expect(e.freeTier.proCustomersToCover).toBeGreaterThan(0)
    expect(e.freeTier.proCustomersToCover).toBeLessThan(200)
  })

  it('Standard-Szenario 100 000 Nutzer ist deutlich profitabel', () => {
    const e = scenario(P, DEFAULT_SCENARIO)
    expect(e.perPlan.find(r => r.plan === 'free')!.accounts).toBe(97_000)
    expect(e.revenue.totalChf).toBeGreaterThan(40_000)
    expect(e.grossMarginPct).toBeGreaterThan(70)
  })
})

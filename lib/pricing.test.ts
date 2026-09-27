import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING as P,
  DEFAULT_SCENARIO,
  GB,
  TB,
  computeEconomics,
  costChfPerGb,
  money,
  monthlyEquivalent,
  paygEstimate,
  scenario,
  toChf,
  yearlySavingsPct
} from './pricing'

const empty = { accounts: 0, storedBytes: 0 }
const noRevenue = { proChf: 0, familyChf: 0, addonsChf: 0, paygChf: 0 }

describe('Preisbuch v2: Währungen, Jahresabos, Pay-as-you-go', () => {
  it('Jahresabo = 2 Monate geschenkt (≈ 17 %) in allen Währungen', () => {
    for (const c of ['CHF', 'EUR', 'USD'] as const) {
      expect(yearlySavingsPct(P.plans.pro, c)).toBeGreaterThanOrEqual(16)
      expect(yearlySavingsPct(P.plans.family, c)).toBeGreaterThanOrEqual(16)
      for (const a of P.addons) expect(yearlySavingsPct(a, c)).toBeGreaterThanOrEqual(15)
    }
    expect(monthlyEquivalent(P.plans.pro, 'year', 'CHF')).toBeCloseTo(139 / 12, 5)
  })

  it('Pay-as-you-go: nur über der Free-Quota; unter dem Mindestbetrag wird übertragen', () => {
    expect(paygEstimate(P, 5 * GB, 'CHF')).toMatchObject({ billableGb: 0, amount: 0, charged: false })
    expect(paygEstimate(P, 45 * GB, 'CHF')).toMatchObject({ billableGb: 40, amount: 1.2, charged: false })
    expect(paygEstimate(P, 105 * GB, 'CHF')).toMatchObject({ amount: 3, charged: true })
    expect(paygEstimate(P, 105 * GB, 'USD').amount).toBe(3.5)
    // ab ~464 GB extra wäre Pro günstiger
    expect(paygEstimate(P, 0, 'CHF').proBreakEvenGb).toBe(Math.ceil(13.9 / 0.03))
  })

  it('PAYG-Marge ≥ 80 %', () => {
    const cost = costChfPerGb(P)
    for (const c of ['CHF', 'EUR', 'USD'] as const) {
      const price = toChf(P, P.payg.perGbMonth[c], c)
      expect(1 - cost / price).toBeGreaterThan(0.8)
    }
  })

  it('Fil-One-Minimum und volle Auslastung', () => {
    const tiny = computeEconomics(P, {
      free: { accounts: 1, storedBytes: 1 * GB },
      pro: empty,
      family: empty,
      business: empty,
      revenue: noRevenue,
      invoicesPerMonth: 0,
      addonsActive: 0,
      paygBillableBytes: 0
    })
    expect(tiny.cost.storageUsd).toBe(4.99)
    const full = computeEconomics(P, {
      free: empty,
      pro: { accounts: 1000, storedBytes: 1000 * TB },
      family: empty,
      business: empty,
      revenue: { ...noRevenue, proChf: 13_900 },
      invoicesPerMonth: 1000,
      addonsActive: 0,
      paygBillableBytes: 0
    })
    expect(full.grossMarginPct).toBeGreaterThan(55)
  })

  it('Standard-Szenario 100 000 Nutzer (Jahres- und Währungsmix) ist deutlich profitabel', () => {
    const e = scenario(P, DEFAULT_SCENARIO)
    expect(e.perPlan.find(r => r.plan === 'free')!.accounts).toBe(97_000)
    expect(e.revenue.totalChf).toBeGreaterThan(35_000)
    expect(e.grossMarginPct).toBeGreaterThan(75)
  })

  it('Formatierung je Währung und Sprache', () => {
    expect(money(13.9, 'CHF', 'de')).toBe('13.90 CHF')
    expect(money(13.9, 'EUR', 'de')).toBe('13,90 €')
    expect(money(14.9, 'USD', 'en')).toBe('$14.90')
    expect(money(13.9, 'EUR', 'en')).toBe('€13.90')
  })
})

describe('Speicherkosten je Anbieter und API-Preis', () => {
  it('FOC mit 2 Kopien ist günstiger als Fil One, beides zusammen teurer', async () => {
    const { DEFAULT_PRICING: P, costUsdPerGb, markupOf } = await import('./pricing')
    expect(costUsdPerGb(P, 'filone')).toBeCloseTo(0.00499, 5)
    expect(costUsdPerGb(P, 'foc')).toBeCloseTo(0.004547, 5)
    expect(costUsdPerGb(P, 'both')).toBeCloseTo(0.009537, 5)
    // Pay-as-you-go: deutlich über 100 % Aufschlag, auch wenn wir doppelt speichern
    for (const c of ['CHF', 'EUR', 'USD'] as const) {
      expect(markupOf(P, P.payg.perGbMonth[c], c, 'both').markupPct).toBeGreaterThan(200)
      expect(markupOf(P, P.api.perGbMonth[c], c, 'foc').markupPct).toBeGreaterThan(100)
    }
  })
})

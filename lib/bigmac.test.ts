import { describe, expect, it } from 'vitest'
import { BIG_MAC, bigMacPrice, bigMacRatio, charmRound, suggestBillingPrices } from './bigmac'
import { DEFAULT_PRICING } from './pricing'

describe('charmRound', () => {
  it('Cents-Währungen: .49/.99 unter 1000', () => {
    expect(charmRound(13.9, 'CHF')).toBe(13.99)
    expect(charmRound(14.3, 'CHF')).toBe(14.49)
    expect(charmRound(14.83, 'EUR')).toBe(14.99)
    expect(charmRound(174.87, 'CHF')).toBe(174.99)
    expect(charmRound(0.4, 'USD')).toBe(0.39)
    expect(charmRound(0.03, 'CHF')).toBe(0.09)
  })

  it('Cents-Währungen: ganze Zahlen ab 1000', () => {
    expect(charmRound(1390, 'USD')).toBe(1399)
    expect(charmRound(1440, 'EUR')).toBe(1449)
    expect(charmRound(79000, 'CHF')).toBe(78999)
  })

  it('Ganzzahl-Währungen nach Grössenordnung', () => {
    expect(charmRound(2187, 'JPY')).toBe(2190)
    expect(charmRound(19870, 'KRW')).toBe(19900)
    expect(charmRound(452, 'INR')).toBe(449)
    expect(charmRound(248500, 'IDR')).toBe(249000)
    expect(charmRound(47, 'BRL')).toBe(49)
    expect(charmRound(7.6, 'SEK')).toBe(8)
  })

  it('ungültige Werte → 0', () => {
    expect(charmRound(0, 'CHF')).toBe(0)
    expect(charmRound(-5, 'CHF')).toBe(0)
    expect(charmRound(NaN, 'CHF')).toBe(0)
  })
})

describe('bigMacPrice', () => {
  it('nutzt das Big-Mac-Verhältnis', () => {
    expect(bigMacRatio('USD')).toBe(1)
    expect(bigMacRatio('chf')).toBeCloseTo(7.3 / 6.22, 6)
    expect(bigMacPrice(14.9, 'CHF')).toBe(17.49)
    expect(bigMacPrice(14.9, 'EUR')).toBe(14.99)
    expect(bigMacPrice(14.9, 'JPY')).toBe(1190)
    expect(bigMacPrice(14.9, 'KRW')).toBe(13900)
    expect(bigMacPrice(14.9, 'INR')).toBe(569)
    expect(bigMacPrice(14.9, 'USD')).toBe(14.9)
  })

  it('ohne Big-Mac-Daten: Marktkurs bzw. Richtkurs', () => {
    expect(BIG_MAC.NGN).toBeUndefined()
    expect(bigMacPrice(10, 'NGN', { NGN: 1500 })).toBe(14900)
    expect(bigMacPrice(10, 'NGN')).toBe(12900)
    expect(bigMacPrice(10, 'XXX')).toBeNull()
  })
})

describe('suggestBillingPrices', () => {
  const s = suggestBillingPrices(DEFAULT_PRICING)

  it('leitet CHF/EUR aus USD ab, USD und PAYG bleiben', () => {
    expect(s.plans.pro.monthly).toEqual({ CHF: 17.49, EUR: 14.99, USD: 14.9 })
    expect(s.plans.pro.yearly.USD).toBe(149)
    expect(s.payg).toEqual(DEFAULT_PRICING.payg)
    expect(s.api).toEqual(DEFAULT_PRICING.api)
    expect(s.business.seat.monthly.CHF).toBe(10.49)
    expect(s.business.enterprise.fromMonthly.EUR).toBe(bigMacPrice(529, 'EUR'))
  })

  it('verändert das Original nicht', () => {
    expect(DEFAULT_PRICING.plans.pro.monthly.CHF).toBe(13.9)
  })

  it('alle Preise sind Schwellenpreise', () => {
    const all = [
      s.plans.pro,
      s.plans.family,
      ...s.addons,
      ...s.businessAddons,
      s.business.starter,
      s.business.business,
      s.business.seat
    ].flatMap(x => [x.monthly, x.yearly])
    for (const m of all) {
      for (const v of [m.CHF, m.EUR]) {
        if (v < 1000) expect(Math.round(v * 100) % 50).toBe(49)
        else expect(v % 50).toBe(49)
      }
    }
  })
})

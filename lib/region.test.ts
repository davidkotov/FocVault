import { describe, expect, it } from 'vitest'
import { billingCurrencyFor, convert, DISPLAY_CURRENCIES, formatMoney, LANGUAGES } from './region'

describe('Region', () => {
  it('50 Sprachen und 50 Währungen, eindeutig', () => {
    expect(LANGUAGES).toHaveLength(50)
    expect(new Set(LANGUAGES.map(l => l.code)).size).toBe(50)
    expect(LANGUAGES.filter(l => l.translated).map(l => l.code).sort()).toEqual(['de', 'en'])
    expect(DISPLAY_CURRENCIES).toHaveLength(50)
    expect(new Set(DISPLAY_CURRENCIES.map(c => c.code)).size).toBe(50)
    for (const c of ['CHF', 'EUR', 'USD']) expect(DISPLAY_CURRENCIES.some(d => d.code === c)).toBe(true)
    for (const l of LANGUAGES) expect(() => new Intl.Locale(l.code)).not.toThrow()
  })

  it('Abrechnungswährung', () => {
    expect(billingCurrencyFor('CHF')).toBe('CHF')
    expect(billingCurrencyFor('eur')).toBe('EUR')
    expect(billingCurrencyFor('SEK')).toBe('EUR')
    expect(billingCurrencyFor('GBP')).toBe('EUR')
    expect(billingCurrencyFor('JPY')).toBe('USD')
    expect(billingCurrencyFor('USD')).toBe('USD')
  })

  it('formatMoney mit ISO-Nachkommastellen', () => {
    expect(formatMoney(2190, 'JPY', 'en-US')).toBe('¥2,190')
    expect(formatMoney(14.9, 'USD', 'en-US')).toBe('$14.90')
    expect(formatMoney(1.5, 'KWD', 'en-US')).toContain('1.500')
    expect(formatMoney(5, 'chf', 'de-CH')).toMatch(/^CHF\s5\.00$/)
  })

  it('convert über USD-Basis', () => {
    const rates = { USD: 1, EUR: 0.9, CHF: 0.8 }
    expect(convert(10, 'USD', 'EUR', rates)).toBeCloseTo(9)
    expect(convert(9, 'EUR', 'CHF', rates)).toBeCloseTo(8)
    expect(convert(5, 'CHF', 'CHF', rates)).toBe(5)
    expect(convert(5, 'CHF', 'JPY', rates)).toBeNaN()
  })
})

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DISPLAY_CURRENCIES, STATIC_USD_RATES } from '../../lib/region'
import { openMemoryDb, type Db } from '../db'
import { FX_TTL_MS, fetchRates, getFxRates, resetFxCache, validRates } from './rates'

const CODES = DISPLAY_CURRENCIES.map(c => c.code)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Kurse leicht neben den Richtkursen, damit erkennbar ist, woher sie stammen */
const live = (factor: number) => Object.fromEntries(CODES.map(c => [c, c === 'USD' ? 1 : STATIC_USD_RATES[c] * factor]))

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>
function mockFetch(routes: Record<string, Route>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const hit = Object.keys(routes).find(prefix => url.startsWith(prefix))
    if (!hit) throw new Error(`unerwarteter Abruf: ${url}`)
    return routes[hit](url, init)
  })
}

const fixerOk = (factor = 1.01): Route => () => {
  const usd = live(factor)
  const eurPerUsd = usd.EUR
  // Basis EUR: Einheiten je 1 EUR
  return json({ success: true, base: 'EUR', rates: Object.fromEntries(CODES.map(c => [c, c === 'EUR' ? 1 : usd[c] / eurPerUsd])) })
}
const fail: Route = () => json({ error: 'nope' }, 500)
const erApi = (factor = 1.03): Route => () => json({ result: 'success', base_code: 'USD', rates: live(factor) })
const geckoPartial: Route = () => {
  const usdPerBtc = 60000
  const r = live(1.02)
  const rates: Record<string, { value: number; type: string }> = { btc: { value: 1, type: 'crypto' } }
  for (const c of ['USD', 'EUR', 'CHF', 'JPY']) rates[c.toLowerCase()] = { value: r[c] * usdPerBtc, type: 'fiat' }
  return json({ rates })
}

beforeEach(() => {
  resetFxCache()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('fetchRates', () => {
  it('Fixer: Basis EUR wird auf USD umgerechnet', async () => {
    const f = mockFetch({ 'https://data.fixer.io/api/latest': fixerOk() })
    const r = await fetchRates({ env: { FIXER_API_KEY: 'k1' }, fetch: f })
    expect(r.source).toBe('fixer')
    expect(r.base).toBe('USD')
    expect(r.rates.USD).toBe(1)
    expect(r.rates.CHF).toBeCloseTo(STATIC_USD_RATES.CHF * 1.01, 6)
    expect(r.rates.EUR).toBeCloseTo(STATIC_USD_RATES.EUR * 1.01, 6)
    expect(Object.keys(r.rates)).toHaveLength(50)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toContain('access_key=k1')
    expect(f.mock.calls[0][0]).toMatch(/symbols=USD,/)
  })

  it('Fixer ohne HTTPS-Freigabe: einmal per HTTP', async () => {
    const f = mockFetch({
      'https://data.fixer.io': () => json({ success: false, error: { code: 105, type: 'https_access_restricted' } }),
      'http://data.fixer.io': fixerOk()
    })
    const r = await fetchRates({ env: { FIXER_API_KEY: 'k' }, fetch: f })
    expect(r.source).toBe('fixer')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('Leiter: Fehler → ohne Schlüssel übersprungen → Lücken vom nächsten Anbieter', async () => {
    const f = mockFetch({
      'https://data.fixer.io': fail,
      'https://api.coingecko.com': geckoPartial,
      'https://open.er-api.com': erApi()
    })
    const r = await fetchRates({ env: { FIXER_API_KEY: 'k' }, fetch: f })
    expect(r.source).toBe('coingecko+open.er-api')
    expect(r.rates.CHF).toBeCloseTo(STATIC_USD_RATES.CHF * 1.02, 6)
    expect(r.rates.SEK).toBeCloseTo(STATIC_USD_RATES.SEK * 1.03, 6)
    expect(f.mock.calls.some(([u]) => u.includes('coinmarketcap'))).toBe(false)
  })

  it('CoinGecko mit Demo-Schlüssel im Header', async () => {
    const f = mockFetch({ 'https://api.coingecko.com': geckoPartial, 'https://open.er-api.com': erApi() })
    await fetchRates({ env: { COINGECKO_API_KEY: 'CG-x' }, fetch: f })
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)['x-cg-demo-api-key']).toBe('CG-x')
  })

  it('CoinMarketCap: ein Aufruf mit allen Währungen', async () => {
    const r1 = live(1.04)
    const f = mockFetch({
      'https://pro-api.coinmarketcap.com': url => {
        const convert = new URL(url).searchParams.get('convert')!.split(',')
        return json({ status: { error_code: 0 }, data: { id: 2781, symbol: 'USD', quote: Object.fromEntries(convert.map(c => [c, { price: r1[c] }])) } })
      }
    })
    const r = await fetchRates({ env: { COINMARKETCAP_API_KEY: 'cmc' }, fetch: f })
    expect(r.source).toBe('coinmarketcap')
    expect(r.rates.JPY).toBeCloseTo(STATIC_USD_RATES.JPY * 1.04, 6)
    expect(f).toHaveBeenCalledTimes(1)
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)['X-CMC_PRO_API_KEY']).toBe('cmc')
  })

  it('CoinMarketCap Basic-Plan (1 Zielwährung): höchstens 25 Einzelabrufe, Rest vom nächsten Anbieter', async () => {
    const r1 = live(1.04)
    const f = mockFetch({
      'https://pro-api.coinmarketcap.com': url => {
        const convert = new URL(url).searchParams.get('convert')!.split(',')
        if (convert.length > 1) return json({ status: { error_code: 400, error_message: 'Your plan is limited to 1 convert options' } }, 400)
        return json({ status: { error_code: 0 }, data: [{ quote: { [convert[0]]: { price: r1[convert[0]] } } }] })
      },
      'https://api.coingecko.com': fail,
      'https://open.er-api.com': erApi()
    })
    const r = await fetchRates({ env: { COINMARKETCAP_API_KEY: 'cmc' }, fetch: f })
    const cmcCalls = f.mock.calls.filter(([u]) => u.includes('coinmarketcap')).length
    expect(cmcCalls).toBe(26)
    expect(r.source).toBe('coinmarketcap+open.er-api')
    expect(r.rates.EUR).toBeCloseTo(STATIC_USD_RATES.EUR * 1.04, 6)
    expect(r.rates.KES).toBeCloseTo(STATIC_USD_RATES.KES * 1.03, 6)
  })

  it('unplausible Kurse werden verworfen', async () => {
    const bad = live(1)
    bad.CHF = -1
    bad.JPY = 1 / STATIC_USD_RATES.JPY // vertauschte Basis
    const f = mockFetch({ 'https://api.coingecko.com': fail, 'https://open.er-api.com': () => json({ result: 'success', base_code: 'USD', rates: bad }) })
    const r = await fetchRates({ env: {}, fetch: f })
    expect(r.source).toBe('open.er-api+static')
    expect(r.rates.CHF).toBe(STATIC_USD_RATES.CHF)
    expect(r.rates.JPY).toBe(STATIC_USD_RATES.JPY)
    expect(validRates({ USD: 1.5 }, ['USD'])).toEqual({})
  })

  it('alle Anbieter weg → Richtkurse', async () => {
    const f = mockFetch({ 'https://api.coingecko.com': fail, 'https://open.er-api.com': () => Promise.reject(new Error('timeout')) })
    const r = await fetchRates({ env: {}, fetch: f })
    expect(r.source).toBe('static')
    expect(r.rates).toEqual(STATIC_USD_RATES)
  })
})

describe('getFxRates (Cache)', () => {
  let db: Db
  afterAll(async () => db?.close())

  it('DB-Cache: einmal abrufen, danach aus DB bzw. Prozess, nach 24 h neu', async () => {
    db = await openMemoryDb()
    const f = mockFetch({ 'https://api.coingecko.com': fail, 'https://open.er-api.com': erApi() })
    const t0 = Date.parse('2026-10-04T00:00:00Z')
    const opts = { db, env: {}, fetch: f, now: () => t0 }

    const [a, b] = await Promise.all([getFxRates(opts), getFxRates(opts)])
    expect(a).toBe(b)
    expect(f).toHaveBeenCalledTimes(2) // coingecko (Fehler) + open.er-api – nur ein Abruf trotz zwei Anfragen
    const stored = await db.query<{ value: { source: string } }>(`SELECT value FROM settings WHERE key = 'fx_rates'`)
    expect(stored[0].value.source).toBe('open.er-api')

    resetFxCache() // anderer Prozess: liest aus der DB
    const c = await getFxRates({ ...opts, now: () => t0 + 3600_000 })
    expect(c.fetchedAt).toBe(a.fetchedAt)
    expect(f).toHaveBeenCalledTimes(2)

    const d = await getFxRates({ ...opts, now: () => t0 + FX_TTL_MS + 1 })
    expect(Date.parse(d.fetchedAt)).toBe(t0 + FX_TTL_MS + 1)
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('alle Anbieter weg: letzter echter Stand statt Richtkurse', async () => {
    const t0 = Date.parse('2026-10-04T00:00:00Z')
    const ok = mockFetch({ 'https://api.coingecko.com': fail, 'https://open.er-api.com': erApi() })
    const first = await getFxRates({ env: {}, fetch: ok, now: () => t0 })
    const down = mockFetch({ 'https://api.coingecko.com': fail, 'https://open.er-api.com': fail })
    const later = await getFxRates({ env: {}, fetch: down, now: () => t0 + FX_TTL_MS + 1 })
    expect(later).toBe(first)
    // innerhalb der Wartezeit kein neuer Abruf
    await getFxRates({ env: {}, fetch: down, now: () => t0 + FX_TTL_MS + 60_000 })
    expect(down).toHaveBeenCalledTimes(2)
  })

  it('Redis (Upstash REST / Vercel KV) hat Vorrang vor der DB', async () => {
    let saved: string | null = null
    const f = mockFetch({
      'https://kv.example': (_url, init) => {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
        const cmd = JSON.parse(String(init?.body)) as string[]
        if (cmd[0] === 'GET') return json({ result: saved })
        saved = cmd[2]
        expect(cmd.slice(3)).toEqual(['EX', String(30 * 86400)])
        return json({ result: 'OK' })
      },
      'https://api.coingecko.com': fail,
      'https://open.er-api.com': erApi()
    })
    const env = { KV_REST_API_URL: 'https://kv.example/', KV_REST_API_TOKEN: 'tok' }
    const a = await getFxRates({ env, fetch: f })
    expect(JSON.parse(saved!).source).toBe('open.er-api')
    resetFxCache()
    const b = await getFxRates({ env, fetch: f })
    expect(b.fetchedAt).toBe(a.fetchedAt)
    expect(f.mock.calls.filter(([u]) => u.includes('open.er-api'))).toHaveLength(1)
  })
})

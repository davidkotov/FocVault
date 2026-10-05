import type { Db } from '../db'
import { DISPLAY_CURRENCIES, STATIC_USD_RATES } from '../../lib/region'

/**
 * Wechselkurse (Basis USD) für die Preisanzeige in 50 Währungen – nie für die Abrechnung.
 * Anbieter-Leiter mit kurzem Timeout: Fixer → CoinMarketCap → CoinGecko → open.er-api.com →
 * Richtkurse im Code. Anbieter ohne Schlüssel werden übersprungen; fehlende Währungen füllt
 * der nächste Anbieter auf. Geteilter Cache (24 h) für alle Nutzer: Redis (Upstash REST bzw.
 * Vercel KV), sonst Tabelle `settings` (Schlüssel 'fx_rates'), dazu ein Cache im Prozess.
 */
export interface FxRates {
  base: 'USD'
  /** Einheiten je 1 USD */
  rates: Record<string, number>
  /** beteiligte Anbieter, z. B. 'fixer' oder 'coingecko+open.er-api' */
  source: string
  fetchedAt: string
}

type Env = Record<string, string | undefined>
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface FxOptions {
  db?: Db | null
  env?: Env
  fetch?: FetchFn
  now?: () => number
}

export const FX_TTL_MS = 24 * 3600_000
/** nach gescheitertem Abruf frühestens so spät erneut versuchen */
const RETRY_MS = 15 * 60_000
const TIMEOUT_MS = 4000
const STORE_KEY = 'fx_rates'
const REDIS_KEY = 'focvault:fx_rates'
/** Redis behält den letzten Stand länger als die TTL – als Reserve, falls alle Anbieter ausfallen */
const REDIS_KEEP_SEC = 30 * 86400

const CODES = DISPLAY_CURRENCIES.map(c => c.code)

class FxError extends Error {}

async function getJson(f: FetchFn, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await f(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    throw new FxError(`HTTP ${res.status}, keine JSON-Antwort`)
  }
  return { status: res.status, body }
}

interface Provider {
  name: string
  enabled: (env: Env) => boolean
  /** Kurse je 1 USD für (möglichst alle) gewünschten Währungen */
  load: (env: Env, f: FetchFn, want: string[]) => Promise<Record<string, number>>
}

/** Fixer (fixer.io): Gratis-Plan nur mit Basis EUR → auf USD umrechnen. 100 Abrufe/Monat reichen bei 24 h Cache. */
const fixer: Provider = {
  name: 'fixer',
  enabled: env => !!env.FIXER_API_KEY,
  async load(env, f, want) {
    const q = `latest?access_key=${encodeURIComponent(env.FIXER_API_KEY!)}&symbols=${[...new Set(['USD', ...want])].join(',')}`
    let { body } = await getJson(f, `https://data.fixer.io/api/${q}`)
    // Ältere Gratis-Pläne erlauben kein HTTPS – dann einmal per HTTP (Schlüssel gibt nur Kurse frei).
    if (body?.error?.type === 'https_access_restricted') ({ body } = await getJson(f, `http://data.fixer.io/api/${q}`))
    if (!body?.success) throw new FxError(body?.error?.type ?? body?.error?.info ?? 'Fehler')
    const rates = body.rates as Record<string, number>
    const usd = body.base === 'USD' ? 1 : rates.USD
    if (!(usd > 0)) throw new FxError('USD fehlt')
    const out: Record<string, number> = {}
    for (const c of want) {
      const v = c === body.base ? 1 : rates[c]
      if (typeof v === 'number') out[c] = v / usd
    }
    return out
  }
}

/**
 * CoinMarketCap: /v2/tools/price-conversion mit USD (Fiat-ID 2781) als Basis, 1 Credit pro Aufruf
 * plus 1 je weiterer Zielwährung. Der Basic-Plan (10 000 Credits/Monat, 30 Abrufe/Minute)
 * erlaubt nur 1 Zielwährung pro Aufruf: dann höchstens 25 Aufrufe (wichtigste Währungen
 * zuerst), den Rest füllen die nächsten Anbieter. Bei 24 h Cache ≈ 750 Credits im Monat.
 */
const CMC_MAX_CALLS = 25
const coinmarketcap: Provider = {
  name: 'coinmarketcap',
  enabled: env => !!env.COINMARKETCAP_API_KEY,
  async load(env, f, want) {
    const out: Record<string, number> = {}
    const call = async (convert: string[]) => {
      const url = `https://pro-api.coinmarketcap.com/v2/tools/price-conversion?id=2781&amount=1&convert=${convert.join(',')}`
      const { body } = await getJson(f, url, { 'X-CMC_PRO_API_KEY': env.COINMARKETCAP_API_KEY! })
      const err = body?.status?.error_code
      if (err) throw new FxError(String(body.status.error_message ?? err))
      const data = Array.isArray(body?.data) ? body.data[0] : body?.data
      for (const c of convert) {
        const v = data?.quote?.[c]?.price
        if (typeof v === 'number') out[c] = v
      }
    }
    const targets = want.filter(c => c !== 'USD')
    if (want.includes('USD')) out.USD = 1
    if (!targets.length) return out
    try {
      await call(targets)
      return out
    } catch (e) {
      const limit = Number(/limited to (\d+) convert/i.exec(e instanceof Error ? e.message : '')?.[1])
      if (!(limit >= 1)) throw e
      // Plan-Limit: in Gruppen abrufen, je 5 parallel
      const chunks: string[][] = []
      for (let i = 0; i < targets.length && chunks.length < CMC_MAX_CALLS; i += limit) chunks.push(targets.slice(i, i + limit))
      for (let i = 0; i < chunks.length; i += 5) await Promise.allSettled(chunks.slice(i, i + 5).map(call))
      return out
    }
  }
}

/** CoinGecko: /exchange_rates ist auf BTC bezogen → durch den USD-Wert teilen. Ohne Schlüssel öffentlich (knappes Limit). */
const coingecko: Provider = {
  name: 'coingecko',
  enabled: () => true,
  async load(env, f, want) {
    const key = env.COINGECKO_API_KEY
    const { body } = await getJson(f, 'https://api.coingecko.com/api/v3/exchange_rates', key ? { 'x-cg-demo-api-key': key } : {})
    const rates = body?.rates as Record<string, { value: number; type: string }> | undefined
    const usd = rates?.usd?.value
    if (!rates || !(usd! > 0)) throw new FxError(body?.status?.error_message ?? 'USD fehlt')
    const out: Record<string, number> = {}
    for (const c of want) {
      const r = rates[c.toLowerCase()]
      if (r?.type === 'fiat' && typeof r.value === 'number') out[c] = r.value / usd!
    }
    return out
  }
}

/** open.er-api.com (ExchangeRate-API, ohne Schlüssel, tägliche Kurse) */
const openErApi: Provider = {
  name: 'open.er-api',
  enabled: () => true,
  async load(_env, f, want) {
    const { body } = await getJson(f, 'https://open.er-api.com/v6/latest/USD')
    if (body?.result !== 'success' || body?.base_code !== 'USD') throw new FxError(body?.['error-type'] ?? 'Fehler')
    const out: Record<string, number> = {}
    for (const c of want) if (typeof body.rates?.[c] === 'number') out[c] = body.rates[c]
    return out
  }
}

export const FX_PROVIDERS: Provider[] = [fixer, coinmarketcap, coingecko, openErApi]

/** Plausibel: positive Zahl, höchstens Faktor 10 vom Richtkurs entfernt (fängt vertauschte Basis ab); USD = 1. */
export function validRates(raw: Record<string, number>, want: string[] = CODES): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of want) {
    const v = raw[c]
    const ref = STATIC_USD_RATES[c]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    if (c === 'USD' ? Math.abs(v - 1) > 1e-6 : ref && (v > ref * 10 || v < ref / 10)) continue
    out[c] = v
  }
  return out
}

/** Kurse frisch von den Anbietern holen (ohne Cache). */
export async function fetchRates(opts: FxOptions = {}): Promise<FxRates> {
  const env = opts.env ?? process.env
  const f = opts.fetch ?? ((url, init) => fetch(url, init))
  const rates: Record<string, number> = { USD: 1 }
  const sources: string[] = []
  for (const p of FX_PROVIDERS) {
    const missing = CODES.filter(c => !(c in rates))
    if (!missing.length) break
    if (!p.enabled(env)) continue
    try {
      const got = validRates(await p.load(env, f, missing), missing)
      if (Object.keys(got).length) {
        Object.assign(rates, got)
        sources.push(p.name)
      }
    } catch (e) {
      console.warn(`[fx] ${p.name} nicht verfügbar:`, e instanceof Error ? e.message : String(e))
    }
  }
  const filled = complete(rates)
  if (Object.keys(filled).length > Object.keys(rates).length) sources.push('static')
  return { base: 'USD', rates: filled, source: sources.join('+'), fetchedAt: new Date(opts.now?.() ?? Date.now()).toISOString() }
}

/** fehlende Währungen mit Richtkursen auffüllen */
function complete(rates: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...rates }
  for (const c of CODES) if (!(out[c] > 0)) out[c] = STATIC_USD_RATES[c]
  return out
}

function isFxRates(v: unknown): v is FxRates {
  const x = v as FxRates
  return !!x && x.base === 'USD' && typeof x.fetchedAt === 'string' && !!x.rates && typeof x.rates === 'object' && x.rates.USD === 1
}

// ---------- geteilter Cache ----------

interface Store {
  get(): Promise<FxRates | null>
  set(v: FxRates): Promise<void>
}

export function redisConfig(env: Env = process.env): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null
}

/** Upstash Redis über die REST-API (auch Vercel KV/Marketplace) – Befehl als JSON-Array. */
function redisStore(cfg: { url: string; token: string }, f: FetchFn): Store {
  const cmd = async (args: string[]) => {
    const res = await f(cfg.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const body = (await res.json()) as { result?: unknown; error?: string }
    if (!res.ok || body.error) throw new FxError(`Redis: ${body.error ?? res.status}`)
    return body.result
  }
  return {
    async get() {
      const r = await cmd(['GET', REDIS_KEY])
      return typeof r === 'string' ? JSON.parse(r) : null
    },
    async set(v) {
      await cmd(['SET', REDIS_KEY, JSON.stringify(v), 'EX', String(REDIS_KEEP_SEC)])
    }
  }
}

function dbStore(db: Db): Store {
  return {
    async get() {
      const rows = await db.query<{ value: FxRates }>('SELECT value FROM settings WHERE key = $1', [STORE_KEY])
      return rows[0]?.value ?? null
    },
    async set(v) {
      await db.query(
        `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, NULL)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = NULL`,
        [STORE_KEY, JSON.stringify(v)]
      )
    }
  }
}

let mem: { value: FxRates; until: number } | null = null
let inflight: Promise<FxRates> | null = null

/** Nur für Tests */
export function resetFxCache(): void {
  mem = null
  inflight = null
}

/**
 * Aktuelle Kurse für alle Nutzer: Prozess-Cache → Redis bzw. DB → Anbieter.
 * Pro Prozess läuft höchstens ein Abruf gleichzeitig. Liefert immer alle Anzeige-Währungen.
 */
export async function getFxRates(opts: FxOptions = {}): Promise<FxRates> {
  const now = opts.now?.() ?? Date.now()
  if (mem && now < mem.until) return mem.value
  inflight ??= load(opts, now).finally(() => {
    inflight = null
  })
  return inflight
}

async function load(opts: FxOptions, now: number): Promise<FxRates> {
  const env = opts.env ?? process.env
  const f = opts.fetch ?? ((url, init) => fetch(url, init))
  const redis = redisConfig(env)
  const store = redis ? redisStore(redis, f) : opts.db ? dbStore(opts.db) : null

  let cached: FxRates | null = null
  try {
    const v = store ? await store.get() : null
    if (isFxRates(v)) cached = { ...v, rates: complete(v.rates) }
  } catch (e) {
    console.warn('[fx] Cache nicht lesbar:', e instanceof Error ? e.message : String(e))
  }
  const expires = (v: FxRates) => Date.parse(v.fetchedAt) + FX_TTL_MS
  if (cached && now < expires(cached)) {
    mem = { value: cached, until: expires(cached) }
    return cached
  }

  const fresh = await fetchRates({ ...opts, env, fetch: f, now: () => now })
  if (fresh.source === 'static') {
    // Alle Anbieter ausgefallen: lieber den letzten echten Stand zeigen, bald erneut versuchen.
    const value = cached ?? mem?.value ?? fresh
    mem = { value, until: now + RETRY_MS }
    return value
  }
  try {
    await store?.set(fresh)
  } catch (e) {
    console.warn('[fx] Cache nicht schreibbar:', e instanceof Error ? e.message : String(e))
  }
  mem = { value: fresh, until: expires(fresh) }
  return fresh
}

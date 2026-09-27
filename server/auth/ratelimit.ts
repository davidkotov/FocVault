import { ApiError } from '../shared/errors'

/**
 * Sliding-Window-Limiter im Prozess-Speicher. Gilt pro Instanz – für mehrere Instanzen
 * (Phase 3) durch Redis/Postgres ersetzen. Überlebt Hot-Reload über globalThis.
 */
const g = globalThis as unknown as { __fvRate?: Map<string, number[]> }
const buckets = (g.__fvRate ??= new Map<string, number[]>())

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs)
  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000))
    buckets.set(key, hits)
    throw new ApiError('RATE_LIMITED', `Zu viele Versuche. Bitte in ${Math.ceil(retryAfterSec / 60)} Min. erneut.`, {
      retryAfterSec
    })
  }
  hits.push(now)
  buckets.set(key, hits)
  if (buckets.size > 20_000) {
    for (const [k, v] of buckets) if (!v.some(t => now - t < windowMs)) buckets.delete(k)
  }
}

/**
 * Limits pro IP: in Production streng; lokal/Tests großzügig, weil alle Anfragen von derselben
 * Adresse kommen (E2E-Tests, Skripte). Limits pro E-Mail/Konto gelten überall gleich.
 */
export function ipLimit(production: number): number {
  return process.env.NODE_ENV === 'production' ? production : production * 50
}

export function resetRateLimits(): void {
  buckets.clear()
}

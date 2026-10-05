'use client'

import { useEffect, useState } from 'react'
import { convert, STATIC_USD_RATES } from '@/lib/region'

/** Wechselkurse für die Preisanzeige (Basis USD) – nie für die Abrechnung. */
export interface FxRates {
  base: 'USD'
  /** Einheiten je 1 USD */
  rates: Record<string, number>
  source: string
  fetchedAt: string
}

export { convert }

/** Richtkurse aus dem Code, bis die aktuellen Kurse geladen sind */
export const FALLBACK_FX: FxRates = { base: 'USD', rates: STATIC_USD_RATES, source: 'static', fetchedAt: '2026-10-04T00:00:00.000Z' }

let cache: FxRates | null = null
let pending: Promise<FxRates> | null = null

/** Einmal pro Sitzung laden (modulweit geteilt); bei Fehler bleiben die Richtkurse. */
export function loadFxRates(): Promise<FxRates> {
  if (cache) return Promise.resolve(cache)
  pending ??= fetch('/api/v1/fx')
    .then(r => (r.ok ? (r.json() as Promise<FxRates>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(v => (cache = { ...v, rates: { ...STATIC_USD_RATES, ...v.rates } }))
    .catch(() => {
      pending = null // nächster Aufruf versucht es erneut
      return FALLBACK_FX
    })
  return pending
}

/**
 * Kurse für die Anzeige: sofort Richtkurse, dann die aktuellen vom Server.
 * `live` = aktuelle Kurse geladen.
 */
export function useFxRates(): { fx: FxRates; live: boolean } {
  const [fx, setFx] = useState<FxRates>(cache ?? FALLBACK_FX)
  useEffect(() => {
    if (cache) return
    let alive = true
    void loadFxRates().then(v => alive && setFx(v))
    return () => {
      alive = false
    }
  }, [])
  return { fx, live: fx !== FALLBACK_FX }
}

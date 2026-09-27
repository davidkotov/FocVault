import type { Db } from '../db'
import { ApiError } from '../shared/errors'
import { chainStatus, type FocChainStatus } from './chain'
import { getFocSettings, type FocSettings } from './config'

export type FocHealthLevel = 'off' | 'ok' | 'warn' | 'critical' | 'unknown'

export interface FocHealth {
  level: FocHealthLevel
  message: string
  runwayDays: number | null
}

/**
 * Ampel für das FOC-Guthaben. FWSS hält immer 30 Tage Kosten als Reserve; sinkt das freie
 * Guthaben auf 0, gerät das Konto ins Minus und Anbieter dürfen Daten löschen. Deshalb
 * warnen wir früh und stoppen neue Uploads, bevor es knapp wird.
 */
export function evaluateHealth(s: FocSettings, c: FocChainStatus): FocHealth {
  if (!s.enabled) return { level: 'off', message: 'Filecoin-Speicher ist ausgeschaltet.', runwayDays: null }
  if (c.error || !c.account) return { level: 'unknown', message: c.error ?? 'Kein Kontostand verfügbar.', runwayDays: null }
  if (c.account.debt > 0) return { level: 'critical', message: 'Filecoin-Pay-Konto im Minus – sofort USDFC einzahlen.', runwayDays: 0 }
  if (!c.sessionKey?.authorized) return { level: 'critical', message: 'Server-Schlüssel nicht (mehr) autorisiert.', runwayDays: c.account.runwayDays }
  const days = c.account.runwayDays
  if (days !== null && days < s.blockRunwayDays) {
    return { level: 'critical', message: `Guthaben reicht nur noch ${days} Tage – Uploads gestoppt.`, runwayDays: days }
  }
  if (days !== null && days < s.warnRunwayDays) {
    return { level: 'warn', message: `Guthaben reicht noch ${days} Tage – bitte nachladen.`, runwayDays: days }
  }
  return { level: 'ok', message: days === null ? 'Noch keine laufenden Kosten.' : `Guthaben reicht ${days} Tage.`, runwayDays: days }
}

const g = globalThis as unknown as { __fvFocHealth?: { at: number; health: FocHealth } }
const TTL_MS = 2 * 60_000

export async function focHealth(db: Db, fresh = false): Promise<FocHealth> {
  if (!fresh && g.__fvFocHealth && Date.now() - g.__fvFocHealth.at < TTL_MS) return g.__fvFocHealth.health
  const s = await getFocSettings(db)
  const health = s.enabled ? evaluateHealth(s, await chainStatus(db, s)) : evaluateHealth(s, {} as FocChainStatus)
  g.__fvFocHealth = { at: Date.now(), health }
  return health
}

export function invalidateFocHealth(): void {
  g.__fvFocHealth = undefined
}

/** Vor neuen Uploads: bei kritischem FOC-Guthaben ablehnen (bestehende Dateien bleiben lesbar). */
export async function assertFocWritable(db: Db): Promise<void> {
  const s = await getFocSettings(db)
  if (!s.enabled) return
  const h = await focHealth(db)
  if (h.level === 'critical') {
    throw new ApiError('STORAGE_UNAVAILABLE', 'Uploads sind gerade pausiert (Speicher-Wartung). Bitte später erneut versuchen.')
  }
}

import { timingSafeEqual } from 'node:crypto'
import type { Deps } from '../deps'
import { chainStatus, type FocChainStatus } from './chain'
import { getFocSettings, getFocState, type FocSettings } from './config'
import { evaluateHealth, type FocHealth } from './health'
import { focStats } from './sync'

export interface FocAdminStatus {
  settings: FocSettings
  chain: FocChainStatus
  health: FocHealth
  stats: Awaited<ReturnType<typeof focStats>>
  lastRun: { at: string; ok: boolean; message: string } | null
  dataSets: string[]
}

export async function focAdminStatus(deps: Deps): Promise<FocAdminStatus> {
  const settings = await getFocSettings(deps.db)
  const [chain, stats, state] = await Promise.all([chainStatus(deps.db, settings), focStats(deps.db), getFocState(deps.db)])
  return {
    settings,
    chain,
    health: evaluateHealth(settings, chain),
    stats,
    lastRun: state.lastRun,
    dataSets: state.dataSets[`${settings.network}:${settings.payer.toLowerCase()}`] ?? []
  }
}

/** Cron-Aufruf (z. B. Vercel Cron) mit `Authorization: Bearer <CRON_SECRET>`. */
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization') ?? ''
  if (!secret || secret.length < 16 || !header.startsWith('Bearer ')) return false
  const a = Buffer.from(header.slice(7))
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

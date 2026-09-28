import type { Deps } from '../deps'
import { statusOverview } from './service'

export interface PublicStats {
  storedBytes: number
  filesOnFilecoin: number
  uptimePct: number | null
  updatedAt: string
}

let cache: { at: number; v: PublicStats } | null = null

/** Echte, aggregierte Kennzahlen für die Landingpage (keine Kundendaten). */
export async function publicStats(deps: Deps): Promise<PublicStats> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.v
  const st = await deps.db.query<{ b: number }>(`SELECT coalesce(sum(cipher_bytes), 0)::float8 AS b FROM objects WHERE state IN ('stored', 'version', 'trashed')`)
  let foc = 0
  try {
    const r = await deps.db.query<{ n: number }>(
      `SELECT count(*)::float8 AS n FROM objects o WHERE o.state = 'stored'
          AND EXISTS (SELECT 1 FROM object_pieces op WHERE op.object_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM object_pieces op WHERE op.object_id = o.id AND NOT EXISTS (
                SELECT 1 FROM foc_members fm JOIN foc_packs fp ON fp.id = fm.pack_id
                 WHERE fm.storage_key = op.storage_key AND fm.deleted_at IS NULL AND fm.evicted_at IS NULL AND fp.state = 'stored'))`
    )
    foc = Number(r[0]?.n ?? 0)
  } catch {
    foc = 0
  }
  const status = await statusOverview(deps).catch(() => null)
  const app = status?.components.find(c => c.id === 'app')
  const v = { storedBytes: Number(st[0]?.b ?? 0), filesOnFilecoin: foc, uptimePct: app?.uptimePct ?? null, updatedAt: new Date().toISOString() }
  cache = { at: Date.now(), v }
  return v
}

import type { Db } from '../db'
import { getFocSettings } from './config'

export interface FilecoinFileStatus {
  network: 'mainnet' | 'calibration' | null
  /** objectId → Anzahl bestätigter Kopien (nur vollständig gesicherte Dateien) */
  objects: Record<string, { copies: number; since: string }>
}

/** Welche Dateien eines Kontos vollständig auf Filecoin liegen (für das Häkchen im Dashboard). */
export async function filecoinStatus(db: Db, accountId: string): Promise<FilecoinFileStatus> {
  const s = await getFocSettings(db)
  const rows = await db.query<{ id: string; pieces: number; secured: number; copies: number | null; since: string | null }>(
    `SELECT o.id, count(*)::float8 AS pieces, count(p.id)::float8 AS secured,
            min(jsonb_array_length(p.copies))::float8 AS copies, max(p.created_at)::text AS since
       FROM objects o
       JOIN object_pieces op ON op.object_id = o.id
       LEFT JOIN foc_members m ON m.storage_key = op.storage_key AND m.deleted_at IS NULL
       LEFT JOIN foc_packs p ON p.id = m.pack_id AND p.state = 'stored'
      WHERE o.owner_account_id = $1 AND o.state = 'stored'
      GROUP BY o.id`,
    [accountId]
  )
  const objects: FilecoinFileStatus['objects'] = {}
  for (const r of rows) {
    if (Number(r.secured) === Number(r.pieces) && r.copies) objects[r.id] = { copies: Number(r.copies), since: r.since ?? '' }
  }
  return { network: Object.keys(objects).length || s.enabled ? s.network : null, objects }
}

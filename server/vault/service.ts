import { randomBytes } from 'node:crypto'
import type { Deps } from '../deps'
import { isUniqueViolation } from '../db'
import { ApiError } from '../shared/errors'
import { sha256 } from '../shared/bytes'
import { indexKey } from '../storage/provider'

/** Obergrenze für den verschlüsselten Index (≈ 20 000 Dateien + Secrets). */
export const MAX_INDEX_BYTES = 8 * 1024 * 1024
/** So viele alte Index-Versionen bleiben erhalten (Schutz vor fehlerhaften Schreibvorgängen). */
const KEEP_VERSIONS = 5
/** 12 Byte IV + 16 Byte GCM-Tag */
const MIN_INDEX_BYTES = 28

async function currentVersion(deps: Deps, accountId: string): Promise<{ version: number; key: string } | null> {
  const rows = await deps.db.query<{ version: number; storage_key: string }>(
    `SELECT version::float8 AS version, storage_key FROM vault_indexes
      WHERE account_id = $1 ORDER BY version DESC LIMIT 1`,
    [accountId]
  )
  return rows[0] ? { version: Number(rows[0].version), key: rows[0].storage_key } : null
}

export async function getIndex(deps: Deps, accountId: string): Promise<{ version: number; body: Uint8Array } | null> {
  const cur = await currentVersion(deps, accountId)
  if (!cur) return null
  const body = await deps.storage.getSmall(cur.key)
  if (!body) throw new ApiError('STORAGE_UNAVAILABLE', 'Tresor-Index im Storage nicht gefunden.')
  return { version: cur.version, body }
}

/**
 * Optimistisches Locking: Schreiben nur, wenn `baseVersion` der aktuellen Version entspricht.
 * Sonst VERSION_CONFLICT – der Client lädt, führt zusammen und versucht es erneut.
 * Jede Version bekommt einen eigenen Storage-Key (mit Zufallsanteil), damit ein verlorener
 * Wettlauf nie den Blob des Gewinners überschreibt.
 */
export async function putIndex(
  deps: Deps,
  accountId: string,
  baseVersion: number,
  body: Uint8Array
): Promise<{ version: number }> {
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new ApiError('BAD_REQUEST', 'Ungültige Basis-Version.')
  if (body.byteLength < MIN_INDEX_BYTES) throw new ApiError('BAD_REQUEST', 'Index zu klein.')
  if (body.byteLength > MAX_INDEX_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'Tresor-Index zu groß.')
  const cur = await currentVersion(deps, accountId)
  const current = cur?.version ?? 0
  const conflict = () =>
    new ApiError('VERSION_CONFLICT', 'Der Tresor wurde inzwischen auf einem anderen Gerät geändert.', {
      currentVersion: current
    })
  if (current !== baseVersion) throw conflict()
  const version = baseVersion + 1
  const key = indexKey(accountId, version, randomBytes(6).toString('hex'))
  await deps.storage.putSmall(key, body)
  try {
    await deps.db.query(
      'INSERT INTO vault_indexes (account_id, version, storage_key, size, sha256) VALUES ($1, $2, $3, $4, $5)',
      [accountId, version, key, body.byteLength, sha256(body)]
    )
  } catch (e) {
    await deps.storage.delete([key]).catch(() => undefined)
    if (isUniqueViolation(e)) throw conflict()
    throw e
  }
  const old = await deps.db.query<{ storage_key: string }>(
    'DELETE FROM vault_indexes WHERE account_id = $1 AND version <= $2 RETURNING storage_key',
    [accountId, version - KEEP_VERSIONS]
  )
  if (old.length) await deps.storage.delete(old.map(r => r.storage_key)).catch(() => undefined)
  return { version }
}

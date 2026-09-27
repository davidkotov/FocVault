import type { Db } from '../db'

/** Quota-Basis = Ciphertext-Bytes (inkl. Frame-Overhead), laufende Uploads sind reserviert. */
export async function usedBytes(db: Db, accountId: string): Promise<number> {
  const rows = await db.query<{ used: number }>(
    `SELECT COALESCE(SUM(cipher_bytes), 0)::float8 AS used
       FROM objects WHERE owner_account_id = $1 AND state IN ('uploading', 'stored')`,
    [accountId]
  )
  return Number(rows[0]?.used ?? 0)
}

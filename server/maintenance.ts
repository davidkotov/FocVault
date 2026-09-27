import type { Deps } from './deps'
import { runFocSync, type FocSyncResult } from './foc/sync'
import { purgeExpiredTrash } from './objects/service'
import { stripeGateway } from './stripe/gateway'
import { closePaygMonth, snapshotPaygUsage } from './stripe/service'
import { applyS3Retention } from './s3/service'
import { runStatusChecks } from './status/service'
import { purgeSharePayloads } from './shares/service'

/**
 * Regelmäßige Aufgaben: Pay-as-you-go-Tagesstand und Monatsabschluss (beides idempotent),
 * abgelaufenen Papierkorb leeren, dann mit Filecoin abgleichen.
 */
export async function runMaintenance(d: Deps): Promise<{ purged: number; payg: { snapshots: number; charged: number; carried: number }; s3: { expired: number; aborted: number }; foc: FocSyncResult }> {
  const snapshots = await snapshotPaygUsage(d.db)
  const close = await closePaygMonth(d, stripeGateway())
  const purged = await purgeExpiredTrash(d)
  const s3 = await applyS3Retention(d)
  const foc = await runFocSync(d.db, d.storage)
  await runStatusChecks(d).catch(() => 0)
  await purgeSharePayloads(d).catch(() => 0)
  return { purged, payg: { snapshots, ...close }, s3, foc }
}

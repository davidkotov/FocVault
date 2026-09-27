import type { Deps } from './deps'
import { runFocSync, type FocSyncResult } from './foc/sync'
import { purgeExpiredTrash } from './objects/service'

/** Regelmäßige Aufgaben: abgelaufenen Papierkorb leeren, dann mit Filecoin abgleichen. */
export async function runMaintenance(d: Deps): Promise<{ purged: number; foc: FocSyncResult }> {
  const purged = await purgeExpiredTrash(d)
  const foc = await runFocSync(d.db, d.storage)
  return { purged, foc }
}

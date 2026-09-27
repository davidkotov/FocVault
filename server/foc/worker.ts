import { deps } from '../deps'
import { runMaintenance } from '../maintenance'

const g = globalThis as unknown as { __fvFocTimer?: ReturnType<typeof setInterval> }

/** Hintergrund-Wartung im Dauerprozess (Papierkorb leeren, Filecoin-Abgleich). */
export function startFocWorker(): void {
  if (g.__fvFocTimer || process.env.FOC_BACKGROUND_SYNC === '0' || process.env.VERCEL) return
  const every = Math.max(30, Number(process.env.FOC_SYNC_INTERVAL_SEC ?? 120)) * 1000
  let busy = false
  g.__fvFocTimer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const r = await runMaintenance(await deps())
      if (r.purged) console.log(`[wartung] ${r.purged} Datei(en) aus dem Papierkorb endgültig gelöscht`)
      if (r.foc.ran && r.foc.packed) console.log(`[foc] ${r.foc.message}`)
      else if (r.foc.ran && r.foc.message.startsWith('Fehler')) console.error(`[foc] ${r.foc.message}`)
    } catch (e) {
      console.error('[wartung] fehlgeschlagen:', (e as Error).message)
    } finally {
      busy = false
    }
  }, every)
}

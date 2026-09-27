import { deps } from '../deps'
import { runFocSync } from './sync'

const g = globalThis as unknown as { __fvFocTimer?: ReturnType<typeof setInterval> }

export function startFocWorker(): void {
  if (g.__fvFocTimer || process.env.FOC_BACKGROUND_SYNC === '0' || process.env.VERCEL) return
  const every = Math.max(30, Number(process.env.FOC_SYNC_INTERVAL_SEC ?? 120)) * 1000
  let busy = false
  g.__fvFocTimer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const d = await deps()
      const r = await runFocSync(d.db, d.storage)
      if (r.ran && r.packed) console.log(`[foc] ${r.message}`)
      else if (r.ran && r.message.startsWith('Fehler')) console.error(`[foc] ${r.message}`)
    } catch (e) {
      console.error('[foc] Abgleich fehlgeschlagen:', (e as Error).message)
    } finally {
      busy = false
    }
  }, every)
}

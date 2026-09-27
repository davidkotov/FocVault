/**
 * Hintergrund-Abgleich mit Wartung (Papierkorb, Filecoin Onchain Cloud) in einem dauerhaft laufenden Node-Prozess
 * (lokal, Docker, VPS). Auf Vercel übernimmt stattdessen der Cron-Endpunkt /api/v1/cron/maintenance.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startFocWorker } = await import('./server/foc/worker')
    startFocWorker()
    const { startS3Api } = await import('./server/s3/server')
    startS3Api()
  }
}

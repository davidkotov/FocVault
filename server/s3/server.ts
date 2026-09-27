import { deps } from '../deps'
import { startS3Server } from './protocol'
import { resolveTenant } from './service'

const g = globalThis as unknown as { __fvS3?: Promise<unknown> }

/**
 * Speicher-API als eigener HTTP-Listener im selben Node-Prozess (lokal: Port 9000).
 * Production: S3_API_PORT setzen, hinter einem TLS-Proxy (z. B. s3.focvault.app) betreiben und
 * S3_PUBLIC_URL auf die öffentliche Adresse stellen. Auf Vercel nicht möglich (keine Dauerprozesse).
 */
export function startS3Api(): void {
  if (g.__fvS3 || process.env.VERCEL || process.env.S3_API === '0') return
  if (process.env.NODE_ENV === 'production' && !process.env.S3_API_PORT) return
  const port = Number(process.env.S3_API_PORT ?? 9000)
  const host = process.env.S3_API_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
  g.__fvS3 = startS3Server({ port, host, resolve: async ak => resolveTenant(await deps(), ak) }).then(
    s => console.log(`[s3] Speicher-API auf ${s.url}`),
    e => console.error('[s3] Speicher-API nicht gestartet:', (e as Error).message)
  )
}

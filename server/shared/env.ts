import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const isProd = process.env.NODE_ENV === 'production'

/** Lokales Datenverzeichnis (PGlite, lokaler Storage, Dev-Secret). In Production ungenutzt. */
export function dataDir(): string {
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), '.data')
  mkdirSync(dir, { recursive: true })
  return dir
}

let secretCache: Buffer | null = null

/**
 * Server-Secret für HMAC (signierte Storage-URLs, Pseudo-Salts gegen User-Enumeration).
 * Production: Pflicht über SERVER_SECRET. Dev: einmal erzeugt und in `.data/` abgelegt,
 * damit signierte URLs einen Neustart überleben.
 */
export function serverSecret(): Buffer {
  if (secretCache) return secretCache
  const fromEnv = process.env.SERVER_SECRET
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('SERVER_SECRET muss mindestens 32 Zeichen lang sein.')
    secretCache = Buffer.from(fromEnv, 'utf8')
    return secretCache
  }
  if (isProd) throw new Error('SERVER_SECRET fehlt (Production).')
  const file = path.join(dataDir(), 'server-secret')
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
  secretCache = Buffer.from(readFileSync(file, 'utf8').trim(), 'utf8')
  return secretCache
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

/** Admin = in ADMIN_EMAILS. Ohne Liste in Dev: jedes Konto (nur lokal, zum Ausprobieren). */
export function isAdminEmail(email: string): boolean {
  const list = adminEmails()
  if (list.length === 0) return !isProd
  return list.includes(email.toLowerCase())
}

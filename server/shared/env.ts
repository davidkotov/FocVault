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

export function adminAddresses(): string[] {
  return (process.env.ADMIN_ADDRESSES ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Admin = E-Mail in ADMIN_EMAILS oder Wallet-Adresse in ADMIN_ADDRESSES.
 * Sind beide Listen leer: in Dev jedes Konto (nur lokal, zum Ausprobieren), in Production keins.
 */
export function isAdminIdentity(email: string | null, wallets: string[]): boolean {
  const emails = adminEmails()
  const addresses = adminAddresses()
  if (emails.length === 0 && addresses.length === 0) return !isProd
  return (!!email && emails.includes(email.toLowerCase())) || wallets.some(w => addresses.includes(w.toLowerCase()))
}

/**
 * Erlaubte Origins für die Wallet-Anmeldung (SIWE-Domain-Bindung). Production: APP_ORIGIN
 * (kommagetrennt, z. B. https://foc-vault.vercel.app). Ohne Angabe nur in Dev: Origin der Anfrage.
 */
export function allowedOrigins(requestOrigin: string): string[] {
  const list = (process.env.APP_ORIGIN ?? '')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
  if (list.length) return list
  if (isProd) throw new Error('APP_ORIGIN fehlt (Production).')
  return [requestOrigin]
}

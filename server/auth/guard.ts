import type { NextRequest } from 'next/server'
import type { Db } from '../db'
import { ApiError } from '../shared/errors'
import { isAdminIdentity } from '../shared/env'
import { SESSION_COOKIE, findSession, type SessionInfo } from './sessions'

export async function requireSession(req: NextRequest, db: Db): Promise<SessionInfo> {
  const session = await findSession(db, req.cookies.get(SESSION_COOKIE)?.value ?? '')
  if (!session) throw new ApiError('UNAUTHENTICATED', 'Bitte melde dich an.')
  return session
}

/** Sensible Aktionen nur kurz nach einer echten Anmeldung (Passphrase/Recovery/Wallet-Signatur). */
export function requireStrongAuth(session: SessionInfo, maxAgeMin = 15): void {
  if (Date.now() - session.strongAuthAt > maxAgeMin * 60_000) {
    throw new ApiError('REAUTH_REQUIRED', 'Bitte melde dich für diese Aktion erneut an.')
  }
}

/** Admin über ADMIN_EMAILS oder ADMIN_ADDRESSES (Wallet-Konten). */
export async function requireAdmin(db: Db, session: SessionInfo): Promise<void> {
  const wallets = (
    await db.query<{ address: string }>('SELECT address FROM auth_wallets WHERE account_id = $1', [session.accountId])
  ).map(w => w.address)
  if (!isAdminIdentity(session.email, wallets)) throw new ApiError('FORBIDDEN', 'Kein Admin-Zugriff.')
}

/** Origin der Anfrage (für die SIWE-Domain-Bindung in Dev). */
export function requestOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  return `${proto}://${host}`
}

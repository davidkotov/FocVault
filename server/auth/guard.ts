import type { NextRequest } from 'next/server'
import type { Db } from '../db'
import { ApiError } from '../shared/errors'
import { isAdminEmail } from '../shared/env'
import { SESSION_COOKIE, findSession, type SessionInfo } from './sessions'

export async function requireSession(req: NextRequest, db: Db): Promise<SessionInfo> {
  const session = await findSession(db, req.cookies.get(SESSION_COOKIE)?.value ?? '')
  if (!session) throw new ApiError('UNAUTHENTICATED', 'Bitte melde dich an.')
  return session
}

/** Sensible Aktionen nur kurz nach einer echten Anmeldung (Passphrase/Recovery). */
export function requireStrongAuth(session: SessionInfo, maxAgeMin = 15): void {
  if (Date.now() - session.strongAuthAt > maxAgeMin * 60_000) {
    throw new ApiError('REAUTH_REQUIRED', 'Bitte melde dich für diese Aktion erneut an.')
  }
}

export function requireAdmin(session: SessionInfo): void {
  if (!isAdminEmail(session.email)) throw new ApiError('FORBIDDEN', 'Kein Admin-Zugriff.')
}

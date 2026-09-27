import { randomBytes } from 'node:crypto'
import type { NextResponse } from 'next/server'
import type { Db } from '../db'
import type { Plan } from '../../lib/api-types'
import { sha256 } from '../shared/bytes'
import { isProd } from '../shared/env'
import { uuidv7 } from '../shared/ids'

export const SESSION_COOKIE = 'fv_session'
const SESSION_DAYS = 30

export interface SessionInfo {
  sessionId: string
  accountId: string
  email: string | null
  plan: Plan
  strongAuthAt: number
}

export async function createSession(
  db: Db,
  accountId: string,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = randomBytes(32).toString('base64url')
  const sessionId = uuidv7()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await db.query(
    'INSERT INTO sessions (id, account_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [sessionId, accountId, sha256(token), expiresAt, userAgent ? userAgent.slice(0, 200) : null]
  )
  // Grundlage der Inaktivitätsregel für Free-Konten (Preisbuch: inactiveWarnDays/DeleteDays)
  await db.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [accountId])
  return { token, expiresAt, sessionId }
}

export async function findSession(db: Db, token: string): Promise<SessionInfo | null> {
  if (!token || token.length > 100) return null
  const rows = await db.query<{
    id: string
    account_id: string
    strong_auth_at: Date
    last_seen_at: Date
    email: string | null
    plan: Plan
    status: string
  }>(
    `SELECT s.id, s.account_id, s.strong_auth_at, s.last_seen_at, a.email, a.plan, a.status
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)]
  )
  const r = rows[0]
  if (!r || r.status === 'suspended' || r.status === 'deleted') return null
  if (Date.now() - new Date(r.last_seen_at).getTime() > 5 * 60_000) {
    await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [r.id])
  }
  return {
    sessionId: r.id,
    accountId: r.account_id,
    email: r.email,
    plan: r.plan,
    strongAuthAt: new Date(r.strong_auth_at).getTime()
  }
}

export async function revokeSessionByToken(db: Db, token: string): Promise<void> {
  if (!token) return
  await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)])
}

export async function revokeOtherSessions(db: Db, accountId: string, keepSessionId: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL', [
    accountId,
    keepSessionId
  ])
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): void {
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/', expires: expiresAt })
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/', maxAge: 0 })
}

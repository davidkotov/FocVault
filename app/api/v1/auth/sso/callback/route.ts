import { NextResponse, type NextRequest } from 'next/server'
import { deps } from '@/server/deps'
import { setSessionCookie } from '@/server/auth/sessions'
import { ApiError } from '@/server/shared/errors'
import { allowedOrigins } from '@/server/shared/env'
import { requestMeta } from '@/server/shared/http'
import { SSO_COOKIE, finishSso } from '@/server/team/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Rückkehr vom Identity-Provider → Session setzen und in die App (Tresor bleibt bis zur Passphrase gesperrt). */
export async function GET(req: NextRequest) {
  const u = new URL(req.url)
  const origin = allowedOrigins(u.origin)[0]
  let res: NextResponse
  try {
    const code = u.searchParams.get('code')
    const state = u.searchParams.get('state')
    if (!code || !state) throw new ApiError('BAD_REQUEST', u.searchParams.get('error_description') ?? 'SSO abgebrochen.')
    const r = await finishSso(await deps(), code, state, req.cookies.get(SSO_COOKIE)?.value, requestMeta(req))
    res = NextResponse.redirect(origin + r.redirect, 302)
    if (r.session) setSessionCookie(res, r.session.token, r.session.expiresAt)
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'SSO fehlgeschlagen.'
    res = NextResponse.redirect(origin + '/anmelden?sso_error=' + encodeURIComponent(msg), 302)
  }
  res.cookies.set(SSO_COOKIE, '', { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/api/v1/auth/sso', maxAge: 0 })
  return res
}

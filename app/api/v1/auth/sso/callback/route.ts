import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { setSessionCookie } from '@/server/auth/sessions'
import { ApiError } from '@/server/shared/errors'
import { allowedOrigins } from '@/server/shared/env'
import { requestMeta } from '@/server/shared/http'
import { finishSso } from '@/server/team/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Rückkehr vom Identity-Provider → Session setzen und in die App (Tresor bleibt bis zur Passphrase gesperrt). */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const origin = allowedOrigins(u.origin)[0]
  try {
    const code = u.searchParams.get('code')
    const state = u.searchParams.get('state')
    if (!code || !state) throw new ApiError('BAD_REQUEST', u.searchParams.get('error_description') ?? 'SSO abgebrochen.')
    const r = await finishSso(await deps(), code, state, requestMeta(req))
    const res = NextResponse.redirect(origin + r.redirect, 302)
    if (r.session) setSessionCookie(res, r.session.token, r.session.expiresAt)
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'SSO fehlgeschlagen.'
    return NextResponse.redirect(origin + '/anmelden?sso_error=' + encodeURIComponent(msg), 302)
  }
}

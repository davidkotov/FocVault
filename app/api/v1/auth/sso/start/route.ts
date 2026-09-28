import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { allowedOrigins } from '@/server/shared/env'
import { requestMeta, route } from '@/server/shared/http'
import { SSO_COOKIE, startSso } from '@/server/team/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Firmen-SSO starten: /api/v1/auth/sso/start?email=… → Weiterleitung zum Identity-Provider. */
export const GET = route(async req => {
  const u = new URL(req.url)
  const origin = allowedOrigins(u.origin)[0]
  const { url, browserToken } = await startSso(await deps(), u.searchParams.get('email') ?? '', origin, requestMeta(req).ip)
  const res = NextResponse.redirect(url, 302)
  // bindet den Ablauf an diesen Browser (Login-CSRF); Lax, damit es die Rückkehr vom Anbieter mitschickt
  res.cookies.set(SSO_COOKIE, browserToken, {
    httpOnly: true,
    secure: origin.startsWith('https:'),
    sameSite: 'lax',
    path: '/api/v1/auth/sso',
    maxAge: 10 * 60
  })
  return res
})

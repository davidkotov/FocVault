import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { allowedOrigins } from '@/server/shared/env'
import { requestMeta, route } from '@/server/shared/http'
import { startSso } from '@/server/team/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Firmen-SSO starten: /api/v1/auth/sso/start?email=… → Weiterleitung zum Identity-Provider. */
export const GET = route(async req => {
  const u = new URL(req.url)
  const origin = allowedOrigins(u.origin)[0]
  const url = await startSso(await deps(), u.searchParams.get('email') ?? '', origin, requestMeta(req).ip)
  return NextResponse.redirect(url, 302)
})

import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { allowedOrigins } from '@/server/shared/env'
import { route } from '@/server/shared/http'
import { statusOverview, statusRss } from '@/server/status/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const origin = allowedOrigins(new URL(req.url).origin)[0]
  return new NextResponse(statusRss(await statusOverview(await deps()), origin, 'FocVault Status'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
  })
})

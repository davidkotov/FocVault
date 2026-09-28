import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { route } from '@/server/shared/http'
import { statusOverview } from '@/server/status/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Öffentlicher Systemstatus (ohne Kundendaten). */
export const GET = route(async () => {
  const res = NextResponse.json(await statusOverview(await deps()))
  res.headers.set('Cache-Control', 'public, max-age=30')
  return res
})

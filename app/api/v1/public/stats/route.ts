import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { route } from '@/server/shared/http'
import { publicStats } from '@/server/status/public-stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const res = NextResponse.json(await publicStats(await deps()))
  res.headers.set('Cache-Control', 'public, max-age=300')
  return res
})

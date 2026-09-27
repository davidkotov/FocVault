import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { adminListAccounts } from '@/server/billing/service'

export const GET = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? '0') || 0
  return json(await adminListAccounts(d, q.slice(0, 100), offset))
})

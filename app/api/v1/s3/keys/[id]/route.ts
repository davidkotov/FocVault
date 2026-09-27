import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { revokeAccessKey } from '@/server/s3/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DELETE = route(async (req, ctx) => {
  const d = await deps()
  await revokeAccessKey(d, await requireSession(req, d.db), param(ctx, 'id'))
  return json({ ok: true })
})

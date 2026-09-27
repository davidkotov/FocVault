import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { vaultAudit } from '@/server/vaults/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async (req, ctx) => {
  const d = await deps()
  return json({ events: await vaultAudit(d, await requireSession(req, d.db), param(ctx, 'id')) })
})

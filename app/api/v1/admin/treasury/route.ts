import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { setTreasury, treasurySchema } from '@/server/billing/settings'
import { treasuryStatus } from '@/server/billing/service'
import { audit } from '@/server/deps'

export const GET = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  return json(await treasuryStatus(d))
})

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await setTreasury(d.db, await readJson(req, treasurySchema), session.accountId)
  await audit(d.db, session.accountId, 'admin', 'admin.treasury_changed')
  return json(await treasuryStatus(d))
})

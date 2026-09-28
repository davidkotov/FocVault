import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { runStatusChecks } from '@/server/status/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sofort eine Messrunde ausführen. */
export const POST = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  return json({ checks: await runStatusChecks(d, true) })
})

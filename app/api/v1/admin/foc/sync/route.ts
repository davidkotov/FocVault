import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { runFocSync } from '@/server/foc/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** „Jetzt sichern“: Abgleich sofort, auch wenn das Paket noch klein ist. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  return json(await runFocSync(d.db, d.storage, { force: true, actor: session.accountId }))
})

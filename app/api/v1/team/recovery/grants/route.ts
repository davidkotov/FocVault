import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, readJson, route } from '@/server/shared/http'
import { grantRecoveryKey, recoveryGrantSchema } from '@/server/team/service'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await grantRecoveryKey(d, session, await readJson(req, recoveryGrantSchema))
  return json({ ok: true })
})

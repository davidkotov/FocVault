import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, readJson, route } from '@/server/shared/http'
import { escrowMasterKey, escrowSchema } from '@/server/team/service'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await escrowMasterKey(d, session, await readJson(req, escrowSchema))
  return json({ ok: true })
})

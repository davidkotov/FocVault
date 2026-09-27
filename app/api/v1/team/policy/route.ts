import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, readJson, route } from '@/server/shared/http'
import { policySchema, setTeamPolicy } from '@/server/team/service'

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json(await setTeamPolicy(d, session, await readJson(req, policySchema)))
})

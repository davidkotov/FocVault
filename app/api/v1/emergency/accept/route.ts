import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { acceptEmergencyInvite, acceptEmergencySchema } from '@/server/emergency/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { token } = await readJson(req, acceptEmergencySchema)
  await acceptEmergencyInvite(d, session, token)
  return json({ ok: true })
})

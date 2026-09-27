import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { createEmergencyInvite, createEmergencySchema, emergencyOverview } from '@/server/emergency/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  return json(await emergencyOverview(d, await requireSession(req, d.db)))
})

/** Neue Einladung für eine Vertrauensperson. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json(await createEmergencyInvite(d, session, await readJson(req, createEmergencySchema)), 201)
})

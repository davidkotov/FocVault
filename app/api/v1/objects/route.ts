import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { createObject, createObjectSchema } from '@/server/objects/service'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const input = await readJson(req, createObjectSchema, 1024 * 1024)
  return json(await createObject(d, session, input), 201)
})

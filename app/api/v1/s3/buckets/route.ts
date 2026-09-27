import { z } from 'zod'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { createBucketFromDashboard } from '@/server/s3/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { name, objectLock } = await readJson(req, z.object({ name: z.string().max(63), objectLock: z.boolean() }))
  await createBucketFromDashboard(d, session, name, objectLock)
  return json({ ok: true }, 201)
})

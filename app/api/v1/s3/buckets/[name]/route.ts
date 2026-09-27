import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { bucketSettingsSchema, updateBucket } from '@/server/s3/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Standardfrist (Object Lock) und Aufbewahrungsregeln eines Buckets. */
export const PATCH = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await updateBucket(d, session, param(ctx, 'name'), await readJson(req, bucketSettingsSchema))
  return json({ ok: true })
})

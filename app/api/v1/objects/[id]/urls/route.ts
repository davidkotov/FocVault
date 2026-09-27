import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { refreshUploadUrls, refreshUrlsSchema } from '@/server/objects/service'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { pieces } = await readJson(req, refreshUrlsSchema, 256 * 1024)
  return json(await refreshUploadUrls(d, session, param(ctx, 'id'), pieces))
})

import { z } from 'zod'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { promoteVersion } from '@/server/objects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Version wiederherstellen: wird aktuell, die bisherige aktuelle Fassung wird Version. */
export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { currentId } = await readJson(req, z.object({ currentId: z.string().uuid() }))
  await promoteVersion(d, session, param(ctx, 'id'), currentId)
  return json({ ok: true })
})

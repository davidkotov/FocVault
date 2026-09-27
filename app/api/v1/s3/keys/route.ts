import { z } from 'zod'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { createAccessKey } from '@/server/s3/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Neuer Zugangsschlüssel – das Secret wird nur in dieser Antwort gezeigt. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { label } = await readJson(req, z.object({ label: z.string().max(60) }))
  return json(await createAccessKey(d, session, label), 201)
})

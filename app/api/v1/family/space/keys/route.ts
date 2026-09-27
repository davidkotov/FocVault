import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { grantSchema, grantSpaceKeys } from '@/server/family/space'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Verpackte Ordner-Schlüssel ablegen (für Mitglieder bzw. neue Generation). */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await grantSpaceKeys(d, session, await readJson(req, grantSchema, 64 * 1024))
  return json({ ok: true })
})

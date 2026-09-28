import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, readJson, route } from '@/server/shared/http'
import { deleteSsoConfig, getSsoConfig, setSsoConfig, ssoConfigSchema } from '@/server/team/sso'

export const GET = route(async req => {
  const d = await deps()
  return json({ config: await getSsoConfig(d, await requireSession(req, d.db)) })
})

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json({ config: await setSsoConfig(d, session, await readJson(req, ssoConfigSchema)) })
})

export const DELETE = route(async req => {
  const d = await deps()
  await deleteSsoConfig(d, await requireSession(req, d.db))
  return json({ ok: true })
})

import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { ssoDomainSchema, verifySsoDomain } from '@/server/team/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** SSO-Domain per DNS-TXT-Eintrag nachweisen (nur Inhaber). */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { domain } = await readJson(req, ssoDomainSchema)
  return json({ config: await verifySsoDomain(d, session, domain) })
})

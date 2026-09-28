import { deps } from '@/server/deps'
import { reauthSchema } from '@/server/accounts/schemas'
import { reauthWithPassphrase } from '@/server/accounts/service'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Session mit der Passphrase erneut bestätigen (z. B. nach SSO-Anmeldung vor sensiblen Aktionen). */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { authKey } = await readJson(req, reauthSchema)
  await reauthWithPassphrase(d, session, authKey, requestMeta(req))
  return json({ ok: true })
})

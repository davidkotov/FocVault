import { deps, audit } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { focSettingsSchema, setFocSettings } from '@/server/foc/config'
import { invalidateFocHealth } from '@/server/foc/health'
import { focAdminStatus } from '@/server/foc/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  return json(await focAdminStatus(d))
})

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  const value = await readJson(req, focSettingsSchema)
  await setFocSettings(d.db, value, session.accountId)
  invalidateFocHealth()
  await audit(d.db, session.accountId, 'admin', 'admin.foc_changed', { enabled: value.enabled, network: value.network, payer: value.payer })
  return json(await focAdminStatus(d))
})

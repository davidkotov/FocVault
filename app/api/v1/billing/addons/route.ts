import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { buyAddonSchema } from '@/server/billing/schemas'
import { buyAddon } from '@/server/billing/service'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { packId } = await readJson(req, buyAddonSchema)
  await buyAddon(d, session, packId)
  return json(await accountView(d, session.accountId), 201)
})

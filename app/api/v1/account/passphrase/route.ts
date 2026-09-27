import { deps } from '@/server/deps'
import { passphraseSchema } from '@/server/accounts/schemas'
import { changePassphrase } from '@/server/accounts/service'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const input = await readJson(req, passphraseSchema)
  return json(await changePassphrase(d, session, input))
})

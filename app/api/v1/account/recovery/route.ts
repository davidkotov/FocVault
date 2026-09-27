import { deps } from '@/server/deps'
import { recoverySessionSchema } from '@/server/accounts/schemas'
import { requireSession } from '@/server/auth/guard'
import { recoveryWithSession } from '@/server/auth/wallet'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Recovery für angemeldete Nutzer (Wallet-/Social-Konten): Recovery-Kit statt E-Mail. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const input = await readJson(req, recoverySessionSchema)
  return json(await recoveryWithSession(d, session, input))
})

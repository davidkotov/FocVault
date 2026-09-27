import { z } from 'zod'
import { deps, audit } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { rotateSessionKey } from '@/server/foc/chain'
import { invalidateFocHealth } from '@/server/foc/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Neuen Server-Schlüssel erzeugen. Der private Teil verlässt den Server nie. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  const { network } = await readJson(req, z.object({ network: z.enum(['mainnet', 'calibration']) }))
  const address = await rotateSessionKey(d.db, network)
  invalidateFocHealth()
  await audit(d.db, session.accountId, 'admin', 'admin.foc_session_key', { network, address })
  return json({ address })
})

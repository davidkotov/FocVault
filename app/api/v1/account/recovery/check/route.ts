import { z } from 'zod'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { checkRecoveryKit } from '@/server/auth/wallet'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ recoveryAuthKey: z.string().min(20).max(200) })

/** Recovery-Kit testen (Wörter prüfen), ohne etwas zu ändern. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { recoveryAuthKey } = await readJson(req, schema)
  return json(await checkRecoveryKit(d, session, recoveryAuthKey))
})

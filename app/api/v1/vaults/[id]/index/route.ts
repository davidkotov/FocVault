import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { putVaultIndex, vaultIndexSchema } from '@/server/vaults/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json(await putVaultIndex(d, session, param(ctx, 'id'), await readJson(req, vaultIndexSchema, 6 * 1024 * 1024)))
})

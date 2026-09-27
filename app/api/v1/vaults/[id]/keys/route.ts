import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { grantVaultKeys, vaultGrantSchema } from '@/server/vaults/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await grantVaultKeys(d, session, param(ctx, 'id'), await readJson(req, vaultGrantSchema, 256 * 1024))
  return json({ ok: true })
})

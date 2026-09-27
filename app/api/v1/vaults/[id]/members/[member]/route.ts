import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { removeVaultMember, setVaultRole, vaultRoleSchema } from '@/server/vaults/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { role } = await readJson(req, vaultRoleSchema)
  await setVaultRole(d, session, param(ctx, 'id'), param(ctx, 'member'), role)
  return json({ ok: true })
})

export const DELETE = route(async (req, ctx) => {
  const d = await deps()
  await removeVaultMember(d, await requireSession(req, d.db), param(ctx, 'id'), param(ctx, 'member'))
  return json({ ok: true })
})

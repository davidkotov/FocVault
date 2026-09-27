import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { createVault, createVaultSchema, listVaults } from '@/server/vaults/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Geteilte Tresore des Kontos (Business) samt Teammitgliedern. */
export const GET = route(async req => {
  const d = await deps()
  return json(await listVaults(d, await requireSession(req, d.db)))
})

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await createVault(d, session, await readJson(req, createVaultSchema, 6 * 1024 * 1024))
  return json({ ok: true }, 201)
})

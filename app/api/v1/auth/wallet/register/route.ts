import { deps } from '@/server/deps'
import { walletRegisterSchema } from '@/server/accounts/schemas'
import { setSessionCookie } from '@/server/auth/sessions'
import { registerWithWallet } from '@/server/auth/wallet'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const input = await readJson(req, walletRegisterSchema)
  const r = await registerWithWallet(await deps(), input, requestMeta(req))
  const res = json(r.view, 201)
  setSessionCookie(res, r.token, r.expiresAt)
  return res
})

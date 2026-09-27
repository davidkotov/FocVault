import { deps } from '@/server/deps'
import { walletLoginSchema } from '@/server/accounts/schemas'
import { requestOrigin } from '@/server/auth/guard'
import { setSessionCookie } from '@/server/auth/sessions'
import { walletLogin } from '@/server/auth/wallet'
import { allowedOrigins } from '@/server/shared/env'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const input = await readJson(req, walletLoginSchema)
  const result = await walletLogin(await deps(), input, allowedOrigins(requestOrigin(req)), requestMeta(req))
  if (result.status === 'new') {
    return json({ status: 'new', registrationToken: result.registrationToken, address: result.address })
  }
  const res = json({ status: 'existing', account: result.auth.view })
  setSessionCookie(res, result.auth.token, result.auth.expiresAt)
  return res
})

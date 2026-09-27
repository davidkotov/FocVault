import { deps } from '@/server/deps'
import { recoverySchema } from '@/server/accounts/schemas'
import { recoveryLogin } from '@/server/accounts/service'
import { setSessionCookie } from '@/server/auth/sessions'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const input = await readJson(req, recoverySchema)
  const r = await recoveryLogin(await deps(), input, requestMeta(req))
  const res = json(r.view)
  setSessionCookie(res, r.token, r.expiresAt)
  return res
})

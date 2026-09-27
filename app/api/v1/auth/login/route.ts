import { deps } from '@/server/deps'
import { loginSchema } from '@/server/accounts/schemas'
import { login } from '@/server/accounts/service'
import { setSessionCookie } from '@/server/auth/sessions'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const input = await readJson(req, loginSchema)
  const r = await login(await deps(), input, requestMeta(req))
  const res = json(r.view)
  setSessionCookie(res, r.token, r.expiresAt)
  return res
})

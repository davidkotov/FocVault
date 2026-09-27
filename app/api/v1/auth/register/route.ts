import { deps } from '@/server/deps'
import { registerSchema } from '@/server/accounts/schemas'
import { register } from '@/server/accounts/service'
import { setSessionCookie } from '@/server/auth/sessions'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const input = await readJson(req, registerSchema)
  const r = await register(await deps(), input, requestMeta(req))
  const res = json(r.view, 201)
  setSessionCookie(res, r.token, r.expiresAt)
  return res
})

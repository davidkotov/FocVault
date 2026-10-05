import { deps } from '@/server/deps'
import { passkeyLogin, passkeyLoginSchema } from '@/server/auth/passkey-login'
import { requestOrigin } from '@/server/auth/guard'
import { setSessionCookie } from '@/server/auth/sessions'
import { allowedOrigins } from '@/server/shared/env'
import { json, readJson, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Passkey-Assertion prüfen → Session; liefert die Kontoansicht (inkl. Passkey-Envelopes zum Entsperren). */
export const POST = route(async req => {
  const input = await readJson(req, passkeyLoginSchema)
  const r = await passkeyLogin(await deps(), input, allowedOrigins(requestOrigin(req)), requestMeta(req))
  const res = json(r.view)
  setSessionCookie(res, r.token, r.expiresAt)
  return res
})

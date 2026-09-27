import { deps } from '@/server/deps'
import { SESSION_COOKIE, clearSessionCookie, revokeSessionByToken } from '@/server/auth/sessions'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const d = await deps()
  await revokeSessionByToken(d.db, req.cookies.get(SESSION_COOKIE)?.value ?? '')
  const res = json({ ok: true })
  clearSessionCookie(res)
  return res
})

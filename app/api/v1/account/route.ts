import { deps } from '@/server/deps'
import { accountView } from '@/server/accounts/service'
import { requireSession } from '@/server/auth/guard'
import { SESSION_COOKIE, clearSessionCookie, findSession } from '@/server/auth/sessions'
import { deleteAccount, deleteAccountSchema } from '@/server/accounts/delete'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `?optional=1`: ohne Session 204 statt 401 (Status-Abfrage beim Seitenaufruf, ohne Konsolenfehler). */
export const GET = route(async req => {
  const d = await deps()
  if (req.nextUrl.searchParams.get('optional') === '1') {
    const s = await findSession(d.db, req.cookies.get(SESSION_COOKIE)?.value ?? '')
    if (!s) return new Response(null, { status: 204 })
    return json(await accountView(d, s.accountId))
  }
  const session = await requireSession(req, d.db)
  return json(await accountView(d, session.accountId))
})

/** Konto endgültig löschen (Passphrase oder Recovery-Kit als Bestätigung). */
export const DELETE = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const input = await readJson(req, deleteAccountSchema)
  const r = await deleteAccount(d, session, input)
  const res = json({ ok: true, ...r })
  clearSessionCookie(res)
  return res
})

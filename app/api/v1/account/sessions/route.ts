import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { listSessions, revokeOtherSessions } from '@/server/auth/sessions'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Geräte & Sitzungen des Kontos. */
export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json({ sessions: await listSessions(d.db, session.accountId, session.sessionId) })
})

/** Alle anderen Geräte abmelden. */
export const DELETE = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await revokeOtherSessions(d.db, session.accountId, session.sessionId)
  return json({ ok: true })
})

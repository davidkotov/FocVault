import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { revokeSession } from '@/server/auth/sessions'
import { ApiError } from '@/server/shared/errors'
import { json, param, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Ein Gerät abmelden. */
export const DELETE = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const id = param(ctx, 'id')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('BAD_REQUEST', 'Ungültige Sitzung.')
  if (!(await revokeSession(d.db, session.accountId, id))) throw new ApiError('NOT_FOUND', 'Sitzung nicht gefunden.')
  return json({ ok: true })
})

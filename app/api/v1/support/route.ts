import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, requestMeta, route } from '@/server/shared/http'
import { createTicket, ticketSchema } from '@/server/support/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Support-Formular (öffentlich; angemeldete Konten werden verknüpft). */
export const POST = route(async req => {
  const d = await deps()
  const input = await readJson(req, ticketSchema, 16 * 1024)
  const session = await requireSession(req, d.db).catch(() => null)
  return json(await createTicket(d, input, { ip: requestMeta(req).ip, accountId: session?.accountId }), 201)
})

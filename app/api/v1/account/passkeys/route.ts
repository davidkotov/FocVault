import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { accountView } from '@/server/accounts/service'
import { addPasskey, addPasskeySchema } from '@/server/accounts/passkeys'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Passkey zum Entsperren hinzufügen (Envelope wird im Browser erzeugt). */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await addPasskey(d, session, await readJson(req, addPasskeySchema))
  return json(await accountView(d, session.accountId), 201)
})

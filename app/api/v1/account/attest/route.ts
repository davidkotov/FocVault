import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, readJson, route } from '@/server/shared/http'
import { attestPassphrase, attestSchema } from '@/server/team/service'

/** Gerät meldet die Länge der Passphrase (für Team-Richtlinien; der Server kann sie nicht prüfen). */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { passphraseChars } = await readJson(req, attestSchema)
  await attestPassphrase(d, session, passphraseChars)
  return json({ ok: true })
})

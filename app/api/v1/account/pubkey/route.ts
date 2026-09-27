import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { pubkeySchema, setPublicKey } from '@/server/family/space'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Öffentlichen ECDH-Schlüssel hinterlegen (Empfang des Familienordner-Schlüssels). */
export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { publicKey } = await readJson(req, pubkeySchema)
  await setPublicKey(d, session, publicKey)
  return json({ ok: true })
})

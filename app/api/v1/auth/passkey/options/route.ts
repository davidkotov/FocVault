import { deps } from '@/server/deps'
import { issuePasskeyChallenge } from '@/server/auth/passkey-login'
import { ipLimit, rateLimit } from '@/server/auth/ratelimit'
import { clientIp, json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Einmal-Challenge für die Anmeldung per Passkey (5 Minuten gültig). */
export const POST = route(async req => {
  rateLimit(`passkey:options:${clientIp(req)}`, ipLimit(60), 15 * 60_000)
  return json({ challenge: await issuePasskeyChallenge(await deps()) })
})

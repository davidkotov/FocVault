import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { audit, type Deps } from '../deps'
import { ApiError } from '../shared/errors'
import { b64uDecode, safeEqual, sha256 } from '../shared/bytes'
import { accountView, type AuthResult, type RequestMeta } from '../accounts/service'
import { ssoEnforcedFor } from '../team/sso'
import { ipLimit, rateLimit } from './ratelimit'
import { createSession } from './sessions'
import { parseAuthData, verifyAssertion } from './webauthn'

/**
 * Anmelden per Passkey ohne E-Mail (discoverable credential): Der Server stellt eine Einmal-Challenge aus,
 * der Browser lässt sie vom Authenticator signieren (Face ID, Touch ID, Windows Hello, Sicherheitsschlüssel).
 * Geprüft werden Challenge, Origin, rpIdHash, User Verification, Signatur und Signaturzähler.
 * Den Tresor entsperrt der Browser danach selbst über die PRF-Erweiterung – der Server sieht davon nichts.
 */
const CHALLENGE_PREFIX = 'passkey:'
const b64 = z.string().regex(/^[A-Za-z0-9_-]*$/, 'base64url erwartet')

export const passkeyLoginSchema = z.object({
  credentialId: b64.min(16).max(1400),
  clientDataJSON: b64.min(20).max(4000),
  authenticatorData: b64.min(40).max(4000),
  signature: b64.min(8).max(2000),
  userHandle: b64.max(200).optional()
})

/** Einmal-Challenge (5 Minuten gültig); liegt mit Präfix in auth_nonces, getrennt von SIWE-Nonces. */
export async function issuePasskeyChallenge(deps: Deps): Promise<string> {
  const challenge = randomBytes(32).toString('base64url')
  await deps.db.query(`DELETE FROM auth_nonces WHERE expires_at < now() - interval '1 day'`)
  await deps.db.query(`INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, now() + interval '5 minutes')`, [CHALLENGE_PREFIX + challenge])
  return challenge
}

export async function passkeyLogin(
  deps: Deps,
  input: z.output<typeof passkeyLoginSchema>,
  origins: string[],
  meta: RequestMeta
): Promise<AuthResult> {
  rateLimit(`passkey:ip:${meta.ip}`, ipLimit(30), 15 * 60_000)
  const invalid = new ApiError('INVALID_CREDENTIALS', 'Dieser Passkey ist unbekannt oder ungültig.')
  const foreign = new ApiError('FORBIDDEN', 'Der Passkey gehört zu einer anderen Website.')
  const clientDataJSON = b64uDecode(input.clientDataJSON)
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown }
  try {
    cd = JSON.parse(clientDataJSON.toString('utf8'))
  } catch {
    throw new ApiError('BAD_REQUEST', 'Passkey-Antwort ist ungültig.')
  }
  if (cd?.type !== 'webauthn.get' || typeof cd.challenge !== 'string' || typeof cd.origin !== 'string') {
    throw new ApiError('BAD_REQUEST', 'Passkey-Antwort ist ungültig.')
  }
  // Challenge sofort verbrauchen – auch fehlgeschlagene Versuche lassen sich nicht wiederholen
  const consumed = await deps.db.query(
    `UPDATE auth_nonces SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING nonce`,
    [CHALLENGE_PREFIX + cd.challenge]
  )
  if (!consumed.length) throw new ApiError('FORBIDDEN', 'Anmeldung abgelaufen oder bereits verwendet – bitte erneut versuchen.')
  if (!origins.includes(cd.origin) || cd.crossOrigin === true) throw foreign
  const authData = b64uDecode(input.authenticatorData)
  const ad = parseAuthData(authData)
  if (!ad) throw new ApiError('BAD_REQUEST', 'Passkey-Antwort ist ungültig.')
  if (!safeEqual(ad.rpIdHash, sha256(new URL(cd.origin).hostname))) throw foreign
  if (!ad.up || !ad.uv) throw new ApiError('FORBIDDEN', 'Bitte die Anmeldung mit Face ID, Touch ID, Windows Hello oder PIN bestätigen.')

  const rows = await deps.db.query<{
    id: string
    account_id: string
    public_key: Uint8Array
    public_key_alg: number
    sign_count: string | number
    status: string
    email: string | null
  }>(
    `SELECT k.id, k.account_id, k.public_key, k.public_key_alg, k.sign_count, a.status, a.email
       FROM account_keys k JOIN accounts a ON a.id = k.account_id
      WHERE k.kek_type = 'passkey' AND k.kek_id = $1 AND k.revoked_at IS NULL AND k.public_key IS NOT NULL`,
    [input.credentialId]
  )
  const row = rows[0]
  if (!row) throw invalid
  // userHandle = Konto-ID (beim Einrichten als user.id gesetzt)
  if (input.userHandle && b64uDecode(input.userHandle).toString('utf8') !== row.account_id) throw invalid
  if (!verifyAssertion(row.public_key, Number(row.public_key_alg), authData, clientDataJSON, b64uDecode(input.signature))) {
    await audit(deps.db, row.account_id, 'user', 'auth.passkey_failed')
    throw invalid
  }
  // Signaturzähler: 0 = Authenticator zählt nicht (z. B. synchronisierte Passkeys). Sonst muss er steigen (Klon-Erkennung).
  if (ad.signCount !== 0 || Number(row.sign_count) !== 0) {
    const updated = await deps.db.query('UPDATE account_keys SET sign_count = $2 WHERE id = $1 AND sign_count < $2 RETURNING id', [row.id, ad.signCount])
    if (!updated.length) {
      await audit(deps.db, row.account_id, 'user', 'auth.passkey_counter_mismatch')
      throw invalid
    }
  }
  if (row.status === 'suspended' || row.status === 'deleted') throw new ApiError('FORBIDDEN', 'Dieses Konto ist gesperrt.')
  if (row.email && (await ssoEnforcedFor(deps.db, row.email, row.account_id))) {
    await audit(deps.db, row.account_id, 'user', 'auth.login_blocked_sso')
    throw new ApiError('SSO_REQUIRED', 'Dein Unternehmen verlangt die Anmeldung per SSO.')
  }
  // Bewusst keine „starke“ Session: sensible Aktionen (Passphrase ändern, weitere Passkeys einrichten)
  // verlangen weiterhin eine Bestätigung mit Passphrase oder Recovery-Kit.
  const session = await createSession(deps.db, row.account_id, meta.userAgent, { strongAuth: false })
  await audit(deps.db, row.account_id, 'user', 'auth.passkey_login')
  return { view: await accountView(deps, row.account_id), ...session }
}

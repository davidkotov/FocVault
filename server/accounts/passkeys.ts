import { z } from 'zod'
import type { PasskeyEnvelope } from '../../lib/api-types'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { uuidv7 } from '../shared/ids'
import { b64uDecode } from '../shared/bytes'

/**
 * Passkeys zum Entsperren (Pro/Family). Der Passkey liefert über die WebAuthn-PRF-Erweiterung
 * einen geheimen Wert, aus dem der Browser einen Schlüssel ableitet und damit den Master-Key
 * verpackt. Der Server speichert nur diese verpackte Kopie, die Credential-ID und den PRF-Salt –
 * ohne das Gerät mit dem Passkey ist sie wertlos. Anmelden (Session) bleibt unverändert.
 */
const b64u = z.string().regex(/^[A-Za-z0-9_-]+$/)
export const addPasskeySchema = z.object({
  credentialId: b64u.min(16).max(1400),
  label: z.string().trim().min(1).max(60),
  salt: b64u.length(43),
  iv: b64u.length(16),
  cipher: b64u.min(40).max(100)
})

const MAX_PASSKEYS = 10
const PAID = new Set(['pro', 'family', 'business'])

interface Row {
  kek_id: string
  mk_iv: Uint8Array
  mk_wrapped: Uint8Array
  kdf_params: { salt: string; label: string } | null
  created_at: string
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64url')

/** Passkey-Envelopes für die Kontoansicht – nur mit Abo (Passkey-Entsperren ist ein Pro-Modul). */
export async function passkeyEnvelopes(db: Db, accountId: string, plan: string): Promise<PasskeyEnvelope[]> {
  if (!PAID.has(plan)) return []
  const rows = await db.query<Row>(
    `SELECT kek_id, mk_iv, mk_wrapped, kdf_params, created_at FROM account_keys
      WHERE account_id = $1 AND kek_type = 'passkey' AND revoked_at IS NULL ORDER BY created_at`,
    [accountId]
  )
  return rows.map(r => ({
    credentialId: r.kek_id,
    label: r.kdf_params?.label ?? 'Passkey',
    salt: r.kdf_params?.salt ?? '',
    iv: b64(r.mk_iv),
    cipher: b64(r.mk_wrapped),
    createdAt: new Date(r.created_at).toISOString()
  }))
}

export async function addPasskey(deps: Deps, session: SessionInfo, input: z.output<typeof addPasskeySchema>): Promise<void> {
  const acc = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [session.accountId])
  if (!PAID.has(acc[0]?.plan ?? 'free')) throw new ApiError('PLAN_REQUIRED', 'Passkeys gibt es mit Pro und Family.')
  const count = await deps.db.query<{ n: number }>(
    `SELECT count(*)::float8 AS n FROM account_keys WHERE account_id = $1 AND kek_type = 'passkey' AND revoked_at IS NULL`,
    [session.accountId]
  )
  if (Number(count[0]?.n ?? 0) >= MAX_PASSKEYS) throw new ApiError('BAD_REQUEST', `Höchstens ${MAX_PASSKEYS} Passkeys.`)
  const rows = await deps.db.query(
    `INSERT INTO account_keys (id, account_id, kek_type, kek_id, mk_iv, mk_wrapped, kdf_params)
     VALUES ($1, $2, 'passkey', $3, $4, $5, $6)
     ON CONFLICT (account_id, kek_type, kek_id) WHERE revoked_at IS NULL DO NOTHING RETURNING id`,
    [
      uuidv7(),
      session.accountId,
      input.credentialId,
      b64uDecode(input.iv),
      b64uDecode(input.cipher),
      JSON.stringify({ salt: input.salt, label: input.label })
    ]
  )
  if (!rows.length) throw new ApiError('BAD_REQUEST', 'Dieser Passkey ist bereits eingerichtet.')
  await audit(deps.db, session.accountId, 'user', 'account.passkey_added', { label: input.label })
}

export async function removePasskey(deps: Deps, session: SessionInfo, credentialId: string): Promise<void> {
  const rows = await deps.db.query(
    `UPDATE account_keys SET revoked_at = now()
      WHERE account_id = $1 AND kek_type = 'passkey' AND kek_id = $2 AND revoked_at IS NULL RETURNING id`,
    [session.accountId, credentialId]
  )
  if (!rows.length) throw new ApiError('NOT_FOUND', 'Passkey nicht gefunden.')
  await audit(deps.db, session.accountId, 'user', 'account.passkey_removed', {})
}

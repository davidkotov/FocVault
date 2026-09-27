import { passkeyEnvelopes } from './passkeys'
import { pooledUsedBytes } from '../family/service'
import type { z } from 'zod'
import type { AccountView, KdfParams, KekType, KeyEnvelope, Plan } from '../../lib/api-types'
import { audit, type Deps } from '../deps'
import { isUniqueViolation } from '../db'
import { ApiError } from '../shared/errors'
import { b64uDecode, b64uEncode, hmacSha256 } from '../shared/bytes'
import { isAdminIdentity, serverSecret } from '../shared/env'
import { uuidv7 } from '../shared/ids'
import { burnVerification, hashSecret, verifySecret, type SecretHashParams } from '../auth/passwords'
import { ipLimit, rateLimit } from '../auth/ratelimit'
import { createSession, revokeOtherSessions, type SessionInfo } from '../auth/sessions'
import { requireStrongAuth } from '../auth/guard'
import { usedBytes } from './plans'
import { accountBilling } from '../billing/service'
import type { loginSchema, passphraseSchema, recoverySchema, registerSchema } from './schemas'

export interface RequestMeta {
  ip: string
  userAgent: string | null
}

export interface AuthResult {
  view: AccountView
  token: string
  expiresAt: Date
  sessionId: string
}

const AUTH_WINDOW_MS = 15 * 60_000

/**
 * Server-seitige Form der Recovery-Kennung: HMAC mit dem Server-Secret. Ein Datenbank-Leak allein
 * erlaubt so keinen Abgleich, und die Kennung selbst verrät nichts über die Wörter.
 */
export function recoveryLookupHash(lookupB64u: string): Buffer {
  return hmacSha256(serverSecret(), `recovery-lookup\n${lookupB64u}`)
}

/** Kennung beim Konto hinterlegen (nachträglich für ältere Konten); Kollisionen werden ignoriert. */
export async function storeRecoveryLookup(db: Deps['db'], accountId: string, lookupB64u: string | undefined): Promise<void> {
  if (!lookupB64u) return
  try {
    await db.query('UPDATE accounts SET recovery_lookup = $2 WHERE id = $1 AND recovery_lookup IS NULL', [accountId, recoveryLookupHash(lookupB64u)])
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }
}

/** Standard-Kosten der Client-KDF – auch für Pseudo-Antworten (nicht unterscheidbar). */
export const DEFAULT_KDF_COST = { m: 65_536, t: 3, p: 1 } as const

/**
 * Liefert die KDF-Parameter vor dem Login. Für unbekannte E-Mails ein deterministischer
 * Pseudo-Salt – so verrät die Antwort nicht, ob ein Konto existiert.
 */
export async function prelogin(deps: Deps, email: string): Promise<{ kdf: KdfParams }> {
  const rows = await deps.db.query<{ kdf_params: KdfParams }>(
    `SELECT k.kdf_params FROM account_keys k JOIN accounts a ON a.id = k.account_id
      WHERE a.email = $1 AND k.kek_type = 'passphrase' AND k.revoked_at IS NULL`,
    [email]
  )
  if (rows[0]?.kdf_params) return { kdf: rows[0].kdf_params }
  const salt = hmacSha256(serverSecret(), `prelogin\n${email}`).subarray(0, 16)
  return { kdf: { alg: 'argon2id', v: 1, salt: b64uEncode(salt), ...DEFAULT_KDF_COST } }
}

export async function register(
  deps: Deps,
  input: z.output<typeof registerSchema>,
  meta: RequestMeta
): Promise<AuthResult> {
  rateLimit(`register:ip:${meta.ip}`, ipLimit(20), 60 * 60_000)
  const accountId = uuidv7()
  const [pass, rec] = await Promise.all([
    hashSecret(b64uDecode(input.authKey)),
    hashSecret(b64uDecode(input.recoveryAuthKey))
  ])
  try {
    await deps.db.tx(async tx => {
      const existing = await tx.query('SELECT 1 FROM accounts WHERE email = $1', [input.email])
      if (existing.length) throw new ApiError('EMAIL_TAKEN', 'Für diese E-Mail gibt es bereits ein Konto.')
      await tx.query('INSERT INTO accounts (id, email, recovery_lookup) VALUES ($1, $2, $3)', [
        accountId,
        input.email,
        input.recoveryLookup ? recoveryLookupHash(input.recoveryLookup) : null
      ])
      for (const [kind, h] of [
        ['passphrase', pass],
        ['recovery', rec]
      ] as const) {
        await tx.query(
          'INSERT INTO auth_secrets (account_id, kind, hash, salt, params) VALUES ($1, $2, $3, $4, $5)',
          [accountId, kind, h.hash, h.salt, JSON.stringify(h.params)]
        )
      }
      for (const env of input.envelopes) {
        await tx.query(
          `INSERT INTO account_keys (id, account_id, kek_type, mk_iv, mk_wrapped, kdf_params)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            uuidv7(),
            accountId,
            env.kekType,
            b64uDecode(env.iv),
            b64uDecode(env.cipher),
            env.kekType === 'passphrase' ? JSON.stringify(input.kdf) : null
          ]
        )
      }
      await audit(tx, accountId, 'user', 'account.registered')
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError('EMAIL_TAKEN', 'Für diese E-Mail gibt es bereits ein Konto.')
    throw e
  }
  const session = await createSession(deps.db, accountId, meta.userAgent)
  return { view: await accountView(deps, accountId), ...session }
}

async function verifyAuth(
  deps: Deps,
  email: string | { lookup: string },
  kind: 'passphrase' | 'recovery',
  secretB64: string,
  meta: RequestMeta
): Promise<string> {
  const byLookup = typeof email !== 'string'
  rateLimit(byLookup ? `auth:recovery:lookup:${email.lookup}` : `auth:${kind}:email:${email}`, 10, AUTH_WINDOW_MS)
  rateLimit(`auth:ip:${meta.ip}`, ipLimit(60), AUTH_WINDOW_MS)
  const invalid = new ApiError(
    'INVALID_CREDENTIALS',
    kind === 'passphrase'
      ? 'E-Mail oder Passphrase ist falsch.'
      : byLookup
        ? 'Zu diesen 24 Wörtern wurde kein Konto gefunden. Ältere Konten: bitte E-Mail angeben oder zuerst mit Google, Apple bzw. Wallet anmelden.'
        : 'E-Mail oder Recovery-Kit ist falsch.'
  )
  const rows = await deps.db.query<{
    id: string
    status: string
    hash: Uint8Array
    salt: Uint8Array
    params: SecretHashParams
  }>(
    `SELECT a.id, a.status, s.hash, s.salt, s.params
       FROM accounts a JOIN auth_secrets s ON s.account_id = a.id AND s.kind = $2
      WHERE ${byLookup ? 'a.recovery_lookup' : 'a.email'} = $1`,
    [byLookup ? recoveryLookupHash(email.lookup) : email, kind]
  )
  const row = rows[0]
  if (!row) {
    await burnVerification()
    throw invalid
  }
  const ok = await verifySecret(b64uDecode(secretB64), row.hash, row.salt, row.params)
  if (!ok) {
    await audit(deps.db, row.id, 'user', `auth.${kind}_failed`)
    throw invalid
  }
  if (row.status === 'suspended' || row.status === 'deleted') {
    throw new ApiError('FORBIDDEN', 'Dieses Konto ist gesperrt.')
  }
  return row.id
}

export async function login(deps: Deps, input: z.output<typeof loginSchema>, meta: RequestMeta): Promise<AuthResult> {
  const accountId = await verifyAuth(deps, input.email, 'passphrase', input.authKey, meta)
  const session = await createSession(deps.db, accountId, meta.userAgent)
  await audit(deps.db, accountId, 'user', 'auth.login')
  return { view: await accountView(deps, accountId), ...session }
}

/** Recovery-Login: liefert zusätzlich das Recovery-Envelope, danach muss eine neue Passphrase gesetzt werden. */
export async function recoveryLogin(
  deps: Deps,
  input: z.output<typeof recoverySchema>,
  meta: RequestMeta
): Promise<AuthResult> {
  const accountId = await verifyAuth(deps, input.email ?? { lookup: input.recoveryLookup! }, 'recovery', input.recoveryAuthKey, meta)
  await storeRecoveryLookup(deps.db, accountId, input.recoveryLookup)
  const session = await createSession(deps.db, accountId, meta.userAgent)
  await audit(deps.db, accountId, 'user', 'auth.recovery_login', { via: input.email ? 'email' : 'words' })
  return { view: await accountView(deps, accountId, ['recovery']), ...session }
}

export async function changePassphrase(
  deps: Deps,
  session: SessionInfo,
  input: z.output<typeof passphraseSchema>
): Promise<AccountView> {
  requireStrongAuth(session)
  const h = await hashSecret(b64uDecode(input.authKey))
  await deps.db.tx(async tx => {
    await tx.query(
      `UPDATE auth_secrets SET hash = $2, salt = $3, params = $4, updated_at = now()
        WHERE account_id = $1 AND kind = 'passphrase'`,
      [session.accountId, h.hash, h.salt, JSON.stringify(h.params)]
    )
    await tx.query(
      `UPDATE account_keys SET revoked_at = now()
        WHERE account_id = $1 AND kek_type = 'passphrase' AND revoked_at IS NULL`,
      [session.accountId]
    )
    await tx.query(
      `INSERT INTO account_keys (id, account_id, kek_type, mk_iv, mk_wrapped, kdf_params)
       VALUES ($1, $2, 'passphrase', $3, $4, $5)`,
      [
        uuidv7(),
        session.accountId,
        b64uDecode(input.envelope.iv),
        b64uDecode(input.envelope.cipher),
        JSON.stringify(input.kdf)
      ]
    )
    await audit(tx, session.accountId, 'user', 'account.passphrase_changed')
  })
  await revokeOtherSessions(deps.db, session.accountId, session.sessionId)
  return accountView(deps, session.accountId)
}

export async function accountView(deps: Deps, accountId: string, extraKeks: KekType[] = []): Promise<AccountView> {
  const rows = await deps.db.query<{
    id: string
    email: string | null
    label: string | null
    email_verified_at: Date | null
    plan: Plan
    created_at: Date
  }>('SELECT id, email, label, email_verified_at, plan, created_at FROM accounts WHERE id = $1', [accountId])
  const a = rows[0]
  if (!a) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const wallets = (
    await deps.db.query<{ address: string }>('SELECT address FROM auth_wallets WHERE account_id = $1 ORDER BY created_at', [
      accountId
    ])
  ).map(w => w.address)
  const keys = await deps.db.query<{
    kek_type: KekType
    mk_iv: Uint8Array
    mk_wrapped: Uint8Array
    kdf_params: KdfParams | null
  }>(
    'SELECT kek_type, mk_iv, mk_wrapped, kdf_params FROM account_keys WHERE account_id = $1 AND revoked_at IS NULL',
    [accountId]
  )
  const pass = keys.find(k => k.kek_type === 'passphrase')
  if (!pass || !pass.kdf_params) throw new Error('Konto ohne Passphrase-Schlüssel')
  const envelopes: KeyEnvelope[] = keys
    .filter(k => k.kek_type === 'passphrase' || extraKeks.includes(k.kek_type))
    .map(k => ({ kekType: k.kek_type, iv: b64uEncode(k.mk_iv), cipher: b64uEncode(k.mk_wrapped) }))
  const used = await pooledUsedBytes(deps.db, a.id)
  const { quotaBytes, ...billing } = await accountBilling(deps, a.id, used)
  return {
    id: a.id,
    email: a.email,
    label: a.email ?? a.label ?? (wallets[0] ? `${wallets[0].slice(0, 6)}…${wallets[0].slice(-4)}` : 'Konto'),
    wallets,
    emailVerified: !!a.email_verified_at,
    plan: a.plan,
    quotaBytes,
    usedBytes: used,
    billing,
    createdAt: new Date(a.created_at).toISOString(),
    kdf: pass.kdf_params,
    envelopes,
    passkeys: await passkeyEnvelopes(deps.db, a.id, a.plan),
    isAdmin: isAdminIdentity(a.email, wallets)
  }
}

import { randomBytes } from 'node:crypto'
import { createPublicClient, getAddress, http, verifyMessage, type Hex } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import type { z } from 'zod'
import type { AccountView } from '../../lib/api-types'
import { filecoin, filecoinCalibration } from '../../lib/chains'
import { audit, type Deps } from '../deps'
import { isUniqueViolation } from '../db'
import { ApiError } from '../shared/errors'
import { b64uDecode, hmacSha256, safeEqual } from '../shared/bytes'
import { serverSecret } from '../shared/env'
import { uuidv7 } from '../shared/ids'
import { accountView, recoveryLookupHash, storeRecoveryLookup, type AuthResult, type RequestMeta } from '../accounts/service'
import type { recoverySessionSchema, walletLoginSchema, walletRegisterSchema } from '../accounts/schemas'
import { hashSecret, verifySecret, type SecretHashParams } from './passwords'
import { ipLimit, rateLimit } from './ratelimit'
import { createSession, type SessionInfo } from './sessions'

export const ALLOWED_CHAIN_IDS: number[] = [filecoinCalibration.id, filecoin.id]
const MESSAGE_MAX_AGE_MS = 10 * 60_000
const REGISTRATION_TOKEN_TTL_SEC = 15 * 60

/** Einmal-Nonce für die SIWE-Nachricht (10 Minuten gültig). */
export async function issueNonce(deps: Deps): Promise<string> {
  const nonce = randomBytes(16).toString('hex')
  await deps.db.query(`DELETE FROM auth_nonces WHERE expires_at < now() - interval '1 day'`)
  await deps.db.query(`INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, now() + interval '10 minutes')`, [nonce])
  return nonce
}

/** EOA-Signatur offline prüfen; sonst Smart-Account (EIP-1271/6492) über die Chain. */
async function verifySignature(message: string, signature: Hex, address: `0x${string}`, chainId: number): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true
  } catch {
    /* keine gültige EOA-Signatur – Smart-Account-Prüfung versuchen */
  }
  try {
    const chain = chainId === filecoin.id ? filecoin : filecoinCalibration
    return await createPublicClient({ chain, transport: http() }).verifyMessage({ address, message, signature })
  } catch {
    return false
  }
}

function tokenPayload(address: string, exp: string): string {
  return `fv-wallet-register-v1\n${address}\n${exp}`
}

function signRegistrationToken(address: string): string {
  const exp = String(Math.floor(Date.now() / 1000) + REGISTRATION_TOKEN_TTL_SEC)
  const sig = hmacSha256(serverSecret(), tokenPayload(address, exp)).toString('base64url')
  return `${address}.${exp}.${sig}`
}

function verifyRegistrationToken(token: string): string {
  const [address, exp, sig] = token.split('.')
  const invalid = new ApiError('FORBIDDEN', 'Registrierung abgelaufen – bitte erneut anmelden.')
  if (!address || !/^0x[0-9a-f]{40}$/.test(address) || !/^\d+$/.test(exp ?? '') || !sig) throw invalid
  if (Number(exp) * 1000 < Date.now()) throw invalid
  if (!safeEqual(hmacSha256(serverSecret(), tokenPayload(address, exp)), b64uDecode(sig))) throw invalid
  return address
}

export type WalletLoginResult =
  | { status: 'existing'; auth: AuthResult }
  | { status: 'new'; registrationToken: string; address: string }

/**
 * Prüft eine SIWE-Nachricht (EIP-4361): Domain und URI müssen zu uns gehören, Nonce einmalig
 * und frisch, Netzwerk Filecoin, Signatur gültig. Bekannte Adresse → Session; neue Adresse →
 * kurzlebiges Registrierungs-Token (Passphrase + Recovery-Kit werden danach angelegt).
 */
export async function walletLogin(
  deps: Deps,
  input: z.output<typeof walletLoginSchema>,
  origins: string[],
  meta: RequestMeta
): Promise<WalletLoginResult> {
  rateLimit(`wallet:ip:${meta.ip}`, ipLimit(30), 15 * 60_000)
  let parsed: ReturnType<typeof parseSiweMessage>
  try {
    parsed = parseSiweMessage(input.message)
  } catch {
    throw new ApiError('BAD_REQUEST', 'Anmelde-Nachricht ist ungültig.')
  }
  const { address, nonce, domain, uri, chainId, issuedAt, expirationTime } = parsed
  if (!address || !nonce || !domain || !uri || !chainId) throw new ApiError('BAD_REQUEST', 'Anmelde-Nachricht ist unvollständig.')
  let uriOrigin: string
  try {
    uriOrigin = new URL(uri).origin
  } catch {
    throw new ApiError('BAD_REQUEST', 'Anmelde-Nachricht ist ungültig.')
  }
  const allowed = origins.some(o => new URL(o).host === domain && o === uriOrigin)
  if (!allowed) throw new ApiError('FORBIDDEN', 'Die Signatur gehört zu einer anderen Website.')
  if (!ALLOWED_CHAIN_IDS.includes(chainId)) throw new ApiError('BAD_REQUEST', 'Bitte mit Filecoin (Mainnet oder Calibration) anmelden.')
  const now = Date.now()
  if (!issuedAt || Math.abs(now - issuedAt.getTime()) > MESSAGE_MAX_AGE_MS) {
    throw new ApiError('FORBIDDEN', 'Anmelde-Nachricht ist abgelaufen – bitte erneut versuchen.')
  }
  if (expirationTime && expirationTime.getTime() < now) throw new ApiError('FORBIDDEN', 'Anmelde-Nachricht ist abgelaufen.')

  const consumed = await deps.db.query(
    `UPDATE auth_nonces SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING nonce`,
    [nonce]
  )
  if (!consumed.length) throw new ApiError('FORBIDDEN', 'Anmelde-Nachricht ungültig oder bereits verwendet.')
  if (!(await verifySignature(input.message, input.signature as Hex, address, chainId))) {
    throw new ApiError('INVALID_CREDENTIALS', 'Signatur ungültig.')
  }

  const addr = address.toLowerCase()
  const rows = await deps.db.query<{ account_id: string; status: string }>(
    `SELECT w.account_id, a.status FROM auth_wallets w JOIN accounts a ON a.id = w.account_id WHERE w.address = $1`,
    [addr]
  )
  const known = rows[0]
  if (!known) return { status: 'new', registrationToken: signRegistrationToken(addr), address: getAddress(address) }
  if (known.status === 'suspended' || known.status === 'deleted') throw new ApiError('FORBIDDEN', 'Dieses Konto ist gesperrt.')
  await deps.db.query('UPDATE auth_wallets SET last_login_at = now() WHERE address = $1', [addr])
  const session = await createSession(deps.db, known.account_id, meta.userAgent)
  await audit(deps.db, known.account_id, 'user', 'auth.wallet_login')
  return { status: 'existing', auth: { view: await accountView(deps, known.account_id), ...session } }
}

/** Legt ein Konto für eine per SIWE bestätigte Adresse an (Passphrase + Recovery-Kit wie bei E-Mail-Konten). */
export async function registerWithWallet(
  deps: Deps,
  input: z.output<typeof walletRegisterSchema>,
  meta: RequestMeta
): Promise<AuthResult> {
  rateLimit(`register:ip:${meta.ip}`, ipLimit(20), 60 * 60_000)
  const address = verifyRegistrationToken(input.registrationToken)
  const accountId = uuidv7()
  const [pass, rec] = await Promise.all([
    hashSecret(b64uDecode(input.authKey)),
    hashSecret(b64uDecode(input.recoveryAuthKey))
  ])
  const taken = new ApiError('ALREADY_REGISTERED', 'Für diese Wallet gibt es bereits ein Konto – bitte anmelden.')
  try {
    await deps.db.tx(async tx => {
      if ((await tx.query('SELECT 1 FROM auth_wallets WHERE address = $1', [address])).length) throw taken
      await tx.query('INSERT INTO accounts (id, email, label, recovery_lookup) VALUES ($1, NULL, $2, $3)', [
        accountId,
        input.label ?? null,
        input.recoveryLookup ? recoveryLookupHash(input.recoveryLookup) : null
      ])
      for (const [kind, h] of [
        ['passphrase', pass],
        ['recovery', rec]
      ] as const) {
        await tx.query('INSERT INTO auth_secrets (account_id, kind, hash, salt, params) VALUES ($1, $2, $3, $4, $5)', [
          accountId,
          kind,
          h.hash,
          h.salt,
          JSON.stringify(h.params)
        ])
      }
      for (const env of input.envelopes) {
        await tx.query(
          `INSERT INTO account_keys (id, account_id, kek_type, mk_iv, mk_wrapped, kdf_params) VALUES ($1, $2, $3, $4, $5, $6)`,
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
      await tx.query('INSERT INTO auth_wallets (address, account_id, last_login_at) VALUES ($1, $2, now())', [address, accountId])
      await audit(tx, accountId, 'user', 'account.registered', { via: 'wallet' })
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw taken
    throw e
  }
  const session = await createSession(deps.db, accountId, meta.userAgent)
  return { view: await accountView(deps, accountId), ...session }
}

/**
 * Recovery für angemeldete Nutzer (v. a. Wallet-Konten ohne E-Mail): Recovery-Kit prüfen,
 * Session als frisch bestätigt markieren und das Recovery-Envelope ausliefern.
 */
export async function recoveryWithSession(
  deps: Deps,
  session: SessionInfo,
  input: z.output<typeof recoverySessionSchema>
): Promise<AccountView> {
  rateLimit(`auth:recovery:account:${session.accountId}`, 10, 15 * 60_000)
  const rows = await deps.db.query<{ hash: Uint8Array; salt: Uint8Array; params: SecretHashParams }>(
    `SELECT hash, salt, params FROM auth_secrets WHERE account_id = $1 AND kind = 'recovery'`,
    [session.accountId]
  )
  const row = rows[0]
  if (!row || !(await verifySecret(b64uDecode(input.recoveryAuthKey), row.hash, row.salt, row.params))) {
    await audit(deps.db, session.accountId, 'user', 'auth.recovery_failed')
    throw new ApiError('INVALID_CREDENTIALS', 'Das Recovery-Kit passt nicht zu diesem Konto.')
  }
  await deps.db.query('UPDATE sessions SET strong_auth_at = now() WHERE id = $1', [session.sessionId])
  await storeRecoveryLookup(deps.db, session.accountId, input.recoveryLookup)
  await audit(deps.db, session.accountId, 'user', 'auth.recovery_login', { via: 'session' })
  return accountView(deps, session.accountId, ['recovery'])
}

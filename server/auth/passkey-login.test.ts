import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addPasskey } from '../accounts/passkeys'
import { sha256 } from '../shared/bytes'
import { META, b64, newAccount, testDeps } from '../testing'
import type { Deps } from '../deps'
import { resetRateLimits } from './ratelimit'
import { findSession } from './sessions'
import { issuePasskeyChallenge, passkeyLogin } from './passkey-login'

const ORIGIN = 'http://localhost:3000'
const u = (b: Uint8Array) => Buffer.from(b).toString('base64url')

type Alg = -7 | -8 | -257
function keyPair(alg: Alg = -7) {
  if (alg === -8) return generateKeyPairSync('ed25519')
  if (alg === -257) return generateKeyPairSync('rsa', { modulusLength: 2048 })
  return generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

/** Baut eine Assertion so, wie ein Authenticator sie liefert. */
function assertion(
  o: { credentialId: string; key: KeyObject; alg?: Alg; challenge: string; accountId?: string },
  over: { origin?: string; rpId?: string; flags?: number; counter?: number; type?: string } = {}
) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.get', challenge: o.challenge, origin: over.origin ?? ORIGIN, crossOrigin: false }))
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(over.counter ?? 0)
  const authData = Buffer.concat([sha256(over.rpId ?? 'localhost'), Buffer.from([over.flags ?? 0x05]), counter])
  const data = Buffer.concat([authData, sha256(clientDataJSON)])
  const alg = o.alg ?? -7
  const signature = alg === -8 ? sign(null, data, o.key) : sign('sha256', data, o.key)
  return {
    credentialId: o.credentialId,
    clientDataJSON: u(clientDataJSON),
    authenticatorData: u(authData),
    signature: u(signature),
    userHandle: o.accountId ? u(Buffer.from(o.accountId)) : undefined
  }
}

async function setup(deps: Deps, email = 'pk-login@example.com', alg: Alg = -7) {
  const { session } = await newAccount(deps, email)
  const { publicKey, privateKey } = keyPair(alg)
  const credentialId = b64(32)
  await addPasskey(deps, session, {
    credentialId,
    label: 'Mac · Safari',
    salt: b64(32),
    iv: b64(12),
    cipher: b64(48),
    publicKey: u(publicKey.export({ format: 'der', type: 'spki' })),
    publicKeyAlg: alg
  })
  const login = async (over: Parameters<typeof assertion>[1] = {}, key = privateKey) =>
    passkeyLogin(deps, assertion({ credentialId, key, alg, challenge: await issuePasskeyChallenge(deps), accountId: session.accountId }, over), [ORIGIN], META)
  return { session, credentialId, privateKey, login }
}

describe('Anmelden per Passkey (WebAuthn)', () => {
  beforeEach(() => resetRateLimits())

  it('gültige Assertion → Session (nicht „stark“), Kontoansicht mit Anmelde-Passkey', async () => {
    const deps = await testDeps()
    const { session, credentialId, login } = await setup(deps)
    const r = await login()
    expect(r.view.id).toBe(session.accountId)
    expect(r.view.passkeys).toEqual([expect.objectContaining({ credentialId, login: true })])
    const s = await findSession(deps.db, r.token)
    expect(s?.accountId).toBe(session.accountId)
    expect(s?.strongAuthAt).toBe(0)
    const events = await deps.db.query<{ kind: string }>(`SELECT kind FROM audit_events WHERE account_id = $1`, [session.accountId])
    expect(events.map(e => e.kind)).toContain('auth.passkey_login')
  })

  it('EdDSA und RS256 werden unterstützt', async () => {
    const deps = await testDeps()
    await expect((await setup(deps, 'ed@example.com', -8)).login()).resolves.toHaveProperty('token')
    await expect((await setup(deps, 'rsa@example.com', -257)).login()).resolves.toHaveProperty('token')
  })

  it('fremde Origin bzw. fremde rpId werden abgelehnt', async () => {
    const deps = await testDeps()
    const { login } = await setup(deps)
    await expect(login({ origin: 'https://evil.example' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(login({ rpId: 'evil.example' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(login({ type: 'webauthn.create' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('Challenge ist nur einmal gültig (kein Replay), unbekannte Challenge abgelehnt', async () => {
    const deps = await testDeps()
    const { session, credentialId, privateKey } = await setup(deps)
    const a = assertion({ credentialId, key: privateKey, challenge: await issuePasskeyChallenge(deps), accountId: session.accountId })
    await passkeyLogin(deps, a, [ORIGIN], META)
    await expect(passkeyLogin(deps, a, [ORIGIN], META)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const forged = assertion({ credentialId, key: privateKey, challenge: b64(32) })
    await expect(passkeyLogin(deps, forged, [ORIGIN], META)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('falsche Signatur und unbekannter Passkey: gleiche Antwort', async () => {
    const deps = await testDeps()
    const { session, login } = await setup(deps)
    const err = await login({}, keyPair().privateKey).catch(e => e)
    expect(err).toMatchObject({ code: 'INVALID_CREDENTIALS' })
    const unknown = assertion({ credentialId: b64(32), key: keyPair().privateKey, challenge: await issuePasskeyChallenge(deps) })
    const err2 = await passkeyLogin(deps, unknown, [ORIGIN], META).catch(e => e)
    expect(err2).toMatchObject({ code: 'INVALID_CREDENTIALS', message: err.message })
    // fremdes userHandle (anderes Konto) wird ebenfalls abgelehnt
    const other = await setup(deps, 'other@example.com')
    const swapped = assertion({ credentialId: other.credentialId, key: other.privateKey, challenge: await issuePasskeyChallenge(deps), accountId: session.accountId })
    await expect(passkeyLogin(deps, swapped, [ORIGIN], META)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('ohne User Verification (nur UP) abgelehnt', async () => {
    const deps = await testDeps()
    const { login } = await setup(deps)
    await expect(login({ flags: 0x01 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Signaturzähler muss steigen, sobald er genutzt wird', async () => {
    const deps = await testDeps()
    const { login } = await setup(deps)
    await login({ counter: 5 })
    await login({ counter: 6 })
    await expect(login({ counter: 6 })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(login({ counter: 0 })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('gesperrtes Konto und Passkey eines entfernten Schlüssels werden abgelehnt', async () => {
    const deps = await testDeps()
    const { session, login } = await setup(deps)
    await deps.db.query(`UPDATE accounts SET status = 'suspended' WHERE id = $1`, [session.accountId])
    await expect(login()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await deps.db.query(`UPDATE accounts SET status = 'active' WHERE id = $1`, [session.accountId])
    await deps.db.query(`UPDATE account_keys SET revoked_at = now() WHERE account_id = $1 AND kek_type = 'passkey'`, [session.accountId])
    await expect(login()).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })
})

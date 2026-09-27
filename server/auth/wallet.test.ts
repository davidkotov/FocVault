import { beforeEach, describe, expect, it } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { walletRegisterSchema } from '../accounts/schemas'
import { resetRateLimits } from './ratelimit'
import { findSession } from './sessions'
import { issueNonce, recoveryWithSession, registerWithWallet, walletLogin } from './wallet'
import { META, b64, kdf, testDeps } from '../testing'
import type { Deps } from '../deps'

const ORIGIN = 'http://localhost:3000'

async function signIn(deps: Deps, account = privateKeyToAccount(generatePrivateKey()), over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  const nonce = await issueNonce(deps)
  const message = createSiweMessage({
    domain: 'localhost:3000',
    uri: ORIGIN,
    address: account.address,
    chainId: 314159,
    nonce,
    version: '1',
    issuedAt: new Date(),
    ...over
  })
  const signature = await account.signMessage({ message })
  return { account, message, signature }
}

function registration(token: string, recoveryAuthKey = b64(32)) {
  return walletRegisterSchema.parse({
    registrationToken: token,
    label: 'anna@gmail.com',
    authKey: b64(32),
    recoveryAuthKey,
    kdf: kdf(),
    envelopes: [
      { kekType: 'passphrase', iv: b64(12), cipher: b64(48) },
      { kekType: 'recovery', iv: b64(12), cipher: b64(48) }
    ]
  })
}

describe('Wallet-Login (Reown / SIWE)', () => {
  beforeEach(() => resetRateLimits())

  it('neue Adresse → Registrierung → nächster Login erkennt das Konto', async () => {
    const deps = await testDeps()
    const first = await signIn(deps)
    const r1 = await walletLogin(deps, first, [ORIGIN], META)
    expect(r1.status).toBe('new')
    if (r1.status !== 'new') return
    expect(r1.address).toBe(first.account.address)

    const reg = await registerWithWallet(deps, registration(r1.registrationToken), META)
    expect(reg.view.email).toBeNull()
    expect(reg.view.label).toBe('anna@gmail.com')
    expect(reg.view.wallets).toEqual([first.account.address.toLowerCase()])

    const again = await signIn(deps, first.account)
    const r2 = await walletLogin(deps, again, [ORIGIN], META)
    expect(r2.status).toBe('existing')
    if (r2.status === 'existing') expect(r2.auth.view.id).toBe(reg.view.id)

    await expect(registerWithWallet(deps, registration(r1.registrationToken), META)).rejects.toMatchObject({
      code: 'ALREADY_REGISTERED'
    })
  })

  it('Nonce ist nur einmal gültig (kein Replay)', async () => {
    const deps = await testDeps()
    const s = await signIn(deps)
    await walletLogin(deps, s, [ORIGIN], META)
    await expect(walletLogin(deps, s, [ORIGIN], META)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('fremde Domain, falsches Netz, alte Nachricht und gefälschte Signatur werden abgelehnt', async () => {
    const deps = await testDeps()
    const phishing = await signIn(deps, undefined, { domain: 'evil.example', uri: 'https://evil.example' })
    await expect(walletLogin(deps, phishing, [ORIGIN], META)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const mainnet = await signIn(deps, undefined, { chainId: 1 })
    await expect(walletLogin(deps, mainnet, [ORIGIN], META)).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    const old = await signIn(deps, undefined, { issuedAt: new Date(Date.now() - 60 * 60_000) })
    await expect(walletLogin(deps, old, [ORIGIN], META)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const victim = await signIn(deps)
    const attacker = privateKeyToAccount(generatePrivateKey())
    const forged = { message: victim.message, signature: await attacker.signMessage({ message: victim.message }) }
    await expect(walletLogin(deps, forged, [ORIGIN], META)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('manipuliertes Registrierungs-Token wird abgelehnt', async () => {
    const deps = await testDeps()
    const r = await walletLogin(deps, await signIn(deps), [ORIGIN], META)
    if (r.status !== 'new') throw new Error('erwartet: new')
    const other = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    const tampered = [other, ...r.registrationToken.split('.').slice(1)].join('.')
    await expect(registerWithWallet(deps, registration(tampered), META)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Recovery mit Session: nur mit dem richtigen Kit, liefert das Recovery-Envelope', async () => {
    const deps = await testDeps()
    const r = await walletLogin(deps, await signIn(deps), [ORIGIN], META)
    if (r.status !== 'new') throw new Error('erwartet: new')
    const recoveryKey = b64(32)
    const reg = await registerWithWallet(deps, registration(r.registrationToken, recoveryKey), META)
    const session = (await findSession(deps.db, reg.token))!
    await expect(recoveryWithSession(deps, session, { recoveryAuthKey: b64(32) })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    })
    const view = await recoveryWithSession(deps, session, { recoveryAuthKey: recoveryKey })
    expect(view.envelopes.map(e => e.kekType).sort()).toEqual(['passphrase', 'recovery'])
  })
})

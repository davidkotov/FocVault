import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { newAccount, testDeps } from '../testing'
import { accountView } from './service'
import { addPasskey, removePasskey } from './passkeys'

const b64 = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url')
const input = () => ({ credentialId: b64(32), label: 'Mac · Safari', salt: b64(32), iv: b64(12), cipher: b64(48) })
const spki = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')

describe('Passkeys (alle Pakete)', () => {
  beforeEach(() => resetRateLimits())

  it('auch mit Free: hinzufügen, doppelt abgelehnt, entfernen', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'passkey@example.com')
    expect((await accountView(deps, session.accountId)).plan).toBe('free')
    const pk = input()
    await addPasskey(deps, session, pk)
    await expect(addPasskey(deps, session, pk)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const view = await accountView(deps, session.accountId)
    expect(view.passkeys).toEqual([
      expect.objectContaining({ credentialId: pk.credentialId, label: 'Mac · Safari', salt: pk.salt, iv: pk.iv, cipher: pk.cipher, login: false })
    ])
    // Passkey-Envelopes gehören nicht zu den Passphrase-Envelopes
    expect(view.envelopes.map(e => e.kekType)).toEqual(['passphrase'])

    await removePasskey(deps, session, pk.credentialId)
    expect((await accountView(deps, session.accountId)).passkeys).toEqual([])
    await expect(removePasskey(deps, session, pk.credentialId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Anmelde-Passkey (mit öffentlichem Schlüssel): frische Bestätigung nötig, Schlüssel geprüft, Credential-ID kontoübergreifend eindeutig', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'pk-free@example.com')
    const pk = { ...input(), publicKey: spki(), publicKeyAlg: -7 }
    await expect(addPasskey(deps, { ...session, strongAuthAt: 0 }, pk)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    await expect(addPasskey(deps, session, { ...pk, publicKeyAlg: -8 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(addPasskey(deps, session, { ...pk, publicKey: b64(64) })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await addPasskey(deps, session, pk)
    expect((await accountView(deps, session.accountId)).passkeys).toEqual([expect.objectContaining({ credentialId: pk.credentialId, login: true })])

    const other = await newAccount(deps, 'pk-other@example.com')
    await expect(addPasskey(deps, other.session, { ...input(), credentialId: pk.credentialId, publicKey: spki(), publicKeyAlg: -7 })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
  })
})

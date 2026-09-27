import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { newAccount, testDeps } from '../testing'
import { accountView } from './service'
import { addPasskey, removePasskey } from './passkeys'

const b64 = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url')
const input = () => ({ credentialId: b64(32), label: 'Mac · Safari', salt: b64(32), iv: b64(12), cipher: b64(48) })

describe('Passkeys (Pro/Family)', () => {
  beforeEach(() => resetRateLimits())

  it('nur mit Abo; hinzufügen, doppelt abgelehnt, entfernen; bei Free ausgeblendet', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'passkey@example.com')
    const pk = input()
    await expect(addPasskey(deps, session, pk)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })

    await deps.db.query(`UPDATE accounts SET plan = 'pro' WHERE id = $1`, [session.accountId])
    await addPasskey(deps, session, pk)
    await expect(addPasskey(deps, session, pk)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const view = await accountView(deps, session.accountId)
    expect(view.passkeys).toEqual([expect.objectContaining({ credentialId: pk.credentialId, label: 'Mac · Safari', salt: pk.salt, iv: pk.iv, cipher: pk.cipher })])
    // Passkey-Envelopes gehören nicht zu den Passphrase-Envelopes
    expect(view.envelopes.map(e => e.kekType)).toEqual(['passphrase'])

    await deps.db.query(`UPDATE accounts SET plan = 'free' WHERE id = $1`, [session.accountId])
    expect((await accountView(deps, session.accountId)).passkeys).toEqual([])
    await deps.db.query(`UPDATE accounts SET plan = 'pro' WHERE id = $1`, [session.accountId])

    await removePasskey(deps, session, pk.credentialId)
    expect((await accountView(deps, session.accountId)).passkeys).toEqual([])
    await expect(removePasskey(deps, session, pk.credentialId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

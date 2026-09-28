import { describe, expect, it } from 'vitest'
import { newAccount, testDeps } from '../testing'
import { deleteAccount } from './delete'
import { completeObject, createObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { findSession } from '../auth/sessions'

describe('Konto löschen', () => {
  it('nur mit richtiger Passphrase, löscht Speicher und Konto; Abo blockiert', async () => {
    const deps = await testDeps()
    const { session, input, result } = await newAccount(deps, 'weg@example.com')
    const created = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 100 }] })
    const key = objectPieceKey(session.accountId, created.objectId, 0)
    await deps.storage.writeStream(key, new Blob([new Uint8Array(100)]).stream(), 100)
    await completeObject(deps, session, created.objectId)

    await expect(deleteAccount(deps, session, { kind: 'passphrase', authKey: input.recoveryAuthKey, confirm: 'DELETE' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })

    await deps.db.query(`UPDATE accounts SET stripe_subscription_id = 'sub_1' WHERE id = $1`, [session.accountId])
    await expect(deleteAccount(deps, session, { kind: 'passphrase', authKey: input.authKey, confirm: 'DELETE' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await deps.db.query(`UPDATE accounts SET stripe_subscription_id = NULL WHERE id = $1`, [session.accountId])

    const r = await deleteAccount(deps, session, { kind: 'recovery', authKey: input.recoveryAuthKey, confirm: 'DELETE' })
    expect(r.deletedObjects).toBe(1)
    expect(await deps.db.query('SELECT id FROM accounts WHERE id = $1', [session.accountId])).toHaveLength(0)
    expect(await findSession(deps.db, result.token)).toBeNull()
    expect(await deps.storage.head(key)).toBeNull()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { changePlan } from '../billing/service'
import { completeObject, createObject, deleteObject, downloadObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { createInvite, joinFamily, removeMember } from './service'
import { getSpaceIndex, grantSpaceKeys, putSpaceIndex, setPublicKey, spaceState } from './space'

const b64 = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url')
const jwk = () => ({ kty: 'EC' as const, crv: 'P-256' as const, x: b64(32), y: b64(32) })
const wrapped = () => ({ epk: jwk(), iv: b64(12), ct: b64(48) })
const bytes = (n: number) => new Blob([new Uint8Array(n)]).stream()

describe('Familienordner (Server)', () => {
  beforeEach(() => resetRateLimits())

  it('Schlüssel-Generationen, gemeinsamer Index, Zugriff nur für Mitglieder, Rotation nach dem Entfernen', async () => {
    const deps = await testDeps()
    const { session: owner } = await newAccount(deps, 'eltern@example.com')
    const { session: kid } = await newAccount(deps, 'kind@example.com')
    const { session: stranger } = await newAccount(deps, 'fremd@example.com')
    await expect(spaceState(deps, owner)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await changePlan(deps, owner, { plan: 'family', interval: 'month', currency: 'CHF' })
    await joinFamily(deps, kid, (await createInvite(deps, owner)).token)
    await setPublicKey(deps, owner, jwk())
    await setPublicKey(deps, kid, jwk())

    // Nur der Inhaber legt Generation 1 an, und nur mit eigener Hülle
    await expect(grantSpaceKeys(deps, kid, { generation: 1, grants: [{ accountId: kid.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(grantSpaceKeys(deps, owner, { generation: 1, grants: [{ accountId: stranger.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await grantSpaceKeys(deps, owner, { generation: 1, grants: [{ accountId: owner.accountId, wrapped: wrapped() }] })
    // Mitglied ohne Hülle darf nicht weiterverteilen; der Inhaber schon
    await expect(grantSpaceKeys(deps, kid, { generation: 1, grants: [{ accountId: kid.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await grantSpaceKeys(deps, owner, { generation: 1, grants: [{ accountId: kid.accountId, wrapped: wrapped() }] })
    const st = await spaceState(deps, kid)
    expect(st).toMatchObject({ generation: 1, isOwner: false, rotateNeeded: false })
    expect(st.myKeys).toHaveLength(1)

    // Index mit optimistischem Locking
    expect(await getSpaceIndex(deps, kid)).toBeNull()
    expect((await putSpaceIndex(deps, kid, 0, new Uint8Array(40))).version).toBe(1)
    await expect(putSpaceIndex(deps, owner, 0, new Uint8Array(40))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect((await getSpaceIndex(deps, owner))?.version).toBe(1)
    await expect(getSpaceIndex(deps, stranger)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })

    // Kind lädt in den Familienordner → Inhaber kann laden, Fremde nicht
    const c = await createObject(deps, kid, { fmt: 'frame2', space: true, pieces: [{ index: 0, cipherBytes: 300 }] })
    await deps.storage.writeStream(objectPieceKey(kid.accountId, c.objectId, 0), bytes(300), 300)
    await completeObject(deps, kid, c.objectId)
    expect((await downloadObject(deps, owner, c.objectId)).pieces).toHaveLength(1)
    await expect(downloadObject(deps, stranger, c.objectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(createObject(deps, stranger, { fmt: 'frame2', space: true, pieces: [{ index: 0, cipherBytes: 1 }] })).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })

    // Entfernen: Datei geht an den Inhaber, Kind hat keinen Zugriff mehr, neue Generation vorgemerkt
    await removeMember(deps, owner, kid.accountId)
    await expect(downloadObject(deps, kid, c.objectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await deps.db.query('SELECT owner_account_id FROM objects WHERE id = $1', [c.objectId]))[0].owner_account_id).toBe(owner.accountId)
    const after = await spaceState(deps, owner)
    expect(after.rotateNeeded).toBe(true)
    expect(after.members.map(m => m.accountId)).toEqual([owner.accountId])
    await grantSpaceKeys(deps, owner, { generation: 2, grants: [{ accountId: owner.accountId, wrapped: wrapped() }] })
    expect((await spaceState(deps, owner)).rotateNeeded).toBe(false)

    // Inhaber löscht die Datei aus dem Familienordner
    await deleteObject(deps, owner, c.objectId)
  })
})

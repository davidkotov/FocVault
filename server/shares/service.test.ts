import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { completeObject, createObject, deleteObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { createShare, listShares, publicShare, revokeShare, startShareDownload } from './service'

const meta = Buffer.from('verschluesselte-metadaten-0123456789').toString('base64')

async function storedFile(deps: Awaited<ReturnType<typeof testDeps>>, email: string) {
  const { session } = await newAccount(deps, email)
  const created = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 100 }] })
  await deps.storage.writeStream(objectPieceKey(session.accountId, created.objectId, 0), new Blob([new Uint8Array(100)]).stream(), 100)
  await completeObject(deps, session, created.objectId)
  return { session, objectId: created.objectId }
}

describe('Secure Send (Konto-Modus)', () => {
  beforeEach(() => resetRateLimits())

  it('Einmal-Link: öffentlich lesbar, genau ein Download, danach ungültig', async () => {
    const deps = await testDeps()
    const { session, objectId } = await storedFile(deps, 'send@example.com')
    const share = await createShare(deps, session, { objectId, meta, expiresInHours: 24, maxDownloads: 1 })
    expect(share.active).toBe(true)
    expect(share.id).toMatch(/^[A-Za-z0-9_-]{22}$/)

    const pub = await publicShare(deps, share.id)
    expect(pub).toMatchObject({ objectId, meta, remaining: 1 })
    const dl = await startShareDownload(deps, share.id)
    expect(dl.pieces).toHaveLength(1)
    await expect(startShareDownload(deps, share.id)).rejects.toMatchObject({ code: 'GONE' })
    await expect(publicShare(deps, share.id)).rejects.toMatchObject({ code: 'GONE' })
    expect((await listShares(deps, session))[0]).toMatchObject({ downloads: 1, active: false })
  })

  it('Widerrufen und Löschen der Datei machen den Link ungültig', async () => {
    const deps = await testDeps()
    const { session, objectId } = await storedFile(deps, 'rev@example.com')
    const a = await createShare(deps, session, { objectId, meta, expiresInHours: null, maxDownloads: null })
    const b = await createShare(deps, session, { objectId, meta, expiresInHours: null, maxDownloads: null })
    await revokeShare(deps, session, a.id)
    await expect(publicShare(deps, a.id)).rejects.toMatchObject({ code: 'GONE' })
    expect((await publicShare(deps, b.id)).remaining).toBeNull()
    await deleteObject(deps, session, objectId)
    await expect(publicShare(deps, b.id)).rejects.toMatchObject({ code: 'GONE' })
  })

  it('fremde Dateien lassen sich nicht teilen, unbekannte IDs sind 404', async () => {
    const deps = await testDeps()
    const { objectId } = await storedFile(deps, 'owner@example.com')
    const { session: other } = await newAccount(deps, 'other@example.com')
    await expect(createShare(deps, other, { objectId, meta, expiresInHours: 1, maxDownloads: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(publicShare(deps, 'x'.repeat(22))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(publicShare(deps, '../etc')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

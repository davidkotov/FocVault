import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { usedBytes } from '../accounts/plans'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import {
  MAX_PIECE_CIPHER_BYTES,
  completeObject,
  createObject,
  createObjectSchema,
  deleteObject,
  downloadObject
} from './service'

const bytes = (n: number) => new Blob([new Uint8Array(n)]).stream()

describe('Objekte & Quota', () => {
  beforeEach(() => resetRateLimits())

  it('Lebenszyklus: anlegen → hochladen → abschließen → herunterladen → löschen', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'a@example.com')
    const created = await createObject(deps, session, {
      fmt: 'frame2',
      pieces: [
        { index: 0, cipherBytes: 1000 },
        { index: 1, cipherBytes: 500 }
      ]
    })
    expect(created.pieces.map(p => p.index)).toEqual([0, 1])
    expect(await usedBytes(deps.db, session.accountId)).toBe(1500)

    await expect(completeObject(deps, session, created.objectId)).rejects.toMatchObject({
      code: 'UPLOAD_SIZE_MISMATCH'
    })

    const k0 = objectPieceKey(session.accountId, created.objectId, 0)
    const k1 = objectPieceKey(session.accountId, created.objectId, 1)
    await deps.storage.writeStream(k0, bytes(1000), 1000)
    await expect(deps.storage.writeStream(k1, bytes(499), 500)).rejects.toMatchObject({ code: 'UPLOAD_SIZE_MISMATCH' })
    await deps.storage.writeStream(k1, bytes(500), 500)

    expect(await completeObject(deps, session, created.objectId)).toEqual({ state: 'stored', cipherBytes: 1500 })
    expect(await completeObject(deps, session, created.objectId)).toEqual({ state: 'stored', cipherBytes: 1500 })

    const dl = await downloadObject(deps, session, created.objectId)
    expect(dl.pieces.map(p => [p.index, p.cipherBytes])).toEqual([
      [0, 1000],
      [1, 500]
    ])

    await deleteObject(deps, session, created.objectId)
    expect(deps.storage.objects.size).toBe(0)
    expect(await usedBytes(deps.db, session.accountId)).toBe(0)
    await expect(downloadObject(deps, session, created.objectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const ledger = await deps.db.query<{ reason: string; delta: number }>(
      'SELECT reason, delta_bytes::float8 AS delta FROM usage_ledger ORDER BY id'
    )
    expect(ledger).toEqual([
      { reason: 'store', delta: 1500 },
      { reason: 'delete', delta: -1500 }
    ])
  })

  it('Quota zählt Ciphertext inkl. laufender Uploads und verhindert Überbuchung', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'b@example.com')
    const pieces = (n: number) => Array.from({ length: n }, (_, index) => ({ index, cipherBytes: MAX_PIECE_CIPHER_BYTES }))

    // 161 volle Pieces ≈ 5,40 GB > 5 GiB Free-Quota
    await expect(createObject(deps, session, { fmt: 'frame2', pieces: pieces(161) })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED'
    })
    // 100 Pieces passen – und bleiben reserviert, solange der Upload läuft
    await createObject(deps, session, { fmt: 'frame2', pieces: pieces(100) })
    await expect(createObject(deps, session, { fmt: 'frame2', pieces: pieces(100) })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: { neededBytes: 100 * MAX_PIECE_CIPHER_BYTES }
    })
  })

  it('fremde Objekte sind nicht sichtbar', async () => {
    const deps = await testDeps()
    const owner = await newAccount(deps, 'owner@example.com')
    const intruder = await newAccount(deps, 'intruder@example.com')
    const created = await createObject(deps, owner.session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 10 }] })
    for (const call of [completeObject, downloadObject, deleteObject]) {
      await expect(call(deps, intruder.session, created.objectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    await expect(downloadObject(deps, intruder.session, 'kein-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Schema: Pieces lückenlos ab 0 und nicht größer als ein volles Piece', () => {
    expect(createObjectSchema.safeParse({ fmt: 'frame2', pieces: [{ index: 1, cipherBytes: 5 }] }).success).toBe(false)
    expect(
      createObjectSchema.safeParse({ fmt: 'frame2', pieces: [{ index: 0, cipherBytes: MAX_PIECE_CIPHER_BYTES + 1 }] })
        .success
    ).toBe(false)
    expect(createObjectSchema.safeParse({ fmt: 'frame', pieces: [{ index: 0, cipherBytes: 5 }] }).success).toBe(false)
    expect(createObjectSchema.safeParse({ fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 5 }] }).success).toBe(true)
  })
})

describe('Papierkorb (Pro/Family)', () => {
  beforeEach(() => resetRateLimits())

  it('Free löscht sofort, Pro legt in den Papierkorb – belegt weiter Speicher, wiederherstellbar, läuft ab', async () => {
    const { trashObject, restoreObject, listTrash, purgeExpiredTrash } = await import('./service')
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'trash@example.com')
    const created = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 400 }] })
    const key = objectPieceKey(session.accountId, created.objectId, 0)
    await deps.storage.writeStream(key, bytes(400), 400)
    await completeObject(deps, session, created.objectId)

    await expect(trashObject(deps, session, created.objectId)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await deps.db.query(`UPDATE accounts SET plan = 'pro' WHERE id = $1`, [session.accountId])

    const item = await trashObject(deps, session, created.objectId)
    expect(new Date(item.purgeAfter).getTime() - Date.now()).toBeGreaterThan(29 * 86400_000)
    expect(await usedBytes(deps.db, session.accountId)).toBe(400)
    await expect(downloadObject(deps, session, created.objectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listTrash(deps, session)).map(t => t.objectId)).toEqual([created.objectId])

    await restoreObject(deps, session, created.objectId)
    expect((await downloadObject(deps, session, created.objectId)).pieces).toHaveLength(1)
    expect(await listTrash(deps, session)).toEqual([])

    await trashObject(deps, session, created.objectId)
    expect(await purgeExpiredTrash(deps)).toBe(0)
    await deps.db.query(`UPDATE objects SET purge_after = now() - interval '1 minute' WHERE id = $1`, [created.objectId])
    expect(await purgeExpiredTrash(deps)).toBe(1)
    expect(await usedBytes(deps.db, session.accountId)).toBe(0)
    expect(await deps.storage.head(key)).toBeNull()
    await expect(restoreObject(deps, session, created.objectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Dateiversionen (Pro/Family)', () => {
  beforeEach(() => resetRateLimits())

  it('alte Fassung bleibt als Version, lässt sich zurückholen und läuft ab', async () => {
    const { keepAsVersion, promoteVersion, listVersions, purgeExpiredTrash } = await import('./service')
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'versions@example.com')
    const store = async (n: number) => {
      const c = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: n }] })
      await deps.storage.writeStream(objectPieceKey(session.accountId, c.objectId, 0), bytes(n), n)
      await completeObject(deps, session, c.objectId)
      return c.objectId
    }
    const v1 = await store(100)
    const v2 = await store(200)
    await expect(keepAsVersion(deps, session, v1)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await deps.db.query(`UPDATE accounts SET plan = 'family' WHERE id = $1`, [session.accountId])

    await keepAsVersion(deps, session, v1)
    expect(await usedBytes(deps.db, session.accountId)).toBe(300) // Versionen zählen zur Quota
    expect((await listVersions(deps, session)).map(v => v.objectId)).toEqual([v1])
    await expect(downloadObject(deps, session, v1)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await promoteVersion(deps, session, v1, v2)
    expect((await downloadObject(deps, session, v1)).pieces).toHaveLength(1)
    expect((await listVersions(deps, session)).map(v => v.objectId)).toEqual([v2])

    await deps.db.query(`UPDATE objects SET purge_after = now() - interval '1 second' WHERE id = $1`, [v2])
    expect(await purgeExpiredTrash(deps)).toBe(1)
    expect(await usedBytes(deps.db, session.accountId)).toBe(100)
  })
})

describe('Große Dateien', () => {
  beforeEach(() => resetRateLimits())

  it('bis 5 TiB anmeldbar; Upload-URLs kommen in Etappen', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'gross@example.com')
    await deps.db.query(`UPDATE accounts SET plan = 'business' WHERE id = $1`, [session.accountId])
    const pieces = Array.from({ length: 20_000 }, (_, index) => ({ index, cipherBytes: MAX_PIECE_CIPHER_BYTES }))
    const input = createObjectSchema.parse({ fmt: 'frame2', pieces })
    const created = await createObject(deps, session, input)
    expect(created.pieces).toHaveLength(64)
    const { refreshUploadUrls } = await import('./service')
    const more = await refreshUploadUrls(deps, session, created.objectId, [19_999])
    expect(more.pieces[0].index).toBe(19_999)
  })
})

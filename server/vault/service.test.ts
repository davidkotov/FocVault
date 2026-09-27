import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { newAccount, testDeps } from '../testing'
import { MAX_INDEX_BYTES, getIndex, putIndex } from './service'

const blob = (fill: number, n = 100) => new Uint8Array(n).fill(fill)

describe('Tresor-Index', () => {
  beforeEach(() => resetRateLimits())

  it('Versionierung mit optimistischem Locking und Aufräumen alter Versionen', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'idx@example.com')
    const id = session.accountId

    expect(await getIndex(deps, id)).toBeNull()
    expect(await putIndex(deps, id, 0, blob(1))).toEqual({ version: 1 })
    await expect(putIndex(deps, id, 0, blob(2))).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 1 }
    })

    for (let v = 1; v < 8; v++) await putIndex(deps, id, v, blob(v + 1))
    const latest = await getIndex(deps, id)
    expect(latest?.version).toBe(8)
    expect(Array.from(latest!.body.slice(0, 3))).toEqual([8, 8, 8])

    const rows = await deps.db.query<{ v: number }>(
      'SELECT version::float8 AS v FROM vault_indexes WHERE account_id = $1 ORDER BY version',
      [id]
    )
    expect(rows.map(r => r.v)).toEqual([4, 5, 6, 7, 8])
    expect([...deps.storage.objects.keys()].filter(k => k.includes('/idx/'))).toHaveLength(5)
  })

  it('lehnt zu kleine und zu große Blobs sowie ungültige Basis-Versionen ab', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'idx2@example.com')
    await expect(putIndex(deps, session.accountId, 0, blob(1, 10))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(putIndex(deps, session.accountId, 0, new Uint8Array(MAX_INDEX_BYTES + 1))).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE'
    })
    await expect(putIndex(deps, session.accountId, -1, blob(1))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

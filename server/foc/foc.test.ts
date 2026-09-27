import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { completeObject, createObject, deleteObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { DEFAULT_FOC, openSecret, sealSecret, setFocSettings } from './config'
import { evaluateHealth } from './health'
import { FocBackedProvider } from './provider'
import { runFocSync, type FocBackend, type PackCopy } from './sync'
import { filecoinStatus } from './proofs'
import type { FocChainStatus } from './chain'

/** Attrappe eines Filecoin-Anbieters: liefert gespeicherte Pakete mit HTTP-Range aus. */
const packs = new Map<string, Uint8Array>()
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const data = packs.get(req.url!.slice(1))
    if (!data) return void res.writeHead(404).end()
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
    if (!m) return void res.writeHead(200).end(Buffer.from(data))
    const [start, end] = [Number(m[1]), Number(m[2])]
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}` }).end(Buffer.from(data.subarray(start, end + 1)))
  })
  await new Promise<void>(r => server.listen(0, 'localhost', r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

function fakeBackend() {
  const removed: PackCopy[] = []
  let n = 0
  const backend: FocBackend = {
    async upload(pack) {
      const cid = `bafkzcibfake${++n}`
      packs.set(cid, pack.slice())
      return {
        pieceCid: cid,
        copies: ['1', '2'].map(p => ({ providerId: p, dataSetId: `10${p}`, pieceId: String(n), role: p === '1' ? 'primary' : 'secondary', retrievalUrl: `${base}/${cid}` }))
      }
    },
    async removePiece(copy) {
      removed.push(copy)
    }
  }
  return { backend, removed, uploads: () => n }
}

const pattern = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * 31 + seed) & 0xff)
const stream = (b: Uint8Array) => new Blob([b.slice()]).stream()

describe('Filecoin Onchain Cloud', () => {
  beforeEach(() => resetRateLimits())

  it('Session-Key wird verschlüsselt abgelegt', () => {
    const sealed = sealSecret('0xabc')
    expect(sealed).not.toContain('abc')
    expect(openSecret(sealed)).toBe('0xabc')
    expect(() => openSecret(sealed.replace(/.$/, c => (c === 'A' ? 'B' : 'A')))).toThrow()
  })

  it('Ampel: Uploads stoppen, bevor Anbieter löschen dürfen', () => {
    const s = { ...DEFAULT_FOC, enabled: true, warnRunwayDays: 21, blockRunwayDays: 5 }
    const chain = (runwayDays: number | null, debt = 0, authorized = true) =>
      ({
        account: { funds: 10, available: 5, debt, lockup: 5, perMonth: 1, runwayDays, coverageDays: null },
        sessionKey: { address: '0x', authorized, expiresAt: null },
        error: null
      }) as unknown as FocChainStatus
    expect(evaluateHealth(s, chain(90)).level).toBe('ok')
    expect(evaluateHealth(s, chain(10)).level).toBe('warn')
    expect(evaluateHealth(s, chain(3)).level).toBe('critical')
    expect(evaluateHealth(s, chain(90, 1)).level).toBe('critical')
    expect(evaluateHealth(s, chain(90, 0, false)).level).toBe('critical')
    expect(evaluateHealth({ ...s, enabled: false }, chain(0)).level).toBe('off')
  })

  it('bündelt Pieces, liest nach dem Entfernen der schnellen Kopie von Filecoin und räumt Gelöschtes ab', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'foc@example.com')
    const created = await createObject(deps, session, {
      fmt: 'frame2',
      pieces: [
        { index: 0, cipherBytes: 3000 },
        { index: 1, cipherBytes: 700 }
      ]
    })
    const k0 = objectPieceKey(session.accountId, created.objectId, 0)
    const k1 = objectPieceKey(session.accountId, created.objectId, 1)
    const d0 = pattern(3000, 1)
    const d1 = pattern(700, 2)
    await deps.storage.writeStream(k0, stream(d0), 3000)
    await deps.storage.writeStream(k1, stream(d1), 700)
    await completeObject(deps, session, created.objectId)

    const fake = fakeBackend()
    const settings = { ...DEFAULT_FOC, enabled: true, payer: '0x' + '1'.repeat(40), packMinMb: 64, packMaxWaitHours: 6 }
    await setFocSettings(deps.db, settings, session.accountId)

    // klein und frisch → wartet auf mehr Daten
    expect((await runFocSync(deps.db, deps.storage, { backend: fake.backend })).packed).toBeUndefined()
    // „Jetzt sichern“ → ein Paket mit beiden Teilen
    const r = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r.packed).toMatchObject({ keys: 2, bytes: 3700, copies: 2 })
    expect(fake.uploads()).toBe(1)
    expect((await filecoinStatus(deps.db, session.accountId)).objects[created.objectId]).toMatchObject({ copies: 2 })
    expect((await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })).packed).toBeUndefined()

    // schnelle Kopie entfernen → Lesen kommt aus dem Paket (HTTP Range)
    await setFocSettings(deps.db, { ...settings, evictAfterHours: 1 }, session.accountId)
    await deps.db.query(`UPDATE foc_packs SET created_at = now() - interval '2 hours'`)
    expect((await runFocSync(deps.db, deps.storage, { backend: fake.backend })).evicted).toBe(2)
    expect(await deps.storage.head(k1)).toBeNull()
    const provider = new FocBackedProvider(deps.storage, async () => deps.db)
    const read = await provider.readStream(k1)
    expect(read?.size).toBe(700)
    expect(new Uint8Array(await new Response(read!.body).arrayBuffer())).toEqual(d1)
    expect(await provider.head(k0)).toEqual({ size: 3000 })

    // Datei löschen → Paket leer → bei beiden Anbietern entfernen
    await deleteObject(deps, session, created.objectId)
    const del = await runFocSync(deps.db, deps.storage, { backend: fake.backend })
    expect(del.markedDeleted).toBe(2)
    expect(del.removedPacks).toBe(1)
    expect(fake.removed.map(c => c.dataSetId).sort()).toEqual(['101', '102'])
    expect(await provider.readStream(k1)).toBeNull()
    expect((await filecoinStatus(deps.db, session.accountId)).objects).toEqual({})
  })

  it('ausgeschaltet: kein Abgleich, Uploads unbeeinflusst', async () => {
    const deps = await testDeps()
    const fake = fakeBackend()
    const r = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r.ran).toBe(false)
    expect(fake.uploads()).toBe(0)
  })
})

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { completeObject, createObject, deleteObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { DEFAULT_FOC, getFocState, openSecret, sealSecret, setFocSettings } from './config'
import { adminUpdateAccount } from '../billing/service'
import { buySuperSafe, cancelSuperSafe } from '../billing/super-safe'
import { evaluateHealth } from './health'
import { FocBackedProvider } from './provider'
import { runFocSync, type FocBackend, type PackCopy } from './sync'
import { filecoinStatus, proofCertificate } from './proofs'
import { createHash } from 'node:crypto'
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

/** providers = zugelassene Anbieter; zu wenige → Fehler wie beim echten Backend (nichts hochgeladen). */
function fakeBackend(providers = ['1', '2', '3', '4', '5', '6']) {
  const removed: PackCopy[] = []
  const requests: Array<{ copies: number; exclude: string[] }> = []
  let n = 0
  const backend: FocBackend = {
    async upload(pack, opts) {
      requests.push({ copies: opts.copies, exclude: opts.excludeProviderIds })
      const pick = providers.filter(p => !opts.excludeProviderIds.includes(p)).slice(0, opts.copies)
      if (pick.length < opts.copies) throw new Error(`Nur ${pick.length} von ${opts.copies} benötigten Speicheranbietern verfügbar – nichts hochgeladen.`)
      const cid = `bafkzcibfake${++n}`
      packs.set(cid, pack.slice())
      return {
        pieceCid: cid,
        copies: pick.map((p, i) => ({ providerId: p, dataSetId: `10${p}`, pieceId: String(n), role: i === 0 ? 'primary' : 'secondary', retrievalUrl: `${base}/${cid}` }))
      }
    },
    async removePiece(copy) {
      removed.push(copy)
    }
  }
  return { backend, removed, requests, uploads: () => n }
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
    const cert = await proofCertificate(deps.db, session.accountId, created.objectId)
    expect(cert?.pieces.map(p => p.sha256)).toEqual([d0, d1].map(d => createHash('sha256').update(d).digest('hex')))
    expect(cert?.pieces[1].pack).toMatchObject({ offset: 3000, length: 700 })
    expect(cert?.pieces[0].copies[0].explorer).toBe('https://pdp.filecoin.cloud/calibration/dataset/101')
    expect(await proofCertificate(deps.db, '00000000-0000-7000-8000-000000000000', created.objectId)).toBeNull()
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

  it('Netzwechsel Test → Mainnet: alles wird im neuen Netz neu gesichert', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'netz@example.com')
    const c = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 500 }] })
    await deps.storage.writeStream(objectPieceKey(session.accountId, c.objectId, 0), stream(pattern(500, 3)), 500)
    await completeObject(deps, session, c.objectId)
    const fake = fakeBackend()
    const base = { ...DEFAULT_FOC, enabled: true, payer: '0x' + '3'.repeat(40) }
    await setFocSettings(deps.db, { ...base, network: 'calibration' }, session.accountId)
    expect((await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })).packed?.keys).toBe(1)
    await setFocSettings(deps.db, { ...base, network: 'mainnet' }, session.accountId)
    const r = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r.packed?.keys).toBe(1)
    expect((await deps.db.query(`SELECT network, state FROM foc_packs ORDER BY created_at`)).map(p => `${p.network}:${p.state}`)).toEqual(['calibration:removed', 'mainnet:stored'])
  })

  it('Super Safe: Zusatzkopien nach dem Upgrade, für neue Dateien im selben Lauf, Freigabe nach dem Kündigen', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'safe@example.com')
    await adminUpdateAccount(deps, session, session.accountId, { plan: 'pro' })
    const upload = async (seed: number) => {
      const c = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 400 }] })
      await deps.storage.writeStream(objectPieceKey(session.accountId, c.objectId, 0), stream(pattern(400, seed)), 400)
      await completeObject(deps, session, c.objectId)
      return c.objectId
    }
    const a = await upload(7)
    const fake = fakeBackend()
    const foc = { ...DEFAULT_FOC, enabled: true, payer: '0x' + '5'.repeat(40) }
    await setFocSettings(deps.db, foc, session.accountId)

    // ohne Super Safe: nur das Basis-Paket mit 2 Kopien
    const r1 = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r1.packed).toMatchObject({ keys: 1, copies: 2 })
    expect(r1.extra).toBeUndefined()
    expect((await filecoinStatus(deps.db, session.accountId)).objects[a].copies).toBe(2)

    // Upgrade: bestehende Teile bekommen ein Zusatz-Paket mit 3 Kopien bei anderen Anbietern
    await buySuperSafe(deps, { ...session, plan: 'pro' })
    const r2 = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r2.packed).toBeUndefined()
    expect(r2.extra).toMatchObject({ keys: 1, copies: 3, requested: 3 })
    expect(fake.requests.at(-1)).toEqual({ copies: 3, exclude: ['1', '2'] })
    expect((await filecoinStatus(deps.db, session.accountId)).objects[a].copies).toBe(5)
    const cert = await proofCertificate(deps.db, session.accountId, a)
    expect(cert?.pieces[0].copies).toHaveLength(2)
    expect(cert?.pieces[0].extra?.[0].copies.map(c => c.providerId)).toEqual(['3', '4', '5'])

    // neue Datei: Basis- und Zusatz-Paket im selben Lauf (Upload-Sperre ohne Chain kurz umgehen)
    await setFocSettings(deps.db, { ...foc, enabled: false }, session.accountId)
    const b = await upload(8)
    await setFocSettings(deps.db, foc, session.accountId)
    const r3 = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r3.packed).toMatchObject({ keys: 1, copies: 2 })
    expect(r3.extra).toMatchObject({ keys: 1, copies: 3 })
    expect((await filecoinStatus(deps.db, session.accountId)).objects[b].copies).toBe(5)
    expect((await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })).extra).toBeUndefined()

    // Lesen bleibt korrekt (Basis-Paket zuerst)
    const provider = new FocBackedProvider(deps.storage, async () => deps.db)
    expect(await provider.head(objectPieceKey(session.accountId, a, 0))).toEqual({ size: 400 })

    // Kündigen → Zusatzkopien freigeben, Zusatz-Pakete bei den Anbietern entfernen, Basis bleibt
    await cancelSuperSafe(deps, session)
    const r4 = await runFocSync(deps.db, deps.storage, { backend: fake.backend })
    expect(r4.released).toBe(2)
    expect(r4.removedPacks).toBe(2)
    expect(fake.removed.map(c => c.providerId).sort()).toEqual(['3', '3', '4', '4', '5', '5'])
    const st = await filecoinStatus(deps.db, session.accountId)
    expect([st.objects[a].copies, st.objects[b].copies]).toEqual([2, 2])
  })

  it('Super Safe: zu wenige Anbieter → sichtbarer Fehler, angezeigt wird, was wirklich liegt', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'knapp@example.com')
    await adminUpdateAccount(deps, session, session.accountId, { plan: 'family' })
    await buySuperSafe(deps, { ...session, plan: 'family' })
    const c = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 300 }] })
    await deps.storage.writeStream(objectPieceKey(session.accountId, c.objectId, 0), stream(pattern(300, 9)), 300)
    await completeObject(deps, session, c.objectId)
    const fake = fakeBackend(['1', '2', '3', '4'])
    await setFocSettings(deps.db, { ...DEFAULT_FOC, enabled: true, payer: '0x' + '6'.repeat(40) }, session.accountId)
    const r = await runFocSync(deps.db, deps.storage, { backend: fake.backend, force: true })
    expect(r.packed).toMatchObject({ copies: 2 })
    expect(r.extra).toBeUndefined()
    expect(r.message).toContain('Super Safe fehlgeschlagen: Nur 2 von 3')
    expect((await getFocState(deps.db)).lastRun).toMatchObject({ ok: false })
    expect((await filecoinStatus(deps.db, session.accountId)).objects[c.objectId].copies).toBe(2)
  })
})

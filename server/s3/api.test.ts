import { randomBytes } from 'node:crypto'
import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { usedBytes } from '../accounts/plans'
import { resetRateLimits } from '../auth/ratelimit'
import { runFocSync, type FocBackend } from '../foc/sync'
import { newAccount, testDeps } from '../testing'
import { startS3Server } from './protocol'
import { applyS3Retention, createAccessKey, gfsExpired, resolveTenant, s3Overview, updateBucket } from './service'

let deps: Awaited<ReturnType<typeof testDeps>>
let gw: Awaited<ReturnType<typeof startS3Server>>
let s3: S3Client
let accountId = ''

const bytesOf = async (b: any) => Buffer.from(await b.transformToByteArray())

beforeAll(async () => {
  resetRateLimits()
  deps = await testDeps()
  const { session } = await newAccount(deps, 'firma@example.com')
  accountId = session.accountId
  await expect(createAccessKey(deps, session, 'Backup-Server')).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
  await deps.db.query(`UPDATE accounts SET plan = 'business' WHERE id = $1`, [accountId])
  const key = await createAccessKey(deps, session, 'Backup-Server')
  gw = await startS3Server({ port: 0, resolve: ak => resolveTenant(deps, ak) })
  s3 = new S3Client({ endpoint: gw.url, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: key.accessKey, secretAccessKey: key.secretKey } })
})
afterAll(() => gw?.close())

describe('Speicher-API (Business) mit dem AWS-SDK', () => {
  it('große Objekte über mehrere 32-MiB-Teile, Range über Teilgrenzen, zählt zur Quota', async () => {
    await s3.send(new CreateBucketCommand({ Bucket: 'db-backups' }))
    const data = randomBytes(70 * 1024 * 1024) // 3 Teile
    await s3.send(new PutObjectCommand({ Bucket: 'db-backups', Key: 'pg/base-2026-09-27.tar', Body: data }))
    const got = await s3.send(new GetObjectCommand({ Bucket: 'db-backups', Key: 'pg/base-2026-09-27.tar' }))
    expect(Buffer.compare(await bytesOf(got.Body), data)).toBe(0)
    const a = 32 * 1024 * 1024 - 10
    const part = await s3.send(new GetObjectCommand({ Bucket: 'db-backups', Key: 'pg/base-2026-09-27.tar', Range: `bytes=${a}-${a + 99}` }))
    expect(Buffer.compare(await bytesOf(part.Body), data.subarray(a, a + 100))).toBe(0)
    const pieces = await deps.db.query(`SELECT count(*)::int AS n FROM object_pieces op JOIN s3_objects s ON s.object_id = op.object_id WHERE s.key = 'pg/base-2026-09-27.tar'`)
    expect(pieces[0].n).toBe(3)
    expect(await usedBytes(deps.db, accountId)).toBe(data.length)

    // Überschreiben ersetzt und gibt den alten Speicher frei; leere Objekte gehen auch
    await s3.send(new PutObjectCommand({ Bucket: 'db-backups', Key: 'pg/base-2026-09-27.tar', Body: 'klein' }))
    await s3.send(new PutObjectCommand({ Bucket: 'db-backups', Key: 'pg/leer', Body: '' }))
    expect((await s3.send(new HeadObjectCommand({ Bucket: 'db-backups', Key: 'pg/leer' }))).ContentLength).toBe(0)
    expect(await usedBytes(deps.db, accountId)).toBe(5)
  })

  it('Multipart: Teile werden direkt gestreamt und korrekt zusammengesetzt', async () => {
    const p1 = randomBytes(5 * 1024 * 1024)
    const p2 = randomBytes(36 * 1024 * 1024)
    const p3 = randomBytes(777)
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: 'db-backups', Key: 'wal/0001.tar' }))
    const e = []
    for (const [i, body] of [p1, p2, p3].entries()) {
      e.push((await s3.send(new UploadPartCommand({ Bucket: 'db-backups', Key: 'wal/0001.tar', UploadId, PartNumber: i + 1, Body: body }))).ETag)
    }
    const done = await s3.send(
      new CompleteMultipartUploadCommand({ Bucket: 'db-backups', Key: 'wal/0001.tar', UploadId, MultipartUpload: { Parts: e.map((ETag, i) => ({ ETag, PartNumber: i + 1 })) } })
    )
    expect(done.ETag).toMatch(/-3"$/)
    const got = await s3.send(new GetObjectCommand({ Bucket: 'db-backups', Key: 'wal/0001.tar' }))
    expect(Buffer.compare(await bytesOf(got.Body), Buffer.concat([p1, p2, p3]))).toBe(0)
    const list = await s3.send(new ListObjectsV2Command({ Bucket: 'db-backups', Prefix: 'wal/' }))
    expect(list.Contents?.map(c => [c.Key, c.Size])).toEqual([['wal/0001.tar', p1.length + p2.length + p3.length]])
  })

  it('Object Lock: COMPLIANCE schützt auch vor dem Kontoinhaber, GOVERNANCE nur mit Bypass', async () => {
    await s3.send(new CreateBucketCommand({ Bucket: 'worm', ObjectLockEnabledForBucket: true }))
    await s3.send(
      new PutObjectLockConfigurationCommand({
        Bucket: 'worm',
        ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 30 } } }
      })
    )
    expect((await s3.send(new GetObjectLockConfigurationCommand({ Bucket: 'worm' }))).ObjectLockConfiguration?.Rule?.DefaultRetention).toMatchObject({ Mode: 'COMPLIANCE', Days: 30 })
    await s3.send(new PutObjectCommand({ Bucket: 'worm', Key: 'backup.tar', Body: 'wichtig' }))
    const head = await s3.send(new HeadObjectCommand({ Bucket: 'worm', Key: 'backup.tar' }))
    expect(head.ObjectLockMode).toBe('COMPLIANCE')
    await expect(s3.send(new DeleteObjectCommand({ Bucket: 'worm', Key: 'backup.tar' }))).rejects.toMatchObject({ name: 'AccessDenied' })
    await expect(s3.send(new PutObjectCommand({ Bucket: 'worm', Key: 'backup.tar', Body: 'überschrieben' }))).rejects.toMatchObject({ name: 'AccessDenied' })
    await expect(s3.send(new DeleteObjectCommand({ Bucket: 'worm', Key: 'backup.tar', BypassGovernanceRetention: true }))).rejects.toMatchObject({ name: 'AccessDenied' })

    const until = new Date(Date.now() + 86_400_000)
    await s3.send(new PutObjectCommand({ Bucket: 'worm', Key: 'gov.tar', Body: 'x', ObjectLockMode: 'GOVERNANCE', ObjectLockRetainUntilDate: until }))
    await expect(s3.send(new DeleteObjectCommand({ Bucket: 'worm', Key: 'gov.tar' }))).rejects.toMatchObject({ name: 'AccessDenied' })
    await s3.send(new DeleteObjectCommand({ Bucket: 'worm', Key: 'gov.tar', BypassGovernanceRetention: true }))

    // Dashboard: COMPLIANCE-Frist lässt sich nicht verkürzen
    const { session } = { session: { accountId } as never }
    await expect(updateBucket(deps, session, 'worm', { lock: { mode: 'COMPLIANCE', days: 7 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await updateBucket(deps, session, 'worm', { lock: { mode: 'COMPLIANCE', days: 90 } })
  })

  it('Aufbewahrung (GFS) löscht nur überzählige Backups; Übersicht zeigt Buckets und Filecoin-Sicherung', async () => {
    const day = 86_400_000
    const now = new Date('2026-09-27T12:00:00Z')
    const objs = Array.from({ length: 60 }, (_, i) => ({ key: `daily/${i}`, created: new Date(now.getTime() - i * day - 3600_000) }))
    const expired = gfsExpired(objs, { prefix: '', keepDaily: 7, keepWeekly: 0, keepMonthly: 2, keepYearly: 0 }, now)
    expect(objs.length - expired.length).toBe(8) // 7 Tage + 1 weiterer Monatsletzter
    expect(expired).not.toContain('daily/0')

    for (let i = 0; i < 5; i++) await s3.send(new PutObjectCommand({ Bucket: 'db-backups', Key: `restic/snap-${i}`, Body: `s${i}` }))
    await deps.db.query(`UPDATE s3_objects SET created_at = now() - make_interval(days => (substring(key from 'snap-(\\d)')::int) * 2 + 2) WHERE key LIKE 'restic/%'`)
    const session = { accountId } as never
    await updateBucket(deps, session, 'db-backups', { retention: { prefix: 'restic/', keepDaily: 2, keepWeekly: 0, keepMonthly: 0, keepYearly: 0 } })
    const r = await applyS3Retention(deps)
    expect(r.expired).toBe(3)
    const left = await s3.send(new ListObjectsV2Command({ Bucket: 'db-backups', Prefix: 'restic/' }))
    expect(left.Contents?.map(c => c.Key)).toEqual(['restic/snap-0', 'restic/snap-1'])

    // Filecoin: S3-Objekte werden wie alle Objekte gesichert
    const fake: FocBackend = {
      async upload() {
        return { pieceCid: 'bafkfake', copies: [{ providerId: '1', dataSetId: '1', pieceId: '1', role: 'primary', retrievalUrl: 'http://x' }] }
      },
      async removePiece() {}
    }
    const { setFocSettings, DEFAULT_FOC } = await import('../foc/config')
    await setFocSettings(deps.db, { ...DEFAULT_FOC, enabled: true, payer: '0x' + '2'.repeat(40) }, accountId)
    await runFocSync(deps.db, deps.storage, { backend: fake, force: true })
    const ov = await s3Overview(deps, session)
    const b = ov.buckets.find(x => x.name === 'db-backups')!
    expect(b.onFilecoin).toBe(b.objects)
    expect(ov.keys).toHaveLength(1)
  })
})

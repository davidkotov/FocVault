import { randomBytes } from 'node:crypto'
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MemoryS3Store, startS3Server } from './protocol'
import { verifySigV4 } from './sigv4'

const AK = 'FVTESTACCESSKEY0001'
const SK = 'test-secret-key-0123456789abcdefghij'
let gw: Awaited<ReturnType<typeof startS3Server>>
let s3: S3Client

beforeAll(async () => {
  const store = new MemoryS3Store()
  gw = await startS3Server({ resolve: async ak => (ak === AK ? { secret: SK, store } : null), port: 0 })
  // Das offizielle AWS-SDK (inkl. Standard-Prüfsummen/aws-chunked) als Client
  s3 = new S3Client({ endpoint: gw.url, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: AK, secretAccessKey: SK } })
})
afterAll(() => gw.close())

const bytesOf = async (b: any) => Buffer.from(await b.transformToByteArray())

describe('S3-Gateway (mit dem offiziellen AWS-SDK)', () => {
  it('Bucket anlegen, Objekte schreiben, lesen (Range), auflisten mit Ordnern und Seiten', async () => {
    await s3.send(new CreateBucketCommand({ Bucket: 'fotos' }))
    expect((await s3.send(new ListBucketsCommand({}))).Buckets?.map(b => b.Name)).toEqual(['fotos'])

    const data = randomBytes(200_000)
    const put = await s3.send(new PutObjectCommand({ Bucket: 'fotos', Key: '2026/Urlaub am See.jpg', Body: data, ContentType: 'image/jpeg' }))
    expect(put.ETag).toMatch(/^"[0-9a-f]{32}"$/)
    for (let i = 0; i < 5; i++) await s3.send(new PutObjectCommand({ Bucket: 'fotos', Key: `2025/bild-${i}.png`, Body: `png ${i}` }))
    await s3.send(new PutObjectCommand({ Bucket: 'fotos', Key: 'liesmich (ä&ö).txt', Body: 'hallo' }))

    const got = await s3.send(new GetObjectCommand({ Bucket: 'fotos', Key: '2026/Urlaub am See.jpg' }))
    expect(Buffer.compare(await bytesOf(got.Body), data)).toBe(0)
    const part = await s3.send(new GetObjectCommand({ Bucket: 'fotos', Key: '2026/Urlaub am See.jpg', Range: 'bytes=100-199' }))
    expect(Buffer.compare(await bytesOf(part.Body), data.subarray(100, 200))).toBe(0)
    const head = await s3.send(new HeadObjectCommand({ Bucket: 'fotos', Key: 'liesmich (ä&ö).txt' }))
    expect(head.ContentLength).toBe(5)

    const top = await s3.send(new ListObjectsV2Command({ Bucket: 'fotos', Delimiter: '/' }))
    expect(top.CommonPrefixes?.map(p => p.Prefix)).toEqual(['2025/', '2026/'])
    expect(top.Contents?.map(c => c.Key)).toEqual(['liesmich (ä&ö).txt'])

    const keys: string[] = []
    let token: string | undefined
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: 'fotos', Prefix: '2025/', MaxKeys: 2, ContinuationToken: token }))
      keys.push(...(page.Contents ?? []).map(c => c.Key!))
      token = page.NextContinuationToken
    } while (token)
    expect(keys).toEqual([0, 1, 2, 3, 4].map(i => `2025/bild-${i}.png`))
  })

  it('Multipart-Upload, Kopieren, Mehrfach-Löschen', async () => {
    const a = randomBytes(5 * 1024 * 1024)
    const b = randomBytes(1234)
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: 'fotos', Key: 'gross.bin' }))
    const p1 = await s3.send(new UploadPartCommand({ Bucket: 'fotos', Key: 'gross.bin', UploadId, PartNumber: 1, Body: a }))
    const p2 = await s3.send(new UploadPartCommand({ Bucket: 'fotos', Key: 'gross.bin', UploadId, PartNumber: 2, Body: b }))
    const done = await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: 'fotos',
        Key: 'gross.bin',
        UploadId,
        MultipartUpload: { Parts: [{ PartNumber: 1, ETag: p1.ETag }, { PartNumber: 2, ETag: p2.ETag }] }
      })
    )
    expect(done.ETag).toMatch(/-2"$/)
    const got = await s3.send(new GetObjectCommand({ Bucket: 'fotos', Key: 'gross.bin' }))
    expect(Buffer.compare(await bytesOf(got.Body), Buffer.concat([a, b]))).toBe(0)

    await s3.send(new CopyObjectCommand({ Bucket: 'fotos', Key: 'kopie.bin', CopySource: 'fotos/gross.bin' }))
    expect((await s3.send(new HeadObjectCommand({ Bucket: 'fotos', Key: 'kopie.bin' }))).ContentLength).toBe(a.length + b.length)

    await s3.send(new DeleteObjectsCommand({ Bucket: 'fotos', Delete: { Objects: [{ Key: 'gross.bin' }, { Key: 'kopie.bin' }] } }))
    await expect(s3.send(new HeadObjectCommand({ Bucket: 'fotos', Key: 'gross.bin' }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
  })

  it('falsches Secret wird abgelehnt, signierte Links funktionieren und laufen ab', async () => {
    const bad = new S3Client({ endpoint: gw.url, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: AK, secretAccessKey: 'falsch' } })
    await expect(bad.send(new ListBucketsCommand({}))).rejects.toMatchObject({ name: 'SignatureDoesNotMatch' })
    const unsigned = await fetch(`${gw.url}/fotos`)
    expect(unsigned.status).toBe(403)

    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: 'fotos', Key: 'liesmich (ä&ö).txt' }), { expiresIn: 60 })
    expect(await (await fetch(url)).text()).toBe('hallo')
    const u = new URL(url)
    expect(() => verifySigV4({ method: 'GET', url: u.pathname + u.search, headers: { host: u.host } }, () => SK, Date.now() + 120_000)).toThrow(/abgelaufen/)
  })
})

import path from 'node:path'
import { dataDir, isProd } from '../shared/env'
import { FocBackedProvider } from '../foc/provider'
import { getDb } from '../db'
import { FilOneS3Provider } from './filone'
import { LocalFsProvider } from './local'
import type { StorageProvider } from './provider'

const g = globalThis as unknown as { __fvStorage?: StorageProvider }

function create(): StorageProvider {
  const accessKeyId = process.env.FILONE_ACCESS_KEY_ID
  const secretAccessKey = process.env.FILONE_SECRET_ACCESS_KEY
  const bucket = process.env.FILONE_BUCKET
  if (accessKeyId && secretAccessKey && bucket) {
    return new FilOneS3Provider({
      endpoint: process.env.FILONE_ENDPOINT ?? 'https://eu-west-1.s3.filonecontent.com',
      region: process.env.FILONE_REGION ?? 'eu-west-1',
      bucket,
      accessKeyId,
      secretAccessKey,
      browserDirect: process.env.FILONE_BROWSER_DIRECT === 'true'
    })
  }
  if (isProd && process.env.ALLOW_LOCAL_STORAGE !== '1') {
    throw new Error('Fil One ist nicht konfiguriert (FILONE_ACCESS_KEY_ID, FILONE_SECRET_ACCESS_KEY, FILONE_BUCKET).')
  }
  return new LocalFsProvider(path.join(dataDir(), 'storage'))
}

export function getStorage(): StorageProvider {
  // Filecoin Onchain Cloud sichert im Hintergrund; fehlt die schnelle Kopie, wird von dort gelesen.
  if (!g.__fvStorage) g.__fvStorage = new FocBackedProvider(create(), getDb)
  return g.__fvStorage
}

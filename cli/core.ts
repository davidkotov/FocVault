/**
 * Kern des FocVault-Backup-Programms (Node ≥ 20). Nutzt exakt dieselbe Verschlüsselung wie der
 * Browser: Argon2id → Master-Key, AES-256-GCM pro Datei (frame2), verschlüsselter Tresor-Index.
 * Der Server sieht auch hier nur Ciphertext. Wird auch vom S3-Gateway verwendet.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, openAsBlob } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { ApiClientError, api, configureApi } from '@/features/api/client'
import { deriveFromPassphrase, unwrapMasterKey } from '@/features/keys/kdf'
import { pieceSource, uploadFile } from '@/features/objects/transfer'
import { loadIndex, saveIndex, type IndexState } from '@/features/vault/sync'
import { unwrapFileKey } from '@/lib/crypto'
import { decryptChunksTo } from '@/lib/pieces'
import type { AccountView } from '@/lib/api-types'
import type { FileVersion, VaultContainer, VaultEntry } from '@/lib/vault'

export interface CliConfig {
  server: string
  email: string
  cookie: string
  device: string
  /** S3-Gateway: lokale Zugangsdaten (nur auf diesem Gerät) und angelegte Buckets */
  s3AccessKey?: string
  s3SecretKey?: string
  s3Buckets?: string[]
}

export const CONFIG_DIR = process.env.FOCVAULT_HOME ?? path.join(homedir(), '.focvault')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export async function readConfig(): Promise<CliConfig | null> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as CliConfig
  } catch {
    return null
  }
}

/** Nur der Session-Cookie wird gespeichert (Datei 0600) – nie Passphrase oder Schlüssel. */
export async function writeConfig(c: CliConfig | null): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  if (!c) return writeFile(CONFIG_FILE, '{}', { mode: 0o600 })
  await writeFile(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 })
  await chmod(CONFIG_FILE, 0o600)
}

function useServer(server: string, cookie?: string, onCookie?: (c: string) => void): void {
  configureApi({
    baseUrl: server,
    headers: cookie ? { cookie } : {},
    onResponse: res => {
      const set = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
      const session = set.find(c => c.startsWith('fv_session='))
      if (session && onCookie) onCookie(session.split(';')[0])
    }
  })
}

export async function login(server: string, email: string, passphrase: string): Promise<{ config: CliConfig; account: AccountView }> {
  let cookie = ''
  useServer(server, undefined, c => (cookie = c))
  const normalized = email.trim().toLowerCase()
  const { kdf } = await api.prelogin(normalized)
  const keys = await deriveFromPassphrase(passphrase, kdf)
  const account = await api.login(normalized, keys.authKey)
  if (!cookie) throw new Error('Der Server hat keine Sitzung zurückgegeben.')
  const config = { server, email: normalized, cookie, device: hostname() }
  await writeConfig(config)
  return { config, account }
}

export interface Session {
  config: CliConfig
  account: AccountView
  masterKey: CryptoKey
}

/** Gespeicherte Sitzung verwenden und den Tresor mit der Passphrase entsperren. */
export async function unlock(passphrase: string): Promise<Session> {
  const config = await readConfig()
  if (!config?.cookie) throw new Error('Nicht angemeldet – bitte zuerst `focvault login`.')
  useServer(config.server, config.cookie)
  const account = await api.account()
  if (!account) throw new Error('Sitzung abgelaufen – bitte erneut `focvault login`.')
  const { kek } = await deriveFromPassphrase(passphrase, account.kdf)
  const env = account.envelopes.find(e => e.kekType === 'passphrase')
  if (!env) throw new Error('Konto ohne Passphrase-Schlüssel.')
  const masterKey = await unwrapMasterKey(env, kek)
  return { config, account, masterKey }
}

// ---------------------------------------------------------------------------------------------

async function* walk(dir: string, exclude: RegExp[]): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (exclude.some(r => r.test(e.name))) continue
    if (e.isDirectory()) yield* walk(full, exclude)
    else if (e.isFile()) yield full
  }
}

const DEFAULT_EXCLUDE = [/^\.DS_Store$/, /^Thumbs\.db$/, /^\.git$/, /^node_modules$/, /^~\$/, /\.tmp$/i]

function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', csv: 'text/csv', json: 'application/json',
    mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  return map[ext] ?? 'application/octet-stream'
}

export interface BackupReport {
  scanned: number
  uploaded: number
  unchanged: number
  bytes: number
  failed: Array<{ path: string; error: string }>
}

/**
 * Inkrementelles Backup eines Ordners: neue und geänderte Dateien (Größe/Änderungszeit) werden
 * verschlüsselt hochgeladen. Geänderte Dateien werden bei Pro/Family zur neuen Version – die
 * bisherige Fassung bleibt als Version erhalten. Der Index wird in Etappen gespeichert.
 */
export async function backupFolder(
  s: Session,
  root: string,
  opts: { name?: string; dryRun?: boolean; onFile?: (rel: string, state: 'upload' | 'skip' | 'done' | 'error', info?: string) => void } = {}
): Promise<BackupReport> {
  const abs = path.resolve(root)
  const label = opts.name ?? path.basename(abs)
  const paid = s.account.plan !== 'free'
  let index: IndexState = await loadIndex(s.masterKey, s.account.id)
  let working: VaultContainer = index.container
  const report: BackupReport = { scanned: 0, uploaded: 0, unchanged: 0, bytes: 0, failed: [] }
  const byPath = new Map(
    working.files.filter(f => f.source?.device === s.config.device && f.source?.root === abs).map(f => [f.source!.path, f])
  )
  let pending = 0
  const flush = async () => {
    if (!pending) return
    index = await saveIndex(s.masterKey, s.account.id, index, working)
    working = index.container
    pending = 0
  }

  for await (const full of walk(abs, DEFAULT_EXCLUDE)) {
    report.scanned++
    const rel = path.relative(abs, full).split(path.sep).join('/')
    const st = await stat(full)
    const prev = byPath.get(rel)
    if (prev && prev.size === st.size && prev.source?.mtimeMs === Math.floor(st.mtimeMs)) {
      report.unchanged++
      opts.onFile?.(rel, 'skip')
      continue
    }
    opts.onFile?.(rel, 'upload', `${st.size}`)
    if (opts.dryRun) continue
    try {
      const blob = await openAsBlob(full, { type: mimeOf(full) })
      const file = new File([blob], `${label}/${rel}`, { type: blob.type, lastModified: st.mtimeMs })
      const entry = await uploadFile(file, s.masterKey)
      entry.folder = 'backups'
      entry.source = { device: s.config.device, root: abs, path: rel, mtimeMs: Math.floor(st.mtimeMs) }
      let versions: FileVersion[] | undefined
      if (prev?.objectId && paid) {
        try {
          await api.keepVersion(prev.objectId)
          versions = [
            {
              objectId: prev.objectId,
              size: prev.size,
              type: prev.type,
              wrappedKey: prev.wrappedKey,
              wrapIv: prev.wrapIv,
              chunks: prev.chunks,
              pieceSize: prev.pieceSize,
              storedAt: prev.storedAt
            },
            ...(prev.versions ?? [])
          ].slice(0, 10)
        } catch {
          versions = undefined
        }
      } else if (prev?.objectId) {
        await api.deleteObject(prev.objectId).catch(() => undefined)
      }
      const next: VaultEntry = versions ? { ...entry, versions } : entry
      working = { ...working, files: [next, ...working.files.filter(f => f.id !== prev?.id && f.id !== next.id)] }
      byPath.set(rel, next)
      report.uploaded++
      report.bytes += st.size
      pending++
      opts.onFile?.(rel, 'done')
      if (pending >= 20) await flush()
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : (e as Error).message
      report.failed.push({ path: rel, error: msg })
      opts.onFile?.(rel, 'error', msg)
      if (e instanceof ApiClientError && (e.code === 'QUOTA_EXCEEDED' || e.code === 'UNAUTHENTICATED')) break
    }
  }
  await flush()
  return report
}

/** Dateien entschlüsseln und in einen Ordner schreiben (atomar über .part-Dateien). */
export async function restore(
  s: Session,
  dest: string,
  opts: { prefix?: string; onFile?: (name: string, state: 'done' | 'error', info?: string) => void } = {}
): Promise<{ restored: number; bytes: number; failed: number }> {
  const { container } = await loadIndex(s.masterKey, s.account.id)
  const out = path.resolve(dest)
  let restored = 0
  let bytes = 0
  let failed = 0
  for (const entry of container.files) {
    if (!entry.objectId) continue
    if (opts.prefix && !entry.name.startsWith(opts.prefix)) continue
    // Pfad säubern: keine absoluten Pfade, kein „..“
    const safe = entry.name
      .split('/')
      .filter(p => p && p !== '.' && p !== '..')
      .join(path.sep)
    const target = path.join(out, safe)
    if (!target.startsWith(out + path.sep)) continue
    try {
      await mkdir(path.dirname(target), { recursive: true })
      const fileKey = await unwrapFileKey({ wrapped: entry.wrappedKey, iv: entry.wrapIv }, s.masterKey)
      const source = await pieceSource(entry)
      const tmp = `${target}.part`
      const ws = createWriteStream(tmp)
      const hash = createHash('sha256')
      await decryptChunksTo(entry, fileKey, source, async plain => {
        hash.update(plain)
        if (!ws.write(plain)) await new Promise<void>(r => ws.once('drain', () => r()))
      })
      await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())))
      await rename(tmp, target)
      restored++
      bytes += entry.size
      opts.onFile?.(entry.name, 'done', hash.digest('hex').slice(0, 12))
    } catch (e) {
      failed++
      opts.onFile?.(entry.name, 'error', (e as Error).message)
    }
  }
  return { restored, bytes, failed }
}

export async function listFiles(s: Session): Promise<VaultEntry[]> {
  return (await loadIndex(s.masterKey, s.account.id)).container.files
}

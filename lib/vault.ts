export interface ChunkMeta {
  pieceCid: string
  iv: string
  padLen: number
  size: number
  /** 'frame' = Streaming-Format (16-MiB-Frames, iv = baseIv); fehlt = Legacy-Einzel-Chunk. */
  fmt?: 'frame'
}

export type CloudFolder = 'documents' | 'photos' | 'videos' | 'backups'

export const FOLDERS: Array<{ id: CloudFolder | 'all'; label: string; icon: string }> = [
  { id: 'all', label: 'Alle', icon: '☁️' },
  { id: 'documents', label: 'Dokumente', icon: '📄' },
  { id: 'photos', label: 'Fotos', icon: '🖼️' },
  { id: 'videos', label: 'Videos', icon: '🎬' },
  { id: 'backups', label: 'Backups & Mehr', icon: '🗄️' }
]

export function folderFor(mime: string): CloudFolder {
  if (mime.startsWith('image/')) return 'photos'
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'videos'
  if (
    mime.startsWith('text/') ||
    /pdf|json|xml|csv|msword|officedocument|rtf|markdown/.test(mime)
  ) {
    return 'documents'
  }
  return 'backups'
}

export interface VaultEntry {
  id: string
  name: string
  size: number
  type: string
  folder: CloudFolder
  wrappedKey: string
  wrapIv: string
  chunks: ChunkMeta[]
  storedAt: number
  txHash?: string
  v: 2
}

/** Kleine strukturierte Datensätze (Passwörter, Notizen, 2FA/TOTP).
 *  Liegen verschlüsselt im Vault-Container (kein Datei-Quota-Verbrauch). */
export type SecretKind = 'password' | 'note' | 'totp'

export interface SecretEntry {
  id: string
  kind: SecretKind
  title: string
  /** Ordner/Kategorie, z. B. "Arbeit", "Finanzen" (frei wählbar) */
  folder?: string
  username?: string
  password?: string
  url?: string
  body?: string
  /** TOTP: Aussteller/Anbieter, z. B. "Google" */
  issuer?: string
  /** TOTP: Base32-Secret ohne Padding, z. B. "JBSWY3DPEHPK3PXP" */
  secretBase32?: string
  /** TOTP: standard 6, erlaubt 7/8 */
  digits?: number
  /** TOTP: standard 30 */
  period?: number
  /** TOTP: standard SHA1 */
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
  createdAt: number
  updatedAt: number
}

export interface VaultContainer {
  v: 3
  files: VaultEntry[]
  secrets: SecretEntry[]
}

export const EMPTY_CONTAINER: VaultContainer = { v: 3, files: [], secrets: [] }

export const GiB = 1024 ** 3
export const TiB = 1024 ** 4

/**
 * Pricing- & Quota-Modell (abgestimmt mit Partner, 2026-09):
 *  - Free  5 GB  – danach Pay-as-you-go (Self-Pay, echte FOC-Kosten)
 *  - Pro   2 TB  @ 13.90 CHF/Monat – alle Module (später Stripe)
 *  - Family 2 TB @ 19.90 CHF/Monat – 2–6 Mitglieder, je eigene Vaults
 *  - Business/Custom – individuell
 * Free-Usage wird später über das Admin-/Backend-Konto bezahlt; Abos via Stripe.
 */
export const TIERS = {
  FREE: { label: 'Free', quotaLabel: '5 GB', maxBytes: 5 * GiB, priceChf: '0 CHF' },
  PRO: { label: 'Pro', quotaLabel: '2 TB', maxBytes: 2 * TiB, priceChf: '13.90 CHF / Monat' },
  FAMILY: { label: 'Family', quotaLabel: '2 TB geteilt', maxBytes: 2 * TiB, priceChf: '19.90 CHF / Monat' },
  BUSINESS: { label: 'Business', quotaLabel: 'Individuell', maxBytes: Number.MAX_SAFE_INTEGER, priceChf: 'individuell' }
} as const

export type TierName = keyof typeof TIERS

function vaultKey(address: string): string {
  return `focvault:vault:${address.toLowerCase()}`
}

function normalize(entry: any): VaultEntry | null {
  if (!entry || typeof entry !== 'object') return null
  if (Array.isArray(entry.chunks) && entry.chunks.length > 0) {
    const e = entry as VaultEntry
    if (!e.folder) e.folder = folderFor(e.type || '')
    return e
  }
  if (entry.pieceCid && entry.iv !== undefined && entry.padLen !== undefined) {
    const type = entry.type || ''
    return {
      id: entry.id,
      name: entry.name,
      size: entry.size,
      type,
      folder: folderFor(type),
      wrappedKey: entry.wrappedKey,
      wrapIv: entry.wrapIv,
      chunks: [{ pieceCid: entry.pieceCid, iv: entry.iv, padLen: entry.padLen, size: entry.size }],
      storedAt: entry.storedAt,
      txHash: entry.txHash,
      v: 2
    }
  }
  return null
}

function isSecret(s: any): s is SecretEntry {
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    (s.kind === 'password' || s.kind === 'note' || s.kind === 'totp') &&
    typeof s.title === 'string'
  )
}

/** Versteht das alte v2-Format (reines VaultEntry[]-Array) und v3 (Container). */
export function parseVaultContainer(json: string): VaultContainer {
  const parsed = JSON.parse(json)
  if (Array.isArray(parsed)) {
    // v2 Legacy: nur Dateien
    const files = parsed.map(normalize).filter((e: VaultEntry | null): e is VaultEntry => e !== null)
    return { v: 3, files, secrets: [] }
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.files)) {
    const files = parsed.files.map(normalize).filter((e: VaultEntry | null): e is VaultEntry => e !== null)
    const secrets = Array.isArray(parsed.secrets) ? parsed.secrets.filter(isSecret) : []
    return { v: 3, files, secrets }
  }
  return { v: 3, files: [], secrets: [] }
}

export function loadVaultContainer(address: string): VaultContainer {
  if (typeof window === 'undefined') return { v: 3, files: [], secrets: [] }
  try {
    const raw = window.localStorage.getItem(vaultKey(address))
    if (!raw) return { v: 3, files: [], secrets: [] }
    return parseVaultContainer(raw)
  } catch {
    return { v: 3, files: [], secrets: [] }
  }
}

export function saveVaultContainer(address: string, container: VaultContainer): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(vaultKey(address), JSON.stringify(container))
}

export function usedBytes(entries: VaultEntry[]): number {
  return entries.reduce((sum, e) => sum + e.size, 0)
}

export function tierFor(proActive: boolean, plan: 'FAMILY' | 'BUSINESS' | null = null): TierName {
  if (plan === 'FAMILY') return 'FAMILY'
  if (plan === 'BUSINESS') return 'BUSINESS'
  return proActive ? 'PRO' : 'FREE'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n < 1024 ** 4) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(n / 1024 ** 4).toFixed(2)} TB`
}
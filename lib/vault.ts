export interface ChunkMeta {
  pieceCid: string
  iv: string
  padLen: number
  size: number
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

export const TIERS = {
  FREE: { label: 'Free (Self-Pay)', maxBytes: 20 * 1024 * 1024 },
  PRO: { label: 'Pro', maxBytes: 2 * 1024 * 1024 * 1024 }
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

export function loadVault(address: string): VaultEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(vaultKey(address))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalize).filter((e: VaultEntry | null): e is VaultEntry => e !== null)
  } catch {
    return []
  }
}

export function saveVault(address: string, entries: VaultEntry[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(vaultKey(address), JSON.stringify(entries))
}

export function usedBytes(entries: VaultEntry[]): number {
  return entries.reduce((sum, e) => sum + e.size, 0)
}

export function tierFor(proActive: boolean): TierName {
  return proActive ? 'PRO' : 'FREE'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

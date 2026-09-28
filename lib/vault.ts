export interface ChunkMeta {
  pieceCid: string
  iv: string
  padLen: number
  size: number
  /**
   * 'frame'  = Streaming-Format (16-MiB-Frames, iv = baseIv); Wallet-Modus (Synapse)
   * 'frame2' = wie 'frame', zusätzlich AAD-Bindung an Objekt + Piece-Index; Konto-Modus (Fil One)
   * fehlt    = Legacy-Einzel-Chunk
   * Im Konto-Modus ist `pieceCid` eine Referenz `<objectId>/<index>`, keine Filecoin-CID.
   */
  fmt?: 'frame' | 'frame2'
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
  /** Konto-Modus: Objekt-ID im Backend (Fil One Storage). Fehlt im Wallet-Modus. */
  objectId?: string
  /** Klartext-Bytes pro Piece; fehlt = CHUNK_SIZE (256 MiB, Wallet-Modus). */
  pieceSize?: number
  /** Ältere Fassungen (Pro/Family), neueste zuerst */
  versions?: FileVersion[]
  /** Familienordner: Generation des Ordner-Schlüssels, mit dem der Datei-Schlüssel verpackt ist */
  spaceGen?: number
  /** Familienordner: wer die Datei hinzugefügt hat */
  addedBy?: string
  /** S3-Gateway: ETag (MD5) wie vom Client erwartet */
  etag?: string
  /** Vom Backup-Programm gesichert: Quelle auf dem Gerät (für inkrementelle Backups) */
  source?: { device: string; root: string; path: string; mtimeMs: number }
  v: 2
}

/** Ältere Fassung einer Datei: eigenes Objekt, eigener Datei-Schlüssel. */
export interface FileVersion {
  objectId: string
  size: number
  type: string
  wrappedKey: string
  wrapIv: string
  chunks: ChunkMeta[]
  pieceSize?: number
  storedAt: number
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
  /** Website-Icon (PNG-Data-URL, 64 px; „“ = keins gefunden) und der Host, für den es gilt */
  icon?: string
  iconHost?: string
  /** Passwort: verknüpfter 2FA-Eintrag */
  totpId?: string
  /** Passwort: als Favorit markiert */
  favorite?: boolean
  /** Notiz: oben angeheftet */
  pinned?: boolean
  /** Notiz: freie Schlagwörter */
  tags?: string[]
  /** Notiz: Vorlage (Ausweis, Kreditkarte …) mit strukturierten Feldern */
  template?: NoteTemplateId
  fields?: NoteField[]
  /** Notiz: verschlüsselte Anhänge (eigene Objekte, zählen zum Speicher) */
  attachments?: VaultEntry[]
  /** Notiz: IDs der Secure-Send-Links (nur für die Anzeige in der Link-Übersicht) */
  shareIds?: string[]
  createdAt: number
  updatedAt: number
}

export type NoteTemplateId = 'id' | 'card' | 'insurance' | 'wifi' | 'license'

export interface NoteField {
  key: string
  value: string
}

/** Datei im Papierkorb (Pro/Family): Metadaten bleiben verschlüsselt im Index, bis sie endgültig gelöscht wird. */
export interface TrashEntry extends VaultEntry {
  trashedAt: number
}

export interface VaultContainer {
  v: 3
  files: VaultEntry[]
  secrets: SecretEntry[]
  trash?: TrashEntry[]
  /** eigene Secure-Send-Links inkl. Schlüssel (nur hier, verschlüsselt) – zum erneuten Kopieren */
  links?: Array<{ id: string; url: string; label: string; createdAt: number }>
  /** selbst angelegte (auch leere) Ordner in „Meine Cloud“, vollständige Pfade ohne „/“ am Ende */
  dirs?: string[]
  /** Schlüsselpaar für den Familienordner (privater Teil nur hier, im verschlüsselten Tresor) */
  familyKey?: { publicJwk: JsonWebKey; privateJwk: JsonWebKey }
}

export const EMPTY_CONTAINER: VaultContainer = { v: 3, files: [], secrets: [] }

export const GiB = 1024 ** 3
export const TiB = 1024 ** 4

/**
 * Pakete (Stand 27.09.2026, Konto-Modus rechnet live aus dem Preisbuch in `lib/pricing.ts`):
 *  - Free   5 GB – danach Pay-as-you-go
 *  - Pro    1 TB @ 13.90 CHF/Monat – alle Module, Zusatzspeicher buchbar
 *  - Family 2 TB @ 19.90 CHF/Monat – bis 6 Mitglieder, Zusatzspeicher buchbar
 *  - Business/Custom – individuell
 * Einheiten dezimal (1 TB = 10^12 Byte), wie Fil One und die Konkurrenz.
 */
export const TIERS = {
  FREE: { label: 'Free', quotaLabel: '5 GB', maxBytes: 5e9, priceChf: '0 CHF' },
  PRO: { label: 'Pro', quotaLabel: '1 TB', maxBytes: 1e12, priceChf: '13.90 CHF / Monat' },
  FAMILY: { label: 'Family', quotaLabel: '2 TB geteilt', maxBytes: 2e12, priceChf: '19.90 CHF / Monat' },
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

/** Obergrenze für ein Website-Icon als Data-URL (64-px-PNG ≈ 5–20 KB). */
export const MAX_ICON_DATA_URL_LENGTH = 100_000
const ICON_DATA_URL_RE = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * Nur eingebettete Raster-Bilder als Icon: keine http(s)-URLs (in geteilten Tresoren könnte ein Mitglied
 * sonst über eine eigene Bild-URL die IP-Adressen der anderen Mitglieder abgreifen), kein SVG.
 */
export function isSafeIconDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_ICON_DATA_URL_LENGTH && ICON_DATA_URL_RE.test(v)
}

/** Eintrag übernehmen, ein ungültiges Icon (samt Host, damit es neu geladen wird) verwerfen. „“ = keins gefunden bleibt. */
function sanitizeSecret(s: SecretEntry): SecretEntry {
  if (s.icon === undefined || s.icon === '' || isSafeIconDataUrl(s.icon)) return s
  const { icon: _icon, iconHost: _iconHost, ...rest } = s
  return rest
}

/** Geheimnisse aus einem entschlüsselten Index (eigener oder geteilter Tresor) prüfen und bereinigen. */
export function parseSecrets(list: unknown): SecretEntry[] {
  return Array.isArray(list) ? list.filter(isSecret).map(sanitizeSecret) : []
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
    const secrets = parseSecrets(parsed.secrets)
    const trash = Array.isArray(parsed.trash)
      ? parsed.trash
          .map((t: any) => {
            const e = normalize(t)
            return e && typeof t.trashedAt === 'number' ? { ...e, trashedAt: t.trashedAt } : null
          })
          .filter((e: TrashEntry | null): e is TrashEntry => e !== null)
      : []
    const familyKey =
      parsed.familyKey && typeof parsed.familyKey === 'object' && parsed.familyKey.privateJwk && parsed.familyKey.publicJwk ? parsed.familyKey : undefined
    const dirs = Array.isArray(parsed.dirs)
      ? [...new Set<string>(parsed.dirs.filter((d: unknown): d is string => typeof d === 'string' && d.length > 0 && d.length <= 500 && !d.startsWith('/') && !d.endsWith('/')))]
      : []
    const links = Array.isArray(parsed.links)
      ? parsed.links.filter(
          (l: any) => l && typeof l.id === 'string' && typeof l.url === 'string' && /^https?:\/\//.test(l.url) && typeof l.label === 'string' && typeof l.createdAt === 'number'
        )
      : []
    return {
      v: 3,
      files,
      secrets,
      ...(trash.length ? { trash } : {}),
      ...(familyKey ? { familyKey } : {}),
      ...(dirs.length ? { dirs } : {}),
      ...(links.length ? { links } : {})
    }
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

/** Dezimal wie Fil One und die Konkurrenz: 1 GB = 1 000 000 000 Byte. */
export function formatBytes(n: number): string {
  if (n < 1e3) return `${n} B`
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`
  if (n < 1e12) return `${(n / 1e9).toFixed(2)} GB`
  return `${(n / 1e12).toFixed(2)} TB`
}
/** Gemeinsame Typen der Konto-API (/api/v1) – von Client und Server genutzt. */

export interface KdfParams {
  alg: 'argon2id'
  v: 1
  /** base64url, 16 Byte */
  salt: string
  /** Speicher in KiB */
  m: number
  t: number
  p: number
}

export type KekType = 'passphrase' | 'recovery'

/** Master-Key, AES-GCM-gewrappt durch einen KEK. Der Server kann ihn nicht öffnen. */
export interface KeyEnvelope {
  kekType: KekType
  /** base64url, 12 Byte */
  iv: string
  /** base64url, 48 Byte (32 Byte Key + 16 Byte Tag) */
  cipher: string
}

export type Plan = 'free' | 'pro' | 'family' | 'business'

export interface AccountView {
  id: string
  /** null bei Konten, die per Reown (Wallet/Social) erstellt wurden */
  email: string | null
  /** Anzeigename: E-Mail, Reown-Hinweis oder gekürzte Wallet-Adresse */
  label: string
  /** verknüpfte Wallet-Adressen (lowercase) */
  wallets: string[]
  emailVerified: boolean
  plan: Plan
  quotaBytes: number
  usedBytes: number
  createdAt: string
  kdf: KdfParams
  /** Passphrase-Envelope; nach Recovery-Login zusätzlich das Recovery-Envelope. */
  envelopes: KeyEnvelope[]
  isAdmin: boolean
}

export interface RegisterInput {
  email: string
  authKey: string
  recoveryAuthKey: string
  kdf: KdfParams
  envelopes: KeyEnvelope[]
}

export interface PresignedPiece {
  index: number
  url: string
  method: 'PUT' | 'GET'
  headers?: Record<string, string>
  expiresAt: number
}

export interface CreateObjectInput {
  fmt: 'frame2'
  pieces: Array<{ index: number; cipherBytes: number }>
}

export interface CreateObjectResult {
  objectId: string
  pieces: PresignedPiece[]
}

export interface DownloadResult {
  pieces: Array<PresignedPiece & { cipherBytes: number }>
}

export interface AdminAccountRow {
  id: string
  email: string
  plan: Plan
  status: string
  createdAt: string
  storedBytes: number
  objects: number
}

export interface AdminStats {
  environment: { storage: string; storageDirect: boolean; database: string; production: boolean }
  totals: {
    accounts: number
    accountsByPlan: Record<Plan, number>
    storedBytes: number
    objects: number
    uploadsInProgress: number
  }
  economics: {
    /** Fil One: $4.99 / TB / Monat, Minimum $4.99 */
    storageCostUsdPerMonth: number
    mrrChf: number
  }
  accounts: AdminAccountRow[]
  events: Array<{ at: string; kind: string; email: string | null }>
}

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '../db'
import { serverSecret } from '../shared/env'
import { ApiError } from '../shared/errors'

/**
 * Filecoin Onchain Cloud (FOC) – Betriebseinstellungen.
 *
 * Geldfluss: Das USDFC liegt in der Wallet des Betreibers (z. B. MetaMask, „Payer“) bzw. als
 * Guthaben in Filecoin Pay. Der Server hält nur einen **Session Key**: einen eigenen Schlüssel,
 * den die Payer-Wallet on-chain befristet für Speicher-Aktionen freigibt (Datensatz anlegen,
 * Pieces hinzufügen/entfernen). Er kann kein Guthaben abziehen und besitzt selbst nichts.
 * Er wird mit einem aus SERVER_SECRET abgeleiteten Schlüssel verschlüsselt gespeichert.
 */
export type FocNetwork = 'mainnet' | 'calibration'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Wallet-Adresse (0x…) erwartet')

export const focSettingsSchema = z.object({
  enabled: z.boolean(),
  network: z.enum(['mainnet', 'calibration']),
  /** Öffentliche Adresse der zahlenden Wallet – nie ein privater Schlüssel. */
  payer: address.or(z.literal('')),
  copies: z.number().int().min(1).max(10),
  /** Pakete ab dieser Größe hochladen … */
  packMinMb: z.number().int().min(1).max(1000),
  /** … höchstens so groß (FOC-Maximum ≈ 1016 MiB) … */
  packMaxMb: z.number().int().min(8).max(1000),
  /** … oder spätestens nach so vielen Stunden, auch wenn kleiner. */
  packMaxWaitHours: z.number().min(0).max(168),
  /** Schnelle Kopie nach X Stunden entfernen (null = behalten). Gelesen wird dann von Filecoin. */
  evictAfterHours: z.number().min(1).max(24 * 365).nullable(),
  /** Warnung, wenn das Guthaben weniger als X Tage reicht */
  warnRunwayDays: z.number().min(1).max(365),
  /** Uploads stoppen, wenn das Guthaben weniger als X Tage reicht (danach dürfen Anbieter löschen) */
  blockRunwayDays: z.number().min(0).max(60)
})
export type FocSettings = z.output<typeof focSettingsSchema>

export const DEFAULT_FOC: FocSettings = {
  enabled: false,
  network: 'calibration',
  payer: '',
  copies: 2,
  packMinMb: 128,
  packMaxMb: 512,
  packMaxWaitHours: 6,
  evictAfterHours: null,
  warnRunwayDays: 21,
  blockRunwayDays: 5
}

/** Gespeicherter Zustand (nicht vom Admin editierbar). */
interface FocState {
  /** verschlüsselter Session-Key je Netz */
  sessionKeys: Partial<Record<FocNetwork, { address: string; enc: string; createdAt: string }>>
  /** Datensatz-IDs je Netz und Payer – alle Nutzer teilen sich wenige Datensätze (0.12 $/Monat je Datensatz) */
  dataSets: Record<string, string[]>
  lastRun: { at: string; ok: boolean; message: string } | null
}

const EMPTY_STATE: FocState = { sessionKeys: {}, dataSets: {}, lastRun: null }

async function read<T>(db: Db, key: string): Promise<T | null> {
  const rows = await db.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key])
  return rows[0]?.value ?? null
}

async function write(db: Db, key: string, value: unknown, by: string | null): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), by]
  )
}

export async function getFocSettings(db: Db): Promise<FocSettings> {
  const stored = await read<Partial<FocSettings>>(db, 'foc')
  const parsed = focSettingsSchema.safeParse({ ...DEFAULT_FOC, ...stored })
  return parsed.success ? parsed.data : DEFAULT_FOC
}

export async function setFocSettings(db: Db, value: FocSettings, by: string): Promise<void> {
  const v = focSettingsSchema.parse(value)
  if (v.packMinMb > v.packMaxMb) throw new Error('packMinMb > packMaxMb')
  const prev = await getFocSettings(db)
  if (prev.network !== v.network) {
    // Netzwechsel (z. B. Test → Mainnet): alles im neuen Netz neu sichern. Nur möglich, solange
    // keine schnelle Kopie entfernt wurde – sonst lägen Dateien ausschließlich im alten Netz.
    const evicted = await db.query<{ n: number }>(
      `SELECT count(*)::float8 AS n FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id
        WHERE p.network <> $1 AND m.evicted_at IS NOT NULL AND m.deleted_at IS NULL`,
      [v.network]
    )
    if (Number(evicted[0]?.n ?? 0) > 0) {
      throw new ApiError('BAD_REQUEST', 'Netzwechsel nicht möglich: Einige Dateien liegen nur noch im bisherigen Netz (schnelle Kopie entfernt).')
    }
    await db.tx(async tx => {
      await tx.query('DELETE FROM foc_members WHERE pack_id IN (SELECT id FROM foc_packs WHERE network <> $1)', [v.network])
      await tx.query(`UPDATE foc_packs SET state = 'removed' WHERE network <> $1 AND state <> 'removed'`, [v.network])
    })
  }
  await write(db, 'foc', v, by)
}

export async function getFocState(db: Db): Promise<FocState> {
  return { ...EMPTY_STATE, ...((await read<FocState>(db, 'foc_state')) ?? {}) }
}

export async function updateFocState(db: Db, fn: (s: FocState) => void): Promise<FocState> {
  const s = await getFocState(db)
  fn(s)
  await write(db, 'foc_state', s, null)
  return s
}

export function dataSetKey(network: FocNetwork, payer: string): string {
  return `${network}:${payer.toLowerCase()}`
}

// ---------- Session-Key-Verschlüsselung (AES-256-GCM, Schlüssel aus SERVER_SECRET) ----------

function wrapKey(): Buffer {
  return createHmac('sha256', serverSecret()).update('focvault/foc-session-key/v1').digest()
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', wrapKey(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}

export function openSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split('.')
  if (v !== 'v1') throw new Error('Unbekanntes Format')
  const d = createDecipheriv('aes-256-gcm', wrapKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
}

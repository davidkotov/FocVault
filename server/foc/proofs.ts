import type { Db } from '../db'
import { getFocSettings } from './config'

export interface FilecoinFileStatus {
  network: 'mainnet' | 'calibration' | null
  /** objectId → Anzahl bestätigter Kopien (nur vollständig gesicherte Dateien) */
  objects: Record<string, { copies: number; since: string }>
}

/** Welche Dateien eines Kontos vollständig auf Filecoin liegen (für das Häkchen im Dashboard). */
export async function filecoinStatus(db: Db, accountId: string): Promise<FilecoinFileStatus> {
  const s = await getFocSettings(db)
  const rows = await db.query<{ id: string; pieces: number; secured: number; copies: number | null; since: string | null }>(
    `SELECT o.id, count(*)::float8 AS pieces, count(p.id)::float8 AS secured,
            min(jsonb_array_length(p.copies))::float8 AS copies, max(p.created_at)::text AS since
       FROM objects o
       JOIN object_pieces op ON op.object_id = o.id
       LEFT JOIN foc_members m ON m.storage_key = op.storage_key AND m.deleted_at IS NULL
       LEFT JOIN foc_packs p ON p.id = m.pack_id AND p.state = 'stored'
      WHERE o.owner_account_id = $1 AND o.state = 'stored'
      GROUP BY o.id`,
    [accountId]
  )
  const objects: FilecoinFileStatus['objects'] = {}
  for (const r of rows) {
    if (Number(r.secured) === Number(r.pieces) && r.copies) objects[r.id] = { copies: Number(r.copies), since: r.since ?? '' }
  }
  return { network: Object.keys(objects).length || s.enabled ? s.network : null, objects }
}

export interface ProofCertificate {
  kind: 'focvault.proof/v1'
  network: 'mainnet' | 'calibration'
  objectId: string
  issuedAt: string
  explorer: string
  pieces: Array<{
    index: number
    bytes: number
    sha256: string | null
    pack: { pieceCid: string; offset: number; length: number; storedAt: string; explorer: string }
    copies: Array<{ providerId: string; dataSetId: string; pieceId: string; role: string; retrievalUrl: string; explorer: string }>
  }>
  howToVerify: string[]
}

const PDP_EXPLORER = 'https://pdp.filecoin.cloud'

export function explorerUrl(network: 'mainnet' | 'calibration', kind: 'dataset' | 'piece' | 'providers', id: string): string {
  return `${PDP_EXPLORER}/${network}/${kind}/${encodeURIComponent(id)}`
}

/**
 * Nachweis für eine Datei: in welchem Filecoin-Piece (PieceCID) jedes verschlüsselte Teil liegt,
 * bei welchen Anbietern/Datensätzen, samt SHA-256 des Ciphertexts. Alles davon ist öffentlich
 * überprüfbar (PDP-Explorer, Abruf beim Anbieter) – ohne dass jemand die Datei entschlüsseln kann.
 */
export async function proofCertificate(db: Db, accountId: string, objectId: string): Promise<ProofCertificate | null> {
  const rows = await db.query<{
    piece_index: number
    cipher_bytes: number
    sha256: Uint8Array | null
    piece_cid: string
    byte_offset: number
    byte_length: number
    created_at: string
    network: 'mainnet' | 'calibration'
    copies: Array<{ providerId: string; dataSetId: string; pieceId: string; role: string; retrievalUrl: string }>
  }>(
    `SELECT op.piece_index, op.cipher_bytes::float8 AS cipher_bytes, m.sha256, p.piece_cid, m.byte_offset::float8 AS byte_offset,
            m.byte_length::float8 AS byte_length, p.created_at, p.network, p.copies
       FROM objects o
       JOIN object_pieces op ON op.object_id = o.id
       JOIN foc_members m ON m.storage_key = op.storage_key AND m.deleted_at IS NULL
       JOIN foc_packs p ON p.id = m.pack_id AND p.state = 'stored'
      WHERE o.id = $1 AND o.owner_account_id = $2 AND o.state IN ('stored', 'version', 'trashed')
      ORDER BY op.piece_index`,
    [objectId, accountId]
  )
  const total = await db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM object_pieces WHERE object_id = $1', [objectId])
  if (!rows.length || rows.length !== Number(total[0]?.n ?? -1)) return null
  const network = rows[0].network
  return {
    kind: 'focvault.proof/v1',
    network,
    objectId,
    issuedAt: new Date().toISOString(),
    explorer: `${PDP_EXPLORER}/${network}`,
    pieces: rows.map(r => ({
      index: Number(r.piece_index),
      bytes: Number(r.cipher_bytes),
      sha256: r.sha256 ? Buffer.from(r.sha256).toString('hex') : null,
      pack: {
        pieceCid: r.piece_cid,
        offset: Number(r.byte_offset),
        length: Number(r.byte_length),
        storedAt: new Date(r.created_at).toISOString(),
        explorer: explorerUrl(network, 'piece', r.piece_cid)
      },
      copies: r.copies.map(c => ({ ...c, explorer: explorerUrl(network, 'dataset', c.dataSetId) }))
    })),
    howToVerify: [
      'Jede Kopie im PDP-Explorer öffnen: Der Datensatz zeigt die laufenden Speicherbeweise (Proof of Data Possession).',
      'Das Piece beim Anbieter abrufen (retrievalUrl) und den Bereich offset…offset+length herausschneiden.',
      'SHA-256 dieses Bereichs muss mit sha256 übereinstimmen – das ist exakt dein verschlüsselter Dateiteil.',
      'Entschlüsseln kann ihn nur dein Tresor-Schlüssel; der Nachweis verrät keine Inhalte.'
    ]
  }
}

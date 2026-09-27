import { argon2id } from 'hash-wasm'
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import type { KdfParams, KekType, KeyEnvelope, RegisterInput } from '@/lib/api-types'
import { fromB64Url, toB64Url, type Bytes } from '@/lib/crypto'

/**
 * Schlüsselhierarchie (ARCHITECTURE §4):
 *   Master-Key (zufällig, 256 Bit) ── gewrappt durch ── KEK_passphrase | KEK_recovery
 *   KEK_passphrase = HKDF(Argon2id(Passphrase, salt), "focvault/kek/passphrase/v1")
 *   Auth-Key       = HKDF(Argon2id(Passphrase, salt), "focvault/auth/passphrase/v1")
 * Aus demselben Argon2id-Ergebnis entstehen per HKDF zwei unabhängige Schlüssel: nur der
 * Auth-Key geht an den Server (zur Anmeldung), der KEK verlässt nie das Gerät.
 */

const te = new TextEncoder()

/** Fehler mit maschinenlesbarem Code – die UI übersetzt ihn (commonMessages.errors). */
export class KeyError extends Error {
  constructor(
    readonly code: 'WRONG_PASSPHRASE' | 'WRONG_RECOVERY' | 'INVALID_RECOVERY',
    message: string
  ) {
    super(message)
    this.name = 'KeyError'
  }
}

export const DEFAULT_KDF_COST = { m: 65_536, t: 3, p: 1 } as const
export const MIN_PASSPHRASE_LENGTH = 12

export interface DerivedKeys {
  kek: CryptoKey
  /** base64url, 32 Byte – geht an den Server */
  authKey: string
}

export function newKdfParams(cost: { m: number; t: number; p: number } = DEFAULT_KDF_COST): KdfParams {
  return { alg: 'argon2id', v: 1, salt: toB64Url(crypto.getRandomValues(new Uint8Array(16)) as Bytes), ...cost }
}

async function split(ikm: Bytes, kind: KekType): Promise<DerivedKeys> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const salt = new Uint8Array(0)
  const kek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(`focvault/kek/${kind}/v1`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  const auth = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(`focvault/auth/${kind}/v1`) }, base, 256)
  )
  return { kek, authKey: toB64Url(auth as Bytes) }
}

export async function deriveFromPassphrase(passphrase: string, kdf: KdfParams): Promise<DerivedKeys> {
  const out = await argon2id({
    password: passphrase.normalize('NFKC'),
    salt: fromB64Url(kdf.salt),
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary'
  })
  const ikm = new Uint8Array(out) as Bytes
  out.fill(0)
  try {
    return await split(ikm, 'passphrase')
  } finally {
    ikm.fill(0)
  }
}

/** Neues Recovery-Kit: 24 Wörter = 256 Bit Entropie + Prüfsumme (BIP39, englische Wortliste). */
export function newRecoveryWords(): string[] {
  return generateMnemonic(wordlist, 256).split(' ')
}

export function normalizeRecoveryWords(input: string | string[]): string {
  const raw = Array.isArray(input) ? input.join(' ') : input
  return raw.toLowerCase().normalize('NFKD').trim().split(/\s+/).join(' ')
}

export function isValidRecoveryWords(input: string | string[]): boolean {
  return validateMnemonic(normalizeRecoveryWords(input), wordlist)
}

export async function deriveFromRecovery(input: string | string[]): Promise<DerivedKeys> {
  const phrase = normalizeRecoveryWords(input)
  if (!validateMnemonic(phrase, wordlist)) {
    throw new KeyError('INVALID_RECOVERY', 'Recovery-Kit ungültig – bitte prüfe Schreibweise und Reihenfolge der 24 Wörter.')
  }
  const entropy = new Uint8Array(mnemonicToEntropy(phrase, wordlist)) as Bytes
  try {
    return await split(entropy, 'recovery')
  } finally {
    entropy.fill(0)
  }
}

const mkAad = (kekType: KekType) => te.encode(`focvault/mk/v1/${kekType}`)

export async function wrapMasterKey(mkRaw: Bytes, kek: CryptoKey, kekType: KekType): Promise<KeyEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Bytes
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: mkAad(kekType) }, kek, mkRaw)
  ) as Bytes
  return { kekType, iv: toB64Url(iv), cipher: toB64Url(cipher) }
}

export async function unwrapMasterKeyRaw(env: KeyEnvelope, kek: CryptoKey): Promise<Bytes> {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64Url(env.iv), additionalData: mkAad(env.kekType) },
        kek,
        fromB64Url(env.cipher)
      )
    ) as Bytes
  } catch {
    throw env.kekType === 'passphrase'
      ? new KeyError('WRONG_PASSPHRASE', 'Die Passphrase ist falsch.')
      : new KeyError('WRONG_RECOVERY', 'Das Recovery-Kit passt nicht zu diesem Konto.')
  }
}

/** Master-Key als nicht exportierbarer CryptoKey (nur RAM). importKey kopiert – Rohbytes danach nullen. */
export async function importMasterKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function unwrapMasterKey(env: KeyEnvelope, kek: CryptoKey): Promise<CryptoKey> {
  const raw = await unwrapMasterKeyRaw(env, kek)
  try {
    return await importMasterKey(raw)
  } finally {
    raw.fill(0)
  }
}

/** Alles für die Registrierung: neuer Master-Key, gewrappt für Passphrase und Recovery-Kit. */
export async function buildRegistration(
  email: string,
  passphrase: string,
  recoveryWords: string[],
  cost: { m: number; t: number; p: number } = DEFAULT_KDF_COST
): Promise<{ input: RegisterInput; masterKey: CryptoKey }> {
  const kdf = newKdfParams(cost)
  const [pass, rec] = await Promise.all([deriveFromPassphrase(passphrase, kdf), deriveFromRecovery(recoveryWords)])
  const mkRaw = crypto.getRandomValues(new Uint8Array(32)) as Bytes
  try {
    const envelopes = [await wrapMasterKey(mkRaw, pass.kek, 'passphrase'), await wrapMasterKey(mkRaw, rec.kek, 'recovery')]
    return {
      input: { email, authKey: pass.authKey, recoveryAuthKey: rec.authKey, kdf, envelopes },
      masterKey: await importMasterKey(mkRaw)
    }
  } finally {
    mkRaw.fill(0)
  }
}

/** Neue Passphrase für einen vorhandenen Master-Key (nach Recovery oder beim Wechsel). */
export async function buildPassphraseChange(
  mkRaw: Bytes,
  newPassphrase: string,
  cost: { m: number; t: number; p: number } = DEFAULT_KDF_COST
): Promise<{ authKey: string; kdf: KdfParams; envelope: KeyEnvelope }> {
  const kdf = newKdfParams(cost)
  const pass = await deriveFromPassphrase(newPassphrase, kdf)
  return { authKey: pass.authKey, kdf, envelope: await wrapMasterKey(mkRaw, pass.kek, 'passphrase') }
}

/** Grobe Stärke-Einschätzung für die UI (0–4). Länge zählt mehr als Sonderzeichen. */
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length
  const words = p.trim().split(/\s+/).filter(w => w.length >= 3).length
  let score = 0
  if (p.length >= MIN_PASSPHRASE_LENGTH) score = 1
  if (p.length >= 16 && classes >= 2) score = 2
  if ((p.length >= 20 && classes >= 2) || words >= 4) score = 3
  if ((p.length >= 28 && classes >= 3) || words >= 6) score = 4
  const labels = ['Zu kurz', 'Schwach', 'Okay', 'Stark', 'Sehr stark'] as const
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] }
}

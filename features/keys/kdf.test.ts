import { describe, expect, it } from 'vitest'
import type { VaultContainer } from '@/lib/vault'
import { decryptIndex, encryptIndex } from '../vault/index-crypto'
import {
  buildPassphraseChange,
  buildRegistration,
  deriveFromPassphrase,
  deriveFromRecovery,
  isValidRecoveryWords,
  newKdfParams,
  newRecoveryWords,
  passphraseStrength,
  unwrapMasterKey,
  unwrapMasterKeyRaw
} from './kdf'

/** Schnelle, aber gültige Parameter (OWASP-Minimum) – Produktion nutzt 64 MiB / t=3. */
const CHEAP = { m: 19_456, t: 2, p: 1 }
const PASS = 'Korrekt Pferd Batterie Heftklammer'
const container: VaultContainer = {
  v: 3,
  files: [],
  secrets: [{ id: 's1', kind: 'note', title: 'PIN', body: '1234', createdAt: 1, updatedAt: 1 }]
}

describe('Schlüsselableitung (Argon2id → HKDF)', () => {
  it('Known-Answer: Ableitung bleibt stabil (sonst sperren sich alle Nutzer aus)', async () => {
    const kdf = { alg: 'argon2id' as const, v: 1 as const, salt: 'AAECAwQFBgcICQoLDA0ODw', ...CHEAP }
    const { authKey } = await deriveFromPassphrase(PASS, kdf)
    expect(authKey).toBe('pt9Mi2npOJHm15oenGgBFPyLeAEt529G37zQBxweJTo')
  })

  it('deterministisch, empfindlich für jedes Zeichen, KEK nicht exportierbar', async () => {
    const kdf = newKdfParams(CHEAP)
    const a = await deriveFromPassphrase(PASS, kdf)
    const b = await deriveFromPassphrase(PASS, kdf)
    const c = await deriveFromPassphrase(PASS + '!', kdf)
    expect(a.authKey).toBe(b.authKey)
    expect(c.authKey).not.toBe(a.authKey)
    await expect(crypto.subtle.exportKey('raw', a.kek)).rejects.toThrow()
  })

  it('Registrierung: Passphrase und Recovery-Kit öffnen denselben Master-Key', async () => {
    const words = newRecoveryWords()
    expect(words).toHaveLength(24)
    expect(isValidRecoveryWords(words)).toBe(true)
    const { input, masterKey } = await buildRegistration('a@example.com', PASS, words, CHEAP)
    const blob = await encryptIndex(container, masterKey, 'acc-1')

    const pass = await deriveFromPassphrase(PASS, input.kdf)
    const rec = await deriveFromRecovery('  ' + words.join('   ').toUpperCase() + '\n')
    expect(pass.authKey).toBe(input.authKey)
    expect(rec.authKey).toBe(input.recoveryAuthKey)
    expect(pass.authKey).not.toBe(rec.authKey)

    const passEnv = input.envelopes.find(e => e.kekType === 'passphrase')!
    const recEnv = input.envelopes.find(e => e.kekType === 'recovery')!
    expect(await decryptIndex(blob, await unwrapMasterKey(passEnv, pass.kek), 'acc-1')).toEqual(container)
    expect(await decryptIndex(blob, await unwrapMasterKey(recEnv, rec.kek), 'acc-1')).toEqual(container)
  })

  it('falsche Passphrase, fremdes Kit und vertauschter KEK-Typ scheitern', async () => {
    const words = newRecoveryWords()
    const { input } = await buildRegistration('b@example.com', PASS, words, CHEAP)
    const passEnv = input.envelopes.find(e => e.kekType === 'passphrase')!
    const recEnv = input.envelopes.find(e => e.kekType === 'recovery')!
    const wrong = await deriveFromPassphrase('falsche passphrase 123', input.kdf)
    await expect(unwrapMasterKeyRaw(passEnv, wrong.kek)).rejects.toThrow(/Passphrase ist falsch/)
    const otherKit = await deriveFromRecovery(newRecoveryWords())
    await expect(unwrapMasterKeyRaw(recEnv, otherKit.kek)).rejects.toThrow(/Recovery-Kit passt nicht/)
    // AAD bindet den KEK-Typ: Recovery-Envelope als „passphrase" ausgegeben → scheitert
    const rec = await deriveFromRecovery(words)
    await expect(unwrapMasterKeyRaw({ ...recEnv, kekType: 'passphrase' }, rec.kek)).rejects.toThrow()
  })

  it('ungültige Recovery-Wörter werden erkannt', async () => {
    const words = newRecoveryWords()
    const broken = [...words]
    broken[5] = broken[5] === 'abandon' ? 'ability' : 'abandon'
    expect(isValidRecoveryWords(broken)).toBe(false)
    expect(isValidRecoveryWords(words.slice(0, 23))).toBe(false)
    await expect(deriveFromRecovery('kein gueltiges kit')).rejects.toThrow(/Recovery-Kit ungültig/)
  })

  it('neue Passphrase nach Recovery öffnet denselben Master-Key', async () => {
    const words = newRecoveryWords()
    const { input, masterKey } = await buildRegistration('c@example.com', PASS, words, CHEAP)
    const blob = await encryptIndex(container, masterKey, 'acc-2')
    const rec = await deriveFromRecovery(words)
    const raw = await unwrapMasterKeyRaw(input.envelopes.find(e => e.kekType === 'recovery')!, rec.kek)
    const change = await buildPassphraseChange(raw, 'ganz neue lange passphrase', CHEAP)
    raw.fill(0)
    const next = await deriveFromPassphrase('ganz neue lange passphrase', change.kdf)
    expect(next.authKey).toBe(change.authKey)
    expect(await decryptIndex(blob, await unwrapMasterKey(change.envelope, next.kek), 'acc-2')).toEqual(container)
  })

  it('Index: AAD bindet an das Konto, Manipulation fällt auf', async () => {
    const { masterKey } = await buildRegistration('d@example.com', PASS, newRecoveryWords(), CHEAP)
    const blob = await encryptIndex(container, masterKey, 'acc-3')
    await expect(decryptIndex(blob, masterKey, 'acc-4')).rejects.toThrow(/nicht entschlüsselt/)
    const tampered = new Uint8Array(blob)
    tampered[20] ^= 1
    await expect(decryptIndex(tampered, masterKey, 'acc-3')).rejects.toThrow()
  })

  it('Passphrase-Stärke', () => {
    expect(passphraseStrength('kurz').score).toBe(0)
    expect(passphraseStrength('zwoelfzeichen').score).toBe(1)
    expect(passphraseStrength('Korrekt Pferd Batterie Heftklammer').score).toBeGreaterThanOrEqual(3)
  })
})

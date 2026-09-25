import { describe, expect, it } from 'vitest'
import { decodeShareFragment, encodeShareFragment, deriveSharePasswordKey, unwrapLinkKeyWithPassword, wrapLinkKeyWithPassword, type Bytes } from './crypto'

function bytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n)) as Bytes
}

describe('ShareFragment – Secure Send v2', () => {
  it('bare → nackter b64url-LinkKey (legacy-kompatibel)', () => {
    const linkKey = bytes(32)
    const frag = encodeShareFragment({ kind: 'bare', linkKey })
    const decoded = decodeShareFragment(frag)
    expect(decoded.kind).toBe('bare')
    if (decoded.kind === 'bare') expect(decoded.linkKey).toEqual(linkKey)
  })

  it('password-Fragment roundtrip (salt/iv/cipher)', () => {
    const salt = bytes(16)
    const iv = bytes(12)
    const cipher = bytes(32)
    const frag = encodeShareFragment({ kind: 'password', salt, iv, cipher })
    expect(frag.startsWith('p.')).toBe(true)
    const decoded = decodeShareFragment(frag)
    expect(decoded.kind).toBe('password')
    if (decoded.kind === 'password') {
      expect(decoded.salt).toEqual(salt)
      expect(decoded.iv).toEqual(iv)
      expect(decoded.cipher).toEqual(cipher)
    }
  })

  it('Passwort-Key-Wrap/Unwrap roundtrip', async () => {
    const salt = bytes(16)
    const linkKey = bytes(32)
    const pwdKey = await deriveSharePasswordKey('geheim-123', salt)
    const { iv, cipher } = await wrapLinkKeyWithPassword(pwdKey, linkKey)
    const out = await unwrapLinkKeyWithPassword(pwdKey, iv, cipher)
    expect(out).toEqual(linkKey)
  })

  it('falsches Passwort wird abgelehnt', async () => {
    const salt = bytes(16)
    const linkKey = bytes(32)
    const good = await deriveSharePasswordKey('richtig', salt)
    const bad = await deriveSharePasswordKey('falsch', salt)
    const { iv, cipher } = await wrapLinkKeyWithPassword(good, linkKey)
    await expect(unwrapLinkKeyWithPassword(bad, iv, cipher)).rejects.toThrow()
  })
})

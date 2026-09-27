import { describe, expect, it } from 'vitest'
import { countInRange, reusedPasswords, sha1Hex, strength } from './password-health'
import type { SecretEntry } from './vault'

const pw = (id: string, password: string): SecretEntry => ({ id, kind: 'password', title: id, password, createdAt: 0, updatedAt: 0 })

describe('Passwort-Check', () => {
  it('Stärke: typische schwache Muster, lange Zufallspasswörter stark', () => {
    expect(strength('passwort123')).toBe(0)
    expect(strength('Sommer2024!')).toBeLessThanOrEqual(1)
    expect(strength('aaaaaaaaaaaa')).toBeLessThanOrEqual(1)
    expect(strength('k7#Qz!v9Lp$2wXr&Tm4e')).toBe(4)
    expect(strength('korrekt pferd batterie heftklammer')).toBeGreaterThanOrEqual(3)
  })
  it('Mehrfachverwendung und Range-Auswertung', async () => {
    const r = reusedPasswords([pw('a', 'x1'), pw('b', 'x1'), pw('c', 'y2')])
    expect([...r.entries()]).toEqual([['a', 2], ['b', 2]])
    const h = await sha1Hex('password')
    expect(h).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8')
    expect(countInRange(`003D68EB55068C33ACE09247EE4C639306B:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n`, h.slice(5))).toBe(9545824)
    expect(countInRange('ABC:1', h.slice(5))).toBe(0)
  })
})

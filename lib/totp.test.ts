import { describe, expect, it } from 'vitest'
import { generateTotp } from './totp'

/**
 * RFC 6238 Appendix B – Testvektoren (SHA1, 8 Stellen, Period 30 s).
 * Secret (Base32) = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  <- ASCII "12345678901234567890"
 *
 * Wichtig: `Time` in Appendix B ist Unix-Zeit in SEKUNDEN, nicht der Counter.
 * `at` ist der Parameter von generateTotp in Millisekunden, also `T * 1000`.
 * Der Counter ergibt sich daraus als floor(at / 1000 / period) = floor(T / 30)
 * (z. B. T=59 s -> Counter 1 -> 94287082).
 */
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CASES: Array<[T: number, expected: string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037']
]

describe('TOTP (RFC 6238)', () => {
  it.each(CASES)('T=%i → %s', async (T, expected) => {
    const code = await generateTotp({ secret: SECRET, digits: 8, period: 30, algorithm: 'SHA1' }, T * 1000)
    expect(code).toBe(expected)
  })
})

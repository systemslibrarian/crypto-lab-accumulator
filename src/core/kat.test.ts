/**
 * Cross-implementation known-answer tests.
 *
 * RSA accumulators have no RFC and no NIST vector suite — there is nothing
 * official to test against, and saying otherwise would be the dishonest move.
 * So the fixtures in src/fixtures/kat.json were produced by a completely
 * separate implementation (CPython's bignum `pow`/`math.gcd` and `hashlib`),
 * and the TypeScript here has to re-derive them byte for byte.
 */

import { describe, it, expect } from 'vitest'
import kat from '../fixtures/kat.json'
import { modPow, egcd } from './bigint'

describe('modular exponentiation KATs (vs CPython pow)', () => {
  it.each(kat.modpow)('$name', (v) => {
    expect(modPow(BigInt(v.base), BigInt(v.exp), BigInt(v.mod)).toString()).toBe(v.expected)
  })
})

describe('extended Euclid KATs (vs CPython)', () => {
  it('reproduces gcd and both Bezout coefficients exactly', () => {
    for (const v of kat.bezout) {
      const a = BigInt(v.a)
      const b = BigInt(v.b)
      const r = egcd(a, b)
      expect(r.g.toString()).toBe(v.g)
      expect(r.x.toString()).toBe(v.x)
      expect(r.y.toString()).toBe(v.y)
      expect(a * r.x + b * r.y).toBe(r.g)
    }
  })
})

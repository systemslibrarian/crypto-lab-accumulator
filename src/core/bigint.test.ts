import { describe, it, expect } from 'vitest'
import {
  modPow,
  modInv,
  egcd,
  gcd,
  mod1,
  bitLength,
  byteLength,
  toHex,
  randBits,
  randBelow,
  bytesToBigInt,
} from './bigint'

describe('mod1', () => {
  it('always returns a non-negative residue', () => {
    expect(mod1(-1n, 7n)).toBe(6n)
    expect(mod1(-70n, 7n)).toBe(0n)
    expect(mod1(9n, 7n)).toBe(2n)
  })
})

describe('modPow', () => {
  it('matches naive repeated multiplication on small inputs', () => {
    for (let b = 2; b < 12; b++) {
      for (let e = 0; e < 20; e++) {
        let naive = 1n
        for (let i = 0; i < e; i++) naive = (naive * BigInt(b)) % 97n
        expect(modPow(BigInt(b), BigInt(e), 97n)).toBe(naive)
      }
    }
  })

  it('satisfies Fermat: a^(p-1) = 1 mod p', () => {
    const p = 2n ** 61n - 1n // Mersenne prime
    for (const a of [2n, 3n, 12345n, p - 1n]) {
      expect(modPow(a, p - 1n, p)).toBe(1n)
    }
  })

  it('handles negative exponents by inverting first', () => {
    const p = 1000003n
    expect(modPow(7n, -1n, p)).toBe(modInv(7n, p))
    expect((modPow(7n, -3n, p) * modPow(7n, 3n, p)) % p).toBe(1n)
  })

  it('is homomorphic in the exponent — the property the accumulator rests on', () => {
    const N = 3233n * 7919n
    const g = 42n
    const [a, b] = [131n, 977n]
    expect(modPow(modPow(g, a, N), b, N)).toBe(modPow(g, a * b, N))
  })

  it('rejects a non-positive modulus', () => {
    expect(() => modPow(2n, 3n, 0n)).toThrow(RangeError)
    expect(modPow(2n, 3n, 1n)).toBe(0n)
  })
})

describe('egcd / gcd / modInv', () => {
  it('produces a Bezout identity that actually holds', () => {
    const pairs: Array<[bigint, bigint]> = [
      [240n, 46n],
      [17n, 3120n],
      [-42n, 56n],
      [2n ** 89n - 1n, 65537n],
    ]
    for (const [a, b] of pairs) {
      const { g, x, y } = egcd(a, b)
      expect(a * x + b * y).toBe(g)
      expect(g).toBe(gcd(a, b))
      expect(g > 0n).toBe(true)
    }
  })

  it('inverts and refuses to invert', () => {
    expect((modInv(3n, 11n) * 3n) % 11n).toBe(1n)
    expect(() => modInv(4n, 8n)).toThrow(RangeError)
  })
})

describe('sizing helpers', () => {
  it('measures bits and bytes', () => {
    expect(bitLength(0n)).toBe(0)
    expect(bitLength(1n)).toBe(1)
    expect(bitLength(255n)).toBe(8)
    expect(bitLength(256n)).toBe(9)
    expect(byteLength(255n)).toBe(1)
    expect(byteLength(256n)).toBe(2)
  })

  it('pads hex to a requested byte width', () => {
    expect(toHex(255n, 4)).toBe('000000ff')
    expect(toHex(1n)).toBe('01')
  })
})

describe('randomness helpers', () => {
  it('randBits produces exactly the requested bit length', () => {
    for (const bits of [8, 63, 64, 65, 256]) {
      for (let i = 0; i < 20; i++) expect(bitLength(randBits(bits))).toBe(bits)
    }
  })

  it('randBelow stays in range', () => {
    for (let i = 0; i < 200; i++) {
      const v = randBelow(1000n)
      expect(v >= 0n && v < 1000n).toBe(true)
    }
  })

  it('bytesToBigInt is big-endian', () => {
    expect(bytesToBigInt(Uint8Array.of(0x01, 0x02))).toBe(258n)
  })
})

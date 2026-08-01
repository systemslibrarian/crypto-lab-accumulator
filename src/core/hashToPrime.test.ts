import { describe, it, expect } from 'vitest'
import { sha256 } from '@noble/hashes/sha256'
import kat from '../fixtures/kat.json'
import { hashToPrime, bytesToHex, REPRESENTATIVE_BITS } from './hashToPrime'
import { isProbablePrime } from './primes'
import { bitLength } from './bigint'

describe('SHA-256 known-answer tests (FIPS 180-4)', () => {
  it('matches the published digests', () => {
    for (const v of kat.sha256) {
      expect(bytesToHex(sha256(new TextEncoder().encode(v.input)))).toBe(v.expected)
    }
  })

  it('reproduces the canonical "abc" digest', () => {
    expect(bytesToHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('hash-to-prime cross-implementation KATs', () => {
  it('matches the independent Python implementation label for label', () => {
    for (const v of kat.hashToPrime) {
      const rep = hashToPrime(v.label, v.bits)
      expect(rep.prime.toString(), `label ${JSON.stringify(v.label)}`).toBe(v.prime)
      expect(rep.attempts).toBe(v.attempts)
      expect(rep.digestHex).toBe(v.digestHex)
    }
  })

  it('really returns primes of exactly the requested size', () => {
    for (const v of kat.hashToPrime) {
      const rep = hashToPrime(v.label, v.bits)
      expect(bitLength(rep.prime)).toBe(v.bits)
      expect(rep.prime % 2n).toBe(1n)
      expect(isProbablePrime(rep.prime)).toBe(true)
    }
  })

  it('is deterministic and cached without changing the answer', () => {
    expect(hashToPrime('deterministic?').prime).toBe(hashToPrime('deterministic?').prime)
  })

  it('separates distinct labels — collisions would be forgeries', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const p = hashToPrime(`cert:SN-${i}`).prime.toString()
      expect(seen.has(p)).toBe(false)
      seen.add(p)
    }
  })

  it('is domain-separated: the counter is part of the message, not appended noise', () => {
    // "a|1" and "a" at counter 1 must not collide with "a|1" at counter 0.
    expect(hashToPrime('a|1').prime).not.toBe(hashToPrime('a').prime)
  })

  it('defaults to the documented representative size', () => {
    expect(REPRESENTATIVE_BITS).toBe(64)
    expect(bitLength(hashToPrime('size check').prime)).toBe(64)
  })
})

import { describe, it, expect } from 'vitest'
import kat from '../fixtures/kat.json'
import {
  isProbablePrime,
  nextPrime,
  isSafePrime,
  generateSafePrime,
  expectedSafePrimeCandidates,
  SMALL_PRIMES,
  passesTrialDivision,
} from './primes'
import { bitLength } from './bigint'

describe('small prime sieve', () => {
  it('starts and ends where it should', () => {
    expect(SMALL_PRIMES[0]).toBe(2n)
    expect(SMALL_PRIMES.at(-1)).toBe(997n)
    expect(SMALL_PRIMES.length).toBe(168) // π(1000) = 168
  })

  it('trial division catches obvious composites and passes primes', () => {
    expect(passesTrialDivision(1001n)).toBe(false) // 7 · 11 · 13
    expect(passesTrialDivision(1009n)).toBe(true)
  })
})

describe('Miller-Rabin known-answer tests', () => {
  it('accepts every known prime in the fixture', () => {
    for (const p of kat.knownPrimes) {
      expect(isProbablePrime(BigInt(p)), `${p} should be prime`).toBe(true)
    }
  })

  it('rejects every Carmichael number', () => {
    // Carmichael numbers pass the Fermat test for every coprime base; a
    // demo that used Fermat instead of Miller-Rabin would accept all of these.
    for (const n of kat.carmichael) {
      expect(isProbablePrime(BigInt(n)), `${n} is Carmichael, not prime`).toBe(false)
    }
  })

  it('rejects every strong pseudoprime to base 2', () => {
    for (const n of kat.strongPseudoprimesBase2) {
      expect(isProbablePrime(BigInt(n)), `${n} is a base-2 liar`).toBe(false)
    }
  })

  it('rejects small non-primes and negatives', () => {
    for (const n of [-7n, 0n, 1n, 4n, 9n, 25n, 1000n]) expect(isProbablePrime(n)).toBe(false)
  })
})

describe('nextPrime', () => {
  it('finds the next prime at or above n', () => {
    expect(nextPrime(0n)).toBe(2n)
    expect(nextPrime(2n)).toBe(2n)
    expect(nextPrime(8n)).toBe(11n) // 8 -> 9 (odd) -> 11
    expect(nextPrime(104728n)).toBe(104729n)
  })
})

describe('safe primes', () => {
  it('recognises a safe prime and rejects a merely-prime one', () => {
    expect(isSafePrime(11n)).toBe(true) // (11-1)/2 = 5, prime
    expect(isSafePrime(13n)).toBe(false) // (13-1)/2 = 6
  })

  it('generates p = 2p′ + 1 of the requested bit length', async () => {
    const p = await generateSafePrime(64)
    expect(bitLength(p)).toBe(64)
    expect(isProbablePrime(p)).toBe(true)
    expect(isProbablePrime((p - 1n) / 2n)).toBe(true)
  }, 60_000)

  it('refuses a size too small to be meaningful', async () => {
    await expect(generateSafePrime(8)).rejects.toThrow(RangeError)
  })

  it('estimates the candidate count this generator actually draws', () => {
    // Measured by running generateSafePrime itself 2,000 times per size
    // (1,000 at 192 bits) on 15 November 2026: 2,911 odd candidates drawn per
    // 128-bit safe prime, 6,617 at 192 bits, 12,029 at 256 bits. The setup
    // panel prints this estimate, so a wrong one is a wrong page.
    expect(expectedSafePrimeCandidates(128)).toBeGreaterThan(2_700)
    expect(expectedSafePrimeCandidates(128)).toBeLessThan(3_150)
    expect(expectedSafePrimeCandidates(192)).toBeGreaterThan(6_200)
    expect(expectedSafePrimeCandidates(192)).toBeLessThan(7_050)
    // The halves of the shipped 512-bit modulus: twelve thousand, not "a few".
    expect(expectedSafePrimeCandidates(256)).toBeGreaterThan(11_000)
    expect(expectedSafePrimeCandidates(256)).toBeLessThan(12_700)
  })
})

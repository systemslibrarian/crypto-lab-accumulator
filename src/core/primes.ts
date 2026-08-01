/**
 * Primality testing and safe-prime generation.
 *
 * Two separate jobs live here and they must not be confused:
 *
 *  1. `isProbablePrime` — Miller-Rabin. Used to find the *prime representatives*
 *     that elements hash to (see hashToPrime.ts) and to build the modulus.
 *  2. `generateSafePrime` — p = 2p' + 1 with p' also prime. The RSA accumulator
 *     needs g to sit in the quadratic-residue subgroup QR_N; with safe primes
 *     QR_N has order p'q' and no small subgroups, which is what makes squaring a
 *     random value a sound way to land in QR_N.
 *
 * Miller-Rabin is probabilistic. With `rounds` random bases the chance a
 * composite survives is at most 4^-rounds, so the "prime" labels the UI prints
 * are overwhelmingly-likely-prime, not proven prime. The UI says so.
 */

import { modPow, randBelow, bitLength } from './bigint'

/** Primes below 1000 — trial division kills ~92% of odd candidates for free. */
export const SMALL_PRIMES: readonly bigint[] = (() => {
  const sieve = new Uint8Array(1000).fill(1)
  sieve[0] = sieve[1] = 0
  for (let i = 2; i * i < 1000; i++) {
    if (!sieve[i]) continue
    for (let j = i * i; j < 1000; j += i) sieve[j] = 0
  }
  const out: bigint[] = []
  for (let i = 2; i < 1000; i++) if (sieve[i]) out.push(BigInt(i))
  return out
})()

/** True when `n` survives trial division by every prime below 1000. */
export function passesTrialDivision(n: bigint): boolean {
  for (const p of SMALL_PRIMES) {
    if (n === p) return true
    if (n % p === 0n) return false
  }
  return true
}

/**
 * Miller-Rabin with `rounds` random bases (plus the deterministic base 2,
 * which alone already rejects every Carmichael number the KAT fixture lists).
 */
export function isProbablePrime(n: bigint, rounds = 24): boolean {
  if (n < 2n) return false
  for (const p of SMALL_PRIMES) {
    if (n === p) return true
    if (n % p === 0n) return false
  }

  // n - 1 = d · 2^s with d odd.
  let d = n - 1n
  let s = 0
  while ((d & 1n) === 0n) {
    d >>= 1n
    s++
  }

  const witnesses: bigint[] = [2n]
  for (let i = 1; i < rounds; i++) witnesses.push(2n + randBelow(n - 4n))

  for (const a of witnesses) {
    let x = modPow(a, d, n)
    if (x === 1n || x === n - 1n) continue
    let composite = true
    for (let r = 1; r < s; r++) {
      x = (x * x) % n
      if (x === n - 1n) {
        composite = false
        break
      }
    }
    if (composite) return false
  }
  return true
}

/** Smallest probable prime >= n (n is nudged to odd first). */
export function nextPrime(n: bigint): bigint {
  let c = n <= 2n ? 2n : n | 1n
  if (c === 2n) return c
  while (!isProbablePrime(c)) c += 2n
  return c
}

export interface SafePrimeProgress {
  /** Candidates drawn so far — the UI shows this counter climbing. */
  candidates: number
  /** Candidates that survived trial division and reached Miller-Rabin. */
  tested: number
}

export interface SafePrimeOptions {
  onProgress?: (p: SafePrimeProgress) => void
  /** Called between candidates; return a promise to yield to the event loop. */
  yieldEvery?: number
  signal?: { aborted: boolean }
}

/**
 * Generate a safe prime p = 2p' + 1 of exactly `bits` bits.
 *
 * Strategy: draw an odd p' of (bits-1) bits, trial-divide *both* p' and
 * 2p'+1 before spending a Miller-Rabin round on either. Safe primes are rare
 * (density ~ 1/ln(p)^2), so the cheap filter is what makes this practical in a
 * browser tab at all.
 */
export async function generateSafePrime(bits: number, opts: SafePrimeOptions = {}): Promise<bigint> {
  if (bits < 16) throw new RangeError('safe prime needs at least 16 bits')
  const yieldEvery = opts.yieldEvery ?? 64
  const progress: SafePrimeProgress = { candidates: 0, tested: 0 }

  for (;;) {
    if (opts.signal?.aborted) throw new Error('aborted')
    progress.candidates++

    // p' has bits-1 bits, so p = 2p'+1 has exactly `bits` bits.
    const q = randOdd(bits - 1)
    const p = 2n * q + 1n

    if (passesTrialDivision(q) && passesTrialDivision(p)) {
      progress.tested++
      // Test the smaller number first — a failure there is cheaper.
      if (isProbablePrime(q, 8) && isProbablePrime(p, 8) && isProbablePrime(q, 24) && isProbablePrime(p, 24)) {
        opts.onProgress?.({ ...progress })
        return p
      }
    }

    if (progress.candidates % yieldEvery === 0) {
      opts.onProgress?.({ ...progress })
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

function randOdd(bits: number): bigint {
  const bytes = new Uint8Array(Math.ceil(bits / 8))
  globalThis.crypto.getRandomValues(bytes)
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  n >>= BigInt(bytes.length * 8 - bits)
  n |= 1n << BigInt(bits - 1)
  return n | 1n
}

/** True when p = 2p' + 1 with both p and p' probable primes. */
export function isSafePrime(p: bigint): boolean {
  if (bitLength(p) < 3) return false
  return isProbablePrime(p) && isProbablePrime((p - 1n) / 2n)
}

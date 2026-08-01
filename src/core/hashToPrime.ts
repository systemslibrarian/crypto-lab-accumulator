/**
 * Hash-to-prime: the map from an arbitrary element (a string — a serial
 * number, a name) to the odd prime that actually gets multiplied into the
 * accumulator's exponent.
 *
 * Why primes at all? Baric-Pfitzmann (EUROCRYPT '97) showed the original
 * Benaloh-de Mare accumulator is only collision-*free* if the accumulated
 * values are primes. If two elements could map to values sharing a factor, or
 * if one element's value divided the product of others, you could forge a
 * membership witness for something that was never added. Primality is what
 * makes "e divides the product" equivalent to "e is one of the factors".
 *
 * Construction: SHA-256 over a domain-separated (label, counter) pair,
 * truncated to `bits`, top and bottom bit forced, counter incremented until
 * the result is prime. Deterministic — the same label always yields the same
 * prime, on any machine, which is what lets two parties agree on the set.
 *
 * SIZE HONESTY: we use 64-bit representatives so the exponent products stay
 * small enough to exponentiate instantly in a tab. A real deployment uses
 * ~256-bit representatives; at 64 bits a birthday collision is only ~2^32 work,
 * and a collision is a forgery. This is stated on the page.
 */

import { sha256 } from '@noble/hashes/sha256'
import { bytesToBigInt } from './bigint'
import { isProbablePrime } from './primes'

export const HASH_TO_PRIME_DOMAIN = 'crypto-lab-accumulator/hash-to-prime/v1'

/** Default representative size. See the SIZE HONESTY note above. */
export const REPRESENTATIVE_BITS = 64

export interface PrimeRepresentative {
  /** The original element as typed by the user. */
  label: string
  /** The odd prime that represents it in the exponent. */
  prime: bigint
  /** How many counter values were burned before a prime appeared. */
  attempts: number
  /** The winning digest, hex — shown in the UI so the map is inspectable. */
  digestHex: string
  bits: number
}

const cache = new Map<string, PrimeRepresentative>()

/** Deterministically map `label` to an odd prime of `bits` bits. */
export function hashToPrime(label: string, bits: number = REPRESENTATIVE_BITS): PrimeRepresentative {
  const key = `${bits}:${label}`
  const hit = cache.get(key)
  if (hit) return hit

  const byteLen = Math.ceil(bits / 8)
  const encoder = new TextEncoder()

  for (let counter = 0; ; counter++) {
    const msg = encoder.encode(`${HASH_TO_PRIME_DOMAIN}|${label}|${counter}`)
    const digest = sha256(msg)
    let n = bytesToBigInt(digest.slice(0, byteLen))
    // Force exactly `bits` bits and oddness. Both are required: a short or
    // even representative would break the "distinct large odd primes" premise.
    n |= 1n << BigInt(bits - 1)
    n |= 1n
    if (isProbablePrime(n)) {
      const rep: PrimeRepresentative = {
        label,
        prime: n,
        attempts: counter + 1,
        digestHex: bytesToHex(digest),
        bits,
      }
      cache.set(key, rep)
      return rep
    }
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * The shipped toy parameters.
 *
 * Generated once, offline, by an independent Python implementation (two 256-bit
 * safe primes) and frozen into src/fixtures/params.json so the page is
 * interactive the instant it loads instead of spending ten seconds hunting for
 * safe primes before it can show you anything.
 *
 * 512 bits is FAR below any security threshold — RSA-512 was factored in 1999
 * and today falls in hours on a laptop. It is chosen so that every
 * exponentiation on this page finishes in under a millisecond. The page says
 * this out loud; the "generate fresh parameters" exhibit runs the real
 * safe-prime search in your browser so you can see what the real cost is.
 *
 * p and q are published in the fixture on purpose. A demo that pretended to
 * have a trusted setup would be teaching a falsehood.
 */

import raw from '../fixtures/params.json'
import type { AccumulatorParams } from './types'

export const SHIPPED_PARAMS: AccumulatorParams = Object.freeze({
  N: BigInt(raw.N),
  g: BigInt(raw.g),
  bits: raw.bits,
  trapdoor: Object.freeze({ p: BigInt(raw.p), q: BigInt(raw.q) }),
  provenance: 'shipped' as const,
})

/**
 * The starting set: three certificate serials, all of them revoked. The set IS
 * the revocation list, so membership in it is exactly what "revoked" means.
 */
export const DEFAULT_SET: readonly string[] = Object.freeze([
  'cert:SN-0xA31F',
  'cert:SN-0xB77C',
  'cert:SN-0xC0DE',
])

/** A serial that is deliberately NOT revoked — the non-membership subject. */
export const DEFAULT_NON_MEMBER = 'cert:SN-0xD4A9'

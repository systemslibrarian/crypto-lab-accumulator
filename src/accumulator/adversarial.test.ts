/**
 * Attack tests. Every one of these is a thing a learner can try on the page,
 * so each must have a test proving the real verifier behaves as the page says.
 *
 * Two of them (the composite representative and the trapdoor forgery) SUCCEED.
 * They are here precisely because they succeed: they are the demonstrations
 * that the prime map and the trusted setup are load-bearing, not decoration.
 */

import { describe, it, expect } from 'vitest'
import { hashToPrime } from '../core/hashToPrime'
import { modPow, modInv, mod1, randBelow } from '../core/bigint'
import { SHIPPED_PARAMS } from './params'
import {
  accumulate,
  addElement,
  deleteByRecompute,
  exponentProduct,
  membershipWitness,
  nonMembershipWitness,
  verifyMembership,
  verifyNonMembership,
} from './accumulator'

const P = SHIPPED_PARAMS
const primes = ['cert:SN-0xA31F', 'cert:SN-0xB77C', 'cert:SN-0xC0DE'].map(
  (l) => hashToPrime(l).prime,
)
const A = accumulate(P, primes)
const outsider = hashToPrime('cert:SN-0xD4A9').prime

describe('membership forgery attempts (all must fail)', () => {
  it('rejects the obvious guess w = A', () => {
    expect(verifyMembership(P, A, { e: outsider, w: A }).ok).toBe(false)
  })

  it('rejects w = g', () => {
    expect(verifyMembership(P, A, { e: outsider, w: P.g }).ok).toBe(false)
  })

  it('rejects w = 1 and w = 0', () => {
    expect(verifyMembership(P, A, { e: outsider, w: 1n }).ok).toBe(false)
    expect(verifyMembership(P, A, { e: outsider, w: 0n }).ok).toBe(false)
  })

  it('rejects another member’s witness reused for the outsider', () => {
    const w = membershipWitness(P, primes, primes[0]!)
    expect(verifyMembership(P, A, { e: outsider, w: w.w }).ok).toBe(false)
  })

  it('rejects 500 random group elements', () => {
    for (let i = 0; i < 500; i++) {
      expect(verifyMembership(P, A, { e: outsider, w: randBelow(P.N) }).ok).toBe(false)
    }
  })

  it('rejects a witness perturbed by a single multiplication', () => {
    const w = membershipWitness(P, primes, primes[0]!)
    expect(verifyMembership(P, A, { e: primes[0]!, w: (w.w * 2n) % P.N }).ok).toBe(false)
  })
})

describe('non-membership forgery attempts (all must fail)', () => {
  it('rejects random (a, d) pairs', () => {
    for (let i = 0; i < 300; i++) {
      const wit = { x: primes[0]!, a: randBelow(primes[0]!), d: randBelow(P.N) }
      expect(verifyNonMembership(P, A, wit).ok).toBe(false)
    }
  })

  it('rejects the degenerate a = 0, d = g attempt', () => {
    expect(verifyNonMembership(P, A, { x: primes[0]!, a: 0n, d: P.g }).ok).toBe(false)
  })

  it('rejects a valid witness replayed for a different element', () => {
    const wit = nonMembershipWitness(P, primes, outsider)
    const other = hashToPrime('someone-else').prime
    expect(verifyNonMembership(P, A, { ...wit, x: other }).ok).toBe(false)
  })

  it('rejects a valid witness replayed against a different accumulator', () => {
    const wit = nonMembershipWitness(P, primes, outsider)
    const A2 = addElement(P, A, hashToPrime('unrelated').prime)
    expect(verifyNonMembership(P, A2, wit).ok).toBe(false)
  })
})

describe('the revocation attack the demo is built around', () => {
  it('a pre-revocation "not revoked" proof stops verifying the moment it is revoked', () => {
    const good = nonMembershipWitness(P, primes, outsider)
    expect(verifyNonMembership(P, A, good).ok).toBe(true)

    const revokedSet = [...primes, outsider]
    const A2 = accumulate(P, revokedSet)
    expect(verifyNonMembership(P, A2, good).ok).toBe(false)

    // And the positive statement now holds instead.
    const proofOfRevocation = membershipWitness(P, revokedSet, outsider)
    expect(verifyMembership(P, A2, proofOfRevocation).ok).toBe(true)
  })

  it('un-revoking restores the non-membership proof but invalidates the revocation proof', () => {
    const revokedSet = [...primes, outsider]
    const revocationProof = membershipWitness(P, revokedSet, outsider)
    const A3 = deleteByRecompute(P, primes)
    expect(verifyMembership(P, A3, revocationProof).ok).toBe(false)
    expect(verifyNonMembership(P, A3, nonMembershipWitness(P, primes, outsider)).ok).toBe(true)
  })
})

describe('why the construction needs what it needs', () => {
  it('a COMPOSITE representative forges membership — this is why elements hash to primes', () => {
    // Baric-Pfitzmann 1997. If an adversary could choose e = e₁·e₂ for two
    // members e₁, e₂, the honest verifier accepts even though "e" was never
    // accumulated. hashToPrime() is what removes this attack, not the verifier.
    const fake = primes[0]! * primes[1]!
    const u = exponentProduct(primes)
    const w = modPow(P.g, u / fake, P.N)
    expect(verifyMembership(P, A, { e: fake, w }).ok).toBe(true)

    // The real element map can never produce that value: it is composite.
    expect(fake % primes[0]!).toBe(0n)
  })

  it('the TRAPDOOR forges any membership witness — this is why setup must be trusted', () => {
    const { p, q } = P.trapdoor!
    const order = ((p - 1n) / 2n) * ((q - 1n) / 2n)
    const forged = modPow(A, modInv(mod1(outsider, order), order), P.N)
    expect(verifyMembership(P, A, { e: outsider, w: forged }).ok).toBe(true)

    // Without p and q there is no such shortcut — that is the Strong RSA
    // assumption, and it is exactly what this demo cannot demonstrate.
  })

  it('an element outside the group (gcd(w, N) ≠ 1) still cannot satisfy the equation', () => {
    const { p } = P.trapdoor!
    expect(verifyMembership(P, A, { e: outsider, w: p }).ok).toBe(false)
  })
})

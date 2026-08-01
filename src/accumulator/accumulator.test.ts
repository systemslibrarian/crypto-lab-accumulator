import { describe, it, expect } from 'vitest'
import kat from '../fixtures/kat.json'
import { hashToPrime } from '../core/hashToPrime'
import { modPow, egcd, bitLength } from '../core/bigint'
import { SHIPPED_PARAMS } from './params'
import {
  accumulate,
  addElement,
  deleteByRecompute,
  deleteWithTrapdoor,
  exponentProduct,
  generateParams,
  membershipWitness,
  nonMembershipWitness,
  updateMembershipOnAdd,
  updateMembershipOnDelete,
  updateNonMembershipOnAdd,
  updateNonMembershipOnDelete,
  verifyMembership,
  verifyNonMembership,
  paramsFromModulus,
} from './accumulator'

const P = SHIPPED_PARAMS
const labels = ['cert:SN-0xA31F', 'cert:SN-0xB77C', 'cert:SN-0xC0DE', 'cert:SN-0xD4A9']
const primes = labels.map((l) => hashToPrime(l).prime)
const outsider = hashToPrime('revoked-2024-11-03').prime

describe('shipped parameters', () => {
  it('is a 512-bit modulus that is the product of its two safe primes', () => {
    const { p, q } = P.trapdoor!
    expect(p * q).toBe(P.N)
    expect(bitLength(P.N)).toBe(512)
  })

  it('has p and q safe: (p-1)/2 and (q-1)/2 are prime', async () => {
    const { isProbablePrime } = await import('../core/primes')
    const { p, q } = P.trapdoor!
    expect(isProbablePrime(p)).toBe(true)
    expect(isProbablePrime(q)).toBe(true)
    expect(isProbablePrime((p - 1n) / 2n)).toBe(true)
    expect(isProbablePrime((q - 1n) / 2n)).toBe(true)
  })

  it('has g in the quadratic-residue subgroup', () => {
    // g was produced as r², so it is a QR mod p and mod q by construction.
    const { p, q } = P.trapdoor!
    expect(modPow(P.g % p, (p - 1n) / 2n, p)).toBe(1n)
    expect(modPow(P.g % q, (q - 1n) / 2n, q)).toBe(1n)
  })
})

describe('accumulate', () => {
  it('equals g^(∏ eᵢ) however the product is taken', () => {
    const A = accumulate(P, primes)
    expect(A).toBe(modPow(P.g, exponentProduct(primes), P.N))
  })

  it('is order-independent — a set, not a list', () => {
    const A = accumulate(P, primes)
    for (const perm of [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ]) {
      expect(accumulate(P, perm.map((i) => primes[i]!))).toBe(A)
    }
  })

  it('does not grow: the digest is one group element for 1 or 400 elements', () => {
    const many = Array.from({ length: 400 }, (_, i) => hashToPrime(`bulk:${i}`).prime)
    const big = accumulate(P, many)
    const small = accumulate(P, [primes[0]!])
    expect(bitLength(big)).toBeLessThanOrEqual(P.bits)
    expect(bitLength(small)).toBeLessThanOrEqual(P.bits)
    // The exponent, meanwhile, is enormous.
    expect(bitLength(exponentProduct(many))).toBeGreaterThan(25_000)
  })

  it('KAT: matches the accumulator computed by the independent Python build', () => {
    const A = accumulate(P, kat.accumulator.labels.map((l) => hashToPrime(l).prime))
    expect(A.toString()).toBe(kat.accumulator.A)
    expect(exponentProduct(kat.accumulator.labels.map((l) => hashToPrime(l).prime)).toString()).toBe(
      kat.accumulator.u,
    )
  })
})

describe('membership', () => {
  it('accepts an honest witness for every member', () => {
    const A = accumulate(P, primes)
    for (const e of primes) {
      const w = membershipWitness(P, primes, e)
      const r = verifyMembership(P, A, w)
      expect(r.ok).toBe(true)
      expect(r.lhs).toBe(r.rhs)
    }
  })

  it('KAT: witnesses match the independent Python build', () => {
    const katPrimes = kat.accumulator.labels.map((l) => hashToPrime(l).prime)
    for (const v of kat.accumulator.membership) {
      const w = membershipWitness(P, katPrimes, BigInt(v.e))
      expect(w.w.toString()).toBe(v.w)
    }
  })

  it('refuses to produce a witness for a non-member (fails closed)', () => {
    expect(() => membershipWitness(P, primes, outsider)).toThrow(/not a member/)
  })

  it('rejects a witness aimed at the wrong element', () => {
    const A = accumulate(P, primes)
    const w = membershipWitness(P, primes, primes[0]!)
    expect(verifyMembership(P, A, { e: primes[1]!, w: w.w }).ok).toBe(false)
  })

  it('rejects a witness against a stale digest', () => {
    const A = accumulate(P, primes)
    const w = membershipWitness(P, primes, primes[0]!)
    const A2 = addElement(P, A, outsider)
    expect(verifyMembership(P, A2, w).ok).toBe(false)
  })
})

describe('non-membership', () => {
  it('accepts an honest witness for an absent element', () => {
    const A = accumulate(P, primes)
    const wit = nonMembershipWitness(P, primes, outsider)
    const r = verifyNonMembership(P, A, wit)
    expect(r.ok).toBe(true)
    expect(r.lhs).toBe(P.g)
  })

  it('keeps the Bezout coefficient reduced into [0, x)', () => {
    const wit = nonMembershipWitness(P, primes, outsider)
    expect(wit.a >= 0n && wit.a < wit.x).toBe(true)
  })

  it('KAT: matches the independent Python build', () => {
    const katPrimes = kat.accumulator.labels.map((l) => hashToPrime(l).prime)
    const wit = nonMembershipWitness(P, katPrimes, BigInt(kat.accumulator.nonMembership.x))
    expect(wit.a.toString()).toBe(kat.accumulator.nonMembership.a)
    expect(wit.d.toString()).toBe(kat.accumulator.nonMembership.d)
  })

  it('refuses to produce one for an actual member — this IS the soundness', () => {
    expect(() => nonMembershipWitness(P, primes, primes[2]!)).toThrow(/IS a member/)
  })

  it('rejects a witness whose group element was tampered with', () => {
    const A = accumulate(P, primes)
    const wit = nonMembershipWitness(P, primes, outsider)
    expect(verifyNonMembership(P, A, { ...wit, d: (wit.d * 2n) % P.N }).ok).toBe(false)
    expect(verifyNonMembership(P, A, { ...wit, a: wit.a + 1n }).ok).toBe(false)
  })

  it('stops verifying once the element is added to the set', () => {
    const A = accumulate(P, primes)
    const wit = nonMembershipWitness(P, primes, outsider)
    const A2 = addElement(P, A, outsider)
    expect(verifyNonMembership(P, A2, wit).ok).toBe(false)
  })
})

describe('dynamic updates', () => {
  it('adding is one exponentiation and agrees with a full recompute', () => {
    const A = accumulate(P, primes)
    expect(addElement(P, A, outsider)).toBe(accumulate(P, [...primes, outsider]))
  })

  it('deleting via recompute and via the trapdoor agree', () => {
    const A = accumulate(P, primes)
    const remaining = primes.filter((e) => e !== primes[1]!)
    expect(deleteWithTrapdoor(P, A, primes[1]!)).toBe(deleteByRecompute(P, remaining))
  })

  it('refuses the trapdoor path when no trapdoor is held', () => {
    const noTrapdoor = { N: P.N, g: P.g, bits: P.bits, provenance: 'shipped' as const }
    expect(() => deleteWithTrapdoor(noTrapdoor, accumulate(P, primes), primes[0]!)).toThrow(
      /needs the factorisation/,
    )
  })

  it('a membership witness survives an ADD after one exponentiation', () => {
    const A = accumulate(P, primes)
    const w = membershipWitness(P, primes, primes[0]!)
    const A2 = addElement(P, A, outsider)
    expect(verifyMembership(P, A2, w).ok).toBe(false) // stale
    const w2 = updateMembershipOnAdd(P, w, outsider)
    expect(verifyMembership(P, A2, w2).ok).toBe(true) // repaired
    expect(w2.w).toBe(membershipWitness(P, [...primes, outsider], primes[0]!).w)
  })

  it('a membership witness survives a DELETE via the Bezout update, no secret needed', () => {
    const w = membershipWitness(P, primes, primes[0]!)
    const remaining = primes.filter((e) => e !== primes[3]!)
    const A2 = deleteByRecompute(P, remaining)
    expect(verifyMembership(P, A2, w).ok).toBe(false) // stale
    const w2 = updateMembershipOnDelete(P, w, primes[3]!, A2)
    expect(verifyMembership(P, A2, w2).ok).toBe(true)
    expect(w2.w).toBe(membershipWitness(P, remaining, primes[0]!).w)
  })

  it('refuses to "update" a witness for the element that was just deleted', () => {
    const A2 = deleteByRecompute(P, primes.slice(1))
    const w = membershipWitness(P, primes, primes[0]!)
    expect(() => updateMembershipOnDelete(P, w, primes[0]!, A2)).toThrow(/not a member/)
  })

  it('a non-membership witness survives an ADD', () => {
    const A = accumulate(P, primes)
    const wit = nonMembershipWitness(P, primes, outsider)
    const A2 = addElement(P, A, hashToPrime('newcomer').prime)
    expect(verifyNonMembership(P, A2, wit).ok).toBe(false)
    const wit2 = updateNonMembershipOnAdd(P, wit, hashToPrime('newcomer').prime, A, A2)
    expect(verifyNonMembership(P, A2, wit2).ok).toBe(true)
    expect(wit2.a >= 0n && wit2.a < wit2.x).toBe(true)
  })

  it('a non-membership witness survives a DELETE', () => {
    const wit = nonMembershipWitness(P, primes, outsider)
    const remaining = primes.slice(0, 3)
    const A2 = deleteByRecompute(P, remaining)
    expect(verifyNonMembership(P, A2, wit).ok).toBe(false)
    const wit2 = updateNonMembershipOnDelete(P, wit, primes[3]!, A2)
    expect(verifyNonMembership(P, A2, wit2).ok).toBe(true)
    expect(wit2.a >= 0n && wit2.a < wit2.x).toBe(true)
  })

  it('survives a long random sequence of adds and deletes', () => {
    let set = [...primes]
    let A = accumulate(P, set)
    const subject = hashToPrime('long-run-subject').prime
    let nonWit = nonMembershipWitness(P, set, subject)
    let memWit = membershipWitness(P, set, primes[0]!)

    for (let i = 0; i < 12; i++) {
      if (i % 3 === 2 && set.length > 2) {
        const victim = set[set.length - 1]!
        if (victim === primes[0]) continue
        set = set.filter((e) => e !== victim)
        const A2 = deleteByRecompute(P, set)
        nonWit = updateNonMembershipOnDelete(P, nonWit, victim, A2)
        memWit = updateMembershipOnDelete(P, memWit, victim, A2)
        A = A2
      } else {
        const e = hashToPrime(`churn:${i}`).prime
        const A2 = addElement(P, A, e)
        set = [...set, e]
        nonWit = updateNonMembershipOnAdd(P, nonWit, e, A, A2)
        memWit = updateMembershipOnAdd(P, memWit, e)
        A = A2
      }
      expect(verifyNonMembership(P, A, nonWit).ok, `iteration ${i}`).toBe(true)
      expect(verifyMembership(P, A, memWit).ok, `iteration ${i}`).toBe(true)
    }
  })
})

describe('freshly generated parameters', () => {
  it('produces a usable accumulator end to end', async () => {
    const fresh = await generateParams(96)
    expect(bitLength(fresh.N)).toBeGreaterThanOrEqual(95)
    expect(fresh.provenance).toBe('generated-in-browser')
    const A = accumulate(fresh, primes)
    const w = membershipWitness(fresh, primes, primes[1]!)
    expect(verifyMembership(fresh, A, w).ok).toBe(true)
    const nw = nonMembershipWitness(fresh, primes, outsider)
    expect(verifyNonMembership(fresh, A, nw).ok).toBe(true)
  }, 120_000)

  it('picks a g coprime to N', () => {
    const derived = paramsFromModulus(P.N)
    expect(egcd(derived.g, P.N).g).toBe(1n)
  })
})

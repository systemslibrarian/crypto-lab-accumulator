/**
 * The RSA accumulator itself — Benaloh-de Mare (1993) as hardened by
 * Baric-Pfitzmann (1997), made dynamic by Camenisch-Lysyanskaya (2002) and
 * made *universal* (non-membership too) by Li-Li-Xue (2007).
 *
 * Everything is one equation:
 *
 *     A = g^(e₁·e₂·…·eₙ) mod N
 *
 * A membership witness is the same product with your factor left out, so
 * putting it back reproduces A. A non-membership witness is a Bezout identity
 * proving your prime shares no factor with the product. The digest A is one
 * group element no matter how large the set is — that is the whole point.
 *
 * SECURITY MODEL (enforced by construction, not by comment):
 *   1. Elements are represented by distinct odd primes (hashToPrime.ts). Without
 *      primality, "e divides the product" stops implying membership.
 *   2. g is a quadratic residue mod N with N a product of safe primes, so the
 *      group has no small subgroups to fall into.
 *   3. Soundness rests on the Strong RSA assumption AND on nobody knowing the
 *      factorisation. This demo knows it. That is a stated limitation, not a
 *      hidden one — see `AccumulatorParams.trapdoor`.
 *   4. Every function here fails closed: asking for a membership witness for a
 *      non-member throws rather than returning something that looks plausible.
 */

import { modPow, modInv, egcd, gcd, mod1, bitLength, randBelow } from '../core/bigint'
import { generateSafePrime, type SafePrimeOptions } from '../core/primes'
import type {
  AccumulatorParams,
  MembershipWitness,
  NonMembershipWitness,
  VerificationResult,
} from './types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Generate fresh parameters: N = p·q from two safe primes, and g = r² mod N
 * (squaring lands r in QR_N regardless of what r was).
 */
export async function generateParams(
  modulusBits: number,
  opts: SafePrimeOptions = {},
): Promise<AccumulatorParams> {
  const half = modulusBits >> 1
  const p = await generateSafePrime(half, opts)
  let q = await generateSafePrime(modulusBits - half, opts)
  while (q === p) q = await generateSafePrime(modulusBits - half, opts)
  const N = p * q
  return { ...paramsFromModulus(N), trapdoor: { p, q }, provenance: 'generated-in-browser' }
}

/** Derive g (and the bit length) from a modulus. g = r² mod N with r random. */
export function paramsFromModulus(N: bigint): AccumulatorParams {
  let g = 0n
  do {
    const r = randBelow(N - 3n) + 2n
    g = (r * r) % N
  } while (g <= 1n || gcd(g, N) !== 1n)
  return { N, g, bits: bitLength(N), provenance: 'shipped' }
}

// ---------------------------------------------------------------------------
// Accumulating
// ---------------------------------------------------------------------------

/** u = ∏ eᵢ — the exponent. Grows without bound; A does not. */
export function exponentProduct(primes: readonly bigint[]): bigint {
  let u = 1n
  for (const e of primes) u *= e
  return u
}

/** A = g^(∏ eᵢ) mod N, computed one factor at a time (no giant intermediate). */
export function accumulate(params: AccumulatorParams, primes: readonly bigint[]): bigint {
  let a = params.g
  for (const e of primes) a = modPow(a, e, params.N)
  return a
}

/** Adding an element is one exponentiation of the existing digest: A' = A^e. */
export function addElement(params: AccumulatorParams, A: bigint, e: bigint): bigint {
  assertValidElement(e)
  return modPow(A, e, params.N)
}

/**
 * Deletion, public path: recompute from the remaining set. O(n) exponentiations
 * and needs no secret — the accumulator manager knows the set anyway.
 */
export function deleteByRecompute(
  params: AccumulatorParams,
  remaining: readonly bigint[],
): bigint {
  return accumulate(params, remaining)
}

/**
 * Deletion, trapdoor path: A' = A^(e⁻¹ mod ord). One exponentiation, but it
 * requires φ(N) — i.e. the factorisation. Shown side by side with the public
 * path so the trusted-setup cost is visible rather than asserted.
 *
 * g ∈ QR_N, whose order divides p'q' where p = 2p'+1, q = 2q'+1.
 */
export function deleteWithTrapdoor(params: AccumulatorParams, A: bigint, e: bigint): bigint {
  if (!params.trapdoor) throw new Error('no trapdoor: deletion needs the factorisation of N')
  const { p, q } = params.trapdoor
  const order = ((p - 1n) / 2n) * ((q - 1n) / 2n)
  const eInv = modInv(mod1(e, order), order)
  return modPow(A, eInv, params.N)
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * w = g^(u / e). Fails closed: if e is not in the set the division is not
 * exact and no witness exists, so we throw instead of inventing one.
 */
export function membershipWitness(
  params: AccumulatorParams,
  primes: readonly bigint[],
  e: bigint,
): MembershipWitness {
  assertValidElement(e)
  const others = removeOnce(primes, e)
  if (others === null) throw new Error('not a member: no membership witness exists')
  return { e, w: accumulate(params, others) }
}

/** The whole verification: put the missing factor back and see if A reappears. */
export function verifyMembership(
  params: AccumulatorParams,
  A: bigint,
  witness: MembershipWitness,
): VerificationResult {
  const lhs = modPow(witness.w, witness.e, params.N)
  return { ok: lhs === A, lhs, rhs: A, equation: 'w^e mod N  ==  A' }
}

// ---------------------------------------------------------------------------
// Non-membership (Li-Li-Xue universal accumulator)
// ---------------------------------------------------------------------------

/**
 * Bezout on (u, x). Exists iff gcd(x, u) = 1, i.e. iff x is not one of the
 * accumulated primes — which is precisely the statement being proved.
 */
export function nonMembershipWitness(
  params: AccumulatorParams,
  primes: readonly bigint[],
  x: bigint,
): NonMembershipWitness {
  assertValidElement(x)
  const u = exponentProduct(primes)
  const { g: divisor, x: a0, y: b0 } = egcd(u, x)
  if (divisor !== 1n) throw new Error('x divides the accumulated product: it IS a member')
  // a0·u + b0·x = 1. Reduce a0 into [0, x) so the witness stays small; the
  // reduction is absorbed by the group element (see reduceWitness).
  return reduceWitness(params, { x, a: a0, d: modPow(params.g, b0, params.N) }, accumulate(params, primes))
}

/**
 * Verification: A^a · d^x ≡ g (mod N).
 *
 * Substituting A = g^u and d = g^b this is g^(a·u + b·x) = g^1 — the Bezout
 * identity, evaluated in the exponent where the verifier can check it without
 * ever learning u.
 */
export function verifyNonMembership(
  params: AccumulatorParams,
  A: bigint,
  witness: NonMembershipWitness,
): VerificationResult {
  const lhs =
    (modPow(A, witness.a, params.N) * modPow(witness.d, witness.x, params.N)) % params.N
  return { ok: lhs === params.g, lhs, rhs: params.g, equation: 'A^a · d^x mod N  ==  g' }
}

/**
 * Push `a` back into [0, x) after an update, moving the overflow into d.
 * a = a' + k·x ⟹ b' = b + k·u ⟹ d' = d · A^k, because A = g^u.
 */
function reduceWitness(
  params: AccumulatorParams,
  witness: NonMembershipWitness,
  A: bigint,
): NonMembershipWitness {
  const a = mod1(witness.a, witness.x)
  const k = (witness.a - a) / witness.x
  const d = (witness.d * modPow(A, k, params.N)) % params.N
  return { x: witness.x, a, d }
}

// ---------------------------------------------------------------------------
// Witness maintenance — the part people forget accumulators need
// ---------------------------------------------------------------------------

/**
 * After someone else is ADDED, an existing membership witness needs one
 * exponentiation: w' = w^(e_added). No secret, no set knowledge.
 */
export function updateMembershipOnAdd(
  params: AccumulatorParams,
  witness: MembershipWitness,
  eAdded: bigint,
): MembershipWitness {
  if (eAdded === witness.e) throw new Error('cannot re-add the element the witness is for')
  return { e: witness.e, w: modPow(witness.w, eAdded, params.N) }
}

/**
 * After someone else is DELETED, the witness goes stale and cannot simply be
 * exponentiated — but Camenisch-Lysyanskaya's update works from public data:
 *
 *   a·e + b·e_del = 1  (Bezout, both are distinct primes)
 *   w' = w^b · A'^a
 *
 * Then w'^e = A'^(b·e_del + a·e) = A'. Still no trapdoor, still no set.
 */
export function updateMembershipOnDelete(
  params: AccumulatorParams,
  witness: MembershipWitness,
  eDeleted: bigint,
  newA: bigint,
): MembershipWitness {
  if (eDeleted === witness.e) throw new Error('the element itself was deleted: it is not a member')
  const { g: divisor, x: a, y: b } = egcd(witness.e, eDeleted)
  if (divisor !== 1n) throw new Error('representatives are not coprime')
  const w =
    (modPow(witness.w, b, params.N) * modPow(newA, a, params.N)) % params.N
  return { e: witness.e, w }
}

/**
 * Non-membership witness after an ADD. From a·u + b·x = 1 and a₀·e + r₀·x = 1:
 *
 *   a' = a·a₀      d' = d · A_old^(a·r₀)
 *
 * which satisfies a'·(u·e) + b'·x = 1. Public data only.
 */
export function updateNonMembershipOnAdd(
  params: AccumulatorParams,
  witness: NonMembershipWitness,
  eAdded: bigint,
  oldA: bigint,
  newA: bigint,
): NonMembershipWitness {
  if (eAdded === witness.x) throw new Error('the element itself was added: it is now a member')
  const { g: divisor, x: a0, y: r0 } = egcd(eAdded, witness.x)
  if (divisor !== 1n) throw new Error('representatives are not coprime')
  const d = (witness.d * modPow(oldA, witness.a * r0, params.N)) % params.N
  return reduceWitness(params, { x: witness.x, a: witness.a * a0, d }, newA)
}

/**
 * Non-membership witness after a DELETE. u = u'·e_del, so a·u + b·x = 1 reads
 * (a·e_del)·u' + b·x = 1 — multiply the coefficient, leave d alone.
 */
export function updateNonMembershipOnDelete(
  params: AccumulatorParams,
  witness: NonMembershipWitness,
  eDeleted: bigint,
  newA: bigint,
): NonMembershipWitness {
  if (eDeleted === witness.x) throw new Error('the element was never a member')
  return reduceWitness(params, { x: witness.x, a: witness.a * eDeleted, d: witness.d }, newA)
}

// ---------------------------------------------------------------------------
// Sizes — used by the comparison panel, measured rather than claimed
// ---------------------------------------------------------------------------

export function serialisedBytes(n: bigint): number {
  return Math.ceil(bitLength(n) / 8)
}

export function membershipProofBytes(params: AccumulatorParams, w: MembershipWitness): number {
  // The witness is one group element; the element's own prime is derived by
  // the verifier from the label, so it is not part of the proof.
  void w
  return Math.ceil(params.bits / 8)
}

export function nonMembershipProofBytes(
  params: AccumulatorParams,
  wit: NonMembershipWitness,
): number {
  return Math.ceil(params.bits / 8) + serialisedBytes(wit.a)
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertValidElement(e: bigint): void {
  if (e < 3n) throw new Error('element representative must be an odd prime > 2')
  if ((e & 1n) === 0n) throw new Error('element representative must be odd')
}

/** Remove one occurrence of `e`; null when it was not present at all. */
function removeOnce(primes: readonly bigint[], e: bigint): bigint[] | null {
  const idx = primes.indexOf(e)
  if (idx === -1) return null
  return [...primes.slice(0, idx), ...primes.slice(idx + 1)]
}

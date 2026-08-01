/** Shared shapes for the RSA accumulator. */

export interface AccumulatorParams {
  /** RSA modulus N = p·q with p, q safe primes. */
  N: bigint
  /** Generator, a quadratic residue mod N. The accumulator is g^(∏ eᵢ). */
  g: bigint
  /** Bit length of N. */
  bits: number
  /**
   * The trapdoor. Present because this demo generates its own modulus in your
   * browser — which is exactly the trusted-setup problem the page discusses.
   * Anyone holding p and q can forge any witness they like.
   */
  trapdoor?: { p: bigint; q: bigint }
  /** Where these parameters came from, for the provenance line in the UI. */
  provenance: 'shipped' | 'generated-in-browser'
}

/** Membership witness: w with w^e ≡ A (mod N). */
export interface MembershipWitness {
  /** The prime representative this witness is for. */
  e: bigint
  /** g raised to the product of every *other* element's prime. */
  w: bigint
}

/**
 * Non-membership witness (Li-Li-Xue 2007, "universal accumulator").
 *
 * For x ∉ S we have gcd(x, u) = 1 where u = ∏ eᵢ, so Bezout gives a·u + b·x = 1.
 * Publishing (a, d = g^b) lets a verifier check A^a · d^x ≡ g (mod N) without
 * ever seeing u — and no such pair exists when x | u.
 */
export interface NonMembershipWitness {
  /** The prime representative this witness is for. */
  x: bigint
  /** Bezout coefficient on u, reduced into [0, x). */
  a: bigint
  /** g^b, the group-element half of the witness. */
  d: bigint
}

export interface VerificationResult {
  ok: boolean
  /** Left-hand side of the verification equation, as computed. */
  lhs: bigint
  /** Right-hand side it was compared against. */
  rhs: bigint
  /** Human-readable form of the identity being checked. */
  equation: string
}

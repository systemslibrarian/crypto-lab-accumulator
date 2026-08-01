/**
 * Hand-rolled BigInt modular arithmetic.
 *
 * The accumulator IS the teaching subject, so its internals are written out
 * here rather than hidden behind a library: every exponentiation, inverse and
 * Bezout identity the page shows you is computed by this file. There is no
 * simulated math anywhere in this demo.
 *
 * Nothing here is constant-time. That is stated in the UI and the README: a
 * teaching demo runs on public inputs, and pretending otherwise would be the
 * dishonest kind of simplification.
 */

/** Modular exponentiation, square-and-multiply, left-to-right over the bits. */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod <= 0n) throw new RangeError('modulus must be positive')
  if (mod === 1n) return 0n
  if (exp < 0n) return modPow(modInv(base, mod), -exp, mod)
  let result = 1n
  let b = mod1(base, mod)
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

/** Always-positive remainder (JS `%` keeps the sign of the dividend). */
export function mod1(a: bigint, m: bigint): bigint {
  const r = a % m
  return r < 0n ? r + m : r
}

export interface Bezout {
  /** gcd(a, b) — always non-negative. */
  g: bigint
  /** x with a·x + b·y = g. */
  x: bigint
  /** y with a·x + b·y = g. */
  y: bigint
}

/**
 * Extended Euclid. The non-membership witness is literally a Bezout
 * coefficient, so this routine is on the page's critical teaching path.
 */
export function egcd(a: bigint, b: bigint): Bezout {
  let [oldR, r] = [a, b]
  let [oldS, s] = [1n, 0n]
  let [oldT, t] = [0n, 1n]
  while (r !== 0n) {
    const q = oldR / r
    ;[oldR, r] = [r, oldR - q * r]
    ;[oldS, s] = [s, oldS - q * s]
    ;[oldT, t] = [t, oldT - q * t]
  }
  if (oldR < 0n) return { g: -oldR, x: -oldS, y: -oldT }
  return { g: oldR, x: oldS, y: oldT }
}

export function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b]
  while (y) [x, y] = [y, x % y]
  return x
}

/** Modular inverse; throws when the inverse does not exist. */
export function modInv(a: bigint, m: bigint): bigint {
  const { g, x } = egcd(mod1(a, m), m)
  if (g !== 1n) throw new RangeError('no modular inverse (gcd != 1)')
  return mod1(x, m)
}

/** Number of bits in |n| (0 for n = 0). */
export function bitLength(n: bigint): number {
  let v = n < 0n ? -n : n
  let bits = 0
  while (v > 0n) {
    v >>= 1n
    bits++
  }
  return bits
}

/** Bytes needed to serialise |n| unsigned big-endian — how "big" a digest is. */
export function byteLength(n: bigint): number {
  return Math.ceil(bitLength(n) / 8)
}

/** Fixed-width lowercase hex, sized to the modulus so digests line up visually. */
export function toHex(n: bigint, byteWidth?: number): string {
  const raw = mod1(n, 1n << BigInt(8 * Math.max(1, byteLength(n)))).toString(16)
  const width = byteWidth === undefined ? Math.max(2, raw.length + (raw.length % 2)) : byteWidth * 2
  return raw.padStart(width, '0')
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}

/** Uniform random bigint in [0, max) using rejection sampling on whole bytes. */
export function randBelow(max: bigint, rng: (n: number) => Uint8Array = randomBytes): bigint {
  if (max <= 0n) throw new RangeError('max must be positive')
  const bytes = Math.ceil(bitLength(max) / 8)
  const mask = (1n << BigInt(bitLength(max))) - 1n
  for (;;) {
    const candidate = bytesToBigInt(rng(bytes)) & mask
    if (candidate < max) return candidate
  }
}

/** Random bigint with exactly `bits` bits (top bit forced set). */
export function randBits(bits: number, rng: (n: number) => Uint8Array = randomBytes): bigint {
  if (bits < 2) throw new RangeError('bits must be >= 2')
  const bytes = Math.ceil(bits / 8)
  let n = bytesToBigInt(rng(bytes)) >> BigInt(bytes * 8 - bits)
  n |= 1n << BigInt(bits - 1)
  return n
}

/** CSPRNG bytes. Browser and Node both expose `globalThis.crypto`. */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

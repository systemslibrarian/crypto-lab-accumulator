/**
 * A real sorted-leaf Merkle tree, built only so the comparison panel can
 * MEASURE the accumulator against the alternative instead of asserting it.
 *
 * Hashing follows RFC 6962 (Certificate Transparency): leaves are
 * SHA-256(0x00 ‖ entry), internal nodes are SHA-256(0x01 ‖ left ‖ right), and
 * an odd-sized level splits at the largest power of two below n.
 *
 * Leaves are kept in sorted order, which is the only way a Merkle tree can do
 * non-membership at all: to prove x is absent you exhibit the two *adjacent*
 * leaves that bracket it and prove both are in the tree. That costs two audit
 * paths plus the neighbours' own bytes, it forces a total order on the set, and
 * it leaks two real members to the verifier. The accumulator's answer to the
 * same question is one group element and one small integer. That contrast is
 * the point of this file.
 */

import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '../core/hashToPrime'

export const HASH_BYTES = 32

const LEAF_PREFIX = 0x00
const NODE_PREFIX = 0x01

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export function leafHash(entry: string): Uint8Array {
  return sha256(concat(Uint8Array.of(LEAF_PREFIX), new TextEncoder().encode(entry)))
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(Uint8Array.of(NODE_PREFIX), left, right))
}

/** Largest power of two strictly less than n (RFC 6962's split point). */
function splitPoint(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

/** Merkle Tree Hash of an already-sorted list of entries. */
export function merkleRoot(entries: readonly string[]): Uint8Array {
  if (entries.length === 0) return sha256(new Uint8Array(0))
  if (entries.length === 1) return leafHash(entries[0]!)
  const k = splitPoint(entries.length)
  return nodeHash(merkleRoot(entries.slice(0, k)), merkleRoot(entries.slice(k)))
}

export interface InclusionProof {
  index: number
  treeSize: number
  /** Sibling hashes, leaf-to-root. */
  path: Uint8Array[]
}

/** Audit path for `index` in a tree of `entries` (entries must be sorted). */
export function inclusionProof(entries: readonly string[], index: number): InclusionProof {
  if (index < 0 || index >= entries.length) throw new RangeError('index out of range')
  const path: Uint8Array[] = []
  const walk = (lo: number, hi: number): void => {
    if (hi - lo <= 1) return
    const k = splitPoint(hi - lo)
    if (index < lo + k) {
      path.push(merkleRoot(entries.slice(lo + k, hi)))
      walk(lo, lo + k)
    } else {
      path.push(merkleRoot(entries.slice(lo, lo + k)))
      walk(lo + k, hi)
    }
  }
  walk(0, entries.length)
  path.reverse()
  return { index, treeSize: entries.length, path }
}

/** Recompute the root from a leaf + audit path; compare to the claimed root. */
export function verifyInclusion(
  entry: string,
  proof: InclusionProof,
  root: Uint8Array,
): boolean {
  if (proof.treeSize === 0) return false
  let hash = leafHash(entry)
  let lo = 0
  let hi = proof.treeSize
  const stack: Array<'L' | 'R'> = []
  while (hi - lo > 1) {
    const k = splitPoint(hi - lo)
    if (proof.index < lo + k) {
      stack.push('L')
      hi = lo + k
    } else {
      stack.push('R')
      lo = lo + k
    }
  }
  if (stack.length !== proof.path.length) return false
  for (let i = 0; i < proof.path.length; i++) {
    const sibling = proof.path[i]!
    hash = stack[stack.length - 1 - i] === 'L' ? nodeHash(hash, sibling) : nodeHash(sibling, hash)
  }
  return bytesToHex(hash) === bytesToHex(root)
}

export interface AbsenceProof {
  /** Inclusion proof for the greatest entry < target (null if target is smallest). */
  left: { entry: string; proof: InclusionProof } | null
  /** Inclusion proof for the least entry > target (null if target is largest). */
  right: { entry: string; proof: InclusionProof } | null
  treeSize: number
}

/**
 * Non-membership, the Merkle way: prove the two neighbours that bracket the
 * target are adjacent leaves of the sorted tree, so nothing can sit between
 * them. Fails closed if the target is actually present.
 */
export function absenceProof(entries: readonly string[], target: string): AbsenceProof {
  const sorted = [...entries].sort(compareEntries)
  if (sorted.includes(target)) throw new Error('target is present: no absence proof exists')
  let i = 0
  while (i < sorted.length && compareEntries(sorted[i]!, target) < 0) i++
  // sorted[i-1] < target < sorted[i]
  const left = i > 0 ? { entry: sorted[i - 1]!, proof: inclusionProof(sorted, i - 1) } : null
  const right = i < sorted.length ? { entry: sorted[i]!, proof: inclusionProof(sorted, i) } : null
  return { left, right, treeSize: sorted.length }
}

export function verifyAbsence(target: string, proof: AbsenceProof, root: Uint8Array): boolean {
  if (proof.treeSize === 0) return false
  if (proof.left) {
    if (compareEntries(proof.left.entry, target) >= 0) return false
    if (!verifyInclusion(proof.left.entry, proof.left.proof, root)) return false
  }
  if (proof.right) {
    if (compareEntries(proof.right.entry, target) <= 0) return false
    if (!verifyInclusion(proof.right.entry, proof.right.proof, root)) return false
  }
  // The neighbours must be adjacent, and any missing side must be a real edge.
  if (proof.left && proof.right) {
    if (proof.right.proof.index !== proof.left.proof.index + 1) return false
  } else if (proof.left) {
    if (proof.left.proof.index !== proof.treeSize - 1) return false
  } else if (proof.right) {
    if (proof.right.proof.index !== 0) return false
  } else {
    return false
  }
  return true
}

/** Byte-order comparison — the total order the sorted tree depends on. */
export function compareEntries(a: string, b: string): number {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const n = Math.min(ea.length, eb.length)
  for (let i = 0; i < n; i++) {
    if (ea[i]! !== eb[i]!) return ea[i]! - eb[i]!
  }
  return ea.length - eb.length
}

export function inclusionProofBytes(proof: InclusionProof): number {
  return proof.path.length * HASH_BYTES
}

export function absenceProofBytes(proof: AbsenceProof): number {
  const encoder = new TextEncoder()
  let bytes = 0
  if (proof.left) bytes += inclusionProofBytes(proof.left.proof) + encoder.encode(proof.left.entry).length
  if (proof.right) bytes += inclusionProofBytes(proof.right.proof) + encoder.encode(proof.right.entry).length
  return bytes
}

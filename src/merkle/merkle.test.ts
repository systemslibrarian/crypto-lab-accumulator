import { describe, it, expect } from 'vitest'
import { bytesToHex } from '../core/hashToPrime'
import {
  absenceProof,
  absenceProofBytes,
  compareEntries,
  inclusionProof,
  inclusionProofBytes,
  leafHash,
  merkleRoot,
  nodeHash,
  verifyAbsence,
  verifyInclusion,
  HASH_BYTES,
} from './merkle'

const set = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg'].sort(compareEntries)

describe('RFC 6962 hashing', () => {
  it('uses distinct leaf and node prefixes (second-preimage defence)', () => {
    const l = leafHash('x')
    const n = nodeHash(l, l)
    expect(bytesToHex(l)).not.toBe(bytesToHex(n))
  })

  it('a single-entry tree hashes to that leaf', () => {
    expect(bytesToHex(merkleRoot(['only']))).toBe(bytesToHex(leafHash('only')))
  })

  it('an empty tree hashes to SHA-256 of the empty string, as RFC 6962 specifies', () => {
    expect(bytesToHex(merkleRoot([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches a hand-built two-leaf tree', () => {
    expect(bytesToHex(merkleRoot(['a', 'b']))).toBe(
      bytesToHex(nodeHash(leafHash('a'), leafHash('b'))),
    )
  })

  it('matches a hand-built three-leaf tree (split at the largest power of two)', () => {
    const expected = nodeHash(nodeHash(leafHash('a'), leafHash('b')), leafHash('c'))
    expect(bytesToHex(merkleRoot(['a', 'b', 'c']))).toBe(bytesToHex(expected))
  })

  it('the root is a fixed 32 bytes regardless of set size', () => {
    for (const n of [1, 7, 64, 500]) {
      const entries = Array.from({ length: n }, (_, i) => `e${String(i).padStart(4, '0')}`)
      expect(merkleRoot(entries).length).toBe(HASH_BYTES)
    }
  })
})

describe('inclusion proofs', () => {
  it('verifies for every index', () => {
    const root = merkleRoot(set)
    for (let i = 0; i < set.length; i++) {
      expect(verifyInclusion(set[i]!, inclusionProof(set, i), root)).toBe(true)
    }
  })

  it('rejects a proof pointed at the wrong entry', () => {
    const root = merkleRoot(set)
    expect(verifyInclusion('zz', inclusionProof(set, 0), root)).toBe(false)
  })

  it('rejects a tampered audit path', () => {
    const root = merkleRoot(set)
    const proof = inclusionProof(set, 3)
    const firstSibling = proof.path[0]!
    firstSibling[0] = firstSibling[0]! ^ 0xff
    expect(verifyInclusion(set[3]!, proof, root)).toBe(false)
  })

  it('rejects a proof against the wrong root', () => {
    expect(verifyInclusion(set[2]!, inclusionProof(set, 2), merkleRoot([...set, 'hh']))).toBe(false)
  })

  it('grows as O(log n) — the size claim the comparison panel makes', () => {
    for (const n of [8, 64, 512, 4096]) {
      const entries = Array.from({ length: n }, (_, i) => `e${String(i).padStart(5, '0')}`)
      const bytes = inclusionProofBytes(inclusionProof(entries, 0))
      expect(bytes).toBe(Math.log2(n) * HASH_BYTES)
    }
  })

  it('rejects an index out of range', () => {
    expect(() => inclusionProof(set, 99)).toThrow(RangeError)
  })
})

describe('absence proofs — what non-membership costs a Merkle tree', () => {
  const root = merkleRoot(set)

  it('verifies for a target between two members', () => {
    const proof = absenceProof(set, 'cd')
    expect(verifyAbsence('cd', proof, root)).toBe(true)
    expect(proof.left?.entry).toBe('cc')
    expect(proof.right?.entry).toBe('dd')
  })

  it('verifies below the smallest and above the largest member', () => {
    expect(verifyAbsence('0', absenceProof(set, '0'), root)).toBe(true)
    expect(verifyAbsence('zz', absenceProof(set, 'zz'), root)).toBe(true)
  })

  it('refuses to build one for a member (fails closed)', () => {
    expect(() => absenceProof(set, 'dd')).toThrow(/present/)
  })

  it('rejects non-adjacent neighbours — the whole security of the construction', () => {
    const proof = absenceProof(set, 'cd')
    // Swap in a legitimate-but-distant leaf: both inclusion proofs still
    // verify, so adjacency is the only thing standing between this and a lie.
    const forged = { ...proof, right: { entry: set[5]!, proof: inclusionProof(set, 5) } }
    expect(verifyInclusion(set[5]!, forged.right.proof, root)).toBe(true)
    expect(verifyAbsence('cd', forged, root)).toBe(false)
  })

  it('rejects neighbours that do not bracket the target', () => {
    const proof = absenceProof(set, 'cd')
    expect(verifyAbsence('aa0', proof, root)).toBe(false)
  })

  it('costs about twice an inclusion proof, plus the neighbours themselves', () => {
    const proof = absenceProof(set, 'cd')
    const inc = inclusionProofBytes(inclusionProof(set, 2))
    expect(absenceProofBytes(proof)).toBeGreaterThan(inc)
    expect(absenceProofBytes(proof)).toBeGreaterThanOrEqual(2 * inc)
  })

  it('leaks two real members to the verifier', () => {
    const proof = absenceProof(set, 'cd')
    expect(set).toContain(proof.left!.entry)
    expect(set).toContain(proof.right!.entry)
  })
})

describe('entry ordering', () => {
  it('compares by UTF-8 bytes, prefix-first', () => {
    expect(compareEntries('a', 'b')).toBeLessThan(0)
    expect(compareEntries('ab', 'a')).toBeGreaterThan(0)
    expect(compareEntries('a', 'a')).toBe(0)
    expect(compareEntries('é', 'z')).toBeGreaterThan(0) // 0xc3 > 0x7a
  })
})

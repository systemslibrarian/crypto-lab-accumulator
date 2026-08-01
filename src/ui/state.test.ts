/**
 * The shared lab state is pure logic — no DOM — so the two properties the
 * guided story depends on can be tested directly:
 *
 *  1. Replay determinism. Reset must return the lab to byte-identical state,
 *     or Back, Restart and the `?step=` deep link all drift.
 *  2. The digest history, which is what lets the page say "valid against the
 *     digest it was minted for, invalid against the current one" instead of
 *     collapsing both into a single misleading "invalid".
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LabState } from './state'
import { verifyMembership, verifyNonMembership } from '../accumulator/accumulator'
import { DEFAULT_NON_MEMBER, DEFAULT_SET } from '../accumulator/params'

let lab: LabState

beforeEach(() => {
  lab = new LabState()
})

describe('replay determinism', () => {
  it('reset restores the opening digest exactly', () => {
    const opening = lab.A
    lab.add('cert:SN-0x7E31')
    lab.add('cert:SN-0x9AC0')
    expect(lab.A).not.toBe(opening)
    lab.reset()
    expect(lab.A).toBe(opening)
    expect(lab.labels).toEqual([...DEFAULT_SET])
    expect(lab.version).toBe(0)
  })

  it('replaying the same beats twice lands on the same digest', () => {
    const replay = (l: LabState): bigint => {
      l.reset()
      l.add('cert:SN-0x7E31')
      l.add('cert:SN-0x9AC0')
      l.add(DEFAULT_NON_MEMBER)
      return l.A
    }
    expect(replay(lab)).toBe(replay(new LabState()))
  })

  it('order of additions does not change the digest — it is a set', () => {
    lab.add('a')
    lab.add('b')
    const forwards = lab.A
    lab.reset()
    lab.add('b')
    lab.add('a')
    expect(lab.A).toBe(forwards)
  })
})

describe('digest history', () => {
  it('records every published version', () => {
    const v0 = lab.A
    lab.add('cert:SN-0x7E31')
    const v1 = lab.A
    lab.add('cert:SN-0x9AC0')
    expect(lab.version).toBe(2)
    expect(lab.digestAt(0)).toBe(v0)
    expect(lab.digestAt(1)).toBe(v1)
    expect(lab.digestAt(2)).toBe(lab.A)
    expect(lab.digestAt(99)).toBeNull()
  })

  it('counts how far behind a held version is', () => {
    lab.add('x')
    lab.add('y')
    expect(lab.versionsBehind(0)).toBe(2)
    expect(lab.versionsBehind(2)).toBe(0)
    // A version from the future is not "negative behind".
    expect(lab.versionsBehind(5)).toBe(0)
  })

  it('is cleared by reset so replayed versions do not collide', () => {
    lab.add('x')
    const staleV1 = lab.digestAt(1)
    lab.reset()
    lab.add('y')
    expect(lab.digestAt(1)).not.toBe(staleV1)
  })
})

describe('the freshness distinction the tour teaches', () => {
  it('a witness stays valid against its own digest and fails against the current one', () => {
    const held = lab.mintNonMembership(DEFAULT_NON_MEMBER)
    expect(held).not.toBeNull()
    const mintedAgainst = lab.digestAt(held!.version)
    expect(mintedAgainst).not.toBeNull()

    // Valid right now, against the digest it was minted for.
    expect(verifyNonMembership(lab.params, mintedAgainst!, held!.witness).ok).toBe(true)

    // The set moves. Both statements are still true, and they differ.
    lab.add(DEFAULT_NON_MEMBER)
    expect(verifyNonMembership(lab.params, lab.digestAt(held!.version)!, held!.witness).ok).toBe(true)
    expect(verifyNonMembership(lab.params, lab.A, held!.witness).ok).toBe(false)
  })

  it('the same holds for a membership witness', () => {
    const held = lab.mintMembership(DEFAULT_SET[0]!)
    expect(held).not.toBeNull()
    lab.add('unrelated newcomer')
    expect(verifyMembership(lab.params, lab.digestAt(held!.version)!, held!.witness).ok).toBe(true)
    expect(verifyMembership(lab.params, lab.A, held!.witness).ok).toBe(false)
  })

  it('refuses to mint a proof of absence for something present', () => {
    expect(lab.mintNonMembership(DEFAULT_SET[0]!)).toBeNull()
  })

  it('refuses to mint a membership witness for something absent', () => {
    expect(lab.mintMembership(DEFAULT_NON_MEMBER)).toBeNull()
  })
})

describe('mutation guards', () => {
  it('rejects duplicates and empty labels', () => {
    expect(() => lab.add(DEFAULT_SET[0]!)).toThrow(/already in the set/)
    expect(() => lab.add('   ')).toThrow(/needs a label/)
  })

  it('rejects removing something that is not there', () => {
    expect(() => lab.remove('never added')).toThrow(/not in the set/)
  })

  it('repair refuses when nothing has changed', () => {
    lab.mintHeldWitnesses(DEFAULT_SET[0]!, DEFAULT_NON_MEMBER)
    expect(() => lab.repairHeldMembership()).toThrow(/nothing has changed/)
  })

  it('repairs a membership witness after an unrelated add', () => {
    lab.mintHeldWitnesses(DEFAULT_SET[0]!, DEFAULT_NON_MEMBER)
    lab.add('newcomer')
    expect(lab.membershipFresh()).toBe(false)
    lab.repairHeldMembership()
    expect(lab.membershipFresh()).toBe(true)
  })

  it('cannot repair a proof of absence for a certificate that was just revoked', () => {
    lab.mintHeldWitnesses(DEFAULT_SET[0]!, DEFAULT_NON_MEMBER)
    lab.add(DEFAULT_NON_MEMBER)
    expect(lab.nonMembershipFresh()).toBe(false)
    expect(() => lab.repairHeldNonMembership()).toThrow(/now a member/)
  })
})

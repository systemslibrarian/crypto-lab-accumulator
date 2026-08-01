/**
 * The one shared lab state. Every panel reads from it and re-renders on change,
 * so the digest in the hero of one panel and the digest in another can never
 * disagree — the page always shows a single, consistent accumulator.
 *
 * Nothing here is persisted. Reloading the page rebuilds it from the shipped
 * parameters (§0.6: no backend, nothing stored).
 */

import { hashToPrime, type PrimeRepresentative } from '../core/hashToPrime'
import type {
  AccumulatorParams,
  MembershipWitness,
  NonMembershipWitness,
} from '../accumulator/types'
import { DEFAULT_NON_MEMBER, DEFAULT_SET, SHIPPED_PARAMS } from '../accumulator/params'
import {
  accumulate,
  addElement,
  deleteByRecompute,
  exponentProduct,
  membershipWitness,
  nonMembershipWitness,
  updateMembershipOnAdd,
  updateMembershipOnDelete,
  updateNonMembershipOnAdd,
  updateNonMembershipOnDelete,
  verifyMembership,
  verifyNonMembership,
} from '../accumulator/accumulator'

export interface HeldMembership {
  label: string
  witness: MembershipWitness
  /** Set version this witness was minted or last updated at. */
  version: number
}

export interface HeldNonMembership {
  label: string
  witness: NonMembershipWitness
  version: number
}

type Listener = () => void

export class LabState {
  params: AccumulatorParams = SHIPPED_PARAMS
  labels: string[] = [...DEFAULT_SET]
  /** Bumped on every mutation, so panels can say "your copy is 2 updates behind". */
  version = 0
  A: bigint
  /** The witness a relying party is holding on to — the thing that goes stale. */
  heldMembership: HeldMembership | null = null
  heldNonMembership: HeldNonMembership | null = null
  /** The last mutation, so panels can offer exactly the right repair. */
  lastChange: { kind: 'add' | 'delete'; label: string; previousA: bigint } | null = null
  /**
   * Every digest this lab has published, by version.
   *
   * Kept because "is this proof valid?" and "is this digest current?" are two
   * different questions, and conflating them is the operational mistake
   * accumulators invite. With the history we can verify a witness against the
   * digest it was minted for AND against the live one, and say both out loud.
   */
  private history = new Map<number, bigint>()

  private listeners = new Set<Listener>()

  constructor() {
    this.A = accumulate(this.params, this.primes)
    this.history.set(this.version, this.A)
    this.mintHeldWitnesses(this.labels[0] ?? null, DEFAULT_NON_MEMBER)
  }

  /** The digest as it stood at `version`, or null if that far back is gone. */
  digestAt(version: number): bigint | null {
    return this.history.get(version) ?? null
  }

  /** How many published digests ago a version is. */
  versionsBehind(version: number): number {
    return Math.max(0, this.version - version)
  }

  get primes(): bigint[] {
    return this.labels.map((l) => hashToPrime(l).prime)
  }

  get reps(): PrimeRepresentative[] {
    return this.labels.map((l) => hashToPrime(l))
  }

  get u(): bigint {
    return exponentProduct(this.primes)
  }

  get modulusBytes(): number {
    return Math.ceil(this.params.bits / 8)
  }

  has(label: string): boolean {
    return this.labels.includes(label)
  }

  subscribe(fn: Listener): void {
    this.listeners.add(fn)
  }

  notify(): void {
    for (const fn of this.listeners) fn()
  }

  // -- mutations ------------------------------------------------------------

  add(label: string): void {
    const trimmed = label.trim()
    if (!trimmed) throw new Error('an element needs a label')
    if (this.has(trimmed)) throw new Error(`"${trimmed}" is already in the set`)
    const e = hashToPrime(trimmed).prime
    const previousA = this.A
    this.A = addElement(this.params, this.A, e)
    this.labels = [...this.labels, trimmed]
    this.bumpVersion()
    this.lastChange = { kind: 'add', label: trimmed, previousA }
    this.notify()
  }

  remove(label: string): void {
    if (!this.has(label)) throw new Error(`"${label}" is not in the set`)
    const previousA = this.A
    this.labels = this.labels.filter((l) => l !== label)
    this.A = deleteByRecompute(this.params, this.primes)
    this.bumpVersion()
    this.lastChange = { kind: 'delete', label, previousA }
    this.notify()
  }

  reset(): void {
    this.labels = [...DEFAULT_SET]
    this.A = accumulate(this.params, this.primes)
    this.history.clear()
    this.version = 0
    this.history.set(0, this.A)
    this.lastChange = null
    this.mintHeldWitnesses(this.labels[0] ?? null, DEFAULT_NON_MEMBER)
    this.notify()
  }

  useParams(params: AccumulatorParams): void {
    this.params = params
    this.A = accumulate(params, this.primes)
    this.history.clear()
    this.version = 0
    this.history.set(0, this.A)
    this.lastChange = null
    this.mintHeldWitnesses(this.heldMembership?.label ?? this.labels[0] ?? null, this.heldNonMembership?.label ?? DEFAULT_NON_MEMBER)
    this.notify()
  }

  private bumpVersion(): void {
    this.version++
    this.history.set(this.version, this.A)
  }

  // -- held witnesses -------------------------------------------------------

  mintHeldWitnesses(memberLabel: string | null, nonMemberLabel: string | null): void {
    this.heldMembership = memberLabel !== null ? this.mintMembership(memberLabel) : null
    this.heldNonMembership = nonMemberLabel !== null ? this.mintNonMembership(nonMemberLabel) : null
  }

  mintMembership(label: string): HeldMembership | null {
    try {
      const witness = membershipWitness(this.params, this.primes, hashToPrime(label).prime)
      return { label, witness, version: this.version }
    } catch {
      return null
    }
  }

  mintNonMembership(label: string): HeldNonMembership | null {
    try {
      const witness = nonMembershipWitness(this.params, this.primes, hashToPrime(label).prime)
      return { label, witness, version: this.version }
    } catch {
      return null
    }
  }

  /** Does the held membership witness still verify against the live digest? */
  membershipFresh(): boolean {
    if (!this.heldMembership) return false
    return verifyMembership(this.params, this.A, this.heldMembership.witness).ok
  }

  nonMembershipFresh(): boolean {
    if (!this.heldNonMembership) return false
    return verifyNonMembership(this.params, this.A, this.heldNonMembership.witness).ok
  }

  /**
   * Apply the public witness-update rule for the last change. Returns a short
   * description of what was done, or throws when no repair is possible (which
   * is itself a lesson: a revoked certificate can never re-prove absence).
   */
  repairHeldMembership(): string {
    const held = this.heldMembership
    const change = this.lastChange
    if (!held) throw new Error('no witness is being held')
    if (!change) throw new Error('nothing has changed since the witness was minted')
    const eChanged = hashToPrime(change.label).prime
    const witness =
      change.kind === 'add'
        ? updateMembershipOnAdd(this.params, held.witness, eChanged)
        : updateMembershipOnDelete(this.params, held.witness, eChanged, this.A)
    this.heldMembership = { label: held.label, witness, version: this.version }
    this.notify()
    return change.kind === 'add'
      ? `w ← w^e_added  (one exponentiation, no secret, no set knowledge)`
      : `Bezout on (e, e_deleted) → w ← w^b · A^a  (public data only)`
  }

  repairHeldNonMembership(): string {
    const held = this.heldNonMembership
    const change = this.lastChange
    if (!held) throw new Error('no witness is being held')
    if (!change) throw new Error('nothing has changed since the witness was minted')
    const eChanged = hashToPrime(change.label).prime
    const witness =
      change.kind === 'add'
        ? updateNonMembershipOnAdd(this.params, held.witness, eChanged, change.previousA, this.A)
        : updateNonMembershipOnDelete(this.params, held.witness, eChanged, this.A)
    this.heldNonMembership = { label: held.label, witness, version: this.version }
    this.notify()
    return change.kind === 'add'
      ? `a ← a·a₀,  d ← d · A_old^(a·r₀)  (Bezout on the newcomer)`
      : `a ← a·e_deleted  (d is unchanged)`
  }
}

export const state = new LabState()
